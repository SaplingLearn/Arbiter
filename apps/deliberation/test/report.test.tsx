import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReportPage, reportTitle } from "../src/report.js";
import type { CaseReport } from "../src/api.js";

/**
 * The document that leaves the building.
 *
 * Every case here is a sentence that has to be ON the page for somebody who was never
 * in the room: a stub labelled as a stub, a dissenting position printed whole, a person
 * who never answered named rather than absent, and the signer's decision outranking the
 * model's. These are not layout tests - they are the honesty of the artefact.
 */

const report = (over: Partial<CaseReport> = {}): CaseReport => ({
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
    { id: "f-hep", label: "Human hepatocyte", assertion: "toxic", detail: "Signal at 10uM." },
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
  adjudication: {
    mechanism: { present: true, pathway: "BSEP inhibition.", citedFindingIds: ["f-hep"] },
    consequence: { verdict: "cannot_conclude", reasoning: "No exposure margin was established.", citedFindingIds: [] },
    ruleDisclosure: [
      { ruleId: "R1", position: "applies", reasoning: "Human-cell evidence is present.", citedFindingIds: ["f-hep"] },
      { ruleId: "R3", position: "cannot_determine", reasoning: "No margin was measured.", citedFindingIds: [] },
    ],
    missing: [{ field: "Exposure margin", whyItMatters: "R3 cannot be applied." }],
    nextExperiment: "Measure Cmax against the tested concentration.",
  },
  adjudicationSource: "live",
  adjudicatedAt: "2026-08-16T10:00:00.000Z",
  signature: { by: "u-own", at: "2026-08-16T11:00:00.000Z", agreesWithAdjudication: true, reason: "" },
  audit: { chainFailures: 0, sealFailures: 0, entries: 9, headHash: "a".repeat(64) },
  generatedBy: { id: "u-a", displayName: "A. Silva", email: "a@arbiter.demo", seat: 0 },
  generatedAt: "2026-08-16T12:00:00.000Z",
  ...over,
});

