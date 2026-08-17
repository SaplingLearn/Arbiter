import "@testing-library/jest-dom/vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { Read, citationsFor, highlightRects, highlightsFor, unresolvedCitations } from "../src/read.js";
import type { Finding, Position, StoredDocument } from "../src/api.js";

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
// what makes `toHaveBeenCalledWith(11)` and the `{ url, httpHeaders }` assertions
// typed against the real call signatures instead of against `any`.
/**
 * US Letter at 72dpi, and the viewport HONOURS THE SCALE it is handed.
 *
 * It used to answer 800x1000 to every caller regardless, which made it impossible to
 * tell a page rasterised at the right size from one rasterised at any other - the
 * exact defect that shipped. Multiplying here is what lets the tests below read the
 * scale back off the canvas.
 */
const PAGE_W = 612;
const PAGE_H = 792;

const renderTask = vi.fn(() => ({ promise: Promise.resolve(), cancel: () => {} }));

/**
 * A page of positioned fragments, the way pdf.js actually hands text over: one item
 * per printed run, each with its own matrix. The sentence below is split across three
 * items ON PURPOSE - a quote that spans them is the normal case, not the edge case.
 */
const TEXT_ITEMS = [
  { str: "Pyridine is known to be", transform: [11, 0, 0, 11, 50, 700], width: 120, height: 11 },
  { str: "hepatotoxic, probably because", transform: [11, 0, 0, 11, 50, 686], width: 150, height: 11 },
  { str: "it forms reactive intermediates.", transform: [11, 0, 0, 11, 50, 672], width: 160, height: 11 },
  // THE MID-WORD SPLIT, copied from the shape a real EMA assessment report produced:
  // pdf.js ended one fragment at "repeat" and began the next at "-dose". Joining
  // fragments with a space turns that into "repeat -dose", and every quote containing
  // a hyphenated word then reports itself absent. This pair is the regression test.
  { str: "No mortality in the repeat", transform: [11, 0, 0, 11, 50, 658], width: 130, height: 11 },
  { str: "-dose toxicity studies were", transform: [11, 0, 0, 11, 50, 644], width: 140, height: 11 },
];

const getTextContent = vi.fn(() => Promise.resolve({ items: TEXT_ITEMS }));

const getPage = vi.fn((n: number) => Promise.resolve({
  pageNumber: n,
  getViewport: ({ scale }: { scale: number }) => ({
    width: PAGE_W * scale, height: PAGE_H * scale,
    // The real viewport transform: y is flipped, because PDF space counts up from the
    // bottom of the page and CSS counts down from the top.
    transform: [scale, 0, 0, -scale, 0, PAGE_H * scale],
  }),
  getTextContent,
  render: renderTask,
}));

/**
 * The source is the OBJECT FORM, `{ url, httpHeaders }`, and the shape is the point.
 *
 * It was a bare URL string, which is how pdf.js was left to make its own unauthenticated
 * request for the bytes - and `/raw` sits behind the same `can(..., "read")` guard as
 * every other case route, so it answered 401 and the viewer never opened a document in
 * the product. This mock takes what the real `getDocument` takes, so the assertions
 * below can read the header off it.
 */
interface PdfSource { url: string; httpHeaders?: Record<string, string> }

const getDocument = vi.fn((src: PdfSource) => ({
  promise: Promise.resolve({ numPages: 300, getPage, fingerprint: src.url }),
  destroy: () => Promise.resolve(),
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: (src: PdfSource) => getDocument(src),
  GlobalWorkerOptions: {},
}));

const rejectOnce = (message: string): void => {
  getDocument.mockImplementationOnce(() => ({
    promise: Promise.reject(new Error(message)),
    destroy: () => Promise.resolve(),
  }) as unknown as ReturnType<typeof getDocument>);
};

