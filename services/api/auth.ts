import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Accounts and sessions. Spec §3.3 — the identity row, built for real.
 *
 * WHAT THIS REPLACES. Until now identity was an `x-arbiter-user` header the server
 * took at its word, which meant the blindness guarantee held against the UI and
 * against an honest participant, and against nobody else. This closes that: a
 * position is now attributable to someone who proved they hold a password.
 *
 * NO DEPENDENCIES, DELIBERATELY. Password hashing is the one place where reaching
 * for a library is usually right, and `node:crypto`'s scrypt is the exception — it
 * IS the recommended primitive, it is in the standard library, and adding an
 * unaudited transitive dependency tree to a project that will hold unpublished
 * safety data is the worse trade.
 *
 * WHAT IS DELIBERATELY NOT HERE, so nobody assumes it: no password reset, no email
 * verification, no rate limiting, no lockout, no MFA. Each needs a mail path or a
 * shared cache this project does not have, and a half-built reset flow is a
 * credential-recovery hole rather than a feature. `signatureMethod` carries
 * `password` today and `sso` is the intended replacement for all of it.
 */

/** Cost parameters. N=2^15 is the current OWASP floor for scrypt; r and p are the
 *  standard pairing. Stored per-record so raising them later does not invalidate
 *  every existing password — an old hash verifies under its own parameters. */
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

/** Sessions last a working day. Long enough that a deliberation is not interrupted
 *  half way through, short enough that a shared machine does not stay authenticated
 *  overnight. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type SignatureMethod = "password" | "sso";

export interface User {
  id: string;
  email: string;
  displayName: string;
  /** scrypt(password, salt) — the password itself is never stored or logged. */
  passwordHash: string;
  salt: string;
  params: { N: number; r: number; p: number; keyLen: number };
  signatureMethod: SignatureMethod;
  createdAt: string;
}

export interface Session {
  /** SHA-256 of the bearer token. The token itself is never stored: a leaked user
   *  file must not hand the reader a working session, only the useless digest of
   *  one. Same reasoning as storing a password hash rather than a password. */
  tokenHash: string;
  userId: string;
  issuedAt: string;
  expiresAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  signatureMethod: SignatureMethod;
}

export function publicUser(u: User): PublicUser {
  return { id: u.id, email: u.email, displayName: u.displayName, signatureMethod: u.signatureMethod };
}

/**
 * scrypt needs roughly `128 * N * r` bytes, and Node caps it at 32 MB by default.
 * At the N chosen above that is 33.5 MB, so the default cap rejects the parameters
 * outright with `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`.
 *
 * DERIVED, not a constant. Writing `maxmem: 64 * 1024 * 1024` would work today and
 * break silently the next time somebody raises N — which is exactly the change the
 * per-record `params` field exists to make easy. Doubling gives headroom without
 * handing the process an unbounded allocation.
 */
function maxmemFor(params: User["params"]): number {
  return 2 * 128 * params.N * params.r;
}

function hashPassword(password: string, salt: string, params: User["params"]): string {
  return scryptSync(password, salt, params.keyLen, {
    N: params.N, r: params.r, p: params.p, maxmem: maxmemFor(params),
  }).toString("hex");
}

