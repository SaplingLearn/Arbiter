/**
 * Build the demonstration: real documents, real quotes, real citations.
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
 * So the corpus is fetched from the agencies that published it, every file goes
 * through `measure_pdf.py` - the same gate a human upload passes - and every quote is
 * CHECKED AGAINST THE PDF before it is seeded (see `verifyQuotes`). A seeded demo
 * whose highlights silently fail to draw is worse than one with no highlights: it
 * teaches whoever opens it that the feature is broken.
 *
 *   node tools/seed-demo-documents.mjs            top up what is missing
 *   node tools/seed-demo-documents.mjs --fetch    fetch and verify only, write nothing
 *   node tools/seed-demo-documents.mjs --reset    DISCARD the store and rebuild it
 *
 * `--reset` deletes the case log, the case file and the uploaded documents, because a
 * closed case cannot be given anything - not a document, not a finding, not a quote.
 * Its findings live in the hash-chained log behind `case_opened` and the Record stage
 * verifies that chain, so editing one to slip a passage in would forge exactly the
 * evidence this product exists to make checkable. Rebuilding is the honest way to
 * change a sealed case, and it throws the old deliberation away. Accounts are NOT
 * touched: `results/deliberation-log.jsonl.users.json` holds password hashes and is
 * nobody's to discard here.
 *
 * Needs `npm run dev` up, and PyMuPDF for the gate:
 * `pip install -r data/prep/requirements.txt`.
 *
 * ---------------------------------------------------------------------------------
 * WHY EVERY SOURCE HERE IS EMA AND NOT FDA, which is not a preference.
 *
 * accessdata.fda.gov sometimes answers a scripted client with a 420-byte Akamai
 * abuse-detection page instead of the file, for every path rather than just the large
 * ones. That is a TRANSIENT state and not a standing block: the same URL refused for
 * an hour later served 6MB to plain `fetch` with no change of client and no disguise.
 * `npm run library:fetch` retries rather than pretending to be a browser, and the FDA
 * reviews are fetched there.
 *
 * The EMA sources are not a consolation prize. data/cases/turalio-pexidartinib.json
 * records why in its own note: an FDA multi-disciplinary review is ONE document written
 * by reviewers who already know the clinical outcome, whereas "EMA assessment reports
 * are structured with the non-clinical section written before and separately from the
 * clinical one". For a product whose entire claim is reading the preclinical evidence
 * on its own terms, that separation is the better material.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const API = process.env["ARBITER_API"] ?? "http://127.0.0.1:8787";
const DIR = "data/raw/approval-packages";
const FETCH_ONLY = process.argv.includes("--fetch");
const RESET = process.argv.includes("--reset");

const OWNER = { email: "r.okafor@arbiter.demo", password: "arbiter-demo-2026" };
/** The two seated reviewers. The owner convenes and does not hold a seat. */
const PANEL = [
  { email: "a.silva@arbiter.demo", password: "arbiter-demo-2026" },
  { email: "b.mehta@arbiter.demo", password: "arbiter-demo-2026" },
];

/**
 * One case per document, and the document is the one about THAT drug.
 *
 * TAK-994 is deliberately absent. It was discontinued in trials over hepatotoxicity
 * and never reached an approval package, so no regulatory review of it exists to
 * attach - `data/library-sources.json` records it as "no source PDF" for the same
 * reason. A case here with a document borrowed from another compound would look
 * exactly as convincing as the fixture this script replaced.
 *
 * Every `quote` below is verbatim from the page named beside it, and every one is
 * re-checked against the PDF at seed time.
 */
