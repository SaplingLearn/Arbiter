import { describe, expect, it } from "vitest";
import type { EvidenceClaim } from "@arbiter/engine";
import { loadData } from "../src/data/load.js";
import { CYCLOSPORINE } from "../src/data/heroCases.js";
import { assessReachability, reachabilitySentence } from "../src/intake/advisor.js";
import { findBenchmarkCollisions, validateIntake } from "../src/intake/validate.js";

const data = loadData();

/** A schema-valid claim; each test overrides only the field under examination. */
function claim(over: Partial<EvidenceClaim> = {}): EvidenceClaim {
  return {
    id: "user-1",
    compoundId: "ACME-001",
    stream: "cytotox",
    assertion: "toxic",
    strength: 0.7,
    system: "human",
    measuresKeyEvent: "mitochondrial dysfunction",
    exposureRelevant: true,
    inApplicabilityDomain: null,
    klimisch: 2,
    availableFrom: "2026-01",
    provenance: { kind: "literature", source: "internal study 4471", retrieved: "2026-08-06" },
    ...over,
  } as EvidenceClaim;
}

describe("intake validation", () => {
  it("accepts a well-formed claim", () => {
    const r = validateIntake([claim()], { cmax: 1.2, basis: "clinical", citation: "IB §4.2" });
    expect(r.errors).toEqual([]);
    expect(r.claims).toHaveLength(1);
  });

  // Test 2. The highest-consequence extraction error, already unrepresentable.
  it("rejects a qsar claim that claims to have MEASURED a key event", () => {
    const r = validateIntake([claim({ stream: "qsar", system: "in_silico" })], null);
    expect(r.claims).toHaveLength(0);
    expect(r.errors[0]).toContain("measuresKeyEvent");
  });

  it("accepts the same qsar claim once it stops claiming a measured mechanism", () => {
    const r = validateIntake([claim({ stream: "qsar", system: "in_silico", measuresKeyEvent: null })], null);
    expect(r.errors).toEqual([]);
  });

  // Test 3.
  it("rejects exposureRelevant on a SAFE finding with no cited Cmax", () => {
    const r = validateIntake([claim({ assertion: "safe" })], null);
    expect(r.claims).toHaveLength(0);
    expect(r.errors[0]).toContain("cited clinical Cmax");
  });

  it("accepts the same safe claim once a Cmax is cited", () => {
    const r = validateIntake([claim({ assertion: "safe" })], { cmax: 1.2, basis: "clinical", citation: "IB §4.2" });
    expect(r.errors).toEqual([]);
  });

  /**
   * The asymmetry IS R3: a positive finding at clinically relevant exposure
   * defeats a negative one whose margin is unstated, so a toxic finding needs no
   * margin to be defensible. Gating both directions would misstate the rule.
   */
  it("does NOT gate a toxic finding, because R3 is asymmetric", () => {
    const r = validateIntake([claim({ assertion: "toxic" })], null);
    expect(r.errors).toEqual([]);
  });

  it("reports the offending claim by position and id", () => {
    const r = validateIntake([claim(), claim({ id: "user-2", assertion: "safe" })], null);
    expect(r.claims).toHaveLength(1);
    expect(r.errors[0]).toContain("claim 2 (user-2)");
  });

  it("rejects a strength outside 0..1", () => {
    expect(validateIntake([claim({ strength: 1.4 })], null).errors[0]).toContain("strength");
  });
});

describe("the benchmark separation guard", () => {
  // Test 4.
  it("finds a custom id that collides with the benchmark", () => {
    expect(findBenchmarkCollisions(["ACME-001", "ASPIRIN"], ["ASPIRIN", "IBUPROFEN"])).toEqual(["ASPIRIN"]);
  });

  it("passes when the custom compound is genuinely new", () => {
    expect(findBenchmarkCollisions(["ACME-001"], ["ASPIRIN"])).toEqual([]);
  });

  /** Membership, not a prefix match - the harness had exactly that bug once. */
  it("does not match on a shared prefix", () => {
    expect(findBenchmarkCollisions(["ACME-001-B"], ["ACME-001"])).toEqual([]);
  });

  it("holds against the real benchmark ids", () => {
    const benchmark = [...data.claimsByCompound.keys()];
    expect(benchmark.length).toBeGreaterThan(0);
    expect(findBenchmarkCollisions(["ACME-001"], benchmark)).toEqual([]);
  });
});

