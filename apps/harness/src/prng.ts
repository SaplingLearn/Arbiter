/**
 * All randomness in ARBITER lives here.
 *
 * The engine bans Math.random outright, so perturbation sampling for the
 * robustness and planner-sensitivity metrics happens in the harness with a seeded
 * generator and the seed committed alongside the results. That is what makes those
 * figures reproducible - and they have to be, because they are golden-filed in
 * Task 16.
 *
 * mulberry32: small, fast, well-distributed, and identical across platforms, which
 * matters because CI must reproduce a local number exactly.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform in [lo, hi). */
export function uniform(next: () => number, lo: number, hi: number): number {
  return lo + next() * (hi - lo);
}

/** Multiplicative jitter: value scaled by a factor in [1-pct, 1+pct], clamped to [0,1]. */
export function jitter01(next: () => number, value: number, pct: number): number {
  return Math.max(0, Math.min(1, value * uniform(next, 1 - pct, 1 + pct)));
}
