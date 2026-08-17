import type { CaseReport } from "../../src/api.js";

/**
 * A full, internally-consistent case report to render in a test.
 *
 * SHARED BETWEEN report.test.tsx AND public.test.tsx, not duplicated. It used to live
 * only in report.test.tsx; the public page renders the same `ReportPage` component the
 * printable record does; a copy would drift the moment one suite's fixture grew a field
 * the other did not know to add, and the two tests would quietly stop testing the same
 * shape of data. There is nothing case-specific in it - every field is a stand-in - so
 * one function importable from both places is the whole fix.
 */
export const report = (over: Partial<CaseReport> = {}): CaseReport => ({
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
