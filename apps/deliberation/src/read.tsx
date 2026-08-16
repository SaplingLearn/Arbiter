import { useEffect, useRef, useState, type ReactElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api, type CaseListing, type Finding, type StoredDocument } from "./api.js";
import { PageHead, Section } from "./Layout.js";
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

export function Read({ caseId, token, documentId, page, documents, findings }: {
  caseId: string;
  /** Sent to pdf.js for the `/raw` fetch. See `PdfView` - it is not decoration. */
  token: string;
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
          <PdfView caseId={caseId} token={token} document={open} highlights={highlights}
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
function PdfView({ caseId, token, document: doc, page, highlights, unresolved }: {
  caseId: string; token: string; document: StoredDocument; page?: number;
  highlights: Finding[]; unresolved: number;
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
        /**
         * THE TOKEN GOES WITH THIS REQUEST, and until it did the viewer could not open
         * a single document.
         *
         * pdf.js does not use `api.ts`. Handed a bare URL it makes its OWN request for
         * the bytes, and that request carried no `Authorization` header - so `/raw`,
         * which sits behind the same `can(kase, user.id, "read")` guard as every other
         * case route, answered 401 every time. Everything around it worked: the strip
         * listed documents, the findings rail filled, the deep link resolved. The
         * document itself never arrived.
         *
         * Nothing caught it. The tests in read.test.tsx mock `pdfjs-dist` wholesale, so
         * `getDocument` there never performs a request at all; server.test.ts calls
         * `/raw` directly WITH a header, proving the route works for a caller that
         * sends one. The one thing neither covers is the only thing the product does.
         *
         * `httpHeaders` rather than fetching the bytes here and passing `data`: the
         * server sets an etag and `must-revalidate` specifically so page turns in a
         * 264-page review do not re-download it, and pulling the whole file into an
         * ArrayBuffer ourselves would throw that away along with pdf.js's own
         * incremental loading.
         */
        const loadingTask = getDocument({
          url: `/api/cases/${caseId}/documents/${doc.id}/raw`,
          httpHeaders: { Authorization: `Bearer ${token}` },
        });
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
  }, [caseId, doc.id, token]);

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

/** ------------------------------------------------------- the reading room */

/**
 * WHAT A DOCUMENT ROW SAYS ABOUT ITSELF, and why it is a page count rather than a
 * verdict badge.
 *
 * `measure_pdf.py` runs on every upload and its numbers are already on the record, so
 * the honest thing to put beside a filename is what it measured. Page count is the one
 * figure that changes what a reader does next - a 288-page review and a four-page
 * summary are different afternoons - and it is the figure the reader is about to be
 * dropped into the middle of.
 *
 * NOT a `.state` chip. Those are the safety vocabulary (present / absent /
 * inconclusive) and they are green, red and amber; Layout's note that one heavy colour
 * is spent only on a safety call is exactly what a green "4 pages" would break. An
 * unmeasured document says so rather than showing a zero, because a zero here is a
 * claim that the file has no pages.
 */
function extent(d: StoredDocument): string {
  const pages = d.measurement.pages;
  if (pages === undefined) return "unmeasured";
  return pages === 1 ? "1 page" : `${pages} pages`;
}

/**
 * THE READING ROOM — every document this account can open, across every case it is
 * named on.
 *
 * WHY THIS EXISTS AT ALL. `read` is a case route: it needs a caseId, and a menu entry
 * has none. Reading was therefore reachable only by opening a case and taking the
 * second stage tab, which puts the product's most-used verb three clicks behind a
 * case list - and made the rail claim, silently, that a reader looking at a stained
 * section was standing in the Archive. This page is the top-level route that entry
 * needed; `{ name: "reading" }` in router.ts records why it is a separate route name.
 *
 * IT LISTS DOCUMENTS, NOT CASES, and that is the whole difference between this and the
 * dashboard. A launcher that stopped at "Turalio — 3 documents" would land every
 * reader on whichever document happens to be first and make them pick again; the
 * dashboard already lists cases, and a second list of the same cases is not a feature.
 * So each case's documents are fetched and each one is its own link, straight to
 * `{ name: "read", caseId, documentId }`.
 *
 * ONLY CASES THAT HOLD DOCUMENTS ARE FETCHED. `CaseListing.documents` is a count the
 * server already computed, so a case with none costs no request - and the ones skipped
 * are stated at the foot rather than silently dropped, because a reader who cannot
 * find a case they know they are on should be told why it is not here.
 */
export function ReadingRoom({ token, mine }: {
  token: string;
  mine: CaseListing[];
}): ReactElement {
  const stocked = mine.filter((c) => c.documents > 0);
  const empty = mine.length - stocked.length;

  /**
   * `null` while the lists are in flight; a case id maps to "unavailable" when its own
   * request failed.
   *
   * PER CASE, NOT ONE FLAG FOR THE PAGE. One failed request out of four should cost
   * the reader that one shelf, not the three that loaded - and it must not be drawn as
   * an empty case, which would say that a case with documents has none.
   */
  const [shelves, setShelves] = useState<Record<string, StoredDocument[] | "unavailable"> | null>(null);

  /**
   * Keyed on WHAT THIS PAGE ACTUALLY READS - the cases and how many documents each
   * holds - rather than on `mine` itself. `mine` is refetched after every action in
   * the app and arrives as a new array each time, so depending on it would re-request
   * every document list whenever an unrelated position count moved. When this key is
   * unchanged there is nothing new to fetch, and when it changes the effect closes
   * over a fresh `stocked` because it re-runs during that render.
   */
  const key = stocked.map((c) => `${c.caseId}:${c.documents}`).join(",");

  useEffect(() => {
    if (stocked.length === 0) {
      setShelves({});
      return undefined;
    }
    let cancelled = false;
    setShelves(null);

    void (async () => {
      const entries = await Promise.all(stocked.map(async (c) => {
        try {
          return [c.caseId, await api.documents(token, c.caseId)] as const;
        } catch {
          // Swallowed per case ON PURPOSE. This page is a way in to reading, and one
          // unreachable case is not a reason to replace the other three with an error
          // screen. The row says it could not be listed and still links to the case's
          // own reader, which is the one place that can report the real failure.
          return [c.caseId, "unavailable"] as const;
        }
      }));
      if (cancelled) return;
      setShelves(Object.fromEntries(entries));
    })();

    return () => { cancelled = true; };
  }, [token, key]);

  const head = (
    <PageHead
      eyebrow="Read"
      title="Read the evidence"
      lede="Every document on the cases you are named on. Opening one draws what extraction already found on top of its pages."
    />
  );

  if (mine.length === 0) {
    return (
      <>
        {head}
        <div className="empty">
          <h3>No cases yet</h3>
          <p className="muted">
            Documents belong to a case. Open one for a compound you are deciding about,
            or start from a prepared case in the library.
          </p>
          <div className="btn-row" style={{ marginTop: 0, justifyContent: "center" }}>
            <a href={href({ name: "new" })}><button className="primary">Create a case</button></a>
            <a href={href({ name: "cases" })}><button className="ghost">Browse the library</button></a>
          </div>
        </div>
      </>
    );
  }

  if (stocked.length === 0) {
    return (
      <>
        {head}
        <div className="empty">
          <h3>Nothing to read yet</h3>
          <p className="muted">
            {mine.length === 1
              ? "The case you are on holds no documents."
              : `None of the ${mine.length} cases you are on holds a document.`}
            {" "}Study PDFs are uploaded on a case's Evidence stage, and every one is
            measured before it is accepted.
          </p>
          <a href={href({ name: "dashboard" })}><button className="primary">Go to your cases</button></a>
        </div>
      </>
    );
  }

  return (
    <>
      {head}
      {shelves === null
        ? <p className="muted">Looking for documents…</p>
        : (
          <div className="stack-l">
            {stocked.map((c) => {
              const docs = shelves[c.caseId];
              return (
                <Section key={c.caseId} title={c.compoundLabel}
                  count={c.documents === 1 ? "1 document" : `${c.documents} documents`}>
                  {docs === undefined || docs === "unavailable"
                    ? (
                      <p className="small muted">
                        This case's documents could not be listed just now.{" "}
                        <a href={href({ name: "read", caseId: c.caseId })}>Open it in the reader</a>{" "}
                        to see the failure in full.
                      </p>
                    )
                    : docs.length === 0
                      ? (
                        // The count said there were documents and the list came back
                        // empty. Said plainly rather than drawn as a tidy empty
                        // section, because the two numbers disagreeing is the fact.
                        <p className="small muted">
                          This case reported {c.documents} document{c.documents === 1 ? "" : "s"} and
                          returned none. Open it in the reader to see what is actually there.
                        </p>
                      )
                      : (
                        <div className="inv">
                          {docs.map((d) => (
                            <a className="inv-row" key={d.id}
                              href={href({ name: "read", caseId: c.caseId, documentId: d.id })}>
                              <div className="tiny muted mono">{extent(d)}</div>
                              <div>
                                {d.filename}
                                {/* The refusal reason, when the store kept a document
                                    it could not read. It is the measurement's own
                                    sentence and nothing here paraphrases it. */}
                                {!d.measurement.ok && (
                                  <div className="ref">{d.measurement.reason}</div>
                                )}
                              </div>
                            </a>
                          ))}
                        </div>
                      )}
                </Section>
              );
            })}

            {empty > 0 && (
              <p className="small muted">
                {empty === 1
                  ? "One other case you are on holds no documents yet."
                  : `${empty} other cases you are on hold no documents yet.`}
              </p>
            )}
          </div>
        )}
    </>
  );
}
