import { describe, expect, it } from "vitest";
import { renderReportHtml, reportFilename, type ReportInput } from "../verdict-report.js";
import type { Adjudication } from "../adjudicate.js";

/**
 * The document that leaves the building.
 *
 * These cases are about what a reader who was never in the room is told. Every one of
 * them is a sentence that has to be ON the page: a stub labelled as a stub, a
 * dissenting position printed whole, a person who never answered named rather than
 * absent, and the signer's decision outranking the model's.
 *
 * The PDF pipeline is deliberately not exercised here - it starts a real browser, and
 * CI installs the browser after `npm test` runs. What is measured is the HTML the print
 * is made from, which is where every one of these facts is decided.
 */

const ADJ: Adjudication = {
  mechanism: { present: true, pathway: "BSEP inhibition at 10uM.", citedFindingIds: ["f-hep"] },
  consequence: { verdict: "cannot_conclude", reasoning: "No exposure margin was established.", citedFindingIds: [] },
  consequenceBasis: [],
  ruleDisclosure: [
    { ruleId: "R1", position: "applies", reasoning: "Human-cell evidence is present.", citedFindingIds: ["f-hep"] },
    { ruleId: "R3", position: "cannot_determine", reasoning: "No margin was measured.", citedFindingIds: [] },
  ],
  missing: [{ field: "Exposure margin", whyItMatters: "R3 cannot be applied." }],
  nextExperiment: "Measure Cmax against the tested concentration.",
};

const base = (over: Partial<ReportInput> = {}): ReportInput => ({
  caseId: "case_1",
  compoundLabel: "ARB-114",
  context: "Once-daily oral, 12-week dosing.",
  status: "signed",
  owner: { id: "u-own", displayName: "R. Okafor", email: "r@arbiter.demo", seat: null },
  panel: [
    { id: "u-a", displayName: "A. Silva", email: "a@arbiter.demo", seat: 0 },
    { id: "u-b", displayName: "B. Mehta", email: "b@arbiter.demo", seat: 1 },
  ],
  positions: [
    {
      participantId: "u-a", call: "do_not_advance",
      reasoning: "The transporter signal is real and nothing measures the margin.",
      citedFindingIds: ["f-hep"], external: [], submittedAt: "2026-08-16T09:00:00.000Z",
    },
    {
      participantId: "u-b", call: "advance",
      reasoning: "This assay overcalls for the class.",
      citedFindingIds: [], external: [{ claim: "The assay overcalls for phenothiazines." }],
      submittedAt: "2026-08-16T09:30:00.000Z",
    },
  ],
  closedEarly: null,
  findings: [
    { id: "f-hep", label: "Human hepatocyte", assertion: "toxic", detail: "Signal at 10uM.", sourceDocument: "FDA NDA 211810", sourcePage: 26 },
  ],
  inventory: {
    checklistVersion: "1.0",
    modality: "small_molecule",
    unmappedFindingIds: [],
    entries: [
      { itemId: "C2", half: "consequence", field: "Exposure margin", whatItBlocks: "R3 cannot be applied.", state: "absent", findingIds: [] },
      { itemId: "M1", half: "mechanism", field: "Human-cell result", whatItBlocks: "R1 cannot be applied.", state: "present", findingIds: ["f-hep"] },
    ],
  },
  unanimity: { unanimous: false, call: null, concerns: [] },
  disagreement: {
    split: [
      { call: "advance", participantIds: ["u-b"] },
      { call: "do_not_advance", participantIds: ["u-a"] },
    ],
    contested: [],
    oneSided: [{ findingId: "f-hep", call: "do_not_advance" }],
  },
  adjudication: ADJ,
  adjudicationSource: "live",
  adjudicatedAt: "2026-08-16T10:00:00.000Z",
  signature: { by: "u-own", at: "2026-08-16T11:00:00.000Z", agreesWithAdjudication: true, reason: "" },
  audit: { chainFailures: 0, sealFailures: 0, entries: 9, headHash: "a".repeat(64) },
  generatedBy: { id: "u-a", displayName: "A. Silva", email: "a@arbiter.demo", seat: 0 },
  generatedAt: "2026-08-16T12:00:00.000Z",
  ...over,
});

