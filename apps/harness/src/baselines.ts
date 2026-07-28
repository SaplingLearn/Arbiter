import type { EvidenceClaim, Stream, Verdict } from "@arbiter/engine";

export interface Prediction {
  verdict: Verdict;
  /** Toxicity leaning in [0,1]; 0.5 means undecided. For ranking and calibration plots. */
  score: number;
}

const ABSTAIN: Prediction = { verdict: "abstain", score: 0.5 };

/**
 * Baseline 1: majority vote.
 *
 * The naive aggregation the mentor named. It has NOWHERE TO PUT "I do not know" -
 * an ambiguous claim simply is not a toxic vote, so silence leans safe. That is the
 * flaw Dempster-Shafer exists to avoid, and there is a test asserting this baseline
 * exhibits it. We are not strawmanning it; we are showing its actual behaviour.
 */
export function majorityVote(claims: EvidenceClaim[]): Prediction {
  if (claims.length === 0) return ABSTAIN;
  const toxic = claims.filter((c) => c.assertion === "toxic").length;
  const safe = claims.filter((c) => c.assertion === "safe").length;
  if (toxic === 0 && safe === 0) return ABSTAIN;
  if (toxic === safe) return ABSTAIN;
  const total = toxic + safe;
  return toxic > safe
    ? { verdict: "do_not_advance", score: toxic / total }
    : { verdict: "advance", score: toxic / total };
}

/**
 * Baseline 2: confidence-weighted average.
 *
 * Included because majority vote is not actually *averaging*, and averaging is what
 * the pitch claims to beat. An ambiguous claim contributes zero numerator and a
 * non-zero denominator, i.e. it is treated as a zero-strength safe vote - the
 * precise error the spec's one-liner names.
 */
export function weightedAverage(claims: EvidenceClaim[]): Prediction {
  if (claims.length === 0) return ABSTAIN;
  // `committed` means what it says: a claim that actually took a side. An earlier
  // draft wrote `c.assertion !== "ambiguous" || c.strength === 0`, which is true for
  // every ambiguous claim in the corpus (they all carry strength 0) and therefore
  // never excluded anything - the guard below could not fire.
  const committed = claims.filter((c) => c.assertion !== "ambiguous");
  if (committed.length === 0) return ABSTAIN;

  const denom = claims.reduce((s, c) => s + Math.max(c.strength, 0.0001), 0);
  const numer = claims.reduce((s, c) => s + (c.assertion === "toxic" ? Math.max(c.strength, 0.0001) : 0), 0);
  if (denom === 0) return ABSTAIN;
  const score = numer / denom;
  if (Math.abs(score - 0.5) < 1e-12) return ABSTAIN;
  return { verdict: score > 0.5 ? "do_not_advance" : "advance", score };
}

/**
 * Baseline 3: best single source.
 *
 * The unflattering bar, included precisely because it is unflattering: if one
 * predictor alone matches the whole system, the complexity is not earning its
 * place. The harness runs this once per stream and Task 15 reports the strongest.
 */
export function bestSingleSource(claims: EvidenceClaim[], stream: Stream): Prediction {
  const own = claims.filter((c) => c.stream === stream && c.assertion !== "ambiguous");
  if (own.length === 0) return ABSTAIN;
  const strongest = own.reduce((a, b) => (b.strength > a.strength ? b : a));
  return strongest.assertion === "toxic"
    ? { verdict: "do_not_advance", score: strongest.strength }
    : { verdict: "advance", score: 1 - strongest.strength };
}

export const ALL_STREAMS: Stream[] = [
  "qsar", "cytotox", "toxicogenomics", "transporter", "invivo_rodent", "invivo_nonrodent",
];
