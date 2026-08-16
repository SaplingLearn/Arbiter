import { createArchive } from "./archive.js";
import { createCulture } from "./culture.js";
import { createGenesis } from "./genesis.js";
import { createHelix } from "./helix.js";
import { createMonolith } from "./monolith.js";
import { createSection } from "./section.js";
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
 * The states, in product order. Deliberately not counted here — the number has been
 * wrong twice already, once when Method went and once when Read arrived.
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
    // Second, because Read & mark sits second in the case strip and the rail should
    // agree with the product about where reading happens.
    //
    // ADJACENT TO CULTURE, which the note above says to check: two wide fields back to
    // back is the thing to avoid. These are both wide and they are not the same
    // composition. Culture is a plane read ACROSS - colonies spread laterally, all of
    // them legible at once. Section is a volume read THROUGH, where the axis is depth
    // and almost everything is out of focus at any moment. One is a map, the other is a
    // pass. The variety survives.
    id: "read",
    label: "Read",
    codename: "Section",
    headline: ["THE FEW LINES", "THAT DECIDE IT"],
    lede: "Go through the documents. What extraction already found is lit.",
    factory: createSection,
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
    // Was "method", for a product page that no longer exists — the landing page makes
    // that argument now. The environment outlived the page because what it draws is a
    // seal closing, which is the RECORD, and the record is where a case ends.
    id: "record",
    label: "Record",
    codename: "Helix",
    headline: ["SEALED", "ON SUBMISSION"],
    lede: "What the record proves, and what it does not.",
    factory: createHelix,
  },
];

export const STATE_IDS = STATES.map((s) => s.id);
