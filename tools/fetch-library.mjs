/**
 * Rebuild `data/raw/approval-packages/` - the documents the library searches - from
 * the agencies that published them.
 *
 * THE CORPUS IS COMMITTED NOW, so nobody needs this to get a working library: a fresh
 * clone already has all thirty-five files. This is the escape hatch that was supposed
 * to exist and did not.
 *
 * `d4449a9` put 363MB of PDFs in the repository and said why in as many words: "The
 * rule this reverses said the files were retrievable ... 'by the URL the spec
 * records'. No URL is recorded anywhere ... there is no fetch script, and so retrieval
 * meant hand-searching FDA's site for thirty-five documents. The stated escape hatch
 * did not exist." That was true when it was written. This is the script, and it needs
 * no URL table to be maintained - every FDA review is addressed by the application
 * number already in the filename the manifest names.
 *
 * So the 363MB is now a CHOICE rather than the only option, and it is a reasonable
 * one: the files never change, committing them makes the demo work offline and on the
 * first clone, and that commit already names Git LFS as the next move. What this adds
 * is the ability to verify the corpus against its source, restore a file somebody
 * deleted, and extend the set without a manual download - and it means the argument
 * for LFS, or for dropping the blobs again, can now be had on its merits.
 *
 * `--verify` measures what is on disk without fetching, which is the fastest way to
 * find out whether a checkout's documents are the ones the manifest expects.
 *
 * EVERY FDA REVIEW IS ADDRESSABLE BY ITS APPLICATION NUMBER, which is already in the
 * filename the manifest names - `turalio-211810-multidiscipline.pdf` is NDA 211810 -
 * so nothing here needs a hand-maintained URL table. What it does need is the year
 * the package was published, which is not in the filename; the candidates below are
 * tried in turn and the first that returns a real PDF wins.
 *
 * accessdata.fda.gov sits behind an Akamai abuse-detection layer that intermittently
 * answers a scripted client with a 420-byte apology page instead of the file, for
 * every path rather than just the large ones. That is a TRANSIENT state, not a
 * permanent block - the same URL that was refused for an hour served 6MB afterwards
 * with no change of client - so this retries with a pause rather than pretending to
 * be a browser to get around it. If a run comes back with most files missing, the
 * answer is to run it again later, not to disguise the request.
 *
 * Magic bytes are checked on every download, because that apology page will save
 * itself under a .pdf name perfectly happily and fail much later as a corrupt file.
 *
 *   node tools/fetch-library.mjs           fetch what is missing
 *   node tools/fetch-library.mjs --verify  measure what is already here, fetch nothing
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const DIR = "data/raw/approval-packages";
const VERIFY_ONLY = process.argv.includes("--verify");
const SOURCES = JSON.parse(execFileSync("node", ["-e", "process.stdout.write(require('fs').readFileSync('data/library-sources.json','utf8'))"], { encoding: "utf8" })).sources;

mkdirSync(DIR, { recursive: true });

/**
 * The approval year per application, because the URL carries it and the filename does
 * not. Wrong guesses cost one 404 each, so the list is generous rather than precise.
 */
const YEARS = ["2019", "2020", "2021", "2022", "2018", "2023"];

/** Documents that are not FDA multi-discipline reviews, with their own addresses. */
const EXPLICIT = {
  "ema-epar-sample-imaavy.pdf": ["https://www.ema.europa.eu/en/documents/assessment-report/imaavy-epar-public-assessment-report_en.pdf"],
  // The two the splitter refuses. Kept because the refusals are the point: one is a
  // photograph of a document, the other is the wrong document entirely, and a library
  // showing only what worked would imply every document works.
  // 1997-98 packages predate the `NNNNNNOrig1s000...` scheme entirely - they are named
  // after the brand, with the leading zero of the application number dropped - so the
  // application number in the filename cannot generate these two.
  "tolcapone-20697-medical-review-p1.pdf": [
    "https://www.accessdata.fda.gov/drugsatfda_docs/nda/98/20697_Tasmar_medr_P1.pdf",
  ],
  "troglitazone-020720-approval.pdf": [
    "https://www.accessdata.fda.gov/drugsatfda_docs/nda/97/020720_s02_s03_s05ap.pdf",
  ],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Candidate URLs for a file, derived from the application number in its name. */
function candidates(file) {
  if (EXPLICIT[file] !== undefined) return EXPLICIT[file];
  const nda = /-(\d{6})-/.exec(file)?.[1];
  if (nda === undefined) return [];
  return YEARS.map((y) => `https://www.accessdata.fda.gov/drugsatfda_docs/nda/${y}/${nda}Orig1s000MultidisciplineR.pdf`);
}

async function fetchOne(file) {
  for (const url of candidates(file)) {
    let res;
    try { res = await fetch(url); } catch { continue; }
    if (!res.ok) continue;
    const body = Buffer.from(await res.arrayBuffer());
    // The apology page is ~420 bytes of HTML and answers 200 as readily as 404.
    if (body.subarray(0, 5).toString("latin1") !== "%PDF-") continue;
    writeFileSync(`${DIR}/${file}`, body);
    return { ok: true, url, bytes: body.length };
  }
  return { ok: false };
}

const want = SOURCES.filter((s) => s.path !== null).map((s) => ({ name: s.name, file: s.path.replace(`${DIR}/`, "") }));
const missing = [];

for (const s of want) {
  const path = `${DIR}/${s.file}`;
  if (existsSync(path)) { console.log(`have     ${s.name}`); continue; }
  if (VERIFY_ONLY) { console.log(`MISSING  ${s.name}  ${s.file}`); missing.push(s); continue; }

  process.stdout.write(`fetching ${s.name} ... `);
  let got = await fetchOne(s.file);
  if (!got.ok) {
    // One retry after a pause: the abuse-detection state is transient and clears.
    process.stdout.write("retrying ... ");
    await sleep(20_000);
    got = await fetchOne(s.file);
  }
  if (got.ok) console.log(`${(got.bytes / 1e6).toFixed(1)}MB`);
  else { console.log("NOT AVAILABLE - run again later"); missing.push(s); }
}

// ---- measure everything that is here ---------------------------------------------

console.log("");
let readable = 0, refused = 0;
for (const s of want) {
  const path = `${DIR}/${s.file}`;
  if (!existsSync(path)) continue;
  const m = JSON.parse(execFileSync("python", ["data/prep/measure_pdf.py", path], { encoding: "utf8" }));
  const size = (statSync(path).size / 1e6).toFixed(1);
  if (m.ok) { readable++; console.log(`readable ${s.name.padEnd(13)} ${String(m.pages).padStart(4)}pp  ${size}MB  nonclinical ${m.nonclinicalChapterPages}pp`); }
  else { refused++; console.log(`REFUSED  ${s.name.padEnd(13)} ${String(m.pages).padStart(4)}pp  ${size}MB  ${m.reason.slice(0, 80)}`); }
}

console.log(`\n${readable} readable, ${refused} refused by the gate, ${missing.length} not retrieved`);
if (missing.length > 0) {
  console.log("Not retrieved (accessdata.fda.gov intermittently refuses scripted clients; try again later):");
  for (const s of missing) console.log(`   ${s.name}  ${s.file}`);
}
