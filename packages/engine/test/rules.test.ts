import { describe, expect, it } from "vitest";
import { reason } from "../src/index.js";
import { concordanceBoost, conflictsWith, defeats, downweightFactor, relevanceDiscount } from "../src/rules.js";
import { RulesetSchema } from "../src/schema.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;

function claim(over: Partial<EvidenceClaim>): EvidenceClaim {
  return {
    id: "c", compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: true,
    inApplicabilityDomain: true, klimisch: 1, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "test", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("conflictsWith", () => {
  it("is true only for opposed committed assertions", () => {
    expect(conflictsWith(claim({ assertion: "toxic" }), claim({ assertion: "safe" }))).toBe(true);
    expect(conflictsWith(claim({ assertion: "toxic" }), claim({ assertion: "toxic" }))).toBe(false);
    expect(conflictsWith(claim({ assertion: "toxic" }), claim({ assertion: "ambiguous" }))).toBe(false);
  });

  it("never lets claims about DIFFERENT compounds conflict, or defeat each other", () => {
    // Every caller groups by compound before reasoning, so this cannot happen
    // today - but the failure it prevents is silent: a toxic finding on compound A
    // deleting a safe finding on compound B produces a confident verdict whose
    // trace reads perfectly plausible.
    const a = claim({ id: "a", compoundId: "DRUG-1", assertion: "toxic", system: "human" });
    const b = claim({ id: "b", compoundId: "DRUG-2", assertion: "safe", system: "rodent", stream: "invivo_rodent" });
    expect(conflictsWith(a, b)).toBe(false);
    // Same pair WOULD be an R1 defeat if they were about one compound, which is
    // what makes this a real guard rather than a vacuous assertion.
    expect(defeats(a, b, RS)).toBeNull();
    expect(defeats(a, { ...b, compoundId: "DRUG-1" }, RS)?.byRule).toBe("R1");
  });
});

describe("R1 human relevance", () => {
  it("human-cell evidence defeats rodent in vivo", () => {
    const human = claim({ id: "h", assertion: "toxic", system: "human" });
    const rat = claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent" });
    expect(defeats(human, rat, RS)?.byRule).toBe("R1");
    expect(defeats(rat, human, RS)).toBeNull();
  });

  it("does not fire between two human claims", () => {
    const a = claim({ id: "a", assertion: "toxic", system: "human" });
    const b = claim({ id: "b", assertion: "safe", system: "human" });
    expect(defeats(a, b, RS)?.byRule).not.toBe("R1");
  });
});

describe("R2 mechanistic proximity", () => {
  it("a measured key event defeats structural correlation only", () => {
    const mech = claim({ id: "m", assertion: "toxic", measuresKeyEvent: "KE:55", stream: "transporter" });
    const struct = claim({ id: "s", assertion: "safe", measuresKeyEvent: null, stream: "qsar", system: "human" });
    expect(defeats(mech, struct, RS)?.byRule).toBe("R2");
  });

  it("does not fire in reverse - structural correlation cannot outrank a measured key event", () => {
    // R2 was the only defeat rule with no reverse-direction test; R1, R3 and R5 all
    // had one. Same system on both sides so R1 cannot supply the asymmetry, equal
    // exposure and Klimisch so R3 and R5 cannot either.
    const mech = claim({ id: "m", assertion: "toxic", measuresKeyEvent: "KE:55", stream: "transporter", system: "human" });
    const struct = claim({ id: "s", assertion: "safe", measuresKeyEvent: null, stream: "qsar", system: "human" });
    expect(defeats(mech, struct, RS)?.byRule).toBe("R2");
    expect(defeats(struct, mech, RS)).toBeNull();
  });

  it("does not fire against apical in-vivo evidence merely because no key event is annotated", () => {
    // A 28-day repeat-dose study with no key event annotated is apical outcome
    // evidence, not a structural correlation. Same species on both sides so R1
    // cannot confound the result; equal exposure/klimisch so R3/R5 cannot either.
    const mech = claim({ id: "m", assertion: "toxic", measuresKeyEvent: "KE:12", stream: "transporter", system: "rodent" });
    const invivo = claim({ id: "iv", assertion: "safe", measuresKeyEvent: null, stream: "invivo_rodent", system: "rodent" });
    expect(defeats(mech, invivo, RS)).toBeNull();
  });
});

describe("R3 exposure relevance", () => {
  it("a positive at clinical exposure defeats a negative with untested margin", () => {
    const pos = claim({ id: "p", assertion: "toxic", exposureRelevant: true });
    const neg = claim({ id: "n", assertion: "safe", exposureRelevant: null });
    expect(defeats(pos, neg, RS)?.byRule).toBe("R3");
    expect(defeats(neg, pos, RS)).toBeNull();
  });
});

describe("R4 applicability domain", () => {
  it("downweights an out-of-domain claim without defeating it", () => {
    const out = claim({ inApplicabilityDomain: false });
    const r = downweightFactor(out, RS);
    expect(r?.byRule).toBe("R4");
    expect(r!.factor).toBeGreaterThan(0);
    expect(r!.factor).toBeLessThan(1);
  });

  it("leaves an in-domain claim alone", () => {
    expect(downweightFactor(claim({ inApplicabilityDomain: true }), RS)).toBeNull();
  });

  it("returns exactly 1 - strength, measured at a strength where that differs from strength itself", () => {
    // R4's registered strength is 0.5, and 1 - 0.5 === 0.5, so EVERY test using the
    // real ruleset passes whether the code computes `1 - strength` or `strength`.
    // Re-measure at 0.8, where the two answers are 0.2 and 0.8.
    const eighty: Ruleset = { ...RS, rules: RS.rules.map((r) => (r.id === "R4" ? { ...r, strength: 0.8 } : r)) };
    expect(downweightFactor(claim({ inApplicabilityDomain: false }), eighty)!.factor).toBeCloseTo(0.2, 12);
    // And confirm the real ruleset is the ambiguous case, so this test is not
    // duplicating one that already discriminates.
    expect(RS.rules.find((r) => r.id === "R4")!.strength).toBe(0.5);
  });

  it("treats a null applicability domain as benign, unlike R3's null exposure", () => {
    // The two rules read `null` in opposite directions and that asymmetry is
    // deliberate: an unassessed domain is not evidence of being outside it, while an
    // unestablished exposure margin IS the reason a negative licenses nothing.
    expect(downweightFactor(claim({ inApplicabilityDomain: null }), RS)).toBeNull();
    const nullExposureNegative = relevanceDiscount(claim({ assertion: "safe", exposureRelevant: null }), RS);
    expect(nullExposureNegative.reasons.map((r) => r.byRule)).toContain("R3");
  });
});

describe("R5 study reliability", () => {
  it("a more reliable study defeats a less reliable one at equal relevance (both key-event-null)", () => {
    const good = claim({ id: "g", assertion: "toxic", klimisch: 1 });
    const poor = claim({ id: "p", assertion: "safe", klimisch: 4 });
    expect(defeats(good, poor, RS)?.byRule).toBe("R5");
    expect(defeats(poor, good, RS)).toBeNull();
  });

  it("fires when key events match only after normalizing case and whitespace", () => {
    const good = claim({ id: "g", assertion: "toxic", klimisch: 1, measuresKeyEvent: "KE:55" });
    const poor = claim({ id: "p", assertion: "safe", klimisch: 4, measuresKeyEvent: " ke:55 " });
    expect(defeats(good, poor, RS)?.byRule).toBe("R5");
  });

  it("declines when the two claims measure genuinely different key events", () => {
    const good = claim({ id: "g", assertion: "toxic", klimisch: 1, measuresKeyEvent: "KE:55" });
    const poor = claim({ id: "p", assertion: "safe", klimisch: 4, measuresKeyEvent: "KE:99" });
    expect(defeats(good, poor, RS)).toBeNull();
  });
});

describe("R6 concordance", () => {
  it("rewards agreement across distinct streams, not within one", () => {
    const twoStreams = [claim({ id: "a", stream: "cytotox" }), claim({ id: "b", stream: "transporter" })];
    const oneStream = [claim({ id: "a", stream: "cytotox" }), claim({ id: "b", stream: "cytotox" })];
    expect(concordanceBoost(twoStreams, RS).boost).toBeGreaterThan(concordanceBoost(oneStream, RS).boost);
  });

  it("is independent of claim order", () => {
    const claims = [
      claim({ id: "a", stream: "cytotox", assertion: "toxic" }),
      claim({ id: "b", stream: "transporter", assertion: "toxic" }),
      claim({ id: "c", stream: "qsar", assertion: "safe" }),
    ];
    const shuffled = [claims[2]!, claims[0]!, claims[1]!];
    expect(concordanceBoost(shuffled, RS)).toEqual(concordanceBoost(claims, RS));
  });

  it("scores an exact 2-2 stream split as no boost, with no side supported, strictly below unanimity", () => {
    const split = [
      claim({ id: "a", stream: "cytotox", assertion: "toxic" }),
      claim({ id: "b", stream: "transporter", assertion: "toxic" }),
      claim({ id: "c", stream: "qsar", assertion: "safe" }),
      claim({ id: "d", stream: "toxicogenomics", assertion: "safe" }),
    ];
    const unanimous = [
      claim({ id: "a", stream: "cytotox", assertion: "toxic" }),
      claim({ id: "b", stream: "transporter", assertion: "toxic" }),
      claim({ id: "c", stream: "qsar", assertion: "toxic" }),
      claim({ id: "d", stream: "toxicogenomics", assertion: "toxic" }),
    ];
    const splitResult = concordanceBoost(split, RS);
    expect(splitResult.supports).toBeNull();
    expect(splitResult.boost).toBe(1);
    expect(splitResult.boost).toBeLessThan(concordanceBoost(unanimous, RS).boost);
  });

  it("still scores a single chatty stream at 1.0", () => {
    const oneStream = [claim({ id: "a", stream: "cytotox" }), claim({ id: "b", stream: "cytotox" })];
    expect(concordanceBoost(oneStream, RS).boost).toBe(1);
  });

  it("attenuates a near-even split without flattening it all the way to no boost", () => {
    const nearEven = [
      claim({ id: "a", stream: "cytotox", assertion: "toxic" }),
      claim({ id: "b", stream: "transporter", assertion: "toxic" }),
      claim({ id: "c", stream: "toxicogenomics", assertion: "toxic" }),
      claim({ id: "d", stream: "qsar", assertion: "safe" }),
      claim({ id: "e", stream: "invivo_rodent", assertion: "safe" }),
    ];
    const unanimous = [
      claim({ id: "a", stream: "cytotox", assertion: "toxic" }),
      claim({ id: "b", stream: "transporter", assertion: "toxic" }),
      claim({ id: "c", stream: "toxicogenomics", assertion: "toxic" }),
    ];
    const r = concordanceBoost(nearEven, RS);
    expect(r.supports).toBe("toxic");
    expect(r.boost).toBeGreaterThan(1);
    expect(r.boost).toBeLessThan(concordanceBoost(unanimous, RS).boost);
  });
});

describe("disabled rules", () => {
  /** The ruleset with exactly one rule turned off. */
  const without = (id: string): Ruleset =>
    ({ ...RS, rules: RS.rules.map((r) => (r.id === id ? { ...r, enabled: false } : r)) });

  it("a disabled rule never fires", () => {
    const human = claim({ id: "h", assertion: "toxic", system: "human", exposureRelevant: null, klimisch: 2 });
    const rat = claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", exposureRelevant: null, klimisch: 2 });
    expect(defeats(human, rat, without("R1"))?.byRule).not.toBe("R1");
  });

  // Coverage was uneven: only R1 had a disabled-path test, so five of the six
  // rules could have ignored `enabled` entirely. Each case below is built so the
  // named rule is the ONLY one that fires, then asserted to fall silent - which
  // also proves each pairing was reaching that rule in the first place.

  it("R2 disabled: a measured key event stops outranking structural correlation", () => {
    const mech = claim({ id: "m", assertion: "toxic", measuresKeyEvent: "KE:55", stream: "transporter", system: "human" });
    const struct = claim({ id: "s", assertion: "safe", measuresKeyEvent: null, stream: "qsar", system: "human" });
    expect(defeats(mech, struct, RS)?.byRule).toBe("R2");
    expect(defeats(mech, struct, without("R2"))).toBeNull();
  });

  it("R3 disabled: a positive at clinical exposure stops outranking an untested margin", () => {
    const pos = claim({ id: "p", assertion: "toxic", exposureRelevant: true });
    const neg = claim({ id: "n", assertion: "safe", exposureRelevant: null });
    expect(defeats(pos, neg, RS)?.byRule).toBe("R3");
    expect(defeats(pos, neg, without("R3"))).toBeNull();
  });

  it("R4 disabled: an out-of-domain claim is no longer downweighted or discounted", () => {
    const out = claim({ inApplicabilityDomain: false });
    expect(downweightFactor(out, RS)?.byRule).toBe("R4");
    expect(downweightFactor(out, without("R4"))).toBeNull();
    // R4 also reaches mass through relevanceDiscount, which is a separate call
    // site and therefore a separate chance to ignore `enabled`.
    expect(relevanceDiscount(out, RS).reasons.map((r) => r.byRule)).toContain("R4");
    expect(relevanceDiscount(out, without("R4")).reasons.map((r) => r.byRule)).not.toContain("R4");
  });

  it("R5 disabled: a more reliable study stops outranking a less reliable one", () => {
    const good = claim({ id: "g", assertion: "toxic", klimisch: 1 });
    const poor = claim({ id: "p", assertion: "safe", klimisch: 4 });
    expect(defeats(good, poor, RS)?.byRule).toBe("R5");
    expect(defeats(good, poor, without("R5"))).toBeNull();
  });

  it("R6 disabled: concordance reports no boost and supports no side", () => {
    const twoStreams = [
      claim({ id: "a", stream: "cytotox", assertion: "toxic" }),
      claim({ id: "b", stream: "transporter", assertion: "toxic" }),
    ];
    expect(concordanceBoost(twoStreams, RS).boost).toBeGreaterThan(1);
    expect(concordanceBoost(twoStreams, without("R6"))).toEqual({ supports: null, boost: 1 });
  });

  it("disabling a rule leaves a GAP a lower-precedence rule can fill, rather than reordering", () => {
    // R1 outranks R5 in the pre-registered order. With R1 off, the same pair must
    // still be decided - by R5 - rather than silently surviving. This is the
    // behaviour the docstring promises and nothing asserted it.
    const human = claim({ id: "h", assertion: "toxic", system: "human", klimisch: 1 });
    const rat = claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 4 });
    expect(defeats(human, rat, RS)?.byRule).toBe("R1");
    expect(defeats(human, rat, without("R1"))?.byRule).toBe("R5");
  });
});

