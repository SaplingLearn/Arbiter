import { z } from "zod";
import type { RuleId } from "@arbiter/engine";
import { postJson } from "./client.js";
import { resolve, type Resolution, type Rung } from "./resolve.js";
import { FUZZY_THRESHOLD, jaccard } from "./trigram.js";
import CACHE from "./cache/interpretations.json";

/**
 * Surface 1's five rungs (design section 5.1), four of which need no network.
 *
 * At EVERY rung the resulting change runs through the same engine. Only the route
 * from English to rule change differs; the reasoning is never faked. That is why a
 * cache hit and a live call are interchangeable here and why the ZIP loses nothing
 * a judge can see (design section 2).
 *
 * WHAT THIS MODULE MAY NOT SEE. `InterpretInput` carries claim IDS AND LABELS
 * ONLY - no assertion, no strength, no provenance, no classification field. That
 * is the request contract of design section 5, and it has a consequence recorded
 * here rather than discovered later: section 5.4's arrival-time
 * `EvidenceClaimSchema.safeParse` over the MERGED claim cannot run in this module,
 * because merging needs the values this module is denied. The check is split:
 * `ProposalSchema` here proves the field is legal and the value is of a legal
 * kind; `TablePanel` runs the cross-field refinement against the real claim before
 * anything is displayed. The authored cache is additionally checked wholesale by
 * apps/web/test/interpretCache.test.ts, so the cache path cannot reach the panel
 * with an invalid proposal at all.
 */

export type InterpretAction = "disable" | "lower_strength" | "raise_strength" | "reclassify_field";

/**
 * The legal reclassification targets are DERIVED, not invented: exactly the fields
 * the value-of-information planner must declare to synthesise a hypothetical claim
 * (packages/engine/src/plan.ts:13-16), arrived at independently for that purpose.
 * Adding a rule-consumed field there widens both at once.
 *
 * `assertion`, `strength`, `compoundId`, `id`, `availableFrom` and `provenance`
 * are excluded BY CONSTRUCTION - none is a member of AssayOperator["produces"], so
 * there is no deny-list to maintain and none to forget to update. Design section
 * 5.3 records why each one is excluded.
 */
// Imported and re-exported, never re-declared: state/store.tsx owns this type. A
// second declaration - even one derived identically from AssayOperator["produces"] -
// is a second place for the "no separate knob to tune" guarantee to drift out of.
import type { ReclassifiableField } from "../state/store.js";
export type { ReclassifiableField };

export interface Proposal {
  targetRule: RuleId | null;
  targetClaimId: string | null;
  action: InterpretAction;
  field: ReclassifiableField | null;
  newValue: unknown;
  paraphrase: string;
  confidence: "high" | "low";
}

export interface InterpretInput {
  challenge: string;
  rules: { id: RuleId; enabled: boolean; strength: number }[];
  claims: { id: string; label: string }[];
}

const RULE_IDS = ["R1", "R2", "R3", "R4", "R5", "R6"] as const;
const FIELDS = [
  "stream", "system", "measuresKeyEvent", "exposureRelevant", "inApplicabilityDomain", "klimisch",
] as const;

/**
 * Drift guard, in the idiom packages/engine/src/schema.ts:262-267 already uses. The
 * runtime tuple above and the derived `ReclassifiableField` type declare the same
 * six names twice, and nothing else forces them to agree. Bidirectional on
 * purpose: a one-way check passes happily when one side gains an extra member,
 * which is precisely how `assertion` or `strength` would get in.
 */
type FieldsMatchProduces = [
  (typeof FIELDS)[number] extends ReclassifiableField ? true : never,
  ReclassifiableField extends (typeof FIELDS)[number] ? true : never,
];
export const FIELDS_MATCH_PRODUCES: FieldsMatchProduces = [true, true];

