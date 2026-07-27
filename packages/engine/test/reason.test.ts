import { describe, expect, it } from "vitest";
import { reason } from "../src/index.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("reason", () => {
  it("abstains on no evidence at all, with a maximally wide range", () => {
    const r = reason([], RS);
    expect(r.verdict).toBe("abstain");
    expect(r.belief).toBeCloseTo(0, 10);
    expect(r.plausibility).toBeCloseTo(1, 10);
  });

  it("advances on unanimous strong safe evidence that is human and exposure-established", () => {
    const r = reason([
      claim({ id: "a", assertion: "safe", strength: 0.9, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
    ], RS);
    expect(r.verdict).toBe("advance");
    expect(r.contested).toBe(false);
  });

  it("THE PASS-1 CASE: abstains on unanimous evidence that licenses nothing", () => {
    // Four claims all saying "safe", none contradicting any other - and yet the
    // honest answer is that we cannot tell. Every one is either non-human or was
    // never measured at clinical exposure, so most of their mass belongs in Theta
    // rather than on "safe".
    //
    // This is the mechanism demo beat 3 rests on. Before evidence-quality
    // discounting existed, no rule fired (nothing conflicts), every claim was
    // admitted at full strength, and reason() returned ADVANCE - agreeing with the
    // historical decision that harmed three trial participants. If this test ever
    // goes back to expecting "advance", the discount mechanism has regressed and
    // the demo's central beat is broken.
    const r = reason([
      claim({ id: "rat", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent", exposureRelevant: null, measuresKeyEvent: null }),
      claim({ id: "primate", assertion: "safe", strength: 0.85, system: "nonrodent", stream: "invivo_nonrodent", exposureRelevant: null, measuresKeyEvent: null }),
      claim({ id: "invitro", assertion: "safe", strength: 0.8, system: "human", stream: "cytotox", exposureRelevant: null, measuresKeyEvent: "KE:HEPATOCYTE-DEATH" }),
      claim({ id: "bsep", assertion: "safe", strength: 0.75, system: "human", stream: "transporter", exposureRelevant: null, measuresKeyEvent: "KE:BSEP" }),
    ], RS);

    expect(r.verdict).toBe("abstain");
    // Nothing was defeated - there was no conflict to resolve.
    expect(r.trace.filter((s) => s.status === "defeated")).toHaveLength(0);
    // The gap is what carries the abstention.
    expect(r.plausibility - r.belief).toBeGreaterThan(RS.abstentionGapThreshold);
    // And the trace must SAY why, per claim, not just report a verdict.
    const ratStep = r.trace.find((s) => s.claimId === "rat")!;
    expect(ratStep.rationale).toMatch(/exposure|indirect|reduced/i);
  });

  it("discounting reduces belief without flipping it to the opposing side", () => {
    // Weak evidence for safety must never become evidence of toxicity.
    const weak = reason([
      claim({ id: "a", assertion: "safe", strength: 0.9, system: "rodent", stream: "invivo_rodent", exposureRelevant: null }),
    ], RS);
    expect(weak.belief).toBeLessThan(0.5); // belief in TOXIC stays low
    expect(weak.plausibility).toBeGreaterThan(0.5); // ignorance is wide
  });

  it("does not advance when the surviving evidence says toxic", () => {
    // The surviving human claim has exposureRelevant: null, so this case ALSO
    // guards R3's directional scope. If R3 ever starts discounting positives
    // too, this claim drops to 15% of its weight, the gap widens to 0.87, and
    // the verdict silently becomes "abstain".
    const r = reason([
      claim({ id: "h", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1 }),
      claim({ id: "r", assertion: "safe", strength: 0.9, system: "rodent", stream: "invivo_rodent", klimisch: 2 }),
    ], RS);
    expect(r.verdict).toBe("do_not_advance");
    // The defeated rodent claim is still in the trace - nothing is hidden.
    expect(r.trace.find((s) => s.claimId === "r")?.status).toBe("defeated");
    expect(r.trace.find((s) => s.claimId === "r")?.byRule).toBe("R1");
  });

  it("excludes defeated claims from fusion but keeps them in the trace", () => {
    const withDefeat = reason([
      claim({ id: "h", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1 }),
      claim({ id: "r", assertion: "safe", strength: 0.99, system: "rodent", stream: "invivo_rodent", klimisch: 2 }),
    ], RS);
    const alone = reason([claim({ id: "h", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1 })], RS);
    // The very strong defeated claim must not drag belief down.
    expect(withDefeat.belief).toBeCloseTo(alone.belief, 10);
    expect(withDefeat.trace).toHaveLength(2);
  });

  it("marks a case contested when both sides survive", () => {
    const r = reason([
      claim({ id: "a", assertion: "toxic", klimisch: 2, stream: "cytotox" }),
      claim({ id: "b", assertion: "safe", klimisch: 2, stream: "transporter" }),
    ], RS);
    expect(r.contested).toBe(true);
  });

  it("carries the ruleset hash through to the output", () => {
    expect(reason([], RS, "deadbeef").rulesetHash).toBe("deadbeef");
  });

  it("emits belief <= plausibility always", () => {
    const r = reason([claim({ id: "a", assertion: "toxic", strength: 0.5 })], RS);
    expect(r.belief).toBeLessThanOrEqual(r.plausibility);
  });
});
