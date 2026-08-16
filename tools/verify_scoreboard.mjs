/**
 * Recompute every headline number from the committed JSON and print it.
 *
 * WHY THIS EXISTS. Ten numbers travel from a harness, into a figure, into a document,
 * into a slide, and every hop is a chance to transcribe one wrong. Twice in this
 * project a stale figure survived a fixture change - a footnote said 77/81 after the
 * fixture had grown past it, and a plot title said "ten" after a metric was removed.
 * This recomputes each rate from the raw items rather than reading a summary field, so
 * a number that has drifted anywhere shows up as a mismatch here.
 *
 * It asserts nothing about whether the numbers are GOOD. It asserts they are what the
 * data says.
 *
 * Run:  node tools/verify_scoreboard.mjs
 */
import { readFileSync } from "node:fs";

const MODEL = "gemini-3.5-flash";
const read = (p) => JSON.parse(readFileSync(p, "utf8"));

const ask = read(`results/model-comparison/ask-eval-${MODEL}.json`);
const retrieval = read("results/retrieval-eval.json");
const five = read(`results/model-comparison/verdict-five-${MODEL}.json`);
const cf = read(`results/model-comparison/counterfactual-${MODEL}.json`);
const fixture = read("data/retrieval-eval.json");

function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 1];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n);
  const s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}
const row = (label, k, n) => {
  const [lo, hi] = wilson(k, n);
  console.log(`  ${label.padEnd(34)} ${(100 * k / n).toFixed(1).padStart(5)}%  ${String(`${k}/${n}`).padStart(7)}   CI ${(100 * lo).toFixed(1)}–${(100 * hi).toFixed(1)}%`);
};

// ---- ASK. Key off `kind`, never `answerable`: that field records whether the model
// PRODUCED AN ANSWER, so an unanswerable item it wrongly answered would be counted as
// answerable and silently leave the refusal denominator.
const answerable = ask.items.filter((i) => i.kind === "answerable");
const unanswerable = ask.items.filter((i) => i.kind === "unanswerable");
const judged = answerable.filter((i) => i.judged !== null);

const hitOf = new Map(retrieval.items.map((i) => [i.id, i.hit === true]));
const groups = new Map();
for (const it of fixture.items) {
  if (it.kind !== "answerable") continue;
  if (!groups.has(it.group)) groups.set(it.group, []);
  groups.get(it.group).push(it.id);
}
const multi = [...groups.values()].filter((ids) => ids.length > 1);

console.log("ASK");
row("1 finds the passage (hit@16)", Math.round(retrieval.hitRate * retrieval.answerable), retrieval.answerable);
row("2 gets the fact right (judged)", judged.filter((i) => i.judged === true).length, judged.length);
row("3 points to a correct page", answerable.filter((i) => (i.citationRecall ?? 0) > 0).length, answerable.length);
row("4 says when it cannot answer", unanswerable.filter((i) => i.refused === true).length, unanswerable.length);
row("5 same answer however asked", multi.filter((ids) => ids.every((id) => hitOf.get(id) === true)).length, multi.length);

// ---- VERDICT. Metrics 2 and 3 are scored over the cases that CAN fail them; counting
// the rest inflates the denominator, which misleads more than inflating the rate.
console.log("\nVERDICT");
const t = five.tested;
row("1 verdict is right", five.score.verdict, five.rows.length);
row("2 prose stays in evidence", five.score.prose, t.prose);
row("3 names the deciding rule", five.score.rule, t.rule);
row("4 runs agree (consensus of 3)", five.score.stable, five.rows.length);
row("5 tracks a changed fact", cf.passed, cf.rows.length);
console.log(`     counterfactual: ${cf.stuck} stuck, ${cf.baseOnly} base-only`);

// ---- Cross-checks that have actually gone wrong before.
console.log("\nCROSS-CHECKS");
const problems = [];
if (ask.answerable !== answerable.length) problems.push(`ask.answerable ${ask.answerable} != ${answerable.length} counted by kind`);
if (ask.unanswerable !== unanswerable.length) problems.push(`ask.unanswerable ${ask.unanswerable} != ${unanswerable.length} counted by kind`);
if (retrieval.answerable !== answerable.length) problems.push(`retrieval and ask disagree on answerable: ${retrieval.answerable} vs ${answerable.length} - the two files are from different fixtures`);
if (ask.errors !== 0) problems.push(`ask errors: ${ask.errors}`);
if (ask.model !== MODEL) problems.push(`ask model is ${ask.model}, not ${MODEL}`);
if (five.model !== MODEL) problems.push(`verdict model is ${five.model}, not ${MODEL}`);
if (five.scoredMetrics && five.scoredMetrics.includes("gaps")) problems.push("gap recall is still listed as a scored metric");

console.log(`  ask and retrieval both on ${answerable.length} answerable + ${unanswerable.length} unanswerable`);
console.log(`  documents in fixture: ${new Set(fixture.items.map((i) => i.document)).size}`);
console.log(`  model: ${ask.model} via ${ask.provider}, errors ${ask.errors}`);
console.log(problems.length === 0 ? "  OK - no drift found" : `  ${problems.length} PROBLEM(S):`);
for (const p of problems) console.log(`    - ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
