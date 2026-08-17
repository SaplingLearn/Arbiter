import { buildIndex, search } from "./retrieval.js";
import type { Complete } from "./interpret.js";
import type { EvidenceChecklist, Modality } from "./inventory.js";

/**
 * Proposing findings from an uploaded document.
 *
 * THE GAP THIS CLOSES. The product says "open a case, attach the study documents". It
 * then asks a reviewer to read a 250-page multidiscipline review and type the findings in
 * by hand: `addFinding` is called from `FindingsEditor` and nothing else populates the
 * inventory. So the PDF fed retrieval and Ask, and the evidence base every verdict rests
 * on was whatever somebody had the stamina to transcribe. That is the difference between
 * a demo and a tool.
 *
 * IT PROPOSES. IT DOES NOT COMMIT. Nothing here writes a finding. Each proposal is
 * returned for a person to accept, edit or discard, and the accepted one is entered by
 * them through the ordinary route. This is not timidity about model quality - it is the
 * property the whole record rests on. `deliberation.ts` seals positions and attributes
 * them to a named person so the record can prove who committed to what; a finding that
 * appeared because a model read a page has no such person behind it, and an inventory
 * built that way would quietly turn "the panel found" into "the model suggested".
 *
 * ONE CHECKLIST ITEM AT A TIME, not one pass over the whole document. The checklist is
 * the question set the case is judged against, so a proposal that does not answer one of
 * its items has nowhere to go - and asking per item means the retrieval query is built
 * from that item alone: its field text plus its `searchTerms`, which is exactly what the
 * lexical retriever is good at. It also
 * makes an ABSENT item a first-class answer: a model that finds nothing for
 * "Reversibility on withdrawal" says so, and absent evidence is a finding in this product
 * rather than a silence.
 *
 * EVERY PROPOSAL CARRIES A VERBATIM QUOTE AND A PAGE, and is rejected here if it does
 * not. A proposal a reviewer cannot check against the source is worse than no proposal:
 * it costs them the reading they were trying to save and gives them nothing to verify.
 */

export interface FindingProposal {
  /** The checklist item this answers. */
  itemId: string;
  field: string;
  assertion: "toxic" | "safe" | "ambiguous";
  /** One sentence a reviewer can accept as the finding's label. */
  label: string;
  /** The reasoning, in the model's words, for the reviewer to edit. */
  detail: string;
  /** Verbatim from the page. The proposal is rejected without it. */
  quote: string;
  page: number;
  documentId: string;
}

export interface ProposalResult {
  proposals: FindingProposal[];
  /** Items the document does not cover. Absent evidence is a finding here. */
  notFound: { itemId: string; field: string }[];
  /** Proposals the model returned that were DISCARDED, with the reason. Reported rather
   *  than hidden: a reviewer deciding whether to trust this needs the rejection rate. */
  discarded: { itemId: string; reason: string }[];
}

const SYSTEM = [
  "You read one section of a regulatory toxicology review and report whether it contains a specific piece of evidence.",
  "You are proposing a finding for a human reviewer to accept or reject. You are not deciding anything.",
  "Quote VERBATIM from the passages you are given. Never paraphrase inside the quote field.",
  "If the passages do not contain the evidence asked for, say so. Saying nothing is found is a correct and useful answer.",
  "Do not infer, extrapolate, or draw on knowledge of the drug from outside these passages.",
].join("\n");

function schema(pages: number[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["found"],
    properties: {
      found: { type: "boolean" },
      /* `anyOf` rather than a `type` ARRAY. Vertex takes an OpenAPI subset and rejects
         `type: ["string", "null"]` outright - "Unknown name type at
         response_schema.properties[1].value" - which discarded every proposal on the
         first run. adjudicate.ts already uses this form; copied rather than reinvented. */
      assertion: { anyOf: [{ type: "string", enum: ["toxic", "safe", "ambiguous"] }, { type: "null" }] },
      label: { anyOf: [{ type: "string" }, { type: "null" }] },
      detail: { anyOf: [{ type: "string" }, { type: "null" }] },
      quote: { anyOf: [{ type: "string" }, { type: "null" }] },
      // Enum-constrained to the pages actually retrieved, the same guarantee
      // adjudicate.ts uses for finding ids: a citation outside the set is unrepresentable
      // rather than merely discouraged.
      /* A STRING enum, because Vertex only accepts strings there - an integer enum is
         rejected with "Invalid value ... (TYPE_STRING)". Parsed back to a number below,
         so the constraint survives and the field stays a page number. */
      page: { anyOf: [{ type: "string", enum: pages.map(String) }, { type: "null" }] },
    },
  };
}

