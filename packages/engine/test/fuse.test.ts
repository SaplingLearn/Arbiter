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

  it("accumulates conflict multiplicatively when sources partially conflict", () => {
    // Three sources: toxic at 0.6, safe at 0.6, toxic at 0.6
    // Hand derivation:
    // A ⊕ B: {toxic: 0.375, safe: 0.375, uncommitted: 0.25}, K₁ = 0.36
    // (A ⊕ B) ⊕ C: K₂ = 0.225
    // Cumulative conflict = 1 - (1 - K₁)(1 - K₂) = 1 - 0.64 × 0.775 = 0.504
    const a = claimToMass("toxic", 0.6);
    const b = claimToMass("safe", 0.6);
    const c = claimToMass("toxic", 0.6);
    const r = fuse([a, b, c]);

    // Expected cumulative conflict is 0.504, strictly greater than max(K₁, K₂) = 0.36
    near(r.conflictMass, 0.504);
    // Strictly greater than max() is the whole point of the fix this test came
    // from, so assert it rather than leaving it to the comment.
    expect(r.conflictMass).toBeGreaterThan(0.36);
  });

  it("produces the hand-derived MASS for an ordinary partial conflict, not just the right shape", () => {
    // The suite validated structure (sums to 1, belief <= plausibility) and the
    // conflict scalar, but never an absolute mass for a partial conflict - so an
    // implementation that normalised correctly while distributing mass wrongly
    // would have passed everything.
    //
    // Two sources, toxic 0.6 against safe 0.6. Unnormalised:
    //   toxic = 0.6*0.4 = 0.24,  safe = 0.4*0.6 = 0.24,  Theta = 0.4*0.4 = 0.16
    //   K = 0.6*0.6 = 0.36,  norm = 0.64
    // Normalised: 0.24/0.64 = 0.375, 0.375, 0.16/0.64 = 0.25.
    const two = fuse([claimToMass("toxic", 0.6), claimToMass("safe", 0.6)]);
    near(two.mass.toxic, 0.375);
    near(two.mass.safe, 0.375);
    near(two.mass.uncommitted, 0.25);

    // Adding a third source, toxic 0.6, against that accumulator:
    //   toxic = 0.375*0.6 + 0.375*0.4 + 0.25*0.6 = 0.525
    //   safe  = 0.375*0.4                        = 0.15
    //   Theta = 0.25*0.4                         = 0.10
    //   K = 0.375*0.6 = 0.225,  norm = 0.775
    // which lands on exact thirty-firsts: 21/31, 6/31, 4/31 (summing to 31/31).
    const three = fuse([claimToMass("toxic", 0.6), claimToMass("safe", 0.6), claimToMass("toxic", 0.6)]);
    near(three.mass.toxic, 21 / 31);
    near(three.mass.safe, 6 / 31);
    near(three.mass.uncommitted, 4 / 31);
    // The two agreeing toxic sources must outweigh the lone safe one, and the
    // surviving belief must exceed what either toxic source carried alone.
    expect(three.mass.toxic).toBeGreaterThan(0.6);
  });
});
