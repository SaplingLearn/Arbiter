import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { buildIndex, search } from "./retrieval.js";
import { handleAsk } from "./ask.js";
import { completeFromEnv } from "./interpret.js";
import { loadFixture, pagesFor, verifyFixture, type EvalItem } from "./retrieval-eval.js";

/**
 * Measuring the ANSWERS, not the retrieval.
 *
 * retrieval-eval.ts asks whether the page holding the answer reached the model.
 * This asks what the model then did with it, over the same fixture and through the
 * same code the server runs - `search` into `handleAsk` into a live call. Nothing is
 * mocked, because a measurement of a mock is a measurement of a mock.
 *
 * FOUR THINGS, EACH DELIBERATELY NARROW.
 *
 *   STATES THE FACT. `mustContain` is a regular expression drawn from the same
 *   verified quote that makes a page gold, so this is objective and needs no judge.
 *   It is weaker than "the answer is correct" and is named that way on purpose: it
 *   catches an answer that missed the number, not one that misdescribed it. An
 *   LLM-graded correctness score belongs here eventually, and it belongs with a
 *   human-agreement figure beside it or it is one model agreeing with another.
 *
 *   CITATION PRECISION AND RECALL against the gold pages. This is the claim the whole
 *   surface rests on - "names the page it rests on" - and it is the one number here
 *   that is fully deterministic given the answer.
 *
 *   REFUSAL. The unanswerable items exist for this. A surface that answers a question
 *   its document cannot support is worse than one that answers nothing, because the
 *   reader cannot tell the two apart. This is the SQuAD 2.0 shape: a system that
 *   scores well only on answerable questions has not been tested.
 *
 *   CONSISTENCY, when run with repeats. Temperature is already 0 and the retriever is
 *   deterministic, so any variation across runs is the model's alone - which is the
 *   condition that makes a flip rate mean something.
 */

export interface AskItemResult {
  id: string;
  document: string;
  kind: EvalItem["kind"];
  question: string;
  answerable: boolean;
  answer: string;
  citedPages: number[];
  goldPages: number[];
  /** Answerable items only: did the answer state the fact the gold quote carries? */
  statedFact: boolean | null;
  citationPrecision: number | null;
  citationRecall: number | null;
  /** Unanswerable items only: did it correctly decline? */
  refused: boolean | null;
  error?: string;
}

export interface AskReport {
  model: string;
  answerable: number;
  unanswerable: number;
  statedFactRate: number;
  statedFactInterval: [number, number];
  answeredRate: number;
  meanCitationPrecision: number;
  meanCitationRecall: number;
  refusalRate: number;
  errors: number;
  items: AskItemResult[];
}

/**
 * Wilson score interval. A second copy of apps/harness/src/stats.ts, and deliberately
 * so: that file belongs to the benchmark project, which references the engine and
 * cannot import this service, and this service cannot import it back. Eight lines of
 * arithmetic duplicated beats a build-graph edge between the two.
 */
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (centre - spread) / d), Math.min(1, (centre + spread) / d)];
}

const matchesAll = (answer: string, patterns: string[]): boolean =>
  patterns.every((p) => new RegExp(p, "i").test(answer));

export async function scoreOne(item: EvalItem, k = 8): Promise<AskItemResult> {
  const pages = pagesFor(item.document);
  const passages = search(
    buildIndex([{ documentId: item.document, filename: item.document, pages }]),
    item.question,
    k,
  );
  const out = await handleAsk({ question: item.question }, passages, completeFromEnv(process.env, "ask"));
  const body = out.body as {
    answerable?: boolean; answer?: string;
    citations?: { page: number }[]; error?: string;
  };

  const gold = item.goldPages.map((g) => g.page);
  const cited = [...new Set((body.citations ?? []).map((c) => c.page))];
  const hit = cited.filter((p) => gold.includes(p));
  const answer = body.answer ?? "";
  const answerable = body.answerable === true;

  return {
    id: item.id,
    document: item.document,
    kind: item.kind,
    question: item.question,
    answerable,
    answer,
    citedPages: cited,
    goldPages: gold,
    statedFact: item.kind === "unanswerable" ? null
      : answerable && matchesAll(answer, item.mustContain ?? []),
    // Precision over an empty citation list is not zero, it is undefined - there was
    // no claim to be wrong about. Scoring it as zero would punish a correct refusal.
    citationPrecision: item.kind === "unanswerable" || cited.length === 0 ? null : hit.length / cited.length,
    citationRecall: item.kind === "unanswerable" || gold.length === 0 ? null : hit.length / gold.length,
    refused: item.kind === "unanswerable" ? !answerable : null,
    ...(out.status === 200 ? {} : { error: body.error ?? `HTTP ${out.status}` }),
  };
}

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((n, x) => n + x, 0) / xs.length);

