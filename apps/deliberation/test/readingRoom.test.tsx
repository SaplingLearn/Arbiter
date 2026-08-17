import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { CaseListing, StoredDocument } from "../src/api.js";

/**
 * THE READING ROOM — the top-level way in to reading, which the product did not have.
 *
 * A SEPARATE FILE FROM read.test.tsx, and not for tidiness. That file mocks
 * `pdfjs-dist` for its whole length because it is testing a PDF viewer; this page never
 * touches pdf.js and mocks `api.js` instead, which that file deliberately does not.
 * Sharing one file would mean every test here ran under a PDF engine stub it has no
 * use for, and every test there under an API stub that would hide the props they pass.
 *
 * WHAT IS WORTH TESTING HERE is not the markup. It is that the page fetches document
 * lists for the cases that have documents AND NO OTHERS, that one case failing costs
 * the reader that case rather than the page, and that every empty state says something
 * true - the three places this kind of launcher goes quietly wrong.
 */

type Documents = (token: string, caseId: string) => Promise<StoredDocument[]>;
const documents = vi.fn<Documents>();

vi.mock("../src/api.js", async () => {
  const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
  return { ...actual, api: { documents: (t: string, c: string) => documents(t, c) } };
});

const { ReadingRoom } = await import("../src/read.js");

beforeEach(() => { documents.mockReset(); documents.mockResolvedValue([]); });

/** A case listing. `documents` is the count the server already computed. */
const kase = (caseId: string, compoundLabel: string, docs: number): CaseListing => ({
  caseId, compoundLabel, status: "open", isOwner: false, submitted: 0, of: 3, documents: docs,
});

/** A stored document, measured and accepted unless a test says otherwise. */
const doc = (id: string, filename: string, m: Partial<StoredDocument["measurement"]> = {}): StoredDocument => ({
  id, filename, bytes: 1024, uploadedBy: "u1", uploadedAt: "2026-08-16T00:00:00.000Z",
  measurement: { ok: true, reason: "accepted", pages: 288, ...m },
});

const room = (mine: CaseListing[]): ReturnType<typeof render> =>
  render(<ReadingRoom token="t" mine={mine} />);

describe("what it lists", () => {
  it("gives every document its own link into the reader", async () => {
    documents.mockResolvedValue([doc("d1", "turalio-211810.pdf"), doc("d2", "ema-chmp.pdf")]);
    room([kase("c1", "Turalio", 2)]);

    const first = await screen.findByRole("link", { name: /turalio-211810\.pdf/ });
    expect(first).toHaveAttribute("href", "#/case/c1/read/d1");
    expect(screen.getByRole("link", { name: /ema-chmp\.pdf/ }))
      .toHaveAttribute("href", "#/case/c1/read/d2");
  });

  // The point of the page. A launcher that stopped at the case would land every reader
  // on documents[0] and make them pick again, which is what the case reader already
  // does - so the room would be a second copy of the dashboard.
  it("links to the document, never to the bare case reader", async () => {
    documents.mockResolvedValue([doc("d1", "turalio-211810.pdf")]);
    room([kase("c1", "Turalio", 1)]);

    await screen.findByRole("link", { name: /turalio-211810\.pdf/ });
    expect(screen.queryByRole("link", { name: /^Turalio$/ })).toBeNull();
    for (const a of screen.getAllByRole("link")) {
      expect(a.getAttribute("href")).not.toBe("#/case/c1/read");
    }
  });

  it("groups documents under the case they belong to", async () => {
    documents.mockImplementation(async (_t, c) =>
      (c === "c1" ? [doc("d1", "turalio-211810.pdf")] : [doc("d2", "tak-994.pdf")]));
    room([kase("c1", "Turalio", 1), kase("c2", "TAK-994", 1)]);

    const turalio = (await screen.findByRole("heading", { name: "Turalio" })).closest("section");
    expect(within(turalio!).getByRole("link", { name: /turalio-211810\.pdf/ })).toBeInTheDocument();
    expect(within(turalio!).queryByRole("link", { name: /tak-994\.pdf/ })).toBeNull();
  });

  it("states the page count, because it is what decides the afternoon", async () => {
    documents.mockResolvedValue([doc("d1", "long.pdf", { pages: 288 }), doc("d2", "short.pdf", { pages: 1 })]);
    room([kase("c1", "Turalio", 2)]);

    expect(await screen.findByText("288 pages")).toBeInTheDocument();
    expect(screen.getByText("1 page")).toBeInTheDocument();
  });

  // A zero here would be a claim that the file has no pages. It has an unknown number.
  it("says unmeasured rather than showing a zero page count", async () => {
    // The measurement genuinely has no `pages` KEY, rather than one set to undefined -
    // which is what a document measured before that field existed looks like on disk.
    documents.mockResolvedValue([
      { ...doc("d1", "odd.pdf"), measurement: { ok: true, reason: "accepted" } },
    ]);
    room([kase("c1", "Turalio", 1)]);

    expect(await screen.findByText("unmeasured")).toBeInTheDocument();
    expect(screen.queryByText("0 pages")).toBeNull();
  });

  // The measurement's own sentence, unparaphrased - the same rule the library page and
  // the upload gate follow.
  it("carries the refusal reason on a document that was not readable", async () => {
    documents.mockResolvedValue([
      doc("d1", "scanned.pdf", { ok: false, reason: "48 of 48 pages carry almost no extractable text." }),
    ]);
    room([kase("c1", "Turalio", 1)]);

    expect(await screen.findByText("48 of 48 pages carry almost no extractable text."))
      .toBeInTheDocument();
  });
});

