import type { RuleId } from "@arbiter/engine";
import type { TabId } from "../router.js";
import type { Region } from "../state/store.js";

/**
 * The anchor registry: every place the navigator (spec section 7) is allowed to
 * point at.
 *
 * A NEW `data-anchor` attribute, never a reuse of `data-testid` (spec section 8).
 * Five testids are non-unique by construction - `evidence-row`, `trace-step`,
 * `compound-row`, `rule-card`, `position-row` - and those are exactly the families
 * that need a per-instance anchor. `provenance` is two different things in two
 * different tabs. Ten more are frozen by the Playwright specs and cannot be
 * reshaped. The two attributes coexist on the same element and neither is renamed.
 *
 * `region` is load-bearing, not decoration: a collapsed Case region UNMOUNTS its
 * content, so while the tour sits on beat 2 no evidence row exists in the DOM at
 * all. The navigator dispatches `setFocus` before it scrolls.
 */
export interface Anchor {
  label: string;
  tab: TabId;
  region: Region | null;
}

/**
 * Declared but legitimately absent at times (spec section 7.2). These are NOT
 * unknown ids: an unknown id is filtered and dropped, whereas one of these means
 * "switch tab, un-collapse the region, then re-check". The DOM test distinguishes
 * the two rather than skipping this list.
 *
 * `ruleset.precedenceOrder` and `ruleset.abstentionThreshold` are here for a
 * different reason than the other five: a later task's cached anchor map already
 * points at both, so the ids are registered now, but the elements they name are
 * built in Task 6. Until then they are declared-but-not-yet-mounted - the same
 * observable category as the other five, even though the other five cycle by data
 * rather than by which task has landed.
 */
export const CONDITIONAL_ANCHORS = [
  "trace.counterfactual",
  "trace.nextExperiment",
  "validation.singleClassWarning",
  "evidence.citationStatus",
  "ruleset.modifiedBadge",
  "ruleset.precedenceOrder",
  "ruleset.abstentionThreshold",
] as const;

/**
 * `as const satisfies` rather than one or the other: the const assertion keeps the
 * keys as literals so `AnchorId` is a real union, and `satisfies` still checks
 * every entry against `Anchor` so a typo in a tab id fails the build.
 */
export const ANCHORS = {
  // Case tab - the header, which sits OUTSIDE the collapsing grid and so has no region.
  "case.verdict": { label: "The verdict on the selected case", tab: "case", region: null },
  "case.beliefRange": { label: "Belief, plausibility and the gap between them", tab: "case", region: null },
  "case.hiddenCount": { label: "How many claims the as-of date hides", tab: "case", region: null },
  "case.asOf": { label: "The as-of date control", tab: "case", region: null },

  // Case tab - the trace region. Collapsing it unmounts everything below.
  "trace.beliefTrack": { label: "The belief-to-plausibility band", tab: "case", region: "trace" },
  "trace.mass": { label: "Committed mass: toxic, safe and uncommitted", tab: "case", region: "trace" },
  "trace.verdictReason": { label: "Why the engine reached this verdict", tab: "case", region: "trace" },
  "trace.counterfactual": { label: "What would change the verdict", tab: "case", region: "trace" },
  "trace.nextExperiment": { label: "The experiment the planner asks for", tab: "case", region: "trace" },

  // Case tab - the evidence region.
  "evidence.citationStatus": { label: "Citation status of the literature fixture", tab: "case", region: "evidence" },

  // Ruleset tab.
  "ruleset.hash": { label: "The registered ruleset version and hash", tab: "ruleset", region: null },
  "ruleset.modifiedBadge": { label: "Whether the ruleset on screen is the registered one", tab: "ruleset", region: null },
  "ruleset.liveBelief": { label: "Belief on the selected case under the ruleset on screen", tab: "ruleset", region: null },
  "ruleset.precedenceOrder": { label: "The registered precedence order and why it is ordered that way", tab: "ruleset", region: null },
  "ruleset.abstentionThreshold": { label: "The registered belief-plausibility gap threshold for abstention", tab: "ruleset", region: null },
  "rule.R1": { label: "R1, human relevance", tab: "ruleset", region: null },
  "rule.R2": { label: "R2, mechanistic proximity", tab: "ruleset", region: null },
  "rule.R3": { label: "R3, exposure relevance", tab: "ruleset", region: null },
  "rule.R4": { label: "R4, applicability domain", tab: "ruleset", region: null },
  "rule.R5": { label: "R5, study reliability", tab: "ruleset", region: null },
  "rule.R6": { label: "R6, concordance", tab: "ruleset", region: null },

  // Record tab.
  "record.chainExplainer": { label: "How the hash-chained audit log works", tab: "record", region: null },
  "record.signForm": { label: "Record a position against the evidence on screen", tab: "record", region: null },

  // Validation tab.
  "validation.provenance": { label: "Ruleset hash, seeds and the scored split", tab: "validation", region: null },
  "validation.headline": { label: "Conflict-subset coverage and balanced accuracy", tab: "validation", region: null },
  "validation.singleClassWarning": { label: "Why the balanced accuracy must not be quoted", tab: "validation", region: null },
  "validation.baselines": { label: "The baseline pipelines, compared", tab: "validation", region: null },
  "validation.plannerStability": { label: "Planner stability under perturbed priors", tab: "validation", region: null },
  "validation.robustness": { label: "Robustness on committed compounds", tab: "validation", region: null },
  "validation.llmAblation": { label: "The LLM ablation figure", tab: "validation", region: null },

  // Compounds tab.
  "compounds.conflictRate": { label: "How many scored compounds have streams in conflict", tab: "compounds", region: null },
  "compounds.declineNote": { label: "How often ARBITER declines, and why", tab: "compounds", region: null },
  "compounds.table": { label: "The scored compound library", tab: "compounds", region: null },
} as const satisfies Record<string, Anchor>;

