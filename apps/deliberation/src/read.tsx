import { useEffect, useRef, useState, type ReactElement } from "react";
import type { Finding, StoredDocument } from "./api.js";
import { href } from "./router.js";

/**
 * The findings that belong on this document's pages.
 *
 * Matched on FILENAME, because Finding.sourceDocument holds the filename that the
 * extraction wrote, not a document id - the findings in data/cases predate any
 * upload. Matching is exact: a fuzzy match would silently attach a finding to the
 * wrong 288-page review, and a highlight pointing at the wrong study is worse than
 * no highlight.
 *
 * A finding with no sourcePage is DROPPED rather than defaulted to page 1. There is
 * no honest page to put it on, and page 1 of an FDA review is a cover sheet.
 */
export function highlightsFor(findings: Finding[], _documentId: string, filename: string): Finding[] {
  return findings.filter((f) => f.sourceDocument === filename && f.sourcePage !== undefined);
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
  const open = documents.find((d) => d.id === documentId) ?? documents[0] ?? null;
  const marks = open === null ? [] : highlightsFor(findings, open.id, open.filename);

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
      {open !== null && (
        <PdfView caseId={caseId} document={open} highlights={marks} {...(page === undefined ? {} : { page })} />
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
 */
function PdfView({ caseId, document: doc, page, highlights }: {
  caseId: string; document: StoredDocument; page?: number; highlights: Finding[];
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shown = page ?? 1;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | undefined;
    setError(null);

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
        const pdf = await loadingTask.promise;
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
        // A load that was cancelled - the effect cleaned up before it settled,
        // because the document or page changed again, or the screen was left - is
        // not an error a reader should ever see. Anything else (a wrong-case 404, a
        // corrupted PDF, the network dropping mid-fetch) IS one: a blank canvas with
        // no explanation leaves a reviewer unable to tell "nothing here" from
        // "something broke," with no way to tell which.
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => { cancelled = true; void task?.destroy(); };
  }, [caseId, doc.id, shown]);

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
        {highlights.length === 0
          ? <p className="small muted">No finding on this case cites this document.</p>
          : highlights.map((f) => (
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
          ))}
      </aside>
    </div>
  );
}
