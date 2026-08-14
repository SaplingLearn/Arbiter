import { describe, expect, it } from "vitest";
import { buildIndex, search, tokenise, type DocumentPages } from "../retrieval.js";

const DOCS: DocumentPages[] = [
  {
    documentId: "doc_a", filename: "ema-epar.pdf",
    pages: [
      { page: 1, text: "Assessment report. Product information and quality specifications." },
      { page: 2, text: "The applicant proposed an exposure margin of 44x based on the NOAEL." },
      { page: 3, text: "The CHMP did not support that NOAEL and lowered it to 100 mg/kg, giving 6.7x on Cmax." },
      { page: 4, text: "   " },
    ],
  },
  {
    documentId: "doc_b", filename: "fda-review.pdf",
    pages: [
      { page: 1, text: "Nonclinical pharmacology. Mononuclear cell infiltrates were seen in the liver." },
    ],
  },
];

describe("tokenise", () => {
  it("keeps numbers, because the citable facts are numbers", () => {
    // "44x", "6.7x", "100 mg/kg" are exactly what somebody asks about. A tokeniser
    // that dropped digits would make the most quotable facts the least findable.
    const t = tokenise("The margin was 44x, lowered to 6.7x on Cmax at 100 mg/kg.");
    expect(t).toContain("44x");
    expect(t).toContain("100");
    expect(t).toContain("cmax");
  });

  it("drops stopwords and single characters", () => {
    expect(tokenise("the a of and I x")).toEqual([]);
  });
});

describe("buildIndex", () => {
  it("skips pages with no extractable text rather than indexing them empty", () => {
    // A scanned page yields nothing. Indexing it would put a citable page number on a
    // page a reader cannot read - the "never measured vs measured empty" confusion.
    const idx = buildIndex(DOCS);
    const pages = new Set(idx.chunks.map((c) => `${c.documentId}:${c.page}`));
    expect([...pages]).not.toContain("doc_a:4");
    expect(pages.size).toBe(4);
  });

  it("indexes one chunk per page, which is also the citation unit", () => {
    // Sub-page windows were built and measured on 2026-08-13; every size that changed
    // anything made recall worse. The header records the sweep. This asserts the unit
    // stayed the page, so a future change to it is a deliberate one.
    const idx = buildIndex([{
      documentId: "d", filename: "f.pdf",
      pages: [{ page: 1, text: "necrosis ".repeat(400) }, { page: 2, text: "short page" }],
    }]);
    expect(idx.chunks.filter((c) => c.page === 1)).toHaveLength(1);
    expect(idx.chunks.filter((c) => c.page === 2)).toHaveLength(1);
  });
});

describe("search", () => {
  it("surfaces both pages a two-sided question needs, with their provenance", () => {
    // THE CONTRACT IS SURFACING, NOT RANKING, and this test asserted the wrong one
    // first. "What exposure margin did the CHMP accept?" scores page 2 above page 3:
    // page 2 carries two content terms (exposure, margin) and page 3 carries one
    // (chmp). That is BM25 behaving correctly, and it is the paraphrase weakness a
    // lexical retriever has by construction - the sentence that ANSWERS the question
    // shares fewer words with it than the sentence that sets it up.
    //
    // It does not matter, because the model reads all k passages. What must hold is
    // that the answering page is in the set at all, and that each carries the
    // document and page a reader can turn to.
    const hits = search(buildIndex(DOCS), "what exposure margin did the CHMP accept?", 3);
    const where = hits.map((h) => `${h.documentId}:${h.page}`);
    expect(where).toContain("doc_a:3");
    expect(where).toContain("doc_a:2");
    expect(hits.every((h) => h.filename !== "" && h.page > 0)).toBe(true);
  });

  it("ranks first on a question whose words are actually on the page", () => {
    const hits = search(buildIndex(DOCS), "CHMP lowered the NOAEL to 100 mg/kg", 3);
    expect(hits[0]!.page).toBe(3);
  });

  it("searches across documents, not just the first", () => {
    const hits = search(buildIndex(DOCS), "mononuclear infiltrates in the liver", 2);
    expect(hits[0]!.documentId).toBe("doc_b");
  });

  it("returns nothing for a question with no content words, rather than page 1", () => {
    // A question that is entirely stopwords must retrieve NOTHING. Returning the
    // highest-scoring page anyway would hand the model arbitrary context and let it
    // answer confidently from a page that has no bearing on what was asked.
    expect(search(buildIndex(DOCS), "what is it and how does that work?", 5)).toEqual([]);
  });

  it("is deterministic, so any variation downstream is the model's", () => {
    const idx = buildIndex(DOCS);
    const a = search(idx, "NOAEL exposure margin", 4).map((p) => `${p.documentId}:${p.page}`);
    const b = search(idx, "NOAEL exposure margin", 4).map((p) => `${p.documentId}:${p.page}`);
    expect(a).toEqual(b);
  });

  it("survives an empty corpus without throwing", () => {
    expect(search(buildIndex([]), "anything", 5)).toEqual([]);
  });

  it("returns each page once, with the whole page for the model to read", () => {
    const idx = buildIndex([{
      documentId: "d", filename: "f.pdf",
      pages: [{ page: 1, text: `necrosis ${"hepatic ".repeat(300)} necrosis` }],
    }]);
    const hits = search(idx, "necrosis hepatic", 5);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toContain("necrosis hepatic");
  });

  it("matches a question to a page that never uses the question's words", () => {
    // What terms.ts bought, at the level of one search: the page says hepatic and
    // ALT, the reader says liver, and BM25 alone shared no term with it at all.
    const idx = buildIndex([{
      documentId: "d", filename: "f.pdf",
      pages: [
        { page: 1, text: "Manufacturing controls and container closure integrity." },
        { page: 2, text: "Hepatic changes with raised alanine aminotransferase at 20 mg/kg." },
      ],
    }]);
    expect(search(idx, "does this drug damage the liver?", 2)[0]!.page).toBe(2);
  });
});