export type AnchorId = keyof typeof ANCHORS;

/**
 * Widened once, here, so callers index by `string` without the const assertion
 * fighting them. `noUncheckedIndexedAccess` still yields `Anchor | undefined`.
 */
const STATIC: Record<string, Anchor> = ANCHORS;

export const TRACE_STEP_PREFIX = "trace.step:";
export const EVIDENCE_CLAIM_PREFIX = "evidence.claim:";
export const RECORD_POSITION_PREFIX = "record.position:";

/**
 * The families whose members cannot be enumerated at build time.
 *
 * Spec section 8: `rule.${RuleId}` IS enumerable because RuleId is a declared
 * literal union, so the six rules are real registry entries above. Every other
 * dynamic family derives from JSON imported through `resolveJsonModule`, which
 * widens to `string` - a template-literal type would catch a malformed prefix but
 * not a nonexistent claim id. The constructors below close the prefix half and the
 * DOM test closes the other.
 */
const DYNAMIC: { prefix: string; anchor: Anchor }[] = [
  { prefix: TRACE_STEP_PREFIX, anchor: { label: "A step in the argument trace", tab: "case", region: "trace" } },
  { prefix: EVIDENCE_CLAIM_PREFIX, anchor: { label: "An evidence claim", tab: "case", region: "evidence" } },
  { prefix: RECORD_POSITION_PREFIX, anchor: { label: "A recorded position", tab: "record", region: null } },
];

export interface ParsedAnchor {
  /** The registry key for a static anchor, or the family name for a dynamic one. */
  family: string;
  /** The claim id or index carried by a dynamic anchor; null for a static one. */
  payload: string | null;
  anchor: Anchor;
}

/**
 * Resolve an anchor id to what it points at, or null if it is not in the registry.
 *
 * PREFIX-SLICE, never split(":") - spec section 8. Claim ids contain colons
 * ("TAK-994:invivo_rodent") and so do baseline names ("single:qsar"), so
 * `split(":")[1]` on `evidence.claim:TAK-994:invivo_rodent` yields "TAK-994" and
 * silently points the navigator at the wrong claim, or at nothing.
 */
export function parseAnchor(id: string): ParsedAnchor | null {
  const stat = STATIC[id];
  if (stat) return { family: id, payload: null, anchor: stat };

  for (const family of DYNAMIC) {
    if (!id.startsWith(family.prefix)) continue;
    const payload = id.slice(family.prefix.length);
    // A bare prefix carries no target. Returning it would be pointing at nothing,
    // which spec section 7.2 forbids as firmly as it forbids invented prose.
    if (payload === "") return null;
    return { family: family.prefix.slice(0, -1), payload, anchor: family.anchor };
  }
  return null;
}

/** Spec section 7.2: an id not in the registry is filtered before anything scrolls. */
export function isKnownAnchor(id: string): boolean {
  return parseAnchor(id) !== null;
}

export function traceStep(claimId: string): string {
  return `${TRACE_STEP_PREFIX}${claimId}`;
}

export function evidenceClaim(claimId: string): string {
  return `${EVIDENCE_CLAIM_PREFIX}${claimId}`;
}

export function ruleAnchor(id: RuleId): string {
  return `rule.${id}`;
}

export function recordPosition(index: number): string {
  return `${RECORD_POSITION_PREFIX}${index}`;
}
