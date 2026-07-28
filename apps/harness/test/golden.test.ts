import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractGolden } from "../src/golden.js";

const GOLDEN = "results/golden/metrics.golden.json";
const CURRENT = "results/metrics.json";

const sample = {
  provenance: { rulesetHash: "abc", splitSeed: 1, perturbationSeed: 2, prose: "ignored" },
  sampleSizes: { scored: 10, conflictSubset: 4 },
  metric1_conflictSubsetAccuracy: {
    arbiter: { balancedAccuracy: 0.75, coverage: 0.5, nCommitted: 2, ci: { lo: 0.1, hi: 0.9 }, singleClass: true },
    baselines: {
      zeta: { balancedAccuracy: 0.4, coverage: 0.2, nCommitted: 1, ci: { lo: 0, hi: 1 } },
      alpha: { balancedAccuracy: 0.6, coverage: 0.3, nCommitted: 2, ci: { lo: 0.2, hi: 0.8 } },
    },
  },
  metric2b_arbiterRobustness: { meanHeldFraction: 1, worstHeldFraction: 1 },
  metric3_calibration: {
    strictCoverage: 0.3, meanWidth: 0.8, meanWidthOnCorrect: 0.2,
    meanWidthOnIncorrect: 0.4, widthDiscriminates: true,
  },
  metric4_abstentionQuality: { declineRate: 0.9, balancedAccuracyOnCommitted: 0.75 },
  metric5_plannerSensitivity: { meanUnchangedFraction: 0.99 },
};

describe("extractGolden", () => {
  it("keeps the reported numbers and drops prose", () => {
    const g = extractGolden(sample);
    expect(g.rulesetHash).toBe("abc");
    expect(g.arbiterCoverage).toBe(0.5);
    expect(g.plannerMeanUnchangedFraction).toBe(0.99);
    expect(JSON.stringify(g)).not.toContain("ignored");
  });

  it("orders baselines so the JSON is byte-stable", () => {
    expect(Object.keys(extractGolden(sample).baselines)).toEqual(["alpha", "zeta"]);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(extractGolden(sample))).toBe(JSON.stringify(extractGolden(sample)));
  });

  it("carries coverage and nCommitted, not accuracy alone", () => {
    // A golden file that pinned accuracy without coverage would let the headline
    // silently become a 1-compound number while the guard stayed green.
    const g = extractGolden(sample);
    expect(g).toHaveProperty("arbiterCoverage");
    expect(g).toHaveProperty("arbiterNCommitted");
    expect(g.baselines["alpha"]).toHaveProperty("coverage");
  });
});

describe("the committed golden numbers", () => {
  it("matches freshly computed metrics", () => {
    expect(existsSync(CURRENT)).toBe(true);
    if (!existsSync(GOLDEN)) return; // first run: nothing to compare against yet
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
    const current = extractGolden(JSON.parse(readFileSync(CURRENT, "utf8")));
    // A failure here means a reported number moved. That is either a bug or a
    // deliberate change - and if deliberate, `npm run golden:update` records it
    // in a commit rather than letting it slip in unnoticed.
    expect(current).toEqual(golden);
  });
});