const CASES = [
  {
    caseId: "case_turalio_pexidartinib",
    compoundLabel: "Turalio (pexidartinib)",
    context: "Tenosynovial giant cell tumour. Oral, 800 mg/day, chronic dosing in a non-life-threatening indication.",
    file: "turalio-epar-refusal.pdf",
    uploadAs: "turalio-epar-refusal-assessment-report.pdf",
    findings: [
      {
        id: "m12-metabolite-hepatotoxicity",
        label: "M12 metabolite may drive the hepatotoxicity",
        assertion: "toxic",
        detail: "Pyridine forms reactive intermediates on oxidation; the assessor states M12 may contribute to the observed hepatotoxicity, and that the applicant did not discuss it.",
        page: 22,
        quote: "Pyridine is known to be hepatotoxic, probably because it forms reactive intermediates during oxidation.",
      },
      {
        id: "necrotizing-inflammation-not-reversible",
        label: "Liver necrotizing inflammation did not reverse",
        assertion: "toxic",
        detail: "Higher incidence after 16 weeks of recovery rather than resolution - reversibility is the question a repeat-dose finding is supposed to answer, and here the answer is no.",
        page: 24,
        quote: "The necrotizing inflammation in the liver was not reversible even with higher incidence after 16 weeks of recovery.",
      },
      {
        id: "mechanism-of-liver-toxicity-unknown",
        label: "Mechanism unknown, so no preventive measure can be defined",
        assertion: "ambiguous",
        detail: "The assessor's conclusion on the hepatic signal: without a mechanism there is nothing to monitor for and nothing to mitigate.",
        page: 32,
        quote: "The mechanism of liver toxicity in animals and in humans is unknown; therefore, it is not possible to define preventive measures for avoiding liver damage during pexidartinib therapy.",
      },
    ],
    positions: [
      { call: "do_not_advance", reasoning: "The liver signal is characterised, it did not reverse on withdrawal, and no mechanism is offered - so there is nothing to monitor for. Not advanceable in a non-life-threatening indication." },
      { call: "do_not_advance", reasoning: "Reactive-metabolite route is plausible and unexamined by the applicant. Without the mechanism I cannot bound the risk at chronic dosing." },
    ],
  },
  {
    caseId: "case_bms_986165",
    compoundLabel: "BMS-986165 (deucravacitinib)",
    context: "Plaque psoriasis. Oral, chronic dosing in a broad outpatient population.",
    file: "sotyktu-epar-assessment.pdf",
    uploadAs: "sotyktu-deucravacitinib-epar-assessment-report.pdf",
    findings: [
      {
        id: "unscheduled-deaths-6-month-rat",
        label: "Unscheduled deaths in the 6-month rat study",
        assertion: "toxic",
        detail: "Eleven unscheduled deaths in the 6-month rat study; no mortality in the other repeat-dose studies. Cause undetermined for five of them.",
        page: 37,
        quote: "No mortality in the repeat-dose toxicity studies were observed, except in the 6-month rat toxicity study where 11 unscheduled deaths occurred.",
      },
      {
        id: "heart-liver-kidney-effects-raised",
        label: "Heart, liver and kidney effects raised at CHMP request",
        assertion: "ambiguous",
        detail: "Raised, discussed, and ruled out on imputability and statistical significance; MACE followed up post-marketing rather than resolved preclinically.",
        page: 37,
        quote: "Some concerns were raised on adverse effects on heart, liver and kidneys which occurred during the toxicology studies in rats and monkeys.",
      },
      {
        id: "obstructive-uropathy-rat-death",
        label: "Obstructive uropathy killed a rat at the top dose",
        assertion: "toxic",
        detail: "A single male rat at 50 mg/kg/day in the 6-month study. A named cause of death rather than an unexplained one.",
        page: 30,
        quote: "In the 6-month toxicity study in rats, an obstructive uropathy was the cause of death of 1 male rat at 50 mg/kg/day.",
      },
    ],
    positions: [
      { call: "cannot_conclude", reasoning: "Five of eleven deaths undetermined is not a resolved question, however the incidence compares across dose groups. I want the cause before a chronic outpatient indication." },
      { call: "advance", reasoning: "Exposure margin at the NOAEL is 247x the recommended human dose and the deaths show no dose relationship. The renal finding is single-animal at the top dose." },
    ],
  },
  {
    caseId: "case_nipocalimab_imaavy",
    compoundLabel: "Nipocalimab (Imaavy)",
    context: "Generalised myasthenia gravis. Intravenous monoclonal antibody, chronic dosing.",
    file: "ema-epar-sample-imaavy.pdf",
    uploadAs: "imaavy-nipocalimab-epar-assessment-report.pdf",
    findings: [
      {
        id: "serum-albumin-decrease-all-studies",
        label: "Dose-dependent albumin decrease in every repeat-dose study",
        assertion: "toxic",
        detail: "Present in all repeat-dose studies in cynomolgus monkey rather than at the top dose only, so it is on the mechanism rather than an artefact of one group.",
        page: 34,
        quote: "However, dose dependent decreases in serum albumin were observed in all repeat dose toxicity studies performed in the cynomolgus monkey.",
      },
      {
        id: "no-traditional-carcinogenicity-possible",
        label: "Carcinogenicity could not be tested conventionally",
        assertion: "ambiguous",
        detail: "No cross-reactivity with rodent FcRn, so the carcinogenic assessment is a weight-of-evidence argument rather than a study. Absence of a study is not absence of risk.",
        page: 38,
        quote: "It does not cross-react with rodent FcRn, precluding the conduct of traditional carcinogenicity studies.",
      },
    ],
    positions: [
      { call: "advance", reasoning: "The albumin effect is pharmacology, monitorable, and reversed on withdrawal. The carcinogenicity gap is inherent to the modality and argued properly." },
      { call: "cannot_conclude", reasoning: "A weight-of-evidence carcinogenicity argument is the weakest form of the answer, and the albumin decrease is in every study. Chronic dosing makes both matter." },
    ],
  },
];