describe("the pre-flight advisor", () => {
  // Test 5. Fails if the ceiling is computed against stated rather than full
  // confidence - at stated strengths almost everything looks unreachable, so the
  // test would pass for the wrong reason and the advisor would be useless.
  it("reports unreachable for a lone discounted in-silico claim", () => {
    const claims = [claim({ stream: "qsar", system: "in_silico", measuresKeyEvent: null, exposureRelevant: null })];
    const r = assessReachability(claims, data.ruleset);
    expect(r.reachable).toBe(false);
    expect(r.ceiling).toBeLessThan(r.bar);
    expect(r.verdict).toBe("abstain");
  });

  it("names the properties that are missing, not just the arithmetic", () => {
    const claims = [claim({ stream: "qsar", system: "in_silico", measuresKeyEvent: null, exposureRelevant: null })];
    const r = assessReachability(claims, data.ruleset);
    expect(r.missing.join(" ")).toContain("human system");
    expect(r.missing.join(" ")).toContain("key event");
    expect(r.missing.join(" ")).toContain("Cmax");
  });

  // Test 6. Fails if the advisor always says unreachable and is therefore useless.
  it("reports reachable for evidence that actually commits", () => {
    const claims = data.claimsByCompound.get(CYCLOSPORINE) ?? [];
    expect(claims.length).toBeGreaterThan(0);
    const r = assessReachability(claims, data.ruleset);
    expect(r.verdict).toBe("do_not_advance");
    expect(r.reachable).toBe(true);
    expect(r.missing).toEqual([]);
  });

  /**
   * The distinction the advisor exists to draw, and the one the corpus sweep
   * below does NOT catch.
   *
   * This claim carries no discount, so at full confidence its ceiling is 1.0 and
   * clears the bar - but its STATED strength is 0.4, so it does not commit. The
   * honest advice is therefore "reachable, but this evidence is not strong
   * enough", never "give up".
   *
   * Written after watching the weaker corpus test pass against a ceiling scaled
   * by `strength`: every compound that commits does so at a strength high enough
   * to clear the bar anyway, so scaling changed no answer there. Here it flips
   * `reachable` to false and the advisor starts telling users to abandon
   * evidence that would decide if they ran a better study.
   */
  it("separates 'could never commit' from 'has not committed yet'", () => {
    const strong = claim({ klimisch: 1, strength: 0.4 });
    const r = assessReachability([strong], data.ruleset);
    expect(r.verdict).toBe("abstain");
    expect(r.ceiling).toBeGreaterThan(r.bar);
    expect(r.reachable).toBe(true);
    expect(r.missing).toEqual([]);
  });

  /** The bound must be an OVER-estimate: anything that commits must also be
   *  judged reachable, or the advisor would tell a user to give up on evidence
   *  that in fact decides. */
  it("never calls a committing compound unreachable, across the whole corpus", () => {
    let checked = 0;
    for (const [id, claims] of data.claimsByCompound) {
      const r = assessReachability(claims, data.ruleset);
      if (r.verdict === "abstain") continue;
      checked++;
      expect(r.reachable, `${id} committed but was judged unreachable`).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("says so in a sentence a non-specialist can read", () => {
    const claims = [claim({ stream: "qsar", system: "in_silico", measuresKeyEvent: null, exposureRelevant: null })];
    const sentence = reachabilitySentence(assessReachability(claims, data.ruleset));
    expect(sentence).toContain("no verdict is reachable at any confidence values");
    expect(sentence).toContain("Cmax");
  });
});
