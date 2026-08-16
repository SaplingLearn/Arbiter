import { describe, expect, it } from "vitest";
import { href, parseHash } from "../src/router.js";

describe("read route", () => {
  it("parses the bare tab", () => {
    expect(parseHash("#/case/c1/read")).toEqual({ name: "read", caseId: "c1" });
  });

  // Deep links are load-bearing: a divergence row asserts something about one
  // sentence, and a reader who has to hunt page 112 by hand will not bother.
  it("parses a document and page", () => {
    expect(parseHash("#/case/c1/read/doc_9/112")).toEqual({
      name: "read", caseId: "c1", documentId: "doc_9", page: 112,
    });
  });

  it("ignores a page that is not a number", () => {
    expect(parseHash("#/case/c1/read/doc_9/xyz")).toEqual({
      name: "read", caseId: "c1", documentId: "doc_9",
    });
  });

  it("ignores pages with numeric prefixes and garbage suffixes", () => {
    expect(parseHash("#/case/c1/read/doc_9/112xyz")).toEqual({
      name: "read", caseId: "c1", documentId: "doc_9",
    });
    expect(parseHash("#/case/c1/read/doc_9/12,000")).toEqual({
      name: "read", caseId: "c1", documentId: "doc_9",
    });
  });

  it("round-trips through href", () => {
    const r = { name: "read" as const, caseId: "c1", documentId: "doc_9", page: 112 };
    expect(parseHash(href(r))).toEqual(r);
    expect(href({ name: "read", caseId: "c1" })).toBe("#/case/c1/read");
  });

  it("round-trips documentId without page", () => {
    const r = { name: "read" as const, caseId: "c1", documentId: "doc_9" };
    expect(parseHash(href(r))).toEqual(r);
    expect(href(r)).toBe("#/case/c1/read/doc_9");
  });

  it("still falls back to the case overview for an unknown sub-route", () => {
    expect(parseHash("#/case/c1/nonsense")).toEqual({ name: "case", caseId: "c1" });
  });
});
