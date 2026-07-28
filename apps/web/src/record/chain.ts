import type { EvidenceClaim, Reasoning } from "@arbiter/engine";
import type { ReviewerPosition } from "../state/store.js";

/**
 * A canonical string describing exactly what was on screen when someone signed.
 *
 * Sorted by claim id, so the same evidence produces the same snapshot regardless
 * of load order. Without this binding, "I agree" attaches to nothing and a later
 * data change silently rewrites what a reviewer endorsed.
 */
export function evidenceSnapshot(claims: EvidenceClaim[], r: Reasoning): string {
  const sorted = [...claims].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify({
    claims: sorted.map((c) => [c.id, c.assertion, c.strength]),
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
