import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AskPage } from "../src/pages.js";
import type { LibrarySource } from "../src/api.js";

const source = (over: Partial<LibrarySource> = {}): LibrarySource => ({
  name: "turalio", label: "Turalio - FDA NDA 211810 review",
  document: "data/raw/approval-packages/turalio-211810-multidiscipline.pdf",
  askable: true, ...over,
});

/**
 * Ask searches the LIBRARY. Case folders are read inside their case, next to the
 * findings transcribed from them; this surface is the library's regulatory reviews,
 * which need no case and no upload.
 */
describe("AskPage document picker", () => {
  const refused = source({
    name: "tolcapone", label: "Tolcapone - FDA medical review, 1998", askable: false,
    reason: "48 of 48 pages carry almost no extractable text - this is a scanned document and needs OCR before anything can read it. REFUSED.",
  });
  const library = [source(), refused];

  it("lists the library's documents", () => {
    render(<AskPage token="t" library={library} />);
    expect(screen.getByRole("option", { name: /Turalio - FDA NDA 211810 review/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Tolcapone.*cannot be searched/ })).toBeInTheDocument();
  });

  it("opens on a document that can be searched, not simply the first one", () => {
    render(<AskPage token="t" library={[refused, source()]} />);
    expect(screen.getByLabelText("Which document")).toHaveValue("turalio");
  });

  it("keeps a refused document SELECTABLE and gives the splitter's reason", () => {
    // The library page makes the same call: choosing a refused document shows the
    // refusal rather than hiding it. Greying it out would leave a reader who wants
    // tolcapone with a name and no explanation.
    render(<AskPage token="t" library={library} />);
    fireEvent.change(screen.getByLabelText("Which document"), { target: { value: "tolcapone" } });
    expect(screen.getByText(/this is a scanned document/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
  });

  it("offers a summary of the whole document, at every point in a thread", () => {
    // "Give a summary of this document" cannot be served by retrieval - eight pages
    // picked by word overlap are not the document - so the summary is its own request
    // and its own button rather than a question somebody has to phrase correctly.
    render(<AskPage token="t" library={library} />);
    expect(screen.getByRole("button", { name: "Summarise this document" })).toBeEnabled();
  });

  it("offers no summary of a document that cannot be read at all", () => {
    render(<AskPage token="t" library={[refused]} />);
    expect(screen.queryByRole("button", { name: "Summarise this document" })).not.toBeInTheDocument();
  });

  it("says there is nothing to ask when the library holds no readable document", () => {
    render(<AskPage token="t" library={[]} />);
    expect(screen.getByText(/Nothing to ask yet/)).toBeInTheDocument();
  });
});
