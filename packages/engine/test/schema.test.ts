import { describe, expect, it } from "vitest";
import { EvidenceClaimSchema, MetricsDocumentSchema, RulesetSchema } from "../src/schema.js";
import type { MetricsDocument } from "../src/types.js";

const validClaim = {
  id: "tak994-rat-28d",
  compoundId: "TAK-994",
  stream: "invivo_rodent",
  assertion: "safe",
  strength: 0.8,
  system: "rodent",
  measuresKeyEvent: null,
  exposureRelevant: null,
  inApplicabilityDomain: null,
  klimisch: 1,
  availableFrom: "2021-01-01",
  provenance: { kind: "literature", source: "PMID:example", retrieved: "2026-07-26" },
};

describe("EvidenceClaimSchema", () => {
  it("accepts a well-formed claim", () => {
    expect(EvidenceClaimSchema.parse(validClaim).id).toBe("tak994-rat-28d");
  });

  it("rejects strength outside 0..1", () => {
    expect(() => EvidenceClaimSchema.parse({ ...validClaim, strength: 1.4 })).toThrow();
  });

  it("rejects an unknown stream", () => {
    expect(() => EvidenceClaimSchema.parse({ ...validClaim, stream: "vibes" })).toThrow();
  });

  it("rejects a klimisch score outside 1..4", () => {
    expect(() => EvidenceClaimSchema.parse({ ...validClaim, klimisch: 7 })).toThrow();
  });

  it("rejects an in_silico/qsar claim that asserts it MEASURED a key event", () => {
    // A computational prediction predicts a key event; it does not measure one.
    // Left unchecked, such a claim escapes every discount clause - R2 requires
    // measuresKeyEvent === null - and gets weighted like human clinical evidence.
    const r = EvidenceClaimSchema.safeParse({
      ...validClaim,
      stream: "qsar",
      system: "in_silico",
      measuresKeyEvent: "KE:55",
    });
    expect(r.success).toBe(false);
    if (r.success) throw new Error("expected the schema to reject this claim");
    expect(r.error.issues.some((i) => i.path.join(".") === "measuresKeyEvent")).toBe(true);
    expect(r.error.issues.map((i) => i.message).join(" ")).toMatch(/cannot MEASURE/);
  });

  it("accepts the same in_silico/qsar claim once measuresKeyEvent is null", () => {
    const r = EvidenceClaimSchema.safeParse({
      ...validClaim,
      stream: "qsar",
      system: "in_silico",
      measuresKeyEvent: null,
    });
    expect(r.success).toBe(true);
  });
});

function validRuleset(over: Partial<Record<string, unknown>> = {}) {
  return {
    version: "1.0",
    registeredAt: "2026-07-26",
    abstentionGapThreshold: 0.5,
    dilirankBinarisation: { positive: ["vMost-DILI-Concern"], negative: ["vNo-DILI-Concern"], excluded: ["Ambiguous"] },
    rules: (["R1", "R2", "R3", "R4", "R5", "R6"] as const).map((id) => ({
      id, name: id, statement: "s", framework: { name: "f", date: "standing" }, enabled: true, strength: 0.5,
    })),
    precedenceOrder: ["R3", "R1", "R2", "R5"],
    precedenceRationale: "test fixture",
    ...over,
  };
}

describe("RulesetSchema", () => {
  it("requires all six rules", () => {
    const ruleset = {
      version: "1.0",
      registeredAt: "2026-07-26",
      abstentionGapThreshold: 0.5,
      dilirankBinarisation: { positive: ["vMost-DILI-Concern"], negative: ["vNo-DILI-Concern"], excluded: ["Ambiguous"] },
      rules: [{ id: "R1", name: "Human relevance", statement: "s", framework: { name: "f", date: "2025-04" }, enabled: true, strength: 1 }],
      precedenceOrder: ["R3", "R1", "R2", "R5"],
      precedenceRationale: "test fixture",
    };
    expect(() => RulesetSchema.parse(ruleset)).toThrow(/six/i);
  });

  it("rejects a precedenceOrder with a duplicate rule id", () => {
    const ruleset = validRuleset({ precedenceOrder: ["R1", "R1", "R2", "R5"] });
    expect(() => RulesetSchema.parse(ruleset)).toThrow(/precedenceOrder/i);
  });

  it("rejects a precedenceOrder that omits one of the four defeat rules", () => {
    const ruleset = validRuleset({ precedenceOrder: ["R1", "R2", "R5"] as unknown as string[] });
    expect(() => RulesetSchema.parse(ruleset)).toThrow();
  });

  it("rejects a precedenceOrder that names R4 or R6, which are not defeat rules", () => {
    const ruleset = validRuleset({ precedenceOrder: ["R1", "R2", "R3", "R4"] });
    expect(() => RulesetSchema.parse(ruleset)).toThrow();
  });
});

/**
 * A complete, valid metrics document.
 *
 * Deliberately mirrors the shape of the real `results/metrics.json` - including a
 * pipeline whose `balancedAccuracyCi` is null, which is the case six of the nine
 * reported pipelines are in today, ARBITER's own headline among them.
 */