describe("antisymmetry", () => {
  // Cross-product over every field a defeat rule reads. For every pair drawn
  // from it, at most one direction may be licensed as a defeat - never both.
  // This is the test class a "pick one rule per test" test file structurally
  // cannot express, and it is what caught the R1/R3 2-cycle.
  function* variants(): Generator<Pick<EvidenceClaim, "system" | "measuresKeyEvent" | "exposureRelevant" | "klimisch" | "stream">> {
    const systems: EvidenceClaim["system"][] = ["human", "rodent", "nonrodent", "in_silico"];
    const keyEvents: (string | null)[] = [null, "KE:1"];
    const exposures: (boolean | null)[] = [true, false, null];
    const klimischs: EvidenceClaim["klimisch"][] = [1, 4, null];
    const streams: EvidenceClaim["stream"][] = ["qsar", "cytotox"];
    for (const system of systems) {
      for (const measuresKeyEvent of keyEvents) {
        for (const exposureRelevant of exposures) {
          for (const klimisch of klimischs) {
            for (const stream of streams) {
              yield { system, measuresKeyEvent, exposureRelevant, klimisch, stream };
            }
          }
        }
      }
    }
  }

  it("defeats() never licenses both directions, for any combination of rule-relevant fields", () => {
    const vs = [...variants()];
    let checked = 0;
    for (const vi of vs) {
      for (const vj of vs) {
        const a = claim({ id: "a", assertion: "toxic", ...vi });
        const b = claim({ id: "b", assertion: "safe", ...vj });
        const forward = defeats(a, b, RS);
        const reverse = defeats(b, a, RS);
        if (forward !== null && reverse !== null) {
          throw new Error(
            `2-cycle: (${JSON.stringify(vi)}) vs (${JSON.stringify(vj)}) - forward=${forward.byRule}, reverse=${reverse.byRule}`,
          );
        }
        checked++;
      }
    }
    expect(checked).toBe(vs.length * vs.length);
  });

  it("the motivating fixture (human in-vitro, unstated exposure vs rodent in-vivo, clinical exposure) resolves to R3 one-way, not a cycle", () => {
    const humanInVitro = claim({
      id: "h", assertion: "safe", system: "human", stream: "cytotox",
      measuresKeyEvent: "KE:1", exposureRelevant: null,
    });
    const rodentInVivo = claim({
      id: "r", assertion: "toxic", system: "rodent", stream: "invivo_rodent",
      measuresKeyEvent: null, exposureRelevant: true,
    });
    expect(defeats(humanInVitro, rodentInVivo, RS)).toBeNull();
    expect(defeats(rodentInVivo, humanInVitro, RS)?.byRule).toBe("R3");
  });
});

