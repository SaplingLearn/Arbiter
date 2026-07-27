import type { ClaimStatus, EvidenceClaim, Ruleset } from "./types.js";

/**
 * Decide whether to decline a verdict.
 *
 * Abstention is a first-class output, not a failure. On a compound where the
 * evidence cannot settle the question, "I cannot vouch for this yet" is the
 * correct answer and a confident guess would be dangerous.
 *
 * The gap threshold comes from the PRE-REGISTERED ruleset, never a constant in
 * this file - so it cannot be tuned after seeing results.
 */
export function shouldAbstain(input: {
  belief: number;
  plausibility: number;
  conflictMass: number;
  statuses: Map<string, ClaimStatus>;
  claims: EvidenceClaim[];
  ruleset: Ruleset;
}): { abstain: boolean; reason: string | null } {
  const { belief, plausibility, conflictMass, claims, ruleset } = input;

  if (conflictMass >= 1 - 1e-9) {
    return { abstain: true, reason: "Total conflict between sources; no conclusion survives combination." };
  }

  const committed = claims.filter((c) => c.assertion !== "ambiguous");
  if (committed.length > 0 && committed.every((c) => c.inApplicabilityDomain === false)) {
    return {
      abstain: true,
      reason: "Every committed source lies outside its applicability domain; this compound is off the map.",
    };
  }

  const gap = plausibility - belief;
  if (gap > ruleset.abstentionGapThreshold) {
    return {
      abstain: true,
      reason: `Belief-to-plausibility gap ${gap.toFixed(2)} exceeds the pre-registered threshold ${ruleset.abstentionGapThreshold.toFixed(2)}.`,
    };
  }

  return { abstain: false, reason: null };
}
