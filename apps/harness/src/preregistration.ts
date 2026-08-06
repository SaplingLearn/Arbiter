/**
 * The pre-registration surface and its canonicalisation, with NO crypto import.
 *
 * Split out from hash.ts so the browser can use it. hash.ts reaches for
 * node:crypto, which the web bundle cannot pull in, and the alternative was a
 * second copy of the projection in the web app. A second copy is exactly how the
 * hash mismatch in Task 11 happened: the harness loader projected three of the
 * four fields while the test projected all four, so every row in results.json
 * carried a hash matching nothing. One definition, two consumers, different
 * digest implementations - node:crypto here, Web Crypto in the browser.
 */

/**
 * Canonical JSON: object keys sorted at every level, so the digest is stable
 * against formatting - key order, whitespace, nesting reproduced identically.
 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${canonicalJson(val)}`).join(",")}}`;
}

/**
 * The PRE-REGISTRATION SURFACE. The one definition, exported so that every caller
 * hashes the same thing.
 *
 * Excludes `version` and `registeredAt` (metadata, not decisions) and
 * `precedenceRationale` (prose). Includes `precedenceOrder`, which IS a decision:
 * it is the preference ordering a toxicologist edits.
 */
export function projectForHash(rs: {
  rules: unknown;
  abstentionGapThreshold: unknown;
  dilirankBinarisation: unknown;
  precedenceOrder: unknown;
}): Record<string, unknown> {
  return {
    rules: rs.rules,
    abstentionGapThreshold: rs.abstentionGapThreshold,
    dilirankBinarisation: rs.dilirankBinarisation,
    precedenceOrder: rs.precedenceOrder,
  };
}

/**
 * The hash committed at pre-registration (commit d397b59, 2026-07-26).
 *
 * The harness refuses to run when the computed hash differs. Editing the ruleset
 * is allowed - contesting the rules is the product - but it must be a deliberate
 * re-registration, not something that happens silently underneath a results file.
 */
export const PRE_REGISTERED_HASH =
  "ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136";

/**
 * The exposure policy's pre-registration surface.
 *
 * Excludes `version`, `registeredAt` (metadata) and `statement`, `rationale`
 * (prose), mirroring how projectForHash treats the ruleset. Includes
 * `appliesToStreams`, which IS a decision: it says which streams the margin
 * governs, and widening it later would change which claims R3 discounts.
 */
export function projectExposurePolicyForHash(p: {
  marginFactor: unknown;
  basis: unknown;
  appliesToStreams: unknown;
}): Record<string, unknown> {
  return {
    marginFactor: p.marginFactor,
    basis: p.basis,
    appliesToStreams: p.appliesToStreams,
  };
}

/**
 * Registered 2026-08-06, BEFORE the first margin was computed.
 *
 * The margin factor is not a knob to be tried at several values and reported at
 * the best one - that is the same failure as tuning abstentionGapThreshold. The
 * M-sensitivity curve is a disclosure reported beside the headline, never the
 * headline itself.
 */
export const PRE_REGISTERED_EXPOSURE_POLICY_HASH =
  "43f1d1e914feb10c4c9e7da35c45009d34686a34e84b46d9446ea8d5da1979ba";
