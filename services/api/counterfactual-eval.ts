import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ADJUDICATOR_PROMPT_PATH, handleAdjudicate, type Adjudication, type AdjudicateRequest } from "./adjudicate.js";
import { completeFromEnv } from "./interpret.js";
import { loadEnv } from "./env.js";
import { wilson } from "./verdict-eval.js";

/**
 * COUNTERFACTUAL SENSITIVITY - is the adjudicator reading the evidence, or the shape of it?
 *
 * WHY THIS AND NOT MORE ACCURACY. A fixed set of cases can be scored well without
 * reasoning at all: four of nine constructed cases are `cannot_conclude`, so a system
 * that always abstains scores 44%, and one that has learned "package with a margin and no
 * human finding means advance" does better still. Accuracy cannot separate that from
 * comprehension.
 *
 * A minimal pair can. Each pair here is one case and its near-identical twin with exactly
 * ONE decisive fact inverted - the human finding flips, the exposure moves from 1.1x to
 * 60x, the damage does or does not reverse. The two prompts differ by a clause. Answering
 * both correctly is only possible by reading the clause that differs, and that is not
 * something a prior over case shapes can fake.
 *
 * This is the standard minimal-pair / contrast-set design from behavioural NLP testing -
 * CheckList (Ribeiro et al., ACL 2020) and contrast sets (Gardner et al., EMNLP Findings
 * 2020). It is reported here as three numbers because they fail differently:
 *
 *   PAIR SENSITIVITY  both halves right. The headline: the system tracked the edit.
 *   BASE-ONLY        the original right, the flip wrong. The diagnostic failure - the
 *                    first answer did not depend on the fact that was supposed to drive it.
 *   STUCK            both halves given the SAME verdict. The system did not notice the
 *                    edit at all, which is worse than getting one wrong.
 */

interface Half {
  expect: string;
  compoundLabel: string;
  context: string;
  findings: AdjudicateRequest["findings"];
  absentOverride?: { field: string; whatItBlocks: string }[];
  presentOverride?: { field: string; half: "mechanism" | "consequence" }[];
}

interface Pair {
  id: string; edit: string; tests: string;
  base: Half; flip: Half;
  present: { field: string; half: "mechanism" | "consequence" }[];
  absent: { field: string; whatItBlocks: string }[];
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (invokedDirectly) {
  loadEnv();
  const fx = JSON.parse(readFileSync("data/verdict-counterfactual.json", "utf8")) as
    { rules: AdjudicateRequest["rules"]; pairs: Pair[] };
  const prompt = JSON.parse(readFileSync(ADJUDICATOR_PROMPT_PATH, "utf8")) as { system: string[]; userTemplate: string[] };
  const complete = completeFromEnv(process.env, "adjudication");
  const model = process.env["ARBITER_ADJUDICATION_MODEL"] ?? process.env["ARBITER_MODEL"] ?? "gemini-3.5-flash";
  if (complete === null) { console.error(`No credentials for ${model}.`); process.exit(2); }

  const ask = async (p: Pair, h: Half): Promise<string> => {
    const req = {
      compoundLabel: h.compoundLabel, context: h.context, rules: fx.rules,
      findings: h.findings,
      absent: h.absentOverride ?? p.absent,
      present: h.presentOverride ?? p.present,
    } as AdjudicateRequest;
    const res = await handleAdjudicate(req, complete, prompt);
    if (res.status !== 200) return "error";
    return (res.body as Adjudication).consequence.verdict;
  };

  const rows: { id: string; edit: string; baseWant: string; baseGot: string; flipWant: string; flipGot: string; pass: boolean; stuck: boolean }[] = [];
  for (const p of fx.pairs) {
    const baseGot = await ask(p, p.base);
    const flipGot = await ask(p, p.flip);
    const pass = baseGot === p.base.expect && flipGot === p.flip.expect;
    const stuck = baseGot === flipGot && baseGot !== "error";
    rows.push({ id: p.id, edit: p.edit, baseWant: p.base.expect, baseGot, flipWant: p.flip.expect, flipGot, pass, stuck });
    console.log(`  ${p.id.padEnd(26)} base ${baseGot.padEnd(16)}${baseGot === p.base.expect ? "ok" : "XX"}   flip ${flipGot.padEnd(16)}${flipGot === p.flip.expect ? "ok" : "XX"}   ${stuck ? "<< STUCK" : ""}`);
  }

  const n = rows.length;
  const passed = rows.filter((r) => r.pass).length;
  const stuck = rows.filter((r) => r.stuck).length;
  const baseOnly = rows.filter((r) => !r.pass && r.baseGot === r.baseWant).length;
  const [lo, hi] = wilson(passed, n);

  console.log(`\ncounterfactual sensitivity - ${model}, ${n} minimal pairs`);
  console.log(`  PAIR SENSITIVITY  ${passed}/${n} = ${(passed / n * 100).toFixed(1)}%   (95% CI ${(lo * 100).toFixed(1)}%-${(hi * 100).toFixed(1)}%)`);
  console.log(`                    both halves correct, so the edit was tracked`);
  console.log(`  base-only         ${baseOnly}/${n}   original right, flip wrong - the first answer did not depend on the fact`);
  console.log(`  STUCK             ${stuck}/${n}   same verdict for both halves - the edit was not noticed at all`);

  writeFileSync(`results/model-comparison/counterfactual-${model}.json`,
    JSON.stringify({ model, pairs: n, passed, sensitivity: passed / n, interval: [lo, hi], stuck, baseOnly, rows }, null, 2), "utf8");
  console.log(`\nWritten to results/model-comparison/counterfactual-${model}.json`);
}