function validMetrics(): MetricsDocument {
  return {
    provenance: {
      rulesetVersion: "1.0",
      rulesetHash: "ed073a8a",
      splitSeed: 20260726,
      perturbationSeed: 20260726,
      scoredSplit: "test",
      note: "Scored on test, which neither the fit nor the calibration touched.",
    },
    sampleSizes: {
      scored: 10, conflictSubset: 4,
      streamCoverage: { qsar: { claims: 10, compounds: 10 }, transporter: { claims: 2, compounds: 2 } },
    },
    metric1_conflictSubsetAccuracy: {
      n: 4,
      positiveRate: 0.75,
      arbiter: {
        balancedAccuracy: 0.75,
        balancedAccuracyCi: null,
        rawAccuracyCi: { lo: 0.51, hi: 1 },
        coverage: 0.5,
        nCommitted: 2,
        confusion: { tp: 2, fp: 0, tn: 0, fn: 0 },
        singleClass: true,
      },
      baselines: {
        "single:qsar": {
          balancedAccuracy: 0.5,
          balancedAccuracyCi: { lo: 0.46, hi: 0.69 },
          rawAccuracyCi: { lo: 0.79, hi: 0.95 },
          coverage: 1,
          nCommitted: 4,
          confusion: { tp: 3, fp: 1, tn: 0, fn: 0 },
          singleClass: false,
        },
      },
    },
    metric2a_llmConsistency: { note: "results/ablation.json not present" },
    metric2b_arbiterRobustness: {
      determinism: 1,
      determinismNote: "A pure function is a pure function.",
      meanHeldFraction: 1,
      worstHeldFraction: 1,
      meanHeldFractionOnCommitted: 1,
      nCommittedCompounds: 2,
      heldFractionCaveat: "A compound that was never close to deciding holds trivially.",
      samplesPerCompound: 2000,
      seed: 20260726,
    },
    metric3_calibration: {
      strictCoverage: 0.53,
      meanWidth: 0.89,
      meanWidthOnCorrect: 0.09,
      meanWidthOnIncorrect: 0,
      widthDiscriminates: false,
      widthDiscriminatesIsMeaningful: false,
      nCorrect: 2,
      nIncorrect: 0,
    },
    metric4_abstentionQuality: {
      declineRate: 0.8,
      balancedAccuracyOnCommitted: 0.75,
      ciOnCommitted: { lo: 0.64, hi: 1 },
      singleClassOnCommitted: true,
      nDeclined: 8,
      nCommitted: 2,
      nStructurallyForced: 5,
      structurallyForcedNote: "A floor, not a point estimate.",
    },
    metric5_plannerSensitivity: {
      nCompoundsWithRecommendation: 4,
      meanUnchangedFraction: 0.99,
      perturbation: "+/-50% on every expert-elicited priorToxic",
      samplesPerCompound: 2000,
      seed: 20260726,
    },
  };
}

/** Parse a document one mutation away from valid, and return the issue paths and messages. */
function reject(mutate: (m: MetricsDocument) => void): { paths: string[]; message: string } {
  const m = validMetrics();
  mutate(m);
  const r = MetricsDocumentSchema.safeParse(m);
  if (r.success) throw new Error("expected the schema to reject this document");
  return {
    paths: r.error.issues.map((i) => i.path.join(".")),
    message: r.error.issues.map((i) => i.message).join(" "),
  };
}

