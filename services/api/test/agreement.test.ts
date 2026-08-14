import { describe, expect, it } from "vitest";
import { caseAgreement, fleissKappa } from "../agreement.js";
import type { Call } from "../deliberation.js";

const A: Call = "advance";
const D: Call = "do_not_advance";
const C: Call = "cannot_conclude";

describe("caseAgreement", () => {
  it("is 1 when everyone made the same call", () => {
    const out = caseAgreement([A, A, A, A]);
    expect(out?.pairwiseAgreement).toBe(1);
    expect(out?.raters).toBe(4);
    expect(out?.dissenters).toBe(0);
  });

  it("counts agreeing PAIRS, not agreeing people", () => {
    // 4 raters, 3 advance and 1 do_not_advance.
    // agreeing pairs = C(3,2) = 3. total pairs = C(4,2) = 6. So 0.5, not 0.75.
    // The distinction matters: "three of four agreed" sounds like 0.75 and is the
    // headcount reading this deliberately is not.
    const out = caseAgreement([A, A, A, D]);
    expect(out?.pairwiseAgreement).toBe(0.5);
    expect(out?.dissenters).toBe(1);
  });

  it("is 0 when every rater chose differently", () => {
    expect(caseAgreement([A, D, C])?.pairwiseAgreement).toBe(0);
  });

  it("is null below two raters, because agreement needs two", () => {
    expect(caseAgreement([A])).toBeNull();
    expect(caseAgreement([])).toBeNull();
  });
});

describe("fleissKappa", () => {
  it("is 1 on perfect agreement across items using different categories", () => {
    // item 1: 3x advance -> P_1 = (9-3)/(3*2) = 1. item 2: 3x do_not_advance -> 1.
    // pooled p = 0.5 each -> P_e = 0.5. kappa = (1-0.5)/(1-0.5) = 1.
    const out = fleissKappa([[A, A, A], [D, D, D]]);
    expect(out.kappa).toBeCloseTo(1, 10);
    expect(out.observedAgreement).toBeCloseTo(1, 10);
    expect(out.expectedAgreement).toBeCloseTo(0.5, 10);
    expect(out.items).toBe(2);
    expect(out.totalAssignments).toBe(6);
  });

  it("is -1 when raters split evenly on every item", () => {
    // P_o = 0, P_e = 0.5, so (0 - 0.5) / 0.5 = -1. Maximum systematic disagreement.
    expect(fleissKappa([[A, D], [A, D]]).kappa).toBeCloseTo(-1, 10);
  });

  it("is null, NOT 1, when every item is unanimous on the same category", () => {
    // Expected agreement is also 1, so kappa is 0/0. Reporting 1 here would claim
    // the raters beat chance when there was no chance to beat, which is the exact
    // way a chance-corrected statistic misleads.
    const out = fleissKappa([[A, A], [A, A]]);
    expect(out.kappa).toBeNull();
    expect(out.undefinedReason).toContain("one category");
  });

  it("is null with no usable items", () => {
    expect(fleissKappa([]).kappa).toBeNull();
    expect(fleissKappa([[A]]).kappa).toBeNull();
    expect(fleissKappa([[A]]).undefinedReason).toContain("two or more");
  });

  it("handles a different number of raters per item", () => {
    // Not every case has the same panel, so the per-item n is used in the observed
    // term and the pooled assignments in the expected term.
    const out = fleissKappa([[A, A, A], [D, D]]);
    expect(out.items).toBe(2);
    expect(out.totalAssignments).toBe(5);
    expect(out.kappa).toBeCloseTo(1, 10);
  });

  it("ignores items with fewer than two positions rather than counting them as agreement", () => {
    // A case one person answered is not a case everybody agreed on.
    const out = fleissKappa([[A, A, A], [D, D, D], [A]]);
    expect(out.items).toBe(2);
    expect(out.totalAssignments).toBe(6);
  });
});
