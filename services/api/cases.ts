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
 * FIVE ENTRIES, AND TWO OF THEM REFUSE.
 *
 * Four regulatory documents were collected; two produce cases and two cannot, and
 * the two that cannot are listed here rather than quietly dropped. A picker that
 * showed only what worked would suggest every document works, and the measured
 * reality - that most historical packages are unreadable - is the finding that
 * killed the original replay plan (HANDOVER §13.3). Selecting a refused case shows
 * the splitter's own reason, not a summary of it.
 *
 * The refusals also guard something. `data/prep/split_review.py` refuses rather than
 * trimming by hand, and if a refused document could still become a case, that
 * refusal would be decorative.
 */

export type CaseName = "tak994" | "nipocalimab" | "slynd" | "tolcapone" | "troglitazone";

export interface CaseSummary {
  name: CaseName;
  label: string;
  /** One line for the picker: what makes this case worth running. */
  shape: string;
  usable: boolean;
}

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
  /** Rendered above the inventory when the document itself limits what can be read
   *  from it. Present only where that is true; there is no default text. */
  documentScope?: string;
}

export interface RefusedCase {
  name: CaseName;
  label: string;
  document: string;
  /** Verbatim from data/prep/split_review.py, not a paraphrase. */
  splitterReason: string;
  measurement: string;
}

const REFUSED: Record<string, RefusedCase> = {
  tolcapone: {
    name: "tolcapone",
    label: "Tolcapone (Tasmar) - FDA medical review, 1998",
    document: "data/raw/approval-packages/tolcapone-20697-medical-review-p1.pdf",
    splitterReason: "48 of 48 pages carry almost no extractable text - this is a scanned document and needs OCR before anything can read it. REFUSED.",
    measurement: "48 pages, 48 embedded images, 0 extractable characters. A photograph of a document is not a document a program can read.",
  },
  troglitazone: {
    name: "troglitazone",
    label: "Troglitazone (Rezulin) - FDA approval package, 1997",
    document: "data/raw/approval-packages/troglitazone-020720-approval.pdf",
    splitterReason: "No nonclinical chapter heading found after the contents. REFUSED - do not trim by hand.",
    measurement: "133 pages and 162,478 extractable characters, so the text is readable - but ZERO occurrences of 'hepat' and no pharmacology/toxicology review. The retrievable file is a labelling supplement, not the review. Troglitazone was withdrawn for liver failure; the document that would show what was known beforehand is not the one that survives online.",
  },
};

export const CATALOGUE: CaseSummary[] = [
  { name: "tak994", label: "TAK-994 (narcolepsy)", shape: "Thin package, room agreed. 8 of 12 questions unanswered.", usable: true },
  { name: "nipocalimab", label: "Nipocalimab / Imaavy (myasthenia gravis)", shape: "Rich package, room splits three ways. Biologic, so 4 questions do not apply.", usable: true },
  { name: "slynd", label: "Slynd / drospirenone (contraception)", shape: "A 505(b)(2) with no new nonclinical studies at all. Almost nothing to cite.", usable: true },
  { name: "tolcapone", label: "Tolcapone / Tasmar (1998 review)", shape: "REFUSED - scanned images, zero extractable text.", usable: false },
  { name: "troglitazone", label: "Troglitazone / Rezulin (1997 package)", shape: "REFUSED - readable, but it is a labelling supplement with no tox review.", usable: false },
];

export function refusalFor(name: CaseName): RefusedCase | null {
  return REFUSED[name] ?? null;
}

/** The rule set lives with the probe case and is the same for every case: §5.2 -
 *  rules are fixed and versioned, and never customised per compound or per person. */
function rules(): AdjudicateRequest["rules"] {
  return (JSON.parse(readFileSync("data/probe-case.json", "utf8")) as { rules: AdjudicateRequest["rules"] }).rules;
}

interface CaseFile {
  caseId: string;
  compoundLabel: string;
  context: string;
  modality: Modality;
  findings: CoveringFinding[];
  documentScope?: string;
  _source: { document: string; chapterUsed: string };
}

function fromFile(name: CaseName, path: string): LoadedCase {
  const c = JSON.parse(readFileSync(path, "utf8")) as CaseFile;
  return {
    name,
    caseId: c.caseId,
    compoundLabel: c.compoundLabel,
    context: c.context,
    modality: c.modality,
    findings: c.findings,
    rules: rules(),
    provenance: `${c._source.document} - ${c._source.chapterUsed}. Every finding carries the page it came from.`,
    ...(c.documentScope === undefined ? {} : { documentScope: c.documentScope }),
  };
}

/** Throws on a refused case. Callers check `refusalFor` first; a loader that
 *  invented an empty case for an unreadable document would make the refusal
 *  decorative. */
export function loadCase(name: CaseName): LoadedCase {
  const refused = refusalFor(name);
  if (refused !== null) {
    throw new Error(`Case "${name}" is refused: ${refused.splitterReason}`);
  }

  if (name === "nipocalimab") return fromFile(name, "data/cases/nipocalimab-imaavy.json");
  if (name === "slynd") return fromFile(name, "data/cases/slynd-drospirenone.json");

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
    modality: "small_molecule",
    findings: probe.findings.map((f) => ({ ...f, covers: cov.coverage[f.id] ?? [] })),
    rules: rules(),
    provenance: "data/out/tak994.json, citations UNVERIFIED upstream - acceptable for a stability measurement, not for a scored result.",
  };
}

export function isCaseName(u: unknown): u is CaseName {
  return CATALOGUE.some((c) => c.name === u);
}
