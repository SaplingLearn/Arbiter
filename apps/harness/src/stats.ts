export interface Interval { lo: number; hi: number }

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

export interface Confusion { tp: number; fp: number; tn: number; fn: number }

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

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length;
}
