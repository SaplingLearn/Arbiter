import type { ApiResponse, Complete } from "./interpret.js";
import type { Passage } from "./retrieval.js";

/**
 * POST /api/cases/{id}/ask - a question about the case documents.
 *
 * WHAT THIS SURFACE IS, AND THE LINE IT MUST NOT CROSS. Spec section 3.1 divides the
 * world into facts, which may be published before anybody states a position, and
 * conclusions, which may not - because "an AI verdict published before the humans
 * answer destroys the independent signal that makes collecting their positions worth
 * anything at all". A question-answering surface over the documents sits on the facts
 * side by construction: "what exposure margin does the report state" is arithmetic on
 * the folder. "Should this advance" is not, and the system prompt refuses it.
 *
 * THAT REFUSAL IS PROMPT-ENFORCED, NOT STRUCTURAL, and saying so is the point. The
 * citation check below is deterministic; the facts/conclusions line is not, because no
 * schema can tell a description of a finding from a judgement about it. A model that
 * decided to answer "should this advance" anyway would be caught by a reader, not by
 * this file. That is a real weakness and the honest mitigation is that this surface
 * writes NOTHING: no position, no adjudication, no log entry, nothing into the hash
 * chain. Spec section 10 rule 4 keeps models away from the record, and an answer here
 * is a reading aid, never evidence.
 *
 * WHAT IS STRUCTURAL. Citations are enum-constrained to the passages actually
 * retrieved, so there is nowhere to cite a page that was not read - the same guarantee
 * interpret.ts describes as "there is nowhere to put an invented rule". And
 * `answerable` is a required field, so "the documents do not say" is a first-class
 * answer rather than something a model has to be brave enough to volunteer. Spec
 * section 3.2's rule that absence is a finding applies to a question as much as to a
 * checklist.
 */

export interface AskRequest {
  question: string;
  /** Earlier turns, oldest first. Context for reading the QUESTION, never evidence. */
  history?: HistoryTurn[];
}

export interface HistoryTurn {
  question: string;
  answer: string;
}

/**
 * How much of a conversation travels with a question.
 *
 * A CHARACTER BUDGET, NOT A TURN COUNT. An earlier version kept the last four turns,
 * which measures the wrong quantity: a turn here runs from "and the dog?" to a
 * paragraph quoting three studies, so four of them is somewhere between 60 characters
 * and 6000. What the limit is actually protecting is context spent on the PASSAGES -
 * the only thing an answer may rest on - so the limit is denominated in the same unit
 * the passages cost. Eight pages of a study PDF run 20-30k characters, and 6000 buys a
 * long thread's worth of pronouns against that.
 *
 * The turn cap is a second, independent bound. It stops a hundred one-word exchanges
 * from filling the window with material that resolves nothing, and it is what the
 * request limit below is a multiple of.
 */
export const HISTORY_BUDGET_CHARS = 6000;
export const HISTORY_MAX_TURNS = 20;

/**
 * The longest transcript a request may CARRY, as opposed to the longest one that is
 * READ. Five times the window: comfortably more than anything the window will use, and
 * still a bound on the body an unauthenticated shape check has to walk.
 */
export const HISTORY_REQUEST_LIMIT = HISTORY_MAX_TURNS * 5;

/** What one turn costs, counted as the prompt actually renders it. */
function turnChars(t: HistoryTurn): number {
  return `Q: ${t.question}\nA: ${t.answer}`.length;
}

/**
 * The turns a question is sent with, oldest first.
 *
 * Walks from the newest backwards, because a follow-up refers to what was just said.
 * The most recent turn is kept unconditionally - a single long answer would otherwise
 * empty the window and leave "what about the second one" pointing at nothing, which is
 * precisely the failure history exists to prevent.
 */
export function historyWindow(history: HistoryTurn[]): HistoryTurn[] {
  const kept: HistoryTurn[] = [];
  let chars = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i]!;
    const next = chars + turnChars(t);
    if (kept.length > 0 && (next > HISTORY_BUDGET_CHARS || kept.length >= HISTORY_MAX_TURNS)) break;
    kept.push(t);
    chars = next;
  }
  return kept.reverse();
}

