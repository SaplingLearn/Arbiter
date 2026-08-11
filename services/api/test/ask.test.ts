import { describe, expect, it, vi } from "vitest";
import { answerSchema, handleAsk, userPrompt, verifyAnswer, type Answer } from "../ask.js";
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

  it("blocks an ungrounded answer from reaching the screen", async () => {
    const complete = vi.fn().mockResolvedValue({ ...VALID, citedPassages: ["9"] });
    const res = await handleAsk({ question: "what margin?" }, PASSAGES, complete);
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("unverified");
  });
});