/** Is the quote really on that page? A verbatim claim is checkable, so it is checked. */
function quoteIsOnPage(quote: string, text: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 .%-]/g, "");
  const q = norm(quote);
  // A short fragment matches too easily to mean anything.
  return q.length >= 25 && norm(text).includes(q);
}

export async function proposeFindings(
  documents: { documentId: string; filename: string; pages: { page: number; text: string }[] }[],
  checklist: EvidenceChecklist,
  modality: Modality,
  complete: Complete,
  perItem = 6,
): Promise<ProposalResult> {
  const index = buildIndex(documents);
  const byPage = new Map<string, string>();
  for (const d of documents) for (const p of d.pages) byPage.set(`${d.documentId}:${p.page}`, p.text);

  const proposals: FindingProposal[] = [];
  const notFound: { itemId: string; field: string }[] = [];
  const discarded: { itemId: string; reason: string }[] = [];

  for (const item of checklist.items) {
    // A dimension that cannot apply to this modality is not missing evidence, and asking
    // for it would invite the model to invent some.
    if (item.appliesTo !== undefined && !item.appliesTo.includes(modality)) continue;

    // THE QUERY IS WIDER THAN THE FIELD, and the field alone was the bug. A checklist
    // field is written for a person reading a checklist: "Projected human daily dose".
    // The document says "the maximum recommended human dose (MRHD) for ADPKD is 120
    // mg/day". The fact is present, the words do not overlap, and a lexical retriever
    // returns nothing - so the item was reported as a gap the document does not have.
    //
    // Measured before this change: four of the six CONSEQUENCE items came back empty on
    // every drug, which empties `consequenceBasis`, which the adjudicator prompt says
    // must produce `cannot_conclude`. Every end-to-end verdict was an abstention caused
    // by vocabulary rather than by evidence.
    //
    // What a proposal must still carry is unchanged - a verbatim quote and a page, judged
    // against the FIELD - so a search term that drags in an irrelevant passage costs a
    // discarded proposal, never a wrong finding.
    //
    // It can still cost a MISSED one, and that direction is not defended. `perItem` is 6,
    // so the added terms compete for six slots: a term that matches strongly somewhere
    // irrelevant can push the correct passage out of the top six, and a passage that never
    // arrives is reported as a gap the document does not have - the same failure this
    // change exists to remove, arriving from the other side. Nothing here measures that.
    // `retrieval-eval.ts` searches with the fixture QUESTION, not with `field +
    // searchTerms`, so the committed hit@16 says nothing about this path either way.
    const query = [item.field, ...(item.searchTerms ?? [])].join(" ");
    const passages = search(index, query, perItem);
    if (passages.length === 0) { notFound.push({ itemId: item.id, field: item.field }); continue; }

    const pages = passages.map((p) => p.page);
    const user = [
      `EVIDENCE SOUGHT: ${item.field}`,
      `WHY IT MATTERS: ${item.whatItBlocks}`,
      "",
      "PASSAGES:",
      ...passages.map((p) => `--- page ${p.page} ---\n${p.text.slice(0, 4000)}`),
    ].join("\n");

    let raw: unknown;
    try {
      raw = await complete(SYSTEM, user, schema(pages));
    } catch (e) {
      discarded.push({ itemId: item.id, reason: e instanceof Error ? e.message : String(e) });
      continue;
    }

    const r = raw as { found?: boolean; assertion?: string | null; label?: string | null;
      detail?: string | null; quote?: string | null; page?: string | number | null };

    if (r.found !== true) { notFound.push({ itemId: item.id, field: item.field }); continue; }
    const page = typeof r.page === "string" ? Number(r.page) : r.page;
    if (typeof r.quote !== "string" || typeof page !== "number" || !Number.isFinite(page)) {
      discarded.push({ itemId: item.id, reason: "claimed a finding with no quote or no page" });
      continue;
    }

    const doc = passages.find((p) => p.page === page)?.documentId ?? documents[0]!.documentId;
    const text = byPage.get(`${doc}:${page}`) ?? "";
    if (!quoteIsOnPage(r.quote, text)) {
      // The one check that cannot be waived. A quote that is not on the page it cites is
      // the exact failure a reviewer is trusting this to not make.
      discarded.push({ itemId: item.id, reason: `quote not found verbatim on page ${page}` });
      continue;
    }

    proposals.push({
      itemId: item.id, field: item.field,
      assertion: (r.assertion === "toxic" || r.assertion === "safe") ? r.assertion : "ambiguous",
      label: r.label ?? item.field,
      detail: r.detail ?? "",
      quote: r.quote, page, documentId: doc,
    });
  }

  return { proposals, notFound, discarded };
}