describe("the deliberation record", () => {
  it("prints every position in full, including the one that disagreed", () => {
    // The whole reason this exists. A summary would be a document choosing which
    // dissent to carry, on the artefact most likely to be the only thing anybody reads.
    const html = renderReportHtml(base());
    expect(html).toContain("The transporter signal is real and nothing measures the margin.");
    expect(html).toContain("This assay overcalls for the class.");
    expect(html).toContain("A. Silva");
    expect(html).toContain("B. Mehta");
  });

  it("names an unsourced external claim as untested rather than as evidence", () => {
    const html = renderReportHtml(base());
    expect(html).toContain("The assay overcalls for phenothiazines.");
    expect(html).toContain("no source given");
  });

  it("says whose decision it was, and that the model did not make it", () => {
    const html = renderReportHtml(base());
    expect(html).toContain("Signed");
    expect(html).toContain("R. Okafor");
    // §6.7 on paper: a committee advises, one named individual decides.
    expect(html).toContain("It decided nothing");
  });

  it("prints an override as the decision, naming the call it overrode", () => {
    const html = renderReportHtml(base({
      signature: { by: "u-own", at: "2026-08-16T11:00:00.000Z", agreesWithAdjudication: false, reason: "The margin is 40x." },
    }));
    expect(html).toContain("Overridden");
    expect(html).toContain("The margin is 40x.");
    // The overridden call is still named. A record that hid it would report the
    // adjudication's answer as the outcome.
    expect(html).toContain("Cannot conclude");
  });

  it("refuses to look decided when nobody has signed", () => {
    const html = renderReportHtml(base({ signature: null, status: "adjudicated" }));
    expect(html).toContain("Nobody has signed this");
    expect(html).toContain("deliberation in progress and not a decision");
  });

  it("labels a stub in the loudest warning the document has", () => {
    // An unlabelled stub in a PDF is the most dangerous artefact this repo can emit:
    // it looks exactly like a judgment about a compound.
    const html = renderReportHtml(base({ adjudicationSource: "stub" }));
    expect(html).toContain("STUB - NO MODEL WAS CALLED");
    expect(html).toContain("not a judgment about this compound");
    // And again in the metadata block, so a reader skimming the header sees it too.
    expect(html).toContain("STUB - no model");
  });

  it("carries no stub warning on a live adjudication", () => {
    expect(renderReportHtml(base())).not.toContain("STUB");
  });

  it("names the people who never answered instead of leaving a hole", () => {
    // Silence is not agreement, and a panel of two that printed as a panel of two
    // would report a unanimity that never happened.
    const html = renderReportHtml(base({
      positions: [base().positions[0]!],
      closedEarly: { by: "u-own", at: "2026-08-16T09:45:00.000Z", nonResponders: ["u-b"] },
    }));
    expect(html).toContain("never answered");
    expect(html).toContain("B. Mehta");
    expect(html).toContain("Their silence is not agreement");
  });

  it("prints an empty severity basis as a concern rather than as nothing", () => {
    // §0's defect in one field: a severity call resting on no measured
    // consequence-half evidence is invisible unless the empty list is on the page.
    expect(renderReportHtml(base())).toContain("names no measured consequence-half evidence");
  });

  it("keeps a rule nobody could answer distinct from a rule answered no", () => {
    const html = renderReportHtml(base());
    expect(html).toContain("cannot be determined from this package");
    expect(html).toContain("R3");
  });

  it("says the chain is intact, and what that does not prove", () => {
    const html = renderReportHtml(base());
    expect(html).toContain("Chain intact");
    expect(html).toContain("does not prove");
    expect(html).toContain("a".repeat(64));
  });

  it("does not hide tampering behind a clean-looking document", () => {
    const html = renderReportHtml(base({
      audit: { chainFailures: 2, sealFailures: 1, entries: 9, headHash: null },
    }));
    expect(html).toContain("TAMPERING DETECTED");
    expect(html).toContain("Do not rely on this document");
  });

  it("states that the paper itself carries no chain", () => {
    expect(renderReportHtml(base())).toContain("This paper carries no chain");
  });

  it("escapes what people typed instead of rendering it", () => {
    // A compound label and a reviewer's prose are free text, and this document is
    // markup handed to a browser.
    const html = renderReportHtml(base({
      compoundLabel: "<script>alert(1)</script>",
      positions: [{ ...base().positions[0]!, reasoning: "Margin <5x & falling" }],
    }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Margin &lt;5x &amp; falling");
  });

  it("fetches nothing at print time", () => {
    // Self-contained is what makes the same record produce the same document years
    // later, on a machine with no connectivity.
    const html = renderReportHtml(base());
    expect(html).not.toMatch(/<img|<script|https?:\/\//);
  });

  it("names the file after the compound, not after the case id", () => {
    // A folder of case_1174288393.pdf is a folder nobody can search.
    expect(reportFilename({ compoundLabel: "ARB-114", caseId: "case_1", generatedAt: "2026-08-16T12:00:00.000Z" }))
      .toBe("arbiter-arb-114-2026-08-16.pdf");
  });

  it("falls back to the case id when a label slugs to nothing", () => {
    expect(reportFilename({ compoundLabel: "///", caseId: "case_1", generatedAt: "2026-08-16T12:00:00.000Z" }))
      .toBe("arbiter-case-1-2026-08-16.pdf");
  });
});
