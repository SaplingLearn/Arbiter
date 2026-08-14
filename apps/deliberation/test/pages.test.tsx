import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AskPage } from "../src/pages.js";
import { api, type LibrarySource } from "../src/api.js";

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

describe("AskPage composer while an answer is in flight", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  /** A request that never settles - a summary mid-flight, or a server killed under it. */
  const hangs = (method: "askLibrary" | "summarise"): void => {
    vi.spyOn(api, method).mockReturnValue(new Promise(() => {}) as never);
  };

  it("lets you keep typing while an answer is on its way", async () => {
    // The textarea used to be disabled for the whole request. A question takes 12-18
    // seconds and a summary 84, so the input a reader reaches for is dead exactly when
    // they have thought of the next thing to ask - and a request that never settles
    // left it dead until the page was reloaded.
    hangs("askLibrary");
    render(<AskPage token="t" library={[source()]} />);
    const box = screen.getByLabelText("Your question");
    fireEvent.change(box, { target: { value: "what NOAEL was set" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Reading..." })).toBeDisabled());
    expect(box).toBeEnabled();
    fireEvent.change(box, { target: { value: "and the recovery phase?" } });
    expect(box).toHaveValue("and the recovery phase?");
  });

  it("lets you keep typing through a summary, which is the longest wait here", async () => {
    hangs("summarise");
    render(<AskPage token="t" library={[source()]} />);
    fireEvent.click(screen.getByRole("button", { name: "Summarise this document" }));

    await waitFor(() => expect(screen.getByText(/Reading the whole document/)).toBeInTheDocument());
    const box = screen.getByLabelText("Your question");
    expect(box).toBeEnabled();
    fireEvent.change(box, { target: { value: "what liver findings are reported" } });
    expect(box).toHaveValue("what liver findings are reported");
  });

  it("says why Enter did nothing, rather than swallowing the keystroke in silence", async () => {
    // Typing is allowed while busy; SENDING a second question is not, because the
    // thread is one conversation. That distinction has to be on screen or the reader
    // presses Enter, sees nothing, and concludes the box is broken.
    hangs("askLibrary");
    render(<AskPage token="t" library={[source()]} />);
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reading..." })).toBeDisabled());

    const box = screen.getByLabelText("Your question");
    fireEvent.change(box, { target: { value: "second" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByText(/still reading/i)).toBeInTheDocument();
    expect(box).toHaveValue("second");
  });
});
