/**
 * Deterministic serialisation: keys sorted at every level, so a hash depends on
 * content and not on the order a loader happened to produce.
 *
 * A SECOND SPELLING OF apps/harness/src/preregistration.ts, ON PURPOSE, and this is
 * the third time the project has made that trade (interpret.ts and adjudicate.ts
 * record the other two): services/ does not import from apps/, because a service is
 * not downstream of a benchmark harness.
 *
 * The hazard is real and named in apps/web/src/record/chain.ts - "a second
 * canonicalisation is how two hashes of the same thing come to disagree" - so the
 * duplication is held in place by a DRIFT GUARD rather than by discipline:
 * services/api/test/canonical.test.ts hashes a fixture set with both functions and
 * fails if they ever differ. The same shape as the guard in tools/rescore_v2.py.
 *
 * Divergence would be quiet and expensive here. Every deliberation commitment is a
 * hash over a canonicalised position; if the two implementations drifted, positions
 * sealed by one and verified by the other would report tampering that never
 * happened, and the blindness claim would fail in the direction that looks like an
 * attack.
 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${canonicalJson(val)}`).join(",")}}`;
}
