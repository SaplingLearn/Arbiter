import { describe, expect, it } from "vitest";
import { deriveToken, verifyToken } from "../share.js";
import type { ShareStoreApi } from "../postgres-share.js";

/**
 * One suite, run against `ShareStore` and against `PostgresShareStore`, for the same
 * reason as the auth and invite ones: `share.ts` is the only statement of what a share
 * store does, so the way to check the second implementation is to run the first one's
 * behaviour against it.
 *
 * THIS SUITE IS WHERE THE VERSION RULE IS PINNED, and it is the rule the whole feature
 * rests on. `version` is half the HMAC preimage, so a store that resets it after a
 * revoke re-mints a token somebody deliberately killed - and a QR code already printed
 * on a sheet starts working again. That failure is invisible from every other angle:
 * publishing returns a URL, the URL resolves, nothing errors. It is only visible from a
 * test that publishes, revokes, republishes, and then tries the DEAD token.
 *
 * `AT` IS WRITTEN THE WAY THE SERVER WRITES IT - `new Date(...).toISOString()`, with the
 * milliseconds - for the reason `invite-store-contract.ts` sets out at length: the file
 * store hands the string back verbatim, Postgres stores a timestamptz and `db.ts`
 * re-emits it with `.toISOString()`, and the two agree byte for byte only on a value
 * produced that way. `server.ts` produces exactly that (`new Date(now()).toISOString()`).
 */

export const SECRET = "0123456789abcdef0123456789abcdef";
export const AT = new Date(Date.parse("2026-08-17T10:00:00.500Z")).toISOString();
export const LATER = new Date(Date.parse("2026-08-17T11:00:00.250Z")).toISOString();
export const LATEST = new Date(Date.parse("2026-08-17T12:00:00.750Z")).toISOString();

export function shareStoreBehaviour(make: () => Promise<ShareStoreApi>): void {
  describe("publishing", () => {
    it("has no link for a case nobody published", async () => {
      expect(await (await make()).get("c1")).toBeNull();
    });

    it("publishes at version 1, live, attributed to whoever published it", async () => {
      const store = await make();
      const link = await store.publish("c1", "u-own", AT);
      expect(link).toEqual({
        caseId: "c1", version: 1, createdBy: "u-own", createdAt: AT, revokedAt: null,
      });
      expect(await store.get("c1")).toEqual(link);
    });

    it("hands the timestamps back as the strings they were given, not as dates", async () => {
      // Same hazard as the invite store's `at`: a `Date` object here changes the shape of
      // the share response depending on which store served it, and `createdAt` is
      // rendered straight onto the share control.
      const store = await make();
      const link = await store.publish("c1", "u-own", AT);
      expect(typeof link.createdAt).toBe("string");
      expect(link.createdAt).toBe(AT);
      const revoked = await store.revoke("c1", LATER);
      expect(typeof revoked!.revokedAt).toBe("string");
      expect(revoked!.revokedAt).toBe(LATER);
    });

    it("returns the link that already exists, so the printed QR keeps working", async () => {
      // Publishing twice is not a request to invalidate the paper on a colleague's desk.
      // The second call must not re-attribute the link either: who published a record is
      // who is accountable for it.
      const store = await make();
      const first = await store.publish("c1", "u-own", AT);
      const again = await store.publish("c1", "u-someone-else", LATER);
      expect(again).toEqual(first);
      expect(await store.get("c1")).toEqual(first);
    });

    it("keeps one case's link out of another's", async () => {
      const store = await make();
      await store.publish("c1", "u-own", AT);
      expect(await store.get("c2")).toBeNull();
      await store.publish("c2", "u-own", LATER);
      expect((await store.get("c1"))!.createdAt).toBe(AT);
      expect((await store.get("c2"))!.createdAt).toBe(LATER);
    });
  });

  describe("revoking", () => {
    it("bumps the version and stamps the time", async () => {
      const store = await make();
      await store.publish("c1", "u-own", AT);
      const revoked = await store.revoke("c1", LATER);
      expect(revoked!.version).toBe(2);
      expect(revoked!.revokedAt).toBe(LATER);
      expect((await store.get("c1"))!.revokedAt).toBe(LATER);
    });

    it("leaves the row rejecting its own still-derivable token", async () => {
      // `verifyToken` checks `revokedAt` BEFORE it compares, so the token for the row's
      // CURRENT version - which is derivable by anyone holding the secret and the case
      // id - is refused as well as the dead one.
      const store = await make();
      await store.publish("c1", "u-own", AT);
      const revoked = await store.revoke("c1", LATER);
      expect(verifyToken(SECRET, revoked, deriveToken(SECRET, "c1", 1))).toBe(false);
      expect(verifyToken(SECRET, revoked, deriveToken(SECRET, "c1", revoked!.version))).toBe(false);
    });

    it("is not an error on a case nobody published", async () => {
      expect(await (await make()).revoke("c1", LATER)).toBeNull();
    });

    it("does not touch another case's link", async () => {
      const store = await make();
      await store.publish("c1", "u-own", AT);
      await store.publish("c2", "u-own", AT);
      await store.revoke("c1", LATER);
      expect((await store.get("c2"))!.revokedAt).toBeNull();
      expect((await store.get("c2"))!.version).toBe(1);
    });
  });

  describe("republishing after a revoke", () => {
    it("mints a different token, and the dead one stays dead", async () => {
      // THE LOAD-BEARING TEST. Publishing on a revoked row must reuse the version revoke
      // already bumped to - neither bumping again nor resetting to 1. A reset would
      // re-animate the token printed on every sheet that was in the world before the
      // revoke, which is the one thing revocation exists to prevent.
      const store = await make();
      await store.publish("c1", "u-own", AT);
      const dead = deriveToken(SECRET, "c1", 1);
      await store.revoke("c1", LATER);
      const fresh = await store.publish("c1", "u-own", LATEST);

      expect(fresh.revokedAt).toBeNull();
      expect(fresh.version).toBe(2);
      expect(verifyToken(SECRET, fresh, dead)).toBe(false);
      expect(verifyToken(SECRET, fresh, deriveToken(SECRET, "c1", 2))).toBe(true);
    });

    it("re-attributes the link to whoever brought it back", async () => {
      // The opposite of the live-link case above, and for the same reason: the person
      // accountable for a published record is the one who published the link that is
      // live now, not the one whose link was killed.
      const store = await make();
      await store.publish("c1", "u-own", AT);
      await store.revoke("c1", LATER);
      const fresh = await store.publish("c1", "u-other", LATEST);
      expect(fresh.createdBy).toBe("u-other");
      expect(fresh.createdAt).toBe(LATEST);
    });

    it("climbs a version per revoke, so no token is ever reachable twice", async () => {
      const store = await make();
      const seen = new Set<string>();
      for (const at of [AT, LATER, LATEST]) {
        const link = await store.publish("c1", "u-own", at);
        seen.add(deriveToken(SECRET, "c1", link.version));
        await store.revoke("c1", at);
      }
      expect(seen.size).toBe(3);
      expect((await store.get("c1"))!.version).toBe(4);
    });
  });
}
