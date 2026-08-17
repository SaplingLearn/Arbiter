import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scryptSync } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { databaseUrl } from "../db.js";
import { AuthStore, SESSION_TTL_MS, type User } from "../auth.js";
import { PostgresAuthStore, type AuthStoreApi } from "../postgres-auth.js";
import { GOOD, T0, authStoreBehaviour, loginToken, register } from "./auth-store-contract.js";
import { dropDatabase, freshDatabase } from "./postgres-fixture.js";

/**
 * `PostgresAuthStore`, against a real Postgres, beside the file store it has to match.
 *
 * The shared suite runs twice - once per implementation - because the file store is
 * the specification. Below it are the things only a database can be asked: that two
 * registrations racing for one address produce one account, that a password hashed by
 * the old store verifies against the new one and the reverse, and that the scrypt
 * parameters survive the trip through four integer columns.
 */

/** `databaseUrl()` rather than reading the variable directly, so this suite and the
 *  store agree on what "configured" means - `db.ts` treats an empty string as absent,
 *  and a suite that disagreed would try to connect to nothing and fail in CI. */
const NO_DATABASE = databaseUrl() === null;

describe("AuthStore (the file-backed original)", () => {
  const make: () => Promise<AuthStoreApi> = () => AuthStore.open(null);
  authStoreBehaviour(make);
});

