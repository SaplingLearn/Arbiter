import { APP_URL, RESULTS_URL, RULESET_URL } from "../links.js";

/**
 * The six sections, in page order — copy only.
 *
 * NO `three` IMPORTS IN THIS FILE, however convenient it would be to keep a section's
 * scene next to its words. The shell reads this on first paint; the scenes are half a
 * megabyte of renderer behind a lazy boundary. See the note in `scenes/registry.ts`.
 *
 * ON THE COPY. Six sections is six chances to overclaim, and this product's entire
 * position is that it does not. So: no figures appear here. Not because there are none
 * — the harness produces them — but because a marketing page is the worst possible
 * place for a number to go stale, and this repository has already shipped a fix titled
 * "stop showing a retired number" once. Figures belong on the results page, which is
 * generated from the run. What this page states is the SHAPE of the claim, which does
 * not drift.
 */

export type Section = {
  id: string;
  /** The rail's label. One word — see the note on `RAIL` below. */
  label: string;
  /** Two lines. The break is authored, not wrapped: these are display type and where
   *  they break is a design decision, not the browser's. */
  headline: [string, string];
  sub: string;
  cta?: { label: string; href: string };
};

export const SECTIONS: Section[] = [
  {
    id: "overture",
    label: "Overture",
    headline: ["Reasoning", "in the dark"],
    sub: "Arbiter reviews preclinical safety evidence and states a position only when the record supports one. Every claim carries the passage it came from, and where the evidence runs out it abstains and says so.",
    cta: { label: "Open the app", href: APP_URL },
  },
  {
    id: "method",
    label: "Method",
    headline: ["One path", "through the evidence"],
    sub: "A fixed ruleset, applied the same way every time, and written down before the cases were run. The route from the documents to the position is the product — not a summary of it produced afterwards.",
    cta: { label: "Read the ruleset", href: RULESET_URL },
  },
  {
    id: "evidence",
    label: "Evidence",
    headline: ["Three streams,", "one position"],
    sub: "Structure-based prediction, cell assays and animal studies rarely tell the same story. Arbiter weighs them separately, keeps them separate in the record, and shows you which one carried the decision.",
    cta: { label: "Open a case", href: APP_URL },
  },
  {
    id: "library",
    label: "Library",
    headline: ["A library of cases,", "not one"],
    sub: "Prepared cases built from real regulatory reviews, including the compounds that were withdrawn. The library shows the documents that could not be used as readily as the ones that could.",
    cta: { label: "See the results", href: RESULTS_URL },
  },
  {
    id: "restraint",
    label: "Restraint",
    headline: ["Where the evidence", "runs out"],
    sub: "On most of the split, Arbiter declines to commit — and names the gap that stopped it. A system that always has an answer is not reading the evidence; it is generating one.",
    // No call to action, deliberately. A button under a statement about restraint asks
    // for the opposite of what the statement says.
  },
  {
    id: "record",
    label: "Record",
    headline: ["The whole record,", "in one view"],
    sub: "Every adjudication is kept with the argument that produced it and the evidence that would overturn it. Sealed on submission, and readable long after the decision was made.",
    cta: { label: "Open the app", href: APP_URL },
  },
];

/** Guard against the copy and the scenes drifting apart by one. Cheap, and it fails at
 *  module load rather than as a section quietly showing the wrong artwork. */
export const SECTION_IDS = SECTIONS.map((s) => s.id);