/** Where each file comes from. Keyed by the filename the cases above name. */
const SOURCES = {
  "turalio-epar-refusal.pdf": "https://www.ema.europa.eu/en/documents/assessment-report/turalio-epar-refusal-public-assessment-report_en.pdf",
  "sotyktu-epar-assessment.pdf": "https://www.ema.europa.eu/en/documents/assessment-report/sotyktu-epar-public-assessment-report_en.pdf",
  "ema-epar-sample-imaavy.pdf": "https://www.ema.europa.eu/en/documents/assessment-report/imaavy-epar-public-assessment-report_en.pdf",
};

/**
 * The rest of the corpus - the FDA reviews the LIBRARY searches, as opposed to the
 * three EMA reports the demo cases are built on - is COMMITTED, so a fresh clone has
 * it already. `npm run library:fetch` rebuilds or verifies it against the agencies.
 *
 * It was listed here as manual-only for a while, on the basis that accessdata.fda.gov
 * refuses scripted clients. That turned out to be a transient abuse-detection state
 * rather than a standing block: the same URLs later served every file to plain
 * `fetch`, with no disguise of any kind.
 */
const ALSO = "npm run library:fetch";

const STORE = [
  "results/deliberation-log.jsonl",
  "results/deliberation-log.jsonl.cases.json",
];

mkdirSync(DIR, { recursive: true });

// ---- fetch, and gate ------------------------------------------------------------

for (const c of CASES) {
  const path = `${DIR}/${c.file}`;
  if (existsSync(path)) { console.log(`have     ${c.file}`); continue; }

  console.log(`fetching ${c.file}\n         ${SOURCES[c.file]}`);
  const res = await fetch(SOURCES[c.file]);
  if (!res.ok) { console.log(`         FAILED ${res.status}`); process.exit(1); }
  const body = Buffer.from(await res.arrayBuffer());
  // A refused download that saves an HTML error page under a .pdf name is the exact
  // failure data/prep/README.md warns about, and it stays invisible until something
  // tries to read it. Check the magic bytes rather than trusting the status line.
  if (body.subarray(0, 5).toString("latin1") !== "%PDF-") {
    console.log(`         NOT A PDF (${body.length} bytes) - refusing to save it`);
    process.exit(1);
  }
  writeFileSync(path, body);
  console.log(`         ${(body.length / 1e6).toFixed(1)}MB`);
}

for (const c of CASES) {
  const m = JSON.parse(execFileSync("python", ["data/prep/measure_pdf.py", `${DIR}/${c.file}`], { encoding: "utf8" }));
  if (!m.ok) { console.log(`GATE REFUSED ${c.file}: ${m.reason}`); process.exit(1); }
  console.log(`gate     ${c.file}: ${m.pages}pp, nonclinical ${m.nonclinicalChapterPages}pp, tox ${m.toxTermHits}, liver ${m.liverTermHits}`);
}

// ---- verify every quote against the page it names --------------------------------

/**
 * The same comparison `highlightRects` makes: whitespace removed from both sides and
 * nothing else touched. Checked HERE so a retyped word fails the seed rather than
 * shipping a demo whose marks quietly never draw - the failure mode that reaches a
 * reader as "the highlighter is broken".
 */
const bare = (s) => s.replace(/\s+/g, "");

async function verifyQuotes() {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let bad = 0;
  for (const c of CASES) {
    const url = new URL(`file://${process.cwd().replace(/\\/g, "/")}/${DIR}/${c.file}`).href;
    const doc = await getDocument({ url, useSystemFonts: true }).promise;
    for (const f of c.findings) {
      const tc = await (await doc.getPage(f.page)).getTextContent();
      const page = bare(tc.items.map((i) => i.str).join(""));
      if (page.includes(bare(f.quote))) {
        console.log(`quote    ${c.compoundLabel} p.${f.page} - on the page`);
      } else {
        console.log(`QUOTE MISSING  ${c.compoundLabel} p.${f.page}: ${f.quote.slice(0, 60)}...`);
        bad++;
      }
    }
    await doc.destroy();
  }
  return bad;
}

const bad = await verifyQuotes();
if (bad > 0) { console.log(`\n${bad} quote(s) would never draw. Refusing to seed.`); process.exit(1); }

if (FETCH_ONLY) {
  console.log("");
  console.log(`Run \`${ALSO}\` for the FDA reviews the library searches.`);
  process.exit(0);
}

// ---- reset, if asked -------------------------------------------------------------

/**
 * BEFORE sign-in, deliberately. `--reset` requires the API to be DOWN - the service
 * holds the log in memory and rewrites it on the next write, so deleting the file
 * under a running server just watches it come back - and signing in first would fail
 * on the connection refused that is the precondition here, not the error.
 */
