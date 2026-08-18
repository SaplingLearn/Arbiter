/**
 * A PDF as {page, text}[] on stdout, for the retrieval probe.
 *
 * Shells out to PyMuPDF rather than reaching for pdfjs, because this only has to agree
 * with what the SERVER indexes - and the server's DocumentStore extracts with the same
 * Python path. A probe that read the document through a second extractor would answer
 * a question about that extractor.
 */
import { execFileSync } from "node:child_process";
const pdf = process.argv[2];
if (pdf === undefined) { console.error("usage: node tools/dump-pages.mjs <pdf> > pages.json"); process.exit(1); }
const py = `
import pymupdf, json, sys
d = pymupdf.open(sys.argv[1])
json.dump([{"page": i + 1, "text": d[i].get_text()} for i in range(d.page_count)], sys.stdout)
`;
process.stdout.write(execFileSync("python", ["-c", py, pdf], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }));