export interface Answer {
  /** False when the retrieved passages do not contain the answer. */
  answerable: boolean;
  answer: string;
  /** 1-based indices into the passages the caller retrieved and sent. */
  citedPassages: string[];
}

export interface AnswerFailure {
  kind: "unknown_passage" | "answer_without_citation" | "empty_answer";
  detail: string;
}

export const SYSTEM = [
  "You answer questions about a set of study documents for one compound, using ONLY the",
  "numbered passages given to you. Each passage is one page of one document.",
  "",
  "CITE EVERY CLAIM. `citedPassages` names the passage numbers your answer rests on. A",
  "statement you cannot attach to a passage does not belong in the answer. You may not",
  "describe a study, a number or a finding that is not in the passages, and you may not",
  "fill a gap from general knowledge of the drug or the drug class.",
  "",
  "'THE DOCUMENTS DO NOT SAY' IS A REAL ANSWER AND OFTEN THE RIGHT ONE. Set `answerable`",
  "to false when the passages do not contain what was asked, say what is missing, and",
  "stop. Do not reason toward a likely answer. A confident answer built from an adjacent",
  "passage is the worst output you can produce here, because the reader cannot tell it",
  "from a supported one.",
  "",
  "REPORT WHAT THE DOCUMENTS SAY. NEVER GIVE A VERDICT. You are not deciding whether the",
  "compound is safe, whether a finding is severe, or whether the programme should",
  "advance. Those are the panel's to state and the adjudication's to weigh, and answering",
  "them here would put a conclusion in front of people who have not yet given their own.",
  "If asked one, say that it is not a question about the documents, and report what the",
  "documents do contain on the subject.",
  "",
  "EARLIER TURNS ARE NOT EVIDENCE. Anything under EARLIER IN THIS CONVERSATION is there",
  "so you can tell what the question refers to. You may not cite it and you may not",
  "treat a previous answer as established - if a claim is not in the passages below, it",
  "is not supported, however confidently it was said a moment ago.",
  "",
  "NEVER CALL A COMPOUND SAFE. A study establishes the absence of a signal under the",
  "conditions tested and nothing more.",
].join("\n");

export function answerSchema(passages: Passage[]): Record<string, unknown> {
  const ids = passages.map((_, i) => String(i + 1));
  return {
    type: "object",
    additionalProperties: false,
    required: ["answerable", "answer", "citedPassages"],
    properties: {
      answerable: { type: "boolean" },
      answer: { type: "string" },
      citedPassages: {
        type: "array",
        // Built FROM THE RETRIEVED SET. Same empty-case fallback as the other schemas
        // in this project: with nothing retrieved the only legal answer is unanswerable
        // with no citations, and an empty enum is not portable across validators.
        items: ids.length > 0 ? { type: "string", enum: ids } : { type: "string" },
      },
    },
  };
}

export function userPrompt(
  question: string,
  passages: Passage[],
  history: HistoryTurn[] = [],
): string {
  const body = passages.length === 0
    ? "(no passages matched this question)"
    : passages
      .map((p, i) => `[${i + 1}] ${p.filename}, page ${p.page}\n${p.text.trim()}`)
      .join("\n\n---\n\n");
  // History is sent so a follow-up like "what about the second one" resolves to
  // something. It is labelled as conversation rather than evidence, and the system
  // prompt forbids citing it: an earlier answer is not a document, and a claim resting
  // on one would be traceable to nothing a reader can open.
  //
  // Windowed by `historyWindow`, and the SAME call decides what handleAsk reports as
  // `historyTurnsUsed`. Two independent truncations - one for the prompt, one for the
  // screen - would eventually disagree, and the screen would be claiming the model
  // remembers a turn it was never sent.
  const kept = historyWindow(history);
  const earlier = kept.length === 0
    ? []
    : [
        "EARLIER IN THIS CONVERSATION (context for reading the question; NOT evidence, and not citable):",
        ...kept.map((t) => `Q: ${t.question}\nA: ${t.answer}`),
        "",
      ];
  return [...earlier, `QUESTION:\n${question}`, "", "PASSAGES:", body].join("\n");
}