export function summarise(items: AskItemResult[], model: string): AskReport {
  const answerable = items.filter((i) => i.kind === "answerable");
  const unanswerable = items.filter((i) => i.kind === "unanswerable");
  const stated = answerable.filter((i) => i.statedFact === true).length;

  return {
    model,
    answerable: answerable.length,
    unanswerable: unanswerable.length,
    statedFactRate: answerable.length === 0 ? 0 : stated / answerable.length,
    statedFactInterval: wilson(stated, answerable.length),
    answeredRate: answerable.length === 0 ? 0 : answerable.filter((i) => i.answerable).length / answerable.length,
    meanCitationPrecision: mean(answerable.flatMap((i) => (i.citationPrecision === null ? [] : [i.citationPrecision]))),
    meanCitationRecall: mean(answerable.flatMap((i) => (i.citationRecall === null ? [] : [i.citationRecall]))),
    refusalRate: unanswerable.length === 0 ? 0 : unanswerable.filter((i) => i.refused === true).length / unanswerable.length,
    errors: items.filter((i) => i.error !== undefined).length,
    items,
  };
}

export function byDocument(items: AskItemResult[]): { document: string; n: number; stated: number; refusedOf: number; refused: number }[] {
  const docs = new Map<string, AskItemResult[]>();
  for (const i of items) docs.set(i.document, [...(docs.get(i.document) ?? []), i]);
  return [...docs.entries()].map(([document, xs]) => ({
    document,
    n: xs.filter((x) => x.kind === "answerable").length,
    stated: xs.filter((x) => x.statedFact === true).length,
    refusedOf: xs.filter((x) => x.kind === "unanswerable").length,
    refused: xs.filter((x) => x.refused === true).length,
  })).sort((a, b) => (a.document < b.document ? -1 : 1));
}

export function formatAskReport(r: AskReport): string[] {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  return [
    `ask - ${r.model}, ${r.answerable} answerable + ${r.unanswerable} unanswerable`,
    `  states the fact      ${pct(r.statedFactRate)}   (95% CI ${pct(r.statedFactInterval[0])}-${pct(r.statedFactInterval[1])})`,
    `  answered at all      ${pct(r.answeredRate)}   (the rest said the documents do not say)`,
    `  citation recall      ${pct(r.meanCitationRecall)}   (nominated pages that were cited)`,
    // NOT reported as precision, because it is not precision. The fixture nominates
    // the pages an answer MUST find, never all the pages that would do - and the
    // audit showed why that distinction is not pedantic: asked whether the drug
    // damages the liver, the model answered from the clinical chapter, cited two
    // patients out of 768 with irreversible injury, and scored zero against gold
    // pages that hold the ANIMAL findings. It was right and the fixture was narrow.
    `  cited outside gold   ${pct(1 - r.meanCitationPrecision)}   (not error - the gold set names sufficient pages, not all valid ones)`,
    `  refused when it must ${pct(r.refusalRate)}   (unanswerable questions correctly declined)`,
    ...(r.errors > 0 ? [`  ERRORS               ${r.errors}`] : []),
  ];
}

/**
 * The same question asked N times, and whether the answers agreed.
 *
 * Temperature is 0 and the retriever is deterministic, so the passages are identical
 * across runs by construction and anything that varies is the model. That is the
 * condition redesign spec 7.1 sets for a flip rate to mean something, and it is why
 * this can be measured on the ask surface at all.
 *
 * Agreement is judged on what a reader would notice: whether it answered, whether the
 * answer still carried the fact, and how much of the citation list survived. Not on
 * the prose, which will differ in wording every time and is not a flip.
 */
export interface ConsistencyResult {
  id: string;
  runs: number;
  sameAnswerable: boolean;
  sameFact: boolean;
  citationOverlap: number;
}

