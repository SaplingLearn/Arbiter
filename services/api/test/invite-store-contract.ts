import { describe, expect, it } from "vitest";
import type { InviteStoreApi } from "../postgres-invites.js";

/**
 * One suite, run against `InviteStore` and against `PostgresInviteStore`, for the same
 * reason as the auth one: `invites.ts` is the only statement of what an invitation
 * store does, so the way to check the second implementation is to run the first one's
 * behaviour against it.
 *
 * `AT` IS WRITTEN THE WAY THE SERVER WRITES IT - `new Date(...).toISOString()`, with
 * the milliseconds. That is not incidental. The file store hands `at` back exactly as
 * it was given; Postgres stores a timestamptz and `db.ts` re-emits it with
 * `.toISOString()`, so the two agree byte for byte on any value that was produced that
 * way, and disagree on a hand-written `"...09:00:00Z"` that has no milliseconds in it.
 * The product only ever writes the former (`server.ts` invite handler), and pinning the
 * fixture to it is what lets these tests demand an exact string rather than a lenient
 * date comparison - which would also pass for a `Date` object, the thing that must not
 * come out of here.
 */

export const AT = new Date(Date.parse("2026-08-09T09:00:00.500Z")).toISOString();
export const LATER = new Date(Date.parse("2026-08-09T11:30:00.250Z")).toISOString();

export function inviteStoreBehaviour(make: () => Promise<InviteStoreApi>): void {
  describe("recording an invitation", () => {
    it("records one and finds it by case and by address", async () => {
      const store = await make();
      const row = await store.add({ email: "Ann@Lab.COM ", caseId: "c1", invitedBy: "u_owner", at: AT });
      expect(row).toEqual({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_owner", at: AT });
      expect(await store.forCase("c1")).toEqual([row]);
      expect(await store.forEmail("ANN@lab.com")).toEqual([row]);
    });

    it("hands `at` back as the string it was given, not as a date", async () => {
      // A `Date` here is not a formatting nit: this value is compared and rendered as a
      // string everywhere else in the API, and one that arrives as an object changes the
      // shape of the pending-invitations response depending on which store served it.
      const store = await make();
      const row = await store.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
      expect(typeof row.at).toBe("string");
      expect(row.at).toBe(AT);
      const [listed] = await store.forCase("c1");
      expect(typeof listed!.at).toBe("string");
      expect(listed!.at).toBe(AT);
    });

    it("is idempotent, so one address cannot join a case twice", async () => {
      const store = await make();
      await store.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
      await store.add({ email: "ANN@lab.com ", caseId: "c1", invitedBy: "u_o", at: AT });
      expect(await store.forCase("c1")).toHaveLength(1);
    });

    it("returns the invitation that was already there, and does not overwrite it", async () => {
      // `add` is not an upsert. Who invited somebody, and when, is a lever on the
      // outcome - the log records roster changes for that reason - so a second
      // invitation from a different person must not quietly rewrite the first one's
      // author, and must not raise either: re-inviting is an ordinary thing to do from
      // the roster screen.
      const store = await make();
      const first = await store.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_owner", at: AT });
      const second = await store.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_someone_else", at: LATER });
      expect(second).toEqual(first);
      expect(await store.forCase("c1")).toEqual([first]);
    });

    it("keeps invitations to different cases separate", async () => {
      const store = await make();
      await store.add({ email: "ann@lab.com", caseId: "c2", invitedBy: "u_o", at: AT });
      await store.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
      expect((await store.forEmail("ann@lab.com")).map((i) => i.caseId).sort()).toEqual(["c1", "c2"]);
      expect(await store.forCase("c1")).toHaveLength(1);
    });

    it("orders a case's invitations by address", async () => {
      // As in the people list: JavaScript's `<` compares code units and a locale-aware
      // collation can order the hyphen differently, so the two stores must be told to
      // agree rather than left to.
      const store = await make();
      for (const email of ["annb@lab.com", "ann-b@lab.com", "anna@lab.com"]) {
        await store.add({ email, caseId: "c1", invitedBy: "u_o", at: AT });
      }
      expect((await store.forCase("c1")).map((i) => i.email)).toEqual(["ann-b@lab.com", "anna@lab.com", "annb@lab.com"]);
    });

    it("returns nothing for a case nobody was invited to", async () => {
      expect(await (await make()).forCase("c_none")).toEqual([]);
    });
  });

  describe("claiming and revoking", () => {
    it("drains on claim, so a second registration joins nothing", async () => {
      // Sorted before comparing: the file store returns the order it recorded them in
      // and the database returns them ordered by case id. Nothing reads this as a
      // sequence - registration joins every case in it - so the set is the contract.
      const store = await make();
      await store.add({ email: "ann@lab.com", caseId: "c2", invitedBy: "u_o", at: AT });
      await store.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
      expect((await store.claim("ANN@lab.com")).sort()).toEqual(["c1", "c2"]);
      expect(await store.claim("ann@lab.com")).toEqual([]);
      expect(await store.forCase("c1")).toEqual([]);
    });

    it("claims one address without touching another's", async () => {
      const store = await make();
      await store.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
      await store.add({ email: "bea@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
      expect(await store.claim("ann@lab.com")).toEqual(["c1"]);
      expect((await store.forCase("c1")).map((i) => i.email)).toEqual(["bea@lab.com"]);
    });

    it("returns nothing for an address nobody invited", async () => {
      expect(await (await make()).claim("stranger@lab.com")).toEqual([]);
    });

    it("revokes a pending invitation, and reports when there was none", async () => {
      const store = await make();
      await store.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
      expect(await store.revoke("ANN@lab.com", "c1")).toBe(true);
      expect(await store.forCase("c1")).toEqual([]);
      expect(await store.revoke("ann@lab.com", "c1")).toBe(false);
    });

    it("revokes one case's invitation and leaves the other case's alone", async () => {
      const store = await make();
      await store.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
      await store.add({ email: "ann@lab.com", caseId: "c2", invitedBy: "u_o", at: AT });
      expect(await store.revoke("ann@lab.com", "c1")).toBe(true);
      expect((await store.forEmail("ann@lab.com")).map((i) => i.caseId)).toEqual(["c2"]);
    });
  });
}
