import { describe, expect, it } from "vitest";
import {
  allSubmitted, closeEarly, disagreementReport, externalClaimsAsGaps, lock, openCase, positionBasis, sign,
  submitPosition, unanimityCheck, visibleTo,
  type Call, type DeliberationCase, type Position,
} from "../deliberation.js";
import { buildInventory, type CoveringFinding, type EvidenceChecklist } from "../inventory.js";

const CHECKLIST: EvidenceChecklist = {
  version: "t",
  items: [
    { id: "C2", half: "consequence", field: "Exposure margin", whatItBlocks: "R3 cannot be applied." },
    { id: "M1", half: "mechanism", field: "Human-cell result", whatItBlocks: "R1 cannot be applied." },
  ],
};

const FINDINGS: CoveringFinding[] = [
  { id: "f1", label: "human hepatocyte", assertion: "toxic", detail: "d", covers: ["M1"] },
];
const KNOWN = new Set(FINDINGS.map((f) => f.id));

const CASE = openCase({
  caseId: "case-1",
  compoundLabel: "TAK-994",
  context: "Chronic dosing, healthy adults.",
  ownerId: "owner",
  participantIds: ["bea", "ann", "cal"],
});

const pos = (participantId: string, over: Partial<Position> = {}): Position => ({
  participantId,
  call: "advance",
  reasoning: "Because.",
  citedFindingIds: [],
  external: [],
  submittedAt: "2026-08-09T10:00:00Z",
  ...over,
});

const submitAll = (c: DeliberationCase, calls: Record<string, Call>, cite = true): DeliberationCase => {
  let cur = c;
  for (const [who, call] of Object.entries(calls)) {
    const r = submitPosition(cur, pos(who, { call, ...(cite ? { citedFindingIds: ["f1"] } : {}) }), KNOWN);
    if (!r.ok) throw new Error(r.error.detail);
    cur = r.value;
  }
  return cur;
};

describe("openCase", () => {
  it("carries no field its own type does not declare", () => {
    // Regression. `openCase` used to spread its argument, and callers pass a wider
    // object - so findings and a timestamp rode along, out over the API and into the
    // persisted snapshot, invisible to the type.
    const wide = { caseId: "c", compoundLabel: "X", context: "", ownerId: "o", participantIds: ["ann"], findings: [{ id: "f1" }], at: "t" };
    const c = openCase(wide);
    expect(Object.keys(c).sort()).toEqual([
      "adjudication", "caseId", "closedEarly", "compoundLabel", "context",
      "ownerId", "participantIds", "positions", "signature", "status",
    ]);
  });

  it("deduplicates participants, or the case could never lock", () => {
    const c = openCase({ caseId: "c", compoundLabel: "X", context: "", ownerId: "o", participantIds: ["ann", "ann", "bea"] });
    expect(c.participantIds).toEqual(["ann", "bea"]);
  });
});

describe("positionBasis", () => {
  it("calls a position citing findings `cited`", () => {
    expect(positionBasis(pos("ann", { citedFindingIds: ["f1"] }))).toBe("cited");
  });

  it("calls a position citing only outside work `external`", () => {
    expect(positionBasis(pos("ann", { external: [{ claim: "This assay overcalls for phenothiazines." }] }))).toBe("external");
  });

  it("calls a position citing nothing `unsupported`", () => {
    expect(positionBasis(pos("ann"))).toBe("unsupported");
  });

  it("prefers `cited` when a position holds both, because the checkable part is checkable", () => {
    expect(positionBasis(pos("ann", { citedFindingIds: ["f1"], external: [{ claim: "x" }] }))).toBe("cited");
  });
});

