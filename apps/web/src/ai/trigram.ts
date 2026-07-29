/**
 * Character-trigram Jaccard similarity, shared by rung 3 of both surfaces
 * (spec sections 5.1 and 7.1).
 *
 * Character trigrams rather than word overlap because the inputs are one-sentence
 * objections whose rewordings differ by inflection and contraction more than by
 * vocabulary - "should not" against "shouldn't" shares no word but almost every
 * trigram.
 */

/** Rung 3 accepts a cached entry at or above this similarity. */
export const FUZZY_THRESHOLD = 0.55;

/**
 * Case, punctuation and runs of whitespace are folded away before the window
 * slides, so "100x," and "100x" are one token and a trailing question mark does
 * not cost a match.
 */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function trigrams(s: string): Set<string> {
  // One space of padding either side so the first and last words contribute
  // boundary trigrams. Measured: "rat" against "brat" scores 0.40 padded and 0.50
  // unpadded, because unpadded every trigram of "rat" is also a trigram of "brat".
  const padded = ` ${normalise(s)} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

export function jaccard(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  // An empty or sub-trigram input scores 0 against everything rather than 1.
  // |empty and empty| / |empty or empty| is 0/0; choosing 1 would let an empty
  // challenge box match the first cached entry at rung 3 and propose a rule
  // change out of nothing.
  if (A.size === 0 || B.size === 0) return 0;
  let intersection = 0;
  for (const g of A) if (B.has(g)) intersection++;
  return intersection / (A.size + B.size - intersection);
}
