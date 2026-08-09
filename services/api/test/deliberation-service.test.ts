import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DeliberationService } from "../deliberation-service.js";
import { MemoryStore, verifyChain } from "../store.js";
import type { CoveringFinding, EvidenceChecklist } from "../inventory.js";
import type { Position } from "../deliberation.js";
import type { AdjudicateRequest } from "../adjudicate.js";

const CHECKLIST = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;

const RULES: AdjudicateRequest["rules"] = [
  { id: "R1", name: "Human relevance", statement: "Human-cell evidence defeats animal in vivo.", enabled: true, strength: 0.9 },
];

const FINDINGS: CoveringFinding[] = [
  { id: "f-hep", label: "Human hepatocyte panel", assertion: "toxic", detail: "Signal at 10uM.", covers: ["M1"] },
  { id: "f-rodent", label: "Rat 28-day", assertion: "safe", detail: "No findings at 3x.", covers: ["M5"] },
];

const pos = (participantId: string, over: Partial<Position> = {}): Position => ({
  participantId, call: "advance", reasoning: "Because.", citedFindingIds: [],
  external: [], submittedAt: "2026-08-09T10:00:00Z", ...over,
});

const service = (): DeliberationService => new DeliberationService(new MemoryStore(), CHECKLIST);

const opened = (svc: DeliberationService, participants = ["ann", "bea"]): void => {
  svc.open({
    caseId: "c1", compoundLabel: "TAK-994", context: "Chronic dosing, healthy adults.",
    ownerId: "owner", participantIds: participants, findings: FINDINGS, at: "2026-08-09T09:00:00Z",
  });
};

