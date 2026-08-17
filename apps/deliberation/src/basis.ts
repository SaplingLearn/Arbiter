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
 *
 * DELIBERATELY DUPLICATED, not imported, from `positionBasis` in
 * `services/api/deliberation.ts`. The client already holds the position it is about to
 * label - a participant's own submission, or a revealed panel - and round-tripping to
 * the server to ask what it already has would be a network call standing in for an
 * if-statement. The cost of the duplication is that the two must not be allowed to
 * drift: `basis.test.ts` asserts this function against `positionBasis` directly, so a
 * future edit to either one's branching breaks a test rather than silently forking the
 * label a position gets depending on which side computed it.
 */
export function basisOf(p: Position): "cited" | "external" | "unsupported" {
  if (p.citedFindingIds.length > 0) return "cited";
  if (p.external.length > 0) return "external";
  return "unsupported";
}
