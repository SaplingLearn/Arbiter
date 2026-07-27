import type { EvidenceClaim, RuleId, Ruleset } from "./types.js";

const ANIMAL_SYSTEMS = new Set(["rodent", "nonrodent"]);

function rule(ruleset: Ruleset, id: RuleId) {
  const r = ruleset.rules.find((x) => x.id === id);
  return r && r.enabled ? r : null;
}

/** Two claims conflict only when both commit to opposite conclusions. */
export function conflictsWith(a: EvidenceClaim, b: EvidenceClaim): boolean {
  if (a.assertion === "ambiguous" || b.assertion === "ambiguous") return false;
  return a.assertion !== b.assertion;
}

/**
 * Does `attacker` defeat `target`? Returns the deciding rule, or null.
 *
 * Rules are checked in precedence order R1 -> R2 -> R3 -> R5. R4 is not a
 * defeat rule (it downweights) and R6 is not pairwise (it is a set property).
 * The first rule that applies decides, so the ordering in this function IS
 * the preference ordering a toxicologist edits.
 */
export function defeats(
  attacker: EvidenceClaim,
  target: EvidenceClaim,
  ruleset: Ruleset,
): { byRule: RuleId; rationale: string } | null {
  if (attacker.id === target.id) return null;
  if (!conflictsWith(attacker, target)) return null;

  if (rule(ruleset, "R1") && attacker.system === "human" && ANIMAL_SYSTEMS.has(target.system)) {
    return { byRule: "R1", rationale: `Human-relevant evidence outranks ${target.system} in vivo for a human endpoint.` };
  }

  if (rule(ruleset, "R2") && attacker.measuresKeyEvent !== null && target.measuresKeyEvent === null) {
    return { byRule: "R2", rationale: `Direct measurement of key event ${attacker.measuresKeyEvent} outranks structural correlation.` };
  }

  if (
    rule(ruleset, "R3") &&
    attacker.assertion === "toxic" &&
    attacker.exposureRelevant === true &&
    target.assertion === "safe" &&
    target.exposureRelevant !== true
  ) {
    return { byRule: "R3", rationale: "A positive at clinically relevant exposure outranks a negative whose margin was never tested at that range." };
  }

  if (
    rule(ruleset, "R5") &&
    attacker.klimisch !== null &&
    target.klimisch !== null &&
    attacker.klimisch < target.klimisch &&
    attacker.measuresKeyEvent === target.measuresKeyEvent
  ) {
    return { byRule: "R5", rationale: `Klimisch ${attacker.klimisch} outranks Klimisch ${target.klimisch} at equal mechanistic relevance.` };
  }

  return null;
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
 * R6: a multiplier rewarding agreement across DISTINCT streams.
 *
 * Counting claims would reward a chatty source; counting distinct streams
 * rewards genuine independence, which is what weight-of-evidence means.
 */
export function concordanceBoost(claims: EvidenceClaim[], ruleset: Ruleset): number {
  const r = rule(ruleset, "R6");
  if (!r || claims.length === 0) return 1;
  const committed = claims.filter((c) => c.assertion !== "ambiguous");
  if (committed.length === 0) return 1;
  const majority = committed.filter((c) => c.assertion === committed[0]!.assertion);
  const distinctStreams = new Set(majority.map((c) => c.stream)).size;
  return 1 + r.strength * Math.max(0, distinctStreams - 1) * 0.25;
}
