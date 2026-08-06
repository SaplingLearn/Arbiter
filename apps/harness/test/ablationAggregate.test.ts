import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MetricsDocumentSchema } from "@arbiter/engine";
import {
  aggregate, agreementRateFloor, distinctVerdicts, expectedModalRate, type AblationRun,
} from "../src/ablation/aggregate.js";

/**
 * 25 runs on one compound: 5 refused, and of the 20 that answered, 16 abstain
 * and 4 do_not_advance.
 *
 * The two denominators differ on purpose - 16/20 = 0.80 against nScored, but
 * 16/25 = 0.64 against requests - so test 1 below can actually fail if the wrong
 * one is used. A fixture with no refusals would pass either implementation.
 */
function fixture(compoundId: string): AblationRun[] {
  const runs: AblationRun[] = [];
  for (let i = 0; i < 16; i++) {
    runs.push({ compoundId, runIndex: i, verdict: "abstain", confidence: 0.5, stopReason: "end_turn" });
  }
  for (let i = 16; i < 20; i++) {
    runs.push({ compoundId, runIndex: i, verdict: "do_not_advance", confidence: 0.9, stopReason: "end_turn" });
  }
  for (let i = 20; i < 25; i++) {
    runs.push({
      compoundId, runIndex: i, verdict: null, confidence: null,
      stopReason: "refusal", refusalCategory: "safety",
    });
  }
  return runs;
}

function allRefused(compoundId: string): AblationRun[] {
  return Array.from({ length: 25 }, (_, i) => ({
    compoundId, runIndex: i, verdict: null, confidence: null,
    stopReason: "refusal", refusalCategory: "safety",
  }));
}

describe("ablation aggregation", () => {
  // Test 1. Fails if agreementRate is computed against `requests` instead of
  // `nScored` - the fixture is built so the two answers differ.
  it("scores the modal verdict against the runs that ANSWERED, not the runs sent", () => {
    const doc = aggregate(fixture("A"), {});
    expect(doc.byCompound["A"]?.agreementRate).toBeCloseTo(0.8, 10);
    expect(doc.byCompound["A"]?.agreementRate).not.toBeCloseTo(0.64, 2);
  });

  // Test 2. Fails if a refusal is dropped entirely, or scored as a verdict.
  it("excludes a refusal from nScored and counts it in refused", () => {
    const doc = aggregate(fixture("A"), {});
    expect(doc.byCompound["A"]?.nScored).toBe(20);
    expect(doc.totals.requests).toBe(25);
    expect(doc.totals.refused).toBe(5);
    expect(doc.totals.refusalRate).toBeCloseTo(5 / 25, 10);
  });

  it("reports the spread of self-reported confidence over the scored runs only", () => {
    // 16 at 0.5 and 4 at 0.9. Population mean 0.58, population sd 0.16.
    const doc = aggregate(fixture("A"), {});
    expect(doc.byCompound["A"]?.confidenceStdDev).toBeCloseTo(0.16, 10);
  });

  // Test 3. Fails if division by zero leaks a NaN into metrics.json, where it
  // would serialise as `null` and be read as a measured zero.
  it("gives a fully-refused compound nScored 0 and no NaN anywhere", () => {
    const doc = aggregate([...fixture("A"), ...allRefused("B")], {});
    expect(doc.byCompound["B"]?.nScored).toBe(0);
    expect(doc.byCompound["B"]?.agreementRate).toBe(0);
    expect(doc.byCompound["B"]?.confidenceStdDev).toBe(0);
    expect(JSON.stringify(doc)).not.toContain("null,");
    expect(Number.isNaN(doc.totals.refusalRate)).toBe(false);
  });

  it("keeps every compound, including the fully-refused one", () => {
    const doc = aggregate([...fixture("A"), ...allRefused("B")], {});
    expect(Object.keys(doc.byCompound).sort()).toEqual(["A", "B"]);
  });

  it("puts no NaN in the totals when handed nothing at all", () => {
    const doc = aggregate([], {});
    expect(doc.totals).toEqual({ refusalRate: 0, refused: 0, requests: 0 });
  });
});

