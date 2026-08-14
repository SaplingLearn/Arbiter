import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { buildIndex, search } from "./retrieval.js";
import { LibraryStore } from "./library.js";

/**
 * Measuring the retriever, because "the ask surface works" is not a claim until
 * something says how well.
 *
 * WHAT IS MEASURED, AND WHY THESE THREE.
 *
 *   hit@k and recall@k - did the pages that hold the answer reach the model at all.
 *   This is the split that matters most when an answer is wrong: a page that was
 *   never retrieved is a retrieval failure, and a page that was retrieved and
 *   misread is a generation failure. Without it every bad answer looks like the
 *   model's fault.
 *
 *   MRR - where in the eight the first gold page landed. The model reads all eight,
 *   but position is not free, and a retriever that puts the answer eighth is one
 *   ranking change away from putting it ninth.
 *
 *   PARAPHRASE STABILITY - the mean pairwise overlap of the pages returned for
 *   questions a reviewer would call the same question. This one needs no answer key
 *   at all, which is exactly why it is here: it was measured at 2-7% on the current
 *   retriever, and "What NOAEL was set?" and "no observed adverse effect level"
 *   returned one shared page out of fifteen. A retriever whose answer depends on
 *   whether the reader typed the acronym is not answering the question, it is
 *   answering the wording.
 *
 * UNANSWERABLE ITEMS ARE SCORED SEPARATELY AND NEVER AVERAGED IN. They have no gold
 * pages by construction, so counting them among the misses would report a retrieval
 * failure for a question the document genuinely cannot answer. They exist to test
 * refusal, which belongs to the answering surface rather than to the retriever.
 */

export interface GoldPage {
  page: number;
  /** Verbatim from the page. The fixture is auditable or it is an assertion. */
  quote: string;
}

export interface EvalItem {
  id: string;
  document: string;
  /** Questions a reviewer would call the same question. Stability is computed inside it. */
  group: string;
  kind: "answerable" | "unanswerable";
  question: string;
  goldPages: GoldPage[];
  /** Regular expressions the ANSWER must match. Scored by ask-eval.ts, not here. */
  mustContain?: string[];
  why?: string;
}

export interface ItemResult {
  id: string;
  group: string;
  kind: EvalItem["kind"];
  question: string;
  retrieved: number[];
  hit: boolean;
  recall: number;
  reciprocalRank: number;
}

export interface EvalReport {
  k: number;
  answerable: number;
  unanswerable: number;
  hitRate: number;
  meanRecall: number;
  mrr: number;
  meanStability: number | null;
  stabilityByGroup: { group: string; overlap: number }[];
  items: ItemResult[];
}

const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Every gold quote must still be on its gold page. Run before scoring, and fail
 * loudly: a fixture that rots silently turns every later number into a measurement
 * against pages nobody has checked since.
 */
