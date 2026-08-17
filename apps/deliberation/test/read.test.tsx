import "@testing-library/jest-dom/vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { Read, highlightsFor, unresolvedCitations } from "../src/read.js";
import type { Finding, StoredDocument } from "../src/api.js";

/**
 * PdfView's dynamic `import("pdfjs-dist")` is mocked for the whole file - no test here
 * needs the real renderer, and the PDF canvas itself is explicitly out of scope.
 *
 * IT RESOLVES BY DEFAULT, and it used to reject unconditionally. That module-wide
 * rejection meant NO test in this file ever saw a successful render, so the aside -
 * the whole findings rail - was never exercised on a path a reader reaches, and it
 * shipped empty on every real case without a single test noticing. A test that wants
 * the failure asks for it with `mockImplementationOnce`.
 *
 * jsdom's canvas has no 2d context, so `getContext("2d")` returns null and PdfView
 * returns early after it. That is fine: the canvas element and the aside are both in
 * the tree by then, which is what these tests read.
 */
// The arguments are echoed back into the fakes rather than ignored: naming them is
// what makes `toHaveBeenCalledWith(11)` and `toHaveBeenCalledWith(".../raw")` typed
// against the real call signatures instead of against `any`.
const getPage = vi.fn((n: number) => Promise.resolve({
  pageNumber: n,
  getViewport: () => ({ width: 800, height: 1000 }),
  render: () => ({ promise: Promise.resolve() }),
}));

const getDocument = vi.fn((src: { url: string; httpHeaders?: Record<string, string> }) => ({
  promise: Promise.resolve({ numPages: 300, getPage, fingerprint: src.url }),
  destroy: () => Promise.resolve(),
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: (src: { url: string; httpHeaders?: Record<string, string> }) => getDocument(src),
  GlobalWorkerOptions: {},
}));

const rejectOnce = (message: string): void => {
  getDocument.mockImplementationOnce(() => ({
    promise: Promise.reject(new Error(message)),
    destroy: () => Promise.resolve(),
  }) as unknown as ReturnType<typeof getDocument>);
};

beforeEach(() => { getDocument.mockClear(); getPage.mockClear(); });

/**
 * jsdom has no 2d canvas context and throws a loud "Not implemented" the moment one
 * is asked for. PdfView already treats a null context as "nothing to paint" and
 * returns, which is the same outcome - stubbing it just keeps a page of stack traces
 * out of the run, where they would drown a real failure.
 */
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(() => null as unknown as CanvasRenderingContext2D);
});

// The CLIENT StoredDocument (api.ts) has no caseId and REQUIRES measurement - it is
// not the server's StoredDocument. Scoping is enforced server-side by the endpoint,
// so the client type carries no caseId and does not need one.
const doc = (id: string, filename: string): StoredDocument => ({
  id, filename, bytes: 10, uploadedBy: "u_a", uploadedAt: "2026-08-15T00:00:00.000Z",
  measurement: { ok: true, reason: "fixture" },
});

/**
 * The filenames the uploader actually produces, taken from `_source.localFile` in
 * `data/cases/turalio-pexidartinib.json` and `.../nipocalimab-imaavy.json`.
 */
const DOCS: StoredDocument[] = [
  doc("doc_1", "turalio-211810-multidiscipline.pdf"),
  doc("doc_2", "ema-epar-sample-imaavy.pdf"),
];

/**
 * THE VALUES THE SHIPPED CASES ACTUALLY HOLD, copied verbatim.
 *
 * `sourceDocument` on every finding in `data/cases/` is a DOSSIER identifier -
 * "FDA NDA 211810", "EMA/CHMP/290491/2025" - not a filename. The earlier fixtures in
 * this file invented `sourceDocument: "turalio.pdf"`, which made a filename-only join
 * pass here while returning nothing at all in production. Nothing below invents a
 * value the data does not have.
 */
