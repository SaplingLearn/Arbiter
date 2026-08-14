/**
 * Retrieval over a case's documents, for the ask surface.
 *
 * WHY RETRIEVAL AND NOT THE WHOLE DOCUMENT. The EMA report already in this project
 * measures 178 pages and 494,931 characters - roughly 124,000 tokens. It fits in a
 * 1M-token context window, so "just send everything" is technically available and was
 * considered. It is rejected for two reasons, and the second is the one that decides
 * it:
 *
 *   1. Cost and latency per question, paid on every question, for content that is
 *      almost entirely irrelevant to any single one.
 *   2. PROVENANCE. Spec section 6.5 makes citation a selection against real objects
 *      rather than free text, precisely so the check can be deterministic. An answer
 *      produced from 124,000 tokens of context cites nothing a reader can turn to.
 *      An answer produced from eight retrieved pages cites eight page numbers, and
 *      `verifyAnswer` can reject a citation outside that set.
 *
 * WHY LEXICAL AND NOT EMBEDDINGS. This is BM25 over page-level chunks, which is
 * retrieval-augmented generation with a deterministic retriever. Embeddings would
 * likely rank better on paraphrase, and are the obvious upgrade - but they add a
 * network call, a cost, a stored vector index to keep in sync with the documents, and
 * a second model deciding what evidence the answering model gets to see. This project
 * puts the inventory in deterministic code for exactly that last reason: "if a model
 * decided what counted as present, a model would be deciding which dissent was
 * admissible" (inventory.ts). The same argument applies to what a question is allowed
 * to retrieve.
 *
 * THAT PARAGRAPH WAS AN ARGUMENT UNTIL 2026-08-13, WHEN IT WAS MEASURED. All 574
 * pages of the three library documents were embedded with gemini-embedding-001 on
 * Vertex and scored on `data/retrieval-eval.json`, against the lexical retriever and
 * fused with it by reciprocal rank fusion:
 *
 *   retriever                  hit@8   recall@8   MRR     stability
 *   BM25 + terms.ts            83.3%   77.8%      0.546   35.9%
 *   dense only                 83.3%   58.3%      0.395   37.3%
 *   hybrid RRF 1:1             83.3%   69.4%      0.628   36.3%
 *   hybrid RRF 2:1 lexical     83.3%   75.0%      0.644   34.2%
 *
 * Not adopted. The best hybrid matches the lexical retriever on the two metrics the
 * contract cares about - whether the answering page reaches the model at all - and
 * buys only ranking WITHIN the eight passages the model reads in full. That is the
 * cheapest thing on the list, and it costs a per-question network call, a vector cache
 * larger than the documents, a credentials dependency, and the determinism that makes
 * section 7.1's flip rate attributable to the model rather than to the retriever.
 *
 * Two honest caveats on that verdict, because it is the kind that gets quoted:
 *
 *   The fixture's gold pages were located by regular expression, which is a lexical
 *   method, and that biases the comparison toward the lexical retriever. A gold set
 *   built by a human reading pages could move these numbers, and it is the single
 *   thing most worth doing before revisiting this.
 *
 *   Dense was crippled by page furniture until it was removed - every page began with
 *   the same header, so cosine scores bunched between 0.70 and 0.74 and each page
 *   looked like the document rather than like itself. Stripping it (pages.ts) took
 *   dense recall from 47.2% to 58.3%. Anyone re-running this must strip first, or they
 *   will measure the header.
 *
 * The retriever being deterministic also means a question asked twice retrieves the
 * same pages twice, so any variation in the answer is the model's - which is the only
 * way section 7.1's consistency claim stays measurable on this surface.
 *
 * WHY THE PAGE IS STILL THE SCORING UNIT - measured 2026-08-13, and the obvious
 * improvement did not survive its own measurement.
 *
 * The argument for sub-page windows is good on paper: a page runs 2,261 characters at
 * the median, the sentence answering a question is one of them, and page-level BM25
 * both dilutes a direct hit and scores two pages identically whether their shared
 * terms sit in one phrase or two thousand characters apart. It was built, scored on
 * `data/retrieval-eval.json`, and swept across four sizes:
 *
 *   unit               hit@8   recall@8   MRR     stability
 *   whole page         83.3%   75.0%      0.546   35.7%
 *   60/30 windows      83.3%   69.4%      0.581   30.1%
 *   120/60 windows     83.3%   66.7%      0.537   31.0%
 *   240/120 windows    77.8%   72.2%      0.583   31.8%
 *   400/200 windows    83.3%   75.0%      0.583   38.1%
 *
 * Every setting that changed anything made recall WORSE, and the one that matched
 * page-level used a window larger than the median page - which is page scoring under
 * another name. Its remaining edge was chosen by reading these eighteen questions,
 * which is fitting the retriever to its own demo, forbidden three lines below for
 * BM25's own constants and no more allowed here.
 *
 * The finding underneath: on a regulatory review, a page densely about a subject is a
 * better signal than a tight local match, because the tight matches are passing
 * mentions on pages about something else. Not retried without new evidence. Untested
 * variants, named so nobody thinks they were ruled out: sum-pooling rather than
 * max-pooling over windows, and page score plus best-window score combined.
 */

