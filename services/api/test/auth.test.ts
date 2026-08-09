import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStore, SESSION_TTL_MS, normaliseEmail, tokenHashOf } from "../auth.js";
import { DEMO_PASSWORD, DEMO_TEAM, seedDemoTeam } from "../seed-demo.js";

const T0 = Date.parse("2026-08-09T09:00:00Z");
const GOOD = "correct-horse-battery";

const store = (): AuthStore => new AuthStore(null);

const withUser = (): { auth: AuthStore } => {
  const auth = store();
  const r = auth.register({ email: "Ann@Lab.COM ", displayName: "Ann", password: GOOD, now: T0 });
  if (!r.ok) throw new Error(r.error.detail);
  return { auth };
};

describe("register", () => {
  it("creates an account and never returns the password or its hash", () => {
    const { auth } = withUser();
    const u = auth.findByEmail("ann@lab.com")!;
    expect(u.displayName).toBe("Ann");
    // PublicUser is the only shape that leaves this module.
    expect(Object.keys(u).sort()).toEqual(["displayName", "email", "id", "signatureMethod"]);
    expect(JSON.stringify(u)).not.toContain(GOOD);
  });

  it("normalises the address, so one person is not two accounts", () => {
    const { auth } = withUser();
    expect(normaliseEmail(" ANN@lab.com ")).toBe("ann@lab.com");
    const again = auth.register({ email: "ann@LAB.com", displayName: "Ann again", password: GOOD, now: T0 });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.kind).toBe("email_taken");
  });

  it("requires length and imposes no composition rules", () => {
    // Length is what resists an offline attack on a stolen hash. Composition rules
    // produce Password1! and a false sense of having done something.
    const auth = store();
    const short = auth.register({ email: "a@b.co", displayName: "", password: "short", now: T0 });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error.kind).toBe("weak_password");

    const lowercaseOnly = auth.register({ email: "a@b.co", displayName: "", password: "abcdefghijklmno", now: T0 });
    expect(lowercaseOnly.ok).toBe(true);
  });

  it("rejects something that is not an address", () => {
    const auth = store();
    const r = auth.register({ email: "not-an-address", displayName: "", password: GOOD, now: T0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("bad_email");
  });

  it("falls back to the address when no display name is given", () => {
    const auth = store();
    auth.register({ email: "a@b.co", displayName: "   ", password: GOOD, now: T0 });
    expect(auth.findByEmail("a@b.co")?.displayName).toBe("a@b.co");
  });

  it("salts per account, so two identical passwords do not share a hash", () => {
    const auth = store();
    auth.register({ email: "a@b.co", displayName: "A", password: GOOD, now: T0 });
    auth.register({ email: "c@d.co", displayName: "C", password: GOOD, now: T0 });
    const path = join(mkdtempSync(join(tmpdir(), "arb-auth-")), "users.json");
    const persisted = new AuthStore(path);
    persisted.register({ email: "a@b.co", displayName: "A", password: GOOD, now: T0 });
    persisted.register({ email: "c@d.co", displayName: "C", password: GOOD, now: T0 });
    const raw = JSON.parse(readFileSync(path, "utf8")) as { users: { passwordHash: string; salt: string }[] };
    expect(raw.users[0]!.salt).not.toBe(raw.users[1]!.salt);
    expect(raw.users[0]!.passwordHash).not.toBe(raw.users[1]!.passwordHash);
  });
});

