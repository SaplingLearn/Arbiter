import { describe, expect, it } from "vitest";
import { RESET_TTL_MS, SESSION_TTL_MS } from "../auth.js";
import type { AuthStoreApi } from "../postgres-auth.js";

/**
 * One suite, run against `AuthStore` and against `PostgresAuthStore`.
 *
 * WHY IT IS SHARED RATHER THAN COPIED. The file store is the only oracle for what the
 * Postgres store is supposed to do - there is no specification of the auth behaviour
 * anywhere else, and the product's answer to "what happens when a reset token is used
 * twice" is whatever `auth.ts` does. Two hand-written copies of these assertions would
 * agree on the day they were written and drift the first time one is corrected. Run
 * from one place, a difference between the implementations is a failure rather than a
 * discrepancy nobody reads.
 *
 * `T0` CARRIES A HALF-SECOND ON PURPOSE. Session expiry is compared with `Date.parse`
 * against an ISO string, and the whole reason `db.ts` installs a timestamptz parser is
 * that `pg` otherwise hands back a `Date`, which that comparison degrades to
 * second-granularity (V8 parses `Date.prototype.toString`, losing the milliseconds) or
 * to `NaN` (any engine that does not, at which point every expired session reads as
 * live). A clock landing exactly on a second would hide both. The boundary tests below
 * check the millisecond either side, and were run against a pool with the parser
 * removed to confirm they fail without it.
 */

export const T0 = Date.parse("2026-08-09T09:00:00.500Z");
export const GOOD = "correct-horse-battery";

/** Registers one account and fails the test rather than the assertion if it did not
 *  take - a suite whose fixture quietly returned an error reports the wrong failure. */
export async function register(store: AuthStoreApi, email = "Ann@Lab.COM ", password = GOOD): Promise<string> {
  const r = await store.register({ email, displayName: "Ann", password, now: T0 });
  if (!r.ok) throw new Error(`fixture: register failed with ${r.error.kind}`);
  return r.value.id;
}

export async function loginToken(store: AuthStoreApi, email = "ann@lab.com", password = GOOD, now = T0): Promise<string> {
  const r = await store.login({ email, password, now });
  if (!r.ok) throw new Error(`fixture: login failed with ${r.error.kind}`);
  return r.value.token;
}

