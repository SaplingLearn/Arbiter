import { describe, expect, it } from "vitest";
import { concordanceBoost, conflictsWith, defeats, downweightFactor } from "../src/rules.js";
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
});

describe("R5 study reliability", () => {
  it("a more reliable study defeats a less reliable one at equal relevance", () => {
    const good = claim({ id: "g", assertion: "toxic", klimisch: 1 });
    const poor = claim({ id: "p", assertion: "safe", klimisch: 4 });
    expect(defeats(good, poor, RS)?.byRule).toBe("R5");
    expect(defeats(poor, good, RS)).toBeNull();
  });
});

describe("R6 concordance", () => {
  it("rewards agreement across distinct streams, not within one", () => {
    const twoStreams = [claim({ id: "a", stream: "cytotox" }), claim({ id: "b", stream: "transporter" })];
    const oneStream = [claim({ id: "a", stream: "cytotox" }), claim({ id: "b", stream: "cytotox" })];
    expect(concordanceBoost(twoStreams, RS)).toBeGreaterThan(concordanceBoost(oneStream, RS));
  });
});

describe("disabled rules", () => {
  it("a disabled rule never fires", () => {
    const off: Ruleset = { ...RS, rules: RS.rules.map((r) => (r.id === "R1" ? { ...r, enabled: false } : r)) };
    const human = claim({ id: "h", assertion: "toxic", system: "human", exposureRelevant: null, klimisch: 2 });
    const rat = claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", exposureRelevant: null, klimisch: 2 });
    expect(defeats(human, rat, off)?.byRule).not.toBe("R1");
  });
});

describe("pre-registration", () => {
  it("no rule justification cites TAK-994", () => {
    const blob = JSON.stringify(RS.rules).toLowerCase();
    expect(blob).not.toContain("tak-994");
    expect(blob).not.toContain("tak994");
  });
});