beforeEach(() => { getDocument.mockClear(); getPage.mockClear(); getTextContent.mockClear(); });

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
    render(<Read caseId="c1" token="tok_test" documents={DOCS} findings={SEED_FINDINGS} />);
    expect(screen.getByText("turalio-211810-multidiscipline.pdf")).toBeInTheDocument();
    expect(screen.getByText("ema-epar-sample-imaavy.pdf")).toBeInTheDocument();
  });

  it("says so plainly when the case has no documents", () => {
    render(<Read caseId="c1" token="tok_test" documents={[]} findings={[]} />);
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
    const { container } = render(<Read caseId="c1" token="tok_test" documents={DOCS} findings={SEED_FINDINGS} />);
    expect(container.querySelector("section.glass")).not.toBeNull();
  });

  // The empty state is one paragraph and nothing else, which is the case MOST exposed
  // to the scene behind it - there is no other object on the screen to sit on.
  it("stands the empty state on one too", () => {
    const { container } = render(<Read caseId="c1" token="tok_test" documents={[]} findings={[]} />);
    expect(container.querySelector("section.glass")).not.toBeNull();
  });

  // The document strip navigates through real anchors (href()), so switching
  // documents is a URL change, not local state. Confirms both ends of that: the
  // route's documentId picks which document is open, and there is no useState
  // seeded once from a prop that a later navigation could leave stale.
  it("opens the document named by the documentId prop, not always the first one", () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_2" documents={DOCS} findings={SEED_FINDINGS} />);
    expect(screen.getByText("ema-epar-sample-imaavy.pdf").closest("a")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("turalio-211810-multidiscipline.pdf").closest("a")).not.toHaveAttribute("aria-current");
  });

  it("links every document in the strip through href(), not a click handler", () => {
    render(<Read caseId="c1" token="tok_test" documents={DOCS} findings={SEED_FINDINGS} />);
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
    render(<Read caseId="c1" token="tok_test" documentId="doc_from_another_case" documents={DOCS} findings={SEED_FINDINGS} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/not on this case/i);
    expect(screen.getByText("turalio-211810-multidiscipline.pdf").closest("a")).not.toHaveAttribute("aria-current");
    expect(screen.getByText("ema-epar-sample-imaavy.pdf").closest("a")).not.toHaveAttribute("aria-current");
    // The viewer never mounted at all - no canvas, and no findings rail claiming to
    // be about a document that is not here.
    expect(document.querySelector("canvas")).toBeNull();
    expect(screen.queryByRole("complementary", { name: /findings sourced/i })).toBeNull();
  });

  it("still opens the first document for the bare read route", () => {
    render(<Read caseId="c1" token="tok_test" documents={DOCS} findings={SEED_FINDINGS} />);
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
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    const rows = within(aside()).getAllByRole("link");
    expect(rows.map((r) => r.textContent)).toEqual([
      "p.88 ALT elevation at week 4",
      "p.141 biliary hyperplasia",
    ]);
    expect(rows[0]).toHaveAttribute("href", "#/case/c1/read/doc_1/88");
    expect(rows[1]).toHaveAttribute("href", "#/case/c1/read/doc_1/141");
  });

  it("shows only the open document's findings when the case has two", () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_2" documents={DOCS} findings={LINKED_FINDINGS} />);
    expect(aside()).toHaveTextContent("on the other document");
    expect(aside()).not.toHaveTextContent("ALT elevation at week 4");
  });

  /**
   * The empty state has to tell two different stories apart. "No finding on this case
   * cites this document" asserts that nobody cited anything - which on every shipped
   * case is FALSE, and teaches a reviewer that extraction found nothing here.
   */
  it("says findings exist but are not linked, rather than claiming nobody cited it", () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={SEED_FINDINGS} />);
    expect(aside()).toHaveTextContent(/2 findings on this case cite a page/i);
    expect(aside()).toHaveTextContent(/not linked to any upload/i);
    expect(aside()).not.toHaveTextContent(/No finding on this case cites this document/i);
  });

  it("counts one finding in the singular", () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={[SEED_FINDINGS[0]!]} />);
    expect(aside()).toHaveTextContent(/One finding on this case cites a page/i);
  });

  it("keeps the plain message when genuinely nobody cited anything", () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={[SEED_FINDINGS[2]!]} />);
    expect(aside()).toHaveTextContent(/No finding on this case cites this document/i);
  });
});

