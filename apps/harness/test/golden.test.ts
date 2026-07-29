import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MetricsDocument } from "@arbiter/engine";
import { extractGolden } from "../src/golden.js";

const GOLDEN = "results/golden/metrics.golden.json";
const CURRENT = "results/metrics.json";

/**
 * A COMPLETE metrics document, not a mini-fixture of the fields this projection
 * happens to read.
 *
 * It used to be the latter, and that was the wrong shape for the test to have:
 * it omitted `singleClass` on its baselines and carried a `prose` key on
 * `provenance` that no writer has ever emitted. A fixture that cannot occur is a
 * fixture that stops representing the thing under test - and the reason
 * `extractGolden` needed fixing in the first place is that it read the real
 * document through a cast that would have accepted this one too.
 *
 * It is now completed rather than deleted, and typed, so the compiler holds it to
 * the same contract the harness writes and the app reads. The schema was NOT
 * loosened to keep it passing; every assertion below is the original one.
 *
 * The sentinel string "ignored" sits in the document's genuine prose fields
 * (`provenance.note`, `determinismNote`, `heldFractionCaveat`, `perturbation`)
 * rather than in an invented key, which makes the "drops prose" assertion a claim
 * about the real fields the golden file must not churn on.
 */
const sample: MetricsDocument = {
  provenance: {
    rulesetVersion: "1.0",
    rulesetHash: "abc",
    splitSeed: 1,
    perturbationSeed: 2,
    scoredSplit: "test",
    note: "ignored prose about how the split was fitted",
  },
  sampleSizes: { scored: 10, conflictSubset: 4 },
  metric1_conflictSubsetAccuracy: {
    n: 4,
    positiveRate: 0.75,
    arbiter: {
      balancedAccuracy: 0.75,
      balancedAccuracyCi: null,
      rawAccuracyCi: { lo: 0.1, hi: 0.9 },
      coverage: 0.5,
      nCommitted: 2,
      confusion: { tp: 2, fp: 0, tn: 0, fn: 0 },
      singleClass: true,
    },
    baselines: {
      zeta: {
        balancedAccuracy: 0.4,
        balancedAccuracyCi: null,
        rawAccuracyCi: { lo: 0, hi: 1 },
        coverage: 0.2,
        nCommitted: 1,
        confusion: { tp: 1, fp: 0, tn: 0, fn: 0 },
        singleClass: true,
      },
      alpha: {
        balancedAccuracy: 0.6,
        balancedAccuracyCi: { lo: 0.2, hi: 0.8 },
        rawAccuracyCi: { lo: 0.2, hi: 0.8 },
        coverage: 0.3,
        nCommitted: 2,
        confusion: { tp: 1, fp: 0, tn: 1, fn: 0 },
        singleClass: false,
      },
    },
  },
  metric2a_llmConsistency: { note: "ignored - the ablation has not been run" },
  metric2b_arbiterRobustness: {
    determinism: 1,
    determinismNote: "ignored prose about determinism",
    meanHeldFraction: 1,
    worstHeldFraction: 1,
    meanHeldFractionOnCommitted: 1,
    nCommittedCompounds: 2,
    heldFractionCaveat: "ignored prose about what a held fraction does not prove",
    samplesPerCompound: 2000,
    seed: 2,
  },
  metric3_calibration: {
    strictCoverage: 0.3,
    meanWidth: 0.8,
    meanWidthOnCorrect: 0.2,
    meanWidthOnIncorrect: 0.4,
    widthDiscriminates: true,
    widthDiscriminatesIsMeaningful: false,
    nCorrect: 3,
    nIncorrect: 2,
  },
  metric4_abstentionQuality: {
    declineRate: 0.9,
    balancedAccuracyOnCommitted: 0.75,
    ciOnCommitted: { lo: 0.3, hi: 1 },
    singleClassOnCommitted: true,
    nDeclined: 9,
    nCommitted: 1,
  },
  metric5_plannerSensitivity: {
    nCompoundsWithRecommendation: 4,
    meanUnchangedFraction: 0.99,
    perturbation: "ignored prose describing the perturbation",
    samplesPerCompound: 2000,
    seed: 2,
  },
};

/** A deep copy the corruption tests can mutate without leaking into their neighbours. */
const corrupt = (mutate: (m: MetricsDocument) => void): unknown => {
  const copy = JSON.parse(JSON.stringify(sample)) as MetricsDocument;
  mutate(copy);
  return copy;
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

describe("extractGolden rejects a document that has drifted", () => {
  it("names a RENAMED metric instead of golden-filing undefined", () => {
    // The failure this whole change exists to stop. Read through a cast, a renamed
    // field arrives as `undefined`, is written into the golden file, and compares
    // equal to itself forever after - so the guard against a moved number goes
    // quiet at the moment it is needed.
    const drifted = corrupt((m) => {
      const p = m.metric5_plannerSensitivity as unknown as Record<string, unknown>;
      p["meanUnchangedFrac"] = p["meanUnchangedFraction"];
      delete p["meanUnchangedFraction"];
    });
    expect(() => extractGolden(drifted)).toThrow(/meanUnchangedFraction/);
  });

  it("names the field when a number arrives as a string", () => {
    const drifted = corrupt((m) => {
      (m.sampleSizes as unknown as Record<string, unknown>)["scored"] = "ten";
    });
    expect(() => extractGolden(drifted)).toThrow(/scored/);
  });

  it("rejects an interval whose bounds arrived reversed", () => {
    const drifted = corrupt((m) => {
      m.metric1_conflictSubsetAccuracy.arbiter.rawAccuracyCi = { lo: 0.9, hi: 0.1 };
    });
    expect(() => extractGolden(drifted)).toThrow(/lo <= hi/);
  });

  it("rejects a confidence interval attached to a single-class balanced accuracy", () => {
    // Half of that figure is a substituted 0.5, which has no sampling uncertainty.
    // This is the invariant behind the null in six of the nine reported pipelines.
    const drifted = corrupt((m) => {
      m.metric1_conflictSubsetAccuracy.arbiter.balancedAccuracyCi = { lo: 0.51, hi: 1 };
    });
    expect(() => extractGolden(drifted)).toThrow(/balancedAccuracyCi/);
  });

  it("rejects a singleClass flag that contradicts the counts beside it", () => {
    const drifted = corrupt((m) => {
      m.metric1_conflictSubsetAccuracy.baselines["alpha"]!.singleClass = true;
    });
    expect(() => extractGolden(drifted)).toThrow(/singleClass/);
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
