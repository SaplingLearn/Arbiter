import { describe, expect, it, vi } from "vitest";
import {
  answerSchema,
  handleAsk,
  HISTORY_BUDGET_CHARS,
  HISTORY_MAX_TURNS,
  HISTORY_REQUEST_LIMIT,
  historyWindow,
  isAskRequest,
  userPrompt,
  verifyAnswer,
  type Answer,
} from "../ask.js";
import type { Passage } from "../retrieval.js";

const PASSAGES: Passage[] = [
  { documentId: "doc_a", filename: "ema.pdf", page: 36, text: "Exposure margins of 24 to 71 times for AUC.", score: 9 },
  { documentId: "doc_a", filename: "ema.pdf", page: 40, text: "The NOAEL was set at 306 mg/kg.", score: 7 },
];

const VALID: Answer = { answerable: true, answer: "Margins are 24-71x for AUC.", citedPassages: ["1"] };

describe("answerSchema", () => {
  it("constrains citations to the passages actually retrieved", () => {
    // The same structural guarantee the rest of this project relies on: there is
    // nowhere in the schema to cite a page that was never read.
    const s = answerSchema(PASSAGES) as any;
    expect(s.properties.citedPassages.items.enum).toEqual(["1", "2"]);
  });

  it("stays satisfiable when nothing was retrieved", () => {
    // An empty enum is unsatisfiable and would fail the whole request rather than one
    // field, so the empty case falls back - and handleAsk never calls a model there.
    const s = answerSchema([]) as any;
    expect(s.properties.citedPassages.items).toEqual({ type: "string" });
  });
});

describe("userPrompt", () => {
  it("numbers passages and names the page, so a citation resolves to something openable", () => {
    const p = userPrompt("what margin?", PASSAGES);
    expect(p).toContain("[1] ema.pdf, page 36");
    expect(p).toContain("[2] ema.pdf, page 40");
  });

  it("carries only the turns the window kept", () => {
    // The prompt and the reported boundary have to be the same set, or the divider on
    // screen tells the reader the model remembers something it was never sent.
    const history = turns(30, 400);
    const p = userPrompt("and the dog?", PASSAGES, history);
    const kept = historyWindow(history);
    expect(p).toContain(kept[0]!.question);
    expect(p).not.toContain(history[0]!.question);
  });
});

/**
 * A turn whose rendered `Q: ...\nA: ...` line is `size` characters, so a budget test
 * states the arithmetic it is checking instead of guessing at string lengths.
 */
function turn(i: number, size: number): { question: string; answer: string } {
  const question = `q${i}`;
  const overhead = `Q: ${question}\nA: `.length;
  return { question, answer: "a".repeat(Math.max(1, size - overhead)) };
}

function turns(n: number, size: number): { question: string; answer: string }[] {
  return Array.from({ length: n }, (_, i) => turn(i, size));
}

describe("historyWindow", () => {
  it("keeps a short conversation whole", () => {
    const history = turns(6, 200);
    expect(historyWindow(history)).toEqual(history);
  });

  it("keeps the newest turns and drops the oldest when the budget runs out", () => {
    // Budget-shaped, not count-shaped: a turn is worth what it costs in context, and
    // turns here run from a line to a page.
    const history = turns(40, 1000);
    const kept = historyWindow(history);
    const chars = kept.reduce((n, t) => n + `Q: ${t.question}\nA: ${t.answer}`.length, 0);
    expect(chars).toBeLessThanOrEqual(HISTORY_BUDGET_CHARS);
    expect(kept.at(-1)).toEqual(history.at(-1));
    expect(kept).not.toContain(history[0]);
  });

  it("returns turns oldest first, as the prompt reads them", () => {
    const history = turns(5, 200);
    expect(historyWindow(history).map((t) => t.question)).toEqual(["q0", "q1", "q2", "q3", "q4"]);
  });

  it("keeps the most recent turn even when it alone blows the budget", () => {
    // Otherwise a long answer silently empties the window and the follow-up that
    // depends on it - "what about the second one" - resolves to nothing at all.
    const huge = turn(0, HISTORY_BUDGET_CHARS * 3);
    expect(historyWindow([huge])).toEqual([huge]);
  });

  it("stops at the turn cap even when every turn is tiny", () => {
    const kept = historyWindow(turns(200, 10));
    expect(kept).toHaveLength(HISTORY_MAX_TURNS);
  });

  it("treats no history as no history", () => {
    expect(historyWindow([])).toEqual([]);
  });
});

