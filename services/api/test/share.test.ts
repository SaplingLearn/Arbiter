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

/**
 * The store's BEHAVIOUR is in `share-store-contract.ts` and runs from
 * `postgres-share.test.ts` against both implementations. What stays here is the one
 * thing only the file-backed store can be asked: whether a link survives the file.
 */
describe("the file-backed share store", () => {
  // Every other construction of this store passes no path, so `mkdir`, `readFile`,
  // `writeFileSync` and the on-disk `{links: [...]}` shape would otherwise never be
  // exercised - a break in any of them would drop every published link on the next
  // redeploy, silently, and a printed QR outlives the process that minted it. Same
  // shape as `AuthStore`'s and `InviteStore`'s own restart tests (auth.test.ts,
  // invites.test.ts): write through a real path, read the file back directly to pin
  // its shape, then open a second store from the same path and confirm the link - and
  // the token it derives - survived the process boundary.
  it("survives a restart, so a printed QR still resolves after a redeploy", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "arb-share-")), "shares.json");
    const first = await ShareStore.open(path);
    await first.publish("c1", "u-own", "2026-08-17T10:00:00.000Z");

    const onDisk = JSON.parse(readFileSync(path, "utf8")) as { links: ShareLink[] };
    expect(onDisk.links).toHaveLength(1);
    expect(onDisk.links[0]?.caseId).toBe("c1");

    const second = await ShareStore.open(path);
    const link = await second.get("c1");
    expect(link).not.toBeNull();
    expect(verifyToken(SECRET, link, deriveToken(SECRET, "c1", 1))).toBe(true);
  });

  /**
   * THE SECURITY CLAIM, ASSERTED AGAINST THE DEFAULT BACKING.
   *
   * `postgres-share.test.ts` pins this by reading `information_schema.columns` back and
   * demanding exactly five names. Files are what `npm test`, `npm run e2e` and every
   * deployment without `DATABASE_URL` actually run on, so the same claim needs the same
   * kind of assertion here - and against the FILE TEXT rather than against the returned
   * link, because a token cached in a sidecar key would never appear on a `ShareLink` and
   * would pass every other test in this suite.
   *
   * Same shape as `auth.test.ts`'s "stores only the token's digest, so a stolen file
   * yields no session". A working capability URL sitting in
   * `results/deliberation-log.jsonl.shares.json` is exactly what deriving the token
   * instead of storing it exists to prevent.
   */
  it("writes no token and no secret to disk, so a stolen file yields no working link", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "arb-share-")), "shares.json");
    const store = await ShareStore.open(path);
    await store.publish("c1", "u-own", "2026-08-17T10:00:00.000Z");
    await store.revoke("c1", "2026-08-17T11:00:00.000Z");
    await store.publish("c1", "u-own", "2026-08-17T12:00:00.000Z");

    const text = readFileSync(path, "utf8");
    expect(text).not.toContain(SECRET);
    // Every version this case has ever been on, not just the live one: a cache keyed by
    // the dead version is a URL somebody revoked, sitting in a file.
    for (const version of [1, 2, 3]) {
      expect(text, `token for version ${String(version)}`).not.toContain(deriveToken(SECRET, "c1", version));
    }
    // And the five fields that ARE expected, so this cannot pass by the file being empty.
    expect(Object.keys(JSON.parse(text).links[0]).sort())
      .toEqual(["caseId", "createdAt", "createdBy", "revokedAt", "version"]);
  });

  // A revoke is the write whose loss is worst - it is the one that has to reach paper -
  // and it is written by the same whole-file rewrite as a publish.
  it("keeps a revocation across a restart, so a killed QR stays killed", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "arb-share-")), "shares.json");
    const first = await ShareStore.open(path);
    await first.publish("c1", "u-own", "2026-08-17T10:00:00.000Z");
    await first.revoke("c1", "2026-08-17T11:00:00.000Z");

    const link = await (await ShareStore.open(path)).get("c1");
    expect(link!.revokedAt).toBe("2026-08-17T11:00:00.000Z");
    expect(verifyToken(SECRET, link, deriveToken(SECRET, "c1", 1))).toBe(false);
  });

  // Nothing has written the file yet, so `open` has to cope with a directory that does
  // not exist. `buildStores` points this at `results/deliberation-log.jsonl.shares.json`,
  // and a container's first boot has no `results/` at all.
  it("opens against a path in a directory that does not exist yet", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "arb-share-")), "nested", "shares.json");
    const store = await ShareStore.open(path);
    expect(await store.get("c1")).toBeNull();
    await store.publish("c1", "u-own", "2026-08-17T10:00:00.000Z");
    expect((await (await ShareStore.open(path)).get("c1"))!.version).toBe(1);
  });
});
