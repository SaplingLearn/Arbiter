import { describe, expect, it } from "vitest";
import { consistencyOf, summarise, wilson, type AskItemResult } from "../ask-eval.js";

const result = (over: Partial<AskItemResult> = {}): AskItemResult => ({
  id: "i", document: "d", kind: "answerable", question: "q", answerable: true, answer: "300 mg/kg",
  citedPages: [36], goldPages: [36, 37], statedFact: true,
  citationPrecision: 1, citationRecall: 0.5, refused: null, ...over,
});

describe("wilson interval", () => {
  it("is wide at small n, which is the point of reporting it", () => {
    // 18/18 is not evidence of 100%. The interval is what stops the headline
    // pretending otherwise.
    const [lo, hi] = wilson(18, 18);
    expect(lo).toBeLessThan(0.85);
    expect(hi).toBe(1);
  });

  it("tightens as n grows on the same proportion", () => {
    const small = wilson(9, 10);
    const large = wilson(90, 100);
    expect(large[0] - small[0]).toBeGreaterThan(0);
  });

  it("returns a degenerate interval for no observations rather than dividing by zero", () => {
    expect(wilson(0, 0)).toEqual([0, 0]);
  });
});

describe("the summary", () => {
  it("scores unanswerable items on refusal and keeps them out of the fact rate", () => {
    // A refusal is not a wrong answer, and counting it as one would make the honest
    // behaviour look like failure.
    const r = summarise([
      result(),
      result({ id: "u", kind: "unanswerable", answerable: false, statedFact: null, refused: true, citationPrecision: null, citationRecall: null }),
    ], "m");
    expect(r.answerable).toBe(1);
    expect(r.statedFactRate).toBe(1);
    expect(r.refusalRate).toBe(1);
  });

  it("counts an answer that declined as answered-no, not as stating the fact", () => {
    const r = summarise([result({ answerable: false, statedFact: false })], "m");
    expect(r.answeredRate).toBe(0);
    expect(r.statedFactRate).toBe(0);
  });

  it("ignores a null precision rather than averaging it as zero", () => {
    // No citations means there was no claim to be wrong about. Averaging that in as
    // zero would punish a refusal twice.
    const r = summarise([result({ citationPrecision: 1 }), result({ id: "b", citationPrecision: null })], "m");
    expect(r.meanCitationPrecision).toBe(1);
  });
});

describe("consistency across runs", () => {
  it("calls it stable when every run answered the same way", () => {
    const c = consistencyOf("i", [result(), result(), result()]);
    expect(c.sameAnswerable).toBe(true);
    expect(c.sameFact).toBe(true);
    expect(c.citationOverlap).toBe(1);
  });

  it("catches a run that answered where the others declined", () => {
    // The flip that matters most: the same question, the same passages, and one run
    // deciding the documents do say something after all.
    const c = consistencyOf("i", [result(), result({ answerable: false, statedFact: false })]);
    expect(c.sameAnswerable).toBe(false);
    expect(c.sameFact).toBe(false);
  });

  it("measures how much of the citation list survived between runs", () => {
    const c = consistencyOf("i", [result({ citedPages: [1, 2] }), result({ citedPages: [2, 3] })]);
    expect(c.citationOverlap).toBeCloseTo(1 / 3);
  });
});
