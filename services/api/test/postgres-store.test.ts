import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresStore } from "../postgres-store.js";
import { databaseUrl } from "../db.js";
import { migrationSql } from "./postgres-fixture.js";
import { GENESIS, MemoryStore, verifyChain, type LogEntry, type LogKind } from "../store.js";
import { canonicalJson } from "../canonical.js";
import type { DeliberationCase } from "../deliberation.js";

/**
 * `PostgresStore` against a real Postgres, because the property it exists for cannot be
 * mocked.
 *
 * A fake `pg` would return whatever tail row the fake was told to return, so the
 * concurrency test below - the one that decides whether this store is worth having -
 * would be a test of the mock's queueing. `pg_advisory_xact_lock` either serialises two
 * connections or it does not, and only the server knows.
 *
 * SKIPPED WHOLE WHEN NO DATABASE IS CONFIGURED. CI has none, and the contract's
 * definition of done is a green suite on a machine without one. The condition is
 * `databaseUrl()` rather than a fresh read of `process.env` so this suite skips under
 * exactly the rule that will pick the file stores in production - an empty
 * `DATABASE_URL` counts as absent in both places or the two disagree.
 */

const ADMIN_URL = databaseUrl() ?? "";

/**
 * ITS OWN DATABASE, NOT THE ONE `DATABASE_URL` NAMES. Several agents share the local
 * Supabase stack, and `beforeEach` here drops the public schema - run against the shared
 * database that would delete somebody else's work mid-run.
 *
 * The name is fixed rather than randomised so a run that dies without cleaning up leaves
 * one stale database rather than a new one per crash; `beforeAll` drops it before
 * creating it, which is what makes the suite repeatable.
 */
/**
 * PER-PROCESS, NOT A FIXED NAME. A constant name is enough for one `npm test` at a time
 * and fails the moment two overlap: the second run's `beforeAll` drops the database the
 * first run is mid-suite inside, and the first fails in hooks with rows it never wrote.
 * That is not hypothetical - it was reproduced deliberately on this branch while several
 * agents ran the suite concurrently, and it presents as a mystifying data bug rather than
 * as contention. The pid makes concurrent runs disjoint; `afterAll` still drops it.
 */
const TEST_DB = `arbiter_test_store_${process.pid}`;

const testUrl = (): string => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
};

/* THE SCHEMA COMES FROM `migrationSql()`, NOT FROM A PATH SPELLED OUT HERE. This file
   held `new URL(".../0001_init.sql")`, which was correct while that was the only
   migration and became a lie the moment there was a second: this suite would have gone on
   building a database with the tables of one day and none added since, while production
   and the other store suites applied all of them. `postgres-fixture.ts` is the single
   place that knows where migrations live and what order they go in. */

/** Ordinary canonical timestamps, for the tests that are not about timestamps. The
 *  awkward spellings live in their own test near the bottom of this file. */
const at = (i: number): string => new Date(Date.UTC(2026, 7, 16, 12, 0, i)).toISOString();

const event = (i: number, caseId = "c"): { at: string; kind: LogKind; caseId: string; actorId: string; payload: unknown } =>
  ({ at: at(i), kind: "position_sealed", caseId, actorId: `p${i}`, payload: { i } });

const kase = (caseId: string, over: Partial<DeliberationCase> = {}): DeliberationCase => ({
  caseId, compoundLabel: "ABC-123", context: "", ownerId: "owner", participantIds: ["ann"],
  seats: { ann: 0 }, status: "open", positions: [], closedEarly: null, adjudication: null,
  consensus: null, signature: null, ...over,
});