export interface DocumentPages {
  documentId: string;
  filename: string;
  pages: { page: number; text: string }[];
}

export interface Passage {
  documentId: string;
  filename: string;
  page: number;
  text: string;
  score: number;
}

interface Chunk {
  documentId: string;
  filename: string;
  page: number;
  text: string;
  terms: Map<string, number>;
  length: number;
}

export interface RetrievalIndex {
  chunks: Chunk[];
  df: Map<string, number>;
  avgLength: number;
}

/**
 * Tokenisation lives in `terms.ts`, applied identically to the query and to the page.
 *
 * It was a lowercase split and a stopword list here, and that was measurably too
 * little: on `data/retrieval-eval.json` the plain form found a page holding the
 * answer for 55.6% of questions, and two phrasings of one question shared 12.9% of
 * their results. Stemming, phrase expansion and a small concept map are the fix, and
 * they must be applied to BOTH sides or the mismatch only moves.
 */
export { normalise as tokenise } from "./terms.js";
import { normalise as tokenise } from "./terms.js";

export function buildIndex(docs: DocumentPages[]): RetrievalIndex {
  const chunks: Chunk[] = [];
  const df = new Map<string, number>();

  for (const d of docs) {
    for (const p of d.pages) {
      const tokens = tokenise(p.text);
      if (tokens.length === 0) continue;
      const terms = new Map<string, number>();
      for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1);
      for (const t of terms.keys()) df.set(t, (df.get(t) ?? 0) + 1);
      chunks.push({
        documentId: d.documentId, filename: d.filename, page: p.page,
        text: p.text, terms, length: tokens.length,
      });
    }
  }

  const avgLength = chunks.length === 0
    ? 0
    : chunks.reduce((n, c) => n + c.length, 0) / chunks.length;

  return { chunks, df, avgLength };
}

// Okapi BM25's usual constants. k1 bounds how much repeating a term can help; b is how
// hard length is normalised. Not tuned, because tuning them against questions we chose
// ourselves would be fitting the retriever to its own demo.
const K1 = 1.5;
const B = 0.75;

export function search(index: RetrievalIndex, question: string, k = 8): Passage[] {
  const n = index.chunks.length;
  if (n === 0) return [];

  const queryTerms = [...new Set(tokenise(question))];
  if (queryTerms.length === 0) return [];

  const scored = index.chunks.map((c) => {
    let score = 0;
    for (const t of queryTerms) {
      const tf = c.terms.get(t);
      if (tf === undefined) continue;
      const dfT = index.df.get(t) ?? 0;
      const idf = Math.log(1 + (n - dfT + 0.5) / (dfT + 0.5));
      const norm = tf + K1 * (1 - B + (B * c.length) / (index.avgLength || 1));
      score += idf * ((tf * (K1 + 1)) / norm);
    }
    return { c, score };
  });

  return scored
    .filter((s) => s.score > 0)
    // Ties broken by document then page, never left to sort stability. The same
    // question must retrieve the same pages in the same order every time, or the
    // consistency of anything built on top of this stops being measurable.
    .sort((a, b) =>
      b.score - a.score
      || (a.c.documentId < b.c.documentId ? -1 : a.c.documentId > b.c.documentId ? 1 : 0)
      || a.c.page - b.c.page)
    .slice(0, k)
    .map((s) => ({
      documentId: s.c.documentId, filename: s.c.filename,
      page: s.c.page, text: s.c.text, score: s.score,
    }));
}
