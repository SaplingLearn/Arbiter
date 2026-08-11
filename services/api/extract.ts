import type { Complete } from "./interpret.js";

/**
 * Document text -> proposed findings. Completion plan Gate 1; redesign spec phase 2.
 *
 * THE STEP THAT MAKES ARBITER UNIVERSAL. A novel compound is in no database, but it
 * has a study report. Everything else in this service reasons over findings that a
 * human typed in by hand; this is what lets a scientist point at a PDF instead.
 *
 * NOTHING HERE IS A CASE YET. The output of this module is a PROPOSAL, and the type
 * says so - `ProposedFinding`, not `Finding`. It becomes evidence only when a human
 * approves it on screen. That is not scaffolding to be removed once extraction gets
 * good: spec §3 rule 1 is "nothing the AI extracts is used before a human approves
 * it", and an extractor that is trusted enough to skip the approval step is one whose
 * misreadings enter the record silently.
 *
 * A MISS AND AN INVENTION ARE NOT SYMMETRIC, and the whole design follows from it.
 * A missed finding is a gap the reviewer sees on the approval screen, with the
 * document open beside it. An invented one is a gap they cannot see, and it destroys
 * the only reason to prefer this to reading the PDF. That asymmetry is why
 * `rules/pass-marks-v1.0.json` sets the hallucination ceiling at ZERO and recall at
 * only 0.85, and why `verifyExtraction` below refuses a finding whose quote is not
 * in the document rather than flagging it for review.
 *
 * THE QUOTE IS THE MECHANISM. Every finding must carry `quote`, a verbatim span from
 * the page it cites. That is checkable by plain code - the same move `verifyAdjudication`
 * makes for citations - so "the model invented a finding" stops being a thing a human
 * has to notice and becomes a thing the server rejects.
 */

export type FindingAssertion = "toxic" | "safe" | "ambiguous";

/** One page of extracted document text. Page numbers are 1-based, as printed. */
export interface DocumentPage {
  page: number;
  text: string;
}

export interface ExtractRequest {
  documentName: string;
  compoundLabel: string;
  /** The twelve checklist questions, so `covers` can only name a registered one. */
  checklist: { id: string; field: string }[];
  pages: DocumentPage[];
}

export interface ProposedFinding {
  id: string;
  label: string;
  assertion: FindingAssertion;
  detail: string;
  /**
   * VERBATIM from `sourcePage`. Not a paraphrase, not a summary - the actual span.
   * This is the field that makes fabrication mechanically detectable, and it is the
   * reason `detail` is allowed to be the model's own words at all.
   */
  quote: string;
  sourcePage: number;
  /**
   * Which checklist questions this finding answers. Declared by the model and
   * CONFIRMED BY A HUMAN at approval, so the declaration carries a signature rather
   * than a heuristic. May be empty: a real finding that answers none of the twelve
   * is ordinary, and forcing a declaration would manufacture coverage.
   */
  covers: string[];
}

export interface Extraction {
  findings: ProposedFinding[];
}

/**
 * Built FROM the request, so `sourcePage` can only name a page that was sent and
 * `covers` can only name a registered checklist id. Same structural guarantee
 * `adjudicationSchema` gets, applied one stage earlier: there is nowhere in the
 * schema to put a page that does not exist.
 */
export function extractionSchema(req: ExtractRequest): Record<string, unknown> {
  const pages = req.pages.map((p) => p.page);
  const checklistIds = req.checklist.map((c) => c.id);

  return {
    type: "object",
    additionalProperties: false,
    required: ["findings"],
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "label", "assertion", "detail", "quote", "sourcePage", "covers"],
          properties: {
            id: { type: "string" },
            label: { type: "string" },
            assertion: { type: "string", enum: ["toxic", "safe", "ambiguous"] },
            detail: { type: "string" },
            quote: { type: "string" },
            sourcePage: pages.length > 0
              ? { type: "integer", enum: pages }
              : { type: "integer" },
            covers: {
              type: "array",
              items: checklistIds.length > 0
                ? { type: "string", enum: checklistIds }
                : { type: "string" },
            },
          },
        },
      },
    },
  };
}

export const EXTRACT_SYSTEM = [
  "You extract findings from a nonclinical study document. This is a READING task, not",
  "a judgement task. You do not decide whether the compound is safe, you do not weigh",
  "evidence against evidence, and you do not recommend anything. A separate system",
  "adjudicates, and a named human signs.",
  "",
  "Report what the document SAYS. For every finding:",
  "  - `quote` must be copied VERBATIM from the page you name. Not paraphrased, not",
  "    tidied, not shortened with ellipses. It is checked against the document by code",
  "    and a finding whose quote is not found is discarded.",
  "  - `detail` may be your own words, but every clause in it must be supported by the",
  "    quote you supplied.",
  "  - `assertion` is what the document reports, not what you conclude: `toxic` if it",
  "    reports injury or a mechanism of injury, `safe` if it reports the absence of one",
  "    under the conditions tested, `ambiguous` if it reports a result that resolves",
  "    neither way.",
  "  - `covers` names the checklist questions this finding ANSWERS. Leave it empty if",
  "    it answers none. Do not stretch a finding to cover a question it does not",
  "    address; a false coverage claim hides a gap, which is the failure this product",
  "    exists to prevent.",
  "",
  "DO NOT report a finding the document does not contain. A missing finding is a gap a",
  "reviewer will see. An invented one is a gap they cannot see. If the document is thin,",
  "return few findings; if it reports no studies, return none. An empty list is a",
  "legitimate and useful answer.",
  "",
  "Never write that a compound is 'safe'. A nonclinical package establishes the absence",
  "of a signal under tested conditions and nothing more.",
];

