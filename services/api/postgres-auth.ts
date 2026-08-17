import { randomBytes, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { pool, withTransaction } from "./db.js";
import {
  KEY_LEN,
  MIN_PASSWORD,
  RESET_TTL_MS,
  SALT_LEN,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  SESSION_TTL_MS,
  hashPassword,
  normaliseEmail,
  publicUser,
  tokenHashOf,
  type AuthResult,
  type PublicUser,
  type SignatureMethod,
  type User,
} from "./auth.js";

/**
 * `AuthStore` backed by Postgres: the same accounts, sessions and reset tokens, in
 * `auth_users`, `auth_sessions` and `auth_reset_tokens`.
 *
 * THE HASHES ARE THE MIGRATION. Everything else here is a table that can be rebuilt
 * from the log; a password hash cannot be rebuilt from anything, because the
 * plaintext was never stored. So `password_hash`, `salt` and the four scrypt
 * parameters move across verbatim and are read back exactly as they were written -
 * an account created on the file store logs in against this one and the reverse, and
 * `test/postgres-auth.test.ts` asserts both directions rather than trusting it. The
 * failure this is defending against is not subtle in effect and is invisible in code
 * review: rehash on migration, or coerce `N` to something scrypt then sizes `maxmem`
 * against, and every existing account is locked out at once with no way back.
 *
 * WHERE THIS DELIBERATELY DIVERGES FROM `AuthStore`, and why each one is not a
 * behaviour change:
 *
 *   - `register` does not check the address before inserting. In memory the check and
 *     the insert are one synchronous step; across two connections they interleave, and
 *     two simultaneous registrations of one address would both pass the check and both
 *     insert, leaving the second account silently shadowing the first. `on conflict
 *     (email) do nothing` moves the decision into the unique index, where it is atomic,
 *     and a zero row count is exactly the `email_taken` the file store returns.
 *
 *   - `resolve` compares expiry in JavaScript, against the caller's `now`, not in SQL
 *     against the database clock. Every caller passes its own clock (the tests pass a
 *     fixed one), and `now()` in the query would quietly ignore it.
 *
 *   - `list` orders with `collate "C"`. `AuthStore.list` sorts with JavaScript `<`,
 *     which compares code units; a Postgres `order by` uses the deployment's collation,
 *     and Supabase's default `en_US.UTF-8` orders punctuation and case by different
 *     rules. Two stores that disagree about the order of the people list is a small
 *     bug, but it is one that only appears in production, because a locally-initialised
 *     cluster is often close enough to C to hide it.
 */

/**
 * The seam. `AuthStore` and `PostgresAuthStore` are interchangeable behind it, and
 * TypeScript checks that claim in `test/postgres-auth.test.ts`, where both are held in
 * a variable of this type.
 *
 * Declared here rather than in `auth.ts` because this file is the second
 * implementation and the first one did not need a name for its own shape. If auth.ts
 * ever grows a method this interface does not list, the store that lacks it fails to
 * typecheck at the wiring site, which is where it should fail.
 */
export interface AuthStoreApi {
  register(input: { email: string; displayName: string; password: string; now: number }): Promise<AuthResult<PublicUser>>;
  login(input: { email: string; password: string; now: number }): Promise<AuthResult<{ token: string; user: PublicUser }>>;
  requestReset(email: string, now: number): Promise<string | null>;
  resetPassword(token: string, newPassword: string, now: number): Promise<AuthResult<PublicUser>>;
  resolve(token: string | null, now: number): Promise<AuthResult<PublicUser>>;
  logout(token: string): Promise<void>;
  findByEmail(email: string): Promise<PublicUser | null>;
  get(id: string): Promise<PublicUser | null>;
  list(): Promise<PublicUser[]>;
  pruneExpired(now: number): Promise<number>;
}

/**
 * THE COST PARAMETERS AND THE HASHER COME FROM `auth.ts`, and are no longer copied.
 *
 * They were copied while that file exported none of them, with the drift risk stated
 * here and a test holding it: raise `SCRYPT_N` there and forget here, and accounts
 * registered through Postgres are hashed under weaker parameters than accounts
 * registered through the file store - no error and no lockout, because the parameters
 * travel per record so both still verify, just a silent security regression in half the
 * deployment depending on which store the process happens to be running.
 *
 * `auth.ts` now exports them, so the risk is gone rather than guarded. The test that
 * asserts both stores write identical parameters is kept anyway: it costs nothing and it
 * is the thing that would notice if these ever diverged again.
 */
function freshParams(): User["params"] {
  return { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, keyLen: KEY_LEN };
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  salt: string;
  scrypt_n: number;
  scrypt_r: number;
  scrypt_p: number;
  key_len: number;
  signature_method: SignatureMethod;
  created_at: string;
}

const USER_FIELDS = [
  "id", "email", "display_name", "password_hash", "salt",
  "scrypt_n", "scrypt_r", "scrypt_p", "key_len", "signature_method", "created_at",
] as const;

/** `resolve` reads the account through a join and needs the same columns qualified. A
 *  second hand-written list is a list that loses a column the day one is added. */
function userColumns(prefix = ""): string {
  return USER_FIELDS.map((f) => prefix + f).join(", ");
}

/** The four integer columns become the one `params` object the hashing takes. This is
 *  the round trip the whole migration turns on, so it happens in exactly one place. */
function userFrom(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    salt: row.salt,
    params: { N: row.scrypt_n, r: row.scrypt_r, p: row.scrypt_p, keyLen: row.key_len },
    signatureMethod: row.signature_method,
    createdAt: row.created_at,
  };
}