describe("submitPosition", () => {
  it("accepts a named participant", () => {
    const r = submitPosition(CASE, pos("ann"), KNOWN);
    expect(r.ok).toBe(true);
  });

  it("rejects somebody not named on the case", () => {
    const r = submitPosition(CASE, pos("stranger"), KNOWN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_a_participant");
  });

  it("rejects a second submission: a sealed position cannot be replaced", () => {
    const first = submitPosition(CASE, pos("ann"), KNOWN);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = submitPosition(first.value, pos("ann", { call: "do_not_advance" }), KNOWN);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.kind).toBe("already_submitted");
  });

  it("rejects a citation that points at nothing in this case", () => {
    const r = submitPosition(CASE, pos("ann", { citedFindingIds: ["f1", "ghost"] }), KNOWN);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("unknown_finding_id");
      expect(r.error.detail).toContain("ghost");
    }
  });

  it("rejects a call with no argument, because a call that can only be counted is useless here", () => {
    const r = submitPosition(CASE, pos("ann", { reasoning: "   " }), KNOWN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("empty_reasoning");
  });

  it("accepts an unsupported position: dissent is preserved, never blocked", () => {
    const r = submitPosition(CASE, pos("ann", { call: "do_not_advance", reasoning: "I am uneasy." }), KNOWN);
    expect(r.ok).toBe(true);
    if (r.ok) expect(positionBasis(r.value.positions[0]!)).toBe("unsupported");
  });

  it("accepts an external claim with no source attached", () => {
    // Requiring a source would push people to fake one, and an unsourced external
    // claim is a legitimate, testable state.
    const r = submitPosition(CASE, pos("ann", { external: [{ claim: "Prior work on this class." }] }), KNOWN);
    expect(r.ok).toBe(true);
  });

  it("refuses submissions once the case is locked", () => {
    const full = submitAll(CASE, { ann: "advance", bea: "advance", cal: "advance" });
    const locked = lock(full);
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    const late = submitPosition(locked.value, pos("ann"), KNOWN);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.kind).toBe("not_open");
  });

  it("normalises duplicate citations so the sealed position is stable", () => {
    const r = submitPosition(CASE, pos("ann", { citedFindingIds: ["f1", "f1"] }), KNOWN);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.positions[0]!.citedFindingIds).toEqual(["f1"]);
  });
});

describe("visibleTo - the blind-submission guarantee", () => {
  const partial = submitAll(CASE, { ann: "do_not_advance", bea: "advance" });

  it("shows a viewer their own position in full", () => {
    const v = visibleTo(partial, "ann");
    expect(v.own?.call).toBe("do_not_advance");
  });

  it("shows nothing of anyone else's position while the case is open", () => {
    const v = visibleTo(partial, "ann");
    expect(v.revealed).toBeNull();
    // One bit each: submitted or not. Not the call, not the reasoning, not the
    // citations - and the serialised view must not contain them anywhere.
    expect(JSON.stringify(v.others)).not.toContain("advance");
    expect(JSON.stringify(v.others)).not.toContain("Because");
  });

  it("reports only whether others have answered", () => {
    const v = visibleTo(partial, "ann");
    expect(v.others).toEqual([
      { participantId: "bea", submitted: true },
      { participantId: "cal", submitted: false },
    ]);
  });

  it("does not privilege the owner", () => {
    // An owner who could read early is the senior person in the room reading
    // everyone's answer before speaking, which is the dynamic blindness exists to break.
    const v = visibleTo(partial, "owner");
    expect(v.revealed).toBeNull();
    expect(JSON.stringify(v)).not.toContain("do_not_advance");
  });

  it("leaks no running tally of calls, which would drag as hard as the positions", () => {
    const v = visibleTo(partial, "cal");
    expect(JSON.stringify(v)).not.toContain("do_not_advance");
  });

  it("reveals everything once locked", () => {
    const full = submitAll(partial, { cal: "advance" });
    const locked = lock(full);
    if (!locked.ok) throw new Error("expected lock");
    const v = visibleTo(locked.value, "cal");
    expect(v.revealed).toHaveLength(3);
    expect(v.revealed?.map((p) => p.participantId)).toEqual(["ann", "bea", "cal"]);
  });

  it("reveals in participant order, not submission order", () => {
    // Submission order is a status signal - first to answer reads as most confident,
    // last as most considered - and neither is information about the compound.
    let c = openCase({ caseId: "c2", compoundLabel: "X", context: "", ownerId: "o", participantIds: ["zoe", "amy"] });
    c = submitAll(c, { zoe: "advance", amy: "advance" });
    const locked = lock(c);
    if (!locked.ok) throw new Error("expected lock");
    expect(visibleTo(locked.value, "amy").revealed?.map((p) => p.participantId)).toEqual(["amy", "zoe"]);
  });
});

