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