describe("the viewer", () => {
  // The load rejects (asked for, once) rather than resolving. A blank canvas with no
  // explanation leaves a reviewer unable to tell "nothing here" from "something
  // broke" - the area must say so instead of staying silent.
  it("surfaces a message when the PDF fails to load, instead of leaving the canvas blank", async () => {
    rejectOnce("simulated load failure");
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not open turalio-211810-multidiscipline\.pdf/i);
    expect(alert).toHaveTextContent(/simulated load failure/i);
  });

  it("keeps the findings rail up even when the document will not load", async () => {
    rejectOnce("simulated load failure");
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
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
      <Read caseId="c1" token="tok_test" documentId="doc_1" page={10} documents={DOCS} findings={LINKED_FINDINGS} />,
    );
    await waitFor(() => { expect(getPage).toHaveBeenCalledWith(10); });
    expect(getDocument).toHaveBeenCalledTimes(1);

    rerender(<Read caseId="c1" token="tok_test" documentId="doc_1" page={11} documents={DOCS} findings={LINKED_FINDINGS} />);
    // Waiting on getPage rather than on a timer: page 11 having been RENDERED is
    // proof the render effect ran, so the load count below is read after the moment
    // a refetch would have happened.
    await waitFor(() => { expect(getPage).toHaveBeenCalledWith(11); });
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  // Clamped, not thrown: a stale deep link to page 400 of a 300-page document lands
  // on the last page rather than on an error screen.
  it("clamps a page past the end of the document", async () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" page={400} documents={DOCS} findings={LINKED_FINDINGS} />);
    await waitFor(() => { expect(getPage).toHaveBeenCalledWith(300); });
  });

  it("does refetch when the document itself changes", async () => {
    const { rerender } = render(
      <Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />,
    );
    await waitFor(() => { expect(getDocument).toHaveBeenCalledTimes(1); });
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/api/cases/c1/documents/doc_1/raw" }),
    );

    rerender(<Read caseId="c1" token="tok_test" documentId="doc_2" documents={DOCS} findings={LINKED_FINDINGS} />);
    await waitFor(() => { expect(getDocument).toHaveBeenCalledTimes(2); });
    expect(getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/api/cases/c1/documents/doc_2/raw" }),
    );
  });

  /**
   * THE 401. `/raw` is behind the same `can(kase, user.id, "read")` guard as every
   * other case route, and pdf.js does not go through `api.ts` - handed a bare URL it
   * makes its own request, which carried no credentials. The strip, the deep link and
   * the findings rail all worked; the document never loaded, in the product, ever.
   *
   * Neither existing layer could see it: this file mocks pdf.js so no request is made,
   * and server.test.ts calls `/raw` WITH a header, proving the route works for a caller
   * that sends one. This asserts the client is such a caller.
   */
  it("sends the bearer token with the request for the bytes", async () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    await waitFor(() => { expect(getDocument).toHaveBeenCalledTimes(1); });
    expect(getDocument).toHaveBeenCalledWith({
      url: "/api/cases/c1/documents/doc_1/raw",
      httpHeaders: { Authorization: "Bearer tok_test" },
    });
  });

  it("asks again with the new token when the session changes under it", async () => {
    const { rerender } = render(
      <Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />,
    );
    await waitFor(() => { expect(getDocument).toHaveBeenCalledTimes(1); });

    rerender(<Read caseId="c1" token="tok_fresh" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    await waitFor(() => { expect(getDocument).toHaveBeenCalledTimes(2); });
    expect(getDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ httpHeaders: { Authorization: "Bearer tok_fresh" } }),
    );
  });
});

