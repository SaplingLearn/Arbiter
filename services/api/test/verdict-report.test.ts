import { describe, expect, it } from "vitest";
import { buildCaseReport } from "../verdict-report.js";
import type { Adjudication } from "../adjudicate.js";
import type { DeliberationCase, Position } from "../deliberation.js";
import type { Inventory } from "../inventory.js";

/**
 * Assembling the record.
 *
 * The page draws whatever this hands it, so the facts a reader most needs are decided
 * here: who is on the panel and in what order, whether an account that no longer exists
 * still prints, and whether an adjudication of unknown provenance is allowed to look
 * like a model's judgment.
 */

const ADJ: Adjudication = {
  mechanism: { present: true, pathway: "BSEP inhibition.", citedFindingIds: ["f-hep"] },
  consequence: { verdict: "cannot_conclude", reasoning: "No margin.", citedFindingIds: [] },
  consequenceBasis: [],
  ruleDisclosure: [],
  missing: [],
  nextExperiment: null,
};

const INVENTORY: Inventory = {
  checklistVersion: "1.0",
  modality: "small_molecule",
  unmappedFindingIds: [],
  entries: [
    { itemId: "C2", half: "consequence", field: "Exposure margin", whatItBlocks: "R3 cannot be applied.", state: "absent", findingIds: [] },
  ],
};

const position = (id: string, over: Partial<Position> = {}): Position => ({
  participantId: id, call: "advance", reasoning: "Because.",
  citedFindingIds: [], external: [], submittedAt: "2026-08-16T09:00:00.000Z", ...over,
});

const kase = (over: Partial<DeliberationCase> = {}): DeliberationCase => ({
  caseId: "case_1",
  compoundLabel: "ARB-114",
  context: "Once-daily oral.",
  ownerId: "u-own",
  participantIds: ["u-a", "u-b"],
  seats: { "u-a": 1, "u-b": 0 },
  status: "signed",
  positions: [position("u-a"), position("u-b", { call: "do_not_advance" })],
  closedEarly: null,
  adjudication: ADJ,
  // Stored beside the adjudication, because a 2-of-3 verdict and a 3-of-3 verdict are
  // different objects. Null here: this fixture is about what the report assembles, not
  // about how many runs agreed.
  consensus: null,
  signature: { by: "u-own", at: "2026-08-16T11:00:00.000Z", agreesWithAdjudication: true, reason: "" },
  ...over,
});

const PEOPLE: Record<string, { displayName: string; email: string }> = {
  "u-own": { displayName: "R. Okafor", email: "r@arbiter.demo" },
  "u-a": { displayName: "A. Silva", email: "a@arbiter.demo" },
  "u-b": { displayName: "B. Mehta", email: "b@arbiter.demo" },
};

const build = (over: { kase?: DeliberationCase; source?: "stub" | "live"; audit?: { chainFailures: number; sealFailures: number; entries: { hash: string }[] } } = {}) =>
  buildCaseReport({
    kase: over.kase ?? kase(),
    positions: (over.kase ?? kase()).positions,
    inventory: INVENTORY,
    findings: [{ id: "f-hep", label: "Human hepatocyte", assertion: "toxic", detail: "Signal at 10uM." }],
    unanimity: { unanimous: false, call: null, concerns: [] },
    adjudication: ADJ,
    adjudicationSource: over.source ?? "live",
    adjudicatedAt: "2026-08-16T10:00:00.000Z",
    signature: (over.kase ?? kase()).signature,
    audit: over.audit ?? { chainFailures: 0, sealFailures: 0, entries: [{ hash: "a".repeat(64) }, { hash: "b".repeat(64) }] },
    person: (id) => PEOPLE[id] ?? null,
    generatedById: "u-a",
    generatedAt: "2026-08-16T12:00:00.000Z",
  });

describe("buildCaseReport", () => {
  it("orders the panel by seat, which is the order every screen shows them in", () => {
    // Ordering by call would group the room into camps on the page, which is a claim
    // about the room that the record does not get to make.
    expect(build().panel.map((p) => p.displayName)).toEqual(["B. Mehta", "A. Silva"]);
    expect(build().panel.map((p) => p.seat)).toEqual([0, 1]);
  });

  it("still prints when an account has been deleted", () => {
    // Their positions are in the record permanently. The id is not a name and does not
    // pretend to be one.
    const r = buildCaseReport({
      kase: kase(), positions: kase().positions, inventory: INVENTORY, findings: [],
      unanimity: { unanimous: false, call: null, concerns: [] },
      adjudication: ADJ, adjudicationSource: "live", adjudicatedAt: null, signature: null,
      audit: { chainFailures: 0, sealFailures: 0, entries: [] },
      person: () => null,
      generatedById: "u-a", generatedAt: "2026-08-16T12:00:00.000Z",
    });
    expect(r.panel.map((p) => p.displayName)).toEqual(["u-b", "u-a"]);
    expect(r.panel.every((p) => p.email === "")).toBe(true);
  });

  it("computes the split rather than being told it", () => {
    const d = build().disagreement;
    expect(d?.split.map((s) => s.call)).toEqual(["advance", "do_not_advance"]);
  });

  it("carries the head hash a doubting reader would go and check", () => {
    const r = build();
    expect(r.audit.entries).toBe(2);
    expect(r.audit.headHash).toBe("b".repeat(64));
  });

  it("reports no head hash rather than inventing one for an empty log", () => {
    expect(build({ audit: { chainFailures: 0, sealFailures: 0, entries: [] } }).audit.headHash).toBeNull();
  });

  it("keeps a stub labelled as a stub", () => {
    expect(build({ source: "stub" }).adjudicationSource).toBe("stub");
  });

  it("names the non-responders when a case was closed without them", () => {
    const closed = kase({
      positions: [position("u-a")],
      closedEarly: { by: "u-own", at: "2026-08-16T09:45:00.000Z", nonResponders: ["u-b"] },
    });
    expect(build({ kase: closed }).closedEarly?.nonResponders).toEqual(["u-b"]);
  });

  it("says who asked for it", () => {
    // A document that leaves the system says who made it.
    expect(build().generatedBy.displayName).toBe("A. Silva");
  });
});
