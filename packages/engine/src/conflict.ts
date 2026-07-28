import type { EvidenceClaim } from "./types.js";

/**
 * A compound is in the conflict subset when two DIFFERENT streams commit to
 * opposite conclusions.
 *
 * Stream-level rather than claim-level on purpose: two disagreeing readouts
 * from one assay is measurement noise, whereas a hepatocyte assay disagreeing
 * with a transporter assay is the situation ARBITER exists for. Ambiguous
 * claims never create a conflict - they commit to nothing.
 *
 * The predicate is existential: SOME toxic-committed stream differs from SOME
 * safe-committed stream. A stream that disagrees with itself is not excluded
 * from the comparison - it just cannot supply both halves of the pair. So a
 * cytotox assay split against itself PLUS a transporter assay reading safe is a
 * genuine cross-stream conflict, while the split cytotox assay alone is not.
 */
export function detectConflict(claims: EvidenceClaim[]): { conflicting: boolean; opposedStreams: string[] } {
  const committed = claims.filter((c) => c.assertion !== "ambiguous");
  const toxicStreams = new Set(committed.filter((c) => c.assertion === "toxic").map((c) => c.stream));
  const safeStreams = new Set(committed.filter((c) => c.assertion === "safe").map((c) => c.stream));

  // Exists t in toxicStreams, s in safeStreams with t !== s. This fails only
  // when every toxic stream equals every safe stream, i.e. both sides are the
  // same lone stream - the measurement-noise case.
  let conflicting = false;
  for (const t of toxicStreams) {
    for (const s of safeStreams) {
      if (t !== s) { conflicting = true; break; }
    }
    if (conflicting) break;
  }

  // Every stream committing on either side is party to the disagreement,
  // including one that straddles both.
  const opposed = conflicting ? [...new Set([...toxicStreams, ...safeStreams])].sort() : [];
  return { conflicting, opposedStreams: opposed };
}
