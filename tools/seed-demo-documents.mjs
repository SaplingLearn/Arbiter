/**
 * Put REAL regulatory documents on the demo cases.
 *
 * WHY THIS EXISTS. The demo store used to be stocked from `readablePdfBytes()` in
 * services/api/test/server.test.ts - a hand-assembled PDF whose five lines of text were
 * written to clear the upload gate's vocabulary floors and nothing else. It did its job
 * as a TEST fixture. As demo content it was actively misleading: every page of every
 * document was the same four sentences with the page number swapped, sitting under
 * filenames like `turalio-211810-multidiscipline.pdf` that named real FDA reviews.
 * Anyone opening the reader saw a product that appeared to render regulatory reviews
 * and was in fact rendering a keyword-stuffed stub.
 *
 * So the demo corpus is fetched from the agencies that published it, and every file
 * goes through `measure_pdf.py` - the same gate a human upload passes - before it is
 * accepted. A document that cannot clear the gate does not get quietly waved through
 * here; it is reported and skipped, because the gate refusing something real is
 * information and faking a pass would destroy it.
 *
 *   node tools/seed-demo-documents.mjs            fetch what is missing, then upload
 *   node tools/seed-demo-documents.mjs --fetch    fetch only, no upload
 *
 * Needs `npm run dev` up (for the upload step) and PyMuPDF installed for the gate:
 * `pip install -r data/prep/requirements.txt`.
 *
 * ---------------------------------------------------------------------------------
 * WHY EVERY SOURCE HERE IS EMA AND NOT FDA, which is not a preference.
 *
 * accessdata.fda.gov sits behind an Akamai abuse-detection layer that answers any
 * scripted client with a 420-byte apology page - for EVERY path, not just large ones.
 * The FDA reviews this project is built on are still public and still correct; they
 * just cannot be fetched without pretending to be a browser, which is not a thing this
 * script is going to do. They are listed at the bottom as MANUAL, with their URLs, and
 * data/prep/README.md already sets that precedent for the DILIrank workbook: "asking a
 * human to click once" beats a script that silently saves an error page as a PDF.
 *
 * The EMA sources are not a consolation prize. data/cases/turalio-pexidartinib.json
 * records why in its own note: an FDA multi-disciplinary review is ONE document written
 * by reviewers who already know the clinical outcome, whereas "EMA assessment reports
 * are structured with the non-clinical section written before and separately from the
 * clinical one". For a product whose entire claim is reading the preclinical evidence
 * on its own terms, that separation is the better material.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const API = process.env["ARBITER_API"] ?? "http://127.0.0.1:8787";
const DIR = "data/raw/approval-packages";
const FETCH_ONLY = process.argv.includes("--fetch");

/**
 * The caseIds are the demo store's, and they are matched to the drug the document is
 * ABOUT - never to whichever case happens to be empty. A nipocalimab report filed under
 * a pexidartinib case would look exactly as convincing as the stub it replaced.
 */
const SOURCES = [
  {
    file: "turalio-epar-refusal.pdf",
    url: "https://www.ema.europa.eu/en/documents/assessment-report/turalio-epar-refusal-public-assessment-report_en.pdf",
    label: "Turalio (pexidartinib) - EMA refusal public assessment report",
    // The refusal, deliberately, over the approval: the CHMP refused this marketing
    // authorisation in June 2020 partly over unpredictable and potentially fatal liver
    // injury, so the document argues the hepatotoxicity question at length instead of
    // recording it in passing. It is the densest liver-toxicity text in the set.
    caseId: "case_1339597248",
    uploadAs: "turalio-epar-refusal-assessment-report.pdf",
  },
  {
    file: "sotyktu-epar-assessment.pdf",
    url: "https://www.ema.europa.eu/en/documents/assessment-report/sotyktu-epar-public-assessment-report_en.pdf",
    label: "Sotyktu (deucravacitinib) - EMA public assessment report",
    // BMS-986165 is deucravacitinib's development code, which is the name the demo case
    // carries.
    caseId: "case_298194277",
    uploadAs: "sotyktu-deucravacitinib-epar-assessment-report.pdf",
  },
  {
    file: "ema-epar-sample-imaavy.pdf",
    url: "https://www.ema.europa.eu/en/documents/assessment-report/imaavy-epar-public-assessment-report_en.pdf",
    label: "Imaavy (nipocalimab) - EMA public assessment report",
    // NOT uploaded to a case: there is no nipocalimab case in the demo store. It is
    // fetched because data/library-sources.json names this exact path, and because it
    // is the document data/cases/nipocalimab-imaavy.json was transcribed from - the
    // gate measures it at 178 pages, which is the totalPages that file records.
    caseId: null,
  },
];

