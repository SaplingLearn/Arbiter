import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { refusalFor, type CaseName } from "./cases.js";

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
  name: CaseName;
  label: string;
  /** Repo-relative path, so a reader can open the file the answer cites. */
  document: string;
  askable: boolean;
  /** Why not. Verbatim from the splitter where there is one. Absent when askable. */
  reason?: string;
}

/** What a source is before the filesystem has been consulted. */
export interface SourceFile {
  name: CaseName;
  label: string;
  /** null where the case was never built from a document at all. */
  path: string | null;
}

/**
 * Declared askable-first, which `list` preserves inside each group. The labels name
 * the DOCUMENT rather than the compound - the picker is choosing what to search, and
 * "Turalio" is a case whereas "FDA NDA 211810 multi-disciplinary review" is a file.
 */
export const LIBRARY_SOURCES: SourceFile[] = [
  {
    name: "turalio",
    label: "Turalio (pexidartinib) - FDA NDA 211810 multi-disciplinary review",
    path: "data/raw/approval-packages/turalio-211810-multidiscipline.pdf",
  },
  {
    name: "nipocalimab",
    label: "Imaavy (nipocalimab) - EMA CHMP assessment report",
    path: "data/raw/approval-packages/ema-epar-sample-imaavy.pdf",
  },
  {
    name: "slynd",
    label: "Slynd (drospirenone) - FDA NDA 211367 multi-disciplinary review",
    path: "data/raw/approval-packages/modern-fda-multidiscipline-211367.pdf",
  },
  {
    name: "tak994",
    label: "TAK-994 (narcolepsy) - extracted findings, no source PDF",
    path: null,
  },
  {
    name: "tolcapone",
    label: "Tolcapone (Tasmar) - FDA medical review, 1998",
    path: "data/raw/approval-packages/tolcapone-20697-medical-review-p1.pdf",
  },
  {
    name: "troglitazone",
    label: "Troglitazone (Rezulin) - FDA approval package, 1997",
    path: "data/raw/approval-packages/troglitazone-020720-approval.pdf",
  },
];

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
        const refused = refusalFor(s.name);
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
  filenameFor(name: CaseName): string {
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
  textFor(name: CaseName, python = process.env["PYTHON"] ?? "python"): { page: number; text: string }[] {
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
      const parsed = JSON.parse(out) as { ok: boolean; pages?: { page: number; text: string }[] };
      const pages = parsed.ok && parsed.pages !== undefined ? parsed.pages : [];
      writeFileSync(cache, JSON.stringify(pages), "utf8");
      return pages;
    } catch {
      return [];
    }
  }
}
