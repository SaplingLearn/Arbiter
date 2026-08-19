/**
 * Build `results/library/<name>.pages.json` for documents that have a PDF but no
 * cache yet.
 *
 * WHY NOT JUST RUN THE EXTRACTOR AND WRITE THE JSON. Because `LibraryStore.textFor`
 * does two things after extraction that a hand-rolled script would silently skip:
 * it scrapes the LAST JSON object off stdout (PyMuPDF prints a banner in front of
 * it, which is what once refused every upload in the product), and it runs
 * `stripBoilerplate` before caching. A cache built without those is not the same
 * corpus the committed numbers were measured on, and the difference would show up
 * as a retrieval regression nobody could explain.
 *
 * Usage:  npx tsx tools/warm_library_cache.ts [name ...]
 *         with no arguments, warms every source that has a readable PDF.
 */
import { existsSync } from "node:fs";
import { LIBRARY_SOURCES, LibraryStore } from "../services/api/library.js";

const only = new Set(process.argv.slice(2));
const store = new LibraryStore();
const python = process.env["PYTHON"] ?? "python";

let warmed = 0;
let skipped = 0;

for (const source of LIBRARY_SOURCES) {
  if (only.size > 0 && !only.has(source.name)) continue;
  if (source.path === null || !existsSync(source.path)) {
    console.log(`  skip   ${source.name.padEnd(16)} no PDF in this checkout`);
    skipped++;
    continue;
  }

  const started = Date.now();
  const pages = store.textFor(source.name, python);
  if (pages.length === 0) {
    console.log(`  FAILED ${source.name.padEnd(16)} extractor returned no pages`);
    continue;
  }

  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `  ok     ${source.name.padEnd(16)} ${String(pages.length).padStart(4)} pages` +
    `  ${chars.toLocaleString().padStart(10)} chars  ${seconds}s`,
  );
  warmed++;
}

console.log(`\n${warmed} warmed, ${skipped} skipped for want of a PDF.`);