/**
 * The deterministic check between the model and the screen, as everywhere else here.
 * It verifies GROUNDING, not truth: a passage number that was retrieved, cited for a
 * claim that passage does not support, is not catchable by code and is why the answer
 * renders its citations for the reader to open.
 */
export function verifyAnswer(a: Answer, passages: Passage[]): AnswerFailure[] {
  const failures: AnswerFailure[] = [];
  const known = new Set(passages.map((_, i) => String(i + 1)));

  for (const c of a.citedPassages ?? []) {
    if (!known.has(c)) {
      failures.push({
        kind: "unknown_passage",
        detail: `The answer cites passage ${c}, which is not among the ${passages.length} passages retrieved for this question.`,
      });
    }
  }

  if (a.answerable && a.answer.trim() === "") {
    failures.push({ kind: "empty_answer", detail: "Marked answerable with no answer." });
  }

  // An answerable answer with no citation is the failure mode this surface exists to
  // prevent: fluent, plausible, and traceable to nothing.
  if (a.answerable && (a.citedPassages ?? []).length === 0) {
    failures.push({
      kind: "answer_without_citation",
      detail: "The answer claims to be supported by the documents and cites no passage. Every claim here names the page it rests on.",
    });
  }

  return failures;
}

export function isAskRequest(u: unknown): u is AskRequest {
  if (typeof u !== "object" || u === null) return false;
  const b = u as Record<string, unknown>;
  if (typeof b["question"] !== "string" || b["question"].trim() === "") return false;
  const h = b["history"];
  if (h === undefined) return true;
  // Checked to the element, not just to the array. While a thread was four turns typed
  // into one screen, a malformed entry could only produce `Q: undefined` in a prompt;
  // now that the client sends the whole transcript, the shape is worth stating and an
  // over-long body is worth refusing outright rather than silently cutting to fit.
  if (!Array.isArray(h) || h.length > HISTORY_REQUEST_LIMIT) return false;
  return h.every((t) =>
    typeof t === "object" && t !== null
    && typeof (t as Record<string, unknown>)["question"] === "string"
    && typeof (t as Record<string, unknown>)["answer"] === "string");
}

export async function handleAsk(
  rawBody: unknown,
  passages: Passage[],
  complete: Complete | null,
): Promise<ApiResponse> {
  if (complete === null) return { status: 503, body: { error: "no_key" } };
  if (!isAskRequest(rawBody)) return { status: 400, body: { error: "bad_request" } };

  // Nothing retrieved is answered HERE, without spending a token. The model has no
  // passages, so its only legal output is the one this returns, and asking it to
  // produce that is a round trip bought for nothing.
  if (passages.length === 0) {
    return {
      status: 200,
      body: {
        answerable: false,
        answer: "Nothing in the uploaded documents matches that question. Either the documents do not cover it, or the question shares no words with the pages that do - try naming the study, the finding or the number you are looking for.",
        citedPassages: [],
        citations: [],
        // Zero, and not the window's size: no model ran, so nothing was read at all.
        historyTurnsUsed: 0,
      },
    };
  }

  const history = rawBody.history ?? [];

  try {
    const value = await complete(SYSTEM, userPrompt(rawBody.question, passages, history), answerSchema(passages));
    const answer = value as Answer;
    const failures = verifyAnswer(answer, passages);
    if (failures.length > 0) return { status: 502, body: { error: "unverified", failures } };

    // Passage numbers are how the MODEL cites; a reader needs the document and page.
    // Resolved here so the client never has to reconstruct provenance itself.
    const citations = answer.citedPassages.map((c) => {
      const p = passages[Number(c) - 1]!;
      return { documentId: p.documentId, filename: p.filename, page: p.page };
    });
    // How much of the thread was in front of the model. The client draws its "remembers
    // from here" line from this and nothing else: the truncation happened here, so the
    // count is stated here rather than inferred from a rule the client keeps a copy of.
    return { status: 200, body: { ...answer, citations, historyTurnsUsed: historyWindow(history).length } };
  } catch {
    return { status: 502, body: { error: "upstream" } };
  }
}