const SEED_FINDINGS: Finding[] = [
  { id: "f1", label: "hepatocellular necrosis", assertion: "toxic", detail: "d", sourceDocument: "FDA NDA 211810", sourcePage: 112 },
  { id: "f2", label: "no liver signal", assertion: "safe", detail: "d", sourceDocument: "EMA/CHMP/290491/2025", sourcePage: 40 },
  { id: "f3", label: "unsourced", assertion: "ambiguous", detail: "d" },
];

/** Written in-app through FindingsEditor, so they carry the validated document id. */
const LINKED_FINDINGS: Finding[] = [
  { id: "g1", label: "ALT elevation at week 4", assertion: "toxic", detail: "d", sourceDocumentId: "doc_1", sourcePage: 88 },
  { id: "g2", label: "biliary hyperplasia", assertion: "toxic", detail: "d", sourceDocumentId: "doc_1", sourcePage: 141 },
  { id: "g3", label: "on the other document", assertion: "safe", detail: "d", sourceDocumentId: "doc_2", sourcePage: 12 },
  // Linked to this document, no page. There is no honest page to put it on.
  { id: "g4", label: "cited, page never recorded", assertion: "ambiguous", detail: "d", sourceDocumentId: "doc_1" },
  // A stale id: the document it names is not on this case any more.
  { id: "g5", label: "points at a document that is gone", assertion: "toxic", detail: "d", sourceDocumentId: "doc_gone", sourcePage: 7 },
];

describe("highlightsFor", () => {
  /**
   * THE REGRESSION TEST. Against the previous `f.sourceDocument === filename` join
   * this fails on the first assertion: "FDA NDA 211810" is not
   * "turalio-211810-multidiscipline.pdf", so every seed finding was dropped and the
   * rail was empty on every real case.
   */
  it("does not match a dossier identifier against a filename", () => {
    expect(highlightsFor(SEED_FINDINGS, "doc_1", "turalio-211810-multidiscipline.pdf")).toEqual([]);
    expect(highlightsFor(SEED_FINDINGS, "doc_2", "ema-epar-sample-imaavy.pdf")).toEqual([]);
  });

  // No basename or fuzzy matching, deliberately. "FDA NDA 211810" and
  // "turalio-211810-multidiscipline.pdf" share the digits 211810, and a matcher that
  // noticed would be guessing - the failure inventory.ts refuses by name, in the
  // direction that fails silently. A highlight on the wrong 288-page review is worse
  // than no highlight.
  it("does not infer a link from a shared substring", () => {
    const nearMiss: Finding[] = [
      { id: "n1", label: "near miss", assertion: "toxic", detail: "d", sourceDocument: "FDA NDA 211810", sourcePage: 3 },
    ];
    expect(highlightsFor(nearMiss, "doc_1", "turalio-211810-multidiscipline.pdf")).toEqual([]);
  });

  it("resolves a finding that carries the document id", () => {
    expect(highlightsFor(LINKED_FINDINGS, "doc_1", "turalio-211810-multidiscipline.pdf").map((f) => f.id))
      .toEqual(["g1", "g2"]);
    expect(highlightsFor(LINKED_FINDINGS, "doc_2", "ema-epar-sample-imaavy.pdf").map((f) => f.id))
      .toEqual(["g3"]);
  });

  it("drops findings with no page, rather than guessing one", () => {
    const forDoc = highlightsFor(LINKED_FINDINGS, "doc_1", "turalio-211810-multidiscipline.pdf");
    // g4 satisfies the id match that g1 and g2 satisfy and is excluded purely because
    // it has no sourcePage. This is the assertion that fails if the page check is ever
    // dropped from highlightsFor.
    expect(forDoc.some((f) => f.id === "g4")).toBe(false);
    expect(forDoc.every((f) => f.sourcePage !== undefined)).toBe(true);
  });

  it("does not resolve an id that names a different document", () => {
    expect(highlightsFor(LINKED_FINDINGS, "doc_9", "nothing.pdf")).toEqual([]);
  });

  // The id is exact and the filename is only consulted in its absence, so a finding
  // that carries both cannot be pulled onto a document by a filename collision.
  it("prefers the id over the filename when a finding carries both", () => {
    const both: Finding[] = [
      { id: "b1", label: "both", assertion: "toxic", detail: "d", sourceDocumentId: "doc_2", sourceDocument: "turalio-211810-multidiscipline.pdf", sourcePage: 5 },
    ];
    expect(highlightsFor(both, "doc_1", "turalio-211810-multidiscipline.pdf")).toEqual([]);
    expect(highlightsFor(both, "doc_2", "ema-epar-sample-imaavy.pdf").map((f) => f.id)).toEqual(["b1"]);
  });

  // The fallback still earns its place: an extraction that wrote a real filename
  // resolves without a document id.
  it("still matches an exact filename when there is no document id", () => {
    const byName: Finding[] = [
      { id: "n1", label: "by filename", assertion: "toxic", detail: "d", sourceDocument: "turalio-211810-multidiscipline.pdf", sourcePage: 9 },
    ];
    expect(highlightsFor(byName, "doc_1", "turalio-211810-multidiscipline.pdf").map((f) => f.id)).toEqual(["n1"]);
  });
});

