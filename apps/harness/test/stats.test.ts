import { describe, expect, it } from "vitest";
import { balancedAccuracy, confusion, mean, singleClass, wilson } from "../src/stats.js";

describe("wilson", () => {
  it("brackets the point estimate", () => {
    const { lo, hi } = wilson(7, 10);
    expect(lo).toBeLessThan(0.7);
    expect(hi).toBeGreaterThan(0.7);
  });

  it("narrows as n grows - the whole reason we report intervals", () => {
    const small = wilson(70, 100);
    const large = wilson(700, 1000);
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
  });

  it("stays inside [0,1] at the extremes, where the normal approximation does not", () => {
    for (const [s, n] of [[0, 5], [5, 5], [0, 1], [1, 1]] as const) {
      const { lo, hi } = wilson(s, n);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      expect(lo).toBeLessThanOrEqual(hi);
    }
  });

  it("returns the maximally uninformative interval for n = 0", () => {
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
  });

  it("matches a hand-computed value, so a refactor cannot silently change the maths", () => {
    // p=0.5, n=4, z=1.96: centre = (0.5 + 0.4802) / 1.9604 = 0.5
    // half = 1.96 * sqrt(0.0625 + 0.06003) / 1.9604 = 0.34992...
    const { lo, hi } = wilson(2, 4);
    expect(lo).toBeCloseTo(0.15003, 4);
    expect(hi).toBeCloseTo(0.84997, 4);
  });
});

describe("confusion", () => {
  it("assigns every cell correctly", () => {
    const c = confusion([
      { y: 1, predicted: 1 }, { y: 1, predicted: 1 },
      { y: 1, predicted: 0 },
      { y: 0, predicted: 1 },
      { y: 0, predicted: 0 }, { y: 0, predicted: 0 }, { y: 0, predicted: 0 },
    ]);
    expect(c).toEqual({ tp: 2, fn: 1, fp: 1, tn: 3 });
  });
});

describe("balancedAccuracy", () => {
  it("is not fooled by the majority class", () => {
    // 90 positives all predicted positive, 10 negatives all predicted positive.
    // Plain accuracy is 0.90; balanced accuracy is 0.50.
    const pairs = [
      ...Array.from({ length: 90 }, () => ({ y: 1, predicted: 1 })),
      ...Array.from({ length: 10 }, () => ({ y: 0, predicted: 1 })),
    ];
    expect(balancedAccuracy(pairs)).toBeCloseTo(0.5, 12);
  });

  it("is 1 for a perfect classifier and 0 for an inverted one", () => {
    const perfect = [{ y: 1, predicted: 1 }, { y: 0, predicted: 0 }];
    const inverted = [{ y: 1, predicted: 0 }, { y: 0, predicted: 1 }];
    expect(balancedAccuracy(perfect)).toBe(1);
    expect(balancedAccuracy(inverted)).toBe(0);
  });

  it("substitutes 0.5 for an absent class rather than dividing by zero", () => {
    expect(balancedAccuracy([{ y: 1, predicted: 1 }])).toBeCloseTo(0.75, 12);
    expect(balancedAccuracy([])).toBe(0.5);
  });
});

describe("singleClass", () => {
  it("flags exactly the cases where balancedAccuracy substituted 0.5", () => {
    // This is the guard that stops a figure computed over four same-label
    // compounds being quoted as though it were an accuracy. The conflict subset
    // in this project is 90% positive, so it is a live risk, not a hypothetical.
    expect(singleClass([{ y: 1, predicted: 1 }, { y: 1, predicted: 0 }])).toBe(true);
    expect(singleClass([{ y: 0, predicted: 1 }, { y: 0, predicted: 0 }])).toBe(true);
    expect(singleClass([{ y: 1, predicted: 1 }, { y: 0, predicted: 0 }])).toBe(false);
    expect(singleClass([])).toBe(true);
  });

  it("is true exactly when balancedAccuracy is a half-substituted number", () => {
    const onePos = [{ y: 1, predicted: 1 }];
    expect(singleClass(onePos)).toBe(true);
    // sensitivity 1, specificity substituted 0.5 -> 0.75, not a real accuracy.
    expect(balancedAccuracy(onePos)).toBeCloseTo(0.75, 12);
  });
});

describe("mean", () => {
  it("is 0 for an empty list rather than NaN", () => {
    expect(mean([])).toBe(0);
  });

  it("averages", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
});