describe.skipIf(NO_DATABASE)("PostgresAuthStore", () => {
  let db!: pg.Pool;

  beforeAll(async () => {
    db = await freshDatabase("arbiter_test_auth");
  }, 60_000);

  afterAll(async () => {
    await dropDatabase("arbiter_test_auth");
  });

  /** Every test starts from an empty schema. `truncate` rather than `delete` because
   *  it is one statement for the three tables and cannot leave a session behind whose
   *  account has gone. */
  const make: () => Promise<AuthStoreApi> = async () => {
    await db.query("truncate auth_users, auth_sessions, auth_reset_tokens");
    return PostgresAuthStore.open(db);
  };

  authStoreBehaviour(make);

  describe("what only a database can be asked", () => {
    it("lets exactly one of five simultaneous registrations of an address win", async () => {
      // The file store cannot be tested for this and cannot fail it: its check and its
      // insert are one synchronous step. Two connections are not, and two accounts for
      // one address means the second silently shadows the first - the same person signs
      // in and sees an empty case list. `auth_users.email` is unique for this.
      const store = await make();
      const attempts = await Promise.all([1, 2, 3, 4, 5].map((n) =>
        store.register({ email: "ann@lab.com", displayName: `Ann ${n}`, password: GOOD, now: T0 })));

      expect(attempts.filter((a) => a.ok)).toHaveLength(1);
      for (const a of attempts.filter((x) => !x.ok)) {
        if (!a.ok) expect(a.error.kind).toBe("email_taken");
      }
      const rows = await db.query<{ count: number }>("select count(*)::int as count from auth_users");
      expect(rows.rows[0]?.count).toBe(1);
      // And the winner is the account that can sign in - not a row that lost the race
      // and was rolled back into something unusable.
      expect((await store.login({ email: "ann@lab.com", password: GOOD, now: T0 })).ok).toBe(true);
    });

    it("verifies a password hashed by the file store, byte for byte", async () => {
      // The migration itself: an account that existed before it must sign in after it.
      // The hash cannot be recomputed - the plaintext was never stored - so the row is
      // moved across exactly as `auth.ts` wrote it and asked to verify.
      const path = join(mkdtempSync(join(tmpdir(), "arb-auth-")), "users.json");
      const file = await AuthStore.open(path);
      await register(file);
      const persisted = (JSON.parse(readFileSync(path, "utf8")) as { users: User[] }).users[0]!;

      const store = await make();
      await insertUser(db, persisted);

      const r = await store.login({ email: "ann@lab.com", password: GOOD, now: T0 });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.user.id).toBe(persisted.id);
      expect((await store.login({ email: "ann@lab.com", password: "wrong-but-long-enough", now: T0 })).ok).toBe(false);
    });

    it("writes a hash the file store can verify, so the move is reversible", async () => {
      // The other direction, and it is not symmetric with the first: this is what makes
      // a rollback to the file stores possible after accounts have been created on
      // Postgres. A store that hashed differently would pass the test above and strand
      // every account created after the cutover.
      const store = await make();
      await register(store);
      const row = (await db.query<UserRowShape>("select * from auth_users where email = $1", ["ann@lab.com"])).rows[0]!;

      const path = join(mkdtempSync(join(tmpdir(), "arb-auth-")), "users.json");
      writeFileSync(path, JSON.stringify({ users: [userFromRow(row)], sessions: [], resets: [] }), "utf8");
      const file = await AuthStore.open(path);

      expect((await file.login({ email: "ann@lab.com", password: GOOD, now: T0 })).ok).toBe(true);
      expect((await file.login({ email: "ann@lab.com", password: "wrong-but-long-enough", now: T0 })).ok).toBe(false);
    });

    it("stores the scrypt parameters as four integers, and the same ones the file store writes", async () => {
      // The drift guard for the copied constants in `postgres-auth.ts`. If `auth.ts`
      // raises N and this file is not updated with it, accounts registered through
      // Postgres are hashed under weaker parameters than accounts registered through
      // the file store, and nothing else in the suite would notice.
      const store = await make();
      await register(store);
      const row = (await db.query<UserRowShape>("select * from auth_users where email = $1", ["ann@lab.com"])).rows[0]!;

      for (const [name, value] of [["scrypt_n", row.scrypt_n], ["scrypt_r", row.scrypt_r], ["scrypt_p", row.scrypt_p], ["key_len", row.key_len]] as const) {
        expect(typeof value, name).toBe("number");
        expect(Number.isInteger(value), name).toBe(true);
      }

      const path = join(mkdtempSync(join(tmpdir(), "arb-auth-")), "users.json");
      const file = await AuthStore.open(path);
      await register(file);
      const fromFile = (JSON.parse(readFileSync(path, "utf8")) as { users: User[] }).users[0]!;
      expect({ N: row.scrypt_n, r: row.scrypt_r, p: row.scrypt_p, keyLen: row.key_len }).toEqual(fromFile.params);
      expect(row.password_hash).toHaveLength(fromFile.params.keyLen * 2);
    });

    it("hashes a login against the parameters on the row, not the ones it would use today", async () => {
      // `params` is per record precisely so raising the cost later does not invalidate
      // existing passwords, and `N` is read back to size scrypt's `maxmem` - a store
      // that used its own constants instead would throw or mismatch on every account
      // hashed under different ones.
      const OLD = { N: 16384, r: 8, p: 1, keyLen: 32 };
      const salt = "a".repeat(32);
      const legacy: User = {
        id: "u_legacy", email: "old@lab.com", displayName: "Old",
        passwordHash: scryptSync(GOOD, salt, OLD.keyLen, { ...OLD, maxmem: 2 * 128 * OLD.N * OLD.r }).toString("hex"),
        salt, params: OLD, signatureMethod: "password", createdAt: new Date(T0).toISOString(),
      };
      const store = await make();
      await insertUser(db, legacy);

      expect((await store.login({ email: "old@lab.com", password: GOOD, now: T0 })).ok).toBe(true);
      expect((await store.login({ email: "old@lab.com", password: "wrong-but-long-enough", now: T0 })).ok).toBe(false);
      // Untouched by a successful login: nothing here silently re-hashes.
      const row = (await db.query<UserRowShape>("select * from auth_users where id = 'u_legacy'")).rows[0]!;
      expect(row.password_hash).toBe(legacy.passwordHash);
      expect(row.scrypt_n).toBe(16384);
    });

    it("returns timestamps as the ISO strings the rest of the codebase compares", async () => {
      // `db.ts` installs the parser that makes this true. Without it `created_at` is a
      // `Date`, `expires_at` is a `Date`, and `Date.parse` on one of those quietly loses
      // the milliseconds - so this asserts the exact string, which a `Date` fails.
      const store = await make();
      await register(store);
      await loginToken(store);
      const times = await db.query<{ created_at: string; expires_at: string; issued_at: string }>(
        "select u.created_at, s.expires_at, s.issued_at from auth_users u join auth_sessions s on s.user_id = u.id");
      const row = times.rows[0]!;
      expect(row.created_at).toBe(new Date(T0).toISOString());
      expect(row.issued_at).toBe(new Date(T0).toISOString());
      expect(row.expires_at).toBe(new Date(T0 + SESSION_TTL_MS).toISOString());
    });

    it("deletes the session row rather than only forgetting about it", async () => {
      const store = await make();
      await register(store);
      const live = await loginToken(store);
      const doomed = await loginToken(store);
      const count = async (): Promise<number> =>
        (await db.query<{ count: number }>("select count(*)::int as count from auth_sessions")).rows[0]!.count;

      expect(await count()).toBe(2);
      await store.logout(live);
      expect(await count()).toBe(1);
      await store.resolve(doomed, T0 + SESSION_TTL_MS + 1);
      expect(await count()).toBe(0);
    });

    it("keeps a spent reset token, because a deleted row and a token nobody issued are the same absence", async () => {
      const store = await make();
      await register(store);
      const token = (await store.requestReset("ann@lab.com", T0))!;
      await store.resetPassword(token, "a-brand-new-password", T0 + 60_000);
      const rows = await db.query<{ used_at: string | null }>("select used_at from auth_reset_tokens");
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.used_at).toBe(new Date(T0 + 60_000).toISOString());
    });

    it("answers the error paths word for word as the file store does", async () => {
      // The shared suite compares the kind of each failure. This compares the whole
      // result, prose included, because these strings are what the person on the other
      // end of the API reads - two stores that disagree about the wording of "that
      // reset link is not valid" is a difference a user can see.
      for (const scenario of SCENARIOS) {
        const fromFile = await scenario.run(await AuthStore.open(null));
        const fromPostgres = await scenario.run(await make());
        expect(redact(fromPostgres), scenario.name).toEqual(redact(fromFile));
      }
    });
  });
});

