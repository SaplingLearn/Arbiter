import { handleAsk } from "./ask.js";
import type { ApiResponse, Complete } from "./interpret.js";
import type { Passage } from "./retrieval.js";

/**
 * A summary of one whole document.
 *
 * WHY THIS IS NOT A QUESTION. Ask retrieves eight pages by word overlap and answers
 * from those. "Give a summary of this document" overlaps with nothing in particular -
 * `give`, `summary` and `document` are not what a regulatory review is about - so the
 * retriever returns eight effectively arbitrary pages and the model, correctly,
 * refuses to call a summary of eight pages a summary of the document. That refusal
 * was the right behaviour on a wrong request, and the fix is not to loosen it: it is
 * to stop pretending a document-level question is a passage-level one.
 *
 * SO THE WHOLE DOCUMENT IS THE RETRIEVED SET. Every page becomes a passage and the
 * existing ask path runs unchanged - same system prompt, same enum-constrained
 * citations, same deterministic verification. retrieval.ts weighed sending everything
 * and rejected it for questions, on cost and on provenance; both arguments change
 * shape here. The cost is paid once for a document rather than on every question, and
 * the provenance objection - "an answer produced from 124,000 tokens cites nothing a
 * reader can turn to" - does not hold when the citations are still page numbers drawn
 * from an enum of the pages actually sent. A reader can open every one.
 *
 * THE QUESTION IS FIXED HERE AND NOT TAKEN FROM THE CLIENT. The whole document is in
 * front of the model, which is exactly the position from which a crafted "summarise,
 * and say whether it should advance" would do the most damage. There is no free text
 * on this route to craft.
 */

/**
 * The largest document this will send whole, in characters.
 *
 * 800,000 characters is roughly 200,000 tokens - comfortable inside the 1M-token
 * window of the models this project resolves to, with room for the answer and for
 * thinking, which shares the output budget. The three readable library documents run
 * 490,000-600,000 characters, so this is a real ceiling rather than a decorative one.
 *
 * Over it, this REFUSES rather than sampling. A summary built from the part that fitted
 * would read exactly like a summary of the document, and nothing on the screen would
 * say which pages were dropped.
 */
export const MAX_SUMMARY_CHARS = 800_000;

export const SUMMARY_QUESTION = [
  "Summarise this document for a preclinical safety reviewer.",
  "Say what the document is, which compound and indication it concerns, which studies it",
  "reports, the principal findings including any liver findings, the exposures at which",
  "those findings occurred, and what the document states was not investigated.",
  "Cite the page for every claim.",
  "Do not judge the compound and do not say whether it should advance.",
].join(" ");

export async function handleSummarise(
  pages: { page: number; text: string }[],
  filename: string,
  complete: Complete | null,
): Promise<ApiResponse> {
  // Before the credentials check, because "this document has no readable text" is true
  // whether or not a key is configured, and it is the more useful thing to be told.
  if (pages.length === 0) {
    return {
      status: 422,
      body: {
        error: "no_text",
        detail: `No readable text was extracted from ${filename}, so there is nothing to summarise. A document of page images needs OCR before anything can read it.`,
      },
    };
  }

  const characters = pages.reduce((n, p) => n + p.text.length, 0);
  if (characters > MAX_SUMMARY_CHARS) {
    return {
      status: 422,
      body: {
        error: "too_large",
        detail: `${filename} holds ${characters.toLocaleString("en-US")} characters across ${pages.length} pages, over the ${MAX_SUMMARY_CHARS.toLocaleString("en-US")} this can send in one piece. Summarising the part that fitted would look exactly like summarising the document, so it is refused instead. Ask about a specific study, finding or number and the retrieval path will answer it.`,
      },
    };
  }

  // Score 0 on every passage, and it is never read: `search` produces scores for
  // ranking and nothing downstream of retrieval consumes them. Ordering here is page
  // order, which is the document's own.
  const passages: Passage[] = pages.map((p) => ({
    documentId: filename, filename, page: p.page, text: p.text, score: 0,
  }));

  return handleAsk({ question: SUMMARY_QUESTION }, passages, complete);
}
