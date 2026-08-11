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
 * The retriever being deterministic also means a question asked twice retrieves the
 * same pages twice, so any variation in the answer is the model's - which is the only
 * way section 7.1's consistency claim stays measurable on this surface.
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
 * Words carried by nearly every page of a regulatory document, which therefore
 * separate nothing. Kept deliberately SHORT: an aggressive list silently removes
 * terms that are discriminating in this domain, and BM25's idf already suppresses
 * common words on its own. This is a floor for the obvious, not a substitute for it.
 */
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "at", "by", "with",
  "is", "was", "were", "are", "be", "been", "that", "this", "these", "those", "it",
  "as", "from", "has", "have", "had", "not", "no", "any", "all", "which", "than",
  "there", "their", "they", "we", "its", "if", "but", "can", "may", "will", "would",
  "what", "does", "do", "did", "how", "when", "where", "who", "why",
]);

/**
 * Lowercase, split on anything that is not a letter or digit, drop stopwords and
 * one-character tokens.
 *
 * NUMBERS ARE KEPT, and that is not incidental. "NOAEL 100 mg/kg", "44x", "6.7x" and
 * a page's exposure margins are exactly what somebody asks about, and a tokeniser
 * that discarded digits would make the most citable facts in the document the least
 * findable.
 */
export function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

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
