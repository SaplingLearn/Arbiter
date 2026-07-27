import { describe, expect, it } from "vitest";
import { shouldAbstain } from "../src/abstain.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { ClaimStatus, EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;
const base = { statuses: new Map<string, ClaimStatus>(), claims: [] as EvidenceClaim[], ruleset: RS };

describe("shouldAbstain", () => {
  it("abstains when the gap exceeds the pre-registered threshold", () => {
    // threshold is 0.50; gap here is 0.70
    const r = shouldAbstain({ ...base, belief: 0.1, plausibility: 0.8, conflictMass: 0 });
    expect(r.abstain).toBe(true);
    expect(r.reason).toMatch(/gap/i);
  });

  it("does NOT abstain one step below the threshold", () => {
    const r = shouldAbstain({ ...base, belief: 0.2, plausibility: 0.69, conflictMass: 0 });
    expect(r.abstain).toBe(false);
    expect(r.reason).toBeNull();
  });

  it("uses the threshold from the ruleset, not a hard-coded constant", () => {
    const strict: Ruleset = { ...RS, abstentionGapThreshold: 0.05 };
    const r = shouldAbstain({ ...base, belief: 0.4, plausibility: 0.5, conflictMass: 0, ruleset: strict });
    expect(r.abstain).toBe(true);
  });

  it("abstains on total conflict", () => {
    const r = shouldAbstain({ ...base, belief: 0, plausibility: 1, conflictMass: 1 });
    expect(r.abstain).toBe(true);
    expect(r.reason).toMatch(/conflict/i);
  });

  it("abstains when every committed claim is out of its applicability domain", () => {
    const claims: EvidenceClaim[] = [{
      id: "q", compoundId: "X", stream: "qsar", assertion: "toxic", strength: 0.9,
      system: "in_silico", measuresKeyEvent: null, exposureRelevant: null,
      inApplicabilityDomain: false, klimisch: null, availableFrom: "2020-01-01",
      provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    }];
    const statuses = new Map<string, ClaimStatus>([["q", "downweighted"]]);
    const r = shouldAbstain({ belief: 0.3, plausibility: 0.4, conflictMass: 0, statuses, claims, ruleset: RS });
    expect(r.abstain).toBe(true);
    expect(r.reason).toMatch(/applicability domain/i);
  });
});