/**
 * `newValue` is `unknown` on the interface because the interface is the widest
 * contract, but the SCHEMA narrows it to the four kinds design section 5.3's table
 * actually admits: strings (system, stream, measuresKeyEvent), numbers (klimisch,
 * and a rule strength), booleans (exposureRelevant, inApplicabilityDomain), and
 * null. Narrowing here is not only stricter, it keeps the key REQUIRED - zod
 * infers `z.unknown()` as an optional property, which would not satisfy
 * `z.ZodType<Proposal>`.
 */
const NewValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ProposalSchema: z.ZodType<Proposal> = z
  .object({
    targetRule: z.enum(RULE_IDS).nullable(),
    targetClaimId: z.string().min(1).nullable(),
    action: z.enum(["disable", "lower_strength", "raise_strength", "reclassify_field"]),
    field: z.enum(FIELDS).nullable(),
    newValue: NewValueSchema,
    paraphrase: z.string().min(1),
    confidence: z.enum(["high", "low"]),
  })
  // `.strict()`, not the zod-object default of silently stripping unknown keys.
  // The same hole NavResultSchema.strict() closes on the navigate side (spec
  // section 11 cuts both ways): a live response carrying all seven legal fields
  // plus an extra one the model volunteered - a rationale, a confidence gloss,
  // anything - must fail validation outright rather than parse "successfully"
  // with the extra field quietly dropped. Both consumers of this schema (the
  // ENTRIES cache parse below, and apps/web/test/interpretCache.test.ts) build
  // their input object by picking exactly these seven fields off the raw
  // source first, so `.strict()` costs neither consumer anything - it only
  // closes a door the live rung was otherwise leaving open.
  .strict()
  // Cross-field constraints, because a proposal that parses field-by-field can
  // still be undispatchable - a reclassify naming no claim, or a strength change
  // carrying a string. The confirm panel would then render a control that does
  // nothing, which is worse than no proposal at all.
  .superRefine((p, ctx) => {
    if (p.action === "reclassify_field") {
      if (p.field === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ["field"],
          message: "A reclassify_field proposal must name which field it changes.",
        });
      }
      if (p.targetClaimId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ["targetClaimId"],
          message: "A reclassify_field proposal must name the claim it changes.",
        });
      }
      return;
    }
    if (p.targetRule === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["targetRule"],
        message: "A rule-level proposal must name the rule it contests.",
      });
    }
    if (p.field !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["field"],
        message: "Only reclassify_field may name an evidence field.",
      });
    }
    if (p.action === "disable") {
      if (p.newValue !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ["newValue"],
          message: "A disable proposal carries no value; enabled goes to false.",
        });
      }
      return;
    }
    if (typeof p.newValue !== "number" || p.newValue < 0 || p.newValue > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["newValue"],
        message: "A strength proposal must carry the proposed strength as a number in 0..1.",
      });
    }
  });

/**
 * Lowercase, collapse whitespace, trim. Rung 2 is an EXACT match in the only sense
 * that survives a reviewer typing into a box: identical text, not identical
 * keystrokes. Without it every real hit lands on rung 3 and the exact rung is dead
 * code that still passes a `.value !== null` test.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The authored cache, parsed once at module load. An entry that fails
 * `ProposalSchema` is DROPPED rather than thrown, so a bad edit degrades this
 * surface to fewer cached matches instead of blanking the whole app on import -
 * and apps/web/test/interpretCache.test.ts asserts all thirteen survive, so the
 * degradation is never silent.
 */
const ENTRIES: { challenge: string; proposal: Proposal }[] = CACHE.entries.flatMap((raw) => {
  const parsed = ProposalSchema.safeParse({
    targetRule: raw.targetRule,
    targetClaimId: raw.targetClaimId,
    action: raw.action,
    field: raw.field,
    newValue: raw.newValue,
    paraphrase: raw.paraphrase,
    confidence: raw.confidence,
  });
  return parsed.success ? [{ challenge: normalize(raw.challenge), proposal: parsed.data }] : [];
});

