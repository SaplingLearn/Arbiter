import type { Assertion, DefeatRuleId, EvidenceClaim, RuleId, Ruleset } from "./types.js";

const ANIMAL_SYSTEMS = new Set(["rodent", "nonrodent"]);

function rule(ruleset: Ruleset, id: RuleId) {
  const r = ruleset.rules.find((x) => x.id === id);
  return r && r.enabled ? r : null;
}

/** Trim and lowercase a key-event id so "KE:55" and " ke:55 " compare equal. */
function normalizeKeyEvent(ke: string | null): string | null {
  return ke === null ? null : ke.trim().toLowerCase();
}

/** True only for evidence that is structural correlation, not apical/mechanistic evidence that simply lacks a key-event annotation. */
function isStructuralOnly(claim: EvidenceClaim): boolean {
  return claim.measuresKeyEvent === null && (claim.stream === "qsar" || claim.system === "in_silico");
}

/** Two claims conflict only when both commit to opposite conclusions. */
export function conflictsWith(a: EvidenceClaim, b: EvidenceClaim): boolean {
  if (a.assertion === "ambiguous" || b.assertion === "ambiguous") return false;
  return a.assertion !== b.assertion;
}

type RuleHit = { rationale: string };

/**
 * Predicates for the four pairwise defeat rules. Each is precedence-agnostic
 * — it only decides whether `attacker` beats `target` *if this rule is
 * consulted at all*. Which rule gets consulted first, when more than one
 * would apply, is `ruleset.precedenceOrder` (see `bestRule`/`defeats` below).
 */
const RULE_PREDICATES: Record<DefeatRuleId, (attacker: EvidenceClaim, target: EvidenceClaim) => RuleHit | null> = {
  R1: (attacker, target) =>
    attacker.system === "human" && ANIMAL_SYSTEMS.has(target.system)
      ? { rationale: `Human-relevant evidence outranks ${target.system} in vivo for a human endpoint.` }
      : null,

  R2: (attacker, target) =>
    attacker.measuresKeyEvent !== null && isStructuralOnly(target)
      ? { rationale: `Direct measurement of key event ${attacker.measuresKeyEvent} outranks structural correlation.` }
      : null,

  R3: (attacker, target) =>
    attacker.assertion === "toxic" &&
    attacker.exposureRelevant === true &&
    target.assertion === "safe" &&
    target.exposureRelevant !== true
      ? {
          rationale: "A positive at clinically relevant exposure outranks a negative whose margin was never tested at that range.",
        }
      : null,

  // Declines when the two claims measure different key events, deliberately:
  // reliability alone should not adjudicate between two mechanistically
  // distinct measurements, only between two readings of the same question.
  R5: (attacker, target) =>
    attacker.klimisch !== null &&
    target.klimisch !== null &&
    attacker.klimisch < target.klimisch &&
    normalizeKeyEvent(attacker.measuresKeyEvent) === normalizeKeyEvent(target.measuresKeyEvent)
      ? { rationale: `Klimisch ${attacker.klimisch} outranks Klimisch ${target.klimisch} at equal mechanistic relevance.` }
      : null,
};

/**
 * The highest-precedence rule (per `ruleset.precedenceOrder`) that licenses
 * `attacker` defeating `target`, or null if none applies. A disabled rule is
 * skipped entirely — never merely deprioritised — so it can still leave a
 * gap that a lower-precedence rule fills.
 */
function bestRule(
  attacker: EvidenceClaim,
  target: EvidenceClaim,
  ruleset: Ruleset,
): { byRule: DefeatRuleId; rationale: string } | null {
  for (const id of ruleset.precedenceOrder) {
    if (!rule(ruleset, id)) continue;
    const hit = RULE_PREDICATES[id](attacker, target);
    if (hit) return { byRule: id, ...hit };
  }
  return null;
}

function precedenceRank(id: DefeatRuleId, ruleset: Ruleset): number {
  const idx = ruleset.precedenceOrder.indexOf(id);
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
}

