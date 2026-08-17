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

const opened = async (svc: DeliberationService, participants = ["ann", "bea"]): Promise<void> => {
  await svc.open({
    caseId: "c1", compoundLabel: "TAK-994", context: "Chronic dosing, healthy adults.",
    ownerId: "owner", participantIds: participants, findings: FINDINGS, at: "2026-08-09T09:00:00Z",
  });
};

describe("DeliberationService - the whole path with no model in it", () => {
  it("publishes an inventory at open and never recomputes it", async () => {
    const svc = service();
    await opened(svc);
    const inv = await svc.inventory("c1");
    expect(inv?.entries.find((e) => e.itemId === "M1")?.state).toBe("present");
    expect(inv?.entries.find((e) => e.itemId === "C2")?.state).toBe("absent");
    expect(inv?.entries).toHaveLength(CHECKLIST.items.length);
  });

  it("seals a position on submit and keeps the plaintext out of the log", async () => {
    const svc = service();
    await opened(svc);
    const r = await svc.submit("c1", pos("ann", { reasoning: "SECRET", citedFindingIds: ["f-hep"] }));
    expect(r.ok).toBe(true);
    const sealed = (await svc.audit("c1")).entries.filter((e) => e.kind === "position_sealed");
    expect(sealed).toHaveLength(1);
    expect(JSON.stringify(sealed[0]!.payload)).not.toContain("SECRET");
    expect(JSON.stringify(sealed[0]!.payload)).toContain("commitment");
  });

  it("hides other positions until reveal, then shows them", async () => {
    const svc = service();
    await opened(svc);
    await svc.submit("c1", pos("ann", { call: "do_not_advance", reasoning: "ANN-ONLY", citedFindingIds: ["f-hep"] }));
    expect(JSON.stringify(await svc.view("c1", "bea"))).not.toContain("ANN-ONLY");

    await svc.submit("c1", pos("bea", { citedFindingIds: ["f-rodent"] }));
    await svc.reveal("c1", "owner", "2026-08-09T12:00:00Z", "all_in");
    expect(JSON.stringify(await svc.view("c1", "bea"))).toContain("ANN-ONLY");
  });

  it("passes its own audit end to end", async () => {
    const svc = service();
    await opened(svc);
    await svc.submit("c1", pos("ann", { citedFindingIds: ["f-hep"] }));
    await svc.submit("c1", pos("bea", { external: [{ claim: "Class effect.", source: "Smith 2019" }] }));
    await svc.reveal("c1", "owner", "t", "all_in");
    await svc.adjudicate("c1", { verdict: "cannot_conclude" }, "t", "model");
    await svc.signOff("c1", { by: "owner", at: "t", agreesWithAdjudication: true, reason: "" });

    const audit = await svc.audit("c1");
    expect(audit.chain).toEqual([]);
    expect(audit.seals).toEqual([]);
    expect(audit.entries.map((e) => e.kind)).toEqual([
      "case_opened", "inventory_published", "position_sealed", "position_sealed",
      "revealed", "adjudicated", "signed",
    ]);
  });

  it("keeps the chain valid when two cases interleave", async () => {
    const store = new MemoryStore();
    const svc = new DeliberationService(store, CHECKLIST);
    await opened(svc);
    await svc.open({ caseId: "c2", compoundLabel: "Other", context: "", ownerId: "owner", participantIds: ["ann"], findings: [], at: "t" });
    await svc.submit("c1", pos("ann", { citedFindingIds: ["f-hep"] }));
    await svc.submit("c2", pos("ann"));
    expect(verifyChain(await store.all())).toEqual([]);
    expect((await svc.audit("c1")).chain).toEqual([]);
  });

  it("builds an adjudication request whose gaps are the list the humans read", async () => {
    const svc = service();
    await opened(svc);
    await svc.submit("c1", pos("ann", { citedFindingIds: ["f-hep"] }));
    await svc.submit("c1", pos("bea", { external: [{ claim: "This assay overcalls." }] }));
    await svc.reveal("c1", "owner", "t", "all_in");

    const req = await svc.adjudicationRequest("c1", RULES);
    expect(req?.findings.map((f) => f.id)).toEqual(["f-hep", "f-rodent"]);
    const fields = req!.absent.map((a) => a.field);
    expect(fields).toContain("Exposure margin: tested concentration or NOAEL against projected human Cmax");
    // The scientist's uncited expertise reaches the model as an open question rather
    // than being dropped - the difference between a citation requirement people work
    // with and one they route around.
    expect(fields.some((f) => f.includes("This assay overcalls"))).toBe(true);
    expect(fields).not.toContain("Human-cell hepatotoxicity result");
  });

  it("refuses to adjudicate before the reveal", async () => {
    const svc = service();
    await opened(svc);
    await svc.submit("c1", pos("ann", { citedFindingIds: ["f-hep"] }));
    const r = await svc.adjudicate("c1", {}, "t", "model");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_locked");
  });

  /* THE VERDICT HAS TO SURVIVE A PAGE RELOAD, and for a long time it did not. The
     adjudication was returned once, by the POST that produced it, and lived only in
     the browser tab that made the call - so `Reveal & verdict` was empty on every
     signed case in the corpus, and empty again for the owner the moment they
     refreshed. The record held the adjudication the whole time; nothing served it. */
  it("serves the stored adjudication to everyone on the case once there is one", async () => {
    const svc = service();
    await opened(svc);
    await svc.submit("c1", pos("ann", { citedFindingIds: ["f-hep"] }));
    await svc.submit("c1", pos("bea", { citedFindingIds: ["f-rodent"] }));
    await svc.reveal("c1", "owner", "t", "all_in");
    expect((await svc.view("c1", "ann"))?.adjudication).toBeNull();

    await svc.adjudicate("c1", { consequence: { verdict: "do_not_advance" } }, "t", "model");

    // Not just the owner who ran it: a participant reads the verdict they are being
    // asked to live with.
    for (const who of ["owner", "ann", "bea"]) {
      const v = (await svc.view("c1", who))!;
      expect(v.adjudication).toEqual({ consequence: { verdict: "do_not_advance" } });
      expect(v.adjudicationSource).toBe("live");
    }
  });

  /* A STUB MUST NEVER LOSE ITS LABEL ON THE WAY OUT. The seeded turalio record was
     adjudicated by the stub, and rendering that text with the banner dropped would
     put words that are explicitly not a judgment about a compound onto a signed
     safety record as though they were one. */
  it("keeps a signed case's adjudication readable, and keeps a stub labelled as one", async () => {
    const svc = service();
    await opened(svc);
    await svc.submit("c1", pos("ann", { citedFindingIds: ["f-hep"] }));
    await svc.submit("c1", pos("bea", { citedFindingIds: ["f-rodent"] }));
    await svc.reveal("c1", "owner", "t", "all_in");
    await svc.adjudicate("c1", { consequence: { verdict: "cannot_conclude" } }, "t", "stub");
    await svc.signOff("c1", { by: "owner", at: "t", agreesWithAdjudication: false, reason: "Holding for a margin." });

    const v = (await svc.view("c1", "ann"))!;
    expect(v.status).toBe("signed");
    expect(v.adjudication).toEqual({ consequence: { verdict: "cannot_conclude" } });
    expect(v.adjudicationSource).toBe("stub");
    expect(v.signature?.agreesWithAdjudication).toBe(false);
    expect(v.signature?.reason).toBe("Holding for a margin.");
  });

  /* THE VERDICT SCREEN AND THE PRINTED RECORD MUST NOT DISAGREE ABOUT PROVENANCE.
     `view` and `adjudication` are two readers of one fact, and they briefly held two
     rules for deciding it: one treated any unrecognised actor as live, the other treated
     only "model" as live. They arrived from two branches and merged with no conflict, so
     the disagreement would have shipped as a screen saying "adjudicated by a model" over
     a document saying "stub" - about the same signed safety record. Both now read
     `sourceOf`, and this pins that they answer together, including on the actor neither
     of them was written for. */
  for (const [actor, expected] of [["model", "live"], ["stub", "stub"], ["owner", "stub"]] as const) {
    it(`reports an adjudication by "${actor}" as ${expected} on the case view and in the record alike`, async () => {
      const svc = service();
      await opened(svc);
      await svc.submit("c1", pos("ann", { citedFindingIds: ["f-hep"] }));
      await svc.submit("c1", pos("bea", { citedFindingIds: ["f-rodent"] }));
      await svc.reveal("c1", "owner", "t", "all_in");
      await svc.adjudicate("c1", { consequence: { verdict: "cannot_conclude" } }, "t", actor);

      expect((await svc.view("c1", "ann"))?.adjudicationSource).toBe(expected);
      expect((await svc.adjudication("c1"))?.source).toBe(expected);
    });
  }

  /* An unadjudicated case has nothing to report, and `handleReport` turns this null into
     the 409 that names the state rather than printing a record with a blank verdict. */
  it("reports no adjudication at all before one is attached", async () => {
    const svc = service();
    await opened(svc);
    expect(await svc.adjudication("c1")).toBeNull();
    expect(await svc.adjudication("c-nonexistent")).toBeNull();
  });

  it("reproduces the TAK-994 beat: everyone agrees, and the gap is named anyway", async () => {
    const svc = service();
    await opened(svc, ["ann", "bea", "cal"]);
    await svc.submit("c1", pos("ann", { citedFindingIds: ["f-rodent"] }));
    await svc.submit("c1", pos("bea", { citedFindingIds: ["f-rodent"] }));
    await svc.submit("c1", pos("cal", { reasoning: "Looks fine to me." }));
    await svc.reveal("c1", "owner", "t", "all_in");

    const u = (await svc.unanimity("c1"))!;
    expect(u.unanimous).toBe(true);
    expect(u.call).toBe("advance");
    const joined = u.concerns.join(" ");
    expect(joined).toContain("cal");
    expect(joined).toContain("nobody tested");
    expect(joined).toContain("Exposure margin");
  });

  it("records non-responders when the owner closes early", async () => {
    const svc = service();
    await opened(svc, ["ann", "bea", "cal"]);
    await svc.submit("c1", pos("ann", { citedFindingIds: ["f-hep"] }));
    const r = await svc.reveal("c1", "owner", "2026-08-09T12:00:00Z", "close_early");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.closedEarly?.nonResponders).toEqual(["bea", "cal"]);
  });

  it("rejects a citation that names nothing in the case", async () => {
    const svc = service();
    await opened(svc);
    const r = await svc.submit("c1", pos("ann", { citedFindingIds: ["ghost"] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("unknown_finding_id");
  });

  it("returns nothing for a case that does not exist rather than inventing one", async () => {
    const svc = service();
    expect(await svc.view("nope", "ann")).toBeNull();
    expect(await svc.inventory("nope")).toBeNull();
    expect(await svc.adjudicationRequest("nope", RULES)).toBeNull();
    expect(await svc.unanimity("nope")).toBeNull();
  });
});
