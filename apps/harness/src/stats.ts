// Interval and Confusion are declared in @arbiter/engine, not here, because they
// are part of the shape of results/metrics.json, which is read outside this
// package. A reader cannot import from the harness - it reads node:fs - so the
// one definition lives where both ends can reach it.
import type { Confusion, Interval } from "@arbiter/engine";

export type { Confusion, Interval };

/**
 * Wilson score interval for a binomial proportion.
 *
 * Chosen over the normal approximation because our n is small and Wilson stays
 * inside [0,1] at the extremes, where the normal approximation produces intervals
 * like [-0.06, 0.31] that make a deck look careless.
 */
export function wilson(successes: number, n: number, z = 1.96): Interval {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export function confusion(pairs: { y: number; predicted: number }[]): Confusion {
  const c: Confusion = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const { y, predicted } of pairs) {
    if (y === 1 && predicted === 1) c.tp++;
    else if (y === 1) c.fn++;
    else if (predicted === 1) c.fp++;
    else c.tn++;
  }
  return c;
}

/**
 * Balanced accuracy = (sensitivity + specificity) / 2.
 *
 * Plain accuracy is not reportable on DILIrank: predicting the majority class on
 * a 60/40 split scores 0.60 while learning nothing.
 *
 * Returns 0.5 for an absent class rather than dividing by zero - and that
 * substitution is why `singleClass` exists below. A run that only ever saw
 * positives scores (sens + 0.5)/2, which looks like a real number and is not one.
 */
export function balancedAccuracy(pairs: { y: number; predicted: number }[]): number {
  const { tp, fp, tn, fn } = confusion(pairs);
  const sens = tp + fn === 0 ? 0.5 : tp / (tp + fn);
  const spec = tn + fp === 0 ? 0.5 : tn / (tn + fp);
  return (sens + spec) / 2;
}

/**
 * True when one class is entirely absent, so balancedAccuracy substituted 0.5 for
 * half of its own definition.
 *
 * Reported next to every balanced accuracy. Without it a figure computed over
 * four same-label compounds is indistinguishable from one computed over a
 * balanced hundred, and this project's conflict subset is 90% positive.
 */
export function singleClass(pairs: { y: number; predicted: number }[]): boolean {
  const { tp, fp, tn, fn } = confusion(pairs);
  return tp + fn === 0 || tn + fp === 0;
}

/**
 * A confidence interval for BALANCED accuracy, or null when there is not one.
 *
 * This exists because `wilson(correct, n)` is an interval for RAW accuracy, and
 * the two statistics are different numbers. Reporting the raw-accuracy interval
 * beside a balanced accuracy produced claims that contradicted themselves: on
 * `single:qsar` the balanced accuracy is 0.500 and the raw-accuracy interval is
 * [0.799, 0.953], which does not even contain the point estimate it was printed
 * next to. On the ARBITER headline it read "balanced accuracy 0.75 (95% CI
 * 0.51-1.00)", where the interval was really describing raw accuracy 4/4 = 1.0.
 *
 * Returns NULL when either class is absent, and that is the substantive part.
 * Balanced accuracy substitutes 0.5 for the missing half; a substitution carries
 * no sampling uncertainty because it is not an estimate, so no honest interval
 * exists. Emitting one anyway would put a precision claim on a placeholder.
 *
 * When both classes are present, each of sensitivity and specificity gets its own
 * Wilson interval and the bounds are averaged, mirroring how the point estimate
 * itself is the average of the two proportions. Conservative and stays in [0,1].
 */
export function balancedAccuracyInterval(pairs: { y: number; predicted: number }[]): Interval | null {
  const { tp, fp, tn, fn } = confusion(pairs);
  if (tp + fn === 0 || tn + fp === 0) return null;

  const sens = wilson(tp, tp + fn);
  const spec = wilson(tn, tn + fp);
  return { lo: (sens.lo + spec.lo) / 2, hi: (sens.hi + spec.hi) / 2 };
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length;
}