/**
 * The Ruleset tab's slider is `step="0.05"`. A proposal off that grid names a
 * value the reviewer could not have reached by hand, which breaks the parity
 * guarantee Apply rests on. `toFixed(2)` because 9 * 0.05 is 0.45000000000000001
 * in binary floating point and that number should never reach a label.
 */
const STEP = 0.05;
function onGrid(x: number): number {
  return Number((Math.round(Math.min(1, Math.max(0, x)) / STEP) * STEP).toFixed(2));
}

/**
 * The registered rule names, for the rung-4 paraphrase. Duplicated from
 * rules/ruleset-v1.0.json deliberately: `InterpretInput` carries only
 * (id, enabled, strength) because that is what design section 5 permits in the
 * request body, and the ruleset is pre-registered and hashed, so these strings
 * cannot drift without `check-ruleset` failing first.
 */
const RULE_NAMES: Record<RuleId, string> = {
  R1: "human relevance",
  R2: "mechanistic proximity",
  R3: "exposure relevance",
  R4: "applicability domain",
  R5: "study reliability",
  R6: "concordance",
};

/**
 * Word-boundary matcher. A bare `includes("rat")` fires on "rate", "strategy" and
 * "accurate", which routes a challenge about the discount RATE to R1 - a wrong
 * rule, confidently proposed, arriving from our own code rather than from a model.
 * A trailing `*` asks for a prefix match instead, for stems like "structur*".
 */
