import { describe, expect, it } from "vitest";
import { EvidenceClaimSchema, RulesetSchema } from "../src/schema.js";

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
});

describe("RulesetSchema", () => {
  it("requires all six rules", () => {
    const ruleset = {
      version: "1.0",
      registeredAt: "2026-07-26",
      abstentionGapThreshold: 0.5,
      dilirankBinarisation: { positive: ["vMost-DILI-Concern"], negative: ["vNo-DILI-Concern"], excluded: ["Ambiguous"] },
      rules: [{ id: "R1", name: "Human relevance", statement: "s", framework: { name: "f", date: "2025-04" }, enabled: true, strength: 1 }],
    };
    expect(() => RulesetSchema.parse(ruleset)).toThrow(/six/i);
  });
});