describe("unresolvedCitations", () => {
  it("counts page-cited findings that name no document on this case", () => {
    // f1 and f2 cite pages of a dossier; f3 cites no page at all and is not counted.
    expect(unresolvedCitations(SEED_FINDINGS, DOCS)).toBe(2);
  });

  it("does not count a finding that resolves to another document on the case", () => {
    // g3 is on doc_2 and g5's document is gone; g4 has no page.
    expect(unresolvedCitations(LINKED_FINDINGS, DOCS)).toBe(1);
  });

  it("counts nothing when there is nothing to place", () => {
    expect(unresolvedCitations([], DOCS)).toBe(0);
    expect(unresolvedCitations([{ id: "x", label: "l", assertion: "safe", detail: "d" }], DOCS)).toBe(0);
  });
});

describe("read screen", () => {
  it("lists every document on the case", () => {
    render(<Read caseId="c1" documents={DOCS} findings={SEED_FINDINGS} />);
    expect(screen.getByText("turalio-211810-multidiscipline.pdf")).toBeInTheDocument();
    expect(screen.getByText("ema-epar-sample-imaavy.pdf")).toBeInTheDocument();
  });

  it("says so plainly when the case has no documents", () => {
    render(<Read caseId="c1" documents={[]} findings={[]} />);
    expect(screen.getByText(/no documents/i)).toBeInTheDocument();
  });

  /**
   * ON A PLATE, like the evidence stage.
   *
   * This screen's copy sat directly on the WebGL scene: the document strip, the
   * findings rail, and the sentence explaining why a citation could not be placed.
   * The evidence stage puts the same kind of prose on `.glass` - a translucent ground
   * with a blur behind it - and reads cleanly over every scene because of it. Bare
   * type over a lit field is what the plate exists to stop, and reading is the surface
   * where it matters most: it is the longest stretch of text in the product.
   */
  it("stands its content on a glass plate", () => {
    const { container } = render(<Read caseId="c1" documents={DOCS} findings={SEED_FINDINGS} />);
    expect(container.querySelector("section.glass")).not.toBeNull();
  });

  // The empty state is one paragraph and nothing else, which is the case MOST exposed
  // to the scene behind it - there is no other object on the screen to sit on.
  it("stands the empty state on one too", () => {
    const { container } = render(<Read caseId="c1" documents={[]} findings={[]} />);
    expect(container.querySelector("section.glass")).not.toBeNull();
  });

  // The document strip navigates through real anchors (href()), so switching
  // documents is a URL change, not local state. Confirms both ends of that: the
  // route's documentId picks which document is open, and there is no useState
  // seeded once from a prop that a later navigation could leave stale.
  it("opens the document named by the documentId prop, not always the first one", () => {
    render(<Read caseId="c1" documentId="doc_2" documents={DOCS} findings={SEED_FINDINGS} />);
    expect(screen.getByText("ema-epar-sample-imaavy.pdf").closest("a")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("turalio-211810-multidiscipline.pdf").closest("a")).not.toHaveAttribute("aria-current");
  });

  it("links every document in the strip through href(), not a click handler", () => {
    render(<Read caseId="c1" documents={DOCS} findings={SEED_FINDINGS} />);
    expect(screen.getByText("turalio-211810-multidiscipline.pdf").closest("a")).toHaveAttribute(
      "href", "#/case/c1/read/doc_1",
    );
    expect(screen.getByText("ema-epar-sample-imaavy.pdf").closest("a")).toHaveAttribute(
      "href", "#/case/c1/read/doc_2",
    );
  });

  /**
   * A URL naming a document that is not on this case is WRONG, and saying so is the
   * only honest answer. Falling back to documents[0] rendered a different document
   * with aria-current on it and never corrected the hash, so the URL and the screen
   * disagreed with no signal at all - and the server answers this exact id with a 404.
   */
  it("refuses a documentId that is not on this case instead of opening another one", () => {
    render(<Read caseId="c1" documentId="doc_from_another_case" documents={DOCS} findings={SEED_FINDINGS} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/not on this case/i);
    expect(screen.getByText("turalio-211810-multidiscipline.pdf").closest("a")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("ema-epar-sample-imaavy.pdf").closest("a")).not.toHaveAttribute("aria-current");
    // The viewer never mounted at all - no canvas, and no findings rail claiming to
    // be about a document that is not here.
    expect(document.querySelector("canvas")).toBeNull();
    expect(screen.queryByRole("complementary", { name: /findings sourced/i })).toBeNull();
  });

  it("still opens the first document for the bare read route", () => {
    render(<Read caseId="c1" documents={DOCS} findings={SEED_FINDINGS} />);
    expect(screen.getByText("turalio-211810-multidiscipline.pdf").closest("a")).toHaveAttribute("aria-current", "true");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the findings rail", () => {
  const aside = (): HTMLElement => screen.getByRole("complementary", { name: /findings sourced/i });

  /**
   * THE TEST THAT WAS MISSING. No test inspected the aside at all - only the <nav>
   * strip and the error alert - which is how an always-empty rail survived unit
   * tests, mutation evidence and eight reviews.
   */
  it("renders a row per finding on the open document, linking to its page", () => {
    render(<Read caseId="c1" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    const rows = within(aside()).getAllByRole("link");
    expect(rows.map((r) => r.textContent)).toEqual([
      "p.88 ALT elevation at week 4",
      "p.141 biliary hyperplasia",
    ]);
    expect(rows[0]).toHaveAttribute("href", "#/case/c1/read/doc_1/88");
    expect(rows[1]).toHaveAttribute("href", "#/case/c1/read/doc_1/141");
  });

  it("shows only the open document's findings when the case has two", () => {
    render(<Read caseId="c1" documentId="doc_2" documents={DOCS} findings={LINKED_FINDINGS} />);
    expect(aside()).toHaveTextContent("on the other document");
    expect(aside()).not.toHaveTextContent("ALT elevation at week 4");
  });

  /**
   * The empty state has to tell two different stories apart. "No finding on this case
   * cites this document" asserts that nobody cited anything - which on every shipped
   * case is FALSE, and teaches a reviewer that extraction found nothing here.
   */
  it("says findings exist but are not linked, rather than claiming nobody cited it", () => {
    render(<Read caseId="c1" documentId="doc_1" documents={DOCS} findings={SEED_FINDINGS} />);
    expect(aside()).toHaveTextContent(/2 findings on this case cite a page/i);
    expect(aside()).toHaveTextContent(/not linked to any upload/i);
    expect(aside()).not.toHaveTextContent(/No finding on this case cites this document/i);
  });

  it("counts one finding in the singular", () => {
    render(<Read caseId="c1" documentId="doc_1" documents={DOCS} findings={[SEED_FINDINGS[0]!]} />);
    expect(aside()).toHaveTextContent(/One finding on this case cites a page/i);
  });

  it("keeps the plain message when genuinely nobody cited anything", () => {
    render(<Read caseId="c1" documentId="doc_1" documents={DOCS} findings={[SEED_FINDINGS[2]!]} />);
    expect(aside()).toHaveTextContent(/No finding on this case cites this document/i);
  });
});

describe("the viewer", () => {
  // The load rejects (asked for, once) rather than resolving. A blank canvas with no
  // explanation leaves a reviewer unable to tell "nothing here" from "something
  // broke" - the area must say so instead of staying silent.
  it("surfaces a message when the PDF fails to load, instead of leaving the canvas blank", async () => {
    rejectOnce("simulated load failure");
    render(<Read caseId="c1" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not open turalio-211810-multidiscipline\.pdf/i);
    expect(alert).toHaveTextContent(/simulated load failure/i);
  });

  it("keeps the findings rail up even when the document will not load", async () => {
    rejectOnce("simulated load failure");
    render(<Read caseId="c1" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    await screen.findByRole("alert");
    expect(screen.getByRole("complementary", { name: /findings sourced/i }))
      .toHaveTextContent("ALT elevation at week 4");
  });

  /**
   * TURNING A PAGE MUST NOT REFETCH THE DOCUMENT. This was one effect keyed on the
   * page number, so every page turn re-ran getDocument() - a fresh download and parse
   * of a 264-page review, per page.
   */
  it("loads the document once across a page change", async () => {
    const { rerender } = render(
      <Read caseId="c1" documentId="doc_1" page={10} documents={DOCS} findings={LINKED_FINDINGS} />,
    );
    await waitFor(() => { expect(getPage).toHaveBeenCalledWith(10); });
    expect(getDocument).toHaveBeenCalledTimes(1);

    rerender(<Read caseId="c1" documentId="doc_1" page={11} documents={DOCS} findings={LINKED_FINDINGS} />);
    // Waiting on getPage rather than on a timer: page 11 having been RENDERED is
    // proof the render effect ran, so the load count below is read after the moment
    // a refetch would have happened.
    await waitFor(() => { expect(getPage).toHaveBeenCalledWith(11); });
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  // Clamped, not thrown: a stale deep link to page 400 of a 300-page document lands
  // on the last page rather than on an error screen.
  it("clamps a page past the end of the document", async () => {
    render(<Read caseId="c1" documentId="doc_1" page={400} documents={DOCS} findings={LINKED_FINDINGS} />);
    await waitFor(() => { expect(getPage).toHaveBeenCalledWith(300); });
  });

  it("does refetch when the document itself changes", async () => {
    const { rerender } = render(
      <Read caseId="c1" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />,
    );
    await waitFor(() => { expect(getDocument).toHaveBeenCalledTimes(1); });
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/api/cases/c1/documents/doc_1/raw" }),
    );

    rerender(<Read caseId="c1" documentId="doc_2" documents={DOCS} findings={LINKED_FINDINGS} />);
    await waitFor(() => { expect(getDocument).toHaveBeenCalledTimes(2); });
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/api/cases/c1/documents/doc_2/raw" }),
    );
  });

  /**
   * THE BYTES ARE BEHIND THE SAME AUTH AS EVERYTHING ELSE.
   *
   * pdf.js does not go through api.ts - it is handed a URL and issues its OWN request -
   * so the bearer token this app keeps in memory never reached the one endpoint that
   * serves a document's bytes. `/raw` answered 401 and the reading surface showed
   * "Failed to fetch" for every document that has ever been uploaded.
   *
   * It stayed invisible because no case in the demo data had a document on it: the
   * screen said "No documents on this case yet" and nobody got as far as the fetch.
   */
  it("sends the bearer token with the document request", async () => {
    render(<Read caseId="c1" token="tok_abc" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    await waitFor(() => { expect(getDocument).toHaveBeenCalledTimes(1); });
    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({
      url: "/api/cases/c1/documents/doc_1/raw",
      httpHeaders: { Authorization: "Bearer tok_abc" },
    }));
  });
});
