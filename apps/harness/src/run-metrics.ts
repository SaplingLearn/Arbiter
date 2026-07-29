import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { MetricsDocumentSchema, type LlmConsistency, type MetricsDocument } from "@arbiter/engine";
import { abstentionQuality, calibration, conflictSubsetAccuracy, plannerSensitivity, robustness } from "./metrics.js";
import { loadInputs } from "./load.js";
import { mean } from "./stats.js";
import type { ResultRow } from "./main.js";

const ROBUSTNESS_SAMPLES = 2000;
const SENSITIVITY_SAMPLES = 2000;
const SEED = 20260726;

function main(): void {
  const results = JSON.parse(readFileSync("results/results.json", "utf8")) as {
    rulesetVersion: string; rulesetHash: string; splitSeed: number; rows: ResultRow[];
  };
  const { claimsByCompound, ruleset, assays } = loadInputs();
  const rows = results.rows;
  const conflictRows = rows.filter((r) => r.conflicting);

  // Metric 2b + 5, per compound on the conflict subset.
  const rob = conflictRows.map((r) =>
    robustness(claimsByCompound.get(r.compoundId) ?? [], ruleset, ROBUSTNESS_SAMPLES, SEED));
  const sens = conflictRows
    .map((r) => plannerSensitivity(claimsByCompound.get(r.compoundId) ?? [], ruleset, assays, SENSITIVITY_SAMPLES, SEED))
    .filter((s) => s.baselineAssay !== null);

  // Metric 2a from the ablation, if it has been run.
  let llm: LlmConsistency = { note: "results/ablation.json not present - run `npm run ablation` (Task 14, needs ANTHROPIC_API_KEY)" };
  if (existsSync("results/ablation.json")) {
    const a = JSON.parse(readFileSync("results/ablation.json", "utf8")) as {
      config: unknown;
      totals: { refusalRate: number; refused: number; requests: number };
      byCompound: Record<string, { agreementRate: number; confidenceStdDev: number; nScored: number }>;
    };
    const scored = Object.values(a.byCompound).filter((s) => s.nScored > 0);
    llm = {
      config: a.config,
      refusals: a.totals,
      meanAgreementRate: mean(scored.map((s) => s.agreementRate)),
      meanConfidenceStdDev: mean(scored.map((s) => s.confidenceStdDev)),
      nCompoundsFullyRefused: Object.values(a.byCompound).filter((s) => s.nScored === 0).length,
    };
  }

  const m1 = conflictSubsetAccuracy(rows);
  // Robustness split by what the compound actually decided. A compound that
  // abstains far from any threshold holds at 1.0 under any perturbation, so a
  // corpus-wide mean is dominated by cases that were never close to deciding.
  const robCommitted = rob.filter((r) => r.baselineVerdict !== "abstain");

  // Annotated, not inferred. This document is the contract apps/web reads, and an
  // anonymous object literal let a field be renamed here while every reader kept
  // compiling. A rename must now fail at the WRITER.
  const metrics: MetricsDocument = {
    provenance: {
      rulesetVersion: results.rulesetVersion,
      rulesetHash: results.rulesetHash,
      splitSeed: results.splitSeed,
      perturbationSeed: SEED,
      scoredSplit: "test",
      note: "The QSAR model was fitted on the train split only; conformal thresholds on calibration. These numbers come from test, which neither touched.",
    },
    sampleSizes: { scored: rows.length, conflictSubset: conflictRows.length },
    metric1_conflictSubsetAccuracy: m1,
    metric2a_llmConsistency: llm,
    metric2b_arbiterRobustness: {
      determinism: 1,
      determinismNote: "Trivially 1 - the engine is a pure function, verified by a 1000-run single-hash test. Reported for completeness; robustness below is the claim that carries weight.",
      meanHeldFraction: mean(rob.map((r) => r.heldFraction)),
      worstHeldFraction: rob.length === 0 ? 1 : Math.min(...rob.map((r) => r.heldFraction)),
      meanHeldFractionOnCommitted: mean(robCommitted.map((r) => r.heldFraction)),
      nCommittedCompounds: robCommitted.length,
      heldFractionCaveat: "A compound that abstains far from any threshold holds at 1.0 under any perturbation. meanHeldFractionOnCommitted is the figure that carries information; the corpus mean is dominated by cases that were never close to deciding.",
      samplesPerCompound: ROBUSTNESS_SAMPLES,
      seed: SEED,
    },
    metric3_calibration: calibration(rows),
    metric4_abstentionQuality: abstentionQuality(rows),
    metric5_plannerSensitivity: {
      nCompoundsWithRecommendation: sens.length,
      meanUnchangedFraction: mean(sens.map((s) => s.unchangedFraction)),
      perturbation: "+/-50% on every expert-elicited priorToxic",
      samplesPerCompound: SENSITIVITY_SAMPLES,
      seed: SEED,
    },
  };

  // The type above cannot see a NaN, an interval whose bounds arrived reversed, or
  // a singleClass flag that disagrees with the confusion counts beside it. Validate
  // before writing, so a document that contradicts itself never reaches the app.
  // The ORIGINAL object is written, not the parse result: a reserialised document
  // would be a second way for bytes to move, and no number may move here.
  MetricsDocumentSchema.parse(metrics);
  writeFileSync("results/metrics.json", JSON.stringify(metrics, null, 2));

  const best = Object.entries(m1.baselines)
    .filter(([, b]) => b.nCommitted > 0)
    .sort((a, b) => b[1].balancedAccuracy - a[1].balancedAccuracy)[0];

  console.log(JSON.stringify({
    conflictSubsetN: metrics.sampleSizes.conflictSubset,
    conflictSubsetPositiveRate: m1.positiveRate,
    arbiter: m1.arbiter,
    bestBaseline: best ? { name: best[0], ...best[1] } : null,
    widthDiscriminates: metrics.metric3_calibration.widthDiscriminates,
    widthDiscriminatesIsMeaningful: metrics.metric3_calibration.widthDiscriminatesIsMeaningful,
    meanRobustnessOnCommitted: metrics.metric2b_arbiterRobustness.meanHeldFractionOnCommitted,
    plannerUnchanged: metrics.metric5_plannerSensitivity.meanUnchangedFraction,
  }, null, 2));

  if (m1.arbiter.coverage < 0.25) {
    console.log(
      `\n*** COVERAGE WARNING: ARBITER commits on ${(m1.arbiter.coverage * 100).toFixed(1)}% of the `
      + `conflict subset (${m1.arbiter.nCommitted}/${m1.n}). A balanced accuracy computed over `
      + `${m1.arbiter.nCommitted} compounds is not a reportable headline. See the Task 13 ledger `
      + `entry: no benchmark compound carries exposure-relevant evidence, so R3 discounts every `
      + `safe claim and the engine can never license "advance". ***`,
    );
  }
  if (m1.arbiter.singleClass) {
    console.log("*** SINGLE-CLASS WARNING: ARBITER committed on only one label, so its balanced "
      + "accuracy is half a substituted 0.5 and must not be quoted as accuracy. ***");
  }
}

main();
