import type { Assertion, Counterfactual, EvidenceClaim, Reasoning, Ruleset, Verdict } from "./types.js";

/** Fixed iteration order, so the canonical tie-break below is reproducible. */
const TARGETS: readonly Assertion[] = ["toxic", "safe", "ambiguous"] as const;

const targetRank = (a: Assertion): number => TARGETS.indexOf(a);

type Flip = { claimId: string; to: Assertion };

/**
 * "What would have to change for this verdict to flip?"
 *
 * EXHAUSTIVE, not heuristic — and exhaustive in the sense the spec promises,
 * which is stronger than it first looks. An earlier draft searched pairs by
 * flipping BOTH claims to the SAME assertion, which is 3 combinations per pair
 * rather than 9, and would have missed any minimal answer of the form "this
 * toxic reading would have to become safe AND that one would have to become
 * ambiguous". The spec's claim is "exact, with nothing to defend", so the search
 * covers every assignment of target assertions to the chosen claims.
 *
 * Cost, with the six-claims-per-compound ceiling: 6x2 = 12 singles, plus 15
 * pairs x (3x3 - the no-op combinations) = at most 120 more. Around 130
 * evaluations of a pure microsecond-scale function per call. (The plan's
 * Task 15 note estimated 21; that was the homogeneous count and is corrected
 * there.) Sampling paths must use the extras-free entry point, which is exactly
 * why `reasonVerdictOnly` exists.
 *
 * A REPORTED PAIR ALWAYS REQUIRES BOTH CLAIMS TO CHANGE. Combinations where
 * either target equals the claim's existing assertion are skipped, because that
 * is a single flip wearing a pair's clothing, and the singles pass has already
 * rejected it.
 *
 * `reasonFn` is injected rather than imported to keep index.ts -> here a one-way
 * dependency.
 */
export function findCounterfactual(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  currentVerdict: Verdict,
  reasonFn: (claims: EvidenceClaim[], ruleset: Ruleset) => Reasoning,
): Counterfactual | null {
  const apply = (flips: Flip[]): EvidenceClaim[] => {
    const byId = new Map(flips.map((f) => [f.claimId, f.to]));
    return claims.map((c) => {
      const to = byId.get(c.id);
      return to === undefined ? c : { ...c, assertion: to };
    });
  };

  /**
   * Every solution of a given size, not just the first.
   *
   * Collecting all of them costs nothing at this scale and buys a property the
   * project already ruled it wants: the same situation must produce the same
   * explanation. Returning the first hit would make the reported counterfactual
   * depend on the order claims happened to load in, which is the defect fixed in
   * `defeatedBy` attribution during Task 5.
   */
  const solutionsOfSize = (size: 1 | 2): { flips: Flip[]; newVerdict: Verdict }[] => {
    const found: { flips: Flip[]; newVerdict: Verdict }[] = [];

    if (size === 1) {
      for (const c of claims) {
        for (const to of TARGETS) {
          if (c.assertion === to) continue;
          const flips: Flip[] = [{ claimId: c.id, to }];
          const v = reasonFn(apply(flips), ruleset).verdict;
          if (v !== currentVerdict) found.push({ flips, newVerdict: v });
        }
      }
      return found;
    }

    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const a = claims[i]!;
        const b = claims[j]!;
        // Two claims sharing an id are one claim; a "pair" over them is a single
        // flip and `apply` would rewrite both anyway.
        if (a.id === b.id) continue;
        for (const toA of TARGETS) {
          if (a.assertion === toA) continue;
          for (const toB of TARGETS) {
            if (b.assertion === toB) continue;
            const flips: Flip[] = [{ claimId: a.id, to: toA }, { claimId: b.id, to: toB }];
            const v = reasonFn(apply(flips), ruleset).verdict;
            if (v !== currentVerdict) found.push({ flips, newVerdict: v });
          }
        }
      }
    }
    return found;
  };

  /**
   * Total order over solutions of equal size: claim ids first (sorted, so the
   * key does not depend on input order), then target assertions in TARGETS
   * order. Deterministic and input-order-independent.
   */
  const key = (s: { flips: Flip[] }): string => {
    const sorted = [...s.flips].sort((x, y) => (x.claimId < y.claimId ? -1 : x.claimId > y.claimId ? 1 : 0));
    // JSON rather than a delimiter-joined string. Claim ids come from external
    // data files, so any printable separator could appear inside an id and make
    // two different solutions collide on one key; JSON quotes and escapes each
    // field, so the encoding is injective without picking a magic character.
    return JSON.stringify(sorted.map((f) => [f.claimId, targetRank(f.to)]));
  };

  for (const size of [1, 2] as const) {
    const found = solutionsOfSize(size);
    if (found.length === 0) continue;
    const best = found.reduce((lo, cand) => (key(cand) < key(lo) ? cand : lo));
    // Report the flips in sorted-id order too, so the output itself is stable
    // rather than merely the choice between candidates.
    const flips = [...best.flips].sort((x, y) => (x.claimId < y.claimId ? -1 : x.claimId > y.claimId ? 1 : 0));
    return { flips, newVerdict: best.newVerdict };
  }

  return null;
}