/** The ones a person has to fetch by hand, and exactly where from. */
const MANUAL = [
  ["turalio-211810-multidiscipline.pdf", "https://www.accessdata.fda.gov/drugsatfda_docs/nda/2019/211810Orig1s000MultidisciplineR.pdf"],
  ["modern-fda-multidiscipline-211367.pdf", "https://www.accessdata.fda.gov/drugsatfda_docs/nda/2019/211367Orig1s000MultidisciplineR.pdf"],
];

mkdirSync(DIR, { recursive: true });

/** The gate, run exactly as services/api/documents.ts runs it. */
function measure(path) {
  const out = execFileSync("python", ["data/prep/measure_pdf.py", path], { encoding: "utf8" });
  return JSON.parse(out);
}

const ready = [];

for (const s of SOURCES) {
  const path = `${DIR}/${s.file}`;

  if (existsSync(path)) {
    console.log(`have     ${s.file}`);
  } else {
    console.log(`fetching ${s.file}\n         ${s.url}`);
    const res = await fetch(s.url);
    if (!res.ok) {
      console.log(`         FAILED ${res.status} - skipped`);
      continue;
    }
    const body = Buffer.from(await res.arrayBuffer());
    // A refused download that saves an HTML error page under a .pdf name is the exact
    // failure data/prep/README.md warns about, and it stays invisible until something
    // tries to read it. Check the magic bytes rather than trusting the status line.
    if (body.subarray(0, 5).toString("latin1") !== "%PDF-") {
      console.log(`         NOT A PDF (${body.length} bytes, starts "${body.subarray(0, 20).toString("latin1").replace(/\s+/g, " ")}") - skipped`);
      continue;
    }
    writeFileSync(path, body);
    console.log(`         ${(body.length / 1e6).toFixed(1)}MB`);
  }

  const m = measure(path);
  if (!m.ok) {
    console.log(`         GATE REFUSED: ${m.reason}`);
    continue;
  }
  console.log(`         gate: ${m.pages} pages, nonclinical chapter ${m.nonclinicalChapterPages}pp, tox ${m.toxTermHits}, liver ${m.liverTermHits} - ${m.verdict}`);
  if (s.caseId !== null) ready.push({ ...s, path });
}

if (FETCH_ONLY || ready.length === 0) {
  console.log("");
  for (const [file, url] of MANUAL) console.log(`manual   ${file}\n         ${url}`);
  process.exit(0);
}

// ---- upload, through the endpoint a person uses ---------------------------------

const login = await fetch(`${API}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  // The demo team's shared, published password. See services/api/seed-demo.ts, which
  // prints it for the same reason it is written here rather than hidden.
  body: JSON.stringify({ email: "r.okafor@arbiter.demo", password: "arbiter-demo-2026" }),
});
if (!login.ok) {
  console.error(`\nlogin failed: ${login.status}. Is \`npm run dev\` up, and has \`npm run seed:demo\` been run?`);
  process.exit(1);
}
const { token } = await login.json();

console.log("");
for (const s of ready) {
  const res = await fetch(`${API}/api/cases/${s.caseId}/documents`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/pdf",
      "x-filename": s.uploadAs,
    },
    body: readFileSync(s.path),
  });
  const out = await res.json();
  if (res.status !== 201) {
    console.log(`refused  ${s.uploadAs} [${res.status}] ${JSON.stringify(out).slice(0, 200)}`);
    continue;
  }
  // A second run re-posting the same bytes is answered with the document already
  // stored rather than a duplicate, so this script is safe to run twice.
  console.log(`uploaded ${s.uploadAs} -> ${s.label}${out.duplicateOf === null ? "" : " (already stored)"}`);
}

console.log("");
for (const [file, url] of MANUAL) console.log(`manual   ${file}\n         ${url}`);
