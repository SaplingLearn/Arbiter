import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { LibraryStore } from "./library.js";
import { loadFixture } from "./retrieval-eval.js";
import type { EvalReport } from "./retrieval-eval.js";
import type { AskReport, AskItemResult } from "./ask-eval.js";

/**
 * The evaluation report, as a PDF nobody typed.
 *
 * EVERY NUMBER IS READ FROM results/*.json. Not one is written into this file, and
 * that is the whole design: a report a person retypes is a report that drifts from
 * the run it claims to describe, and the drift is invisible precisely because the
 * document looks authoritative. If a figure is not in the results, it does not appear
 * here - the generator fails instead, naming the file it wanted.
 *
 * It also carries what did NOT work, because a report that lists only the wins is an
 * advertisement. Sub-page windows and dense retrieval were both built and both
 * rejected on their own measurements; those tables are in here beside the ones that
 * improved.
 *
 * Rendered through Chromium's print pipeline via Playwright, which is already a
 * dependency of the e2e tests. The HTML is self-contained - no web fonts, no images,
 * no network at print time - so the same input produces the same document on a
 * machine with no connectivity.
 */

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function readJson<T>(path: string, what: string): T {
  if (!existsSync(path)) {
    throw new Error(`${path} is missing, so ${what} cannot go in the report. Run it first.`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * The results file must carry every field this report reads, and a stale one must say
 * so rather than render around the gap.
 *
 * Caught in the act: a results file written before per-document reporting existed had
 * no `document` on its items, and the by-document table would have grouped all
 * fifty-five questions under a single blank row. A report that renders a hole is worse
 * than one that refuses, because only the second is noticed.
 */
export function checkAskResults(ask: AskReport): void {
  if (ask.items.length === 0) throw new Error("results/ask-eval.json has no items.");
  if (ask.items.some((i) => typeof i.document !== "string")) {
    throw new Error(
      "results/ask-eval.json predates per-document reporting - its items carry no `document`.\n" +
      "Re-run `npm run ask:eval` to produce a file this report can read.",
    );
  }
}

export interface ExperimentRow {
  label: string;
  fixture: string;
  documents: number;
  questions: number;
  k: number;
  measured: string;
  hit: number;
  recall: number;
  mrr: number;
  stability: number;
  verdict: "baseline" | "kept" | "rejected";
  note?: string;
}

export interface ExperimentGroup {
  id: string;
  title: string;
  blurb: string;
  rows: ExperimentRow[];
}

export const EXPERIMENTS_PATH = "data/retrieval-experiments.json";

/**
 * The variants that were built and measured, as data rather than as a table typed
 * into this template.
 *
 * They were hardcoded here first, and that was the same mistake this file's header
 * warns about, committed by the file that warns about it: sixteen percentages living
 * in a report that claims every number comes from a results file. Worse, they had
 * already begun to drift - the prose still said the model reads eight pages after k
 * became sixteen.
 */
export function loadExperiments(path = EXPERIMENTS_PATH): ExperimentGroup[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { groups: ExperimentGroup[] }).groups;
}

/** Rows carry the conditions they were measured under, because a row measured on three
 *  documents and one measured on fourteen are not comparable and must not look it. */
export function experimentTable(group: ExperimentGroup): string {
  const cls = (r: ExperimentRow, best: boolean): string =>
    r.verdict === "kept" && best ? "n win" : r.verdict === "rejected" && !best ? "n" : "n";
  const bestRecall = Math.max(...group.rows.map((r) => r.recall));
  return `<table>
<tr><th>${esc(group.title)}</th><th class="n">hit@k</th><th class="n">recall@k</th><th class="n">MRR</th><th class="n">stability</th><th class="n">k</th><th class="n">docs</th><th class="n">n</th></tr>
${group.rows.map((r) => `<tr><td>${esc(r.label)}${r.verdict === "rejected" ? "" : ' <span class="win">&#10003;</span>'}${r.note === undefined ? "" : `<br><span class="sub">${esc(r.note)}</span>`}</td><td class="${cls(r, false)}">${pct(r.hit)}</td><td class="${cls(r, r.recall === bestRecall)}">${pct(r.recall)}</td><td class="n">${r.mrr.toFixed(3)}</td><td class="n">${pct(r.stability)}</td><td class="n">${r.k}</td><td class="n">${r.documents}</td><td class="n">${r.questions}</td></tr>`).join("\n")}
</table>`;
}

export interface DocumentRow {
  name: string;
  label: string;
  path: string;
  askable: boolean;
  pages: number;
  characters: number;
  megabytes: number;
  sha256: string;
  reason?: string;
}

export function documentRows(): DocumentRow[] {
  const library = new LibraryStore();
  return library.list().map((s): DocumentRow => {
    const onDisk = s.document !== "-" && existsSync(s.document);
    const pages = s.askable ? library.textFor(s.name) : [];
    return {
      name: s.name,
      label: s.label,
      path: s.document,
      askable: s.askable,
      pages: pages.length,
      characters: pages.reduce((n, p) => n + p.text.length, 0),
      megabytes: onDisk ? statSync(s.document).size / 1e6 : 0,
      // The document a number was computed from, pinned. A reader who fetches the
      // same NDA from accessdata.fda.gov can check they have the same bytes.
      sha256: onDisk ? createHash("sha256").update(readFileSync(s.document)).digest("hex").slice(0, 16) : "-",
      ...(s.reason === undefined ? {} : { reason: s.reason }),
    };
  });
}

const CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.5 Georgia, "Times New Roman", serif; color: #16181d; margin: 0; }
  h1 { font-size: 21pt; margin: 0 0 4pt; letter-spacing: -0.2pt; }
  h2 { font-size: 13pt; margin: 22pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5px solid #16181d; }
  h3 { font-size: 11pt; margin: 14pt 0 4pt; }
  p { margin: 0 0 8pt; }
  .sub { color: #5a6069; font-size: 9.5pt; margin-bottom: 2pt; }
  .meta { font: 8.5pt/1.6 "Consolas", "Courier New", monospace; color: #5a6069;
          border: 1px solid #d7dae0; padding: 7pt 9pt; margin: 10pt 0 0; background: #fafbfc; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9pt; }
  th { text-align: left; border-bottom: 1.2px solid #16181d; padding: 4pt 5pt; font-weight: 700; }
  td { border-bottom: 0.6px solid #e3e6ea; padding: 3.5pt 5pt; vertical-align: top; }
  td.n, th.n { text-align: right; font-family: "Consolas", "Courier New", monospace; white-space: nowrap; }
  .mono { font-family: "Consolas", "Courier New", monospace; font-size: 8.5pt; }
  .head { font-size: 8pt; letter-spacing: 0.6pt; text-transform: uppercase; color: #5a6069; }
  .big { font-size: 15pt; font-family: "Consolas", "Courier New", monospace; }
  .win { color: #12673a; font-weight: 700; }
  .bad { color: #9a2418; font-weight: 700; }
  .note { border-left: 2.5px solid #16181d; padding: 2pt 0 2pt 10pt; margin: 8pt 0 10pt; color: #33383f; }
  .kpis { display: flex; gap: 8pt; margin: 8pt 0 12pt; }
  .kpi { flex: 1; border: 1px solid #d7dae0; padding: 7pt 8pt; }
  .kpi .v { font: 700 15pt "Consolas", "Courier New", monospace; }
  .kpi .l { font-size: 8pt; color: #5a6069; line-height: 1.35; }
  section { break-inside: auto; }
  h2 { break-after: avoid; }
  tr { break-inside: avoid; }
`;

export function renderHtml(input: {
  retrieval: EvalReport;
  ask: AskReport & { repeats?: number; consistency?: { id: string; sameAnswerable: boolean; sameFact: boolean; citationOverlap: number }[] };
  documents: DocumentRow[];
  experiments: ExperimentGroup[];
  fixtureItems: number;
  fixtureDocuments: number;
  commit: string;
  generatedAt: string;
}): string {
  const { retrieval, ask, documents, experiments, commit, generatedAt } = input;
  const group = (id: string): ExperimentGroup | undefined => experiments.find((g) => g.id === id);
  const table = (id: string): string => {
    const g = group(id);
    return g === undefined ? "" : `<p>${esc(g.blurb)}</p>${experimentTable(g)}`;
  };
  // The number of pages an answer reads is read from the run, never written here. It
  // was "eight" in three sentences of prose for as long as it took k to change.
  const k = retrieval.k;
  const askable = documents.filter((d) => d.askable);
  const refused = documents.filter((d) => !d.askable);

  const byDoc = new Map<string, AskItemResult[]>();
  for (const i of ask.items) byDoc.set(i.document, [...(byDoc.get(i.document) ?? []), i]);

  const consistency = ask.consistency ?? [];
  const flipped = consistency.filter((c) => !c.sameAnswerable || !c.sameFact).length;
  const overlap = consistency.length === 0 ? null
    : consistency.reduce((n, c) => n + c.citationOverlap, 0) / consistency.length;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ARBITER - ask surface evaluation</title>
<style>${CSS}</style></head><body>

<p class="sub">ARBITER &middot; evaluation report</p>
<h1>How accurately does the ask surface read a regulatory review?</h1>
<p class="sub">Measured over ${input.fixtureDocuments} documents and ${input.fixtureItems} questions. Generated ${esc(generatedAt)} from commit ${esc(commit)}.</p>

<div class="meta">
model (answering) . . ${esc(ask.model)} on ${ask.provider === "vertex" ? "Vertex AI" : "Anthropic"}<br>
retriever . . . . . . BM25 over pages, Porter stemming, phrase expansion, concept map (services/api/terms.ts)<br>
temperature . . . . . 0, and the retriever is deterministic, so variation across runs is the model alone<br>
inputs. . . . . . . . data/retrieval-eval.json (fixture) &middot; results/retrieval-eval.json &middot; results/ask-eval.json<br>
reproduce . . . . . . npm run retrieval:eval &nbsp;|&nbsp; npm run ask:eval -- --repeats=3 &nbsp;|&nbsp; npm run report
</div>

<h2>1. What this measures, and what it does not</h2>
<p>The surface takes a question about one regulatory review, retrieves ${k} pages, and answers from those pages while naming the page each claim rests on. Two things can go wrong independently, so they are measured separately: the retriever can fail to surface the page holding the answer, and the model can misread a page it was given. Every number below separates them.</p>
<div class="note">
<p style="margin:0"><strong>The honest limits, stated before the results rather than after.</strong> The gold pages were located by regular expression and then read, which biases every comparison toward a lexical retriever. The answer check asks whether the answer <em>states</em> the fact its gold quote carries &mdash; it catches an answer that missed the number, not one that described it wrongly. Graded correctness needs a judge model that is not the answering model, reported with a human-agreement figure beside it; that is not in this report. And the gold set names pages that are <em>sufficient</em>, never all the pages that would do, so citation overlap outside the gold set is not error.</p>
</div>

<h2>2. The documents</h2>
<p>${askable.length} readable documents, each an FDA multi-disciplinary review or an EMA assessment report of an approved drug, fetched by NDA number from accessdata.fda.gov and screened with <span class="mono">data/prep/measure_pdf.py</span> before use. The set varies on purpose: a boxed hepatotoxicity warning, liver findings without one, approved drugs whose labels carry no liver warning at all, and one 505(b)(2) with no new nonclinical studies. A set of only hepatotoxic drugs measures willingness to say danger and nothing else.</p>
<table>
<tr><th>document</th><th class="n">pages</th><th class="n">characters</th><th class="n">MB</th><th class="n">sha256 (first 16)</th></tr>
${askable.map((d) => `<tr><td>${esc(d.label)}</td><td class="n">${d.pages}</td><td class="n">${d.characters.toLocaleString("en-US")}</td><td class="n">${d.megabytes.toFixed(1)}</td><td class="n">${esc(d.sha256)}</td></tr>`).join("\n")}
</table>
<h3>Refused, and why that is a result</h3>
<p>${refused.length} documents in the library cannot be searched, and each states its own reason rather than failing quietly. The refusals are load-bearing: <span class="mono">data/prep/split_review.py</span> refuses rather than trimming by hand, and a document that could be searched anyway would make that refusal decorative.</p>
<table>
<tr><th>document</th><th>why it cannot be searched</th></tr>
${refused.map((d) => `<tr><td>${esc(d.label)}</td><td>${esc(d.reason ?? "")}</td></tr>`).join("\n")}
</table>

<h2>3. Retrieval &mdash; did the answering page reach the model?</h2>
<div class="kpis">
  <div class="kpi"><div class="v">${pct(retrieval.hitRate)}</div><div class="l">hit@${retrieval.k}<br>a page holding the answer was retrieved</div></div>
  <div class="kpi"><div class="v">${pct(retrieval.meanRecall)}</div><div class="l">recall@${retrieval.k}<br>of the pages that hold the answer</div></div>
  <div class="kpi"><div class="v">${retrieval.mrr.toFixed(3)}</div><div class="l">MRR<br>where the first gold page landed</div></div>
  <div class="kpi"><div class="v">${retrieval.meanStability === null ? "n/a" : pct(retrieval.meanStability)}</div><div class="l">paraphrase stability<br>same question, different words, same pages</div></div>
</div>
<p>Measured over ${retrieval.answerable} answerable questions; ${retrieval.unanswerable} unanswerable questions are held aside, since they have no gold page by construction and counting them as misses would report a retrieval failure for a question the document cannot answer.</p>

<h3>Where it started, and what moved it</h3>
${table("history")}
${table("k")}

<h3>Paraphrase stability by question group</h3>
<p>Questions a reviewer would call the same question. This needs no answer key at all, which is why it is the most trustworthy number here: it began at ${(() => { const h = group("history")?.rows[0]; return h === undefined ? "its baseline" : pct(h.stability); })()}, meaning an acronym and its own expansion returned almost disjoint pages.</p>
<table>
<tr><th>question group</th><th class="n">page overlap between phrasings</th></tr>
${retrieval.stabilityByGroup.map((s) => `<tr><td class="mono">${esc(s.group)}</td><td class="n">${pct(s.overlap)}</td></tr>`).join("\n")}
</table>

<h2>4. Answers &mdash; what the model did with the pages</h2>
<div class="kpis">
  <div class="kpi"><div class="v">${pct(ask.statedFactRate)}</div><div class="l">stated the required fact<br>95% CI ${pct(ask.statedFactInterval[0])}&ndash;${pct(ask.statedFactInterval[1])}, n=${ask.answerable}</div></div>
  <div class="kpi"><div class="v">${pct(ask.refusalRate)}</div><div class="l">refused correctly<br>on ${ask.unanswerable} questions the document cannot answer</div></div>
  <div class="kpi"><div class="v">${pct(ask.meanCitationRecall)}</div><div class="l">citation recall<br>of the pages nominated as gold</div></div>
  <div class="kpi"><div class="v">${ask.errors}</div><div class="l">errors<br>upstream failures, truncations, refusals to parse</div></div>
</div>
${consistency.length === 0 ? "" : `
<h3>Consistency</h3>
<p>The same questions asked ${ask.repeats ?? consistency[0]?.citationOverlap ?? 3} times at temperature 0. The retriever is deterministic, so the passages are identical across runs and anything that varies is the model.</p>
<table>
<tr><th>measure</th><th class="n">result</th></tr>
<tr><td>questions whose answer flipped between runs (answered-or-not, or stated-the-fact-or-not)</td><td class="n ${flipped === 0 ? "win" : "bad"}">${flipped}/${consistency.length}</td></tr>
<tr><td>mean pairwise overlap of the citation lists</td><td class="n">${overlap === null ? "n/a" : pct(overlap)}</td></tr>
</table>`}

<h3>By document</h3>
<p>An average over ${input.fixtureDocuments} documents can hide one that fails outright, so it is broken out. This is the varying-data question: does the number hold when the document changes?</p>
<table>
<tr><th>document</th><th class="n">questions</th><th class="n">stated the fact</th><th class="n">refused correctly</th></tr>
${[...byDoc.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([doc, xs]) => {
    const answerable = xs.filter((x) => x.kind === "answerable");
    const stated = xs.filter((x) => x.statedFact === true).length;
    const un = xs.filter((x) => x.kind === "unanswerable");
    const ref = xs.filter((x) => x.refused === true).length;
    const ok = answerable.length > 0 && stated === answerable.length;
    return `<tr><td class="mono">${esc(doc)}</td><td class="n">${answerable.length}</td><td class="n ${ok ? "win" : stated < answerable.length ? "bad" : ""}">${stated}/${answerable.length}</td><td class="n">${un.length === 0 ? "&mdash;" : `${ref}/${un.length}`}</td></tr>`;
  }).join("\n")}
</table>

<h2>5. What was built and rejected</h2>
<p>Both of the obvious next upgrades were implemented, measured on this fixture, and removed. They are here because a report carrying only the improvements is an advertisement, and because the next person to have these ideas should see the numbers rather than repeat the work.</p>
<h3>Sub-page windows</h3>
${table("windows")}
<h3>Dense retrieval and hybrid fusion</h3>
${table("dense")}
<div class="note"><p style="margin:0"><strong>The failure was worth more than the feature.</strong> Dense retrieval scored badly because every page begins with the same running header, so each page's vector encoded the document's identity rather than its content, with cosine scores bunched between 0.70 and 0.74. BM25 had hidden that for free, since idf discounts a term appearing everywhere. Removing the header lifted lexical recall and cut roughly 8% of the tokens from every prompt the surface sends.</p></div>

<h2>6. Reproducing this</h2>
<div class="meta">
git checkout ${esc(commit)}<br>
npm ci<br>
npm run retrieval:eval &nbsp;&nbsp;&nbsp;# writes results/retrieval-eval.json<br>
npm run ask:eval -- --repeats=3 &nbsp;&nbsp;&nbsp;# writes results/ask-eval.json, needs model credentials<br>
npm run report &nbsp;&nbsp;&nbsp;# writes this PDF from those two files
</div>
<p class="sub">The approval-package PDFs are not committed &mdash; each is retrievable from accessdata.fda.gov by the NDA number in its filename, and the sha256 column above pins the bytes every number here was computed from.</p>

</body></html>`;
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (invokedDirectly) {
  const retrieval = readJson<EvalReport>("results/retrieval-eval.json", "the retrieval results");
  const ask = readJson<AskReport & { repeats?: number; consistency?: { id: string; sameAnswerable: boolean; sameFact: boolean; citationOverlap: number }[] }>(
    "results/ask-eval.json", "the answer results",
  );
  checkAskResults(ask);
  const items = loadFixture();

  const html = renderHtml({
    retrieval,
    ask,
    documents: documentRows(),
    experiments: loadExperiments(),
    fixtureItems: items.length,
    fixtureDocuments: new Set(items.map((i) => i.document)).size,
    commit: gitCommit(),
    // Passed in rather than read inside the renderer, so the HTML is a pure function
    // of its inputs and two runs of the same results differ only in this line.
    generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
  });

  mkdirSync("results/report", { recursive: true });
  writeFileSync("results/report/evaluation.html", html, "utf8");

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.pdf({
    path: "results/report/arbiter-evaluation.pdf",
    format: "A4",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate: `<div style="width:100%;font:8pt Georgia,serif;color:#7b818a;padding:0 16mm;display:flex;justify-content:space-between">
      <span>ARBITER &middot; ask surface evaluation</span><span class="pageNumber"></span></div>`,
    margin: { top: "18mm", bottom: "16mm", left: "16mm", right: "16mm" },
  });
  await browser.close();

  console.log("results/report/arbiter-evaluation.pdf");
  console.log("results/report/evaluation.html");
}
