import { z } from "zod";
import { isKnownAnchor, parseAnchor, type Anchor } from "./anchors.js";
import { postJson } from "./client.js";
import { FUZZY_THRESHOLD, jaccard } from "./trigram.js";
import { resolve, type Resolution, type Rung } from "./resolve.js";
import rawMap from "./cache/anchor-map.json";
import rawSuggested from "./cache/suggested-questions.json";

/**
 * Surface 3. The response carries identifiers and nothing else (spec section 7),
 * so the model has nowhere to put an invented claim: the UI scrolls to and
 * surfaces text that already exists at those anchors.
 *
 * Five rungs, not master spec section 7's three. The walker is shared with
 * Surface 1, so the fuzzy rung costs almost nothing, and an asymmetric similarity
 * threshold is something that has to be explained rather than defended
 * (spec section 7.1). Recorded as a departure so it does not read as an oversight.
 */
export interface NavResult {
  anchorIds: string[];
  noMatch: boolean;
}

export interface NavigateInput {
  question: string;
  /**
   * Matching strings, not display strings. Rung 4 scores question tokens against
   * `label`, and the caller folds each rule's registered statement into its rule
   * anchor's label (spec section 7.1). Display always reads `anchorMeta(id).label`.
   */
  anchors: { id: string; label: string }[];
}

/**
 * `.strict()`, not the zod-object default of silently stripping unknown keys.
 * Spec §11's schema-validated-not-merely-parsed rule cuts both ways: a body
 * carrying `{ anchorIds, noMatch, answer: "prose" }` must fail validation outright
 * - a rung-1 miss - rather than parse successfully with `answer` quietly dropped,
 * which would make "ids only, never prose" true of the parsed VALUE but false of
 * what the model was actually allowed to get away with returning.
 */
export const NavResultSchema: z.ZodType<NavResult> = z.object({
  anchorIds: z.array(z.string()),
  noMatch: z.boolean(),
}).strict();

/** Three destinations is a navigator. Four is a search results page. */
const MAX_ANCHORS = 3;

interface CachedEntry {
  question: string;
  anchorIds: string[];
}

const MAP = rawMap as CachedEntry[];
const SUGGESTED = rawSuggested as CachedEntry[];

/**
 * The suggestions join the exact-match table, so clicking one re-enters through
 * the front door and answers at rung 2 rather than through a private path.
 */
const CACHE: CachedEntry[] = [...MAP, ...SUGGESTED];

export const SUGGESTED_QUESTIONS: string[] = SUGGESTED.map((e) => e.question);

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Spec section 7.2, first case: an id not in the registry is filtered out.
 *
 * Returning null when nothing survives, rather than a noMatch value, lets the
 * walker descend. The user-visible outcome section 7.2 requires is still noMatch -
 * rung 5 produces it - but the cache is consulted on the way, and a live model
 * answering with invented ids is precisely when the cache is worth the most.
 */
export function sanitizeNavResult(raw: NavResult): NavResult | null {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of raw.anchorIds) {
    if (!isKnownAnchor(id) || seen.has(id)) continue;
    seen.add(id);
    kept.push(id);
    if (kept.length === MAX_ANCHORS) break;
  }
  return kept.length === 0 ? null : { anchorIds: kept, noMatch: false };
}

/**
 * Per-instance label for a dynamic family member, keyed by the family name
 * `parseAnchor` already returns (the prefix with its trailing ":" stripped).
 *
 * `anchors.ts` owns prefix-matching (tab, region, family) - that parsing is NOT
 * repeated here, `parseAnchor` is called instead. What `anchors.ts` cannot supply
 * is a label naming the specific instance, because its generic dynamic-family
 * label ("A step in the argument trace") has no payload to read: the DYNAMIC
 * table there is shared by every id in the family and is not told which one this
 * call is about. That per-instance text is authored once here.
 */
const INSTANCE_LABEL: Record<string, (payload: string) => string> = {
  "trace.step": (p) => `Argument step — ${p}`,
  "evidence.claim": (p) => `Evidence row — ${p}`,
  "record.position": (p) => `Recorded position ${Number(p) + 1}`,
};

/**
 * Static lookup plus dynamic-family prefix resolution. `parseAnchor` is the one
 * place that knows how to tell a static id from a dynamic one and how to slice a
 * dynamic id's prefix from its payload (spec section 8: PREFIX-SLICE, never
 * split(":") - claim ids and baseline names both carry colons of their own).
 */
export function anchorMeta(id: string): Anchor | null {
  const parsed = parseAnchor(id);
  if (parsed === null) return null;
  if (parsed.payload === null) return parsed.anchor;
  const label = INSTANCE_LABEL[parsed.family]?.(parsed.payload);
  return label === undefined ? parsed.anchor : { ...parsed.anchor, label };
}

