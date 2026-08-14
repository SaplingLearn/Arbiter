import type { Call } from "./deliberation.js";

/**
 * How much a room agreed.
 *
 * WHAT THIS MAY BE USED FOR, because the answer is narrow. Spec section 6.4:
 * "Counts are never an input to the verdict, and are shown to a later reader as
 * context only." That clause is the whole licence for this file. An agreement
 * figure is a MEASUREMENT OF THE ROOM, not evidence about the compound. Nothing
 * here may gate signing, weight an adjudication, reorder a position, or decide
 * anything at all. If a later change makes an outcome depend on a number computed
 * in this file, that change is the defect and this comment is the reason.
 *
 * WHY MEASURE IT. The disagreement literature is why this product exists, and
 * until now the product could describe a disagreement and could not quantify one.
 * Expert liver-injury causality assessment among hepatologists reaches weighted
 * kappa 0.60 (Hayashi et al. 2015, Liver International), and one study found 27%
 * initial complete agreement among three independent reviewers across 187 cases
 * (Rockey et al. 2010, Hepatology). Those are the figures a reader wants to hold
 * a room against, and the room's own number did not exist.
 *
 * TWO FUNCTIONS, AND THE REASON IS STATISTICAL rather than stylistic. See the
 * docstring on caseAgreement.
 */

export interface CaseAgreement {
  raters: number;
  /** Proportion of rater PAIRS that made the same call. 1 is unanimity, 0 is all different. */
  pairwiseAgreement: number;
  /** Distance from unanimity: raters outside the largest camp. NOT a claim that the
   *  largest camp is right, and no copy may imply otherwise. */
  dissenters: number;
}

function tally(calls: Call[]): Map<Call, number> {
  const counts = new Map<Call, number>();
  for (const c of calls) counts.set(c, (counts.get(c) ?? 0) + 1);
  return counts;
}

/**
 * Pairwise percent agreement for ONE case.
 *
 * Deliberately NOT kappa, and this is the trap worth naming. On a single item
 * Fleiss' kappa is 0/0 whenever the room is unanimous: the marginal distribution
 * it needs for expected agreement is estimated from the very item being scored, so
 * observed and expected are both 1. That is not a small-sample wobble, it is
 * undefined, and unanimity is a large fraction of real cases. A per-case kappa
 * would print "null" on most cases and mislead on the rest.
 *
 * Pairs rather than people, because "three of four agreed" is a headcount and
 * reads as 0.75, where the agreement among those four is 0.5.
 */
export function caseAgreement(calls: Call[]): CaseAgreement | null {
  const n = calls.length;
  if (n < 2) return null;

  const counts = tally(calls);
  let agreeingPairs = 0;
  let largestCamp = 0;
  for (const k of counts.values()) {
    agreeingPairs += (k * (k - 1)) / 2;
    if (k > largestCamp) largestCamp = k;
  }

  return {
    raters: n,
    pairwiseAgreement: agreeingPairs / ((n * (n - 1)) / 2),
    dissenters: n - largestCamp,
  };
}

export interface KappaReport {
  /** Cases with two or more positions. Always report this beside the kappa. */
  items: number;
  totalAssignments: number;
  observedAgreement: number;
  expectedAgreement: number;
  /** null when the statistic is undefined. Never substitute 0 or 1 for null. */
  kappa: number | null;
  undefinedReason: string | null;
}

/**
 * Fleiss' kappa ACROSS several cases. Chance corrected, nominal, UNWEIGHTED.
 *
 * Unweighted on purpose. A weighted kappa needs an ordering over the three calls,
 * and asserting that cannot_conclude sits between advance and do_not_advance would
 * be a scientific claim smuggled in as a formatting choice: a case nobody can call
 * is not half a stop. If an ordering is ever wanted it gets registered with a
 * rationale, like every other policy in this repository.
 *
 * Varying panel sizes are handled with the per-item n in the observed term and the
 * pooled assignments in the expected term, which is the standard generalisation.
 * Cases with fewer than two positions are dropped rather than counted as agreement:
 * a case one person answered is not a case everybody agreed on.
 *
 * On three to five reviewers this is statistically thin. Every caller reports
 * `items` beside it, and no caller may present it as a result on its own.
 */
export function fleissKappa(items: Call[][]): KappaReport {
  const usable = items.filter((it) => it.length >= 2);
  const totalAssignments = usable.reduce((s, it) => s + it.length, 0);

  if (usable.length === 0) {
    return {
      items: 0, totalAssignments: 0, observedAgreement: 0, expectedAgreement: 0,
      kappa: null, undefinedReason: "no case had two or more submitted positions",
    };
  }

  // Observed: mean over items of the proportion of agreeing pairs within the item.
  let observedSum = 0;
  for (const it of usable) {
    const n = it.length;
    let sq = 0;
    for (const k of tally(it).values()) sq += k * k;
    observedSum += (sq - n) / (n * (n - 1));
  }
  const observedAgreement = observedSum / usable.length;

  // Expected: sum over categories of the squared pooled proportion.
  const pooled = tally(usable.flat());
  let expectedAgreement = 0;
  for (const k of pooled.values()) expectedAgreement += (k / totalAssignments) ** 2;

  if (1 - expectedAgreement < Number.EPSILON) {
    return {
      items: usable.length, totalAssignments, observedAgreement, expectedAgreement,
      kappa: null,
      undefinedReason:
        "every position across every case used one category, so expected agreement is 1 and there is no chance agreement to correct for",
    };
  }

  return {
    items: usable.length, totalAssignments, observedAgreement, expectedAgreement,
    kappa: (observedAgreement - expectedAgreement) / (1 - expectedAgreement),
    undefinedReason: null,
  };
}
