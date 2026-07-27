import { describe, expect, it } from "vitest";
import { shouldAbstain } from "../src/abstain.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { ClaimStatus, EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;
const base = { statuses: new Map<string, ClaimStatus>(), claims: [] as EvidenceClaim[], ruleset: RS };

function cl(
  id: string,
  stream: EvidenceClaim["stream"],
  assertion: EvidenceClaim["assertion"],
  inApplicabilityDomain: boolean | null,
): EvidenceClaim {
  return {
    id, compoundId: "X", stream, assertion, strength: 0.8, system: "human",
    measuresKeyEvent: null, exposureRelevant: null, inApplicabilityDomain,
    klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
  };
}

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

  it("does not let a DEFEATED in-domain claim suppress the applicability abstention", () => {
    // The only claim still carrying mass is out of its applicability domain. The
    // in-domain claim was defeated, so it contributes nothing and must not vouch
    // for a verdict it no longer supports. Before the Task 6 fix this returned
    // abstain:false - the dangerous direction.
    const claims: EvidenceClaim[] = [
      cl("live", "qsar", "toxic", false),
      cl("dead", "cytotox", "safe", true),
    ];
    const statuses = new Map<string, ClaimStatus>([["live", "admitted"], ["dead", "defeated"]]);
    const r = shouldAbstain({ belief: 0.3, plausibility: 0.4, conflictMass: 0, statuses, claims, ruleset: RS });
    expect(r.abstain).toBe(true);
    expect(r.reason).toMatch(/applicability domain/i);
  });

  it("treats an UNDECIDED claim as not live either", () => {
    const claims: EvidenceClaim[] = [
      cl("live", "qsar", "toxic", false),
      cl("limbo", "cytotox", "safe", true),
    ];
    const statuses = new Map<string, ClaimStatus>([["live", "admitted"], ["limbo", "undecided"]]);
    expect(shouldAbstain({ belief: 0.3, plausibility: 0.4, conflictMass: 0, statuses, claims, ruleset: RS }).abstain)
      .toBe(true);
  });

  it("does NOT abstain at exactly the threshold - the comparison is strict", () => {
    // 1 - 0.5 is exactly 0.5 in binary floating point, so this really does sit
    // on the boundary. (0.7 - 0.2 would not - it lands at 0.49999999999999994.)
    const r = shouldAbstain({ ...base, belief: 0.5, plausibility: 1, conflictMass: 0 });
    expect(1 - 0.5).toBe(RS.abstentionGapThreshold);
    expect(r.abstain).toBe(false);
  });

  it("does not conflate an UNKNOWN applicability domain with an out-of-domain one", () => {
    const claims: EvidenceClaim[] = [
      cl("known-bad", "qsar", "toxic", false),
      cl("unknown", "cytotox", "toxic", null),
    ];
    const statuses = new Map<string, ClaimStatus>([["known-bad", "admitted"], ["unknown", "admitted"]]);
    const r = shouldAbstain({ belief: 0.3, plausibility: 0.4, conflictMass: 0, statuses, claims, ruleset: RS });
    expect(r.abstain).toBe(false);
  });
});