describe.skipIf(ADMIN_URL === "")("PostgresStore", () => {
  let migration: string[] = [];
  let pool: pg.Pool;

  beforeAll(async () => {
    migration = await migrationSql();

    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    // `with (force)` terminates anything still connected from a previous run. Without it
    // a leaked connection makes the drop fail and the suite runs against last run's rows.
    await admin.query(`drop database if exists ${TEST_DB} with (force)`);
    await admin.query(`create database ${TEST_DB}`);
    await admin.end();

    // More than one connection ON PURPOSE. A pool of one would serialise every append by
    // itself and the concurrency test below would pass against a store with no lock at
    // all - it would be measuring the pool, not the database.
    pool = new pg.Pool({ connectionString: testUrl(), max: 8 });
  });

  afterAll(async () => {
    await pool.end();

    // Dropped here, not only at the start of the next run. With a fixed database name the
    // `beforeAll` drop was self-cleaning; with a per-process name nothing would ever come
    // back for this one, so each run would leave a database behind on the local stack.
    // Best-effort - a cleanup failure must not turn a passing suite red, and the pool is
    // already closed above so the `with (force)` has nothing of ours left to terminate.
    try {
      const admin = new pg.Client({ connectionString: ADMIN_URL });
      await admin.connect();
      await admin.query(`drop database if exists ${TEST_DB} with (force)`);
      await admin.end();
    } catch {
      // Left behind rather than failing the run.
    }
  });

  /**
   * The table cannot be emptied, so the schema is rebuilt instead.
   *
   * `deliberation_log` carries triggers that refuse `delete`, `update` and `truncate` -
   * that is the migration doing its job, and it means the usual "clear the tables between
   * tests" has no spelling here. Dropping the schema takes the triggers with it (a `drop`
   * is not a `delete`, so nothing fires) and re-running the migration puts them back.
   * Measured at ~30ms, against ~1s to drop and recreate the database itself.
   *
   * Every test below starts from seq 0 because of this, which is what lets them compare
   * against a fresh `MemoryStore`.
   */
  beforeEach(async () => {
    await pool.query("drop schema public cascade; create schema public;");
    // In order, one file at a time, so a later migration sees the earlier one's tables.
    for (const sql of migration) await pool.query(sql);
  });

  it("starts empty", async () => {
    const s = new PostgresStore(pool);
    expect(await s.all()).toEqual([]);
    expect(await s.entries("c")).toEqual([]);
    expect(await s.getCase("c")).toBeNull();
    expect(await s.allCases()).toEqual([]);
  });

  it("appends a chain that verifyChain accepts", async () => {
    const s = new PostgresStore(pool);
    for (let i = 0; i < 5; i++) await s.append(event(i));

    const all = await s.all();
    expect(all.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(all[0]!.prevHash).toBe(GENESIS);
    expect(all[1]!.prevHash).toBe(all[0]!.hash);
    expect(verifyChain(all)).toEqual([]);
  });

  /**
   * The Postgres answer to `FileStore`'s "has the whole log in hand before it hands the
   * store back". A second store instance holds no log of its own, so there is nothing to
   * load and nothing to load late - but the failure it is guarding against is the same
   * one, and it is the failure that matters most in a deployment with two server
   * processes: an appender that chains to GENESIS on top of an existing chain forks it,
   * and `verifyChain` then reports tampering nobody did.
   */
  it("continues the chain from a store instance that has never appended", async () => {
    const first = new PostgresStore(pool);
    await first.append(event(0));
    await first.append(event(1));

    const second = new PostgresStore(pool);
    const next = await second.append(event(2));
    expect(next.seq).toBe(2);
    expect(next.prevHash).not.toBe(GENESIS);
    expect(verifyChain(await second.all())).toEqual([]);
  });

  /**
   * THE TEST THIS STORE EXISTS FOR.
   *
   * Every other case here awaits each append in turn, which is exactly the pattern that
   * hides the defect: read the tail, await, write, and a second append fits in the gap.
   * Fired together from two pools - so genuinely different connections, the way two
   * server processes would - an implementation without the global advisory lock produces
   * two entries claiming one `seq`, and the primary key turns the loser into a rejected
   * append. Either way this fails: a duplicate key rejects the `Promise.all`, and a fork
   * that somehow got past the key shows up as a gap in the sequence.
   *
   * MEASURED, not assumed. Removing the `pg_advisory_xact_lock` line fails this with
   * "duplicate key value violates unique constraint deliberation_log_pkey", and so does
   * replacing it with the per-case lock - `hashtext(e.caseId)` - which is the plausible
   * wrong answer rather than a strawman.
   */
  it("does not fork the chain when forty appends race across two pools", async () => {
    const other = new pg.Pool({ connectionString: testUrl(), max: 8 });
    try {
      const a = new PostgresStore(pool);
      const b = new PostgresStore(other);
      const n = 40;

      await Promise.all(Array.from({ length: n }, (_, i) =>
        // Alternating stores AND alternating cases: a per-case lock would let the two
        // cases append concurrently, which is the specific wrong lock this rules out.
        (i % 2 === 0 ? a : b).append(event(i, i % 3 === 0 ? "x" : "y"))));

      const all = await a.all();
      expect(all.map((e) => e.seq)).toEqual([...Array(n).keys()]);
      expect(new Set(all.map((e) => e.hash)).size).toBe(n);
      expect(verifyChain(all)).toEqual([]);
    } finally {
      await other.end();
    }
  });

  /**
   * The chain is global rather than per-case (store.ts:262), so that deleting a whole
   * case leaves a hole somebody can find. The assertion that says so is the last one: one
   * case's entries do NOT chain to each other, because the entries between them belong to
   * the other case.
   */
  it("keeps one global chain across different case ids", async () => {
    const s = new PostgresStore(pool);
    for (let i = 0; i < 6; i++) await s.append(event(i, i % 2 === 0 ? "a" : "b"));

    const all = await s.all();
    expect(all.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(verifyChain(all)).toEqual([]);

    const aEntries = await s.entries("a");
    expect(aEntries.map((e) => e.seq)).toEqual([0, 2, 4]);
    expect(aEntries[1]!.prevHash).not.toBe(aEntries[0]!.hash);
    expect(aEntries[1]!.prevHash).toBe(all[1]!.hash);
  });

  /**
   * Ordering, asserted after a concurrent burst rather than after sequential appends.
   *
   * Postgres returns rows in whatever order the scan finds them when nothing says
   * otherwise, and after forty appends committed by eight connections the physical order
   * is not the sequence order. So this is a real test of the `order by seq` in `all()`
   * and `entries()`, which a set of awaited appends would not be.
   */
  it("returns entries() and all() in seq order after concurrent writes", async () => {
    const s = new PostgresStore(pool);
    const n = 40;
    await Promise.all(Array.from({ length: n }, (_, i) => s.append(event(i, i % 2 === 0 ? "a" : "b"))));

    const seqs = (es: LogEntry[]): number[] => es.map((e) => e.seq);
    const all = await s.all();
    expect(seqs(all)).toEqual([...seqs(all)].sort((x, y) => x - y));
    expect(seqs(all)).toEqual([...Array(n).keys()]);

    for (const caseId of ["a", "b"]) {
      const some = await s.entries(caseId);
      expect(some).toHaveLength(n / 2);
      expect(seqs(some)).toEqual([...seqs(some)].sort((x, y) => x - y));
    }
  });

  /**
   * `MemoryStore` IS THE ORACLE. It is the implementation every existing test is written
   * against, so "Postgres agrees with it, entry for entry" is a stronger statement than
   * any assertion invented for this file.
   *
   * The comparison is over `canonicalJson`, not `JSON.stringify`, and the difference is
   * the point rather than a weakening: jsonb does not keep the key order it was given, so
   * `{"b":1,"a":2}` can come back as `{"a":2,"b":1}`. `canonicalJson` sorts keys, which
   * makes it exactly the byte sequence the hash was taken over - the only byte sequence
   * whose identity this store has to preserve. If jsonb changed anything the hash covers,
   * the recomputed hashes would differ and `verifyChain` on the read-back would say so.
   *
   * The payloads are chosen to be the parts of JSON a database is most likely to alter on
   * the way through: nesting, arrays, unicode, quotes and newlines, an empty object, a
   * null, and keys in an order no sort would produce.
   */
  it("round-trips entries identical to the ones MemoryStore builds", async () => {
    const s = new PostgresStore(pool);
    const mem = new MemoryStore();

    const payloads: unknown[] = [
      { participantId: "ann", commitment: "a".repeat(64) },
      { z: 1, a: { nested: [1, 2, { deep: true }] }, m: null },
      { text: "ü \"quoted\" and a\nnewline\tand a tab", emoji: "🧪" },
      {},
      null,
      [1, "two", null, { three: 3 }],
      { count: 0, negative: -17, big: 9007199254740991 },
    ];

    for (const [i, payload] of payloads.entries()) {
      const e = { at: at(i), kind: "adjudicated" as LogKind, caseId: i % 2 === 0 ? "a" : "b", actorId: `actor-${i}`, payload };
      expect(await s.append(e)).toEqual(await mem.append(e));
    }

    const fromPostgres = await s.all();
    const fromMemory = await mem.all();
    expect(fromPostgres).toEqual(fromMemory);
    expect(fromPostgres.map(canonicalJson)).toEqual(fromMemory.map(canonicalJson));
    expect(fromPostgres.map((e) => e.hash)).toEqual(fromMemory.map((e) => e.hash));
    expect(verifyChain(fromPostgres)).toEqual([]);

    for (const caseId of ["a", "b"]) {
      expect(await s.entries(caseId)).toEqual(await mem.entries(caseId));
    }
  });

  /**
   * THE REGRESSION GUARD FOR THE WHOLE CLASS: a column covered by the hash must come
   * back byte-for-byte.
   *
   * `at` is hashed as the STRING it arrived as, and it used to live in a `timestamptz`
   * column, which stores an instant rather than a string. Every spelling below is a legal
   * ISO-8601 timestamp that `timestamptz` accepted happily and handed back rewritten -
   * `"2026-08-09T10:00:00Z"` as `...:00.000Z`, the `+02:00` one shifted to UTC, the
   * microseconds truncated to milliseconds. The recomputed hash then stopped matching the
   * stored one and `verifyChain` reported `bad_hash` - "has been altered since it was
   * written" - against an entry nobody touched. The most damaging false statement this
   * product can make, reachable by any client, because `DeliberationService.submit`
   * passes the request body's `submittedAt` through as `at` with no normalisation.
   *
   * `at text` is what fixes it, so this test is about the column type and would fail
   * against `timestamptz` no matter what the store did short of rejecting the input.
   *
   * MEASURED, not assumed. Re-applying this migration with only `at` put back to
   * `timestamptz` and running exactly these appends: four of the five come back rewritten
   * (`...:00Z`, `+00:00` and `+02:00` all collapse to `...:00.000Z`, and `.123456Z`
   * truncates to `.123Z`), and `verifyChain` returns four `bad_hash` failures.
   */
  it("returns non-canonical ISO timestamps byte-for-byte, so the chain still verifies", async () => {
    const s = new PostgresStore(pool);
    const mem = new MemoryStore();
    const spellings = [
      "2026-08-09T10:00:00.000Z",   // canonical, as a control
      "2026-08-09T10:00:00Z",       // no milliseconds
      "2026-08-09T10:00:00+00:00",  // explicit zero offset
      "2026-08-09T12:00:00+02:00",  // a non-UTC offset: same instant, different bytes
      "2026-08-09T10:00:00.123456Z", // microseconds, finer than a JS Date holds
    ];

    for (const at of spellings) {
      const e = { ...event(0), at };
      expect(await s.append(e)).toEqual(await mem.append(e));
    }

    const all = await s.all();
    expect(all.map((e) => e.at)).toEqual(spellings);
    expect(all).toEqual(await mem.all());
    expect(verifyChain(all)).toEqual([]);

    // WHY BYTE-IDENTITY AND NOT "SAME INSTANT": the first four are three distinct
    // spellings of one moment and the hash separates them, because the hash is over the
    // string. Any storage that normalised them together would have to change the hash.
    expect(new Set(all.slice(0, 4).map((e) => e.hash)).size).toBe(4);
  });

  it("round-trips the epoch, which is what deliberation-service backfills with", async () => {
    const s = new PostgresStore(pool);
    const first = await s.append({ ...event(0), at: new Date(0).toISOString() });
    expect(first.at).toBe("1970-01-01T00:00:00.000Z");
    expect((await s.all())[0]!.at).toBe(first.at);
    expect(verifyChain(await s.all())).toEqual([]);
  });

  describe("cases", () => {
    it("round-trips a case, including the seat map", async () => {
      const s = new PostgresStore(pool);
      const c = kase("c-1", {
        participantIds: ["ann", "bea"], seats: { ann: 0, bea: 1 },
        positions: [{ participantId: "ann", call: "advance", reasoning: "Because.", citedFindingIds: ["f1"], external: [], submittedAt: at(0) }],
      });
      await s.putCase(c);
      expect(await s.getCase("c-1")).toEqual(c);
      expect(await s.getCase("nope")).toBeNull();
    });

    it("overwrites rather than duplicating, so the case has one row however often it changes", async () => {
      const s = new PostgresStore(pool);
      await s.putCase(kase("c-1"));
      await s.putCase(kase("c-1", { status: "locked", compoundLabel: "XYZ-9" }));

      const all = await s.allCases();
      expect(all).toHaveLength(1);
      expect(all[0]!.status).toBe("locked");
      expect(all[0]!.compoundLabel).toBe("XYZ-9");
    });

    it("orders allCases so a case list does not reshuffle when a case is touched", async () => {
      const s = new PostgresStore(pool);
      for (const id of ["c-3", "c-1", "c-2"]) await s.putCase(kase(id));
      expect((await s.allCases()).map((c) => c.caseId)).toEqual(["c-1", "c-2", "c-3"]);

      await s.putCase(kase("c-1", { status: "signed" }));
      expect((await s.allCases()).map((c) => c.caseId)).toEqual(["c-1", "c-2", "c-3"]);
    });

    /**
     * The same repair `FileStore.load` applies, for rows imported from an existing
     * `.cases.json`. Written through raw SQL rather than `putCase`, because `putCase`
     * writes the current schema and so could never produce the row this is about.
     *
     * Rehydrated as-is, `seats` is undefined and the seat transitions read it unguarded:
     * `withParticipant(undefined, id)` throws on `'userId' in undefined`, the handler's
     * outer catch turns that into an opaque 500, and adding anybody to any migrated case
     * fails with a message naming nothing.
     */
    it("gives a case migrated from before seats existed an empty seat map", async () => {
      const legacy = {
        caseId: "legacy", compoundLabel: "X", context: "", ownerId: "o",
        participantIds: ["ann"], status: "open", positions: [],
        closedEarly: null, adjudication: null, signature: null,
      };
      await pool.query("insert into deliberation_cases (case_id, data) values ($1, $2)", ["legacy", JSON.stringify(legacy)]);

      const s = new PostgresStore(pool);
      expect((await s.getCase("legacy"))?.seats).toEqual({});
      expect((await s.allCases())[0]!.seats).toEqual({});
    });

    it("keeps the log and the case snapshot independent, so a mid-case export reveals nothing", async () => {
      // The two-table split carries the two-file split's property: the log holds
      // commitments, the case holds plaintext. Handing somebody the log mid-case must not
      // hand them an answer.
      const s = new PostgresStore(pool);
      const secret = "SECRET-REASONING-TOKEN";
      await s.putCase(kase("c-1", {
        positions: [{ participantId: "ann", call: "advance", reasoning: secret, citedFindingIds: [], external: [], submittedAt: at(0) }],
      }));
      await s.append({ at: at(1), kind: "position_sealed", caseId: "c-1", actorId: "ann", payload: { participantId: "ann", commitment: "b".repeat(64) } });

      expect(JSON.stringify(await s.all())).not.toContain(secret);
    });
  });
});
