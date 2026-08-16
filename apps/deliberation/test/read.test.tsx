import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Read, highlightsFor } from "../src/read.js";
import type { Finding, StoredDocument } from "../src/api.js";

// PdfView's dynamic `import("pdfjs-dist")` is mocked for the whole file: no test
// here needs the real renderer (the PDF canvas itself is explicitly out of scope -
// see the brief), and a mock that always rejects makes the error-surfacing test
// below deterministic and instant rather than depending on a real, and here
// unreachable, network fetch failing on its own schedule. No other test in this
// file inspects the .pdfview area, so the rejection is harmless everywhere else.
vi.mock("pdfjs-dist", () => ({
  getDocument: () => ({
    promise: Promise.reject(new Error("simulated load failure")),
    destroy: () => Promise.resolve(),
  }),
  GlobalWorkerOptions: {},
}));

// The CLIENT StoredDocument (api.ts:91) has no caseId and REQUIRES measurement -
// it is not the server's StoredDocument. Scoping is enforced server-side by the
// endpoint, so the client type carries no caseId and does not need one.
const doc = (id: string, filename: string): StoredDocument => ({
  id, filename, bytes: 10, uploadedBy: "u_a", uploadedAt: "2026-08-15T00:00:00.000Z",
  measurement: { ok: true, reason: "fixture" },
});
const DOCS: StoredDocument[] = [doc("doc_1", "turalio.pdf"), doc("doc_2", "krazati.pdf")];

const FINDINGS: Finding[] = [
  { id: "f1", label: "hepatocellular necrosis", assertion: "toxic", detail: "d", sourceDocument: "turalio.pdf", sourcePage: 112 },
  { id: "f2", label: "no liver signal", assertion: "safe", detail: "d", sourceDocument: "krazati.pdf", sourcePage: 40 },
  { id: "f3", label: "unsourced", assertion: "ambiguous", detail: "d" },
  // Matches the open document by filename but carries no page - the case the drop
  // test below actually needs. f1 alone could not exercise the drop, because f1
  // already has a sourcePage; a highlightsFor that forgot the page check entirely
  // would still have passed a test that only looked at f1.
  { id: "f4", label: "cited, page never recorded", assertion: "ambiguous", detail: "d", sourceDocument: "turalio.pdf" },
];

describe("read screen", () => {
  it("lists every document on the case", () => {
    render(<Read caseId="c1" documents={DOCS} findings={FINDINGS} />);
    expect(screen.getByText("turalio.pdf")).toBeInTheDocument();
    expect(screen.getByText("krazati.pdf")).toBeInTheDocument();
  });

  it("says so plainly when the case has no documents", () => {
    render(<Read caseId="c1" documents={[]} findings={[]} />);
    expect(screen.getByText(/no documents/i)).toBeInTheDocument();
  });

  // Findings already carry sourceDocument/sourcePage on every case in data/cases,
  // so the document arrives pre-annotated with what extraction found before a
  // single mark exists.
  it("takes only the findings sourced to the open document", () => {
    expect(highlightsFor(FINDINGS, "doc_1", "turalio.pdf").map((f) => f.id)).toEqual(["f1"]);
  });

  it("drops findings with no page, rather than guessing one", () => {
    const forDoc = highlightsFor(FINDINGS, "doc_1", "turalio.pdf");
    // f4 matches turalio.pdf by filename - the same match f1 satisfies - and is
    // excluded purely because it has no sourcePage. This is the assertion that
    // actually fails if the page check is ever dropped from highlightsFor; see the
    // task-8-report.md mutation-testing note for the regression check.
    expect(forDoc.some((f) => f.id === "f4")).toBe(false);
    expect(forDoc.every((f) => f.sourcePage !== undefined)).toBe(true);
    expect(highlightsFor(FINDINGS, "doc_9", "nothing.pdf")).toEqual([]);
  });

  // The document strip navigates through real anchors (href()), so switching
  // documents is a URL change, not local state. Confirms both ends of that: the
  // route's documentId picks which document is open, and there is no useState
  // seeded once from a prop that a later navigation could leave stale.
  it("opens the document named by the documentId prop, not always the first one", () => {
    render(<Read caseId="c1" documentId="doc_2" documents={DOCS} findings={FINDINGS} />);
    const krazati = screen.getByText("krazati.pdf");
    expect(krazati.closest("a")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("turalio.pdf").closest("a")).not.toHaveAttribute("aria-current");
  });

  it("links every document in the strip through href(), not a click handler", () => {
    render(<Read caseId="c1" documents={DOCS} findings={FINDINGS} />);
    expect(screen.getByText("turalio.pdf").closest("a")).toHaveAttribute(
      "href", "#/case/c1/read/doc_1",
    );
    expect(screen.getByText("krazati.pdf").closest("a")).toHaveAttribute(
      "href", "#/case/c1/read/doc_2",
    );
  });

  // The load rejects (mocked above) rather than resolving. A blank canvas with no
  // explanation leaves a reviewer unable to tell "nothing here" from "something
  // broke" - the area must say so instead of staying silent.
  it("surfaces a message when the PDF fails to load, instead of leaving the canvas blank", async () => {
    render(<Read caseId="c1" documentId="doc_1" documents={DOCS} findings={FINDINGS} />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not open turalio\.pdf/i);
    expect(alert).toHaveTextContent(/simulated load failure/i);
  });
});
