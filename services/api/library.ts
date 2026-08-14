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
  // The benchmark set, added 2026-08-14. Every one is an FDA multi-disciplinary
  // review of an approved drug, fetched from accessdata.fda.gov by NDA number and
  // screened with data/prep/measure_pdf.py before being listed here: 188-398 pages
  // each, 362,000-899,000 extractable characters, zero sparse pages.
  //
  // Chosen to VARY along the axis the product cares about, because a set that only
  // contains drugs with liver findings measures willingness to say "danger" and
  // nothing else - which is the exact failure HANDOVER section 13 records. Turalio
  // carries a boxed warning for hepatotoxicity; Lumakras, Retevmo, Trikafta, Krazati
  // and Inrebic report liver findings without one; Orgovyx, Qinlock, Nubeqa, Xpovio,
  // Tazverik and Exkivity are approved drugs whose labels carry no liver warning at
  // all; and Slynd is a 505(b)(2) with no new nonclinical studies, where the only
  // correct answer to most questions is that the document does not say.
  {
    name: "lumakras",
    label: "Lumakras (sotorasib) - FDA NDA 214665 multi-disciplinary review",
    path: "data/raw/approval-packages/lumakras-214665-multidiscipline.pdf",
  },
  {
    name: "retevmo",
    label: "Retevmo (selpercatinib) - FDA NDA 213246 multi-disciplinary review",
    path: "data/raw/approval-packages/retevmo-213246-multidiscipline.pdf",
  },
  {
    name: "trikafta",
    label: "Trikafta (elexacaftor/tezacaftor/ivacaftor) - FDA NDA 212273 multi-disciplinary review",
    path: "data/raw/approval-packages/trikafta-212273-multidiscipline.pdf",
  },
  {
    name: "krazati",
    label: "Krazati (adagrasib) - FDA NDA 216340 multi-disciplinary review",
    path: "data/raw/approval-packages/krazati-216340-multidiscipline.pdf",
  },
  {
    name: "inrebic",
    label: "Inrebic (fedratinib) - FDA NDA 212327 multi-disciplinary review",
    path: "data/raw/approval-packages/inrebic-212327-multidiscipline.pdf",
  },
  {
    name: "orgovyx",
    label: "Orgovyx (relugolix) - FDA NDA 214621 multi-disciplinary review",
    path: "data/raw/approval-packages/orgovyx-214621-multidiscipline.pdf",
  },
  {
    name: "qinlock",
    label: "Qinlock (ripretinib) - FDA NDA 213973 multi-disciplinary review",
    path: "data/raw/approval-packages/qinlock-213973-multidiscipline.pdf",
  },
  {
    name: "nubeqa",
    label: "Nubeqa (darolutamide) - FDA NDA 212099 multi-disciplinary review",
    path: "data/raw/approval-packages/nubeqa-212099-multidiscipline.pdf",
  },
  {
    name: "xpovio",
    label: "Xpovio (selinexor) - FDA NDA 212306 multi-disciplinary review",
    path: "data/raw/approval-packages/xpovio-212306-multidiscipline.pdf",
  },
  {
    name: "tazverik",
    label: "Tazverik (tazemetostat) - FDA NDA 211723 multi-disciplinary review",
    path: "data/raw/approval-packages/tazverik-211723-multidiscipline.pdf",
  },
  {
    name: "exkivity",
    label: "Exkivity (mobocertinib) - FDA NDA 215310 multi-disciplinary review",
    path: "data/raw/approval-packages/exkivity-215310-multidiscipline.pdf",
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