interface SessionRow {
  expires_at: string;
}

interface ResetRow {
  token_hash: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
}

export class PostgresAuthStore implements AuthStoreApi {
  /** Private, with a `static open`, purely so this and `AuthStore.open` are
   *  interchangeable in one `buildStores()` factory. There is nothing to load - the
   *  rows stay in the database - but a factory that has to remember which of two
   *  stores is constructed with `new` and which with `await` is a factory that will
   *  eventually construct the wrong one. */
  private constructor(private readonly db: pg.Pool) {}

  static async open(db: pg.Pool = pool()): Promise<PostgresAuthStore> {
    return new PostgresAuthStore(db);
  }

  async register(input: { email: string; displayName: string; password: string; now: number }): Promise<AuthResult<PublicUser>> {
    const email = normaliseEmail(input.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: { kind: "bad_email", detail: "That does not look like an email address." } };
    }
    if (input.password.length < MIN_PASSWORD) {
      return { ok: false, error: { kind: "weak_password", detail: `Use at least ${MIN_PASSWORD} characters. Length is what protects a stolen hash; there are no symbol or digit rules.` } };
    }

    const salt = randomBytes(SALT_LEN).toString("hex");
    const params = freshParams();
    const user: User = {
      id: `u_${randomBytes(9).toString("hex")}`,
      email,
      displayName: input.displayName.trim() === "" ? email : input.displayName.trim(),
      passwordHash: hashPassword(input.password, salt, params),
      salt,
      params,
      signatureMethod: "password",
      createdAt: new Date(input.now).toISOString(),
    };

