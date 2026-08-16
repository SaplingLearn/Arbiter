import { useEffect, useRef, useState, type ReactElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { api, type Call, type CaseListing, type Finding, type Position, type StoredDocument } from "./api.js";
import { PageHead, Section } from "./Layout.js";
import { Reviewer } from "./Reviewer.js";
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

/** One reviewer's use of one finding, as it can be shown once the case is open. */
export interface Citation {
  participantId: string;
  name: string;
  /** The seat colour, so a person is the same colour here as everywhere else. */
  seat: number | null;
  call: Call;
  reasoning: string;
}

/** The three calls, spelled for a reader rather than for the wire. */
const CALL_WORDS: Record<Call, string> = {
  advance: "Advance",
  do_not_advance: "Do not advance",
  cannot_conclude: "Cannot conclude",
};

/**
 * Who cited which finding, from the positions the SERVER chose to release.
 *
 * BLINDNESS IS NOT ENFORCED HERE AND MUST NOT BE. `BlindView.revealed` is null until
 * the case is closed because `visibleTo` on the server refuses to send positions, not
 * because this function declines to read them - the handoff is explicit that any new
 * reading surface goes inside the same guard "or the blind stage stops meaning
 * anything". Passing null therefore yields no citations, and that is the whole of the
 * client's involvement in the rule.
 *
 * The reason it matters that this attribution exists at all: after reveal, "two people
 * cited this and both called it Do not advance" is the fact a reader most wants beside
 * the passage. Before reveal, that same fact is exactly the anchoring the two-phase
 * design exists to prevent, and a tally is what spec §6.4 forbids.
 */
export function citationsFor(
  positions: Position[] | null,
  people: { id: string; displayName: string }[],
  seats: Record<string, number>,
): (findingId: string) => Citation[] {
  if (positions === null) return () => [];
  return (findingId: string) =>
    positions
      .filter((p) => p.citedFindingIds.includes(findingId))
      .map((p) => ({
        participantId: p.participantId,
        name: people.find((m) => m.id === p.participantId)?.displayName ?? p.participantId,
        seat: seats[p.participantId] ?? null,
        call: p.call,
        reasoning: p.reasoning,
      }));
}

export function Read({ caseId, token, documentId, page, documents, findings, positions, people, seats }: {
  caseId: string;
  /** Sent to pdf.js for the `/raw` fetch. See `PdfView` - it is not decoration. */
  token: string;
  documentId?: string;
  page?: number;
  documents: StoredDocument[];
  findings: Finding[];
  /** Null while the case is blind. Never assembled client-side; see `citationsFor`. */
  positions?: Position[] | null;
  people?: { id: string; displayName: string }[];
  seats?: Record<string, number>;
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
            citers={citationsFor(positions ?? null, people ?? [], seats ?? {})}
            blind={(positions ?? null) === null}
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
/**
 * The rasterisation scale used until the column has been measured - the old fixed
 * scale, kept as the fallback rather than as the answer. Server-side rendering, a
 * detached tree and jsdom all reach the painting code before any layout exists, and a
 * page rendered at a scale of zero is a zero-by-zero canvas: an invisible document
 * with nothing on screen to say so.
 */
const UNMEASURED_SCALE = 1.4;

/** A rectangle over the page, in CSS pixels relative to the canvas box. */
export interface Mark { left: number; top: number; width: number; height: number }

/**
 * Drop whitespace entirely, because a PDF's is not evidence of anything.
 *
 * THIS IS NOT FUZZY MATCHING, and the line between the two is the point of the whole
 * file. A PDF has no notion of a word, let alone a sentence: `getTextContent` returns
 * positioned fragments split wherever the typesetter changed something, and it splits
 * MID-WORD. The real page this was built against breaks like this:
 *
 *     "...No mortality in the repeat"  +  "-dose toxicity studies were"
 *
 * An earlier version of this joined fragments with a space, produced "repeat -dose",
 * and could therefore never match the sentence a reader had copied off the screen. It
 * reported the quote as absent every time, which was at least honest and completely
 * useless.
 *
 * So both sides have their whitespace removed and are compared character for
 * character. Every character that carries meaning still has to be identical: no case
 * folding, no stemming, no punctuation stripping, no edit distance, no "close
 * enough". A quote either appears on the page or it is reported as absent.
 */
function bare(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * Where a quote sits on a page, or nothing at all.
 *
 * Walks the text items in reading order, keeping a running offset into the flattened
 * page text, and returns a rectangle for every item the matched span touches - one
 * per fragment, so a quote crossing a line break marks both lines rather than drawing
 * one enormous box around the paragraph between them.
 *
 * Returns [] when the quote is not on the page. The caller SAYS SO rather than
 * quietly rendering an unmarked page: a reader who was promised a highlight and sees
 * none has no way to tell "the quote is wrong" from "the highlighter is broken", and
 * on a safety document those are very different problems.
 */
export function highlightRects(
  items: { str: string; transform: number[]; width: number; height: number }[],
  quote: string,
  transform: number[],
): Mark[] {
  const needle = bare(quote);
  if (needle === "") return [];

  // The page with its whitespace gone, plus where each fragment lands inside it.
  // Built in one pass so the offsets and the string can never disagree, and with no
  // separator between fragments - inserting one is exactly the bug described above.
  let page = "";
  const spans: { from: number; to: number; item: (typeof items)[number] }[] = [];
  for (const item of items) {
    const text = bare(item.str);
    if (text === "") continue;
    const from = page.length;
    page += text;
    spans.push({ from, to: page.length, item });
  }

  const at = page.indexOf(needle);
  if (at < 0) return [];
  const end = at + needle.length;

  const marks: Mark[] = [];
  for (const s of spans) {
    // Half-open overlap: an item ending exactly where the match starts is not part
    // of it, and neither is one starting exactly where the match ends.
    if (s.to <= at || s.from >= end) continue;
    const m = s.item.transform;
    /**
     * Multiply the item's matrix by the viewport's, by hand.
     *
     * pdf.js exports `Util.transform` for this, but importing it drags the utility
     * module into a file whose tests mock the whole library - and the operation is
     * six multiplies. `e`/`f` land on the text BASELINE in CSS pixels, which is why
     * the height comes off the matrix below and is subtracted to find the top.
     */
    const x = transform[0]! * m[4]! + transform[2]! * m[5]! + transform[4]!;
    const y = transform[1]! * m[4]! + transform[3]! * m[5]! + transform[5]!;
    const height = Math.hypot(transform[1]! * m[1]!, transform[3]! * m[3]!) || Math.abs(transform[3]! * s.item.height);
    const full = Math.abs(transform[0]!) * s.item.width;

    /**
     * CLIPPED TO THE QUOTED CHARACTERS, not spread over the whole fragment.
     *
     * The fragment carrying a match usually carries more than the match: the one this
     * was built against reads "...cynomolgus monkeys (<=9 months). No mortality in the
     * repeat", of which only the tail was quoted. Marking the fragment whole draws a
     * highlight over a sentence the reviewer never cited, which is the same wrong
     * claim as marking the wrong paragraph, only smaller.
     *
     * The position within the fragment is interpolated by character count. That is an
     * approximation OF WHERE TO DRAW - the text match itself is still exact - and it
     * is the only approximation in this file. Per-glyph advances would be truer, and
     * would mean shipping a font metrics table to move a highlight by a few pixels.
     */
    const span = s.to - s.from;
    const fromChar = Math.max(at, s.from) - s.from;
    const toChar = Math.min(end, s.to) - s.from;
    marks.push({
      left: x + (full * fromChar) / span,
      top: y - height,
      width: (full * (toChar - fromChar)) / span,
      height,
    });
  }
  return marks;
}

function PdfView({ caseId, token, document: doc, page, highlights, unresolved, citers, blind }: {
  caseId: string; token: string; document: StoredDocument; page?: number;
  highlights: Finding[]; unresolved: number;
  /** Who cited each finding, and why. Empty while the case is blind - see `Read`. */
  citers: (findingId: string) => Citation[];
  /** True while positions are still sealed, which is a different fact from "nobody
   *  cited this" and has to read differently on screen. */
  blind: boolean;
}): ReactElement {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const shown = page ?? 1;
  const [error, setError] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [column, setColumn] = useState(0);
  const [marks, setMarks] = useState<Mark[]>([]);
  /**
   * Stable dependency for the paint effect. See the note where it is used.
   *
   * Joined on a control character rather than a comma or a pipe: the parts are a
   * page number and a QUOTE, and a quote is arbitrary prose that will eventually
   * contain whatever punctuation was chosen as a separator. This one cannot appear in
   * text pulled out of a PDF, so two different sets of quotes can never collide into
   * the same key and silently stop the highlight from updating.
   */
  const SEP = String.fromCharCode(0);
  const quoteKey = highlights
    .filter((f) => typeof f.sourceQuote === "string" && f.sourceQuote.trim() !== "")
    .map((f) => `${f.sourcePage ?? "?"}${SEP}${f.sourceQuote ?? ""}`)
    .join(String.fromCharCode(1));
  /** Null when nothing is being looked for; false when it was and the page does not
   *  carry it. The three states are three different sentences on screen. */
  const [quoteFound, setQuoteFound] = useState<boolean | null>(null);

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

  /**
   * THE COLUMN IS MEASURED, because a fixed rasterisation scale cannot be right twice.
   *
   * The page was rasterised at a hardcoded 1.4 and then handed to CSS with
   * `max-width: 100%`, which means the browser resampled a bitmap of one size into a
   * box of another on nearly every screen: soft, greyish type that reads as "the PDF
   * is wrong" long before anyone suspects the scale. Measuring the column and painting
   * at exactly that width is what makes the raster and the layout agree.
   */
  useEffect(() => {
    const el = wrap.current;
    if (el === null) return undefined;
    const take = (w: number): void => { if (w > 0) setColumn(w); };
    take(el.getBoundingClientRect().width);
    // Guarded rather than assumed: jsdom ships no ResizeObserver, and the viewer
    // still has to paint under the tests at the fallback scale instead of throwing.
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) take(e.contentRect.width);
    });
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);

  useEffect(() => {
    if (pdf === null) return undefined;
    let cancelled = false;
    let task: { cancel: () => void } | undefined;
    // Only reachable with a document already loaded, so this can never wipe a load
    // failure off the screen - it clears a render failure from a PREVIOUS page when
    // the reader moves off it.
    setError(null);

    void (async () => {
      try {
        // Clamp rather than throw: a stale deep link to page 400 of a 288-page review
        // should land on the last page, not on an error screen.
        const pageNo = Math.min(Math.max(shown, 1), pdf.numPages);
        const p = await pdf.getPage(pageNo);
        if (cancelled || canvas.current === null) return;

        /**
         * TWO SCALES, AND COLLAPSING THEM INTO ONE IS THE BUG THIS FIXES.
         *
         * `fit` is how big the page should APPEAR - one page across the column it was
         * given. `dpr` is how many device pixels back each of those CSS pixels on this
         * display. A canvas painted without the second one hands a 1x bitmap to a 1.5x
         * or 2x screen and lets the compositor blur the difference, which is precisely
         * what a 150%-scaled Windows desktop or any Retina panel does to every glyph.
         *
         * So the backing store is `fit * dpr` and the CSS box is `fit`, set explicitly
         * in both dimensions. Explicitly, because `max-width: 100%` on a canvas whose
         * height attribute is still the raw pixel count squashes the page out of its
         * own aspect ratio - a distortion that looks exactly like a badly made PDF.
         */
        const unscaled = p.getViewport({ scale: 1 });
        const fit = column > 0 ? column / unscaled.width : UNMEASURED_SCALE;
        const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0
          ? devicePixelRatio
          : 1;
        const viewport = p.getViewport({ scale: fit * dpr });

        // Sized BEFORE a context is asked for: the dimensions are a property of the
        // element, not of the drawing surface, and writing either one resets that
        // surface anyway. Doing it here also means the canvas carries the right shape
        // even where there is no 2d context to paint into.
        canvas.current.width = Math.round(viewport.width);
        canvas.current.height = Math.round(viewport.height);
        canvas.current.style.width = `${Math.round(unscaled.width * fit)}px`;
        canvas.current.style.height = `${Math.round(unscaled.height * fit)}px`;

        /**
         * The marks, computed against a CSS-scale viewport rather than the painted
         * one. The canvas backing store is `fit * dpr`, but the overlay is laid out in
         * CSS pixels on top of it, so measuring against the device-scaled transform
         * would put every highlight at twice its offset on a Retina screen.
         */
        const wanted = highlights.filter(
          (f) => f.sourcePage === pageNo && typeof f.sourceQuote === "string" && f.sourceQuote.trim() !== "",
        );
        if (wanted.length === 0) {
          setMarks([]);
          setQuoteFound(null);
        } else {
          const text = await p.getTextContent();
          if (cancelled) return;
          const cssViewport = p.getViewport({ scale: fit });
          const found = wanted.flatMap(
            (f) => highlightRects(text.items as Parameters<typeof highlightRects>[0], f.sourceQuote ?? "", cssViewport.transform),
          );
          setMarks(found);
          setQuoteFound(found.length > 0);
        }

        const ctx = canvas.current.getContext("2d");
        if (ctx === null) return;
        const running = p.render({ canvasContext: ctx, viewport });
        task = running;
        await running.promise;
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();

    // Dragging a window edge re-runs this effect on every frame the column changes
    // width, and pdf.js refuses to paint the same canvas from two renders at once.
    // Cancelling the outgoing one is what keeps a resize from throwing "Cannot use
    // the same canvas" across the reader; the rejection it causes lands in the catch
    // above with `cancelled` already true, so it never reaches the screen.
    return () => { cancelled = true; task?.cancel(); };
    // `quoteKey` rather than `highlights`, which is a fresh array on every render and
    // would spin this effect forever. The key changes exactly when a quote or the page
    // it names changes, so the `highlights` captured in the closure above is always
    // the one the key describes.
  }, [pdf, shown, column, quoteKey]);

  /**
   * THE PAGE COUNT COMES FROM THE FILE, not from the upload measurement.
   *
   * `measurement.pages` is what `measure_pdf.py` counted at upload time and it is the
   * right number for the reading room, which is describing files it has not opened.
   * Here the document itself is already parsed, so `numPages` is the number the reader
   * is actually turning through - and if the two ever disagree, the one that can be
   * navigated to is the one a pager may promise.
   */
  const total = pdf === null ? 0 : pdf.numPages;
  // The same clamp the renderer applies, so a deep link to page 400 of a 288-page
  // review reports the page it is LOOKING at rather than the one it asked for.
  const at = total === 0 ? shown : Math.min(Math.max(shown, 1), total);
  const toPage = (n: number): string =>
    href({ name: "read", caseId, documentId: doc.id, page: n });

  return (
    <div className="pdfview">
      <div className="pdfpage" ref={wrap}>
        {/*
          A DOCUMENT WITH NO WAY THROUGH IT IS NOT DISPLAYED, it is sampled. The reader
          opened at page 1 and stayed there: the only route to any other page was a
          finding in the rail that happened to cite one, so 27 pages of a 28-page review
          existed on the record, were counted in the strip, and could not be read.

          Links, not buttons, and they go through the hash exactly as the strip above
          does. The route already carries `:documentId/:page`, which is what makes a
          page shareable, bookmarkable and reachable with the back button; a click
          handler holding the page in local state would quietly take all three away.

          ABOVE THE PAGE, not under it. A page fitted to the full width of the column is
          taller than the window on any normal screen, so a pager below the canvas sits
          a full sheet past the fold: turning to page 2 of 28 would mean scrolling to
          the bottom of page 1 first, every time, twenty-seven times.
        */}
        {error === null && total > 1 && (
          <nav className="pager" aria-label={`Pages of ${doc.filename}`}>
            {at > 1
              ? <a className="ghost" rel="prev" href={toPage(at - 1)}>Previous</a>
              : <span className="ghost off">Previous</span>}
            <span className="at">Page {at} of {total}</span>
            {at < total
              ? <a className="ghost" rel="next" href={toPage(at + 1)}>Next</a>
              : <span className="ghost off">Next</span>}
          </nav>
        )}
        {error === null
          ? (
            // Positioned so the overlay can sit on the page. The wrapper takes the
            // canvas's own width rather than the column's, or a mark would be offset
            // by half the slack whenever the page is narrower than the space.
            <div className="sheet">
              <canvas ref={canvas} aria-label={`${doc.filename} page ${at}`} />
              {marks.map((m, i) => (
                <span key={`${m.left},${m.top},${i}`} className="mark" aria-hidden="true"
                  style={{ left: m.left, top: m.top, width: m.width, height: m.height }} />
              ))}
            </div>
          )
          : (
            <p className="err" role="alert">
              Could not open {doc.filename}: {error}
            </p>
          )}

        {/*
          SAYS SO WHEN IT CANNOT FIND THE PASSAGE. A reader promised a highlight who
          sees an unmarked page cannot tell a wrong quote from a broken highlighter,
          and the honest failure is the one that names itself. Nothing is marked
          approximately to avoid this message.
        */}
        {error === null && quoteFound === false && (
          <p className="small muted" role="status">
            The quoted passage is not on this page as written. Nothing has been marked -
            a highlight over the nearest similar sentence would be a claim the reviewer
            did not make.
          </p>
        )}
      </div>
      <aside aria-label="Findings sourced to this document">
        {highlights.length > 0
          ? highlights.map((f) => {
            const cited = citers(f.id);
            return (
              <div className="finding-block" key={f.id}>
                <a className="finding-row"
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
                {/*
                  A CITATION WITH NO PASSAGE SAYS SO. Findings written before a quote
                  was recordable - and any written since without one - point at a page
                  and nothing finer, so the page renders unmarked. Left silent, that is
                  indistinguishable from a highlighter that is broken, which is the
                  same confusion the not-found message downstairs exists to prevent;
                  covering one case and not the other just moved the ambiguity.
                */}
                {(f.sourceQuote ?? "").trim() === "" && (
                  <p className="no-quote">
                    No passage recorded, so nothing is marked on page {f.sourcePage}.
                  </p>
                )}
                {/*
                  WHO USED THIS, AND FOR WHAT - once the case is open, and not one
                  moment before. `citers` returns nothing while `positions` is null,
                  which is the state the server puts the client in for the whole blind
                  stage. The line below is what stands in its place: it says the
                  attribution is being withheld rather than that nobody cited this,
                  because those are different facts and only one of them is true.
                */}
                {blind
                  ? <p className="cited-blind">Who cited this is sealed until the case is revealed.</p>
                  : cited.length === 0
                    ? <p className="cited-none">No position cited this finding.</p>
                    : (
                      <div className="cited">
                        {cited.map((c) => (
                          <div className="cited-by" key={c.participantId}>
                            <span className="cited-who">
                              <Reviewer name={c.name} seat={c.seat} />
                              <strong>{c.name}</strong>
                              <span className="cited-call">{CALL_WORDS[c.call]}</span>
                            </span>
                            {/* Their reasoning, verbatim and unsummarised. A paraphrase
                                here would be this screen editing a sealed position. */}
                            {c.reasoning.trim() !== "" && <p className="cited-why">{c.reasoning}</p>}
                          </div>
                        ))}
                      </div>
                    )}
              </div>
            );
          })
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
