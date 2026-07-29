import {
  planNextExperiment,
  reasonVerdictOnly,
  type AbstentionQuality,
  type AssayOperator,
  type Calibration,
  type ConflictSubsetAccuracy,
  type EvidenceClaim,
  type Ruleset,
  type ScoredPipeline,
  type Verdict,
} from "@arbiter/engine";
import { jitter01, mulberry32, uniform } from "./prng.js";
import { balancedAccuracy, balancedAccuracyInterval, confusion, mean, singleClass, wilson } from "./stats.js";
import type { ResultRow } from "./main.js";

/** do_not_advance means "predicted toxic" = 1. abstain is not a prediction. */
const toBinary = (v: Verdict): number | null =>
  v === "do_not_advance" ? 1 : v === "advance" ? 0 : null;

function score(pairs: { y: number; predicted: number | null }[]): ScoredPipeline {
  const committed = pairs.filter((p) => p.predicted !== null) as { y: number; predicted: number }[];
  const acc = balancedAccuracy(committed);
  const correct = committed.filter((p) => p.y === p.predicted).length;
  return {
    balancedAccuracy: acc,
    balancedAccuracyCi: balancedAccuracyInterval(committed),
    rawAccuracyCi: wilson(correct, committed.length),
    coverage: pairs.length === 0 ? 0 : committed.length / pairs.length,
    nCommitted: committed.length,
    confusion: confusion(committed),
    singleClass: singleClass(committed),
  };
}

/**
 * METRIC 1 (headline): balanced accuracy on the CONFLICT SUBSET only.
 *
 * Overall accuracy is inflated by easy unanimous cases. The conflict subset is
 * where the product lives, so it is the only subset reported as the headline.
 *
 * Accuracy is ALWAYS returned with coverage. 85% accuracy while abstaining on 60%
 * of cases is not an 85% system, and reporting the pair together is the only way
 * that number means what a reader will take it to mean.
 */
export function conflictSubsetAccuracy(rows: ResultRow[]): ConflictSubsetAccuracy {
  const subset = rows.filter((r) => r.conflicting);
  const arbiter = score(subset.map((r) => ({ y: r.y, predicted: toBinary(r.arbiter.verdict) })));

  const names = new Set<string>();
  for (const r of subset) for (const k of Object.keys(r.baselines)) names.add(k);

  const baselines: Record<string, ScoredPipeline> = {};
  for (const name of [...names].sort()) {
    baselines[name] = score(subset.map((r) => ({
      y: r.y,
      predicted: r.baselines[name] ? toBinary(r.baselines[name]!.verdict) : null,
    })));
  }

  return {
    n: subset.length,
    positiveRate: subset.length === 0 ? null : subset.reduce((s, r) => s + r.y, 0) / subset.length,
    arbiter,
    baselines,
  };
}

/**
 * METRIC 3: uncertainty calibration.
 *
 * strictCoverage applies the literal Dempster-Shafer reading - the interval covers
 * y when belief <= y <= plausibility. Against a binary label that is demanding:
 * covering y=1 requires plausibility of exactly 1, i.e. zero mass on safe. We
 * report it because it is the honest literal answer, and we expect it to be low.
 *
 * The number that actually TESTS THE HONESTY CLAIM is the width split: is the
 * interval wider where ARBITER was wrong than where it was right? If yes, the
 * uncertainty is doing its job, which is what "honest range" is supposed to mean.
 * meanWidth is reported alongside because a wide always-right interval is
 * worthless.
 */
export function calibration(rows: ResultRow[]): Calibration {
  const width = (r: ResultRow) => r.arbiter.plausibility - r.arbiter.belief;
  const committed = rows.filter((r) => toBinary(r.arbiter.verdict) !== null);
  const correct = committed.filter((r) => toBinary(r.arbiter.verdict) === r.y);
  const incorrect = committed.filter((r) => toBinary(r.arbiter.verdict) !== r.y);

  const strict = rows.filter((r) => r.arbiter.belief <= r.y && r.y <= r.arbiter.plausibility).length;
  const wCorrect = mean(correct.map(width));
  const wIncorrect = mean(incorrect.map(width));

  return {
    strictCoverage: rows.length === 0 ? 0 : strict / rows.length,
    meanWidth: mean(rows.map(width)),
    meanWidthOnCorrect: wCorrect,
    meanWidthOnIncorrect: wIncorrect,
    widthDiscriminates: incorrect.length > 0 && wIncorrect > wCorrect,
    // A comparison of means needs both groups to be non-trivial. With a handful of
    // committed rows this flag is noise, and saying so beside it stops the deck
    // quoting a coin flip as evidence of calibration.
    widthDiscriminatesIsMeaningful: correct.length >= 5 && incorrect.length >= 5,
    nCorrect: correct.length,
    nIncorrect: incorrect.length,
  };
}