export function tokenHashOf(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Normalised so "Ann@Lab.com " and "ann@lab.com" are one account rather than two
 *  people who cannot see each other's cases. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type AuthErrorKind =
  | "email_taken"
  | "invalid_credentials"
  | "weak_password"
  | "bad_email"
  | "no_session"
  | "session_expired";

export interface AuthError {
  kind: AuthErrorKind;
  detail: string;
}

export type AuthResult<T> = { ok: true; value: T } | { ok: false; error: AuthError };

/**
 * Twelve characters, and no composition rules.
 *
 * Length is the property that actually resists an offline attack against a stolen
 * hash. Requiring a symbol and a digit produces `Password1!` and a false sense of
 * having done something, which is why current NIST guidance drops composition rules
 * and keeps a length floor.
 */
const MIN_PASSWORD = 12;

export class AuthStore {
  private users = new Map<string, User>();
  private byEmail = new Map<string, string>();
  private sessions = new Map<string, Session>();

  constructor(private readonly path: string | null = null) {
    if (path !== null && existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { users: User[]; sessions: Session[] };
      for (const u of raw.users) {
        this.users.set(u.id, u);
        this.byEmail.set(u.email, u.id);
      }
      // Sessions survive a restart on purpose: restarting the service should not
      // sign everybody out mid-deliberation. They still expire on their own clock.
      for (const s of raw.sessions) this.sessions.set(s.tokenHash, s);
    } else if (path !== null) {
      mkdirSync(dirname(path), { recursive: true });
    }
  }

  private persist(): void {
    if (this.path === null) return;
    writeFileSync(this.path, JSON.stringify({
      users: [...this.users.values()],
      sessions: [...this.sessions.values()],
    }, null, 2), "utf8");
  }

  register(input: { email: string; displayName: string; password: string; now: number }): AuthResult<PublicUser> {
    const email = normaliseEmail(input.email);
    // Deliberately permissive: the only thing worth checking here is that it looks
    // like an address at all. Elaborate email regexes reject valid addresses and
    // that failure lands on a real person who cannot sign up.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: { kind: "bad_email", detail: "That does not look like an email address." } };
    }
    if (input.password.length < MIN_PASSWORD) {
      return { ok: false, error: { kind: "weak_password", detail: `Use at least ${MIN_PASSWORD} characters. Length is what protects a stolen hash; there are no symbol or digit rules.` } };
    }
    if (this.byEmail.has(email)) {
      return { ok: false, error: { kind: "email_taken", detail: "An account already exists for that address." } };
    }

    const salt = randomBytes(SALT_LEN).toString("hex");
    const params = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, keyLen: KEY_LEN };
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
    this.users.set(user.id, user);
    this.byEmail.set(email, user.id);
    this.persist();
    return { ok: true, value: publicUser(user) };
  }

  /**
   * One error for a wrong address and a wrong password, on purpose: distinguishing
   * them tells an attacker which addresses are registered.
   *
   * The comparison is timing-safe, and a miss still runs a hash. Returning early on
   * an unknown address makes "no such user" measurably faster than "wrong password",
   * which leaks the same fact through the clock instead of through the message.
   */
  login(input: { email: string; password: string; now: number }): AuthResult<{ token: string; user: PublicUser }> {
    const email = normaliseEmail(input.email);
    const userId = this.byEmail.get(email);
    const user = userId === undefined ? undefined : this.users.get(userId);

    const decoyParams = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, keyLen: KEY_LEN };
    const salt = user?.salt ?? "0".repeat(SALT_LEN * 2);
    const params = user?.params ?? decoyParams;
    const attempt = hashPassword(input.password, salt, params);
    const expected = user?.passwordHash ?? attempt.replace(/./g, "0");

    const a = Buffer.from(attempt, "hex");
    const b = Buffer.from(expected, "hex");
    const matches = user !== undefined && a.length === b.length && timingSafeEqual(a, b);
    if (!matches) {
      return { ok: false, error: { kind: "invalid_credentials", detail: "Email or password is not right." } };
    }

    const token = randomBytes(32).toString("hex");
    const session: Session = {
      tokenHash: tokenHashOf(token),
      userId: user.id,
      issuedAt: new Date(input.now).toISOString(),
      expiresAt: new Date(input.now + SESSION_TTL_MS).toISOString(),
    };
    this.sessions.set(session.tokenHash, session);
    this.persist();
    return { ok: true, value: { token, user: publicUser(user) } };
  }

  resolve(token: string | null, now: number): AuthResult<PublicUser> {
    if (token === null || token.trim() === "") {
      return { ok: false, error: { kind: "no_session", detail: "Sign in first." } };
    }
    const session = this.sessions.get(tokenHashOf(token));
    if (session === undefined) {
      return { ok: false, error: { kind: "no_session", detail: "Sign in first." } };
    }
    if (Date.parse(session.expiresAt) <= now) {
      this.sessions.delete(session.tokenHash);
      this.persist();
      return { ok: false, error: { kind: "session_expired", detail: "That session has expired. Sign in again." } };
    }
    const user = this.users.get(session.userId);
    if (user === undefined) {
      return { ok: false, error: { kind: "no_session", detail: "Sign in first." } };
    }
    return { ok: true, value: publicUser(user) };
  }

  logout(token: string): void {
    this.sessions.delete(tokenHashOf(token));
    this.persist();
  }

  findByEmail(email: string): PublicUser | null {
    const id = this.byEmail.get(normaliseEmail(email));
    const u = id === undefined ? undefined : this.users.get(id);
    return u === undefined ? null : publicUser(u);
  }

  get(id: string): PublicUser | null {
    const u = this.users.get(id);
    return u === undefined ? null : publicUser(u);
  }

  list(): PublicUser[] {
    return [...this.users.values()].map(publicUser).sort((a, b) => (a.email < b.email ? -1 : 1));
  }

  /** Sessions whose clock has run out, dropped on demand. Called on login so the
   *  file does not grow without bound on a long-lived server. */
  pruneExpired(now: number): number {
    let dropped = 0;
    for (const [hash, s] of this.sessions) {
      if (Date.parse(s.expiresAt) <= now) {
        this.sessions.delete(hash);
        dropped++;
      }
    }
    if (dropped > 0) this.persist();
    return dropped;
  }
}
