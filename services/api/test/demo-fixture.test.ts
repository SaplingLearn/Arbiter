import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { DeliberationService } from "../deliberation-service.js";
import { MemoryStore, verifyChain } from "../store.js";
import { DEMO_FIXTURES, fixtureForSha } from "../demo-fixture.js";
import type { EvidenceChecklist } from "../inventory.js";
import type { Position } from "../deliberation.js";

const CHECKLIST = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;
const TUCATINIB = "data/raw/approval-packages/tucatinib-213411-multidiscipline.pdf";

const svc = (participants: string[]): DeliberationService => {
  const s = new DeliberationService(new MemoryStore(), CHECKLIST);
  s.open({
    caseId: "c1", compoundLabel: "Tucatinib", context: "Chronic dosing until progression.",
    ownerId: "owner", participantIds: participants, findings: [], at: "2026-08-16T09:00:00Z",
  });
  return s;
};

const seed = (s: DeliberationService, actor = "owner") =>
  s.seedFromFixture("c1", actor, "2026-08-16T10:00:00Z", DEMO_FIXTURES[0]!);

describe("the prepared fixture matches the document it claims", () => {
  /**
   * THE HASH IS THE IDENTITY. If this fails, either the file changed or the fixture
   * points at a different document - and in both cases every page number below is
   * meaningless, so it is checked before anything that depends on them.
   */
  it("names the sha256 of the file it was transcribed from", () => {
    if (!existsSync(TUCATINIB)) return; // not in this checkout; the quote test skips too
    const sha = createHash("sha256").update(readFileSync(TUCATINIB)).digest("hex");
    expect(DEMO_FIXTURES[0]!.sha256).toBe(sha);
    expect(fixtureForSha(sha.toUpperCase())).not.toBeNull();
  });

  /**
   * EVERY QUOTE, UNDER PDF.JS, ON THE PAGE IT NAMES.
   *
   * Checked with the engine the reader actually uses rather than with whichever PDF
   * library was convenient, because the two do not always agree and the disagreement
   * is invisible: PyMuPDF reports the micro sign on page 98 as U+00B5 and pdf.js reads
   * U+03BC. A quote carrying the wrong one is indistinguishable on screen, matches
   * nothing, and reaches a reader as "the passage could not be found on this page" -
   * which reads as a broken highlighter rather than as a bad quote. One fixture quote
   * was written that way and this test is why it is not still written that way.
   *
   * The comparison is `highlightRects`': whitespace removed from both sides, every
   * other character identical.
   */
  it("puts every quote on the page it names", async () => {
    if (!existsSync(TUCATINIB)) return;
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await getDocument({ url: pathToFileURL(TUCATINIB).href, useSystemFonts: true }).promise;
    const bare = (s: string): string => s.replace(/\s+/g, "");
    try {
      for (const f of DEMO_FIXTURES[0]!.findings) {
        const content = await (await doc.getPage(f.sourcePage)).getTextContent();
        const page = bare(content.items.map((i) => ("str" in i ? i.str : "")).join(""));
        expect(page.includes(bare(f.sourceQuote)), `${f.id} on page ${f.sourcePage}`).toBe(true);
      }
    } finally {
      await doc.destroy();
    }
  }, 60_000);

  /**
   * A verdict may only rest on consequence-half items the inventory calls PRESENT, and
   * `presentForAdjudication` excludes `inconclusive`. Measured against the live model,
   * a fixture that left injury pattern and dosing duration on `ambiguous` produced
   * cannot_conclude naming exactly those two. So every consequence item has to be
   * covered by a finding that asserts, and this is the test that says so.
   */
  it("covers all six consequence questions with findings that assert", () => {
    const s = svc(["ann", "bea", "cal"]);
    seed(s);
    const inv = s.inventory("c1")!;
    for (const id of ["C1", "C2", "C3", "C4", "C5", "C6"]) {
      expect(inv.entries.find((e) => e.itemId === id)?.state, id).toBe("present");
    }
    expect(inv.entries.filter((e) => e.state === "inconclusive")).toHaveLength(0);
  });

  it("leaves the mechanism questions a regulatory review cannot answer absent", () => {
    const s = svc(["ann"]);
    seed(s);
    const inv = s.inventory("c1")!;
    // Not a defect of the fixture: M1, M4 and M6 are internal screening assays that
    // appear in a sponsor's own reports and never in an agency's summary of them.
    for (const id of ["M1", "M4", "M6"]) {
      expect(inv.entries.find((e) => e.itemId === id)?.state, id).toBe("absent");
    }
  });
});

