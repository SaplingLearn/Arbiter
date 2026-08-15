import type { SceneFactory } from "../lib/types.js";
import { createMonolith } from "./monolith.js";
import { createCurrent } from "./current.js";
import { createConfluence } from "./confluence.js";
import { createField } from "./field.js";
import { createDivide } from "./divide.js";
import { createAtlas } from "./atlas.js";

/**
 * The six scenes, in page order.
 *
 * Kept apart from `content.ts` on purpose, and the split is not cosmetic: everything in
 * this file transitively imports `three`, and `content.ts` is read by the page shell on
 * first paint. Merged into one module — which is the tidier-looking arrangement — the
 * copy would drag half a megabyte of renderer into the eager bundle and the split that
 * makes this page load fast would silently stop working.
 *
 * `ORDER` is the contract between the two files. `content.ts` declares the same ids in
 * the same order and the shell checks them against each other at module load, so a
 * scene and its copy can never drift apart by one.
 */
export const ORDER = ["overture", "method", "evidence", "library", "restraint", "record"] as const;

export type SceneId = (typeof ORDER)[number];

export const SCENES: { id: SceneId; create: SceneFactory }[] = [
  { id: "overture", create: createMonolith },
  { id: "method", create: createCurrent },
  { id: "evidence", create: createConfluence },
  { id: "library", create: createField },
  { id: "restraint", create: createDivide },
  { id: "record", create: createAtlas },
];
