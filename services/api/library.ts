import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isCaseName, refusalFor } from "./cases.js";
import { stripBoilerplate } from "./pages.js";

/**
 * The library's own documents, as things that can be ASKED rather than opened.
 *
 * WHY THIS EXISTS SEPARATELY FROM DocumentStore. That store holds what somebody
 * uploaded to a case: bytes written under `results/documents`, owned by an account,
 * reachable only through the case access boundary. These are different objects with a
 * different provenance - public regulatory reviews that ship with the product, the
 * same files the prepared cases were transcribed from - and the difference is not
 * cosmetic. Copying them into the upload store would give every one of them an
 * `uploadedBy`, put them in some case's document list, and make a public FDA review
 * indistinguishable from unpublished safety data a team uploaded. So they stay where
 * they are and this reads them in place.
 *
 * WHAT IS ASKABLE IS DECIDED HERE, AND FOR THREE DIFFERENT REASONS, which the reader
 * must be able to tell apart:
 *
 *   - The splitter refused it. `data/prep/split_review.py` said why, `cases.ts` keeps
 *     the sentence verbatim, and so does this. Tolcapone is a photograph of a
 *     document; troglitazone is the wrong document entirely.
 *   - There is no source document. TAK-994 is a usable case assembled from extracted
 *     JSON, and no PDF behind it is a different fact from a PDF that would not read.
 *   - The file is not in this checkout. `data/raw/approval-packages/` is gitignored -
 *     21MB of files retrievable from accessdata.fda.gov and ema.europa.eu by the URLs
 *     the spec records - so a fresh clone has none of them. Saying "nothing in the
 *     document matches that question" for a file that is absent would be a lie about
 *     the document rather than a report about the checkout.
 *
 * All three end as `askable: false` with a reason a reader can act on, and none of
 * them is a thrown error: an absent library is a smaller surface, not a broken server.
 */

/** A document the library can search, or a stated reason why it cannot. */
export interface LibrarySource {
  /**
   * Stable id, and NOT a CaseName any more.
   *
   * The library began as the documents the six prepared cases were transcribed from,
   * so the two lists were the same list. They are not: a document is askable whether
   * or not anybody has hand-transcribed findings out of it, and the benchmark needs
   * documents in quantity while cases are made one at a time by a person. Every
   * catalogue case still has a source here - the test holds that - but the library is
   * now the larger set.
   */
  name: string;
  label: string;
  /** Repo-relative path, so a reader can open the file the answer cites. */
  document: string;
  askable: boolean;
  /** Why not. Verbatim from the splitter where there is one. Absent when askable. */
  reason?: string;
}

/** What a source is before the filesystem has been consulted. */
export interface SourceFile {
  name: string;
  label: string;
  /** null where the case was never built from a document at all. */
  path: string | null;
}

/**
 * The documents, read from `data/library-sources.json`.
 *
 * NOT A LIST IN THIS FILE, and it was one until the benchmark needed eleven more
 * documents and every addition meant editing TypeScript. A registry of what a
 * deployment holds is data: adding a review is a line of JSON and a file in
 * data/raw/approval-packages, and nobody has to recompile to change what is on offer.
 *
 * Order matters and is preserved: `list()` sorts only by askability, so the order
 * declared in the file survives inside each group and the picker does not shuffle
 * between page loads.
 */
export const SOURCES_PATH = "data/library-sources.json";

export function loadSources(path = SOURCES_PATH): SourceFile[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { sources: SourceFile[] }).sources;
}

export const LIBRARY_SOURCES: SourceFile[] = loadSources();

export class LibraryStore {
  private readonly cacheRoot: string;
  private readonly sources: SourceFile[];

  constructor(opts: { cacheRoot?: string; sources?: SourceFile[] } = {}) {
    this.cacheRoot = opts.cacheRoot ?? "results/library";
    this.sources = opts.sources ?? LIBRARY_SOURCES;
    mkdirSync(this.cacheRoot, { recursive: true });
  }

  /**
   * Every source, askable ones first.
   *
   * The sort is by askability ALONE and Array.prototype.sort is stable, so the order
   * declared above survives inside each group. Sorting on the reason as well would
   * reorder the list whenever a file was fetched or deleted, and a picker whose
   * entries move between page loads is a picker people mis-click.
   */
  list(): LibrarySource[] {
    return this.sources
      .map((s): LibrarySource => {
        const refused = isCaseName(s.name) ? refusalFor(s.name) : null;
        if (refused !== null) {
          return { name: s.name, label: s.label, document: refused.document, askable: false, reason: refused.splitterReason };
        }
        if (s.path === null) {
          return {
            name: s.name, label: s.label, document: "-", askable: false,
            reason: "This case was assembled from extracted findings and has no source document in the repository, so there is nothing here to search. Its findings and their pages are on the case itself.",
          };
        }
        if (!existsSync(s.path)) {
          return {
            name: s.name, label: s.label, document: s.path, askable: false,
            reason: `${s.path} is not in this checkout. The approval-package PDFs are not committed - each is retrievable from accessdata.fda.gov or ema.europa.eu by the URL the spec records.`,
          };
        }
        return { name: s.name, label: s.label, document: s.path, askable: true };
      })
      .sort((a, b) => Number(b.askable) - Number(a.askable));
  }

  /** The filename an answer's citation carries. The full path is what a reader needs
   *  to open the file; the basename is what fits in a citation row. */
  filenameFor(name: string): string {
    const source = this.sources.find((s) => s.name === name);
    return source?.path === null || source?.path === undefined ? "-" : basename(source.path);
  }

  /**
   * The document's text, one entry per page.
   *
   * Cached to `results/library/<name>.pages.json` rather than beside the PDF, for the
   * same reason DocumentStore caches beside its own: this is derived data that costs a
   * re-extraction and nothing else, and `data/raw` holds inputs. Contract is
   * DocumentStore.textFor's exactly - an empty array on every failure, so an
   * unreadable document becomes an honest "nothing matches" instead of a 500 that
   * names no document.
   */
  textFor(name: string, python = process.env["PYTHON"] ?? "python"): { page: number; text: string }[] {
    const cache = join(this.cacheRoot, `${name}.pages.json`);
    if (existsSync(cache)) {
      try {
        return JSON.parse(readFileSync(cache, "utf8")) as { page: number; text: string }[];
      } catch {
        // A corrupt cache is a cache miss, not a failure.
      }
    }

    const source = this.sources.find((s) => s.name === name);
    if (source?.path === null || source?.path === undefined || !existsSync(source.path)) return [];

    try {
      const out = execFileSync(python, ["data/prep/extract_pdf_text.py", source.path], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      const parsed = JSON.parse(out) as { ok: boolean; pages?: { page: number; text: string }[]; reason?: string };
      if (!parsed.ok) console.error(`library: ${name} could not be extracted - ${parsed.reason ?? "no reason given"}`);
      // Furniture removed once, here, so every reader downstream is spared it: the
      // retriever, the passages a question is answered from, and the whole document a
      // summary walks. See pages.ts for what it costs to leave in.
      const pages = stripBoilerplate(parsed.ok && parsed.pages !== undefined ? parsed.pages : []);
      writeFileSync(cache, JSON.stringify(pages), "utf8");
      return pages;
    } catch (e) {
      // LOGGED, not swallowed. An extraction that fails silently is indistinguishable
      // on screen from a document that says nothing about the question - the reader is
      // told "nothing matches" and the operator is told nothing at all. This is the
      // only place the actual reason exists.
      console.error(`library: ${name} could not be read - ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }
}
