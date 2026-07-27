import { describe, expect, it } from "vitest";
import { VACUOUS, claimToMass, combine, fuse } from "../src/fuse.js";

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);

describe("claimToMass", () => {
  it("puts an ambiguous claim entirely in uncommitted mass", () => {
    const m = claimToMass("ambiguous", 0.9);
    near(m.uncommitted, 1);
    near(m.toxic, 0);
    near(m.safe, 0);
  });

  it("leaves 1 - strength uncommitted for a committed claim", () => {
    const m = claimToMass("toxic", 0.7);
    near(m.toxic, 0.7);
    near(m.uncommitted, 0.3);
  });
});

describe("combine", () => {
  it("is commutative", () => {
    const a = claimToMass("toxic", 0.6);
    const b = claimToMass("safe", 0.3);
    near(combine(a, b).mass.toxic, combine(b, a).mass.toxic);
  });

  it("is associative", () => {
    const [a, b, c] = [claimToMass("toxic", 0.5), claimToMass("safe", 0.4), claimToMass("toxic", 0.2)];
    const left = combine(combine(a!, b!).mass, c!).mass;
    const right = combine(a!, combine(b!, c!).mass).mass;
    near(left.toxic, right.toxic);
    near(left.safe, right.safe);
  });

  it("THE KEY PROPERTY: a silent source does not move belief", () => {
    const a = claimToMass("toxic", 0.7);
    const combined = combine(a, VACUOUS).mass;
    near(combined.toxic, a.toxic);
    near(combined.safe, a.safe);
    near(combined.uncommitted, a.uncommitted);
  });

  it("tracks conflict mass when sources disagree", () => {
    const { conflict } = combine(claimToMass("toxic", 1), claimToMass("safe", 1));
    near(conflict, 1);
  });
});

describe("fuse", () => {
  it("holds belief <= plausibility over random mass assignments", () => {
    // Deterministic pseudo-random sweep: no Math.random in tests either.
    let s = 12345;
    const next = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 500; i++) {
      const masses = Array.from({ length: 1 + (i % 5) }, () => {
        const t = next() * 0.6;
        const f = next() * (1 - t) * 0.6;
        return { toxic: t, safe: f, uncommitted: 1 - t - f };
      });
      const r = fuse(masses);
      expect(r.belief).toBeLessThanOrEqual(r.plausibility + 1e-12);
      expect(r.belief).toBeGreaterThanOrEqual(0);
      expect(r.plausibility).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it("returns a maximally wide range for no evidence at all", () => {
    const r = fuse([]);
    near(r.belief, 0);
    near(r.plausibility, 1);
  });

  it("reports total conflict rather than dividing by zero", () => {
    const r = fuse([claimToMass("toxic", 1), claimToMass("safe", 1)]);
    near(r.conflictMass, 1);
    near(r.belief, 0);
    near(r.plausibility, 1);
  });
});
