import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIBRARY_SOURCES, LibraryStore } from "../library.js";
import { CATALOGUE, refusalFor } from "../cases.js";

const store = (over: Partial<ConstructorParameters<typeof LibraryStore>[0]> = {}): LibraryStore =>
  new LibraryStore({ cacheRoot: mkdtempSync(join(tmpdir(), "arb-lib-")), ...over });

describe("the askable library", () => {
  it("offers one source per catalogue entry, so the two lists cannot drift apart", () => {
    // A document that is in the library but not in this list is a document a reader
    // can open a case from and then cannot ask a question about, with no explanation.
    expect(LIBRARY_SOURCES.map((s) => s.name).sort()).toEqual(CATALOGUE.map((c) => c.name).sort());
  });

  it("refuses a document the splitter refused, in the splitter's own words", () => {
    // Not a paraphrase: `cases.ts` keeps the refusal verbatim precisely so nobody
    // softens "this is a scanned document" into "this document is unavailable".
    const tolcapone = store().list().find((s) => s.name === "tolcapone");
    expect(tolcapone?.askable).toBe(false);
    expect(tolcapone?.reason).toBe(refusalFor("tolcapone")?.splitterReason);
  });

  it("refuses a document that is not in this checkout, and names the path", () => {
    // data/raw/approval-packages is gitignored - a fresh clone has none of these
    // files. Offering them anyway would answer "nothing matches that question" for
    // a document that is not there at all.
    const only = [{ name: "turalio" as const, label: "Turalio", path: "data/raw/approval-packages/not-here.pdf" }];
    const s = store({ sources: only }).list()[0]!;
    expect(s.askable).toBe(false);
    expect(s.reason).toContain("data/raw/approval-packages/not-here.pdf");
  });

  it("refuses a case built from no document at all", () => {
    // TAK-994 is a usable CASE assembled from extracted JSON. There is no PDF behind
    // it, which is a different fact from a PDF that failed to read.
    const tak = store().list().find((s) => s.name === "tak994");
    expect(tak?.askable).toBe(false);
    expect(tak?.reason).toMatch(/no source document/i);
  });

  it("puts what can be asked first, keeping the declared order inside each group", () => {
    const askable = store().list().map((s) => s.askable);
    expect([...askable].sort((a, b) => Number(b) - Number(a))).toEqual(askable);
  });

  it("reads a cached extraction without going near the PDF", () => {
    // The cache is what keeps PyMuPDF off the path of a surface people use
    // conversationally, so it has to work for a file that is not even present.
    const cacheRoot = mkdtempSync(join(tmpdir(), "arb-lib-"));
    writeFileSync(join(cacheRoot, "turalio.pages.json"), JSON.stringify([{ page: 7, text: "hepatic necrosis" }]), "utf8");
    const s = new LibraryStore({
      cacheRoot,
      sources: [{ name: "turalio", label: "Turalio", path: "data/raw/approval-packages/not-here.pdf" }],
    });
    expect(s.textFor("turalio")).toEqual([{ page: 7, text: "hepatic necrosis" }]);
  });

  it("returns no pages, rather than throwing, for a document it cannot read", () => {
    // Same contract as DocumentStore.textFor: an unreadable document must become an
    // honest "nothing matches", never a 500 that names no document.
    const s = store({ sources: [{ name: "turalio", label: "Turalio", path: "data/raw/approval-packages/not-here.pdf" }] });
    expect(s.textFor("turalio")).toEqual([]);
  });
});
