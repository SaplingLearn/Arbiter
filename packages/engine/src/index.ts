import { shouldAbstain } from "./abstain.js";
import { argue } from "./argue.js";
import { detectConflict } from "./conflict.js";
import { VACUOUS, claimToMass, fuse, type Mass } from "./fuse.js";
import { relevanceDiscount } from "./rules.js";
import type { EvidenceClaim, Reasoning, Ruleset, TraceStep, Verdict } from "./types.js";

export * from "./types.js";
export { EvidenceClaimSchema, EvidenceFileSchema, RulesetSchema } from "./schema.js";
export { VACUOUS, claimToMass, combine, fuse } from "./fuse.js";
export type { Mass } from "./fuse.js";
export { concordanceBoost, conflictsWith, defeats, downweightFactor, relevanceDiscount } from "./rules.js";
export type { Discount } from "./rules.js";
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

    // Ambiguous claims commit to nothing, so there is no committed mass to
    // discount and a discount note would describe a reduction that never
    // happened. claimToMass already returns VACUOUS for these.
    if (c.assertion === "ambiguous") {
      masses.push(claimToMass(c.assertion, c.strength));
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

  const fused = fuse(masses);

  // R6 needs no separate mechanism here: Dempster's rule of combination IS the
  // concordance mechanism. Two independent 0.18 "safe" claims fuse to 0.3276 -
  // agreement between independent streams already raises belief more than one
  // source repeating itself, which is exactly R6's registered statement. The
  // ruleset's own framework note says so: "Formalised by the evidence fusion
  // layer; independence is at the stream level."
  //
  // An earlier draft ALSO applied an explicit multiplicative boost on top. It was
  // removed for three reasons, in order of severity:
  //   1. It could invert the verdict. A stream-count majority overrode a
  //      Dempster-Shafer mass majority: safe 0.18 + safe 0.18 + toxic 0.33 fuses
  //      to toxic 0.2488 vs safe 0.2461, yet the boost lifted safe to 0.2543 and
  //      reason() returned "advance" while still reporting belief 0.2488. The
  //      output contradicted itself and no field explained why.
  //   2. It double-counted concordance, which fusion had already rewarded.
  //   3. Its 0.25 coefficient lived outside the pre-registered, hashed ruleset,
  //      so "where did 0.25 come from?" had no defensible answer.
  const mass = fused.mass;

  const belief = mass.toxic;
  const plausibility = mass.toxic + mass.uncommitted;

  const abst = shouldAbstain({ belief, plausibility, conflictMass: fused.conflictMass, statuses, claims, ruleset });

  let verdict: Verdict;
  let verdictReason = abst.reason;
  if (abst.abstain) verdict = "abstain";
  else if (mass.toxic > mass.safe) verdict = "do_not_advance";
  else if (mass.safe > mass.toxic) verdict = "advance";
  else {
    // Exactly balanced. Declining is the honest answer, and it needs to SAY so -
    // an abstention the trace cannot explain undercuts the claim that abstention
    // is a first-class output.
    verdict = "abstain";
    verdictReason = "Evidence for and against is exactly balanced; no side can be preferred.";
  }

  // An argument survives when nothing DEFEATED it - which includes `undecided`.
  // Undecided is the state of being locked in a mutual-defeat cycle, so a case
  // where four claims deadlock two-against-two is maximally contested, not
  // uncontested. Filtering to admitted|downweighted here (as an earlier draft did)
  // reported `contested: false` on exactly that input, because vacuous masses also
  // generate no conflict mass - four visibly deadlocked claims with the field
  // beside them saying there was no disagreement.
  //
  // NOTE: this is deliberately NOT the pre-registered conflict-subset definition
  // used for the Task 15 headline. That one is fixed in spec §11 as a property of
  // the RAW claims, evaluated by the harness before any rule runs, so it cannot
  // move when rule behaviour changes. `contested` is the per-result display field.
  const undefeated = claims.filter((c) => statuses.get(c.id) !== "defeated");
  const contested = detectConflict(undefeated).conflicting || fused.conflictMass > 0;

  const withReason: TraceStep[] = verdictReason
    ? [...enrichedTrace, { claimId: "__verdict__", status: "undecided" as const, kind: "verdict" as const, rationale: verdictReason }]
    : enrichedTrace;

  return {
    verdict,
    contested,
    belief,
    plausibility,
    mass,
    conflictMass: fused.conflictMass,
    trace: withReason,
    counterfactual: null, // Task 8
    nextExperiment: null, // Task 9
    rulesetHash,
  };
}
