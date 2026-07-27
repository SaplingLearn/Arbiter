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
    // Weak evidence for safety must never become evidence of toxicity. Asserted on
    // the MASS, not on `belief`: belief is the mass on toxic, and a lone safe claim
    // puts exactly 0 there under any implementation, so a `belief < 0.5` assertion
    // could not fail.
    const weak = reason([
      claim({ id: "a", assertion: "safe", strength: 0.9, system: "rodent", stream: "invivo_rodent", exposureRelevant: null }),
    ], RS);
    // Nothing leaked to the opposing side.
    expect(weak.mass.toxic).toBe(0);
    // The discount actually bit: safe mass is strictly below the stated 0.9.
    expect(weak.mass.safe).toBeGreaterThan(0);
    expect(weak.mass.safe).toBeLessThan(0.9);
    // And the reduction went to Theta, not anywhere else.
    expect(weak.mass.uncommitted).toBeCloseTo(1 - weak.mass.safe, 10);
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
    // One step per claim. Counted over real claim steps only, so this does not
    // silently double as an assertion that the case never abstains.
    expect(withDefeat.trace.filter((s) => s.kind !== "verdict")).toHaveLength(2);
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

  it("emits a coherent mass - belief <= plausibility, components in [0,1], sum 1 - on every shape of input", () => {
    // The previous version of this test used ONE single-claim input, where the
    // relation holds by construction, and never touched multi-mass fusion,
    // normalisation, defeat, or the undecided branch. These are the shapes where
    // the arithmetic could actually go wrong.
    const cases: Record<string, EvidenceClaim[]> = {
      "empty": [],
      "all ambiguous": [
        claim({ id: "a", assertion: "ambiguous", strength: 0.9, stream: "qsar", system: "in_silico" }),
        claim({ id: "b", assertion: "ambiguous", strength: 0.4, stream: "cytotox" }),
      ],
      // Neither side can defeat the other (same system, equal Klimisch, both at
      // clinical exposure), so both survive into fusion and normalisation runs on
      // a genuinely conflicting pair.
      "live conflict, both admitted": [
        claim({ id: "t", assertion: "toxic", strength: 0.9, stream: "cytotox", exposureRelevant: true }),
        claim({ id: "s", assertion: "safe", strength: 0.9, stream: "transporter", exposureRelevant: true }),
      ],
      "one claim defeated": [
        claim({ id: "h", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1 }),
        claim({ id: "r", assertion: "safe", strength: 0.99, system: "rodent", stream: "invivo_rodent", klimisch: 2 }),
      ],
      // A real 4-cycle against the pre-registered ruleset: grounded semantics
      // settles none of these, so all four are UNDECIDED and contribute pure
      // ignorance. See argue.test.ts for the hand-traced edges.
      "undecided 4-cycle": [
        claim({ id: "a", assertion: "toxic", system: "human", klimisch: 4 }),
        claim({ id: "b", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 1 }),
        claim({ id: "c", assertion: "toxic", system: "nonrodent", stream: "invivo_nonrodent", klimisch: 2 }),
        claim({ id: "d", assertion: "safe", system: "in_silico", stream: "qsar", klimisch: 3 }),
      ],
      "everything out of applicability domain": [
        claim({ id: "a", assertion: "toxic", strength: 0.7, stream: "qsar", system: "in_silico", inApplicabilityDomain: false }),
        claim({ id: "b", assertion: "safe", strength: 0.7, stream: "cytotox", inApplicabilityDomain: false }),
      ],
      "the pass-1 case": [
        claim({ id: "rat", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent" }),
        claim({ id: "invitro", assertion: "safe", strength: 0.8, system: "human", stream: "cytotox", measuresKeyEvent: "KE:1" }),
      ],
    };

    for (const [name, claims] of Object.entries(cases)) {
      const r = reason(claims, RS);
      const parts = [r.mass.toxic, r.mass.safe, r.mass.uncommitted, r.belief, r.plausibility, r.conflictMass];
      for (const v of parts) {
        expect(Number.isFinite(v), `${name}: non-finite value ${v}`).toBe(true);
      }
      expect(r.belief, name).toBeLessThanOrEqual(r.plausibility);
      for (const v of [r.mass.toxic, r.mass.safe, r.mass.uncommitted]) {
        expect(v, `${name}: mass component out of [0,1]`).toBeGreaterThanOrEqual(0);
        expect(v, `${name}: mass component out of [0,1]`).toBeLessThanOrEqual(1);
      }
      expect(r.mass.toxic + r.mass.safe + r.mass.uncommitted, name).toBeCloseTo(1, 9);
      // belief and plausibility must be the mass, not a separately-derived number.
      expect(r.belief, name).toBeCloseTo(r.mass.toxic, 12);
      expect(r.plausibility, name).toBeCloseTo(r.mass.toxic + r.mass.uncommitted, 12);
    }
  });

  it("explains an exactly-balanced abstention in the trace instead of going silent", () => {
    // Two equally strong, equally qualified, directly opposed human claims. No
    // rule can separate them, so the fused mass on toxic and on safe are exactly
    // equal and the honest verdict is to decline - which the trace must SAY.
    const r = reason([
      claim({ id: "t", assertion: "toxic", strength: 0.9, stream: "cytotox", exposureRelevant: true, klimisch: 2 }),
      claim({ id: "s", assertion: "safe", strength: 0.9, stream: "transporter", exposureRelevant: true, klimisch: 2 }),
    ], RS);
    expect(r.mass.toxic).toBe(r.mass.safe);
    expect(r.verdict).toBe("abstain");
    const note = r.trace.find((s) => s.kind === "verdict");
    expect(note).toBeDefined();
    expect(note!.rationale).toMatch(/exactly balanced/i);
  });

  it("marks the verdict pseudo-step with kind, and only when there is one", () => {
    // Consumers (Tasks 8 and 9, and the UI) walk this trace. The synthetic verdict
    // note must be distinguishable from a real claim step by something better than
    // its id or its status.
    const abstaining = reason([
      claim({ id: "rat", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent" }),
      claim({ id: "primate", assertion: "safe", strength: 0.85, system: "nonrodent", stream: "invivo_nonrodent" }),
    ], RS);
    expect(abstaining.verdict).toBe("abstain");
    expect(abstaining.trace.filter((s) => s.kind === "verdict")).toHaveLength(1);

    const committing = reason([
      claim({ id: "a", assertion: "safe", strength: 0.9, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
    ], RS);
    expect(committing.verdict).not.toBe("abstain");
    expect(committing.trace.filter((s) => s.kind === "verdict")).toHaveLength(0);
  });

  it("does not annotate an ambiguous claim with a discount that never happened", () => {
    // An ambiguous claim commits no mass, so there is nothing to discount. A
    // rodent Klimisch-4 ambiguous claim previously got "Weight reduced to 4% of
    // stated confidence" even though claimToMass had returned VACUOUS.
    const r = reason([
      claim({ id: "amb", assertion: "ambiguous", strength: 0.9, system: "rodent", stream: "invivo_rodent", klimisch: 4 }),
    ], RS);
    const step = r.trace.find((s) => s.claimId === "amb")!;
    expect(step.rationale).not.toMatch(/Weight reduced/);
    expect(r.mass.toxic).toBe(0);
    expect(r.mass.safe).toBe(0);
    expect(r.mass.uncommitted).toBe(1);
  });
});