export function extractUserPrompt(req: ExtractRequest): string {
  const checklist = req.checklist.map((c) => `${c.id}: ${c.field}`).join("\n");
  const pages = req.pages.map((p) => `--- page ${p.page} ---\n${p.text}`).join("\n\n");
  return [
    `Compound: ${req.compoundLabel}`,
    `Document: ${req.documentName}`,
    "",
    "Checklist questions:",
    checklist,
    "",
    "Document pages:",
    pages,
  ].join("\n");
}

export type ExtractionFailureKind =
  | "unknown_page"
  | "quote_not_on_page"
  | "unknown_checklist_id"
  | "duplicate_id"
  | "empty_quote";

export interface ExtractionFailure {
  kind: ExtractionFailureKind;
  findingId: string;
  detail: string;
}

/**
 * Normalise whitespace before comparing a quote to a page.
 *
 * PDF text extraction inserts line breaks mid-sentence, so a model that copies a
 * span faithfully still produces a string that fails an exact match. Comparing on
 * collapsed whitespace is the difference between a check that catches fabrication
 * and one that rejects every honest quote - and a check with a 100% false-positive
 * rate gets deleted within a week.
 *
 * It normalises whitespace and case, and NOTHING ELSE. No stemming, no fuzzy
 * distance, no "close enough" threshold. The moment this tolerates an approximate
 * quote it stops being able to tell a copied span from an invented one.
 */
function normalise(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * The deterministic check between the extractor and the approval screen.
 *
 * Returns the findings that survive AND the failures, rather than throwing on the
 * first problem: one fabricated finding in a set of nine should cost that finding,
 * not the extraction. The failures are reported so the approval screen can say what
 * was discarded, which is itself information about how far the model can be trusted
 * on this document.
 */
export function verifyExtraction(
  extraction: Extraction,
  req: ExtractRequest,
): { findings: ProposedFinding[]; failures: ExtractionFailure[] } {
  const failures: ExtractionFailure[] = [];
  const kept: ProposedFinding[] = [];
  const pageText = new Map(req.pages.map((p) => [p.page, normalise(p.text)]));
  const checklistIds = new Set(req.checklist.map((c) => c.id));
  const seen = new Set<string>();

  for (const f of extraction.findings) {
    if (seen.has(f.id)) {
      failures.push({ kind: "duplicate_id", findingId: f.id, detail: `Finding id "${f.id}" appears more than once.` });
      continue;
    }
    seen.add(f.id);

    const page = pageText.get(f.sourcePage);
    if (page === undefined) {
      failures.push({ kind: "unknown_page", findingId: f.id, detail: `Cites page ${f.sourcePage}, which was not supplied.` });
      continue;
    }

    if (f.quote.trim() === "") {
      // An empty quote is unfalsifiable, so it is treated as the absence of one
      // rather than as a trivially-satisfied check.
      failures.push({ kind: "empty_quote", findingId: f.id, detail: "Supplied no quote, so nothing can be checked against the document." });
      continue;
    }

    if (!page.includes(normalise(f.quote))) {
      failures.push({
        kind: "quote_not_on_page",
        findingId: f.id,
        detail: `Quote is not present on page ${f.sourcePage}: "${f.quote.slice(0, 120)}"`,
      });
      continue;
    }

    const unknown = f.covers.filter((c) => !checklistIds.has(c));
    if (unknown.length > 0) {
      failures.push({
        kind: "unknown_checklist_id",
        findingId: f.id,
        detail: `Claims to cover ${unknown.join(", ")}, which are not registered checklist questions.`,
      });
      continue;
    }

    kept.push(f);
  }

  return { findings: kept, failures };
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export async function handleExtract(
  rawBody: unknown,
  complete: Complete | null,
): Promise<ApiResponse> {
  if (complete === null) return { status: 503, body: { error: "no_key" } };
  if (!isExtractRequest(rawBody)) return { status: 400, body: { error: "bad_request" } };

  try {
    const value = await complete(
      EXTRACT_SYSTEM.join("\n"),
      extractUserPrompt(rawBody),
      extractionSchema(rawBody),
    );
    const { findings, failures } = verifyExtraction(value as Extraction, rawBody);

    // 200 WITH the discards named, rather than 502 on any failure. Unlike an
    // adjudication - which is one answer that is either citable or not - an
    // extraction is a list, and one bad entry in nine is a reason to drop that entry
    // and tell the reviewer, not to throw away eight good ones. The reviewer is
    // about to read this list against the document anyway; what they need is to know
    // what was removed and why.
    return {
      status: 200,
      body: {
        findings,
        discarded: failures,
        awaitingApproval: true,
      },
    };
  } catch {
    return { status: 502, body: { error: "upstream" } };
  }
}

function isExtractRequest(u: unknown): u is ExtractRequest {
  if (typeof u !== "object" || u === null) return false;
  const b = u as Record<string, unknown>;
  if (typeof b["documentName"] !== "string" || typeof b["compoundLabel"] !== "string") return false;
  if (!Array.isArray(b["pages"]) || !Array.isArray(b["checklist"])) return false;
  if ((b["pages"] as unknown[]).length === 0) return false;

  const pagesOk = (b["pages"] as unknown[]).every((p) => {
    const x = p as Record<string, unknown>;
    return typeof x?.["page"] === "number" && Number.isInteger(x["page"]) && typeof x?.["text"] === "string";
  });
  const checklistOk = (b["checklist"] as unknown[]).every((c) => {
    const x = c as Record<string, unknown>;
    return typeof x?.["id"] === "string" && typeof x?.["field"] === "string";
  });
  return pagesOk && checklistOk;
}
