import { describe, expect, it } from "vitest";
import { renderHtml, type DocumentRow } from "../report.js";
import type { EvalReport } from "../retrieval-eval.js";
import type { AskReport } from "../ask-eval.js";

const retrieval: EvalReport = {
  k: 8, answerable: 53, unanswerable: 2, hitRate: 0.887, meanRecall: 0.792,
  mrr: 0.522, meanStability: 0.385,
  stabilityByGroup: [{ group: "turalio:noael", overlap: 0.231 }],
  items: [],
};

const ask: AskReport = {
  model: "gemini-3.5-flash", answerable: 53, unanswerable: 2,
  statedFactRate: 0.9, statedFactInterval: [0.79, 0.96], answeredRate: 1,
  meanCitationPrecision: 0.4, meanCitationRecall: 0.7, refusalRate: 1, errors: 0,
  items: [{
    id: "a", document: "turalio", kind: "answerable", question: "q", answerable: true,
    answer: "x", citedPages: [1], goldPages: [1], statedFact: true,
    citationPrecision: 1, citationRecall: 1, refused: null,
  }],
};

const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  name: "turalio", label: "Turalio - FDA NDA 211810", path: "data/raw/x.pdf",
  askable: true, pages: 264, characters: 528734, megabytes: 6.1, sha256: "abc123", ...over,
});

const render = (over: Partial<Parameters<typeof renderHtml>[0]> = {}): string =>
  renderHtml({
    retrieval, ask, documents: [doc()], fixtureItems: 55, fixtureDocuments: 14,
    commit: "deadbee", generatedAt: "2026-08-14 01:00 UTC", ...over,
  });

describe("the report", () => {
  it("prints the numbers it was given, not numbers of its own", () => {
    const html = render();
    expect(html).toContain("88.7%");   // retrieval hit rate
    expect(html).toContain("79.2%");   // retrieval recall
    expect(html).toContain("0.522");   // MRR
    expect(html).toContain("90.0%");   // stated the fact
    expect(html).toContain("gemini-3.5-flash");
  });

  it("carries the interval next to the rate, so the rate cannot travel alone", () => {
    // n is small and a bare percentage invites being quoted as certainty.
    expect(render()).toMatch(/79\.0%.{0,10}96\.0%/);
  });

  it("states the limitations before the results rather than after", () => {
    const html = render();
    expect(html.indexOf("regular expression")).toBeLessThan(html.indexOf("2. The documents"));
  });

  it("keeps the rejected experiments in", () => {
    // A report carrying only the wins is an advertisement.
    const html = render();
    expect(html).toContain("What was built and rejected");
    expect(html).toContain("dense only");
  });

  it("escapes a document label rather than pasting it into the markup", () => {
    const html = render({ documents: [doc({ label: "Drug <script>alert(1)</script>" })] });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("names a refused document and its reason", () => {
    const html = render({
      documents: [doc(), doc({ name: "tolcapone", label: "Tolcapone", askable: false, reason: "48 of 48 pages carry almost no extractable text" })],
    });
    expect(html).toContain("48 of 48 pages");
  });

  it("renders without a consistency section when none was run", () => {
    expect(render()).not.toContain("mean pairwise overlap of the citation lists");
  });
});

describe("input validation", () => {
  it("refuses a results file that predates per-document reporting", async () => {
    const { checkAskResults } = await import("../report.js");
    const stale = { ...ask, items: [{ ...ask.items[0]!, document: undefined as unknown as string }] };
    expect(() => checkAskResults(stale)).toThrow(/per-document reporting/);
  });

  it("refuses an empty results file rather than rendering an empty report", async () => {
    const { checkAskResults } = await import("../report.js");
    expect(() => checkAskResults({ ...ask, items: [] })).toThrow(/no items/);
  });
});