/**
 * Does `attacker` defeat `target`? Returns the deciding rule, or null.
 *
 * Each rule's predicate is individually asymmetric, but two different rules
 * can each license an attack in opposite directions on the same pair (e.g.
 * a human-relevant claim outranks an animal claim by R1, while the animal
 * claim simultaneously outranks the human claim by R3). `defeats` resolves
 * this by precedence: it computes the best rule in both directions and
 * lets the higher-precedence one win. A tie — including when the reverse
 * direction is licensed by a rule that is equal-or-better in precedence —
 * yields NO defeat, so both claims survive into fusion and the disagreement
 * shows up as conflict mass rather than an arbitrary winner.
 *
 * `ruleset.precedenceOrder` (R3 before R1 before R2 before R5, pre-registered)
 * is the preference ordering a toxicologist edits. R4 is not a defeat rule
 * (it downweights) and R6 is not pairwise (it is a set property), so neither
 * participates in precedence.
 */
export function defeats(
  attacker: EvidenceClaim,
  target: EvidenceClaim,
  ruleset: Ruleset,
): { byRule: RuleId; rationale: string } | null {
  if (attacker.id === target.id) return null;
  if (!conflictsWith(attacker, target)) return null;

  const forward = bestRule(attacker, target, ruleset);
  if (!forward) return null;

  const reverse = bestRule(target, attacker, ruleset);
  if (reverse && precedenceRank(reverse.byRule, ruleset) <= precedenceRank(forward.byRule, ruleset)) {
    return null;
  }

  return forward;
}

/** R4: reduce the weight of an out-of-domain prediction rather than defeating it. */
export function downweightFactor(
  claim: EvidenceClaim,
  ruleset: Ruleset,
): { factor: number; byRule: RuleId; rationale: string } | null {
  const r = rule(ruleset, "R4");
  if (!r) return null;
  if (claim.inApplicabilityDomain !== false) return null;
  return {
    factor: 1 - r.strength,
    byRule: "R4",
    rationale: "Prediction falls outside the model's applicability domain; admitted with reduced weight.",
  };
}

/**
 * R6: a multiplier rewarding agreement across DISTINCT streams, attenuated
 * by dissent.
 *
 * Counting claims would reward a chatty source; counting distinct streams
 * rewards genuine independence, which is what weight-of-evidence means. But
 * counting only the majority's streams (as if the minority didn't exist)
 * would let a 2-2 split score as high as unanimity — so the boost is scaled
 * down by how close the split is, reaching no boost at all (1) at an exact
 * tie. `supports` reports which side the concordance favors, so a caller
 * can't accidentally apply a boost computed from one cluster to the other
 * cluster's belief.
 */
export function concordanceBoost(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
): { supports: Assertion | null; boost: number } {
  const r = rule(ruleset, "R6");
  if (!r || claims.length === 0) return { supports: null, boost: 1 };

  const committed = claims.filter((c) => c.assertion !== "ambiguous");
  if (committed.length === 0) return { supports: null, boost: 1 };

  const distinctStreams = (assertion: Assertion) =>
    new Set(committed.filter((c) => c.assertion === assertion).map((c) => c.stream)).size;

  const toxicStreams = distinctStreams("toxic");
  const safeStreams = distinctStreams("safe");

  if (toxicStreams === safeStreams) return { supports: null, boost: 1 };

  const supports: Assertion = toxicStreams > safeStreams ? "toxic" : "safe";
  const majorityStreams = Math.max(toxicStreams, safeStreams);
  const minorityStreams = Math.min(toxicStreams, safeStreams);

  const rawBoost = 1 + r.strength * Math.max(0, majorityStreams - 1) * 0.25;
  const dominance = (majorityStreams - minorityStreams) / (majorityStreams + minorityStreams);

  return { supports, boost: 1 + (rawBoost - 1) * dominance };
}
