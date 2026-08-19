import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { databaseUrl } from "../db.js";
import { InviteStore } from "../invites.js";
import { PostgresInviteStore, type InviteStoreApi } from "../postgres-invites.js";
import { AT, LATER, inviteStoreBehaviour } from "./invite-store-contract.js";
import { dropDatabase, freshDatabase } from "./postgres-fixture.js";

/**
 * `PostgresInviteStore`, against a real Postgres, beside the file store it has to
 * match. The shared suite runs against both; below it are the two things the file
 * store cannot be asked - what a duplicate insert does when the uniqueness is a
 * primary key rather than a `find`, and what happens when two of them race.
 */

const NO_DATABASE = databaseUrl() === null;

describe("InviteStore (the file-backed original)", () => {
  const make: () => Promise<InviteStoreApi> = () => InviteStore.open(null);
  inviteStoreBehaviour(make);
});

describe.skipIf(NO_DATABASE)("PostgresInviteStore", () => {
  let db!: pg.Pool;

  beforeAll(async () => {
    db = await freshDatabase("arbiter_test_invites");
  }, 60_000);

  afterAll(async () => {
    await dropDatabase("arbiter_test_invites");
  });

  const make: () => Promise<InviteStoreApi> = async () => {
    await db.query("truncate invites");
    return PostgresInviteStore.open(db);
  };

  inviteStoreBehaviour(make);

  describe("what only a database can be asked", () => {
    it("would raise on a bare duplicate insert, which is why `add` is not one", async () => {
      // The reason `add` needs an `on conflict` clause at all, asserted rather than
      // assumed - and a check that the test schema really is the shipped migration,
      // primary key included. `InviteStore.add` returns the existing invitation, so a
      // store that let this exception out would turn re-inviting somebody into a 500.
      await make();
      const insert = "insert into invites (email, case_id, invited_by, at) values ('ann@lab.com', 'c1', 'u_o', $1)";
      await db.query(insert, [AT]);
      await expect(db.query(insert, [AT])).rejects.toThrow(/duplicate key/);
    });

    it("makes one invitation out of five simultaneous ones, and returns the same row to all of them", async () => {
      // Five inviters, five different `invitedBy` values, one primary key. Exactly one
      // row can exist, and every caller must be told about the one that does - not
      // about its own attempt, which would report five different authors for the same
      // invitation.
      const store = await make();
      const rows = await Promise.all(["u_a", "u_b", "u_c", "u_d", "u_e"].map((invitedBy) =>
        store.add({ email: "ann@lab.com", caseId: "c1", invitedBy, at: AT })));

      expect(new Set(rows.map((r) => r.invitedBy)).size).toBe(1);
      for (const row of rows) expect(row).toEqual(rows[0]);
      expect(await store.forCase("c1")).toEqual([rows[0]]);
    });

    it("does not leave a row behind after it is claimed or revoked", async () => {
      const store = await make();
      await store.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
      await store.add({ email: "bea@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
      const count = async (): Promise<number> =>
        (await db.query<{ count: number }>("select count(*)::int as count from invites")).rows[0]!.count;

      expect(await count()).toBe(2);
      await store.claim("ann@lab.com");
      expect(await count()).toBe(1);
      await store.revoke("bea@lab.com", "c1");
      expect(await count()).toBe(0);
    });

    it("stores `at` as a timestamp and reads it back as the string that went in", async () => {
      // Both halves matter. The column is `timestamptz`, so the value is a real instant
      // rather than text nobody can order by; the parser in `db.ts` is what turns it
      // back into the ISO string every caller compares and renders.
      const store = await make();
      await store.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
      const typed = await db.query<{ at: string; kind: string }>(
        "select at, pg_typeof(at)::text as kind from invites");
      expect(typed.rows[0]!.kind).toBe("timestamp with time zone");
      expect(typed.rows[0]!.at).toBe(AT);
      expect(typeof typed.rows[0]!.at).toBe("string");
    });

    it("answers a whole sequence of operations exactly as the file store does", async () => {
      // Nothing an invitation store returns is random, so the two transcripts can be
      // compared whole rather than field by field.
      const script = async (store: InviteStoreApi): Promise<unknown[]> => [
        await store.add({ email: "Ann@Lab.COM ", caseId: "c1", invitedBy: "u_owner", at: AT }),
        await store.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_someone_else", at: LATER }),
        await store.add({ email: "ann@lab.com", caseId: "c2", invitedBy: "u_owner", at: LATER }),
        await store.add({ email: "bea@lab.com", caseId: "c1", invitedBy: "u_owner", at: AT }),
        await store.forCase("c1"),
        await store.forEmail("ANN@lab.com"),
        await store.revoke("bea@lab.com", "c1"),
        await store.revoke("bea@lab.com", "c1"),
        await store.claim("ann@lab.com"),
        await store.claim("ann@lab.com"),
        await store.forCase("c1"),
        await store.forCase("c2"),
      ];
      expect(await script(await make())).toEqual(await script(await InviteStore.open(null)));
    });
  });
});
