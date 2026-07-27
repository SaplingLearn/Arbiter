import type { EvidenceClaim } from "./types.js";

/**
 * A compound is in the conflict subset when two DIFFERENT streams commit to
 * opposite conclusions.
 *
 * Stream-level rather than claim-level on purpose: two disagreeing readouts
 * from one assay is measurement noise, whereas a hepatocyte assay disagreeing
 * with a transporter assay is the situation ARBITER exists for. Ambiguous
 * claims never create a conflict - they commit to nothing.
 */
export function detectConflict(claims: EvidenceClaim[]): { conflicting: boolean; opposedStreams: string[] } {
  const committed = claims.filter((c) => c.assertion !== "ambiguous");
  const toxicStreams = new Set(committed.filter((c) => c.assertion === "toxic").map((c) => c.stream));
  const safeStreams = new Set(committed.filter((c) => c.assertion === "safe").map((c) => c.stream));

  const opposed: string[] = [];
  for (const s of toxicStreams) if (!safeStreams.has(s)) opposed.push(s);
  for (const s of safeStreams) if (!toxicStreams.has(s)) opposed.push(s);

  const conflicting = toxicStreams.size > 0 && safeStreams.size > 0 && opposed.length >= 2;
  return { conflicting, opposedStreams: conflicting ? opposed.sort() : [] };
}
