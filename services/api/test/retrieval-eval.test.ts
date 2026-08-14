import { describe, expect, it } from "vitest";
import { evaluate, scoreItem, stabilityOf, verifyFixture, type EvalItem } from "../retrieval-eval.js";

const item = (over: Partial<EvalItem> = {}): EvalItem => ({
  id: "i1", document: "d", group: "g", kind: "answerable",
  question: "What NOAEL was set?", goldPages: [{ page: 36, quote: "NOAEL) was set at 306 mg/kg" }],
  ...over,
});

describe("scoring one question", () => {
  it("counts a hit, its recall and its rank", () => {
    const r = scoreItem(item({ goldPages: [{ page: 36, quote: "x" }, { page: 37, quote: "y" }] }), [12, 36, 99]);
    expect(r.hit).toBe(true);
    expect(r.recall).toBe(0.5);
    // Second position, so a reciprocal rank of one half. Rank matters because the
    // answering model reads eight passages and weights the first ones it meets.
    expect(r.reciprocalRank).toBe(0.5);
  });

  it("scores a total miss as zero rather than as absent", () => {
    const r = scoreItem(item(), [1, 2, 3]);
    expect(r.hit).toBe(false);
    expect(r.recall).toBe(0);
    expect(r.reciprocalRank).toBe(0);
  });
});

describe("paraphrase stability", () => {
  it("is 1 when the same pages come back for every phrasing", () => {
    expect(stabilityOf([[1, 2, 3], [3, 2, 1]])).toBe(1);
  });

  it("is 0 when two phrasings of one question share no page at all", () => {
    // The measured failure: an acronym and its own expansion retrieving disjoint sets.
    expect(stabilityOf([[1, 2], [3, 4]])).toBe(0);
  });

  it("is undefined for a group with nothing to compare", () => {
    expect(stabilityOf([[1, 2]])).toBeNull();
  });
});

describe("the fixture's own integrity", () => {
  it("refuses a gold page whose quote is no longer on it", () => {
    // A fixture that rots silently is worse than no fixture: every later number is
    // measured against pages nobody has checked since.
    const pages = { d: [{ page: 36, text: "something else entirely" }] };
    const failures = verifyFixture([item()], (doc) => pages[doc as keyof typeof pages] ?? []);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("i1");
  });

  it("passes a quote that is on its page, ignoring how the whitespace fell", () => {
    const pages = { d: [{ page: 36, text: "the  NOAEL)\n was  at\t306 mg/kg here" }] };
    const failures = verifyFixture(
      [item({ goldPages: [{ page: 36, quote: "NOAEL) was at 306 mg/kg" }] })],
      (doc) => pages[doc as keyof typeof pages] ?? [],
    );
    expect(failures).toEqual([]);
  });
});

describe("the report", () => {
  it("keeps unanswerable items out of the retrieval averages", () => {
    // They have no gold pages by construction, so counting them as misses would
    // report a retriever failure for a question the document cannot answer.
    const items = [
      item({ id: "a", goldPages: [{ page: 1, quote: "q" }] }),
      item({ id: "u", kind: "unanswerable", goldPages: [] }),
    ];
    const report = evaluate(items, () => [1], 8);
    expect(report.answerable).toBe(1);
    expect(report.unanswerable).toBe(1);
    expect(report.hitRate).toBe(1);
  });
});
