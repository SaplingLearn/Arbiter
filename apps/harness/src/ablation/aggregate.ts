import { mean } from "../stats.js";

/**
 * ARBITER's own verdict space (ablation spec section 5.2).
 *
 * The model is offered all three. Denying it `abstain` - the verdict ARBITER
 * reaches on 97.4% of compounds - would rig the comparison in ARBITER's favour
 * and would be indefensible the moment anyone read the prompt. The model must be
 * able to decline for the same reason ARBITER can.
 */
export const VERDICTS = ["advance", "do_not_advance", "abstain"] as const;
export type Verdict = (typeof VERDICTS)[number];

/**
 * One request's outcome.
 *
 * `verdict === null` means the model DECLINED, which is an operating condition
 * and not an error path (spec section 2.2): a refusal arrives as HTTP 200 with
 * `stop_reason: "refusal"` and an empty content array, so nothing throws and
 * nothing is non-2xx. A refusal is data - it is recorded, never retried, and
 * never re-run on a substitute model.
 */
export interface AblationRun {
  compoundId: string;
  runIndex: number;
  verdict: Verdict | null;
  confidence: number | null;
  stopReason: string;
  refusalCategory?: string | null;
}

export interface CompoundStats {
  agreementRate: number;
  confidenceStdDev: number;
  nScored: number;
}

export interface AblationTotals {
  refusalRate: number;
  refused: number;
  requests: number;
}

/**
 * Exactly the shape `run-metrics.ts` already destructures (spec section 3).
 *
 * The contract is fixed and must not be renegotiated here: changing it means
 * changing `LlmConsistencyMeasured` in the engine, `MetricsDocumentSchema`, and
 * the Validation tab. `config` is deliberately opaque to the engine type and is
 * filled by the runner (spec section 7).
 */
export interface AblationDocument {
  config: unknown;
  totals: AblationTotals;
  byCompound: Record<string, CompoundStats>;
}

/**
 * Population standard deviation, not the sample estimator.
 *
 * These 25 runs are the entire population of interest for that compound - we are
 * not estimating the spread of some larger hypothetical run set, we are
 * describing the spread of the runs that were actually paid for. Bessel's
 * correction would answer a question nobody asked.
 */
function populationStdDev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/**
 * The modal verdict's share of the runs that RETURNED a verdict.
 *
 * The denominator is `nScored`, never `requests`. Dividing by requests would let
 * a compound the model mostly declined to answer look inconsistent rather than
 * mostly-refused, silently blending two findings the write-up has to keep apart.
 */
function modalRate(verdicts: Verdict[]): number {
  if (verdicts.length === 0) return 0;
  const counts = new Map<Verdict, number>();
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Math.max(...counts.values()) / verdicts.length;
}

/** Memoised log-factorial; the exact floor below needs it up to `runsPerCompound`. */
const LOG_FACT: number[] = [0];
function logFactorial(n: number): number {
  for (let i = LOG_FACT.length; i <= n; i++) {
    const previous = LOG_FACT[i - 1] ?? 0;
    LOG_FACT[i] = previous + Math.log(i);
  }
  return LOG_FACT[n] ?? 0;
}

/**
 * The expected modal rate of a model answering UNIFORMLY AT RANDOM over
 * `kVerdicts` verdicts in `nRuns` runs - the floor `agreementRate` cannot go
 * below, and it is nowhere near zero.
 *
 * Computed EXACTLY here by enumerating every composition of `nRuns` into
 * `kVerdicts` parts and weighting by its multinomial probability. The spec
 * quotes 0.433 and 0.580 from a 200,000-trial simulation; this reproduces both
 * without a PRNG, so the number is reproducible rather than merely re-runnable,
 * and `ablationFloor.test.ts` asserts the agreement.
 *
 * Why it matters: a reader who assumes the scale runs 0 to 1 will read 0.6 as
 * "somewhat inconsistent" when it is indistinguishable from noise. The floor
 * must be reported beside the figure for the same reason `determinismNote`
 * exists - a number whose scale is misread is worse than one that is absent.
 */
export function expectedModalRate(nRuns: number, kVerdicts: number): number {
  if (nRuns <= 0) return 0;
  if (kVerdicts <= 1) return 1;

  const logUniform = -nRuns * Math.log(kVerdicts);
  const counts: number[] = new Array<number>(kVerdicts).fill(0);
  let expectedMax = 0;

  const walk = (depth: number, remaining: number): void => {
    if (depth === kVerdicts - 1) {
      counts[depth] = remaining;
      let logCoefficient = logFactorial(nRuns);
      for (const c of counts) logCoefficient -= logFactorial(c);
      expectedMax += Math.exp(logCoefficient + logUniform) * Math.max(...counts);
      return;
    }
    for (let c = 0; c <= remaining; c++) {
      counts[depth] = c;
      walk(depth + 1, remaining - c);
    }
  };
  walk(0, nRuns);

  return expectedMax / nRuns;
}

/** Distinct verdicts the model actually produced. Refusals carry no verdict. */
export function distinctVerdicts(runs: AblationRun[]): number {
  return new Set(runs.filter((r) => r.verdict !== null).map((r) => r.verdict)).size;
}

/**
 * The OPERATIVE floor, computed from the verdicts observed rather than pinned to
 * a constant.
 *
 * If the model never returns `advance` on this corpus - as ARBITER never does -
 * the operative floor is the two-verdict 0.580, not the three-verdict 0.433, and
 * reporting the lower one would flatter the result by about 0.15.
 */
export function agreementRateFloor(runs: AblationRun[], runsPerCompound: number): number {
  return expectedModalRate(runsPerCompound, distinctVerdicts(runs));
}

/**
 * Runs to the document the app reads.
 *
 * Every compound is retained in `byCompound`, including fully-refused ones, so
 * the distribution stays inspectable and the corpus mean is never the only thing
 * on offer. That is `meanHeldFractionOnCommitted`'s lesson: a mean over cases
 * that were never close to deciding tells you nothing.
 */
export function aggregate(runs: AblationRun[], config: unknown): AblationDocument {
  const byCompound: Record<string, CompoundStats> = {};

  for (const id of [...new Set(runs.map((r) => r.compoundId))].sort()) {
    const mine = runs.filter((r) => r.compoundId === id);
    const scored = mine.filter((r) => r.verdict !== null);
    byCompound[id] = {
      agreementRate: modalRate(scored.map((r) => r.verdict as Verdict)),
      confidenceStdDev: populationStdDev(scored.map((r) => r.confidence ?? 0)),
      nScored: scored.length,
    };
  }

  const refused = runs.filter((r) => r.verdict === null).length;

  return {
    config,
    // Guarded rather than assumed: an empty run set must not put NaN into
    // metrics.json, where it would serialise as `null` and read as a measured
    // zero. Same reasoning as nScored === 0 above.
    totals: {
      refusalRate: runs.length === 0 ? 0 : refused / runs.length,
      refused,
      requests: runs.length,
    },
    byCompound,
  };
}
