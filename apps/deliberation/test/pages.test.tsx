import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AskPage } from "../src/pages.js";
import type { CaseListing } from "../src/api.js";

const listing = (over: Partial<CaseListing> = {}): CaseListing => ({
  caseId: "c1", compoundLabel: "TAK-994", status: "open", isOwner: true,
  submitted: 0, of: 2, documents: 0, ...over,
});

/**
 * The case picker is a list of CASES, and the thing it has to answer questions about
 * is DOCUMENTS. Those are not the same set: a case is opened before anything is
 * uploaded to it, and a case with an empty folder can be asked nothing at all.
 */
describe("AskPage case picker", () => {
  const empty = listing({ caseId: "empty", compoundLabel: "TAK-994", documents: 0 });
  const full = listing({ caseId: "full", compoundLabel: "Turalio", documents: 2 });

  it("opens on the first case that HAS documents, not simply the first case", () => {
    // Opening on an empty folder means every question comes back "the documents do
    // not say", which reads as the model refusing rather than as nothing uploaded.
    render(<AskPage token="t" cases={[empty, full]} />);
    expect(screen.getByLabelText("Which case")).toHaveValue("full");
  });

  it("says how many documents each case holds, so an empty one is visible unopened", () => {
    render(<AskPage token="t" cases={[empty, full]} />);
    expect(screen.getByRole("option", { name: /TAK-994 - no documents/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Turalio - 2 documents/ })).toBeInTheDocument();
  });

  it("takes no question against a case with an empty folder, and says where to upload", () => {
    render(<AskPage token="t" cases={[empty, full]} />);
    fireEvent.change(screen.getByLabelText("Which case"), { target: { value: "empty" } });
    expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
    expect(screen.getByText(/No documents in this case yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /upload/i })).toHaveAttribute("href", "#/case/empty");
  });

  it("still asks against a case that has documents", () => {
    render(<AskPage token="t" cases={[empty, full]} />);
    expect(screen.getByLabelText("Your question")).toBeInTheDocument();
  });

  it("falls back to the first case when no case has documents, and refuses the question", () => {
    // The picker must still list them: a reader who uploaded to the wrong case needs
    // to see that the right one is empty, which a hidden entry cannot tell them.
    render(<AskPage token="t" cases={[empty, listing({ caseId: "other", compoundLabel: "Troglitazone" })]} />);
    expect(screen.getByLabelText("Which case")).toHaveValue("empty");
    expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
  });
});
