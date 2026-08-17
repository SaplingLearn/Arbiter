/**
 * Render the evaluation write-up to PDF.
 *
 * Same mechanism `services/api/report.ts` already uses - Playwright's `page.pdf` over
 * self-contained HTML - rather than a second PDF toolchain. Figures are inlined as data
 * URIs because a PDF renderer resolving relative image paths depends on the working
 * directory, and a silently missing figure looks like a design choice.
 *
 * usage: node tools/build_writeup.mjs <in.html> <out.pdf>
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

const [src, out] = process.argv.slice(2);
if (src === undefined || out === undefined) {
  console.error("usage: node tools/build_writeup.mjs <in.html> <out.pdf>");
  process.exit(2);
}

const FIGS = {
  "{{FIG_COVERAGE}}": "results/figures/benchmarks-coverage.png",
  "{{FIG_SCOREBOARD}}": "results/figures/benchmarks-scoreboard.png",
  "{{FIG_TOPICS}}": "results/figures/benchmarks-ask-topics.png",
  "{{FIG_PRECISION}}": "results/figures/benchmarks-precision.png",
};

let html = readFileSync(src, "utf8");
for (const [token, path] of Object.entries(FIGS)) {
  if (!existsSync(path)) {
    console.error(`missing figure: ${path} - run the plot scripts first`);
    process.exit(1);
  }
  if (!html.includes(token)) {
    console.error(`template has no ${token}; figure order may have drifted`);
    process.exit(1);
  }
  html = html.replaceAll(token, `data:image/png;base64,${readFileSync(path).toString("base64")}`);
  console.log(`  embedded ${basename(path)}`);
}

const { chromium } = await import("@playwright/test");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.pdf({
  path: out,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<div></div>",
  footerTemplate: `<div style="width:100%;font:8pt Georgia,serif;color:#7b818a;padding:0 16mm;display:flex;justify-content:space-between">
    <span>ARBITER &middot; how the evaluation works</span><span class="pageNumber"></span></div>`,
  margin: { top: "18mm", bottom: "16mm", left: "16mm", right: "16mm" },
});
await browser.close();
console.log(`\nwrote ${out}`);