describe("ruleset validity", () => {
  it("the pre-registered ruleset is schema-valid", () => {
    expect(() => RulesetSchema.parse(ruleset)).not.toThrow();
  });
});

describe("pre-registration", () => {
  it("no rule justification cites TAK-994", () => {
    // Scans the whole ruleset, not just rules[], so a stray top-level field
    // (e.g. precedenceRationale) can't slip a reference past this guard.
    const blob = JSON.stringify(RS).toLowerCase();
    expect(blob).not.toContain("tak-994");
    expect(blob).not.toContain("tak994");
  });
});

describe("relevanceDiscount", () => {
  it("leaves ideal evidence undiscounted", () => {
    const d = relevanceDiscount(claim({
      system: "human", stream: "cytotox", measuresKeyEvent: "KE:1",
      exposureRelevant: true, inApplicabilityDomain: true, klimisch: 1,
    }), RS);
    expect(d.factor).toBe(1);
    expect(d.reasons).toHaveLength(0);
  });

  it("discounts a clean rodent study whose exposure was never established", () => {
    // THE PASS-1 CASE. Unopposed, but it licenses very little.
    const d = relevanceDiscount(claim({
      system: "rodent", stream: "invivo_rodent", measuresKeyEvent: null,
      exposureRelevant: null, klimisch: 1,
    }), RS);
    expect(d.factor).toBeLessThan(0.2);
    expect(d.reasons.map((r) => r.byRule).sort()).toEqual(["R1", "R3"]);
  });

  it("compounds multiplicatively - the factor is exactly the product of (1 - strength)", () => {
    // `both < one` alone would also be satisfied by max() or by 1 - sum(). Assert
    // the actual product, read from the ruleset's own strengths rather than
    // hard-coded, so the test tracks a re-registration instead of breaking on one.
    const r1 = RS.rules.find((r) => r.id === "R1")!.strength;
    const r3 = RS.rules.find((r) => r.id === "R3")!.strength;
    const both = relevanceDiscount(claim({ system: "rodent", exposureRelevant: null }), RS).factor;
    const one = relevanceDiscount(claim({ system: "rodent", exposureRelevant: true }), RS).factor;
    expect(both).toBeCloseTo((1 - r1) * (1 - r3), 10);
    expect(one).toBeCloseTo(1 - r1, 10);
    expect(both).toBeLessThan(one);
  });

  it("moves discounted mass nowhere - it only reduces, never flips", () => {
    // The no-flip property is only OBSERVABLE on a mass, so assert it there. A
    // range check on the factor cannot see a flip at all: any implementation that
    // moved mass to the opposing side would still return a factor in (0,1).
    const discountedSafe = reason([claim({
      id: "s", assertion: "safe", strength: 0.9, system: "rodent",
      stream: "invivo_rodent", exposureRelevant: null, klimisch: 1,
    })], RS);
    expect(discountedSafe.mass.safe).toBeGreaterThan(0);
    expect(discountedSafe.mass.safe).toBeLessThan(0.9);
    expect(discountedSafe.mass.toxic).toBe(0);

    const discountedToxic = reason([claim({
      id: "t", assertion: "toxic", strength: 0.9, system: "rodent",
      stream: "invivo_rodent", exposureRelevant: null, klimisch: 3,
    })], RS);
    expect(discountedToxic.mass.toxic).toBeGreaterThan(0);
    expect(discountedToxic.mass.toxic).toBeLessThan(0.9);
    expect(discountedToxic.mass.safe).toBe(0);
  });

  it("applies R3 ONLY to negative findings - a positive hit is not discounted for margin", () => {
    // R3's registered statement is about negative findings. A hazard signal at an
    // unrecorded concentration is still a hazard signal; you go and measure the
    // margin next. An absence of signal at an unrecorded concentration licenses
    // nothing. If this test flips, every hazard call in the automated streams gets
    // crushed to 15% and the whole evaluation set abstains.
    const shared = { system: "human" as const, stream: "cytotox" as const, exposureRelevant: null, klimisch: 1 };
    expect(relevanceDiscount(claim({ ...shared, assertion: "safe" }), RS).reasons.map((r) => r.byRule)).toEqual(["R3"]);
    const positive = relevanceDiscount(claim({ ...shared, assertion: "toxic" }), RS);
    expect(positive.reasons).toHaveLength(0);
    expect(positive.factor).toBe(1);
  });

  it("still discounts a positive finding for every NON-directional weakness", () => {
    // The R3 carve-out must not become a blanket exemption for positives: a
    // low-reliability rodent hit is still weak evidence about humans.
    const d = relevanceDiscount(claim({
      assertion: "toxic", system: "rodent", stream: "invivo_rodent",
      exposureRelevant: null, klimisch: 3,
    }), RS);
    expect(d.reasons.map((r) => r.byRule).sort()).toEqual(["R1", "R5"]);
  });

  it("respects disabled rules", () => {
    const off: Ruleset = { ...RS, rules: RS.rules.map((r) => ({ ...r, enabled: false })) };
    expect(relevanceDiscount(claim({ system: "rodent", exposureRelevant: null }), off).factor).toBe(1);
  });

  it("reads strengths from the ruleset rather than hard-coding them", () => {
    const weak: Ruleset = { ...RS, rules: RS.rules.map((r) => r.id === "R1" ? { ...r, strength: 0.1 } : r) };
    const strong: Ruleset = { ...RS, rules: RS.rules.map((r) => r.id === "R1" ? { ...r, strength: 0.9 } : r) };
    const c = claim({ system: "rodent", exposureRelevant: true });
    expect(relevanceDiscount(c, weak).factor).toBeGreaterThan(relevanceDiscount(c, strong).factor);
  });
});
