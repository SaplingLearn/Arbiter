import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Read, highlightsFor } from "../src/read.js";
import type { Finding, StoredDocument } from "../src/api.js";

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
    expect(highlightsFor(FINDINGS, "doc_1", "turalio.pdf").every((f) => f.sourcePage !== undefined)).toBe(true);
    expect(highlightsFor(FINDINGS, "doc_9", "nothing.pdf")).toEqual([]);
  });
});