describe("the agreement-rate floor", () => {
  /**
   * The spec quotes 0.433 (three verdicts) and 0.580 (two) from a 200,000-trial
   * simulation. Computed exactly the answers are 0.432833 and 0.580590.
   *
   * The three-verdict figure agrees. The two-verdict one does not quite: 0.580590
   * rounds to 0.581, so the spec's last digit is simulation noise, not the value.
   * Asserted at 4dp against the exact figures rather than loosened to 2dp to
   * accommodate the drift - the whole point of computing it exactly is that
   * there is no longer a sampling error to absorb. Spec section 6 records this.
   */
  it("reproduces the spec's floors, and pins the exact values", () => {
    expect(expectedModalRate(25, 3)).toBeCloseTo(0.4328, 4);
    expect(expectedModalRate(25, 2)).toBeCloseTo(0.5806, 4);
  });

  /** Deterministic: no PRNG, so the same call is the same bytes forever. */
  it("gives the identical answer on every call", () => {
    expect(expectedModalRate(25, 2)).toBe(expectedModalRate(25, 2));
  });

  it("is 1 when there is nothing to disagree about", () => {
    expect(expectedModalRate(25, 1)).toBe(1);
    expect(expectedModalRate(1, 3)).toBeCloseTo(1, 10);
  });

  it("never falls below chance", () => {
    expect(expectedModalRate(25, 3)).toBeGreaterThan(1 / 3);
    expect(expectedModalRate(25, 2)).toBeGreaterThan(1 / 2);
  });

  /**
   * The operative floor follows the verdicts actually observed. ARBITER never
   * returns `advance` on this corpus; if the model does the same, quoting the
   * three-verdict floor would flatter the result by about 0.15.
   */
  it("uses the two-verdict floor when the model never returns the third", () => {
    const runs = fixture("A");
    expect(distinctVerdicts(runs)).toBe(2);
    expect(agreementRateFloor(runs, 25)).toBeCloseTo(0.5806, 4);
  });

  it("uses the three-verdict floor once the third verdict appears", () => {
    const runs = fixture("A");
    runs[0] = { ...(runs[0] as AblationRun), verdict: "advance" };
    expect(distinctVerdicts(runs)).toBe(3);
    expect(agreementRateFloor(runs, 25)).toBeCloseTo(0.4328, 4);
  });

  it("ignores refusals when counting distinct verdicts", () => {
    expect(distinctVerdicts(allRefused("B"))).toBe(0);
  });
});

describe("the emitted document against the metrics contract", () => {
  // Test 7. Fails if the emitted shape drifts from LlmConsistencyMeasured.
  it("is accepted by MetricsDocumentSchema in the measured shape", () => {
    const doc = aggregate([...fixture("A"), ...allRefused("B")], {
      model: "test-model", runsPerCompound: 25, agreementRateFloor: 0.58,
    });

    // Exactly the derivation run-metrics.ts performs over this document.
    const scored = Object.values(doc.byCompound).filter((s) => s.nScored > 0);
    const measured = {
      config: doc.config,
      refusals: doc.totals,
      meanAgreementRate: scored.reduce((a, s) => a + s.agreementRate, 0) / scored.length,
      meanConfidenceStdDev: scored.reduce((a, s) => a + s.confidenceStdDev, 0) / scored.length,
      nCompoundsFullyRefused: Object.values(doc.byCompound).filter((s) => s.nScored === 0).length,
    };
    expect(measured.nCompoundsFullyRefused).toBe(1);

    const real = JSON.parse(readFileSync("results/metrics.json", "utf8")) as Record<string, unknown>;
    const parsed = MetricsDocumentSchema.safeParse({ ...real, metric2a_llmConsistency: measured });
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues, null, 2));
    expect(parsed.success).toBe(true);
  });

  /**
   * The union is genuine, not a bag of optional fields: an agreement rate with
   * no refusal denominator beside it must NOT validate. A consistency figure
   * quoted without its refusal rate is the one reading of this metric that
   * actively misleads.
   */
  it("rejects an agreement rate with no refusal denominator beside it", () => {
    const real = JSON.parse(readFileSync("results/metrics.json", "utf8")) as Record<string, unknown>;
    const halfWritten = { config: {}, meanAgreementRate: 0.8, meanConfidenceStdDev: 0.1, nCompoundsFullyRefused: 0 };
    const parsed = MetricsDocumentSchema.safeParse({ ...real, metric2a_llmConsistency: halfWritten });
    expect(parsed.success).toBe(false);
  });
});
