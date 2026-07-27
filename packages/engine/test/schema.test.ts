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