describe("lock and closeEarly", () => {
  it("refuses to lock while somebody has not answered, and names them", () => {
    const partial = submitAll(CASE, { ann: "advance" });
    const r = lock(partial);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("not_all_submitted");
      expect(r.error.detail).toContain("bea");
      expect(r.error.detail).toContain("cal");
    }
  });

  it("locks when everyone has answered", () => {
    const full = submitAll(CASE, { ann: "advance", bea: "advance", cal: "advance" });
    expect(allSubmitted(full)).toBe(true);
    const r = lock(full);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("locked");
  });

  it("lets only the owner close early", () => {
    const partial = submitAll(CASE, { ann: "advance" });
    const r = closeEarly(partial, "bea", "2026-08-09T11:00:00Z");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_the_owner");
  });

  it("records who did not answer when the owner closes early", () => {
    // Silent early closure lets a case be locked the moment the answers look right,
    // with the dissenter's absence invisible to every later reader.
    const partial = submitAll(CASE, { ann: "advance" });
    const r = closeEarly(partial, "owner", "2026-08-09T11:00:00Z");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe("locked");
      expect(r.value.closedEarly).toEqual({ by: "owner", at: "2026-08-09T11:00:00Z", nonResponders: ["bea", "cal"] });
    }
  });
});

describe("sign", () => {
  const adjudicated = (): DeliberationCase => {
    const full = submitAll(CASE, { ann: "advance", bea: "advance", cal: "advance" });
    const locked = lock(full);
    if (!locked.ok) throw new Error("expected lock");
    return { ...locked.value, status: "adjudicated", adjudication: {} };
  };

  it("records agreement", () => {
    const r = sign(adjudicated(), { by: "owner", at: "t", agreesWithAdjudication: true, reason: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("signed");
  });

  it("permits an override, because forbidding it would make the AI the decider", () => {
    const r = sign(adjudicated(), { by: "owner", at: "t", agreesWithAdjudication: false, reason: "Margin is 40x and the pattern is reversible." });
    expect(r.ok).toBe(true);
  });

  it("requires a reason for an override", () => {
    const r = sign(adjudicated(), { by: "owner", at: "t", agreesWithAdjudication: false, reason: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("override_needs_reason");
  });

  it("refuses to sign before an adjudication exists", () => {
    const full = submitAll(CASE, { ann: "advance", bea: "advance", cal: "advance" });
    const locked = lock(full);
    if (!locked.ok) throw new Error("expected lock");
    const r = sign(locked.value, { by: "owner", at: "t", agreesWithAdjudication: true, reason: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("no_adjudication");
  });

  it("refuses a second signature", () => {
    const first = sign(adjudicated(), { by: "owner", at: "t", agreesWithAdjudication: true, reason: "" });
    if (!first.ok) throw new Error("expected sign");
    const second = sign(first.value, { by: "other", at: "t", agreesWithAdjudication: true, reason: "" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.kind).toBe("already_signed");
  });
});

describe("unanimityCheck - agreement is not correctness", () => {
  const inv = buildInventory(FINDINGS, CHECKLIST);

  it("says nothing when the room disagrees: reconciling disagreement is the ordinary path", () => {
    const c = submitAll(CASE, { ann: "advance", bea: "do_not_advance", cal: "advance" });
    const r = unanimityCheck(c, inv);
    expect(r.unanimous).toBe(false);
    expect(r.concerns).toEqual([]);
  });

  it("names the untested question when everyone agrees to advance - this is TAK-994", () => {
    const c = submitAll(CASE, { ann: "advance", bea: "advance", cal: "advance" });
    const r = unanimityCheck(c, inv);
    expect(r.unanimous).toBe(true);
    expect(r.call).toBe("advance");
    const joined = r.concerns.join(" ");
    expect(joined).toContain("Exposure margin");
    expect(joined).toContain("nobody tested");
  });

  it("stays quiet about gaps when the room agrees to stop", () => {
    // Directional on purpose, and the same asymmetry rule R3 encodes: an untested
    // question is a reason not to be reassured. A room that has agreed to stop is
    // not being reassured, so warning there would invent a pressure to advance.
    const c = submitAll(CASE, { ann: "do_not_advance", bea: "do_not_advance", cal: "do_not_advance" });
    const r = unanimityCheck(c, inv);
    expect(r.unanimous).toBe(true);
    expect(r.concerns.join(" ")).not.toContain("nobody tested");
  });

  it("flags unanimity where nobody cited anything at all", () => {
    const c = submitAll(CASE, { ann: "do_not_advance", bea: "do_not_advance", cal: "do_not_advance" }, false);
    const r = unanimityCheck(c, inv);
    expect(r.concerns.join(" ")).toContain("Every position cites nothing");
  });

  it("names the individuals who cited nothing when others did", () => {
    let c = submitAll(CASE, { ann: "advance", bea: "advance" });
    c = submitAll(c, { cal: "advance" }, false);
    const r = unanimityCheck(c, inv);
    expect(r.concerns.join(" ")).toContain("cal");
  });

  it("notes evidence that was present and that nobody mentioned", () => {
    const wide = buildInventory([
      ...FINDINGS,
      { id: "f9", label: "transporter", assertion: "toxic", detail: "d", covers: ["C2"] },
    ], CHECKLIST);
    const c = submitAll(CASE, { ann: "advance", bea: "advance", cal: "advance" });
    expect(unanimityCheck(c, wide).concerns.join(" ")).toContain("cited by nobody");
  });

  it("returns nothing for an empty case", () => {
    expect(unanimityCheck(CASE, inv)).toEqual({ unanimous: false, call: null, concerns: [] });
  });

  it("never counts heads: three uneasy voices do not become a verdict", () => {
    const c = submitAll(CASE, { ann: "advance", bea: "advance", cal: "advance" });
    const r = unanimityCheck(c, inv);
    // The report carries the shared call and concerns about it. There is nowhere in
    // the type to put a tally, and that is the design (§6.4).
    expect(Object.keys(r).sort()).toEqual(["call", "concerns", "unanimous"]);
  });
});

describe("disagreementReport - the crux, without a model", () => {
  it("returns nothing when the room agrees, because there is no split to describe", () => {
    const c = submitAll(CASE, { ann: "advance", bea: "advance", cal: "advance" });
    expect(disagreementReport(c)).toBeNull();
  });

  it("groups participants by call, sorted so the output is stable", () => {
    let c = submitAll(CASE, { ann: "advance", bea: "do_not_advance" });
    c = submitAll(c, { cal: "advance" });
    const d = disagreementReport(c)!;
    expect(d.split).toEqual([
      { call: "advance", participantIds: ["ann", "cal"] },
      { call: "do_not_advance", participantIds: ["bea"] },
    ]);
  });

  it("separates evidence both camps cite from evidence only one camp cites", () => {
    // The distinction is the useful one: a finding both sides cite is common ground
    // read two ways; a finding only one side cites is evidence nobody answered.
    const known = new Set(["shared", "mine"]);
    let c = CASE;
    for (const [who, call, ids] of [
      ["ann", "advance", ["shared"]],
      ["bea", "do_not_advance", ["shared", "mine"]],
    ] as const) {
      const r = submitPosition(c, pos(who, { call, citedFindingIds: [...ids] }), known);
      if (!r.ok) throw new Error(r.error.detail);
      c = r.value;
    }
    const d = disagreementReport(c)!;
    expect(d.contested).toEqual(["shared"]);
    expect(d.oneSided).toEqual([{ findingId: "mine", call: "do_not_advance" }]);
  });

  it("reports nothing contested when the camps cite disjoint evidence", () => {
    const known = new Set(["a", "b"]);
    let c = CASE;
    const first = submitPosition(c, pos("ann", { call: "advance", citedFindingIds: ["a"] }), known);
    if (!first.ok) throw new Error("expected ok");
    const second = submitPosition(first.value, pos("bea", { call: "do_not_advance", citedFindingIds: ["b"] }), known);
    if (!second.ok) throw new Error("expected ok");
    const d = disagreementReport(second.value)!;
    expect(d.contested).toEqual([]);
    expect(d.oneSided).toHaveLength(2);
  });

  it("never says who is right - it has nowhere to put that", () => {
    let c = submitAll(CASE, { ann: "advance", bea: "do_not_advance" });
    c = submitAll(c, { cal: "advance" });
    expect(Object.keys(disagreementReport(c)!).sort()).toEqual(["contested", "oneSided", "split"]);
  });
});

describe("externalClaimsAsGaps", () => {
  it("routes an unsourced external claim onto the missing-evidence list rather than dropping it", () => {
    const r = submitPosition(CASE, pos("ann", { external: [{ claim: "This assay overcalls for phenothiazines." }] }), KNOWN);
    if (!r.ok) throw new Error("expected ok");
    const gaps = externalClaimsAsGaps(r.value);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.field).toContain("ann");
    expect(gaps[0]!.field).toContain("phenothiazines");
    expect(gaps[0]!.whatItBlocks).toContain("no source attached");
  });

  it("records the source when one is attached, which is what promotes it to a finding", () => {
    const r = submitPosition(CASE, pos("ann", { external: [{ claim: "Class effect.", source: "Smith 2019" }] }), KNOWN);
    if (!r.ok) throw new Error("expected ok");
    expect(externalClaimsAsGaps(r.value)[0]!.whatItBlocks).toContain("Smith 2019");
  });

  it("returns nothing when nobody claimed anything external", () => {
    expect(externalClaimsAsGaps(CASE)).toEqual([]);
  });
});
