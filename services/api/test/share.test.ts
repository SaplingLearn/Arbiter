import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveToken, shareSecret, verifyToken, ShareStore, type ShareLink } from "../share.js";

const SECRET = "0123456789abcdef0123456789abcdef";

const link = (over: Partial<ShareLink> = {}): ShareLink => ({
  caseId: "c1", version: 1, createdBy: "u-own",
  createdAt: "2026-08-17T10:00:00.000Z", revokedAt: null, ...over,
});

describe("the share secret", () => {
  it("is absent rather than an error when nothing is configured", () => {
    expect(shareSecret({})).toBeNull();
  });

  it("refuses a secret too short to be unguessable, naming the variable", () => {
    expect(() => shareSecret({ ARBITER_SHARE_SECRET: "short" }))
      .toThrow(/ARBITER_SHARE_SECRET/);
  });

  it("accepts a secret at the floor", () => {
    expect(shareSecret({ ARBITER_SHARE_SECRET: SECRET })).toBe(SECRET);
  });
});

describe("deriving a token", () => {
  it("is stable, so the QR can be re-rendered without storing anything", () => {
    expect(deriveToken(SECRET, "c1", 1)).toBe(deriveToken(SECRET, "c1", 1));
  });

  it("differs per case, so one link cannot open another record", () => {
    expect(deriveToken(SECRET, "c1", 1)).not.toBe(deriveToken(SECRET, "c2", 1));
  });

  it("differs per version, which is what makes revocation reach printed paper", () => {
    expect(deriveToken(SECRET, "c1", 1)).not.toBe(deriveToken(SECRET, "c1", 2));
  });

  it("is URL-safe, because it travels in a path segment and a QR", () => {
    expect(deriveToken(SECRET, "c1", 1)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("verifying a token", () => {
  it("accepts the token derived for the link's current version", () => {
    expect(verifyToken(SECRET, link(), deriveToken(SECRET, "c1", 1))).toBe(true);
  });

  it("rejects a token from a previous version", () => {
    expect(verifyToken(SECRET, link({ version: 2 }), deriveToken(SECRET, "c1", 1))).toBe(false);
  });

  it("rejects every token when there is no link at all", () => {
    expect(verifyToken(SECRET, null, deriveToken(SECRET, "c1", 1))).toBe(false);
  });

  // revokedAt is checked BEFORE the token, so a revoked row rejects even its own token.
  it("rejects a revoked link holding its own live token", () => {
    const revoked = link({ revokedAt: "2026-08-17T11:00:00.000Z" });
    expect(verifyToken(SECRET, revoked, deriveToken(SECRET, "c1", 1))).toBe(false);
  });

  it("rejects a malformed token without throwing", () => {
    expect(verifyToken(SECRET, link(), "!!!!")).toBe(false);
    expect(verifyToken(SECRET, link(), "")).toBe(false);
  });
});

describe("the share store", () => {
  it("has no link for a case nobody published", () => {
    expect(new ShareStore().get("c1")).toBeNull();
  });

  it("publishes at version 1", () => {
    const s = new ShareStore();
    const l = s.publish("c1", "u-own", "2026-08-17T10:00:00.000Z");
    expect(l.version).toBe(1);
    expect(l.revokedAt).toBeNull();
    expect(l.createdBy).toBe("u-own");
  });

  it("returns the same link when publishing an already-published case, so the printed QR keeps working", () => {
    const s = new ShareStore();
    const first = s.publish("c1", "u-own", "2026-08-17T10:00:00.000Z");
    const again = s.publish("c1", "u-own", "2026-08-17T12:00:00.000Z");
    expect(again.version).toBe(first.version);
    expect(again.createdAt).toBe(first.createdAt);
  });

  it("revoking bumps the version and stamps the time", () => {
    const s = new ShareStore();
    s.publish("c1", "u-own", "2026-08-17T10:00:00.000Z");
    const revoked = s.revoke("c1", "2026-08-17T11:00:00.000Z");
    expect(revoked?.version).toBe(2);
    expect(revoked?.revokedAt).toBe("2026-08-17T11:00:00.000Z");
  });

  it("republishing after a revoke mints a different token, and the dead one stays dead", () => {
    const s = new ShareStore();
    s.publish("c1", "u-own", "2026-08-17T10:00:00.000Z");
    const dead = deriveToken(SECRET, "c1", 1);
    s.revoke("c1", "2026-08-17T11:00:00.000Z");
    const fresh = s.publish("c1", "u-own", "2026-08-17T12:00:00.000Z");

    expect(fresh.revokedAt).toBeNull();
    expect(fresh.version).toBe(2);
    expect(verifyToken(SECRET, fresh, dead)).toBe(false);
    expect(verifyToken(SECRET, fresh, deriveToken(SECRET, "c1", 2))).toBe(true);
  });

  it("revoking a case nobody published is not an error", () => {
    expect(new ShareStore().revoke("c1", "2026-08-17T11:00:00.000Z")).toBeNull();
  });

  // Every construction elsewhere in this file passes no path, so `mkdirSync`,
  // `readFileSync`, `writeFileSync` and the on-disk `{links: [...]}` shape were never
  // exercised - a break in any of them would drop every published link on the next
  // redeploy, silently, and a printed QR outlives the process that minted it. Same
  // shape as `AuthStore`'s and `InviteStore`'s own restart tests (auth.test.ts,
  // invites.test.ts): write through a real path, read the file back directly to pin
  // its shape, then construct a second store from the same path and confirm the link
  // - and the token it derives - survived the process boundary.
  it("survives a restart, so a printed QR still resolves after a redeploy", () => {
    const path = join(mkdtempSync(join(tmpdir(), "arb-share-")), "shares.json");
    const first = new ShareStore(path);
    first.publish("c1", "u-own", "2026-08-17T10:00:00.000Z");

    const onDisk = JSON.parse(readFileSync(path, "utf8")) as { links: ShareLink[] };
    expect(onDisk.links).toHaveLength(1);
    expect(onDisk.links[0]?.caseId).toBe("c1");

    const second = new ShareStore(path);
    const link = second.get("c1");
    expect(link).not.toBeNull();
    expect(verifyToken(SECRET, link, deriveToken(SECRET, "c1", 1))).toBe(true);
  });
});
