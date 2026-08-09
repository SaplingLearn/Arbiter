import { describe, expect, it } from "vitest";
import { can, canRead, denial, isOwner, isParticipant, visibleCases, type CaseAction } from "../access.js";
import { openCase, type DeliberationCase } from "../deliberation.js";

const CASE = openCase({
  caseId: "c1", compoundLabel: "TAK-994", context: "",
  ownerId: "u_owner", participantIds: ["u_ann", "u_bea"],
});

const ACTIONS: CaseAction[] = ["read", "submit", "reveal", "adjudicate", "sign"];

describe("membership", () => {
  it("recognises the owner and the participants", () => {
    expect(isOwner(CASE, "u_owner")).toBe(true);
    expect(isParticipant(CASE, "u_ann")).toBe(true);
    expect(isParticipant(CASE, "u_owner")).toBe(false);
  });
});

describe("can", () => {
  it("lets a participant read and submit, and nothing else", () => {
    expect(can(CASE, "u_ann", "read")).toBe(true);
    expect(can(CASE, "u_ann", "submit")).toBe(true);
    for (const a of ["reveal", "adjudicate", "sign"] as const) {
      expect(can(CASE, "u_ann", a), a).toBe(false);
    }
  });

  it("lets the owner read, reveal, adjudicate and sign - but not submit", () => {
    // An owner who is not also a participant convenes and signs; they do not hold an
    // opinion on the record.
    expect(can(CASE, "u_owner", "read")).toBe(true);
    expect(can(CASE, "u_owner", "submit")).toBe(false);
    for (const a of ["reveal", "adjudicate", "sign"] as const) {
      expect(can(CASE, "u_owner", a), a).toBe(true);
    }
  });

  it("denies a stranger every action, exhaustively", () => {
    // Enumerated rather than sampled: an access rule you cannot enumerate is an
    // access rule nobody has checked.
    for (const a of ACTIONS) {
      expect(can(CASE, "u_stranger", a), a).toBe(false);
    }
  });

  it("denies an unknown action rather than allowing it", () => {
    // Deny is the default shape. A rule written the other way round fails open the
    // day someone adds a status the conditions do not mention.
    expect(can(CASE, "u_owner", "delete" as CaseAction)).toBe(false);
  });

  it("treats the empty string as a stranger, not as a wildcard", () => {
    for (const a of ACTIONS) expect(can(CASE, "", a), a).toBe(false);
  });
});

describe("denial", () => {
  it("returns nothing when the action is allowed", () => {
    expect(denial(CASE, "u_ann", "read")).toBeNull();
  });

  it("never names the compound, which is what an unauthorised caller is asking for", () => {
    for (const a of ACTIONS) {
      const d = denial(CASE, "u_stranger", a);
      expect(d).not.toBeNull();
      expect(JSON.stringify(d)).not.toContain("TAK-994");
      expect(JSON.stringify(d)).not.toContain("c1");
    }
  });

  it("tells a participant they are not the owner, rather than that they are unknown", () => {
    expect(denial(CASE, "u_ann", "sign")?.detail).toContain("decision owner");
    expect(denial(CASE, "u_stranger", "read")?.detail).toContain("not named");
  });
});

describe("visibleCases", () => {
  const other: DeliberationCase = openCase({
    caseId: "a-other", compoundLabel: "Something else", context: "",
    ownerId: "u_someone", participantIds: ["u_zed"],
  });

  it("returns only the cases the account is named on", () => {
    expect(visibleCases([CASE, other], "u_ann").map((c) => c.caseId)).toEqual(["c1"]);
    expect(visibleCases([CASE, other], "u_zed").map((c) => c.caseId)).toEqual(["a-other"]);
    expect(visibleCases([CASE, other], "u_stranger")).toEqual([]);
  });

  it("includes cases the account owns", () => {
    expect(visibleCases([CASE, other], "u_owner").map((c) => c.caseId)).toEqual(["c1"]);
  });

  it("sorts by id, so the list does not reflect insertion order", () => {
    const both = openCase({ caseId: "z-last", compoundLabel: "Z", context: "", ownerId: "u_ann", participantIds: [] });
    expect(visibleCases([CASE, both, other], "u_ann").map((c) => c.caseId)).toEqual(["c1", "z-last"]);
  });
});

describe("canRead against every case status", () => {
  it("does not change with status - membership decides, not lifecycle", () => {
    for (const status of ["open", "locked", "adjudicated", "signed"] as const) {
      const c: DeliberationCase = { ...CASE, status };
      expect(canRead(c, "u_ann"), status).toBe(true);
      expect(canRead(c, "u_stranger"), status).toBe(false);
    }
  });
});