    // The conflict target is named, so this swallows a duplicate ADDRESS and nothing
    // else. A bare `do nothing` would also swallow a primary-key collision on `id`,
    // and an id collision reported as "an account already exists for that address"
    // would be a lie about which account exists.
    const inserted = await this.db.query(
      `insert into auth_users (${userColumns()})
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (email) do nothing`,
      [user.id, user.email, user.displayName, user.passwordHash, user.salt,
        user.params.N, user.params.r, user.params.p, user.params.keyLen,
        user.signatureMethod, user.createdAt],
    );
    if ((inserted.rowCount ?? 0) === 0) {
      return { ok: false, error: { kind: "email_taken", detail: "An account already exists for that address." } };
    }
    return { ok: true, value: publicUser(user) };
  }

  /** One error for a wrong address and a wrong password, and a miss still runs a hash,
   *  both for the reasons `AuthStore.login` sets out. The decoy work matters more here
   *  than it did there: a database round trip is already the visible cost of a login,
   *  so an early return on an unknown address would stand out in the timing even more
   *  clearly than it did in memory. */
  async login(input: { email: string; password: string; now: number }): Promise<AuthResult<{ token: string; user: PublicUser }>> {
    const email = normaliseEmail(input.email);
    const found = await this.db.query<UserRow>(
      `select ${userColumns()} from auth_users where email = $1`, [email],
    );
    const row = found.rows[0];
    const user = row === undefined ? undefined : userFrom(row);

    const salt = user?.salt ?? "0".repeat(SALT_LEN * 2);
    const params = user?.params ?? freshParams();
    const attempt = hashPassword(input.password, salt, params);
    const expected = user?.passwordHash ?? attempt.replace(/./g, "0");

    const a = Buffer.from(attempt, "hex");
    const b = Buffer.from(expected, "hex");
    const matches = user !== undefined && a.length === b.length && timingSafeEqual(a, b);
    if (!matches) {
      return { ok: false, error: { kind: "invalid_credentials", detail: "Email or password is not right." } };
    }

    const token = randomBytes(32).toString("hex");
    await this.db.query(
      "insert into auth_sessions (token_hash, user_id, issued_at, expires_at) values ($1, $2, $3, $4)",
      [tokenHashOf(token), user.id, new Date(input.now).toISOString(), new Date(input.now + SESSION_TTL_MS).toISOString()],
    );
    return { ok: true, value: { token, user: publicUser(user) } };
  }

  /** Null for an address with no account, and the caller answers the same either way -
   *  saying "no such user" turns the reset form into the account-enumeration oracle
   *  `login` is careful not to be. */
  async requestReset(email: string, now: number): Promise<string | null> {
    const found = await this.db.query<{ id: string }>(
      "select id from auth_users where email = $1", [normaliseEmail(email)],
    );
    const id = found.rows[0]?.id;
    if (id === undefined) return null;

    const token = randomBytes(32).toString("hex");
    await this.db.query(
      "insert into auth_reset_tokens (token_hash, user_id, expires_at, used_at) values ($1, $2, $3, null)",
      [tokenHashOf(token), id, new Date(now + RESET_TTL_MS).toISOString()],
    );
    return token;
  }

  /**
   * Single use, and every live session for the account is dropped - signing out
   * everywhere is the point of a reset rather than a side effect of it.
   *
   * ONE TRANSACTION, AND THE TOKEN ROW IS LOCKED BEFORE IT IS READ. `AuthStore` does
   * this check-then-mark in one synchronous method, so nothing can interleave. Two
   * connections can: without `for update`, two requests carrying the same token both
   * read `used_at` as null, both pass, and a single-use token has been used twice -
   * which for a credential-recovery flow means the second holder of a leaked link
   * still gets in after the first has already reset the password.
   */
  async resetPassword(token: string, newPassword: string, now: number): Promise<AuthResult<PublicUser>> {
    const badToken: AuthResult<PublicUser> = {
      ok: false,
      error: { kind: "bad_reset_token", detail: "That reset link is not valid, or it has already been used." },
    };

    return withTransaction<AuthResult<PublicUser>>(async (client) => {
      const found = await client.query<ResetRow>(
        "select token_hash, user_id, expires_at, used_at from auth_reset_tokens where token_hash = $1 for update",
        [tokenHashOf(token)],
      );
      const row = found.rows[0];
      if (row === undefined || row.used_at !== null || Date.parse(row.expires_at) <= now) return badToken;
      if (newPassword.length < MIN_PASSWORD) {
        return { ok: false, error: { kind: "weak_password", detail: `Use at least ${MIN_PASSWORD} characters.` } };
      }

      const salt = randomBytes(SALT_LEN).toString("hex");
      const params = freshParams();
      const updated = await client.query<UserRow>(
        `update auth_users set password_hash = $2, salt = $3, scrypt_n = $4, scrypt_r = $5, scrypt_p = $6, key_len = $7
         where id = $1 returning ${userColumns()}`,
        [row.user_id, hashPassword(newPassword, salt, params), salt, params.N, params.r, params.p, params.keyLen],
      );
      const user = updated.rows[0];
      // Unreachable while `auth_reset_tokens.user_id` cascades from `auth_users`: the
      // token row cannot outlive its account. Kept so both stores answer the same way
      // if that ever stops being true.
      if (user === undefined) {
        return { ok: false, error: { kind: "bad_reset_token", detail: "That reset link is not valid." } };
      }

      await client.query("update auth_reset_tokens set used_at = $2 where token_hash = $1",
        [row.token_hash, new Date(now).toISOString()]);
      await client.query("delete from auth_sessions where user_id = $1", [row.user_id]);
      return { ok: true, value: publicUser(userFrom(user)) };
    }, this.db);
  }

  /**
   * EXPIRY IS COMPARED IN JAVASCRIPT, AGAINST THE CALLER'S CLOCK.
   *
   * `expires_at` arrives as an ISO string because `db.ts` installs a timestamptz
   * parser that makes it one. Hand `Date.parse` the `Date` that `pg` returns by
   * default and it does not throw - it stringifies it and parses that, which on V8
   * silently truncates the expiry to the second below (measured: a session one
   * millisecond short of expiry resolves as `session_expired`), and on an engine that
   * does not parse that format at all returns `NaN`, at which point every comparison
   * is false and no session ever expires. The first direction turns people away early;
   * the second is an authentication check that fails open. The test asserts the
   * millisecond either side of the boundary, which is what catches both.
   *
   * `now()` in SQL would sidestep the parser and be wrong for a different reason:
   * every caller supplies its own clock, and this is the check that decides whether
   * somebody is signed in.
   */
  async resolve(token: string | null, now: number): Promise<AuthResult<PublicUser>> {
    if (token === null || token.trim() === "") {
      return { ok: false, error: { kind: "no_session", detail: "Sign in first." } };
    }
    const hash = tokenHashOf(token);
    // The join covers `AuthStore`'s "session exists but the user is gone" branch: the
    // cascade means it cannot happen, and if it did the row simply would not match,
    // which is the same `no_session` that branch returns.
    const found = await this.db.query<UserRow & SessionRow>(
      `select s.expires_at, ${userColumns("u.")}
       from auth_sessions s join auth_users u on u.id = s.user_id
       where s.token_hash = $1`,
      [hash],
    );
    const row = found.rows[0];
    if (row === undefined) {
      return { ok: false, error: { kind: "no_session", detail: "Sign in first." } };
    }
    if (Date.parse(row.expires_at) <= now) {
      await this.db.query("delete from auth_sessions where token_hash = $1", [hash]);
      return { ok: false, error: { kind: "session_expired", detail: "That session has expired. Sign in again." } };
    }
    return { ok: true, value: publicUser(userFrom(row)) };
  }

  async logout(token: string): Promise<void> {
    await this.db.query("delete from auth_sessions where token_hash = $1", [tokenHashOf(token)]);
  }

  async findByEmail(email: string): Promise<PublicUser | null> {
    const found = await this.db.query<UserRow>(
      `select ${userColumns()} from auth_users where email = $1`, [normaliseEmail(email)],
    );
    const row = found.rows[0];
    return row === undefined ? null : publicUser(userFrom(row));
  }

  async get(id: string): Promise<PublicUser | null> {
    const found = await this.db.query<UserRow>(
      `select ${userColumns()} from auth_users where id = $1`, [id],
    );
    const row = found.rows[0];
    return row === undefined ? null : publicUser(userFrom(row));
  }

  /** `collate "C"` so this matches `AuthStore.list`'s JavaScript comparison rather than
   *  whatever `lc_collate` the cluster was created with. */
  async list(): Promise<PublicUser[]> {
    const found = await this.db.query<UserRow>(
      `select ${userColumns()} from auth_users order by email collate "C"`,
    );
    return found.rows.map((r) => publicUser(userFrom(r)));
  }

  /** Swept in SQL rather than row by row: this runs on every login, and pulling every
   *  session in the deployment across the wire to filter them here would make the
   *  sweep more expensive than the login. The comparison is the same one - `<=` against
   *  the caller's clock, passed as the ISO string the column already holds. */
  async pruneExpired(now: number): Promise<number> {
    const dropped = await this.db.query(
      "delete from auth_sessions where expires_at <= $1", [new Date(now).toISOString()],
    );
    return dropped.rowCount ?? 0;
  }
}
