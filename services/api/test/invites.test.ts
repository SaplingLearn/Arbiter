import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InviteStore } from "../invites.js";
import { AuthStore } from "../auth.js";
import { addParticipant, describeCase, openCase, removeParticipant, submitPosition, type Position } from "../deliberation.js";

const AT = "2026-08-09T09:00:00Z";
const store = (): InviteStore => new InviteStore(null);

describe("InviteStore", () => {
  it("records an invitation and finds it by case and by address", () => {
    const s = store();
    s.add({ email: "Ann@Lab.COM ", caseId: "c1", invitedBy: "u_owner", at: AT });
    expect(s.forCase("c1").map((i) => i.email)).toEqual(["ann@lab.com"]);
    expect(s.forEmail("ANN@lab.com")).toHaveLength(1);
  });

  it("is idempotent, so one address cannot join a case twice", () => {
    const s = store();
    s.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
    s.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
    expect(s.forCase("c1")).toHaveLength(1);
  });

  it("keeps invitations to different cases separate", () => {
    const s = store();
    s.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
    s.add({ email: "ann@lab.com", caseId: "c2", invitedBy: "u_o", at: AT });
    expect(s.claim("ann@lab.com").sort()).toEqual(["c1", "c2"]);
  });

  it("drains on claim, so a second registration joins nothing", () => {
    const s = store();
    s.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
    expect(s.claim("ann@lab.com")).toEqual(["c1"]);
    expect(s.claim("ann@lab.com")).toEqual([]);
  });

  it("returns nothing for an address nobody invited", () => {
    expect(store().claim("stranger@lab.com")).toEqual([]);
  });

  it("revokes a pending invitation, and reports when there was none", () => {
    const s = store();
    s.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
    expect(s.revoke("ANN@lab.com", "c1")).toBe(true);
    expect(s.forCase("c1")).toEqual([]);
    expect(s.revoke("ann@lab.com", "c1")).toBe(false);
  });

  it("survives a restart", () => {
    const path = join(mkdtempSync(join(tmpdir(), "arb-inv-")), "invites.json");
    new InviteStore(path).add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });
    expect(new InviteStore(path).forCase("c1")).toHaveLength(1);
  });
});

describe("registration claims invitations", () => {
  it("joins a new account to every case it was invited to", () => {
    // The composition the server performs. AuthStore knows nothing about invitations
    // and InviteStore knows nothing about accounts; joining them is the server's job,
    // and this asserts the sequence rather than pretending either half does it alone.
    const auth = new AuthStore(null);
    const invites = store();
    let kase = openCase({ caseId: "c1", compoundLabel: "X", context: "", ownerId: "u_o", participantIds: ["u_seed"] });
    invites.add({ email: "ann@lab.com", caseId: "c1", invitedBy: "u_o", at: AT });

    const r = auth.register({ email: "ann@lab.com", displayName: "Ann", password: "long-enough-password", now: Date.parse(AT) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const claimed = invites.claim(r.value.email);
    expect(claimed).toEqual(["c1"]);
    for (const id of claimed) {
      expect(id).toBe("c1");
      const added = addParticipant(kase, r.value.id);
      expect(added.ok).toBe(true);
      if (added.ok) kase = added.value;
    }
    expect(kase.participantIds).toContain(r.value.id);
    // Drained, so registering again joins nothing.
    expect(invites.claim(r.value.email)).toEqual([]);
  });
});

describe("roster changes", () => {
  const base = openCase({ caseId: "c1", compoundLabel: "X", context: "", ownerId: "u_o", participantIds: ["u_ann"] });
  const known = new Set(["f1"]);
  const pos = (id: string): Position => ({
    participantId: id, call: "advance", reasoning: "Because.",
    citedFindingIds: ["f1"], external: [], submittedAt: AT,
  });

  it("adds somebody to an open case with no answers yet", () => {
    const r = addParticipant(base, "u_bea");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.participantIds).toEqual(["u_ann", "u_bea"]);
  });

  it("refuses to add the same person twice", () => {
    const r = addParticipant(base, "u_ann");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("already_a_participant");
  });

  it("refuses to change the roster once anybody has answered", () => {
    // "Everyone has submitted" is what unlocks the reveal, so adding a person after
    // an answer silently re-opens a case others treated as closed, and removing one
    // closes it early without the record `closeEarly` writes.
    const answered = submitPosition(base, pos("u_ann"), known);
    if (!answered.ok) throw new Error("fixture");
    for (const r of [addParticipant(answered.value, "u_bea"), removeParticipant(answered.value, "u_ann")]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("has_answered");
    }
  });

  it("refuses to empty the panel", () => {
    const r = removeParticipant(base, "u_ann");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.detail).toContain("needs somebody to answer");
  });

  it("removes somebody when there is more than one", () => {
    const two = addParticipant(base, "u_bea");
    if (!two.ok) throw new Error("fixture");
    const r = removeParticipant(two.value, "u_bea");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.participantIds).toEqual(["u_ann"]);
  });

  it("refuses to touch the roster of a closed case", () => {
    const r = addParticipant({ ...base, status: "locked" }, "u_bea");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_open");
  });
});

describe("describeCase", () => {
  const base = openCase({ caseId: "c1", compoundLabel: "X", context: "", ownerId: "u_o", participantIds: ["u_ann"] });

  it("renames and restates, because neither is evidence", () => {
    const r = describeCase(base, "  TAK-994  ", "Chronic dosing.");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.compoundLabel).toBe("TAK-994");
      expect(r.value.context).toBe("Chronic dosing.");
    }
  });

  it("refuses an empty name", () => {
    expect(describeCase(base, "   ", "x").ok).toBe(false);
  });

  it("refuses to edit a signed case", () => {
    const r = describeCase({ ...base, status: "signed" }, "Y", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("already_signed");
  });
});