/**
 * METRIC 4: abstention quality.
 *
 * The safety behaviour: ARBITER should be MORE accurate on what it commits to than
 * on the set as a whole, and should route the rest to a human. Decline rate is
 * reported inseparably from accuracy.
 */
export function abstentionQuality(rows: ResultRow[]): AbstentionQuality {
  const declined = rows.filter((r) => r.arbiter.verdict === "abstain");
  const pairs = rows
    .map((r) => ({ y: r.y, predicted: toBinary(r.arbiter.verdict) }))
    .filter((p) => p.predicted !== null) as { y: number; predicted: number }[];
  const correct = pairs.filter((p) => p.y === p.predicted).length;

  return {
    declineRate: rows.length === 0 ? 0 : declined.length / rows.length,
    balancedAccuracyOnCommitted: balancedAccuracy(pairs),
    ciOnCommitted: wilson(correct, pairs.length),
    singleClassOnCommitted: singleClass(pairs),
    nDeclined: declined.length,
    nCommitted: pairs.length,
  };
}

/**
 * METRIC 2b: robustness under perturbation.
 *
 * Determinism on its own is close to tautological - a pure function is a pure
 * function, and a judge is right to say "you proved your calculator does not
 * change its mind." The claim that matters is STABILITY: a deterministic system
 * that sits on a knife edge is not consistent in any useful sense.
 *
 * Evidence strength is jittered +/-10% and rule strength +/-25%. All randomness
 * comes from the seeded PRNG, and the seed is committed, because this figure is
 * golden-filed.
 *
 * HELD FRACTION IS NOT ALWAYS A VIRTUE. A compound that abstains because its
 * evidence is far from any threshold holds at 1.0 under any perturbation, so a
 * corpus that abstains on everything scores a perfect robustness figure while
 * demonstrating nothing. `baselineVerdict` is returned so the reader can separate
 * "stable because it is well-supported" from "stable because it was never close
 * to deciding".
 */
export function robustness(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  samples: number,
  seed: number,
): { determinism: 1; baselineVerdict: Verdict; heldFraction: number; samples: number; seed: number } {
  const baseline = reasonVerdictOnly(claims, ruleset).verdict;
  const next = mulberry32(seed);
  let held = 0;

  for (let i = 0; i < samples; i++) {
    const perturbedClaims = claims.map((c) => ({ ...c, strength: jitter01(next, c.strength, 0.10) }));
    const perturbedRules: Ruleset = {
      ...ruleset,
      rules: ruleset.rules.map((r) => ({ ...r, strength: jitter01(next, r.strength, 0.25) })),
    };
    if (reasonVerdictOnly(perturbedClaims, perturbedRules).verdict === baseline) held++;
  }

  return {
    determinism: 1,
    baselineVerdict: baseline,
    heldFraction: samples === 0 ? 1 : held / samples,
    samples,
    seed,
  };
}

/**
 * METRIC 5: planner sensitivity.
 *
 * The planner's outcome priors are expert-elicited, not learned - the spec
 * discloses this. Rather than apologising for it, measure it: perturb every prior
 * by +/-50% and report how often the top recommendation is unchanged. If the
 * recommendation is driven by argument structure rather than by the priors, this
 * number is high, and the disclosed limitation becomes a result.
 */
export function plannerSensitivity(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  assays: AssayOperator[],
  samples: number,
  seed: number,
): { baselineAssay: string | null; unchangedFraction: number; samples: number; seed: number } {
  const bare = (c: EvidenceClaim[], rs: Ruleset) => reasonVerdictOnly(c, rs);
  const baseline = planNextExperiment(claims, ruleset, assays, bare);
  if (!baseline) return { baselineAssay: null, unchangedFraction: 1, samples: 0, seed };

  const next = mulberry32(seed);
  let unchanged = 0;
  for (let i = 0; i < samples; i++) {
    const perturbed = assays.map((a) => ({
      ...a,
      priorToxic: Math.max(0.01, Math.min(0.99, a.priorToxic * uniform(next, 0.5, 1.5))),
    }));
    if (planNextExperiment(claims, ruleset, perturbed, bare)?.assay === baseline.assay) unchanged++;
  }

  return {
    baselineAssay: baseline.assay,
    unchangedFraction: samples === 0 ? 1 : unchanged / samples,
    samples,
    seed,
  };
}
