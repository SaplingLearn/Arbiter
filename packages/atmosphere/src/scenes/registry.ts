import { createArchive } from "./archive.js";
import { createCulture } from "./culture.js";
import { createGenesis } from "./genesis.js";
import { createHelix } from "./helix.js";
import { createMonolith } from "./monolith.js";
import { createSynapse } from "./synapse.js";
import type { SceneFactory } from "../core/types.js";

export interface StateDef {
  id: string;
  /** Tab label, as it appears in the product. */
  label: string;
  /** The environment's own name — what the rail shows. */
  codename: string;
  /** Display line for this state. */
  headline: [string, string];
  /** One line of orientation beneath it. */
  lede: string;
  factory: SceneFactory;
}

/**
 * The five states, in product order.
 *
 * Order is the order of the tab strip, not a narrative order — but it happens to run
 * wide → tight → wide → flowing → vertical, which gives the set the same shape-variety
 * the reference gets from its six sections. If a state is ever reordered, check that
 * two adjacent scenes still differ in composition and not only in content; two wide
 * fields back to back is what makes a sequence feel repetitive.
 */
export const STATES: StateDef[] = [
  {
    // First, because it is the only state a stranger sees before being told what any
    // of this is. The other five are product tabs and assume a reader already inside.
    id: "landing",
    label: "Landing",
    codename: "Monolith",
    headline: ["REASONING", "IN THE DARK"],
    lede: "One object, lit from inside, in a landscape that is not.",
    factory: createMonolith,
  },
  {
    id: "dashboard",
    label: "Dashboard",
    codename: "Culture",
    headline: ["EVERY CASE", "IN ONE FIELD"],
    lede: "Cases you are named on, ordered by what they need from you.",
    factory: createCulture,
  },
  {
    id: "new",
    label: "New case",
    codename: "Genesis",
    headline: ["FROM NOTHING,", "A STRUCTURE"],
    lede: "Open a case for a compound you are deciding about.",
    factory: createGenesis,
  },
  {
    id: "library",
    label: "Library",
    codename: "Archive",
    headline: ["WHAT WORKED,", "AND WHAT DID NOT"],
    lede: "Prepared cases built from real regulatory reviews — refusals included.",
    factory: createArchive,
  },
  {
    id: "ask",
    label: "Ask",
    codename: "Synapse",
    headline: ["A QUESTION", "FINDS ITS SOURCE"],
    lede: "Search the documents. Every claim carries the passage it came from.",
    factory: createSynapse,
  },
  {
    id: "method",
    label: "Method",
    codename: "Helix",
    headline: ["SEALED", "ON SUBMISSION"],
    lede: "What the record proves, and what it does not.",
    factory: createHelix,
  },
];

export const STATE_IDS = STATES.map((s) => s.id);