describe("MetricsDocumentSchema", () => {
  it("accepts the document the harness actually writes", () => {
    // The other direction of every rejection below. Without this, a schema that
    // refused everything would pass the whole suite.
    expect(MetricsDocumentSchema.safeParse(validMetrics()).success).toBe(true);
  });

  it("accepts a null balancedAccuracyCi, which is the common case and not missing data", () => {
    // Null in six of nine pipelines today. A schema that required an interval here
    // would reject every file this project has ever produced.
    const parsed = MetricsDocumentSchema.parse(validMetrics());
    expect(parsed.metric1_conflictSubsetAccuracy.arbiter.balancedAccuracyCi).toBeNull();
  });

  it("accepts a null positiveRate, which is what an empty conflict subset reports", () => {
    const m = validMetrics();
    m.metric1_conflictSubsetAccuracy.positiveRate = null;
    expect(MetricsDocumentSchema.safeParse(m).success).toBe(true);
  });

  it("accepts BOTH shapes of the LLM consistency metric", () => {
    // A genuine union: a note before the ablation has been run, and a set of
    // figures with no note afterwards. Neither shape is a degenerate other.
    const pending = validMetrics();
    expect(MetricsDocumentSchema.safeParse(pending).success).toBe(true);

    const measured = validMetrics();
    measured.metric2a_llmConsistency = {
      config: { model: "some-model", n: 5 },
      refusals: { refusalRate: 0.2, refused: 2, requests: 10 },
      meanAgreementRate: 0.8,
      meanConfidenceStdDev: 0.1,
      nCompoundsFullyRefused: 1,
    };
    const r = MetricsDocumentSchema.safeParse(measured);
    expect(r.success).toBe(true);
    if (!r.success) throw new Error("expected the measured ablation shape to validate");
    expect("note" in r.data.metric2a_llmConsistency).toBe(false);
  });

  it("rejects a half-written LLM ablation, which would report agreement with no denominator", () => {
    const { paths } = reject((m) => {
      // An agreement rate with the refusal counts missing. Quoting consistency
      // without the refusal rate beside it is the one misleading reading here.
      (m as unknown as Record<string, unknown>)["metric2a_llmConsistency"] = { meanAgreementRate: 0.8 };
    });
    expect(paths).toContain("metric2a_llmConsistency");
  });

  it("keys baselines by name, including names containing a colon", () => {
    const parsed = MetricsDocumentSchema.parse(validMetrics());
    expect(Object.keys(parsed.metric1_conflictSubsetAccuracy.baselines)).toContain("single:qsar");
  });

  it("names the offending field when a metric is renamed away", () => {
    // The live footgun this schema exists to close: read through a cast, a renamed
    // field is `undefined` and typecheck stays green all the way to the tab.
    const { paths } = reject((m) => {
      const p = m.metric5_plannerSensitivity as unknown as Record<string, unknown>;
      p["meanUnchangedFrac"] = p["meanUnchangedFraction"];
      delete p["meanUnchangedFraction"];
    });
    expect(paths).toContain("metric5_plannerSensitivity.meanUnchangedFraction");
  });

  it("names the offending field when a count arrives as a string", () => {
    const { paths, message } = reject((m) => {
      (m.sampleSizes as unknown as Record<string, unknown>)["scored"] = "ten";
    });
    expect(paths).toContain("sampleSizes.scored");
    expect(message).toMatch(/expected number/i);
  });

  it("rejects an interval whose bounds are the wrong way round", () => {
    const { paths, message } = reject((m) => {
      m.metric4_abstentionQuality.ciOnCommitted = { lo: 1, hi: 0.64 };
    });
    expect(paths).toContain("metric4_abstentionQuality.ciOnCommitted.hi");
    expect(message).toMatch(/lo <= hi/);
  });

  it("rejects a confidence interval attached to a single-class balanced accuracy", () => {
    // The §3.5 defect in schema form: half of that figure is a substituted 0.5,
    // and a substitution carries no sampling uncertainty, so no interval exists.
    const { paths, message } = reject((m) => {
      m.metric1_conflictSubsetAccuracy.arbiter.balancedAccuracyCi = { lo: 0.51, hi: 1 };
    });
    expect(paths).toContain("metric1_conflictSubsetAccuracy.arbiter.balancedAccuracyCi");
    expect(message).toMatch(/substituted 0\.5 is not an estimate/);
  });

  it("rejects a missing interval where both classes are present", () => {
    // The other direction of the same invariant. A schema that only checked one
    // way would let a real interval be dropped silently.
    const { paths } = reject((m) => {
      m.metric1_conflictSubsetAccuracy.baselines["single:qsar"]!.balancedAccuracyCi = null;
    });
    expect(paths).toContain("metric1_conflictSubsetAccuracy.baselines.single:qsar.balancedAccuracyCi");
  });

  it("rejects confusion counts that do not sum to nCommitted", () => {
    const { paths } = reject((m) => {
      m.metric1_conflictSubsetAccuracy.arbiter.confusion.tp = 3;
    });
    expect(paths).toContain("metric1_conflictSubsetAccuracy.arbiter.confusion");
  });

  it("rejects a singleClass flag that contradicts the confusion counts", () => {
    const { paths, message } = reject((m) => {
      m.metric1_conflictSubsetAccuracy.baselines["single:qsar"]!.singleClass = true;
    });
    expect(paths).toContain("metric1_conflictSubsetAccuracy.baselines.single:qsar.singleClass");
    expect(message).toMatch(/one class is absent/);
  });

  it("rejects a headline computed over a different subset than sampleSizes reports", () => {
    const { paths } = reject((m) => {
      m.metric1_conflictSubsetAccuracy.n = 3;
    });
    expect(paths).toContain("sampleSizes.conflictSubset");
  });

  it("rejects a decline count that does not account for every scored compound", () => {
    const { paths } = reject((m) => {
      m.metric4_abstentionQuality.nDeclined = 7;
    });
    expect(paths).toContain("metric4_abstentionQuality.nDeclined");
  });

  it("rejects a determinism figure other than 1", () => {
    // Not a metric moving: a pure function that stopped being deterministic is a
    // much larger problem, and it should not be reportable as a number.
    const { paths } = reject((m) => {
      (m.metric2b_arbiterRobustness as unknown as Record<string, unknown>)["determinism"] = 0.97;
    });
    expect(paths).toContain("metric2b_arbiterRobustness.determinism");
  });
});
