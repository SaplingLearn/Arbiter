import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AskPage, bucketOf } from "../src/pages.js";
import { api, type CaseListing, type LibrarySource } from "../src/api.js";

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

  it("names the file the answers are read from", () => {
    render(<AskPage token="t" library={library} />);
    expect(screen.getByText("turalio-211810-multidiscipline.pdf")).toBeInTheDocument();
  });

  it("prints no filename for an entry that has no source PDF", () => {
    // The server writes "-" for a case assembled from extracted findings. Rendered
    // literally that is a stray hyphen in the scope bar with nothing to explain it.
    render(<AskPage token="t" library={[source({ name: "tak994", document: "-", askable: false, reason: "No source document." })]} />);
    expect(screen.queryByText("-")).not.toBeInTheDocument();
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

  it("asks the document it is showing when the library arrives after the first render", async () => {
    /**
     * THE PAGE WAS INERT ON ARRIVAL. App.tsx fetches the library after mount, so
     * AskPage's first render gets `[]`. The selection used to be seeded by a
     * `useState` initialiser, which runs exactly once - on that empty render - so it
     * was fixed at "" forever while the `<select>` displayed Turalio, because a select
     * whose value matches no option falls back to option zero. `send` and `summarise`
     * both return early on `source === ""`, so every chip and button did nothing at
     * all, with no request and no error, until the dropdown was changed by hand.
     *
     * Rerendering with a library the first render did not have is the exact sequence.
     */
    const ask = vi.spyOn(api, "askLibrary").mockResolvedValue({
      answerable: true, answer: "a", citedPassages: [], citations: [], historyTurnsUsed: 0,
    });
    const { rerender } = render(<AskPage token="t" library={[]} />);
    rerender(<AskPage token="t" library={library} />);

    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "what NOAEL was set" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(ask.mock.calls[0]![1], "the question must go to the document on screen").toBe("turalio");
  });

  it("falls back when the pick no longer names a document the library holds", () => {
    // A selection is a preference, not a fact about the list. If the library reloads
    // without that entry the page must land on something real rather than on "".
    const { rerender } = render(<AskPage token="t" library={library} />);
    fireEvent.change(screen.getByLabelText("Which document"), { target: { value: "tolcapone" } });
    expect(screen.getByLabelText("Which document")).toHaveValue("tolcapone");

    rerender(<AskPage token="t" library={[source()]} />);
    expect(screen.getByLabelText("Which document")).toHaveValue("turalio");
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

/**
 * WHICH PILE A CASE GOES IN, and the one that used to be wrong.
 *
 * The dashboard groups by what a case needs FROM THE READER, because "what is waiting on
 * me" is the only question a person opens a dashboard to answer. That made the grouping
 * dependent on a fact the listing did not carry - whether the reader had answered - and
 * `bucketOf` inferred it from `submitted < of`, which is true of a case where three of
 * four have answered whether or not the reader is one of the three.
 *
 * So a participant who had already submitted kept finding their case under "Needs your
 * position". Now `youSubmitted` says it outright, and both this and the card's stage tag
 * read it from `stageOf`, so the pile and the label cannot disagree.
 */
describe("bucketing a case by what it needs from the reader", () => {
  const listing = (over: Partial<CaseListing> = {}): CaseListing => ({
    caseId: "c1", compoundLabel: "TAK-994", status: "open", isOwner: false,
    submitted: 0, of: 4, documents: 0, youSubmitted: false, ...over,
  });

  it("asks an unanswered participant for their position", () => {
    expect(bucketOf(listing({ submitted: 1, of: 4, youSubmitted: false }))).toBe("yours");
  });

  /** The regression. Three of four in, the reader among them: the old inference put this
   *  under "needs your position" and there was nothing left for them to do. */
  it("does not ask again once the reader has answered, with the room still out", () => {
    expect(bucketOf(listing({ submitted: 3, of: 4, youSubmitted: true }))).toBe("waiting");
  });

  it("never asks the convener for a position they cannot hold", () => {
    expect(bucketOf(listing({ isOwner: true, submitted: 2, of: 4 }))).toBe("waiting");
  });

  it("puts a locked case in front of the convener and nobody else", () => {
    expect(bucketOf(listing({ status: "locked", isOwner: true, submitted: 4, of: 4 }))).toBe("sign");
    expect(bucketOf(listing({ status: "locked", isOwner: false, submitted: 4, of: 4 }))).toBe("waiting");
  });

  it("does the same for an adjudicated case, which still needs signing", () => {
    expect(bucketOf(listing({ status: "adjudicated", isOwner: true }))).toBe("sign");
    expect(bucketOf(listing({ status: "adjudicated", isOwner: false }))).toBe("waiting");
  });

  it("closes a signed case for everyone, convener included", () => {
    expect(bucketOf(listing({ status: "signed", isOwner: true }))).toBe("closed");
    expect(bucketOf(listing({ status: "signed", isOwner: false }))).toBe("closed");
  });

  /** An unrecognised status is somebody else's problem until this bundle is rebuilt -
   *  never the reader's, because telling them to act on a stage the client cannot name
   *  is worse than leaving it in the pile they scan rather than the pile they work. */
  it("files a status it does not recognise as in progress, not as the reader's", () => {
    expect(bucketOf(listing({ status: "escalated" }))).toBe("waiting");
  });
});
