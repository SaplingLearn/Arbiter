import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { databaseUrl } from "../db.js";
import { ShareStore } from "../share.js";
import { PostgresShareStore, type ShareStoreApi } from "../postgres-share.js";
import { AT, LATER, LATEST, shareStoreBehaviour } from "./share-store-contract.js";
import { dropDatabase, freshDatabase } from "./postgres-fixture.js";

/**
 * `PostgresShareStore`, against a real Postgres, beside the file store it has to match.
 * The shared suite runs against both; below it are the things the file store cannot be
 * asked - what the table actually holds, what a race does to the version, and whether
 * the migration's own constraint is really there.
 */

const NO_DATABASE = databaseUrl() === null;

describe("ShareStore (the file-backed original)", () => {
  const make: () => Promise<ShareStoreApi> = () => ShareStore.open(null);
  shareStoreBehaviour(make);
});

describe.skipIf(NO_DATABASE)("PostgresShareStore", () => {
  let db!: pg.Pool;

  beforeAll(async () => {
    db = await freshDatabase("arbiter_test_shares");
  }, 60_000);

  afterAll(async () => {
    await dropDatabase("arbiter_test_shares");
  });

  const make: () => Promise<ShareStoreApi> = async () => {
    await db.query("truncate share_links");
    return PostgresShareStore.open(db);
  };

  shareStoreBehaviour(make);

  describe("what only a database can be asked", () => {
    it("stores five columns and no token", async () => {
      // THE SECURITY CLAIM, ASSERTED AGAINST THE REAL SCHEMA. The token is derived from
      // `case_id` and `version` with the deployment's secret, so a dump of this table is
      // worth nothing without it - and that is true only for as long as nobody adds a
      // column holding the token, a digest of it, or the secret. A test that reads the
      // column list is the only thing that notices when somebody does.
      const store = await make();
      await store.publish("c1", "u-own", AT);
      const columns = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_name = 'share_links' order by column_name`);
      expect(columns.rows.map((c) => c.column_name)).toEqual(
        ["case_id", "created_at", "created_by", "revoked_at", "version"]);
    });

    it("stores the timestamps as timestamps and reads them back as the strings that went in", async () => {
      // Both halves matter, as with invites: the columns are `timestamptz`, so the values
      // are real instants rather than text; the parser in `db.ts` is what turns them back
      // into the ISO strings the API renders.
      const store = await make();
      await store.publish("c1", "u-own", AT);
      await store.revoke("c1", LATER);
      const typed = await db.query<{ created_at: string; revoked_at: string; kind: string }>(
        `select created_at, revoked_at, pg_typeof(created_at)::text as kind from share_links`);
      expect(typed.rows[0]!.kind).toBe("timestamp with time zone");
      expect(typed.rows[0]!.created_at).toBe(AT);
      expect(typed.rows[0]!.revoked_at).toBe(LATER);
    });

    it("would raise on a bare duplicate insert, which is why `publish` is an upsert", async () => {
      // The reason `publish` needs `on conflict` at all, asserted rather than assumed -
      // and a check that the test schema really is the shipped migration, primary key
      // included. A store that let this exception out would turn pressing "publish"
      // twice into a 500 on the report page.
      await make();
      const insert = "insert into share_links (case_id, version, created_by, created_at) values ('c1', 1, 'u-own', $1)";
      await db.query(insert, [AT]);
      await expect(db.query(insert, [AT])).rejects.toThrow(/duplicate key/);
    });

    it("makes one link out of five simultaneous publishes, and returns the same one to all of them", async () => {
      // Five conveners, one primary key. Exactly one row can exist, and every caller must
      // be told about the one that does - not about its own attempt, which would report
      // five different publishers and, worse, five different `createdAt` values for one
      // link whose token is printed on paper.
      const store = await make();
      const links = await Promise.all(["u-a", "u-b", "u-c", "u-d", "u-e"].map((who) =>
        store.publish("c1", who, AT)));

      expect(new Set(links.map((l) => l.createdBy)).size).toBe(1);
      for (const link of links) expect(link).toEqual(links[0]);
      expect(await store.get("c1")).toEqual(links[0]);
      expect(links[0]!.version).toBe(1);
    });

    it("counts every one of five simultaneous revokes, so no version is reused", async () => {
      // `version = version + 1` is the database's arithmetic, not this process's. A
      // read-then-write would have all five compute 2 from the same starting point, and
      // four of the resulting "revocations" would leave the link live at a version
      // somebody is still holding a printed code for.
      const store = await make();
      await store.publish("c1", "u-own", AT);
      await Promise.all([LATER, LATER, LATER, LATER, LATER].map((at) => store.revoke("c1", at)));
      expect((await store.get("c1"))!.version).toBe(6);
    });

    it("refuses a version below the floor, because a reset is how a dead link comes back", async () => {
      // The migration's `check (version >= 1)`, asserted so the constraint cannot quietly
      // stop shipping. Nothing in the store writes a zero; this is here because the bug
      // it guards against - resetting the version on republish - produces a working URL
      // and no error anywhere else.
      await make();
      await expect(db.query(
        "insert into share_links (case_id, version, created_by, created_at) values ('c1', 0, 'u-own', $1)",
        [AT],
      )).rejects.toThrow(/share_links_version_positive/);
    });

    it("answers a whole sequence of operations exactly as the file store does", async () => {
      // Nothing a share store returns is random, so the two transcripts can be compared
      // whole rather than field by field.
      const script = async (store: ShareStoreApi): Promise<unknown[]> => [
        await store.get("c1"),
        await store.publish("c1", "u-own", AT),
        await store.publish("c1", "u-other", LATER),
        await store.publish("c2", "u-own", LATER),
        await store.get("c1"),
        await store.revoke("c1", LATER),
        await store.get("c1"),
        await store.publish("c1", "u-other", LATEST),
        await store.get("c1"),
        await store.get("c2"),
        await store.revoke("c3", LATEST),
      ];
      expect(await script(await make())).toEqual(await script(await ShareStore.open(null)));
    });
  });
});
