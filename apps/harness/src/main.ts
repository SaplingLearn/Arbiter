import { mkdirSync, writeFileSync } from "node:fs";
import { detectConflict, reason, type Reasoning } from "@arbiter/engine";
import { ALL_STREAMS, bestSingleSource, majorityVote, weightedAverage, type Prediction } from "./baselines.js";
import { loadInputs } from "./load.js";

export interface ResultRow {
  compoundId: string;
  y: number;
  conflicting: boolean;
  arbiter: Reasoning;
  baselines: Record<string, Prediction>;
}

function main(): void {
  const { claimsByCompound, splits, truth, ruleset, hash, assays } = loadInputs();

  // ONLY the test split is scored. train fitted the QSAR model, calibration set the
  // conformal threshold; scoring either would be leakage.
  const rows: ResultRow[] = [];
  for (const compoundId of splits.test) {
    const claims = claimsByCompound.get(compoundId) ?? [];
    const y = truth.get(compoundId);
    if (y === undefined) continue;

    const baselines: Record<string, Prediction> = {
      majorityVote: majorityVote(claims),
      weightedAverage: weightedAverage(claims),
    };
    for (const s of ALL_STREAMS) baselines[`single:${s}`] = bestSingleSource(claims, s);

    rows.push({
      compoundId,
      y,
      // The PRE-REGISTERED conflict-subset definition (spec section 11): a property
      // of the RAW claims, evaluated before any rule runs, so it cannot move when
      // rule behaviour changes. Deliberately not reason().contested.
      conflicting: detectConflict(claims).conflicting,
      arbiter: reason(claims, ruleset, hash, assays),
      baselines,
    });
  }

  mkdirSync("results", { recursive: true });
  writeFileSync("results/results.json", JSON.stringify({
    rulesetVersion: ruleset.version,
    rulesetHash: hash,
    splitSeed: splits.seed,
    scoredSplit: "test",
    n: rows.length,
    nConflicting: rows.filter((r) => r.conflicting).length,
    rows,
  }, null, 2));

  // A compact cross-check for the web app, which recomputes verdicts in the
  // browser rather than trusting a precomputed file. Bundling all of
  // results.json would add 676KB of almost entirely recomputable data.
  writeFileSync("results/verdict-manifest.json", JSON.stringify({
    rulesetHash: hash,
    rows: rows.map((r) => ({
      compoundId: r.compoundId,
      verdict: r.arbiter.verdict,
      belief: r.arbiter.belief,
    })),
  }, null, 2));

  const conflict = rows.filter((r) => r.conflicting);
  console.log(JSON.stringify({
    scored: rows.length,
    conflictSubset: conflict.length,
    conflictSubsetPositiveRate: conflict.length
      ? Number((conflict.reduce((s, r) => s + r.y, 0) / conflict.length).toFixed(4))
      : null,
    arbiterAbstentions: rows.filter((r) => r.arbiter.verdict === "abstain").length,
    arbiterAbstentionsOnConflictSubset: conflict.filter((r) => r.arbiter.verdict === "abstain").length,
    verdicts: {
      advance: rows.filter((r) => r.arbiter.verdict === "advance").length,
      do_not_advance: rows.filter((r) => r.arbiter.verdict === "do_not_advance").length,
      abstain: rows.filter((r) => r.arbiter.verdict === "abstain").length,
    },
    rulesetHash: hash,
  }, null, 2));
}

main();