describe("what it asks the server for", () => {
  /**
   * `CaseListing.documents` is a count the server already computed, so a case holding
   * none costs no request at all. Getting this wrong is invisible on screen and shows
   * up only as a page that fires a request per case on every visit.
   */
  it("fetches only the cases that hold documents", async () => {
    documents.mockResolvedValue([doc("d1", "a.pdf")]);
    room([kase("c1", "Turalio", 1), kase("c2", "Empty", 0), kase("c3", "TAK-994", 3)]);

    await waitFor(() => expect(documents).toHaveBeenCalledTimes(2));
    expect(documents.mock.calls.map((c) => c[1])).toEqual(["c1", "c3"]);
  });

  it("sends the token with every request", async () => {
    documents.mockResolvedValue([doc("d1", "a.pdf")]);
    room([kase("c1", "Turalio", 1)]);

    await waitFor(() => expect(documents).toHaveBeenCalledWith("t", "c1"));
  });

  // Keyed on the cases and their document counts, not on `mine` itself - which is a new
  // array after every action in the app. Re-rendering with an equivalent list must not
  // re-request anything.
  it("does not refetch when an unrelated field on the listing moves", async () => {
    documents.mockResolvedValue([doc("d1", "a.pdf")]);
    const view = room([kase("c1", "Turalio", 1)]);
    await waitFor(() => expect(documents).toHaveBeenCalledTimes(1));

    view.rerender(<ReadingRoom token="t" mine={[{ ...kase("c1", "Turalio", 1), submitted: 2 }]} />);
    await screen.findByRole("link", { name: /a\.pdf/ });
    expect(documents).toHaveBeenCalledTimes(1);
  });

  it("does refetch when a case gains a document", async () => {
    documents.mockResolvedValue([doc("d1", "a.pdf")]);
    const view = room([kase("c1", "Turalio", 1)]);
    await waitFor(() => expect(documents).toHaveBeenCalledTimes(1));

    view.rerender(<ReadingRoom token="t" mine={[kase("c1", "Turalio", 2)]} />);
    await waitFor(() => expect(documents).toHaveBeenCalledTimes(2));
  });
});

describe("when something is missing", () => {
  it("points a reader with no cases at the two ways to get one", () => {
    room([]);
    expect(screen.getByRole("heading", { name: "No cases yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Create a case/ })).toHaveAttribute("href", "#/new");
    expect(screen.getByRole("link", { name: /Browse the library/ })).toHaveAttribute("href", "#/library");
  });

  it("says where documents come from when no case holds one", () => {
    room([kase("c1", "Turalio", 0), kase("c2", "TAK-994", 0)]);
    expect(screen.getByRole("heading", { name: "Nothing to read yet" })).toBeInTheDocument();
    expect(screen.getByText(/Evidence stage/)).toBeInTheDocument();
    expect(documents).not.toHaveBeenCalled();
  });

  it("counts the cases it left out rather than dropping them silently", async () => {
    documents.mockResolvedValue([doc("d1", "a.pdf")]);
    room([kase("c1", "Turalio", 1), kase("c2", "Empty", 0), kase("c3", "Also empty", 0)]);

    expect(await screen.findByText(/2 other cases you are on hold no documents yet\./))
      .toBeInTheDocument();
  });

  it("says nothing about omitted cases when none were omitted", async () => {
    documents.mockResolvedValue([doc("d1", "a.pdf")]);
    room([kase("c1", "Turalio", 1)]);

    await screen.findByRole("link", { name: /a\.pdf/ });
    expect(screen.queryByText(/no documents yet\./)).toBeNull();
  });

  /**
   * ONE FAILED CASE COSTS ONE SHELF. A page-wide error would replace three cases that
   * loaded with a screen about the one that did not - and drawing the failed case as
   * empty would be worse still, since that says a case with documents has none.
   */
  it("keeps the cases that loaded when one of them fails", async () => {
    documents.mockImplementation(async (_t, c) => {
      if (c === "c2") throw new Error("network");
      return [doc("d1", "a.pdf")];
    });
    room([kase("c1", "Turalio", 1), kase("c2", "TAK-994", 1)]);

    expect(await screen.findByRole("link", { name: /a\.pdf/ })).toBeInTheDocument();
    expect(screen.getByText(/could not be listed just now/)).toBeInTheDocument();
  });

  it("still offers a way into a case whose list failed", async () => {
    documents.mockRejectedValue(new Error("network"));
    room([kase("c1", "Turalio", 1)]);

    const link = await screen.findByRole("link", { name: /Open it in the reader/ });
    expect(link).toHaveAttribute("href", "#/case/c1/read");
  });

  // The count said there were documents and the list came back empty. Stating that the
  // two disagree beats drawing a tidy empty section, which would blame the case.
  it("says so when the count and the list disagree", async () => {
    documents.mockResolvedValue([]);
    room([kase("c1", "Turalio", 3)]);

    expect(await screen.findByText(/reported 3 documents and\s+returned none/))
      .toBeInTheDocument();
  });

  it("shows that it is still looking before the lists arrive", () => {
    documents.mockReturnValue(new Promise(() => { /* never settles */ }));
    room([kase("c1", "Turalio", 1)]);

    expect(screen.getByText("Looking for documents…")).toBeInTheDocument();
  });
});
