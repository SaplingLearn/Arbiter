import { describe, expect, it } from "vitest";
import type pg from "pg";
import { withTransaction } from "../db.js";

/**
 * The two failure paths a real database makes hard to reach on purpose.
 *
 * A connection that dies mid-transaction is what makes the ROLLBACK itself throw, and
 * that is precisely when the caller most needs the ORIGINAL error and the pool most
 * needs to not be handed the connection back. Both are asserted here against a fake
 * pool, because provoking them against Postgres means killing a backend mid-statement.
 */

interface Recorded {
  queries: string[];
  released: (Error | undefined)[];
}

/** A pool whose client fails whichever statements are named. */
function fakePool(failOn: Record<string, Error> = {}): { p: pg.Pool; rec: Recorded } {
  const rec: Recorded = { queries: [], released: [] };
  const client = {
    query: (text: string): Promise<unknown> => {
      rec.queries.push(text);
      const boom = failOn[text];
      return boom === undefined ? Promise.resolve({ rows: [] }) : Promise.reject(boom);
    },
    release: (err?: Error): void => { rec.released.push(err); },
  };
  return { p: { connect: () => Promise.resolve(client) } as unknown as pg.Pool, rec };
}

describe("withTransaction", () => {
  it("commits and returns the connection for reuse", async () => {
    const { p, rec } = fakePool();
    await expect(withTransaction(() => Promise.resolve("ok"), p)).resolves.toBe("ok");

    expect(rec.queries).toEqual(["BEGIN", "COMMIT"]);
    expect(rec.released).toEqual([undefined]);
  });

  it("rolls back on a throw and still returns the connection for reuse", async () => {
    const { p, rec } = fakePool();
    const boom = new Error("the insert failed");
    await expect(withTransaction(() => Promise.reject(boom), p)).rejects.toBe(boom);

    expect(rec.queries).toEqual(["BEGIN", "ROLLBACK"]);
    // The rollback landed, so the connection is clean. Destroying it would be waste.
    expect(rec.released).toEqual([undefined]);
  });

  it("keeps the ORIGINAL error when the rollback throws too", async () => {
    // The connection died mid-transaction. A bare `await client.query("ROLLBACK")` in
    // the catch would reject and replace `boom`, and the caller would be told the
    // rollback failed while never learning what failed first.
    const rollbackFailed = new Error("Connection terminated unexpectedly");
    const { p, rec } = fakePool({ ROLLBACK: rollbackFailed });
    const boom = new Error("the insert failed");

    await expect(withTransaction(() => Promise.reject(boom), p)).rejects.toBe(boom);
    expect(rec.queries).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("DESTROYS a connection whose rollback failed, rather than pooling it", async () => {
    // `release()` with no argument offers it to the next caller, who would inherit an
    // open transaction and whatever the failed one left in it. `release(err)` destroys.
    const { p, rec } = fakePool({ ROLLBACK: new Error("Connection terminated unexpectedly") });
    const boom = new Error("the insert failed");

    await expect(withTransaction(() => Promise.reject(boom), p)).rejects.toBe(boom);
    expect(rec.released).toHaveLength(1);
    expect(rec.released[0]).toBe(boom);
  });

  it("destroys the connection when the COMMIT itself fails", async () => {
    // Same reasoning from the other end: a failed COMMIT leaves the transaction open.
    const { p, rec } = fakePool({
      COMMIT: new Error("could not commit"),
      ROLLBACK: new Error("Connection terminated unexpectedly"),
    });

    await expect(withTransaction(() => Promise.resolve(1), p)).rejects.toThrow("could not commit");
    expect(rec.queries).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
    expect(rec.released[0]).toBeInstanceOf(Error);
  });
});
