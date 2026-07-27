import type { Assertion } from "./types.js";

/**
 * Mass over the frame Theta = {toxic, safe}.
 *
 * `uncommitted` is mass on Theta itself: what this source genuinely cannot
 * tell you. It is NOT a hedge and NOT half a vote for each side. This is the
 * whole reason fusion beats averaging.
 */
export interface Mass {
  toxic: number;
  safe: number;
  uncommitted: number;
}

/** A source that says nothing. Contributes m(Theta) = 1, never a vote for safe. */
export const VACUOUS: Mass = { toxic: 0, safe: 0, uncommitted: 1 };

export function claimToMass(assertion: Assertion, strength: number): Mass {
  const s = Math.max(0, Math.min(1, strength));
  if (assertion === "ambiguous") return { ...VACUOUS };
  if (assertion === "toxic") return { toxic: s, safe: 0, uncommitted: 1 - s };
  return { toxic: 0, safe: s, uncommitted: 1 - s };
}

/**
 * Dempster's rule of combination.
 *
 * Returns the normalised combined mass plus the conflict mass K that was
 * normalised out. We return K rather than swallowing it: a high K means the
 * sources genuinely disagree, which is information a safety lead needs.
 */
export function combine(a: Mass, b: Mass): { mass: Mass; conflict: number } {
  const toxic = a.toxic * b.toxic + a.toxic * b.uncommitted + a.uncommitted * b.toxic;
  const safe = a.safe * b.safe + a.safe * b.uncommitted + a.uncommitted * b.safe;
  const uncommitted = a.uncommitted * b.uncommitted;
  const conflict = a.toxic * b.safe + a.safe * b.toxic;

  const norm = 1 - conflict;
  if (norm <= Number.EPSILON) {
    // Total conflict: Dempster's rule is undefined. Return the vacuous mass,
    // which is the honest answer - we know nothing - and report K = 1 so the
    // caller can abstain rather than fabricate a verdict.
    return { mass: { ...VACUOUS }, conflict: 1 };
  }
  return { mass: { toxic: toxic / norm, safe: safe / norm, uncommitted: uncommitted / norm }, conflict };
}

/**
 * Fuse many masses. belief(toxic) = m({toxic}); plausibility(toxic) =
 * m({toxic}) + m(Theta). The gap between them is what ARBITER does not know.
 *
 * conflictMass is the cumulative conflict removed across all combination steps:
 * 1 - ∏(1 - Kᵢ), where Kᵢ is the conflict at step i. This is the honest
 * aggregate: because each step normalises by (1 - Kᵢ), multiplying the survival
 * factors gives the total survival probability, and 1 minus that is the true
 * conflict removed. It is strictly >= max(Kᵢ) and equals max only when at most
 * one step has nonzero conflict.
 */
export function fuse(masses: Mass[]): { belief: number; plausibility: number; conflictMass: number } {
  let acc: Mass = { ...VACUOUS };
  let survival = 1;
  for (const m of masses) {
    const { mass, conflict } = combine(acc, m);
    acc = mass;
    survival *= 1 - conflict;
  }
  return { belief: acc.toxic, plausibility: acc.toxic + acc.uncommitted, conflictMass: 1 - survival };
}
