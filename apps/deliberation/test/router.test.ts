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

/**
 * The printed record carries its sheet in the route for the same reason the reader
 * carries its page: a sheet you can link to is one you can send somebody, bookmark,
 * and get back to with the browser's own back button.
 */
describe("the report route", () => {
  it("parses the record with and without a sheet", () => {
    expect(parseHash("#/case/c1/report")).toEqual({ name: "report", caseId: "c1" });
    expect(parseHash("#/case/c1/report/4")).toEqual({ name: "report", caseId: "c1", page: 4 });
  });

  it("drops a sheet that is not a number rather than defaulting to the first", () => {
    // The same rule the reader applies: a deep link that silently lands on sheet 1 is
    // worse than one that lands on the document.
    expect(parseHash("#/case/c1/report/xyz")).toEqual({ name: "report", caseId: "c1" });
    expect(parseHash("#/case/c1/report/2pages")).toEqual({ name: "report", caseId: "c1" });
  });

  it("round-trips through href", () => {
    const r = { name: "report" as const, caseId: "c1", page: 3 };
    expect(parseHash(href(r))).toEqual(r);
    expect(href(r)).toBe("#/case/c1/report/3");
    expect(href({ name: "report", caseId: "c1" })).toBe("#/case/c1/report");
  });
});

describe("the reading room route", () => {
  it("parses the top-level read route", () => {
    expect(parseHash("#/read")).toEqual({ name: "reading" });
  });

  it("round-trips through href", () => {
    expect(href({ name: "reading" })).toBe("#/read");
    expect(parseHash(href({ name: "reading" }))).toEqual({ name: "reading" });
  });

  // The two read routes are DIFFERENT ROUTES and the hashes must not collide: one is
  // the room, one is a document inside a case. A parser that folded `#/read` into the
  // case route would need a caseId it does not have.
  it("does not collide with the case reader", () => {
    expect(parseHash("#/read")).not.toEqual(parseHash("#/case/c1/read"));
    expect(href({ name: "reading" })).not.toBe(href({ name: "read", caseId: "c1" }));
  });

  /**
   * A TRAILING SEGMENT IS NOT A CASE ID. `#/read/c1` is not a route this app
   * publishes, and reading `c1` as a case would send somebody who mistyped a URL into
   * a case they may not be named on, to be told it does not exist. The room lists what
   * they can actually open instead.
   */
  it("does not treat a trailing segment as a case", () => {
    expect(parseHash("#/read/c1")).toEqual({ name: "reading" });
    expect(parseHash("#/read/c1/doc_9")).toEqual({ name: "reading" });
  });
});
