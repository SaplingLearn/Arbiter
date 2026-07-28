import { describe, expect, it } from "vitest";
import { jitter01, mulberry32, uniform } from "../src/prng.js";

describe("mulberry32", () => {
  it("is reproducible from a seed", () => {
    const a = Array.from({ length: 20 }, mulberry32(42));
    const b = Array.from({ length: 20 }, mulberry32(42));
    expect(a).toEqual(b);
  });

  it("differs across seeds", () => {
    expect(Array.from({ length: 20 }, mulberry32(1))).not.toEqual(Array.from({ length: 20 }, mulberry32(2)));
  });

  it("stays inside [0, 1)", () => {
    const next = mulberry32(7);
    for (let i = 0; i < 5000; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("advances - consecutive draws are not the same number", () => {
    // A generator that returned a constant would satisfy every test above.
    const next = mulberry32(7);
    const draws = Array.from({ length: 100 }, next);
    expect(new Set(draws).size).toBeGreaterThan(90);
  });

  it("pins exact values, so CI reproduces a local number bit for bit", () => {
    // Task 16 golden-files numbers derived from this generator. If the algorithm
    // ever changes, every one of those files silently becomes wrong; this catches
    // it here instead.
    const next = mulberry32(20260726);
    const first = Array.from({ length: 3 }, next).map((v) => Number(v.toFixed(12)));
    expect(first).toEqual([0.830682768719, 0.309936886188, 0.972827275051]);
  });
});

describe("uniform", () => {
  it("stays within the requested range", () => {
    const next = mulberry32(3);
    for (let i = 0; i < 1000; i++) {
      const v = uniform(next, -2, 5);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(5);
    }
  });
});

describe("jitter01", () => {
  it("clamps to [0,1] even when the jitter would overshoot", () => {
    const next = mulberry32(11);
    for (let i = 0; i < 1000; i++) {
      const v = jitter01(next, 0.98, 0.5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("actually perturbs - a jittered value is not the input", () => {
    // pct 0 would return the input exactly; a nonzero pct must move it, or the
    // robustness metric would be sampling the same point 2,000 times.
    const next = mulberry32(5);
    const moved = Array.from({ length: 50 }, () => jitter01(next, 0.5, 0.2));
    expect(new Set(moved).size).toBeGreaterThan(40);
    expect(moved.every((v) => Math.abs(v - 0.5) <= 0.1 + 1e-12)).toBe(true);
  });
});