describe("login", () => {
  it("issues a token for the right password", () => {
    const { auth } = withUser();
    const r = auth.login({ email: "ann@lab.com", password: GOOD, now: T0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives the same error for a wrong password and an unknown address", () => {
    // Distinguishing them tells an attacker which addresses are registered.
    const { auth } = withUser();
    const wrongPassword = auth.login({ email: "ann@lab.com", password: "wrong-but-long-enough", now: T0 });
    const noSuchUser = auth.login({ email: "nobody@lab.com", password: GOOD, now: T0 });
    expect(wrongPassword.ok).toBe(false);
    expect(noSuchUser.ok).toBe(false);
    if (!wrongPassword.ok && !noSuchUser.ok) {
      expect(wrongPassword.error).toEqual(noSuchUser.error);
    }
  });

  it("issues a different token every time", () => {
    const { auth } = withUser();
    const a = auth.login({ email: "ann@lab.com", password: GOOD, now: T0 });
    const b = auth.login({ email: "ann@lab.com", password: GOOD, now: T0 });
    if (a.ok && b.ok) expect(a.value.token).not.toBe(b.value.token);
  });
});

describe("sessions", () => {
  it("resolves a live token to the account", () => {
    const { auth } = withUser();
    const login = auth.login({ email: "ann@lab.com", password: GOOD, now: T0 });
    if (!login.ok) throw new Error("expected login");
    const r = auth.resolve(login.value.token, T0 + 1000);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.email).toBe("ann@lab.com");
  });

  it("expires on its own clock", () => {
    const { auth } = withUser();
    const login = auth.login({ email: "ann@lab.com", password: GOOD, now: T0 });
    if (!login.ok) throw new Error("expected login");
    const r = auth.resolve(login.value.token, T0 + SESSION_TTL_MS + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("session_expired");
  });

  it("rejects an absent, empty or invented token", () => {
    const { auth } = withUser();
    for (const t of [null, "", "   ", "deadbeef"]) {
      const r = auth.resolve(t, T0);
      expect(r.ok).toBe(false);
    }
  });

  it("stops resolving after logout", () => {
    const { auth } = withUser();
    const login = auth.login({ email: "ann@lab.com", password: GOOD, now: T0 });
    if (!login.ok) throw new Error("expected login");
    auth.logout(login.value.token);
    expect(auth.resolve(login.value.token, T0).ok).toBe(false);
  });

  it("stores only the token's digest, so a stolen file yields no session", () => {
    const path = join(mkdtempSync(join(tmpdir(), "arb-auth-")), "users.json");
    const auth = new AuthStore(path);
    auth.register({ email: "a@b.co", displayName: "A", password: GOOD, now: T0 });
    const login = auth.login({ email: "a@b.co", password: GOOD, now: T0 });
    if (!login.ok) throw new Error("expected login");

    const text = readFileSync(path, "utf8");
    expect(text).not.toContain(login.value.token);
    expect(text).toContain(tokenHashOf(login.value.token));
  });

  it("survives a restart, because restarting should not sign everyone out mid-case", () => {
    const path = join(mkdtempSync(join(tmpdir(), "arb-auth-")), "users.json");
    const first = new AuthStore(path);
    first.register({ email: "a@b.co", displayName: "A", password: GOOD, now: T0 });
    const login = first.login({ email: "a@b.co", password: GOOD, now: T0 });
    if (!login.ok) throw new Error("expected login");

    const second = new AuthStore(path);
    expect(second.resolve(login.value.token, T0 + 60_000).ok).toBe(true);
  });

  it("prunes expired sessions on demand", () => {
    const { auth } = withUser();
    auth.login({ email: "ann@lab.com", password: GOOD, now: T0 });
    expect(auth.pruneExpired(T0 + SESSION_TTL_MS + 1)).toBe(1);
    expect(auth.pruneExpired(T0 + SESSION_TTL_MS + 1)).toBe(0);
  });
});

describe("the demo team", () => {
  it("seeds five real accounts that log in through the ordinary path", () => {
    const auth = store();
    const report = seedDemoTeam(auth, T0);
    expect(report.created).toHaveLength(5);
    for (const person of DEMO_TEAM) {
      const r = auth.login({ email: person.email, password: DEMO_PASSWORD, now: T0 });
      expect(r.ok, person.email).toBe(true);
    }
  });

  it("is idempotent, so re-running it does not fail or duplicate", () => {
    const auth = store();
    seedDemoTeam(auth, T0);
    const again = seedDemoTeam(auth, T0);
    expect(again.created).toHaveLength(0);
    expect(again.alreadyPresent).toHaveLength(5);
    expect(auth.list()).toHaveLength(5);
  });

  it("still refuses the wrong password - the fixture is the secrecy, not the check", () => {
    const auth = store();
    seedDemoTeam(auth, T0);
    expect(auth.login({ email: DEMO_TEAM[0].email, password: "not-the-password", now: T0 }).ok).toBe(false);
  });
});