export function verifyFixture(
  items: EvalItem[],
  pagesFor: (document: string) => { page: number; text: string }[],
): string[] {
  const failures: string[] = [];
  for (const item of items) {
    const pages = pagesFor(item.document);
    if (pages.length === 0) {
      failures.push(`${item.id}: no extracted text for document "${item.document}"`);
      continue;
    }
    for (const gold of item.goldPages) {
      const page = pages.find((p) => p.page === gold.page);
      if (page === undefined) {
        failures.push(`${item.id}: ${item.document} has no page ${gold.page}`);
      } else if (!flat(page.text).includes(flat(gold.quote))) {
        failures.push(`${item.id}: the quote for ${item.document} p${gold.page} is no longer on that page`);
      }
    }

    /**
     * Every answer pattern must match the evidence it was drawn from.
     *
     * A pattern that cannot match its own gold quote is unsatisfiable, and it fails
     * silently in the worst possible direction: as a model that got the answer wrong.
     * Fourteen items shipped with `(100)s*mg/kg` - a generator's template literal had
     * eaten the backslash, so the pattern demanded a literal "s" between the dose and
     * the unit and could never match anything. It was caught by reading, one run
     * before the numbers would have been reported.
     */
    for (const pattern of item.mustContain ?? []) {
      let rx: RegExp;
      try {
        rx = new RegExp(pattern, "i");
      } catch (e) {
        failures.push(`${item.id}: mustContain ${JSON.stringify(pattern)} is not a regular expression - ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (item.goldPages.length > 0 && !item.goldPages.some((g) => rx.test(g.quote))) {
        failures.push(`${item.id}: mustContain ${JSON.stringify(pattern)} matches none of its own gold quotes, so no answer can satisfy it`);
      }
    }
  }
  return failures;
}

export function scoreItem(item: EvalItem, retrieved: number[]): ItemResult {
  const gold = new Set(item.goldPages.map((g) => g.page));
  const found = retrieved.filter((p) => gold.has(p));
  const firstRank = retrieved.findIndex((p) => gold.has(p));
  return {
    id: item.id,
    group: item.group,
    kind: item.kind,
    question: item.question,
    retrieved,
    hit: found.length > 0,
    recall: gold.size === 0 ? 0 : found.length / gold.size,
    reciprocalRank: firstRank === -1 ? 0 : 1 / (firstRank + 1),
  };
}

/** Mean pairwise Jaccard overlap. Null when there is nothing to compare against. */
export function stabilityOf(sets: number[][]): number | null {
  if (sets.length < 2) return null;
  const pairs: number[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = new Set(sets[i]);
      const b = new Set(sets[j]);
      const union = new Set([...a, ...b]);
      const inter = [...a].filter((x) => b.has(x)).length;
      pairs.push(union.size === 0 ? 1 : inter / union.size);
    }
  }
  return pairs.reduce((n, x) => n + x, 0) / pairs.length;
}

export function evaluate(
  items: EvalItem[],
  retrieve: (item: EvalItem) => number[],
  k: number,
): EvalReport {
  const results = items.map((item) => scoreItem(item, retrieve(item)));
  const answerable = results.filter((r) => r.kind === "answerable");

  const byGroup = new Map<string, number[][]>();
  for (const r of results) {
    if (r.kind !== "answerable") continue;
    byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r.retrieved]);
  }
  const stabilityByGroup = [...byGroup.entries()]
    .map(([group, sets]) => ({ group, overlap: stabilityOf(sets) }))
    .filter((s): s is { group: string; overlap: number } => s.overlap !== null)
    .sort((a, b) => (a.group < b.group ? -1 : 1));

  const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((n, x) => n + x, 0) / xs.length);

  return {
    k,
    answerable: answerable.length,
    unanswerable: results.length - answerable.length,
    hitRate: mean(answerable.map((r) => (r.hit ? 1 : 0))),
    meanRecall: mean(answerable.map((r) => r.recall)),
    mrr: mean(answerable.map((r) => r.reciprocalRank)),
    meanStability: stabilityByGroup.length === 0 ? null : mean(stabilityByGroup.map((s) => s.overlap)),
    stabilityByGroup,
    items: results,
  };
}

export const FIXTURE_PATH = "data/retrieval-eval.json";

export function loadFixture(path = FIXTURE_PATH): EvalItem[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { items: EvalItem[] }).items;
}

/**
 * Pages come from the LibraryStore, not from its cache file.
 *
 * The store is what the server searches, and it is where boilerplate is stripped. A
 * scorer that read the cache directly would measure whatever happened to be on disk
 * and would silently score the wrong text the day that pipeline changed - and it did
 * change, which is how this comment came to exist. Extraction is cached, so the first
 * run pays for PyMuPDF once and the rest are free.
 */
const library = new LibraryStore();

export function pagesFor(document: string): { page: number; text: string }[] {
  // No CaseName check any more: the library outgrew the case catalogue when the
  // benchmark documents arrived, and gating on it silently reported every one of them
  // as having no extracted text. The store already returns nothing for a name it does
  // not hold, which is the same answer without the false negative.
  return library.textFor(document);
}

export function runFixture(items: EvalItem[], k = 8): EvalReport {
  // One index per document, built once. Rebuilding per question would measure the
  // same thing and take a minute.
  const indexes = new Map<string, ReturnType<typeof buildIndex>>();
  const indexFor = (document: string): ReturnType<typeof buildIndex> => {
    const existing = indexes.get(document);
    if (existing !== undefined) return existing;
    const built = buildIndex([{ documentId: document, filename: document, pages: pagesFor(document) }]);
    indexes.set(document, built);
    return built;
  };
  return evaluate(items, (item) => search(indexFor(item.document), item.question, k).map((p) => p.page), k);
}

export function formatReport(r: EvalReport, label: string): string[] {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  return [
    `${label} - k=${r.k}, ${r.answerable} answerable questions, ${r.unanswerable} unanswerable held aside`,
    `  hit@${r.k}          ${pct(r.hitRate)}   (a gold page reached the model at all)`,
    `  recall@${r.k}       ${pct(r.meanRecall)}   (of the pages that hold the answer)`,
    `  MRR             ${r.mrr.toFixed(3)}   (where the first gold page landed)`,
    `  stability       ${r.meanStability === null ? "n/a" : pct(r.meanStability)}   (same question, different words, same pages?)`,
    ...r.stabilityByGroup.map((s) => `    ${s.group.padEnd(34)} ${pct(s.overlap)}`),
  ];
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (invokedDirectly) {
  const items = loadFixture();
  const failures = verifyFixture(items, pagesFor);
  if (failures.length > 0) {
    console.error("The fixture does not match the documents:");
    for (const f of failures) console.error(`  ${f}`);
    console.error("\nExtract the library documents first (ask any question of them), or fix the fixture.");
    process.exit(1);
  }

  const report = runFixture(items);
  console.log(formatReport(report, "retrieval").join("\n"));

  const misses = report.items.filter((i) => i.kind === "answerable" && !i.hit);
  if (misses.length > 0) {
    console.log(`\n${misses.length} question(s) retrieved no page holding the answer:`);
    for (const m of misses) console.log(`  ${m.id.padEnd(24)} ${JSON.stringify(m.question)}`);
  }

  writeFileSync("results/retrieval-eval.json", JSON.stringify(report, null, 2), "utf8");
  console.log("\nWritten to results/retrieval-eval.json");
}