if (RESET) {
  const live = await fetch(`${API}/api/cases`).then(() => true).catch(() => false);
  if (live) {
    console.log("\n--reset needs the API stopped, or it will rewrite the log from memory.");
    console.log("Stop `npm run dev`, run this with --reset, then start it again.");
    process.exit(1);
  }
  for (const f of STORE) if (existsSync(f)) { rmSync(f); console.log(`removed  ${f}`); }
  rmSync("results/documents", { recursive: true, force: true });
  console.log("removed  results/documents");
  console.log("\nStore cleared. Start `npm run dev` and run this again without --reset.");
  process.exit(0);
}

// ---- sign in ---------------------------------------------------------------------

async function signIn({ email, password }) {
  const r = await fetch(`${API}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    console.error(`\nlogin failed for ${email} (${r.status}). Is \`npm run dev\` up, and has \`npm run seed:demo\` been run?`);
    process.exit(1);
  }
  return r.json();
}

const owner = await signIn(OWNER);
const panel = [];
for (const p of PANEL) panel.push(await signIn(p));
console.log(`\nsigned in as ${owner.user.displayName}, panel of ${panel.length}`);

const as = (session) => ({ authorization: `Bearer ${session.token}`, "content-type": "application/json" });

// ---- build each case -------------------------------------------------------------

const existing = await (await fetch(`${API}/api/cases`, { headers: as(owner) })).json();
const known = new Set(existing.map((c) => c.caseId));

console.log("");
for (const c of CASES) {
  if (!known.has(c.caseId)) {
    const r = await fetch(`${API}/api/cases`, {
      method: "POST", headers: as(owner),
      body: JSON.stringify({
        caseId: c.caseId, compoundLabel: c.compoundLabel, context: c.context,
        participantIds: panel.map((p) => p.user.id), findings: [],
        at: new Date().toISOString(),
      }),
    });
    if (r.status !== 201) { console.log(`case     ${c.compoundLabel} FAILED ${r.status} ${JSON.stringify(await r.json()).slice(0, 200)}`); continue; }
    console.log(`case     ${c.compoundLabel} opened`);
  } else {
    console.log(`case     ${c.compoundLabel} already here`);
  }

  // The document, through the endpoint a person uploads by.
  const up = await fetch(`${API}/api/cases/${c.caseId}/documents`, {
    method: "POST",
    headers: { authorization: `Bearer ${owner.token}`, "content-type": "application/pdf", "x-filename": c.uploadAs },
    body: readFileSync(`${DIR}/${c.file}`),
  });
  const upBody = await up.json();
  if (up.status !== 201) { console.log(`         document REFUSED ${up.status} ${JSON.stringify(upBody).slice(0, 200)}`); continue; }
  const documentId = upBody.document.id;
  console.log(`         ${c.uploadAs} -> ${upBody.document.measurement.pages}pp`);

  for (const f of c.findings) {
    const r = await fetch(`${API}/api/cases/${c.caseId}/findings`, {
      method: "POST", headers: as(owner),
      body: JSON.stringify({
        id: f.id, label: f.label, assertion: f.assertion, detail: f.detail,
        sourceDocumentId: documentId, sourcePage: f.page, sourceQuote: f.quote, covers: [],
      }),
    });
    const out = r.status === 201 ? "quoted" : `[${r.status}] ${(await r.json()).detail ?? ""}`;
    console.log(`         finding p.${f.page} ${f.id} - ${out}`);
  }

  // Positions, then the reveal, so the reader's rail can show who leaned on which
  // finding and why. Sealed one at a time through the real endpoint; the server is
  // what keeps them invisible until the case closes.
  const ids = c.findings.map((f) => f.id);
  for (let i = 0; i < panel.length; i++) {
    const p = c.positions[i];
    if (p === undefined) continue;
    const r = await fetch(`${API}/api/cases/${c.caseId}/positions`, {
      method: "POST", headers: as(panel[i]),
      body: JSON.stringify({
        call: p.call, reasoning: p.reasoning,
        // Each reviewer cites everything on the case: this is a demonstration of
        // attribution, and a finding nobody cited shows the empty state instead.
        citedFindingIds: ids, external: [], submittedAt: new Date().toISOString(),
      }),
    });
    console.log(`         position ${panel[i].user.displayName} - ${r.status === 201 ? p.call : `[${r.status}]`}`);
  }

  const rev = await fetch(`${API}/api/cases/${c.caseId}/reveal`, {
    method: "POST", headers: as(owner),
    body: JSON.stringify({ mode: "all_in", at: new Date().toISOString() }),
  });
  console.log(`         reveal - ${rev.status === 200 ? "positions open" : `[${rev.status}]`}`);
}

console.log("");
console.log(`Run \`${ALSO}\` for the FDA reviews the library searches.`);
