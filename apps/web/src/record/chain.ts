import type { EvidenceClaim, Reasoning } from "@arbiter/engine";
import { canonicalJson } from "../../../harness/src/preregistration.js";
import type { ReviewerPosition } from "../state/store.js";

/**
 * A canonical string describing exactly what was on screen when someone signed.
 *
 * Sorted by claim id, so the same evidence produces the same snapshot regardless
 * of load order. Without this binding, "I agree" attaches to nothing and a later
 * data change silently rewrites what a reviewer endorsed.
 *
 * THE CLAIM IS INCLUDED WHOLE. That is the rule here, and it is a reaction to a
 * real defect: an earlier version listed the fields to include - id, assertion,
 * strength - which left every field a rule actually consumes (`system`, `stream`,
 * `measuresKeyEvent`, `exposureRelevant`, `inApplicabilityDomain`, `klimisch`)
 * outside the signature. Reclassifying any of them in a way that did not happen to
 * move the verdict signed as though nothing had changed, and the chain certified
 * evidence it had never seen. An enumeration fails SILENTLY when someone forgets an
 * entry; a whole-object default fails loudly, because dropping a field means
 * deleting code and writing down why.
 *
 * EXCLUSIONS: none. If a future change needs one, the reason belongs right here,
 * and it has to answer this: what makes that field something a reviewer did not
 * endorse? `provenance` was the closest call and is INCLUDED - no rule reads it,
 * but it is rendered beside the claim (Case/EvidencePanel.tsx) and swapping a
 * citation while the numbers hold still is exactly the tamper this function exists
 * to catch. `availableFrom` is included for the same reason: backdating it changes
 * which claims an as-of replay shows.
 *
 * Canonicalised with the harness's `canonicalJson` - keys sorted at every level -
 * rather than bare JSON.stringify, so the digest depends on the claim's content and
 * not on the key order a loader happened to produce. That is the same function the
 * pre-registration hash uses (see data/rulesetHash.ts); a second canonicalisation
 * is how two hashes of "the same thing" come to disagree.
 */
export function evidenceSnapshot(claims: EvidenceClaim[], r: Reasoning): string {
  const sorted = [...claims].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return canonicalJson({
    claims: sorted,
    verdict: r.verdict,
    belief: r.belief,
    plausibility: r.plausibility,
  });
}

/** SHA-256 via Web Crypto. Browser-only; the engine stays free of crypto entirely. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Deterministic serialisation: keys sorted at every level, so the hash depends on
 *  the record's CONTENT and not on the order its fields happened to be written in.
 *  Bare JSON.stringify would make a future field-reordering refactor silently
 *  invalidate every existing chain. */
export function canonicalRecord(r: ReviewerPosition): string {
  const entries = Object.entries(r as unknown as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(entries);
}

/** The hash a following entry chains to. Covers EVERY field, including the previous
 *  entry's own prevRecordHash, which is what makes the chain recursive rather than a
 *  flat re-exposure of the evidence hash. */
export async function recordHash(r: ReviewerPosition): Promise<string> {
  return sha256Hex(canonicalRecord(r));
}
