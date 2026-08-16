import { useEffect, useRef, useState, type ReactElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Finding, StoredDocument } from "./api.js";
import { href } from "./router.js";

/**
 * Does this finding point at this document?
 *
 * TWO KEYS, IN THIS ORDER, AND THE ORDER IS THE WHOLE POINT.
 *
 * `sourceDocumentId` is the exact join: the server validated it against the case
 * when the finding was created (server.ts, the `findings` POST), so an id that
 * survives to here names a document that really is on this case. Findings written
 * in-app through FindingsEditor carry it.
 *
 * `sourceDocument` is the fallback, and it only helps for findings whose extraction
 * happened to write a filename there. It is NOT what the seed cases in `data/cases/`
 * hold: those record a DOSSIER identifier - "FDA NDA 211810", "EMA/CHMP/290491/2025" -
 * beside a separate `_source.localFile` naming the actual PDF. So a seed finding does
 * not resolve to an upload, and this deliberately does not try to make it: inferring
 * that "FDA NDA 211810" means `turalio-211810-multidiscipline.pdf` is the guess
 * inventory.ts refuses by name ("Coverage is DECLARED, never inferred"), and it fails
 * in the dangerous direction - a highlight on the wrong 288-page review is worse than
 * no highlight at all. The aside says so instead; see `unresolvedCitations`.
 */
function pointsAt(f: Finding, documentId: string, filename: string): boolean {
  return f.sourceDocumentId !== undefined
    ? f.sourceDocumentId === documentId
    : f.sourceDocument === filename;
}

/**
 * The findings that belong on this document's pages.
 *
 * A finding with no sourcePage is DROPPED rather than defaulted to page 1. There is
 * no honest page to put it on, and page 1 of an FDA review is a cover sheet.
 */
export function highlightsFor(findings: Finding[], documentId: string, filename: string): Finding[] {
  return findings.filter((f) => f.sourcePage !== undefined && pointsAt(f, documentId, filename));
}

/**
 * Findings that name a page but no document on this case - the seed-case shape.
 *
 * Counted so the empty rail can say what is actually true. "No finding on this case
 * cites this document" asserts that nobody cited anything, which on every shipped
 * case is false: the findings cite a dossier the uploads are not linked to. Stating
 * the false version teaches a reviewer that the extraction found nothing here, which
 * is the opposite of the case.
 */
export function unresolvedCitations(findings: Finding[], documents: StoredDocument[]): number {
  return findings.filter((f) =>
    f.sourcePage !== undefined
    && !documents.some((d) => pointsAt(f, d.id, d.filename)),
  ).length;
}

export function Read({ caseId, documentId, page, documents, findings }: {
  caseId: string;
  documentId?: string;
  page?: number;
  documents: StoredDocument[];
  findings: Finding[];
}): ReactElement {
  // Derived from props on every render, NEVER held in local state. The route's
  // documentId is the single source of truth for which document is open: a
  // `useState` seeded once from it goes stale the moment the prop changes after
  // mount, and - worse - it lets the document strip below switch documents without
  // ever touching the hash. That breaks the back button, copy-paste-the-URL, and
  // "share this document at this page" all at once, which defeats the entire reason
  // the read route carries a documentId and a page in the first place.
  //
  // A NAMED-BUT-UNKNOWN id does NOT fall back to documents[0]. The bare
  // `#/case/:id/read` form has no opinion about which document to open, so the first
  // one is the only sensible answer there. But a URL that names a document is making
  // a claim, and silently rendering a DIFFERENT document under it - with
  // aria-current on the wrong strip entry and the hash never corrected - leaves the
  // URL and the screen disagreeing with no signal at all. The server answers exactly
  // this id with a 404 for the same reason; the client should not paper over it.
  const named = documentId === undefined ? null : documents.find((d) => d.id === documentId) ?? null;
  const open = documentId === undefined ? documents[0] ?? null : named;
  const highlights = open === null ? [] : highlightsFor(findings, open.id, open.filename);

  if (documents.length === 0) {
    return (
      <section>
        <p className="small muted">
          No documents on this case yet. Upload a study PDF on the Evidence stage and it will
          open here.
        </p>
      </section>
    );
  }

  return (
    <section className="read">
      <nav aria-label="Case documents">
        {documents.map((d) => (
          <a key={d.id} className="ghost" aria-current={d.id === open?.id ? "true" : undefined}
            href={href({ name: "read", caseId, documentId: d.id })}>
            {d.filename}
          </a>
        ))}
      </nav>
      {open === null
        ? (
          <p className="err" role="alert">
            That document is not on this case. Pick one of the documents above.
          </p>
        )
        : (
          <PdfView caseId={caseId} document={open} highlights={highlights}
            unresolved={unresolvedCitations(findings, documents)}
            {...(page === undefined ? {} : { page })} />
        )}
    </section>
  );
}