describe("seeding a case from a recognised document", () => {
  it("adds every finding and seals a position for all but one seat", () => {
    const s = svc(["ann", "bea", "cal"]);
    const r = seed(s, "owner");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.findingsAdded).toBe(DEMO_FIXTURES[0]!.findings.length);
    // The owner is not a participant, so the FIRST seat is the one held open - the
    // top row of the roster panel, which is the one a person can find on a screen.
    expect(r.value.leftOpenFor).toBe("ann");
    expect(r.value.positionsSealed).toBe(2);
    expect(r.value.skipped).toEqual([]);
  });

  /**
   * The open seat is the POINT, not a shortfall: the reveal is gated on everybody
   * having answered, so a fixture that filled every seat would hand back a case whose
   * next step was already done and skip the stage the product is most about.
   */
  it("holds the reveal until the open seat answers", () => {
    const s = svc(["ann", "bea", "cal"]);
    seed(s);
    expect(s.reveal("c1", "owner", "2026-08-16T11:00:00Z", "all_in").ok).toBe(false);

    const p: Position = {
      participantId: "ann", call: "cannot_conclude", reasoning: "Mine.",
      citedFindingIds: [], external: [], submittedAt: "2026-08-16T11:05:00Z",
    };
    expect(s.submit("c1", p).ok).toBe(true);
    expect(s.reveal("c1", "owner", "2026-08-16T11:10:00Z", "all_in").ok).toBe(true);
  });

  it("holds open the uploader's own seat when they are on the panel", () => {
    const s = svc(["ann", "bea", "cal"]);
    const r = seed(s, "ann");
    expect(r.ok && r.value.leftOpenFor).toBe("ann");
    expect(r.ok && r.value.positionsSealed).toBe(2);
  });

  /** The record must say the evidence was seeded, and say it BEFORE the evidence. */
  it("writes demo_seeded into the chain ahead of what it seeded", () => {
    const store = new MemoryStore();
    const s = new DeliberationService(store, CHECKLIST);
    s.open({
      caseId: "c1", compoundLabel: "Tucatinib", context: "x",
      ownerId: "owner", participantIds: ["ann", "bea"], findings: [], at: "2026-08-16T09:00:00Z",
    });
    seed(s);

    const kinds = store.entries("c1").map((e) => e.kind);
    const seeded = kinds.indexOf("demo_seeded");
    expect(seeded).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf("position_sealed")).toBeGreaterThan(seeded);
    expect(verifyChain(store.entries("c1"))).toEqual([]);

    /**
     * NINE FINDINGS, ONE PUBLICATION. Seeding used to call addFinding in a loop, and
     * each call appends a fresh case_opened plus inventory_published - so the Record
     * stage opened with eighteen rows of bookkeeping above the first thing a reader
     * came to see. The evidence arrived as one document; the record says so once.
     */
    expect(kinds.filter((k) => k === "inventory_published")).toHaveLength(2); // open, then seed
    expect(kinds.filter((k) => k === "case_opened")).toHaveLength(2);

    const entry = store.entries("c1").find((e) => e.kind === "demo_seeded")!;
    expect((entry.payload as { sha256: string }).sha256).toBe(DEMO_FIXTURES[0]!.sha256);
  });

  /**
   * UPLOAD BEFORE ANYBODY ANSWERS. THIS IS THE ORDER, AND IT IS NOT NEGOTIABLE.
   *
   * `evidenceGuard` freezes the evidence the moment the first position is sealed -
   * §6.5, because a position cites a specific account of the evidence and evidence
   * that could change afterwards would put somebody on record endorsing an inventory
   * they never saw. So a fixture applied after an answer adds NOTHING: every finding
   * is refused, and the fixture positions that cite them are refused in turn for
   * citing findings the case does not have.
   *
   * That is the guard working, and it is why the seeding refuses ALL THE WAY rather
   * than half-applying. A case with the positions but not the findings would be worse
   * than a case with neither: it would show three people citing evidence nobody could
   * open. The counts say so plainly instead.
   */
  it("adds nothing once somebody has answered, and says why", () => {
    const s = svc(["ann", "bea", "cal"]);
    const mine: Position = {
      participantId: "ann", call: "advance", reasoning: "My own words.",
      citedFindingIds: [], external: [], submittedAt: "2026-08-16T09:30:00Z",
    };
    expect(s.submit("c1", mine).ok).toBe(true);

    const r = seed(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.findingsAdded).toBe(0);
    expect(r.value.positionsSealed).toBe(0);
    expect(r.value.skipped.length).toBeGreaterThan(0);

    // And the answer that was already there is untouched.
    s.submit("c1", { ...mine, participantId: "bea", submittedAt: "2026-08-16T11:00:00Z" });
    s.submit("c1", { ...mine, participantId: "cal", submittedAt: "2026-08-16T11:00:00Z" });
    expect(s.reveal("c1", "owner", "2026-08-16T11:10:00Z", "all_in").ok).toBe(true);
    const anns = s.view("c1", "owner")?.revealed?.find((p) => p.participantId === "ann");
    expect(anns?.reasoning).toBe("My own words.");
  });

  it("recognises nothing for bytes it has never seen", () => {
    expect(fixtureForSha("0".repeat(64))).toBeNull();
  });
});