export function authStoreBehaviour(make: () => Promise<AuthStoreApi>): void {
  describe("register", () => {
    it("creates an account and returns only the public projection", async () => {
      const store = await make();
      await register(store);
      const u = (await store.findByEmail("ann@lab.com"))!;
      expect(u.displayName).toBe("Ann");
      expect(u.email).toBe("ann@lab.com");
      expect(u.signatureMethod).toBe("password");
      expect(Object.keys(u).sort()).toEqual(["displayName", "email", "id", "signatureMethod"]);
      expect(JSON.stringify(u)).not.toContain(GOOD);
    });

    it("normalises the address, so one person is not two accounts", async () => {
      const store = await make();
      await register(store, "Ann@Lab.COM ");
      const again = await store.register({ email: "ann@LAB.com", displayName: "Ann again", password: GOOD, now: T0 });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.kind).toBe("email_taken");
      expect(await store.list()).toHaveLength(1);
    });

    it("requires length and imposes no composition rules", async () => {
      const store = await make();
      const short = await store.register({ email: "a@b.co", displayName: "", password: "short", now: T0 });
      expect(short.ok).toBe(false);
      if (!short.ok) expect(short.error.kind).toBe("weak_password");
      expect(await store.findByEmail("a@b.co")).toBeNull();

      const lowercaseOnly = await store.register({ email: "a@b.co", displayName: "", password: "abcdefghijklmno", now: T0 });
      expect(lowercaseOnly.ok).toBe(true);
    });

    it("rejects something that is not an address", async () => {
      const store = await make();
      const r = await store.register({ email: "not-an-address", displayName: "", password: GOOD, now: T0 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("bad_email");
    });

    it("falls back to the address when no display name is given", async () => {
      const store = await make();
      await store.register({ email: "a@b.co", displayName: "   ", password: GOOD, now: T0 });
      expect((await store.findByEmail("a@b.co"))?.displayName).toBe("a@b.co");
    });
  });

  describe("login", () => {
    it("issues a token for the right password", async () => {
      const store = await make();
      await register(store);
      const r = await store.login({ email: "ann@lab.com", password: GOOD, now: T0 });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.token).toMatch(/^[0-9a-f]{64}$/);
        expect(r.value.user.email).toBe("ann@lab.com");
      }
    });

    it("gives the same error for a wrong password and an unknown address", async () => {
      const store = await make();
      await register(store);
      const wrongPassword = await store.login({ email: "ann@lab.com", password: "wrong-but-long-enough", now: T0 });
      const noSuchUser = await store.login({ email: "nobody@lab.com", password: GOOD, now: T0 });
      expect(wrongPassword.ok).toBe(false);
      expect(noSuchUser.ok).toBe(false);
      if (!wrongPassword.ok && !noSuchUser.ok) expect(wrongPassword.error).toEqual(noSuchUser.error);
    });

    it("issues a different token every time", async () => {
      const store = await make();
      await register(store);
      const a = await loginToken(store);
      const b = await loginToken(store);
      expect(a).not.toBe(b);
      expect((await store.resolve(a, T0 + 1000)).ok).toBe(true);
      expect((await store.resolve(b, T0 + 1000)).ok).toBe(true);
    });
  });

  describe("sessions", () => {
    it("resolves a live token to the account", async () => {
      const store = await make();
      await register(store);
      const r = await store.resolve(await loginToken(store), T0 + 1000);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.email).toBe("ann@lab.com");
    });

    it("reports a session that ran out in the past as expired, not as live", async () => {
      // The failure this is here for is an authentication check that fails OPEN: a
      // session issued days ago resolving to its account because the expiry comparison
      // silently produced NaN. Asserting that a live session is live would not have
      // caught it.
      const store = await make();
      await register(store);
      const token = await loginToken(store);
      const r = await store.resolve(token, T0 + SESSION_TTL_MS + 7 * 24 * 60 * 60 * 1000);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("session_expired");
    });

    it("expires on the caller's clock, to the millisecond", async () => {
      // One millisecond either side of the boundary. A timestamp that has lost its
      // milliseconds on the way out of the store - which is what an unparsed `Date`
      // costs - fails the first of these two.
      const live = await make();
      await register(live);
      expect((await live.resolve(await loginToken(live), T0 + SESSION_TTL_MS - 1)).ok).toBe(true);

      const dead = await make();
      await register(dead);
      const r = await dead.resolve(await loginToken(dead), T0 + SESSION_TTL_MS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("session_expired");
    });

    it("forgets the session it found expired, so the second look reports no session", async () => {
      const store = await make();
      await register(store);
      const token = await loginToken(store);
      const first = await store.resolve(token, T0 + SESSION_TTL_MS + 1);
      const second = await store.resolve(token, T0 + SESSION_TTL_MS + 1);
      expect(first.ok || second.ok).toBe(false);
      if (!first.ok) expect(first.error.kind).toBe("session_expired");
      if (!second.ok) expect(second.error.kind).toBe("no_session");
    });

    it("rejects an absent, empty or invented token", async () => {
      const store = await make();
      for (const t of [null, "", "   ", "deadbeef"]) {
        const r = await store.resolve(t, T0);
        expect(r.ok, `token ${JSON.stringify(t)}`).toBe(false);
        if (!r.ok) expect(r.error.kind).toBe("no_session");
      }
    });

    it("stops resolving after logout, and logging out an unissued token is not an error", async () => {
      const store = await make();
      await register(store);
      const token = await loginToken(store);
      await store.logout(token);
      expect((await store.resolve(token, T0)).ok).toBe(false);
      await store.logout("never-issued");
    });

    it("prunes expired sessions, reports how many, and leaves live ones alone", async () => {
      const store = await make();
      await register(store);
      const token = await loginToken(store);
      expect(await store.pruneExpired(T0 + 1000)).toBe(0);
      expect((await store.resolve(token, T0 + 1000)).ok).toBe(true);
      expect(await store.pruneExpired(T0 + SESSION_TTL_MS + 1)).toBe(1);
      expect(await store.pruneExpired(T0 + SESSION_TTL_MS + 1)).toBe(0);
      expect((await store.resolve(token, T0 + 1000)).ok).toBe(false);
    });
  });

  describe("password reset", () => {
    it("mints a token only for an address that has an account", async () => {
      const store = await make();
      await register(store);
      expect(await store.requestReset("ANN@lab.com", T0)).toMatch(/^[0-9a-f]{64}$/);
      expect(await store.requestReset("nobody@lab.com", T0)).toBeNull();
    });

    it("changes the password, and the old one stops working", async () => {
      const store = await make();
      await register(store);
      const token = (await store.requestReset("ann@lab.com", T0))!;
      const r = await store.resetPassword(token, "a-brand-new-password", T0 + 60_000);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.email).toBe("ann@lab.com");
      expect((await store.login({ email: "ann@lab.com", password: GOOD, now: T0 + 60_000 })).ok).toBe(false);
      expect((await store.login({ email: "ann@lab.com", password: "a-brand-new-password", now: T0 + 60_000 })).ok).toBe(true);
    });

    it("signs every live session out, because the point of a reset is that somebody else may know the old password", async () => {
      const store = await make();
      await register(store);
      const token = await loginToken(store);
      const reset = (await store.requestReset("ann@lab.com", T0))!;
      await store.resetPassword(reset, "a-brand-new-password", T0 + 60_000);
      expect((await store.resolve(token, T0 + 60_000)).ok).toBe(false);
    });

    it("spends the token once", async () => {
      const store = await make();
      await register(store);
      const token = (await store.requestReset("ann@lab.com", T0))!;
      expect((await store.resetPassword(token, "a-brand-new-password", T0 + 60_000)).ok).toBe(true);
      const again = await store.resetPassword(token, "another-new-password", T0 + 60_000);
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.kind).toBe("bad_reset_token");
    });

    it("refuses a token that has run out of time", async () => {
      const store = await make();
      await register(store);
      const token = (await store.requestReset("ann@lab.com", T0))!;
      const r = await store.resetPassword(token, "a-brand-new-password", T0 + RESET_TTL_MS);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("bad_reset_token");
    });

    it("refuses a weak new password without spending the token", async () => {
      const store = await make();
      await register(store);
      const token = (await store.requestReset("ann@lab.com", T0))!;
      const weak = await store.resetPassword(token, "short", T0 + 60_000);
      expect(weak.ok).toBe(false);
      if (!weak.ok) expect(weak.error.kind).toBe("weak_password");
      expect((await store.resetPassword(token, "a-brand-new-password", T0 + 60_000)).ok).toBe(true);
    });

    it("refuses a token nobody issued", async () => {
      const store = await make();
      const r = await store.resetPassword("deadbeef", "a-brand-new-password", T0);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("bad_reset_token");
    });
  });

  describe("the directory", () => {
    it("finds an account by address and by id, and returns null for neither", async () => {
      const store = await make();
      const id = await register(store);
      expect((await store.get(id))?.email).toBe("ann@lab.com");
      expect((await store.findByEmail("  ANN@LAB.com "))?.id).toBe(id);
      expect(await store.get("u_nobody")).toBeNull();
      expect(await store.findByEmail("nobody@lab.com")).toBeNull();
    });

    it("lists accounts ordered by address", async () => {
      // The hyphen is the interesting one: JavaScript's `<` compares code units, so
      // `ann-b@` sorts before `annb@`, and a locale-aware collation can disagree. The
      // people list must not depend on which store is behind it.
      const store = await make();
      for (const email of ["annb@lab.com", "ann-b@lab.com", "anna@lab.com"]) {
        await store.register({ email, displayName: email, password: GOOD, now: T0 });
      }
      expect((await store.list()).map((u) => u.email)).toEqual(["ann-b@lab.com", "anna@lab.com", "annb@lab.com"]);
    });

    it("lists nothing on an empty store", async () => {
      expect(await (await make()).list()).toEqual([]);
    });
  });
}
