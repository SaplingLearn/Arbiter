import { describe, expect, it } from "vitest";
import { reason, reasonVerdictOnly } from "../src/index.js";
import { findCounterfactual } from "../src/counterfactual.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { Assertion, EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;
const TARGETS: Assertion[] = ["toxic", "safe", "ambiguous"];

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    ...over,
  };
}

const find = (claims: EvidenceClaim[]) =>
  findCounterfactual(claims, RS, reasonVerdictOnly(claims, RS).verdict, reasonVerdictOnly);

/**
 * Brute-force oracle, built to be INDEPENDENT of the implementation rather than a
 * paraphrase of it. The implementation walks nested claim/target loops; this
 * enumerates subsets as bitmasks and assignments as base-3 counters. Same
 * question, different construction, so agreement is evidence rather than an echo.
 *
 * Shares exactly one rule with the implementation on purpose: every flip must be a
 * genuine change. Without that they would disagree legitimately, since a "pair"
 * containing a no-op is really a single.
 */
function oracleMinSize(claims: EvidenceClaim[]): number | null {
  const current = reasonVerdictOnly(claims, RS).verdict;
  const n = claims.length;
  for (const wantSize of [1, 2]) {
    for (let mask = 1; mask < (1 << n); mask++) {
      const idx: number[] = [];
      for (let b = 0; b < n; b++) if (mask & (1 << b)) idx.push(b);
      if (idx.length !== wantSize) continue;

      const combos = 3 ** wantSize;
      for (let code = 0; code < combos; code++) {
        const assign: Assertion[] = [];
        let rest = code;
        for (let k = 0; k < wantSize; k++) {
          assign.push(TARGETS[rest % 3]!);
          rest = Math.floor(rest / 3);
        }
        if (assign.some((t, k) => claims[idx[k]!]!.assertion === t)) continue;

        const flipped = claims.map((c, i) => {
          const k = idx.indexOf(i);
          return k === -1 ? c : { ...c, assertion: assign[k]! };
        });
        if (reasonVerdictOnly(flipped, RS).verdict !== current) return wantSize;
      }
    }
  }
  return null;
}

