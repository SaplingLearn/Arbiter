import type { Position } from "./api.js";

/**
 * What a position actually rests on.
 *
 * ITS OWN MODULE, not part of `screens.tsx`, because the printable record needs it and
 * the public bundle must not contain the authenticated screens. This is a fact about a
 * position, not about any screen that draws one, so the split is along the seam that
 * was already there.
 *
 * Cited outranks external: a position that names a finding IS resting on the case's
 * evidence, whatever else its author also mentioned.
 */
export function basisOf(p: Position): "cited" | "external" | "unsupported" {
  if (p.citedFindingIds.length > 0) return "cited";
  if (p.external.length > 0) return "external";
  return "unsupported";
}
