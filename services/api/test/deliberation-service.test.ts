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
    expect(svc.disagreement("nope")).toBeNull();
  });

  it("reports the split for a divided room, and which findings each camp rests on", () => {
    // The case this product is named for. disagreementReport has been implemented
    // and unit tested since the deliberation was built and reachable from nothing:
    // no service method, no route, no client call, no component. A split room saw
    // raw positions side by side and no analysis of them at all.
    const svc = service();
    opened(svc, ["ann", "bea", "cai"]);
    svc.submit("c1", pos("ann", { call: "do_not_advance", citedFindingIds: ["f-hep"] }));
    svc.submit("c1", pos("bea", { call: "advance", citedFindingIds: ["f-rodent"] }));
    svc.submit("c1", pos("cai", { call: "advance", citedFindingIds: ["f-hep"] }));
    svc.reveal("c1", "owner", "2026-08-09T12:00:00Z", "all_in");

    const r = svc.disagreement("c1");
    expect(r?.split.map((s) => s.call).sort()).toEqual(["advance", "do_not_advance"]);
    // f-hep is cited by ann (do_not_advance) and cai (advance): the same finding
    // carrying opposite conclusions, which is a dispute about meaning rather than
    // about measurement.
    expect(r?.contested).toEqual(["f-hep"]);
    // f-rodent is cited only from the advance camp, so it is evidence the other
    // side never answered.
    expect(r?.oneSided.map((o) => o.findingId)).toEqual(["f-rodent"]);
  });

  it("refuses BOTH post-reveal reports while the case is still open", () => {
    // A LEAK, found by driving the real HTTP routes on 2026-08-14, and it predates
    // the disagreement report: with one position submitted, GET unanimity answered
    // {"unanimous":true,"call":"do_not_advance"} on an OPEN case. That is the call
    // of the only person who has answered, which is precisely what the blind phase
    // exists to withhold.
    //
    // Nobody noticed because App.tsx only requests these once status leaves "open".
    // But blindness in this product is enforced by the server not returning the
    // data, never by the client declining to ask for it - `visibleTo` is written
    // that way on purpose - and these two read c.positions directly, going around
    // it. A disciplined client is not a guarantee; it is a habit.
    const svc = service();
    opened(svc);
    svc.submit("c1", pos("ann", { call: "do_not_advance", citedFindingIds: ["f-hep"] }));

    expect(svc.unanimity("c1")).toBeNull();
    expect(svc.disagreement("c1")).toBeNull();

    svc.submit("c1", pos("bea", { call: "advance", citedFindingIds: ["f-rodent"] }));
    svc.reveal("c1", "owner", "2026-08-09T12:00:00Z", "all_in");

    expect(svc.unanimity("c1")).not.toBeNull();
    expect(svc.disagreement("c1")).not.toBeNull();
  });

  it("returns null when the room agreed, which is an answer and not an error", () => {
    // The route must serve this as 200 with a null body. A 404 would say "no such
    // case", which is a different fact, and the client would treat agreement as a
    // failure on every unanimous case.
    const svc = service();
    opened(svc);
    svc.submit("c1", pos("ann"));
    svc.submit("c1", pos("bea"));
    svc.reveal("c1", "owner", "2026-08-09T12:00:00Z", "all_in");
    expect(svc.disagreement("c1")).toBeNull();
  });
});