/**
 * HOW THE PAGE IS RASTERISED, which is the difference between a document and a
 * photograph of one.
 *
 * The canvas is sized before `getContext` is asked for, precisely so these can run:
 * jsdom has no 2d context, the painting returns early, and the DIMENSIONS are still on
 * the element. Every number below is read off the canvas the reader would see.
 */
describe("the page raster", () => {
  const canvasOf = (): HTMLCanvasElement =>
    screen.getByLabelText(/turalio-211810-multidiscipline\.pdf page/i) as HTMLCanvasElement;

  const withDpr = (dpr: number): void => {
    Object.defineProperty(window, "devicePixelRatio", { value: dpr, configurable: true });
  };

  /** jsdom lays nothing out, so a measured column has to be stated outright. */
  const withColumn = (px: number): void => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: px, height: 0, top: 0, left: 0, right: px, bottom: 0, x: 0, y: 0, toJSON: () => ({}),
    });
  };

  beforeEach(() => { withDpr(1); });

  it("falls back to a visible scale when the column has not been measured", async () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    // 612pt at the fallback 1.4. The exact number matters far less than that it is not
    // zero: a page fitted to an unmeasured column is a canvas nobody can see.
    await waitFor(() => { expect(canvasOf().width).toBe(Math.round(PAGE_W * 1.4)); });
  });

  /**
   * THE BLUR. A 1x bitmap stretched across a 2x panel is what made the type look soft
   * and grey, and it is invisible to every other check in this repo because the canvas
   * is the right SIZE on screen either way - it is only the wrong number of pixels.
   */
  it("paints one bitmap pixel per device pixel, not per CSS pixel", async () => {
    withDpr(2);
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    await waitFor(() => { expect(canvasOf().width).toBe(Math.round(PAGE_W * 1.4 * 2)); });
    // ...while still OCCUPYING the same space: the backing store doubled, the box did not.
    expect(canvasOf().style.width).toBe(`${Math.round(PAGE_W * 1.4)}px`);
  });

  it("fits the page to the column it was given", async () => {
    withColumn(1000);
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    await waitFor(() => { expect(canvasOf().style.width).toBe("1000px"); });
    expect(canvasOf().width).toBe(1000);
  });

  /**
   * The squash. `max-width: 100%` with the raw pixel height still in force is the
   * oldest way there is to distort a replaced element, and on a page of body text it
   * looks like a badly generated PDF rather than like a stylesheet mistake.
   */
  it("keeps the page in its own aspect ratio", async () => {
    withColumn(1000);
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    await waitFor(() => { expect(canvasOf().style.height).not.toBe(""); });
    const box = canvasOf().style;
    expect(parseFloat(box.height) / parseFloat(box.width)).toBeCloseTo(PAGE_H / PAGE_W, 2);
  });
});

/**
 * TURNING THE PAGE. The reader opened at page 1 of a 300-page review and had no way to
 * reach page 2: the only route to any other page was a finding in the rail that
 * happened to cite one. The document was on the record, counted in the strip, and
 * unreadable past its first sheet.
 */