export function consistencyOf(id: string, runs: AskItemResult[]): ConsistencyResult {
  const pairs: number[] = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = new Set(runs[i]!.citedPages);
      const b = new Set(runs[j]!.citedPages);
      const union = new Set([...a, ...b]);
      pairs.push(union.size === 0 ? 1 : [...a].filter((p) => b.has(p)).length / union.size);
    }
  }
  return {
    id,
    runs: runs.length,
    sameAnswerable: new Set(runs.map((r) => r.answerable)).size === 1,
    sameFact: new Set(runs.map((r) => r.statedFact)).size === 1,
    citationOverlap: pairs.length === 0 ? 1 : pairs.reduce((n, x) => n + x, 0) / pairs.length,
  };
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (invokedDirectly) {
  const items = loadFixture();
  const failures = verifyFixture(items, pagesFor);
  if (failures.length > 0) {
    console.error("The fixture does not match the documents:");
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  if (completeFromEnv(process.env, "ask") === null) {
    console.error("No credentials for the ask model, so there is nothing to measure.");
    console.error("Set ARBITER_GCP_PROJECT (Vertex, via ADC) or ANTHROPIC_API_KEY.");
    process.exit(1);
  }

  const model = process.env["ARBITER_ASK_MODEL"] ?? process.env["ARBITER_MODEL"] ?? "gemini-3.5-flash";
  const repeatsArg = process.argv.find((a) => a.startsWith("--repeats="));
  const repeats = repeatsArg === undefined ? 1 : Math.max(1, Number(repeatsArg.split("=")[1]));
  const runsById = new Map<string, AskItemResult[]>();
  const results: AskItemResult[] = [];
  // Sequential on purpose: this is a measurement, not a load test, and a rate limit
  // mid-run would show up as model failure in the numbers.
  for (const item of items) {
    process.stdout.write(`  ${item.id.padEnd(24)}`);
    try {
      const runs: AskItemResult[] = [];
      for (let i = 0; i < repeats; i++) runs.push(await scoreOne(item));
      runsById.set(item.id, runs);
      // The first run is the one scored, so a single-run report and the first run of
      // a repeated one are the same number rather than an average nobody can trace.
      const r = runs[0]!;
      results.push(r);
      const mark = r.kind === "unanswerable"
        ? (r.refused === true ? "refused (correct)" : "ANSWERED (wrong)")
        : (r.statedFact === true ? "stated the fact" : r.answerable ? "MISSED the fact" : "declined");
      console.log(`${mark.padEnd(20)} cited ${JSON.stringify(r.citedPages)}`);
    } catch (e) {
      console.log(`ERROR ${e instanceof Error ? e.message : String(e)}`);
      results.push({
        id: item.id, document: item.document, kind: item.kind, question: item.question, answerable: false, answer: "",
        citedPages: [], goldPages: item.goldPages.map((g) => g.page), statedFact: false,
        citationPrecision: null, citationRecall: null, refused: null,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const report = summarise(results, model);
  console.log(`\n${formatAskReport(report).join("\n")}`);

  // Broken out because an average over fourteen documents can hide one that fails
  // outright, and "does the number hold when the document changes" is the question a
  // varied document set exists to answer.
  console.log("\nby document");
  for (const d of byDocument(results)) {
    const refusal = d.refusedOf === 0 ? "" : `   refused ${d.refused}/${d.refusedOf}`;
    console.log(`  ${d.document.padEnd(14)} ${String(d.stated).padStart(2)}/${String(d.n).padEnd(2)} stated the fact${refusal}`);
  }

  let consistency: ConsistencyResult[] = [];
  if (repeats > 1) {
    consistency = [...runsById.entries()].map(([id, runs]) => consistencyOf(id, runs));
    const flipped = consistency.filter((c) => !c.sameAnswerable || !c.sameFact);
    const overlap = consistency.reduce((n, c) => n + c.citationOverlap, 0) / consistency.length;
    console.log(`\nconsistency over ${repeats} runs at temperature 0`);
    console.log(`  flipped              ${flipped.length}/${consistency.length}   (answered-or-not, or stated-the-fact-or-not, changed between runs)`);
    console.log(`  citation overlap     ${(overlap * 100).toFixed(1)}%   (mean pairwise, same question, same passages)`);
    for (const c of flipped) console.log(`    ${c.id}: answerable ${c.sameAnswerable ? "stable" : "FLIPPED"}, fact ${c.sameFact ? "stable" : "FLIPPED"}`);
  }

  writeFileSync("results/ask-eval.json", JSON.stringify({ ...report, repeats, consistency }, null, 2), "utf8");
  console.log("\nWritten to results/ask-eval.json");
}
