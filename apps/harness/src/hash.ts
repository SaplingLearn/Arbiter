import { createHash } from "node:crypto";

/**
 * SHA-256 of whatever value is passed in, canonicalised with object keys
 * sorted so the hash is stable against JSON formatting (key order,
 * whitespace, array-vs-object nesting reproduced identically).
 *
 * This function does not decide what "the ruleset" is for pre-registration
 * purposes - it hashes exactly the value it is handed, nothing more or
 * less. Callers must project the pre-registration surface themselves
 * (rules, abstentionGapThreshold, dilirankBinarisation, precedenceOrder)
 * and pass only that object, so the hash answers "did the pre-registered
 * decision surface change" and not "did some unrelated display field change".
 */
export function rulesetHash(ruleset: unknown): string {
  return createHash("sha256").update(canonical(ruleset)).digest("hex");
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`).join(",")}}`;
}

/**
 * The PRE-REGISTRATION SURFACE. The one definition, exported so that every caller
 * hashes the same thing.
 *
 * It exists because it was duplicated: the test carried its own copy including
 * `precedenceOrder`, while the harness loader projected only three of the four
 * fields. The loader would then have stamped every result in results.json with a
 * hash that does not match the pre-registered one, and the audit trail - the whole
 * point of the exercise - would have quietly pointed at nothing.
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
