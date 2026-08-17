/**
 * Audit the retrieval fixture against whatever documents this checkout actually has.
 *
 * WHY THIS EXISTS ALONGSIDE `npm run retrieval:eval`. That command verifies the whole
 * fixture and then scores it, and it is right to refuse to run when a quote has
 * rotted. But `data/raw/approval-packages/` is gitignored, so on most checkouts most
 * documents are simply ABSENT - and "I cannot find this document" and "this quote is
 * no longer on its page" are different facts that the full run collapses into one
 * wall of failures. Adding a document to the corpus is then unverifiable until every
 * other document has been re-downloaded, which is backwards.
 *
 * So this reuses `verifyFixture` - the same checks, not a reimplementation - over the
 * subset whose extraction cache is present, and reports the absent documents as a
 * separate count rather than as failures. It never scores anything and never needs a
 * model: it answers "are these quotes real and on the page they name", which is the
 * question you need answered before a new document is worth measuring.
 *
 * With `--score` it also runs the retrieval half of the benchmark over that subset.
 * That half needs NO MODEL and no credentials - it is the index and the question, and
 * nothing else - so a new document's retrieval numbers can be measured on a checkout
 * that could not run `ask:eval` at all.
 *
 * Usage:  npx tsx tools/validate_fixture.ts [--score] [document ...]
 */
import { existsSync, readFileSync } from "node:fs";
import { formatReport, loadFixture, runFixture, verifyFixture, type EvalItem } from "../services/api/retrieval-eval.js";

const CACHE = "results/library";
const argv = process.argv.slice(2);
const score = argv.includes("--score");
const only = new Set(argv.filter((a) => !a.startsWith("--")));

const cached = (document: string): boolean => existsSync(`${CACHE}/${document}.pages.json`);

const pagesFor = (document: string): { page: number; text: string }[] => {
  const path = `${CACHE}/${document}.pages.json`;
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")) as { page: number; text: string }[];
};

const all: EvalItem[] = loadFixture();
const wanted = only.size === 0 ? all : all.filter((i) => only.has(i.document));

const present = wanted.filter((i) => cached(i.document));
const absent = wanted.filter((i) => !cached(i.document));

const absentDocs = [...new Set(absent.map((i) => i.document))].sort();
const presentDocs = [...new Set(present.map((i) => i.document))].sort();

console.log(`fixture: ${all.length} items over ${new Set(all.map((i) => i.document)).size} documents`);
console.log(`checking ${present.length} items over ${presentDocs.length} document(s): ${presentDocs.join(", ") || "-"}`);
if (absentDocs.length > 0) {
  console.log(`skipping ${absent.length} items over ${absentDocs.length} document(s) with no extraction cache in this checkout:`);
  console.log(`  ${absentDocs.join(", ")}`);
}

const failures = verifyFixture(present, pagesFor);

// An unanswerable item asserts an ABSENCE, and verifyFixture cannot check an absence -
// it has no gold page to look at. Re-state the assertion here so the item is not
// silently counted as verified when nothing about it was verified.
const unanswerable = present.filter((i) => i.kind === "unanswerable");

console.log("");
if (failures.length === 0) {
  console.log(`PASS  every gold quote is verbatim on the page it names (${present.length - unanswerable.length} answerable items).`);
} else {
  console.log(`FAIL  ${failures.length} problem(s):`);
  for (const f of failures) console.log(`  - ${f}`);
}
if (unanswerable.length > 0) {
  console.log(`NOTE  ${unanswerable.length} unanswerable item(s) assert an absence and carry no gold page.`);
  console.log(`      Their 'why' records the zero-hit search that justified them; re-run that search to re-verify.`);
}

if (score && failures.length === 0 && present.length > 0) {
  console.log("");
  const report = runFixture(present);
  for (const line of formatReport(report, "retrieval over this subset")) console.log(line);

  // Name the misses. A rate tells you how much is wrong; only the list tells you
  // WHAT, and a miss is usually either a bad question or a page the index cannot
  // reach - two different repairs.
  const missed = report.items.filter((i) => i.kind === "answerable" && !i.hit);
  if (missed.length > 0) {
    console.log(`\n  ${missed.length} miss(es):`);
    for (const m of missed) console.log(`    ${m.id.padEnd(26)} ${m.question}`);
  }
}

process.exit(failures.length === 0 ? 0 : 1);