describe("the pager", () => {
  const openAt = (page?: number): void => {
    render(
      <Read caseId="c1" token="tok_test" documentId="doc_1"
        {...(page === undefined ? {} : { page })} documents={DOCS} findings={LINKED_FINDINGS} />,
    );
  };

  it("says where in the document the reader is", async () => {
    openAt();
    expect(await screen.findByText("Page 1 of 300")).toBeInTheDocument();
  });

  it("goes forward through the hash, so the page can be shared and gone back to", async () => {
    openAt();
    expect(await screen.findByRole("link", { name: "Next" }))
      .toHaveAttribute("href", "#/case/c1/read/doc_1/2");
  });

  it("goes back to the page before it", async () => {
    openAt(9);
    expect(await screen.findByRole("link", { name: "Previous" }))
      .toHaveAttribute("href", "#/case/c1/read/doc_1/8");
  });

  it("offers no way back from the first page", async () => {
    openAt();
    await screen.findByText("Page 1 of 300");
    expect(screen.queryByRole("link", { name: "Previous" })).not.toBeInTheDocument();
    // Present, not removed: a control that vanishes moves the one beside it under the
    // cursor between clicks.
    expect(screen.getByText("Previous")).toBeInTheDocument();
  });

  it("offers no way on from the last page", async () => {
    openAt(300);
    await screen.findByText("Page 300 of 300");
    expect(screen.queryByRole("link", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" }))
      .toHaveAttribute("href", "#/case/c1/read/doc_1/299");
  });

  /**
   * The same clamp the renderer applies. Reporting "Page 400 of 300" would be the
   * pager contradicting the page under it, and offering a Next from there would walk
   * further off the end of a document that stopped a hundred pages ago.
   */
  it("reports the page it is looking at when the link overshoots the document", async () => {
    openAt(400);
    expect(await screen.findByText("Page 300 of 300")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Next" })).not.toBeInTheDocument();
  });

  it("says nothing at all about pages in a one-page document", async () => {
    getDocument.mockImplementationOnce(() => ({
      promise: Promise.resolve({ numPages: 1, getPage, fingerprint: "one" }),
      destroy: () => Promise.resolve(),
    }) as unknown as ReturnType<typeof getDocument>);
    openAt();
    await waitFor(() => { expect(getPage).toHaveBeenCalled(); });
    expect(screen.queryByText(/Page 1 of/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Next" })).not.toBeInTheDocument();
  });

  /** A document that never arrived has no pages to turn, and says so instead. */
  it("does not offer to page through a document that failed to open", async () => {
    rejectOnce("network died");
    openAt();
    expect(await screen.findByRole("alert")).toHaveTextContent(/network died/);
    expect(screen.queryByText(/Page 1 of/)).not.toBeInTheDocument();
  });
});

/**
 * MARKING THE PASSAGE, and refusing to mark anything else.
 *
 * The rule these enforce is the one the handoff states outright: a wrong highlight on
 * a safety document is worse than no highlight. Every "does not match" case below is
 * therefore a REQUIREMENT, not a limitation - each one is a near-miss that a
 * similarity score would happily have marked.
 */
describe("highlightRects", () => {
  // Identity transform keeps the arithmetic readable; the flip is exercised in the
  // component tests, which use the real viewport matrix.
  const FLAT = [1, 0, 0, 1, 0, 0];

  it("finds a quote that sits inside a single fragment", () => {
    const marks = highlightRects(TEXT_ITEMS, "Pyridine is known to be", FLAT);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ left: 50, width: 120 });
  });

  /**
   * The over-mark. A fragment usually carries more than the quote - on the real page
   * this was built against, the match began two thirds of the way through one - and
   * marking it whole highlights a sentence nobody cited.
   */
  it("marks only the quoted part of a fragment that carries more", () => {
    const [whole] = highlightRects(TEXT_ITEMS, "No mortality in the repeat", FLAT);
    const [tail] = highlightRects(TEXT_ITEMS, "in the repeat", FLAT);
    expect(tail!.left).toBeGreaterThan(whole!.left);
    expect(tail!.width).toBeLessThan(whole!.width);
    // ...and it stays inside the fragment it came from.
    expect(tail!.left + tail!.width).toBeLessThanOrEqual(whole!.left + whole!.width + 0.001);
  });

  /** The normal case. pdf.js splits printed lines wherever it likes. */
  it("marks every line a quote crosses, and only those", () => {
    const marks = highlightRects(TEXT_ITEMS, "known to be hepatotoxic, probably", FLAT);
    expect(marks).toHaveLength(2);
  });

  it("does not care how the document broke its lines", () => {
    // The same words, written the way a person would paste them.
    const marks = highlightRects(TEXT_ITEMS, "hepatotoxic,   probably\n because", FLAT);
    expect(marks).toHaveLength(1);
  });

  /**
   * THE REGRESSION. pdf.js split "repeat-dose" across two fragments on the real
   * Sotyktu assessment report, and joining fragments with a space made the quote
   * unmatchable - the viewer reported every hyphenated sentence as absent from the
   * page it was quoted from.
   */
  it("matches a quote across a fragment that splits a word in half", () => {
    const marks = highlightRects(TEXT_ITEMS, "No mortality in the repeat-dose toxicity studies were", FLAT);
    expect(marks).toHaveLength(2);
  });

  it("finds nothing when a single word was changed", () => {
    expect(highlightRects(TEXT_ITEMS, "Pyridine is thought to be", FLAT)).toEqual([]);
  });

  it("finds nothing when the case is different", () => {
    expect(highlightRects(TEXT_ITEMS, "PYRIDINE IS KNOWN TO BE", FLAT)).toEqual([]);
  });

  it("finds nothing for a quote that is merely similar", () => {
    expect(highlightRects(TEXT_ITEMS, "Pyridine is hepatotoxic", FLAT)).toEqual([]);
  });

  it("marks nothing at all for an empty quote", () => {
    expect(highlightRects(TEXT_ITEMS, "   ", FLAT)).toEqual([]);
  });

  /** The mark is a box over the words, so it must have a real size. */
  it("gives every mark a positive width and height", () => {
    for (const m of highlightRects(TEXT_ITEMS, "Pyridine is known to be", FLAT)) {
      expect(m.width).toBeGreaterThan(0);
      expect(m.height).toBeGreaterThan(0);
    }
  });
});

describe("citationsFor", () => {
  const PEOPLE = [{ id: "u_1", displayName: "A. Silva" }, { id: "u_2", displayName: "B. Mehta" }];
  const SEATS = { u_1: 0, u_2: 1 };
  const POS: Position[] = [
    { participantId: "u_1", call: "do_not_advance", reasoning: "The liver signal is characterised.", citedFindingIds: ["g1"], external: [], submittedAt: "2026-08-16T00:00:00.000Z" },
    { participantId: "u_2", call: "advance", reasoning: "Margins are adequate.", citedFindingIds: ["g2"], external: [], submittedAt: "2026-08-16T00:00:00.000Z" },
  ];

  /**
   * THE BLINDNESS TEST, and it asserts the client's whole share of the rule: given
   * null it produces nothing. The server is what makes `revealed` null before the
   * case closes - this only has to not invent positions of its own.
   */
  it("yields no citation for anything while the positions are sealed", () => {
    const cite = citationsFor(null, PEOPLE, SEATS);
    expect(cite("g1")).toEqual([]);
    expect(cite("g2")).toEqual([]);
  });

  it("names who cited a finding, with their call and their reasoning", () => {
    const cite = citationsFor(POS, PEOPLE, SEATS);
    expect(cite("g1")).toEqual([{
      participantId: "u_1", name: "A. Silva", seat: 0,
      call: "do_not_advance", reasoning: "The liver signal is characterised.",
    }]);
  });

  it("does not attribute a finding to somebody who cited a different one", () => {
    expect(citationsFor(POS, PEOPLE, SEATS)("g1").map((c) => c.name)).toEqual(["A. Silva"]);
    expect(citationsFor(POS, PEOPLE, SEATS)("g2").map((c) => c.name)).toEqual(["B. Mehta"]);
  });

  it("returns an empty list for a finding nobody cited", () => {
    expect(citationsFor(POS, PEOPLE, SEATS)("g4")).toEqual([]);
  });

  /** A participant with no seat renders neutral rather than borrowing seat 0. */
  it("carries a null seat rather than inventing one", () => {
    expect(citationsFor(POS, PEOPLE, {})("g1")[0]?.seat).toBeNull();
  });

  it("falls back to the id when the person is not in the roster", () => {
    expect(citationsFor(POS, [], SEATS)("g1")[0]?.name).toBe("u_1");
  });
});

describe("the viewer's marks and attribution", () => {
  const QUOTED: Finding[] = [{
    id: "g1", label: "M12 metabolite", assertion: "toxic", detail: "d",
    sourceDocumentId: "doc_1", sourcePage: 1,
    sourceQuote: "Pyridine is known to be hepatotoxic",
  }];

  const marks = (): HTMLElement[] => [...document.querySelectorAll(".mark")] as HTMLElement[];

  it("marks the quoted passage on the page it was quoted from", async () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={QUOTED} />);
    await waitFor(() => { expect(marks().length).toBeGreaterThan(0); });
    // Two fragments, because the quote crosses the line break in the fixture page.
    expect(marks()).toHaveLength(2);
  });

  it("puts the mark inside the page rather than off it", async () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={QUOTED} />);
    await waitFor(() => { expect(marks().length).toBeGreaterThan(0); });
    for (const m of marks()) {
      expect(parseFloat(m.style.top)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(m.style.left)).toBeGreaterThanOrEqual(0);
    }
  });

  it("does not read the text layer at all when no finding quotes the page", async () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    await waitFor(() => { expect(getPage).toHaveBeenCalled(); });
    expect(getTextContent).not.toHaveBeenCalled();
    expect(marks()).toHaveLength(0);
  });

  /** The honest failure. Nothing is marked, and the screen says why. */
  it("says the passage is not on the page rather than marking something near it", async () => {
    const wrong: Finding[] = [{ ...QUOTED[0]!, sourceQuote: "Pyridine is thought to be hepatotoxic" }];
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={wrong} />);
    expect(await screen.findByText(/not on this page as written/i)).toBeInTheDocument();
    expect(marks()).toHaveLength(0);
  });

  it("keeps who cited a finding sealed while the case is blind", async () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={QUOTED} />);
    expect(await screen.findByText(/sealed until the case is revealed/i)).toBeInTheDocument();
    expect(screen.queryByText(/A\. Silva/)).not.toBeInTheDocument();
  });

  it("shows who cited it and why once the positions are revealed", async () => {
    const positions: Position[] = [{
      participantId: "u_1", call: "do_not_advance", reasoning: "Not advanceable without a mechanism.",
      citedFindingIds: ["g1"], external: [], submittedAt: "2026-08-16T00:00:00.000Z",
    }];
    render(
      <Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={QUOTED}
        positions={positions} people={[{ id: "u_1", displayName: "A. Silva" }]} seats={{ u_1: 0 }} />,
    );
    expect(await screen.findByText("A. Silva")).toBeInTheDocument();
    expect(screen.getByText("Do not advance")).toBeInTheDocument();
    expect(screen.getByText("Not advanceable without a mechanism.")).toBeInTheDocument();
    expect(screen.queryByText(/sealed until/i)).not.toBeInTheDocument();
  });

  /**
   * The silent case, and the one that actually reached a reader: a finding that names
   * a page but no passage renders an unmarked page, which looks exactly like a
   * highlighter that has stopped working.
   */
  it("says a finding recorded no passage rather than leaving the page silently unmarked", async () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={LINKED_FINDINGS} />);
    // One per unquoted finding, naming its own page - g1 cites 88 and g2 cites 141,
    // and a single shared notice would leave a reader guessing which is unmarked.
    const said = await screen.findAllByText(/No passage recorded/i);
    expect(said).toHaveLength(2);
    expect(said.map((p) => p.textContent)).toEqual([
      expect.stringContaining("page 88"),
      expect.stringContaining("page 141"),
    ]);
    expect(marks()).toHaveLength(0);
  });

  it("says nothing of the sort when the finding does carry a passage", async () => {
    render(<Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={QUOTED} />);
    await waitFor(() => { expect(marks().length).toBeGreaterThan(0); });
    expect(screen.queryByText(/No passage recorded/i)).not.toBeInTheDocument();
  });

  it("says so when a revealed case simply has no citation for a finding", async () => {
    render(
      <Read caseId="c1" token="tok_test" documentId="doc_1" documents={DOCS} findings={QUOTED}
        positions={[]} people={[]} seats={{}} />,
    );
    expect(await screen.findByText(/No position cited this finding/i)).toBeInTheDocument();
  });
});