interface UserRowShape {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  salt: string;
  scrypt_n: number;
  scrypt_r: number;
  scrypt_p: number;
  key_len: number;
  signature_method: "password" | "sso";
  created_at: string;
}

/** The row as `auth.ts` would have held it. Written out here rather than imported from
 *  the store, so a mapping bug there cannot cancel itself out in the test. */
function userFromRow(row: UserRowShape): User {
  return {
    id: row.id, email: row.email, displayName: row.display_name,
    passwordHash: row.password_hash, salt: row.salt,
    params: { N: row.scrypt_n, r: row.scrypt_r, p: row.scrypt_p, keyLen: row.key_len },
    signatureMethod: row.signature_method, createdAt: row.created_at,
  };
}

/** Inserts an account the store did not create - a row from the file store, or one
 *  hashed under older parameters. This is the migration path, so it goes in as raw SQL
 *  rather than through `register`, which would hash it again. */
async function insertUser(db: pg.Pool, user: User): Promise<void> {
  await db.query(
    `insert into auth_users (id, email, display_name, password_hash, salt, scrypt_n, scrypt_r, scrypt_p, key_len, signature_method, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [user.id, user.email, user.displayName, user.passwordHash, user.salt,
      user.params.N, user.params.r, user.params.p, user.params.keyLen,
      user.signatureMethod, user.createdAt],
  );
}

/** Account ids and bearer tokens are random by design, so a transcript from two stores
 *  can never be equal until they are removed. Everything else is compared as it is. */
function redact(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v !== "string") return v;
    if (/^u_[0-9a-f]{18}$/.test(v)) return "<id>";
    if (/^[0-9a-f]{64}$/.test(v)) return "<token>";
    return v;
  })) as unknown;
}

const SCENARIOS: { name: string; run: (store: AuthStoreApi) => Promise<unknown> }[] = [
  {
    name: "a second registration of the same address",
    run: async (s) => {
      await s.register({ email: "ann@lab.com", displayName: "Ann", password: GOOD, now: T0 });
      return s.register({ email: "ANN@Lab.com ", displayName: "Ann again", password: GOOD, now: T0 });
    },
  },
  {
    name: "an address that is not one",
    run: (s) => s.register({ email: "not-an-address", displayName: "", password: GOOD, now: T0 }),
  },
  {
    name: "a password under the length floor",
    run: (s) => s.register({ email: "ann@lab.com", displayName: "Ann", password: "short", now: T0 }),
  },
  {
    name: "the wrong password",
    run: async (s) => {
      await register(s);
      return s.login({ email: "ann@lab.com", password: "wrong-but-long-enough", now: T0 });
    },
  },
  {
    name: "an address nobody registered",
    run: (s) => s.login({ email: "nobody@lab.com", password: GOOD, now: T0 }),
  },
  { name: "a token nobody issued", run: (s) => s.resolve("deadbeef", T0) },
  { name: "no token at all", run: (s) => s.resolve(null, T0) },
  {
    name: "a session that has run out",
    run: async (s) => {
      await register(s);
      return s.resolve(await loginToken(s), T0 + SESSION_TTL_MS + 1);
    },
  },
  { name: "a reset token nobody issued", run: (s) => s.resetPassword("deadbeef", "a-brand-new-password", T0) },
  {
    name: "a weak password on a valid reset",
    run: async (s) => {
      await register(s);
      const token = (await s.requestReset("ann@lab.com", T0))!;
      return s.resetPassword(token, "short", T0 + 60_000);
    },
  },
  {
    name: "the people list",
    run: async (s) => {
      for (const email of ["annb@lab.com", "ann-b@lab.com", "anna@lab.com"]) {
        await s.register({ email, displayName: email, password: GOOD, now: T0 });
      }
      return s.list();
    },
  },
];