describe("DeliberationService - the whole path with no model in it", () => {
  it("publishes an inventory at open and never recomputes it", () => {
    const svc = service();
    opened(svc);
    const inv = svc.inventory("c1");
    expect(inv?.entries.find((e) => e.itemId === "M1")?.state).toBe("present");
    expect(inv?.entries.find((e) => e.itemId === "C2")?.state).toBe("absent");
    expect(inv?.entries).toHaveLength(CHECKLIST.items.length);
  });

  it("seals a position on submit and keeps the plaintext out of the log", () => {
    const svc = service();
    opened(svc);
    const r = svc.submit("c1", pos("ann", { reasoning: "SECRET", citedFindingIds: ["f-hep"] }));
    expect(r.ok).toBe(true);
    const sealed = svc.audit("c1").entries.filter((e) => e.kind === "position_sealed");
    expect(sealed).toHaveLength(1);
    expect(JSON.stringify(sealed[0]!.payload)).not.toContain("SECRET");
    expect(JSON.stringify(sealed[0]!.payload)).toContain("commitment");
  });

  it("hides other positions until reveal, then shows them", () => {
    const svc = service();
    opened(svc);
    svc.submit("c1", pos("ann", { call: "do_not_advance", reasoning: "ANN-ONLY", citedFindingIds: ["f-hep"] }));
    expect(JSON.stringify(svc.view("c1", "bea"))).not.toContain("ANN-ONLY");

    svc.submit("c1", pos("bea", { citedFindingIds: ["f-rodent"] }));
    svc.reveal("c1", "owner", "2026-08-09T12:00:00Z", "all_in");
    expect(JSON.stringify(svc.view("c1", "bea"))).toContain("ANN-ONLY");
  });

  it("passes its own audit end to end", () => {
    const svc = service();
    opened(svc);
    svc.submit("c1", pos("ann", { citedFindingIds: ["f-hep"] }));
    svc.submit("c1", pos("bea", { external: [{ claim: "Class effect.", source: "Smith 2019" }] }));
    svc.reveal("c1", "owner", "t", "all_in");
    svc.adjudicate("c1", { verdict: "cannot_conclude" }, "t", "model");
    svc.signOff("c1", { by: "owner", at: "t", agreesWithAdjudication: true, reason: "" });

    const audit = svc.audit("c1");
    expect(audit.chain).toEqual([]);
    expect(audit.seals).toEqual([]);
    expect(audit.entries.map((e) => e.kind)).toEqual([
      "case_opened", "inventory_published", "position_sealed", "position_sealed",
      "revealed", "adjudicated", "signed",
    ]);
  });

  it("keeps the chain valid when two cases interleave", () => {
    const store = new MemoryStore();
    const svc = new DeliberationService(store, CHECKLIST);
    opened(svc);
    svc.open({ caseId: "c2", compoundLabel: "Other", context: "", ownerId: "owner", participantIds: ["ann"], findings: [], at: "t" });
    svc.submit("c1", pos("ann", { citedFindingIds: ["f-hep"] }));
    svc.submit("c2", pos("ann"));
    expect(verifyChain(store.all())).toEqual([]);
    expect(svc.audit("c1").chain).toEqual([]);
  });

  it("builds an adjudication request whose gaps are the list the humans read", () => {
    const svc = service();
    opened(svc);
    svc.submit("c1", pos("ann", { citedFindingIds: ["f-hep"] }));
    svc.submit("c1", pos("bea", { external: [{ claim: "This assay overcalls." }] }));
    svc.reveal("c1", "owner", "t", "all_in");

    const req = svc.adjudicationRequest("c1", RULES);
    expect(req?.findings.map((f) => f.id)).toEqual(["f-hep", "f-rodent"]);
    const fields = req!.absent.map((a) => a.field);
    expect(fields).toContain("Exposure margin: tested concentration or NOAEL against projected human Cmax");
    // The scientist's uncited expertise reaches the model as an open question rather
    // than being dropped - the difference between a citation requirement people work
    // with and one they route around.
    expect(fields.some((f) => f.includes("This assay overcalls"))).toBe(true);
    expect(fields).not.toContain("Human-cell hepatotoxicity result");
  });

  it("refuses to adjudicate before the reveal", () => {
    const svc = service();
    opened(svc);
    svc.submit("c1", pos("ann", { citedFindingIds: ["f-hep"] }));
    const r = svc.adjudicate("c1", {}, "t", "model");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_locked");
  });

  it("reproduces the TAK-994 beat: everyone agrees, and the gap is named anyway", () => {
    const svc = service();
    opened(svc, ["ann", "bea", "cal"]);
    svc.submit("c1", pos("ann", { citedFindingIds: ["f-rodent"] }));
    svc.submit("c1", pos("bea", { citedFindingIds: ["f-rodent"] }));
    svc.submit("c1", pos("cal", { reasoning: "Looks fine to me." }));
    svc.reveal("c1", "owner", "t", "all_in");

    const u = svc.unanimity("c1")!;
    expect(u.unanimous).toBe(true);
    expect(u.call).toBe("advance");
    const joined = u.concerns.join(" ");
    expect(joined).toContain("cal");
    expect(joined).toContain("nobody tested");
    expect(joined).toContain("Exposure margin");
  });

  it("records non-responders when the owner closes early", () => {
    const svc = service();
    opened(svc, ["ann", "bea", "cal"]);
    svc.submit("c1", pos("ann", { citedFindingIds: ["f-hep"] }));
    const r = svc.reveal("c1", "owner", "2026-08-09T12:00:00Z", "close_early");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.closedEarly?.nonResponders).toEqual(["bea", "cal"]);
  });

  it("rejects a citation that names nothing in the case", () => {
    const svc = service();
    opened(svc);
    const r = svc.submit("c1", pos("ann", { citedFindingIds: ["ghost"] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("unknown_finding_id");
  });

  it("returns nothing for a case that does not exist rather than inventing one", () => {
    const svc = service();
    expect(svc.view("nope", "ann")).toBeNull();
    expect(svc.inventory("nope")).toBeNull();
    expect(svc.adjudicationRequest("nope", RULES)).toBeNull();
    expect(svc.unanimity("nope")).toBeNull();
  });
});