describe("isAskRequest", () => {
  it("accepts a well-formed thread", () => {
    expect(isAskRequest({ question: "x", history: [{ question: "a", answer: "b" }] })).toBe(true);
  });

  it("rejects history entries that are not question-and-answer strings", () => {
    // Harmless while a thread was four turns long and typed by one screen; not once
    // the client sends the whole transcript.
    expect(isAskRequest({ question: "x", history: [{ question: "a" }] })).toBe(false);
    expect(isAskRequest({ question: "x", history: ["a"] })).toBe(false);
  });

  it("rejects a transcript past the cap rather than quietly truncating it", () => {
    expect(isAskRequest({ question: "x", history: turns(HISTORY_REQUEST_LIMIT, 10) })).toBe(true);
    expect(isAskRequest({ question: "x", history: turns(HISTORY_REQUEST_LIMIT + 1, 10) })).toBe(false);
  });
});

describe("verifyAnswer", () => {
  it("passes a grounded answer", () => {
    expect(verifyAnswer(VALID, PASSAGES)).toEqual([]);
  });

  it("catches a citation outside the retrieved set", () => {
    const bad = { ...VALID, citedPassages: ["1", "7"] };
    const kinds = verifyAnswer(bad, PASSAGES).map((f) => f.kind);
    expect(kinds).toContain("unknown_passage");
  });

  it("catches an answer that claims support and cites nothing", () => {
    // The failure this surface exists to prevent: fluent, plausible, traceable to
    // nothing. It is the same shape as the severity claim consequenceBasis catches.
    const bad = { ...VALID, citedPassages: [] };
    const kinds = verifyAnswer(bad, PASSAGES).map((f) => f.kind);
    expect(kinds).toContain("answer_without_citation");
  });

  it("lets an unanswerable answer cite nothing, because that is the honest shape", () => {
    const none: Answer = { answerable: false, answer: "The documents do not cover price.", citedPassages: [] };
    expect(verifyAnswer(none, PASSAGES)).toEqual([]);
  });

  it("survives a model that omits citedPassages entirely", () => {
    // `a` is JSON.parse of model output, not a typed value. A missing field must
    // produce a recorded failure, never a TypeError from the verifier.
    const bad = { answerable: true, answer: "x" } as unknown as Answer;
    expect(() => verifyAnswer(bad, PASSAGES)).not.toThrow();
    expect(verifyAnswer(bad, PASSAGES).map((f) => f.kind)).toContain("answer_without_citation");
  });
});

describe("handleAsk", () => {
  it("answers an empty retrieval WITHOUT calling a model", async () => {
    // No passages means the model's only legal output is "nothing matched". Asking it
    // to produce that is a round trip bought for nothing.
    const complete = vi.fn();
    const res = await handleAsk({ question: "anything" }, [], complete);
    expect(res.status).toBe(200);
    expect((res.body as { answerable: boolean }).answerable).toBe(false);
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns 503 without credentials, and spends nothing", async () => {
    const res = await handleAsk({ question: "x" }, PASSAGES, null);
    expect(res.status).toBe(503);
  });

  it("rejects a blank question before it can cost a token", async () => {
    const complete = vi.fn();
    const res = await handleAsk({ question: "   " }, PASSAGES, complete);
    expect(res.status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });

  it("resolves passage numbers to document and page for the reader", async () => {
    const complete = vi.fn().mockResolvedValue(VALID);
    const res = await handleAsk({ question: "what margin?" }, PASSAGES, complete);
    expect(res.status).toBe(200);
    expect((res.body as { citations: unknown[] }).citations).toEqual([
      { documentId: "doc_a", filename: "ema.pdf", page: 36 },
    ]);
  });

  it("reports how many turns it actually read, so the client never recomputes the boundary", async () => {
    const complete = vi.fn().mockResolvedValue(VALID);
    const history = turns(40, 1000);
    const res = await handleAsk({ question: "what margin?", history }, PASSAGES, complete);
    expect((res.body as { historyTurnsUsed: number }).historyTurnsUsed)
      .toBe(historyWindow(history).length);
  });

  it("reports nothing remembered when there is no history", async () => {
    const complete = vi.fn().mockResolvedValue(VALID);
    const res = await handleAsk({ question: "what margin?" }, PASSAGES, complete);
    expect((res.body as { historyTurnsUsed: number }).historyTurnsUsed).toBe(0);
  });

  it("reports nothing remembered when no passage matched, because no model was called", async () => {
    const res = await handleAsk({ question: "x", history: turns(3, 100) }, [], vi.fn());
    expect((res.body as { historyTurnsUsed: number }).historyTurnsUsed).toBe(0);
  });

  it("rejects a malformed transcript before it can cost a token", async () => {
    const complete = vi.fn();
    const res = await handleAsk({ question: "x", history: [{ question: "a" }] }, PASSAGES, complete);
    expect(res.status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });

  it("blocks an ungrounded answer from reaching the screen", async () => {
    const complete = vi.fn().mockResolvedValue({ ...VALID, citedPassages: ["9"] });
    const res = await handleAsk({ question: "what margin?" }, PASSAGES, complete);
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("unverified");
  });
});
