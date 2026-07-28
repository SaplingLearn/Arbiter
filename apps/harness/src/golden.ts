export interface GoldenPipeline {
  balancedAccuracy: number;
  coverage: number;
  nCommitted: number;
  /** Null where one class is absent, so no interval for balanced accuracy exists. */
  balancedAccuracyCi: { lo: number; hi: number } | null;
  rawAccuracyCi: { lo: number; hi: number };
}

export interface GoldenNumbers {
  rulesetHash: string;
  splitSeed: number;
  perturbationSeed: number;
  nScored: number;
  nConflictSubset: number;
  arbiterBalancedAccuracy: number;
  arbiterCoverage: number;
  arbiterNCommitted: number;
  arbiterBalancedAccuracyCi: { lo: number; hi: number } | null;
  arbiterRawAccuracyCi: { lo: number; hi: number };
  baselines: Record<string, GoldenPipeline>;
  meanHeldFraction: number;
  worstHeldFraction: number;
  strictCoverage: number;
  meanWidth: number;
  meanWidthOnCorrect: number;
  meanWidthOnIncorrect: number;
  widthDiscriminates: boolean;
  declineRate: number;
  balancedAccuracyOnCommitted: number;
  plannerMeanUnchangedFraction: number;
}

/**
 * Project metrics.json down to the numbers that are actually REPORTED.
 *
 * Prose, notes and timestamps are excluded deliberately: golden-filing the whole
 * document would make the file churn on every wording change, and a golden file
 * that cries wolf gets ignored, which defeats the point.
 *
 * Coverage and nCommitted are pinned alongside every accuracy. Pinning accuracy
 * alone would let the headline silently become a one-compound number while this
 * guard stayed green - which is the exact failure mode the 6.6% coverage finding
 * showed is live.
 */
export function extractGolden(raw: unknown): GoldenNumbers {
  const m = raw as Record<string, any>;
  const acc = m["metric1_conflictSubsetAccuracy"];

  const baselines: Record<string, GoldenPipeline> = {};
  for (const name of Object.keys(acc.baselines ?? {}).sort()) {
    const b = acc.baselines[name];
    baselines[name] = {
      balancedAccuracy: b.balancedAccuracy,
      coverage: b.coverage,
      nCommitted: b.nCommitted,
      balancedAccuracyCi: b.balancedAccuracyCi
        ? { lo: b.balancedAccuracyCi.lo, hi: b.balancedAccuracyCi.hi }
        : null,
      rawAccuracyCi: { lo: b.rawAccuracyCi.lo, hi: b.rawAccuracyCi.hi },
    };
  }

  return {
    rulesetHash: m["provenance"].rulesetHash,
    splitSeed: m["provenance"].splitSeed,
    perturbationSeed: m["provenance"].perturbationSeed,
    nScored: m["sampleSizes"].scored,
    nConflictSubset: m["sampleSizes"].conflictSubset,
    arbiterBalancedAccuracy: acc.arbiter.balancedAccuracy,
    arbiterCoverage: acc.arbiter.coverage,
    arbiterNCommitted: acc.arbiter.nCommitted,
    arbiterBalancedAccuracyCi: acc.arbiter.balancedAccuracyCi
      ? { lo: acc.arbiter.balancedAccuracyCi.lo, hi: acc.arbiter.balancedAccuracyCi.hi }
      : null,
    arbiterRawAccuracyCi: { lo: acc.arbiter.rawAccuracyCi.lo, hi: acc.arbiter.rawAccuracyCi.hi },
    baselines,
    meanHeldFraction: m["metric2b_arbiterRobustness"].meanHeldFraction,
    worstHeldFraction: m["metric2b_arbiterRobustness"].worstHeldFraction,
    strictCoverage: m["metric3_calibration"].strictCoverage,
    meanWidth: m["metric3_calibration"].meanWidth,
    meanWidthOnCorrect: m["metric3_calibration"].meanWidthOnCorrect,
    meanWidthOnIncorrect: m["metric3_calibration"].meanWidthOnIncorrect,
    widthDiscriminates: m["metric3_calibration"].widthDiscriminates,
    declineRate: m["metric4_abstentionQuality"].declineRate,
    balancedAccuracyOnCommitted: m["metric4_abstentionQuality"].balancedAccuracyOnCommitted,
    plannerMeanUnchangedFraction: m["metric5_plannerSensitivity"].meanUnchangedFraction,
  };
}