describe("the printable record", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("prints every position in full, including the one that disagreed", () => {
    // The whole reason this exists. A summary would be a document choosing which
    // dissent to carry, on the artefact most likely to be the only thing anybody reads.
    render(<ReportPage report={report()} />);
    expect(screen.getByText("The transporter signal is real and nothing measures the margin.")).toBeInTheDocument();
    expect(screen.getByText("This assay overcalls for the class.")).toBeInTheDocument();
    expect(screen.getAllByText("A. Silva").length).toBeGreaterThan(0);
    expect(screen.getAllByText("B. Mehta").length).toBeGreaterThan(0);
  });

  it("names an unsourced external claim as untested rather than as evidence", () => {
    render(<ReportPage report={report()} />);
    expect(screen.getByText(/The assay overcalls for phenothiazines/)).toBeInTheDocument();
    expect(screen.getByText(/no source given/)).toBeInTheDocument();
  });

  it("says whose decision it was, and that the model did not make it", () => {
    render(<ReportPage report={report()} />);
    // Named twice on purpose - as the signer, and as the convener in the header - so
    // this asserts the decision line rather than any mention of them.
    expect(screen.getByText(/^by/)).toHaveTextContent("by R. Okafor on 2026-08-16 11:00 UTC");
    expect(screen.getByText(/It decided nothing/)).toBeInTheDocument();
  });

  it("prints an override as the decision, naming the call it overrode", () => {
    render(<ReportPage report={report({
      signature: { by: "u-own", at: "2026-08-16T11:00:00.000Z", agreesWithAdjudication: false, reason: "The margin is 40x." },
    })} />);
    expect(screen.getByText("Overridden")).toBeInTheDocument();
    expect(screen.getByText("The margin is 40x.")).toBeInTheDocument();
    // The overridden call is still named: a record that hid it would report the
    // adjudication's answer as the outcome.
    expect(screen.getAllByText("Cannot conclude").length).toBeGreaterThan(0);
  });

  it("refuses to look decided when nobody has signed", () => {
    render(<ReportPage report={report({ signature: null, status: "adjudicated" })} />);
    expect(screen.getByText(/Nobody has signed this/)).toBeInTheDocument();
    expect(screen.getByText(/deliberation in progress and not a decision/)).toBeInTheDocument();
  });

  it("labels a stub in the loudest warning the document has", () => {
    // An unlabelled stub is the most dangerous artefact this repo can emit: it looks
    // exactly like a judgment about a compound.
    render(<ReportPage report={report({ adjudicationSource: "stub" })} />);
    expect(screen.getByText(/STUB - NO MODEL WAS CALLED/)).toBeInTheDocument();
    expect(screen.getByText(/not a judgment about this compound/)).toBeInTheDocument();
    // And again in the metadata, so a reader skimming the header sees it too.
    expect(screen.getByText(/STUB - no model/)).toBeInTheDocument();
  });

  it("carries no stub warning on a live adjudication", () => {
    const { container } = render(<ReportPage report={report()} />);
    expect(container.textContent).not.toContain("STUB");
  });

  it("names the people who never answered instead of leaving a hole", () => {
    // Silence is not agreement, and a panel of two printing as a panel of one would
    // report a unanimity that never happened.
    render(<ReportPage report={report({
      positions: [report().positions[0]!],
      closedEarly: { by: "u-own", at: "2026-08-16T09:45:00.000Z", nonResponders: ["u-b"] },
    })} />);
    expect(screen.getByText(/never answered/)).toBeInTheDocument();
    expect(screen.getByText(/Their silence is not agreement/)).toBeInTheDocument();
    expect(screen.getByText("no answer")).toBeInTheDocument();
  });

  it("keeps a rule nobody could answer distinct from a rule answered no", () => {
    render(<ReportPage report={report()} />);
    expect(screen.getByText("cannot be determined from this package")).toBeInTheDocument();
  });

  it("says the chain is intact, and what that does not prove", () => {
    render(<ReportPage report={report()} />);
    expect(screen.getByText(/Chain intact/)).toBeInTheDocument();
    expect(screen.getByText(/What it does not prove/)).toBeInTheDocument();
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
  });

  it("does not hide tampering behind a clean-looking document", () => {
    render(<ReportPage report={report({
      audit: { chainFailures: 2, sealFailures: 1, entries: 9, headHash: null },
    })} />);
    expect(screen.getByText(/TAMPERING DETECTED/)).toBeInTheDocument();
    expect(screen.getByText(/Do not rely on this document/)).toBeInTheDocument();
  });

  it("states that a printed copy carries no chain", () => {
    render(<ReportPage report={report()} />);
    expect(screen.getByText(/carries no chain/)).toBeInTheDocument();
  });

  it("prints the reader's own browser dialog rather than downloading anything", () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<ReportPage report={report()} />);
    fireEvent.click(screen.getByRole("button", { name: /Print or save as PDF/ }));
    expect(print).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("keeps the controls off the printed page", () => {
    // A button reading "Print or save as PDF" printed onto page one is the tell of a
    // page that never had a print stylesheet.
    const { container } = render(<ReportPage report={report()} />);
    const bar = container.querySelector(".rep-bar");
    expect(bar).not.toBeNull();
    expect(bar?.className).toContain("no-print");
    // And the sheet itself is not inside the bar, so hiding one never hides the other.
    expect(container.querySelector(".rep-bar .report-sheet")).toBeNull();
  });

  it("names the tab after the compound, which is what the save dialog proposes", () => {
    // Chrome takes its default filename from document.title, and that is the only
    // influence a page has over it.
    render(<ReportPage report={report()} />);
    expect(document.title).toBe("arbiter-arb-114-2026-08-16");
  });

  it("gives the reader a way back to the case", () => {
    const { container } = render(<ReportPage report={report()} />);
    expect(container.querySelector('a[href="#/case/case_1/reveal"]')).not.toBeNull();
  });

  it("falls back to the case id when a label slugs to nothing", () => {
    // A folder of case_1174288393.pdf is a folder nobody can search - but a label of
    // punctuation is worse than the id.
    expect(reportTitle({ compoundLabel: "///", caseId: "case_1", generatedAt: "2026-08-16T12:00:00.000Z" }))
      .toBe("arbiter-case-1-2026-08-16");
  });
});
