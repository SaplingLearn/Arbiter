import { createHash } from "node:crypto";

/**
 * SHA-256 of the pre-registration surface of a ruleset.
 *
 * Hashes only the fields a toxicologist pre-registers - rules, thresholds,
 * binarisation policy - with object keys sorted, so the hash is stable
 * against JSON formatting and against fields we add later for display.
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
