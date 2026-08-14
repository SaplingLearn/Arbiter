import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AskPage } from "../src/pages.js";
import type { CaseListing, LibrarySource } from "../src/api.js";

const listing = (over: Partial<CaseListing> = {}): CaseListing => ({
  caseId: "c1", compoundLabel: "TAK-994", status: "open", isOwner: true,
  submitted: 0, of: 2, documents: 0, ...over,
});

const source = (over: Partial<LibrarySource> = {}): LibrarySource => ({
  name: "turalio", label: "Turalio - FDA NDA 211810 review",
  document: "data/raw/approval-packages/turalio-211810-multidiscipline.pdf",
  askable: true, ...over,
});

/**
 * What Ask searches is a DOCUMENT. Cases were the only way to name one, which meant
 * the surface could not reach the library's own regulatory reviews at all - the
 * documents the prepared cases were transcribed from, sitting in the repo, unaskable.
 */
describe("AskPage source picker", () => {
  const refused = source({
    name: "tolcapone", label: "Tolcapone - FDA medical review, 1998", askable: false,
    reason: "48 of 48 pages carry almost no extractable text - this is a scanned document and needs OCR before anything can read it. REFUSED.",
  });
  const empty = listing({ caseId: "empty", compoundLabel: "TAK-994", documents: 0 });
  const full = listing({ caseId: "full", compoundLabel: "Nipocalimab", documents: 2 });

  const all = { library: [source(), refused], cases: [empty, full] };

  it("lists the library's documents and the reader's cases, in separate groups", () => {
    render(<AskPage token="t" {...all} />);
    expect(screen.getByRole("group", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Your cases" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Turalio - FDA NDA 211810 review/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Nipocalimab - 2 documents/ })).toBeInTheDocument();
  });

  it("opens on a library document that can be searched", () => {
    // Not on cases[0]: a case is opened before anything is uploaded to it, so the
    // first case is routinely empty, and every question there returns "the documents
    // do not say" - which reads as the model refusing rather than as an empty folder.
    render(<AskPage token="t" {...all} />);
    expect(screen.getByLabelText("Which document")).toHaveValue("lib:turalio");
  });

  it("keeps a refused document SELECTABLE and gives the splitter's reason", () => {
    // The library page makes the same call: choosing a refused document shows the
    // refusal rather than hiding the document. Greying it out would leave a reader
    // who wants tolcapone with a name and no explanation.
    render(<AskPage token="t" {...all} />);
    fireEvent.change(screen.getByLabelText("Which document"), { target: { value: "lib:tolcapone" } });
    expect(screen.getByText(/this is a scanned document/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
  });

  it("takes no question against a case with an empty folder, and says where to upload", () => {
    render(<AskPage token="t" {...all} />);
    fireEvent.change(screen.getByLabelText("Which document"), { target: { value: "case:empty" } });
    expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /upload/i })).toHaveAttribute("href", "#/case/empty");
  });

  it("asks against a case that holds documents", () => {
    render(<AskPage token="t" {...all} />);
    fireEvent.change(screen.getByLabelText("Which document"), { target: { value: "case:full" } });
    expect(screen.getByLabelText("Your question")).toBeInTheDocument();
  });

  it("falls back to a case with documents when no library document can be searched", () => {
    render(<AskPage token="t" library={[refused]} cases={[empty, full]} />);
    expect(screen.getByLabelText("Which document")).toHaveValue("case:full");
  });

  it("says there is nothing to ask when neither the library nor any case holds a document", () => {
    render(<AskPage token="t" library={[]} cases={[]} />);
    expect(screen.getByText(/Nothing to ask yet/)).toBeInTheDocument();
  });
});
