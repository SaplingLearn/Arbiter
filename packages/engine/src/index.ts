import { shouldAbstain } from "./abstain.js";
import { argue } from "./argue.js";
import { detectConflict } from "./conflict.js";
import { VACUOUS, claimToMass, fuse, type Mass } from "./fuse.js";
import { concordanceBoost, relevanceDiscount } from "./rules.js";
import type { EvidenceClaim, Reasoning, Ruleset, TraceStep, Verdict } from "./types.js";

export * from "./types.js";
export { EvidenceClaimSchema, EvidenceFileSchema, RulesetSchema } from "./schema.js";
export { VACUOUS, claimToMass, combine, fuse } from "./fuse.js";
export { concordanceBoost, conflictsWith, defeats, downweightFactor } from "./rules.js";
export { argue } from "./argue.js";
export { detectConflict } from "./conflict.js";
export { shouldAbstain } from "./abstain.js";

/**
 * Shift a claim's committed mass toward Theta by `factor`, leaving the rest
 * uncommitted. This is the only place evidence quality changes a mass, and it is
 * driven entirely by `relevanceDiscount` - including R4, which is one of the six
 * principles it applies. UNDECIDED claims never reach here; they push VACUOUS
 * directly, because ignorance is not a discounted opinion.
 */
function soften(m: Mass, factor: number): Mass {
  const toxic = m.toxic * factor;
  const safe = m.safe * factor;
  return { toxic, safe, uncommitted: 1 - toxic - safe };
}

/**
 * ARBITER's only public entry point.
 *
 * PURE: no I/O, no clock, no randomness. Filtering claims by `availableFrom`
 * for as-of replay is the CALLER's job - the engine cannot read a clock, which
 * is exactly why the as-of control is a change of input rather than a change
 * of behaviour.
 */
export function reason(claims: EvidenceClaim[], ruleset: Ruleset, rulesetHash = ""): Reasoning {
  const { statuses, trace } = argue(claims, ruleset);

  const masses: Mass[] = [];
  /** claimId -> the discount explanation, folded into that claim's existing trace step. */
  const discountNotes = new Map<string, string>();

  for (const c of claims) {
    const status = statuses.get(c.id);

    // Defeated: excluded from fusion entirely, but RETAINED in the trace.
    if (status === "defeated") continue;

    // Undecided: contributes ignorance, never a vote. This is the
    // fusion-versus-averaging distinction applied to the argumentation layer.
    if (status === "undecided") {
      masses.push({ ...VACUOUS });
      continue;
    }

    // Admitted: apply the evidence-quality discount.
    //
    // This is what makes an unopposed-but-weak evidence set abstain rather than
    // advance. Four clean rodent studies with no exposure data do not license a
    // safety conclusion just because nothing contradicts them - so most of their
    // mass belongs in Theta, not on "safe".
    const { factor, reasons } = relevanceDiscount(c, ruleset);
    masses.push(soften(claimToMass(c.assertion, c.strength), factor));

    if (reasons.length > 0) {
      discountNotes.set(
        c.id,
        ` Weight reduced to ${(factor * 100).toFixed(0)}% of stated confidence: ` +
        reasons.map((r) => r.rationale).join(" "),
      );
    }
  }

  // Fold discount explanations into the EXISTING step for each claim rather than
  // appending new ones - exactly one trace step per claim is an invariant the UI
  // and the tests both rely on.
  const enrichedTrace: TraceStep[] = trace.map((step) => {
    const note = discountNotes.get(step.claimId);
    return note ? { ...step, rationale: step.rationale + note } : step;
  });

  const admitted = claims.filter((c) => statuses.get(c.id) === "admitted");
  const fused = fuse(masses);

  // R6 sharpens a concordant conclusion by moving uncommitted mass onto the side
  // the independent streams agree on, capped so it cannot exceed available mass.
  //
  // The side comes from concordanceBoost's own `supports` field - NOT from a lean
  // computed separately off the fused mass. Deriving the side independently is how
  // a boost earned by the safe cluster could end up sharpening a toxic verdict.
  const { supports, boost } = concordanceBoost(admitted, ruleset);
  let mass = fused.mass;
  if (supports !== null && supports !== "ambiguous" && boost > 1) {
    const side = supports; // "toxic" | "safe"
    const move = Math.min(mass.uncommitted, mass[side] * (boost - 1));
    mass = side === "toxic"
      ? { toxic: mass.toxic + move, safe: mass.safe, uncommitted: mass.uncommitted - move }
      : { toxic: mass.toxic, safe: mass.safe + move, uncommitted: mass.uncommitted - move };
  }

  const belief = mass.toxic;
  const plausibility = mass.toxic + mass.uncommitted;

  const abst = shouldAbstain({ belief, plausibility, conflictMass: fused.conflictMass, statuses, claims, ruleset });

  let verdict: Verdict;
  if (abst.abstain) verdict = "abstain";
  else if (mass.toxic > mass.safe) verdict = "do_not_advance";
  else if (mass.safe > mass.toxic) verdict = "advance";
  else verdict = "abstain"; // exactly balanced: declining is the honest answer

  const survivors = claims.filter((c) => {
    const s = statuses.get(c.id);
    return s === "admitted" || s === "downweighted";
  });
  const contested = detectConflict(survivors).conflicting || fused.conflictMass > 0;

  const withReason = abst.reason
    ? [...enrichedTrace, { claimId: "__verdict__", status: "undecided" as const, rationale: abst.reason }]
    : enrichedTrace;

  return {
    verdict,
    contested,
    belief,
    plausibility,
    conflictMass: fused.conflictMass,
    trace: withReason,
    counterfactual: null, // Task 8
    nextExperiment: null, // Task 9
    rulesetHash,
  };
}