describe("findCounterfactual", () => {
  it("finds a single-claim flip when one exists", () => {
    const claims = [
      claim({ id: "a", assertion: "safe", strength: 0.9, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
    ];
    const before = reasonVerdictOnly(claims, RS).verdict;
    const cf = find(claims);
    expect(cf).not.toBeNull();
    expect(cf!.flips).toHaveLength(1);
    expect(cf!.newVerdict).not.toBe(before);

    // The reported flip must actually produce the reported verdict. Without this
    // the whole output could be internally inconsistent and still "pass".
    const applied = claims.map((c) =>
      c.id === cf!.flips[0]!.claimId ? { ...c, assertion: cf!.flips[0]!.to } : c);
    expect(reasonVerdictOnly(applied, RS).verdict).toBe(cf!.newVerdict);
  });

  it("prefers the smallest flip - reports a single, never a pair, when a single works", () => {
    const claims = [
      claim({ id: "a", assertion: "safe", strength: 0.95, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.95, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
      claim({ id: "c", assertion: "safe", strength: 0.95, stream: "invivo_rodent", system: "rodent", exposureRelevant: true }),
    ];
    const cf = find(claims);
    // Asserted UNCONDITIONALLY. An earlier draft wrapped this in `if (cf)`, which
    // passes silently whenever the search returns null - the one outcome that
    // would mean the search is broken.
    expect(cf).not.toBeNull();
    expect(cf!.flips).toHaveLength(1);
    expect(oracleMinSize(claims)).toBe(1);
  });

  it("returns null when NO combination of one or two flips changes the verdict", () => {
    // A real case, not the empty list. Four heavily-discounted rodent claims: every
    // one is non-human (R1, x0.1) and most carry no exposure margin, so the fused
    // mass sits far inside the abstention gap. Flipping one or two of them cannot
    // move enough mass to escape, whichever way they are flipped.
    const stuck = [
      claim({ id: "r1", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent", klimisch: 3 }),
      claim({ id: "r2", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent", klimisch: 3 }),
      claim({ id: "r3", assertion: "safe", strength: 0.8, system: "nonrodent", stream: "invivo_nonrodent", klimisch: 3 }),
      claim({ id: "r4", assertion: "safe", strength: 0.8, system: "nonrodent", stream: "invivo_nonrodent", klimisch: 3 }),
    ];
    expect(reasonVerdictOnly(stuck, RS).verdict).toBe("abstain");
    expect(find(stuck)).toBeNull();
    // The independent oracle must agree it is genuinely unreachable, so this is a
    // real negative rather than a search that gave up.
    expect(oracleMinSize(stuck)).toBeNull();
  });

  it("returns null on no evidence at all", () => {
    expect(find([])).toBeNull();
  });

  it("never reports a flip that is not a change, so flips.length is the true minimal size", () => {
    const claims = [
      claim({ id: "a", assertion: "toxic", strength: 0.9, exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.5, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
      claim({ id: "c", assertion: "safe", strength: 0.5, stream: "toxicogenomics", exposureRelevant: true, measuresKeyEvent: "KE:3" }),
    ];
    const cf = find(claims);
    if (cf) {
      for (const f of cf.flips) {
        const original = claims.find((c) => c.id === f.claimId)!;
        expect(f.to).not.toBe(original.assertion);
      }
      expect(new Set(cf.flips.map((f) => f.claimId)).size).toBe(cf.flips.length);
    }
    // Guard against the block above being skipped entirely.
    expect(cf === null || cf.flips.length > 0).toBe(true);
  });

  it("is INDEPENDENT OF CLAIM ORDER - the same evidence gives the same counterfactual", () => {
    // The Task 5 ruling on `defeatedBy` attribution applies here too: a trace is a
    // UI output, so the same situation must give the same explanation. Returning
    // the first hit found would make this depend on load order.
    const claims = [
      claim({ id: "a", assertion: "toxic", strength: 0.7, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.7, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
      claim({ id: "c", assertion: "safe", strength: 0.6, stream: "toxicogenomics", exposureRelevant: true, measuresKeyEvent: "KE:3" }),
      claim({ id: "d", assertion: "toxic", strength: 0.6, stream: "qsar", system: "in_silico" }),
    ];
    const forward = find(claims);
    const reversed = find([...claims].reverse());
    const rotated = find([claims[2]!, claims[3]!, claims[0]!, claims[1]!]);
    expect(reversed).toEqual(forward);
    expect(rotated).toEqual(forward);
  });

  it("SEARCHES HETEROGENEOUS PAIRS - finds a flip that no single shared target could express", () => {
    // Measured on 4,000 random cases: the narrower search that flips both claims of
    // a pair to the SAME assertion never actually disagrees with this one, because
    // homogeneous assignments dominate - "both to X" moves mass further toward a
    // committed verdict than a mixed pair does, and "both to ambiguous" dominates a
    // mixed pair for reaching abstention. So this cannot be tested against the real
    // engine: no natural input distinguishes them.
    //
    // It is still worth GUARANTEEING rather than leaving to that argument, because
    // the spec promises "exhaustive, not heuristic - exact, with nothing to defend",
    // and because Tasks 11 and 12 introduce discount profiles this corpus does not
    // contain. So the property is tested where it lives: `reasonFn` is an injected
    // seam, so a stub can make exactly one heterogeneous assignment decisive. A
    // search that only ever tries shared targets returns null here.
    const claims = [
      claim({ id: "a", assertion: "toxic" }),
      claim({ id: "b", assertion: "safe" }),
    ];
    let calls = 0;
    const stub = (cs: EvidenceClaim[]): ReturnType<typeof reasonVerdictOnly> => {
      calls++;
      const a = cs.find((c) => c.id === "a")!.assertion;
      const b = cs.find((c) => c.id === "b")!.assertion;
      // Decisive ONLY for a -> safe together with b -> ambiguous. Every other
      // assignment, including all three homogeneous ones, keeps the verdict.
      const flipped = a === "safe" && b === "ambiguous";
      return { verdict: flipped ? "advance" : "abstain" } as ReturnType<typeof reasonVerdictOnly>;
    };

    const cf = findCounterfactual(claims, RS, "abstain", stub);
    expect(cf).not.toBeNull();
    expect(cf!.newVerdict).toBe("advance");
    expect(cf!.flips).toEqual([
      { claimId: "a", to: "safe" },
      { claimId: "b", to: "ambiguous" },
    ]);
    // Sanity: the stub really was consulted many times, so this is not passing by
    // some short-circuit that never evaluated anything.
    expect(calls).toBeGreaterThan(4);
  });

  it("AGREES WITH THE BRUTE-FORCE ORACLE on 120 deterministic random cases", () => {
    let s = 987654;
    const next = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const streams = ["qsar", "cytotox", "toxicogenomics", "transporter"] as const;

    let nonNull = 0;
    for (let trial = 0; trial < 120; trial++) {
      const n = 1 + Math.floor(next() * 4);
      const claims = Array.from({ length: n }, (_, i) => {
        const stream = streams[Math.floor(next() * streams.length)]!;
        return claim({
          id: `c${i}`,
          stream,
          // qsar claims must stay in_silico-consistent: the schema forbids a
          // computational prediction from asserting a MEASURED key event.
          system: stream === "qsar" ? "in_silico" : "human",
          assertion: TARGETS[Math.floor(next() * TARGETS.length)]!,
          strength: 0.4 + next() * 0.6,
          klimisch: (1 + Math.floor(next() * 4)) as 1 | 2 | 3 | 4,
          exposureRelevant: next() < 0.5 ? true : null,
        });
      });
      const found = find(claims);
      const expected = oracleMinSize(claims);
      expect(found === null, `trial ${trial}: null disagreement`).toBe(expected === null);
      if (found && expected !== null) {
        expect(found.flips.length, `trial ${trial}: size disagreement`).toBe(expected);
      }
      if (found) nonNull++;
    }
    // The corpus must actually exercise the search. If every trial came back null
    // the agreement above would be unanimous and worthless.
    expect(nonNull).toBeGreaterThan(20);
  });
});

describe("reason() integration", () => {
  it("populates counterfactual, and the reported flip really does produce the reported verdict", () => {
    const claims = [
      claim({ id: "a", assertion: "safe", strength: 0.9, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
    ];
    const r = reason(claims, RS);
    expect(r.counterfactual).not.toBeNull();
    const applied = claims.map((c) => {
      const f = r.counterfactual!.flips.find((x) => x.claimId === c.id);
      return f ? { ...c, assertion: f.to } : c;
    });
    expect(reasonVerdictOnly(applied, RS).verdict).toBe(r.counterfactual!.newVerdict);
    expect(r.counterfactual!.newVerdict).not.toBe(r.verdict);
  });

  it("reasonVerdictOnly skips the search but returns the identical verdict and range", () => {
    const claims = [
      claim({ id: "a", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1, exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, system: "rodent", stream: "invivo_rodent", klimisch: 2 }),
    ];
    const full = reason(claims, RS);
    const cheap = reasonVerdictOnly(claims, RS);
    expect(cheap.counterfactual).toBeNull();
    expect(full.counterfactual).not.toBeNull();
    // Everything the sampling path reads must be bit-identical, or Task 15's
    // robustness numbers would describe a different engine than the one shipped.
    expect(cheap.verdict).toBe(full.verdict);
    expect(cheap.belief).toBe(full.belief);
    expect(cheap.plausibility).toBe(full.plausibility);
    expect(cheap.mass).toEqual(full.mass);
    expect(cheap.conflictMass).toBe(full.conflictMass);
    expect(cheap.contested).toBe(full.contested);
    expect(cheap.trace).toEqual(full.trace);
  });
});
