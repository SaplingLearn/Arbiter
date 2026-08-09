import { readFileSync } from "node:fs";
import type { CoveringFinding, Modality } from "./inventory.js";
import type { AdjudicateRequest } from "./adjudicate.js";

/**
 * The case library: ONE loader, used by both the terminal demo and the HTTP server.
 *
 * Shared on purpose. Two loaders is how the screen and the terminal come to disagree
 * about what the evidence is, and the first person to notice would be someone in the
 * audience holding a printout.
 *
 * TWO CASES, AND THEY TEST DIFFERENT THINGS.
 *
 * `tak994` leaves eight of twelve questions unanswered. It is the anchor because it
 * is what actually happened, and it is the case for the unanimity check - a room that
 * agreed about a package nobody had finished.
 *
 * `nipocalimab` is the opposite shape: a real EMA assessment report with the exposure
 * margin, the NOAEL, the recovery period and the dosing duration all stated, and with
 * the assessor openly rejecting the applicant's margin. A mostly-empty inventory
 * cannot test much - every position ends up resting on the same few findings, and
 * `not_applicable` never fires at all.
 */

export type CaseName = "tak994" | "nipocalimab";

export interface LoadedCase {
  name: CaseName;
  caseId: string;
  compoundLabel: string;
  context: string;
  modality: Modality;
  findings: CoveringFinding[];
  rules: AdjudicateRequest["rules"];
  /** Where a reader goes to check the findings against the source. */
  provenance: string;
}

/** The rule set lives with the probe case and is the same for every case: §5.2 -
 *  rules are fixed and versioned, and never customised per compound or per person. */
function rules(): AdjudicateRequest["rules"] {
  return (JSON.parse(readFileSync("data/probe-case.json", "utf8")) as { rules: AdjudicateRequest["rules"] }).rules;
}

export function loadCase(name: CaseName): LoadedCase {
  if (name === "tak994") {
    const probe = JSON.parse(readFileSync("data/probe-case.json", "utf8")) as {
      compoundLabel: string; context: string;
      findings: { id: string; label: string; assertion: "toxic" | "safe" | "ambiguous"; detail: string }[];
    };
    // Coverage is held in a SEPARATE file: data/probe-case.json is the pre-registered
    // input to the consistency probe and must not gain fields between the pass marks
    // being committed and the first live run.
    const cov = JSON.parse(readFileSync("data/probe-case-coverage.json", "utf8")) as { coverage: Record<string, string[]> };
    return {
      name,
      caseId: "tak994-demo",
      compoundLabel: probe.compoundLabel,
      context: probe.context,
      // A small molecule, so every checklist question applies.
      modality: "small_molecule",
      findings: probe.findings.map((f) => ({ ...f, covers: cov.coverage[f.id] ?? [] })),
      rules: rules(),
      provenance: "data/out/tak994.json, citations UNVERIFIED upstream - acceptable for a stability measurement, not for a scored result.",
    };
  }

  const c = JSON.parse(readFileSync("data/cases/nipocalimab-imaavy.json", "utf8")) as {
    caseId: string; compoundLabel: string; context: string;
    modality: Modality; findings: CoveringFinding[];
    _source: { document: string; chapterUsed: string };
  };
  return {
    name,
    caseId: c.caseId,
    compoundLabel: c.compoundLabel,
    context: c.context,
    modality: c.modality,
    findings: c.findings,
    rules: rules(),
    provenance: `${c._source.document} - ${c._source.chapterUsed}. Every finding carries the page it came from.`,
  };
}

export function isCaseName(u: unknown): u is CaseName {
  return u === "tak994" || u === "nipocalimab";
}
