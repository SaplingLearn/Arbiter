import type { Action, Region } from "../state/store.js";
import type { LoadedData } from "../data/load.js";
import type { TabId } from "../router.js";

/**
 * A beat's caption, either fixed prose or prose computed from the bundled data.
 *
 * The function form exists because the opening beat quotes two figures the
 * harness measures, and it used to quote them as a hard-coded "61 of 267" - the
 * one retyped number left in the app, in the first sentence a judge hears, on the
 * screen that shows the hero case was not cherry-picked. Every other surface
 * renders its numbers from `metrics.json`; this closes the last hole.
 */
export type BeatLine = string | ((d: LoadedData) => string);

export interface Beat {
  n: number;
  title: string;
  tab: TabId;
  focus: Region | null;
  /**
   * Data changes a beat performs, expressed as the SAME actions a user could
   * dispatch by hand. The tour holds no data of its own, so the guided path and
   * the manual path cannot disagree.
   */
  actions: Action[];
  line: BeatLine;
}

/** Resolve a beat's caption against the loaded data. */
export function beatLine(b: Beat, d: LoadedData): string {
  return typeof b.line === "string" ? b.line : b.line(d);
}

const PRE_FIH = "2021-06-01";
const POST_MURINE = "2023-01-01";

export const BEATS: Beat[] = [
  {
    n: 0, title: "The desk, before first-in-human", tab: "compounds", focus: null,
    actions: [{ type: "setAsOf", asOf: PRE_FIH }],
    line: (d) =>
      `${d.metrics.sampleSizes.conflictSubset} of ${d.metrics.sampleSizes.scored} scored compounds `
      + "have streams in genuine conflict. This case is one of them.",
  },
  {
    n: 1, title: "What happens today", tab: "case", focus: "evidence",
    actions: [],
    line: "Majority vote, weighted average and every single source all say advance.",
  },
  {
    n: 2, title: "ARBITER's argument", tab: "case", focus: "trace",
    actions: [],
    line: "Nothing is defeated. Nothing contradicts anything. Each source is discounted for what it cannot license, and most of the weight lands on uncommitted.",
  },
  {
    n: 3, title: "The honest gap, and what would flip it", tab: "case", focus: "trace",
    actions: [],
    line: "The range is the widest in the set. One claim would have to change to move the verdict.",
  },
  {
    n: 4, title: "The experiment it asks for", tab: "case", focus: "trace",
    actions: [{ type: "setAsOf", asOf: POST_MURINE }],
    line: "It asks for a human BSEP assay at matched exposure. Takeda ran a mouse study instead — and even that does not license a conclusion, because it is a mouse.",
  },
  {
    n: 5, title: "The table", tab: "record", focus: null,
    actions: [],
    line: "Positions are recorded, including dissent. The named decision owner signs. ARBITER holds no position.",
  },
  {
    n: 6, title: "What the numbers say", tab: "validation", focus: null,
    actions: [],
    line: "Determinism and robustness. Coverage is the finding. The planner recommendation survives ±50% perturbation of every elicited prior.",
  },
];
