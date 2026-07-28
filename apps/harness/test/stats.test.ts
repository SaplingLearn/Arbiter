import { describe, expect, it } from "vitest";
import { balancedAccuracy, balancedAccuracyInterval, confusion, mean, singleClass, wilson } from "../src/stats.js";

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

/** Build pairs with a given confusion shape, so the tests read as the shape they test. */
function pairs(tp: number, fp: number, tn: number, fn: number): { y: number; predicted: number }[] {
  return [
    ...Array.from({ length: tp }, () => ({ y: 1, predicted: 1 })),
    ...Array.from({ length: fn }, () => ({ y: 1, predicted: 0 })),
    ...Array.from({ length: tn }, () => ({ y: 0, predicted: 0 })),
    ...Array.from({ length: fp }, () => ({ y: 0, predicted: 1 })),
  ];
}

describe("balancedAccuracyInterval", () => {
  it("is NULL when a class is absent, because the substituted 0.5 is not an estimate", () => {
    // The real ARBITER headline shape: 4 committed, all positive, all correct.
    // The old code reported wilson(4,4) = [0.51, 1.00] beside a balanced accuracy
    // of 0.75. That interval describes raw accuracy 1.0, not 0.75.
    expect(balancedAccuracyInterval(pairs(4, 0, 0, 0))).toBeNull();
    expect(balancedAccuracyInterval(pairs(0, 0, 6, 0))).toBeNull();
  });

  it("CONTAINS the point estimate where the raw-accuracy interval did not", () => {
    // single:qsar's real shape, and the cleanest demonstration of the defect.
    // BOTH classes are present here (54 positives, 6 negatives), so balanced
    // accuracy 0.5 is a genuine estimate rather than a substitution - it scored
    // sensitivity 1.0 and specificity 0.0 by calling all six negatives positive.
    // Raw accuracy is 54/60 = 0.9, and wilson(54,60) = [0.799, 0.953], which was
    // printed beside 0.500 and does not contain it.
    const qsar = pairs(54, 6, 0, 0);
    const raw = wilson(54, 60);
    const ba = balancedAccuracy(qsar);
    expect(ba).toBeCloseTo(0.5, 10);
    expect(raw.lo).toBeGreaterThan(ba); // the defect, pinned

    const fixed = balancedAccuracyInterval(qsar)!;
    expect(fixed).not.toBeNull();
    expect(fixed.lo).toBeLessThanOrEqual(ba);
    expect(fixed.hi).toBeGreaterThanOrEqual(ba);

    // Other shapes with both classes present must bracket their estimate too.
    for (const shape of [pairs(51, 5, 1, 4), pairs(10, 10, 10, 10), pairs(9, 1, 1, 9)]) {
      const ba = balancedAccuracy(shape);
      const ci = balancedAccuracyInterval(shape);
      expect(ci).not.toBeNull();
      expect(ci!.lo).toBeLessThanOrEqual(ba);
      expect(ci!.hi).toBeGreaterThanOrEqual(ba);
    }
  });

  it("stays inside [0,1] at the extremes", () => {
    const ci = balancedAccuracyInterval(pairs(1, 0, 1, 0))!;
    expect(ci.lo).toBeGreaterThanOrEqual(0);
    expect(ci.hi).toBeLessThanOrEqual(1);
  });

  it("narrows as n grows on the same underlying rates", () => {
    const small = balancedAccuracyInterval(pairs(8, 2, 8, 2))!;
    const large = balancedAccuracyInterval(pairs(80, 20, 80, 20))!;
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
  });
});
