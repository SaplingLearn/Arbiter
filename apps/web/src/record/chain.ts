import type { EvidenceClaim, Reasoning } from "@arbiter/engine";

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
