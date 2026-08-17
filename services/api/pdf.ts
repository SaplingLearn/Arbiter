/**
 * HTML to PDF, through Chromium's print pipeline.
 *
 * WHY NOT A PDF LIBRARY. A generator that draws boxes and lays out text itself is a
 * second rendering engine to keep correct: page breaks, widow control, table
 * continuation and text measurement are all things a browser already does properly and
 * a hand-rolled writer does badly for the rest of its life. `report.ts` already prints
 * this repo's other PDF through Chromium, so this is the same pipeline rather than a
 * second answer to the same question - and it means one house style, defined in CSS,
 * applies to both documents.
 *
 * WHY PLAYWRIGHT, WHICH IS A dev DEPENDENCY. It is already installed for the e2e suite
 * and for `npm run report`, so this adds no package to the tree. It is imported
 * dynamically and only when somebody asks for a PDF: a deployment that never prints one
 * never loads it, and a deployment with no browser binary is still a working API rather
 * than a service that will not boot.
 *
 * WHY A BROWSER PER REQUEST. A pooled browser held open between requests is faster and
 * is a lifecycle to get wrong - a crashed page leaks a process, and a long-lived
 * Chromium sits on memory for a document somebody prints twice a month. Launching costs
 * roughly a second on the machine this runs on, which is a second spent while a person
 * watches a download start.
 *
 * NOTHING IS FETCHED AT PRINT TIME. `setContent` with a self-contained page and no
 * network idle to wait for: the document has no web font, no image and no script, so
 * the same input produces the same bytes on a machine with no connectivity.
 */

/** What a caller gets when the browser is not installed. A 500 saying "Executable
 *  doesn't exist" tells an operator nothing; this names the command that fixes it. */
export class BrowserMissingError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "BrowserMissingError";
  }
}

export interface PdfFooter {
  /** Printed bottom-left on every page, beside the page number. Keep it short - it is
   *  the line that tells somebody holding page 4 what they are holding. */
  label: string;
}

export async function htmlToPdf(html: string, footer: PdfFooter): Promise<Buffer> {
  let playwright: typeof import("@playwright/test");
  try {
    playwright = await import("@playwright/test");
  } catch (e) {
    throw new BrowserMissingError(
      "This deployment cannot print PDFs: Playwright is not installed. Run `npm ci` in the checkout that serves this API. "
      + (e instanceof Error ? e.message : String(e)),
    );
  }

  const browser = await playwright.chromium.launch().catch((e: unknown) => {
    // Playwright's own message for a missing binary is long and names the download
    // path, so it is kept - the added sentence is the one an operator acts on.
    throw new BrowserMissingError(
      "This deployment cannot print PDFs: no Chromium binary. Run `npx playwright install chromium` on the machine serving this API.\n"
      + (e instanceof Error ? e.message : String(e)),
    );
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const bytes = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      // The footer is Chromium's, not the document's, because only Chromium knows how
      // many pages there turned out to be. `pageNumber`/`totalPages` are its own
      // classes and are substituted at print time.
      footerTemplate: `<div style="width:100%;font:8pt Georgia,serif;color:#7b818a;padding:0 16mm;display:flex;justify-content:space-between">
        <span>${escapeForTemplate(footer.label)}</span>
        <span><span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`,
      margin: { top: "20mm", bottom: "18mm", left: "16mm", right: "16mm" },
    });
    return bytes;
  } finally {
    // In a finally, so a page that throws mid-print does not leave a browser process
    // behind. A leaked Chromium per failed download takes the machine down eventually,
    // and the failure looks like something else entirely by then.
    await browser.close();
  }
}

/** The footer carries a compound name that a person typed, so it is escaped before it
 *  becomes markup in the header template. */
function escapeForTemplate(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