function tokenPattern(token: string): RegExp {
  const prefix = token.endsWith("*");
  const body = (prefix ? token.slice(0, -1) : token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${body}${prefix ? "" : "\\b"}`);
}

/** Design section 5.1's rung-4 vocabulary: `rat`, `margin`, `domain`, rule names, stream names. */
const KEYWORD_TOKENS: { rule: RuleId; tokens: string[] }[] = [
  { rule: "R1", tokens: ["r1", "human relevance", "rat", "rats", "rodent*", "mouse", "mice", "murine", "primate*", "animal*", "species", "in vivo"] },
  { rule: "R2", tokens: ["r2", "mechanistic proximity", "structur*", "read-across", "read across", "toxicophore*", "key event*", "qsar", "in silico", "mechanis*"] },
  { rule: "R3", tokens: ["r3", "exposure relevance", "margin*", "exposure*", "cmax", "dose*", "clinically relevant"] },
  { rule: "R4", tokens: ["r4", "applicability domain", "domain", "training set", "extrapolat*", "out of domain"] },
  { rule: "R5", tokens: ["r5", "study reliability", "klimisch", "glp", "non-glp", "reliabilit*"] },
  { rule: "R6", tokens: ["r6", "concordance", "independen*", "platform*", "tox21", "corroborat*"] },
];

const KEYWORDS = KEYWORD_TOKENS.map((g) => ({ rule: g.rule, patterns: g.tokens.map(tokenPattern) }));

const DISABLE_PATTERNS = [
  "disable*", "turn it off", "turn off", "switch off", "drop*", "remove*", "throw out", "delete*",
  "shouldn't apply", "should not apply",
].map(tokenPattern);

const RAISE_PATTERNS = [
  "too soft", "too gentle", "too generous", "too weak", "too lenient", "not strict enough",
  "raise*", "increase*", "harder", "stronger",
].map(tokenPattern);

/**
 * Rung 4. A COUNT of distinct matching keywords, not a first match: a challenge
 * naming two rules should land on the one it talks about most. Ties break on the
 * declared order above, so the output is stable rather than dependent on iteration
 * order.
 *
 * Rung 4 ALWAYS returns `confidence: "low"`, and that is a guarantee rather than
 * an accident of authoring. A keyword hit is a guess about which rule the reviewer
 * means; design section 5.2 requires a low-confidence proposal to arrive un-armed,
 * so a guess can never present itself as a reading.
 *
 * It never proposes `reclassify_field`: keywords cannot know WHICH claim is meant,
 * and a reclassify naming the wrong claim edits evidence the reviewer was not
 * talking about.
 */
function keywordProposal(input: InterpretInput): Proposal | null {
  const text = normalize(input.challenge);

  let best: { rule: RuleId; hits: number } | null = null;
  for (const group of KEYWORDS) {
    const hits = group.patterns.filter((p) => p.test(text)).length;
    if (hits > 0 && (best === null || hits > best.hits)) best = { rule: group.rule, hits };
  }
  if (best === null) return null;

  const chosen = best.rule;
  // The ruleset on screen is the authority on what exists, not this file.
  const rule = input.rules.find((r) => r.id === chosen);
  if (!rule) return null;

  const action: InterpretAction = DISABLE_PATTERNS.some((p) => p.test(text))
    ? "disable"
    : RAISE_PATTERNS.some((p) => p.test(text))
      ? "raise_strength"
      : "lower_strength";

  const newValue = action === "disable"
    ? null
    : action === "raise_strength"
      ? onGrid(rule.strength + (1 - rule.strength) / 2)
      : onGrid(rule.strength / 2);

  return {
    targetRule: chosen,
    targetClaimId: null,
    action,
    field: null,
    newValue,
    paraphrase: action === "disable"
      ? `Turn ${chosen}, ${RULE_NAMES[chosen]}, off entirely.`
      : `${action === "raise_strength" ? "Increase" : "Reduce"} ${chosen}, ${RULE_NAMES[chosen]}.`,
    confidence: "low",
  };
}

/**
 * Rung 1 - the live call, and the only rung that can touch the network.
 *
 * `postJson` owns both gates (build flag, file:// protocol) and the 2.5s abort, so
 * this rung is unconditional here: on the static ZIP it returns null immediately
 * without attempting a request, which is what makes the same ladder correct in both
 * builds.
 *
 * `ProposalSchema.safeParse` rather than a cast. Spec §11: a 200 carrying
 * well-formed JSON of the wrong shape is the case that reaches the confirm panel if
 * this is a cast, and returning null here makes it a rung-1 miss like every other
 * transport failure.
 */
const liveRung: Rung<InterpretInput, Proposal> = {
  source: "live",
  run: (input) =>
    postJson<Proposal>("/api/interpret", input, (u) => {
      const parsed = ProposalSchema.safeParse(u);
      return parsed.success ? parsed.data : null;
    }),
};

/**
 * The five rungs, declared as DATA so that "which rung answered" is a value the
 * tests assert on and the pre-flight panel displays, rather than a comment.
 */
const RUNGS: Rung<InterpretInput, Proposal>[] = [
  liveRung, // 1 - live, 2.5s timeout
  {
    // Rung 2, exact match against the authored cache.
    source: "cache",
    run: async (input) => ENTRIES.find((e) => e.challenge === normalize(input.challenge))?.proposal ?? null,
  },
  {
    // Rung 3, character-trigram Jaccard over THAT SAME cached set, accepted at
    // >= 0.55. Highest score wins; the authored set's highest internal similarity
    // is 0.17, so two entries cannot both clear the threshold against one input.
    source: "cache",
    run: async (input) => {
      const q = normalize(input.challenge);
      let best: { score: number; proposal: Proposal } | null = null;
      for (const e of ENTRIES) {
        const score = jaccard(q, e.challenge);
        if (score >= FUZZY_THRESHOLD && (best === null || score > best.score)) {
          best = { score, proposal: e.proposal };
        }
      }
      return best?.proposal ?? null;
    },
  },
  {
    // Rung 4, deterministic keyword mapping.
    source: "local",
    run: async (input) => keywordProposal(input),
  },
  {
    // Rung 5, the rule picker. It has no proposal to offer - the UI asks "which
    // rule do you want to contest?" and the USER answers. Declared as a real rung
    // so `resolve` reports `{ value: null, rung: 5, source: "none" }` rather than
    // the caller having to infer exhaustion from a null.
    source: "none",
    run: async () => null,
  },
];

export function interpret(input: InterpretInput): Promise<Resolution<Proposal>> {
  return resolve(RUNGS, input);
}