/**
 * pdf.js is loaded with a dynamic `import()` inside the effect rather than at module
 * scope. Two reasons, not one: the document LIST above is testable without a PDF
 * engine at all, so a top-level import would force jsdom to load pdf.js (canvas,
 * worker, the `?url` asset) just to render a `<nav>` of filenames; and the viewer
 * genuinely does not need pdf.js until a document is actually open, so this is also
 * just the right load boundary, not a workaround for the test.
 *
 * The `import type` at the top of this file is erased at compile time and pulls in
 * nothing at runtime, so holding a typed PDFDocumentProxy in state costs no load.
 */
function PdfView({ caseId, document: doc, page, highlights, unresolved }: {
  caseId: string; document: StoredDocument; page?: number; highlights: Finding[];
  unresolved: number;
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shown = page ?? 1;
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);

  /**
   * TWO EFFECTS, BECAUSE FETCHING AND PAINTING ARE NOT THE SAME EVENT.
   *
   * This was one effect keyed on `[caseId, doc.id, shown]`, which meant turning a
   * page re-ran `getDocument(...)` - a fresh download and a fresh parse of the whole
   * file. The target here is a 264-page FDA review, and `/raw` is a plain stream, so
   * paging through a document re-fetched tens of megabytes per page turn.
   *
   * The document load is keyed on the document; the page render is keyed on the
   * loaded proxy and the page number. `loadingTask.destroy()` still runs from the
   * LOAD effect's cleanup, which is what tears the worker and the proxy down.
   */
  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | undefined;
    setError(null);
    setPdf(null);

    void (async () => {
      try {
        const [{ getDocument, GlobalWorkerOptions }, { default: workerUrl }] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);
        // Bundled from node_modules by Vite, never fetched from a CDN. This app holds
        // unpublished safety data; a third-party origin in the critical path of
        // rendering it is not a trade this project makes.
        GlobalWorkerOptions.workerSrc = workerUrl;

        if (cancelled) return;
        const loadingTask = getDocument(`/api/cases/${caseId}/documents/${doc.id}/raw`);
        task = loadingTask;
        const loaded = await loadingTask.promise;
        if (cancelled) return;
        setPdf(loaded);
      } catch (e) {
        // A load that was cancelled - the effect cleaned up before it settled,
        // because the document changed again, or the screen was left - is not an
        // error a reader should ever see. Anything else (a wrong-case 404, a
        // corrupted PDF, the network dropping mid-fetch) IS one: a blank canvas with
        // no explanation leaves a reviewer unable to tell "nothing here" from
        // "something broke," with no way to tell which.
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => { cancelled = true; void task?.destroy(); };
  }, [caseId, doc.id]);

  useEffect(() => {
    if (pdf === null) return undefined;
    let cancelled = false;
    // Only reachable with a document already loaded, so this can never wipe a load
    // failure off the screen - it clears a render failure from a PREVIOUS page when
    // the reader moves off it.
    setError(null);

    void (async () => {
      try {
        // Clamp rather than throw: a stale deep link to page 400 of a 288-page review
        // should land on the last page, not on an error screen.
        const p = await pdf.getPage(Math.min(Math.max(shown, 1), pdf.numPages));
        if (cancelled || canvas.current === null) return;
        const viewport = p.getViewport({ scale: 1.4 });
        const ctx = canvas.current.getContext("2d");
        if (ctx === null) return;
        canvas.current.width = viewport.width;
        canvas.current.height = viewport.height;
        await p.render({ canvasContext: ctx, viewport }).promise;
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => { cancelled = true; };
  }, [pdf, shown]);

  return (
    <div className="pdfview">
      {error === null
        ? <canvas ref={canvas} aria-label={`${doc.filename} page ${shown}`} />
        : (
          <p className="err" role="alert">
            Could not open {doc.filename}: {error}
          </p>
        )}
      <aside aria-label="Findings sourced to this document">
        {highlights.length > 0
          ? highlights.map((f) => (
            <a key={f.id} className="finding-row"
              href={href({
                name: "read", caseId, documentId: doc.id,
                // highlightsFor guarantees sourcePage is set on everything reaching this
                // map, but the type is still `number | undefined` (exactOptionalPropertyTypes
                // forbids assigning that straight to an optional field), so it's spread in
                // rather than asserted away.
                ...(f.sourcePage === undefined ? {} : { page: f.sourcePage }),
              })}>
              <span className="pip">p.{f.sourcePage}</span> {f.label}
            </a>
          ))
          : unresolved > 0
            ? (
              <p className="small muted">
                {unresolved === 1
                  ? "One finding on this case cites a page"
                  : `${unresolved} findings on this case cite a page`}
                {" "}of a source that is not linked to any upload here - the case records a
                dossier identifier rather than a file, and nothing guesses which upload it
                meant. Re-add the finding against a document to place it on a page.
              </p>
            )
            : <p className="small muted">No finding on this case cites this document.</p>}
      </aside>
    </div>
  );
}