/**
 * Words too common to discriminate between anchors. Kept short on purpose: a long
 * list starts deciding which questions are askable.
 */
const STOPWORDS = new Set([
  "about", "after", "again", "against", "because", "been", "before", "being", "between", "both",
  "does", "doing", "down", "during", "each", "from", "have", "having", "here", "into", "just",
  "more", "most", "much", "only", "other", "over", "same", "some", "such", "than", "that", "them",
  "then", "there", "these", "they", "this", "those", "through", "under", "until", "very", "were",
  "what", "when", "where", "which", "while", "whom", "whose", "will", "with", "would", "your",
]);

function tokens(s: string): string[] {
  return normalise(s).split(" ").filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * Rung 1 - the live call. Ids only: NavResultSchema rejects any body carrying
 * prose, so a model that answers the question instead of locating it is a rung-1
 * miss rather than a claim on screen (spec §7.2).
 *
 * The survivors go through `sanitizeNavResult`, THE SAME FUNCTION every other rung
 * uses, rather than an inline `.filter(isKnownAnchor)`. That filter kept the
 * registry check and dropped everything else the sanitiser guarantees:
 *
 * - a response whose ids were ALL stale filtered to `{ anchorIds: [], noMatch: false }`,
 *   which is non-null, so `resolve` stopped at rung 1 and the cache was never
 *   consulted - NavigatorBar rendering an empty results strip labelled "rung 1 ·
 *   live". `sanitizeNavResult` returns null there instead, and its docstring says
 *   why: a live model answering with invented ids is precisely when the cache is
 *   worth the most.
 * - the MAX_ANCHORS cap and the de-duplication, both enforced on rungs 2, 3 and 4,
 *   were unenforced on the one caller nobody in this repo controls.
 */
const liveRung: Rung<NavigateInput, NavResult> = {
  source: "live",
  run: (input) =>
    postJson<NavResult>("/api/navigate", input, (u) => {
      const parsed = NavResultSchema.safeParse(u);
      if (!parsed.success) return null;
      // An id absent from the registry is handled here rather than folded into the
      // schema failure (spec §11 names it as one of the three that do not collapse):
      // a response naming two real anchors and one stale one is still useful, so the
      // stale one is dropped and the rest are kept.
      return sanitizeNavResult(parsed.data);
    }),
};

/** Rung 2. Exact match after normalisation, so casing and punctuation do not miss. */
const exactRung: Rung<NavigateInput, NavResult> = {
  source: "cache",
  run: async (input) => {
    const q = normalise(input.question);
    const hit = CACHE.find((e) => normalise(e.question) === q);
    return hit ? sanitizeNavResult({ anchorIds: hit.anchorIds, noMatch: false }) : null;
  },
};

/** Rung 3. Trigram Jaccard over the same cached questions, threshold 0.55. */
const fuzzyRung: Rung<NavigateInput, NavResult> = {
  source: "cache",
  run: async (input) => {
    let best: CachedEntry | null = null;
    let bestScore = 0;
    for (const e of CACHE) {
      const score = jaccard(normalise(input.question), normalise(e.question));
      // Strictly greater, so ties keep the earlier entry and the result is stable
      // across runs. Nothing here may depend on iteration luck.
      if (score >= FUZZY_THRESHOLD && score > bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best ? sanitizeNavResult({ anchorIds: best.anchorIds, noMatch: false }) : null;
  },
};

/** Rung 4. Token overlap against the anchor labels and rule statements the caller supplied. */
const keywordRung: Rung<NavigateInput, NavResult> = {
  source: "local",
  run: async (input) => {
    const asked = new Set(tokens(input.question));
    if (asked.size === 0) return null;
    const scored = input.anchors
      .map((a, order) => {
        const have = new Set(tokens(a.label));
        let score = 0;
        for (const w of asked) if (have.has(w)) score += 1;
        return { id: a.id, score, order };
      })
      .filter((s) => s.score > 0)
      // Score first, then the order the caller supplied. Never the object key
      // order of a JSON import.
      .sort((a, b) => (b.score - a.score) || (a.order - b.order));
    return scored.length === 0
      ? null
      : sanitizeNavResult({ anchorIds: scored.map((s) => s.id), noMatch: false });
  },
};

/** Rung 5. The four suggestions. This rung always answers, so the ladder terminates. */
const suggestRung: Rung<NavigateInput, NavResult> = {
  source: "none",
  run: async () => ({ anchorIds: [], noMatch: true }),
};

const RUNGS: Rung<NavigateInput, NavResult>[] = [liveRung, exactRung, fuzzyRung, keywordRung, suggestRung];

export function navigate(input: NavigateInput): Promise<Resolution<NavResult>> {
  return resolve(RUNGS, input);
}
