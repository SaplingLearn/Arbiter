import { describe, expect, it } from "vitest";
import { MIN_PAGES_FOR_BOILERPLATE, boilerplateLines, stripBoilerplate } from "../pages.js";

const doc = (n: number, extra: (i: number) => string): { page: number; text: string }[] =>
  Array.from({ length: n }, (_, i) => ({
    page: i + 1,
    text: `NDA 211810 TURALIO multi-disciplinary review\nReference ID: 4470487\n${extra(i)}`,
  }));

describe("finding the furniture", () => {
  it("names a header that is on every page", () => {
    const lines = boilerplateLines(doc(20, (i) => `content about topic ${i}`));
    expect(lines).toContain("NDA 211810 TURALIO multi-disciplinary review");
    expect(lines).toContain("Reference ID: 4470487");
  });

  it("leaves content alone even when two pages happen to share a sentence", () => {
    const lines = boilerplateLines(doc(20, (i) => (i < 3 ? "hepatic necrosis was observed" : `other ${i}`)));
    expect(lines).not.toContain("hepatic necrosis was observed");
  });

  it("counts a line once per page, however often it repeats inside one", () => {
    // A running header printed twice on one page is not evidence about the document.
    const pages = Array.from({ length: 20 }, (_, i) => ({
      page: i + 1,
      text: i === 0 ? "repeated line\nrepeated line\nrepeated line".repeat(5) : `unique ${i}`,
    }));
    expect(boilerplateLines(pages)).not.toContain("repeated line");
  });

  it("does nothing at all to a short document", () => {
    // "On half the pages" says nothing about a four-page upload, where a real
    // sentence can appear twice for real reasons.
    const short = doc(MIN_PAGES_FOR_BOILERPLATE - 1, (i) => `content ${i}`);
    expect(boilerplateLines(short).size).toBe(0);
    expect(stripBoilerplate(short)).toEqual(short);
  });
});

describe("stripping it", () => {
  it("removes the furniture and keeps the content", () => {
    const stripped = stripBoilerplate(doc(20, (i) => `finding number ${i}`));
    expect(stripped[0]!.text).toBe("finding number 0");
    expect(stripped[19]!.text).toBe("finding number 19");
  });

  it("never renumbers a page, because the number is the citation", () => {
    const pages = doc(20, (i) => `content ${i}`);
    expect(stripBoilerplate(pages).map((p) => p.page)).toEqual(pages.map((p) => p.page));
  });

  it("returns the pages untouched when there is no furniture to find", () => {
    const pages = Array.from({ length: 20 }, (_, i) => ({ page: i + 1, text: `wholly unique ${i}` }));
    expect(stripBoilerplate(pages)).toBe(pages);
  });
});
