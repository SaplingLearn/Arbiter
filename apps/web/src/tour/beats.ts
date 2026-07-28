import type { Action, Region } from "../state/store.js";
import type { TabId } from "../router.js";

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
  line: string;
}

const PRE_FIH = "2021-06-01";
const POST_MURINE = "2023-01-01";

export const BEATS: Beat[] = [
  {
    n: 0, title: "The desk, before first-in-human", tab: "compounds", focus: null,
    actions: [{ type: "setAsOf", asOf: PRE_FIH }],
    line: "61 of 267 scored compounds have streams in genuine conflict. This case is one of them.",
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
