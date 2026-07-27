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

/**
 * Two claims conflict only when both commit to opposite conclusions ABOUT THE
 * SAME COMPOUND.
 *
 * The compoundId guard is not decoration. Every caller today groups claims by
 * compound before calling `reason`, so it cannot fire - but nothing in the type
 * system says so, and the failure it prevents is silent and severe: a "toxic"
 * finding on compound A defeating a "safe" finding on compound B would delete a
 * live argument from an unrelated compound's verdict and the trace would read
 * perfectly plausible. Cheap guard, unbounded downside.
 */
export function conflictsWith(a: EvidenceClaim, b: EvidenceClaim): boolean {
  if (a.compoundId !== b.compoundId) return false;
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
  // Says "evidence" and not "in vivo evidence" deliberately. R1's registered
  // statement is phrased about animal in vivo evidence, but the predicate reads
  // `system`, which is orthogonal to in vivo/in vitro - a rodent hepatocyte assay
  // is system: "rodent", stream: "cytotox". Claiming "in vivo" in the rationale
  // would put a false statement about the study design into the trace a
  // toxicologist reads. Narrowing the PREDICATE to in vivo streams instead would
  // be a change to the registered rule, not a correction toward it, so the
  // rationale is what gets fixed.
  R1: (attacker, target) =>
    attacker.system === "human" && ANIMAL_SYSTEMS.has(target.system)
      ? { rationale: `Human-relevant evidence outranks ${target.system} evidence for a human endpoint.` }
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

/**
 * Rank of a rule in the preference ordering; lower outranks higher.
 *
 * Accepts any RuleId, not just a DefeatRuleId: R4 and R6 are legitimately absent
 * from `precedenceOrder` (R4 downweights, R6 is a set property) and both rank
 * last, which is the correct answer rather than an error. Exported because
 * argue.ts needs the same ordering to pick which of several surviving attackers
 * to report, and two copies of a ranking function is how the two drift apart.
 */
export function precedenceRank(id: RuleId, ruleset: Ruleset): number {
  const idx = (ruleset.precedenceOrder as RuleId[]).indexOf(id);
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

/**
 * R4: reduce the weight of an out-of-domain prediction rather than defeating it.
 *
 * WHY `=== false` HERE AND `!== true` IN R3. The two rules treat `null` in
 * opposite directions, and that asymmetry is deliberate rather than an oversight:
 *
 *   R3 (`exposureRelevant !== true`): null IS a weakness. "We never established
 *   the margin" and "we established it and the margin was bad" both mean a
 *   negative result licenses nothing about clinical safety. Absence of the
 *   measurement is itself the problem.
 *
 *   R4 (`inApplicabilityDomain === false`): null is BENIGN. "We could not assess
 *   the applicability domain" is not evidence the model was operating outside it.
 *   Penalising unassessed predictions would punish every source that simply does
 *   not report a domain check, which is most of them.
 *
 * The distinction is what the missing value is missing ABOUT: R3's null is a gap
 * in the evidence's own support, R4's is a gap in our knowledge of the tool.
 */
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

export interface Discount {
  /** Multiplier in (0,1] applied to the claim's committed mass. */
  factor: number;
  /** Which principles reduced it, for the trace. Empty when factor is 1. */
  reasons: { byRule: RuleId; rationale: string }[];
}

/**
 * How much does this claim's committed mass survive, absent any conflict?
 *
 * R1-R6 are tie-breakers when evidence collides. They are ALSO statements about
 * evidence quality, and quality matters even when nothing disagrees. A clean
 * rodent study is weak evidence about a human endpoint whether or not anything
 * contradicts it; a margin never measured at clinical exposure does not become
 * informative just because no one challenged it.
 *
 * Discounted mass moves to Theta - uncommitted - because that is precisely what
 * it is: mass this source cannot commit anywhere. It does NOT move to the
 * opposing side. Weak evidence for safety is not evidence of toxicity.
 *
 * Multiplicative, so several weaknesses compound: a rodent study whose exposure
 * was never established is weaker than either flaw alone.
 *
 * Each factor is 1 - rule.strength, so a toxicologist tunes discounting by
 * editing the same pre-registered, hashed strengths that govern defeats. One
 * number per principle, one meaning, two mechanisms.
 */
export function relevanceDiscount(claim: EvidenceClaim, ruleset: Ruleset): Discount {
  const reasons: Discount["reasons"] = [];
  let factor = 1;

  const apply = (id: RuleId, rationale: string) => {
    const r = rule(ruleset, id);
    if (!r) return;
    // Clamped for the same reason claimToMass clamps: a schema-invalid ruleset
    // must not be able to produce a negative belief, and reason() does not
    // validate its ruleset on every call (it is invoked thousands of times in
    // robustness sampling).
    factor *= Math.min(1, Math.max(0, 1 - r.strength));
    reasons.push({ byRule: id, rationale });
  };

  // R1: non-human evidence about a human endpoint.
  if (claim.system === "rodent" || claim.system === "nonrodent") {
    apply("R1", `${claim.system} evidence is indirect for a human endpoint.`);
  }
  // R2: structural correlation rather than a measured key event. isStructuralOnly
  // already requires measuresKeyEvent === null, so no second key-event test is
  // needed - an earlier draft had one and it could never be false.
  if (isStructuralOnly(claim)) {
    apply("R2", "Correlates with chemical structure; measures no key event directly.");
  }
  // R3: a NEGATIVE finding whose exposure margin was never established.
  //
  // R3 is the ONLY directional rule, and it is directional in its own
  // pre-registered statement: "A positive finding at clinically relevant
  // exposure defeats A NEGATIVE FINDING whose exposure margin is unstated or
  // untested at that range." R1, R2, R4 and R5 describe what KIND of evidence
  // this is, so they apply whichever way the claim points. R3 describes what a
  // result can LICENSE, and that is asymmetric: a positive hit is informative
  // whatever the margin - you go and establish the margin next - whereas an
  // absence of signal at an unknown concentration licenses nothing about
  // safety. Applying R3 to positives as well would have crushed every hazard
  // finding in the automated streams, where the margin is almost never
  // recorded, and abstained on essentially the whole evaluation set.
  if (claim.assertion === "safe" && claim.exposureRelevant !== true) {
    apply("R3", claim.exposureRelevant === false
      ? "A negative result from testing outside the clinically relevant exposure range."
      : "A negative result whose exposure margin relative to the clinical range was never established.");
  }
  // R4: outside the model's applicability domain. Already the existing behaviour.
  if (claim.inApplicabilityDomain === false) {
    apply("R4", "Model was operating outside its applicability domain.");
  }
  // R5: low study reliability. Klimisch 1 and 2 are reliable; 3 and 4 are not.
  if (claim.klimisch !== null && claim.klimisch >= 3) {
    apply("R5", `Klimisch ${claim.klimisch} indicates limited study reliability.`);
  }

  return { factor, reasons };
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
 *
 * DIAGNOSTIC ONLY - this is deliberately NOT applied to any mass. Concordance is
 * already realised by Dempster's rule of combination in fuse(); applying a second
 * multiplicative boost on top double-counted it and could invert a verdict. Kept
 * because "how many independent streams concur, and on which side" is worth
 * REPORTING to a reviewer. If you are about to multiply a mass by this, don't.
 *
 * ON THE 0.25. It was previously flagged that this coefficient sits in source
 * rather than in the pre-registered, hashed ruleset, so "where did 0.25 come
 * from?" had no answer. That objection is DISCHARGED BY THE DEMOTION rather than
 * by registering a number: an unregistered constant matters when it can move a
 * verdict, and this one no longer touches a verdict, a mass or a metric. It scales
 * a reported diagnostic only. Registering it would imply the ruleset governs it,
 * which would be the opposite of true - and it cannot be added anyway without
 * invalidating the pre-registration hash.
 *
 * KNOWN LIMITATION, carried to Task 12: independence is proxied by `stream`, and
 * Tox21 supplies BOTH the cytotox and transporter streams. Two readouts from one
 * assay platform therefore count as two independent sources here. Since this
 * function is diagnostic-only the mis-count cannot reach a verdict, but a reviewer
 * reading the reported concordance should know it overstates independence for
 * Tox21-derived claims.
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
