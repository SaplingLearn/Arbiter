import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ADJUDICATOR_PROMPT_PATH, handleAdjudicate, type Adjudication, type AdjudicateRequest } from "./adjudicate.js";
import { completeFromEnv } from "./interpret.js";
import { loadEnv } from "./env.js";
import { wilson } from "./verdict-eval.js";

/**
 * The verdict against REAL regulatory outcomes.
 *
 * `verdict-eval.ts` uses constructed cases to isolate one rule each, so the label is
 * knowable by construction. This asks the opposite question over packages nobody
 * designed for a test: given a real drug's real nonclinical evidence, does the
 * adjudicator flag hepatotoxicity where the label ultimately carried a boxed warning,
 * and stay quiet where it did not?
 *
 * ONE POSITIVE, AND THE IMBALANCE IS STRUCTURAL. Thirteen of the fourteen drugs have no
 * hepatotoxicity boxed warning, because these are APPROVAL packages - every drug in them
 * cleared the bar. That is survivorship bias by construction, not bad sampling, and it
 * means a classifier that always says `advance` scores 13/14 here. So this file NEVER
 * reports a single accuracy figure:
 *
 *   SENSITIVITY is n=1. It is reported as "did it catch turalio", a single observation,
 *   and calling it a rate would be dishonest at that n.
 *
 *   SPECIFICITY is n=13 and is a real number - how often the adjudicator invents a
 *   hepatotoxicity concern that the regulator did not find. That is the failure mode
 *   this corpus can genuinely measure, and it is the one that would make the product
 *   useless in practice: a reviewer who is warned about everything is warned about
 *   nothing.
 *
 * The drugs with genuine negative outcomes - troglitazone, withdrawn for
 * hepatotoxicity, and tolcapone, restricted - would fix the imbalance and cannot: the
 * upload gate refuses both documents, one scanned and one a labelling supplement.
 */

interface RealCase {
  id: string;
  drug: string;
  expectFlag: boolean;
  labelEvidence: string;
  compoundLabel: string;
  context: string;
  findings: AdjudicateRequest["findings"];
  absent: { field: string; whatItBlocks: string }[];
  present: { field: string; half: "mechanism" | "consequence" }[];
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (invokedDirectly) {
  loadEnv();
  const fixture = JSON.parse(readFileSync("data/verdict-real.json", "utf8")) as
    { rules: AdjudicateRequest["rules"]; cases: RealCase[] };
  const prompt = JSON.parse(readFileSync(ADJUDICATOR_PROMPT_PATH, "utf8")) as { system: string[]; userTemplate: string[] };
  const complete = completeFromEnv(process.env, "adjudication");
  const model = process.env["ARBITER_ADJUDICATION_MODEL"] ?? process.env["ARBITER_MODEL"] ?? "gemini-3.5-flash";
  if (complete === null) { console.error(`No credentials for ${model}.`); process.exit(2); }

  const runs: { drug: string; expectFlag: boolean; verdict: string; flagged: boolean; correct: boolean; reasoning: string }[] = [];
  for (const c of fixture.cases) {
    const request = {
      compoundLabel: c.compoundLabel, context: c.context, rules: fixture.rules,
      findings: c.findings, absent: c.absent, present: c.present,
    } as AdjudicateRequest;
    const res = await handleAdjudicate(request, complete, prompt);
    if (res.status !== 200) {
      console.log(`  ${c.drug.padEnd(14)} ERROR ${JSON.stringify(res.body).slice(0, 70)}`);
      runs.push({ drug: c.drug, expectFlag: c.expectFlag, verdict: "error", flagged: false, correct: false, reasoning: "" });
      continue;
    }
    const adj = res.body as Adjudication;
    const verdict = adj.consequence.verdict;
    // "Flagged" is do_not_advance only. `cannot_conclude` is not a hepatotoxicity claim -
    // it is a statement about the package, and counting it as a flag would score caution
    // as a false positive.
    const flagged = verdict === "do_not_advance";
    runs.push({ drug: c.drug, expectFlag: c.expectFlag, verdict, flagged,
      correct: flagged === c.expectFlag, reasoning: adj.consequence.reasoning });
    console.log(`  ${c.drug.padEnd(14)} label=${c.expectFlag ? "HEPATOTOX" : "clean    "}  verdict=${verdict.padEnd(16)} ${flagged === c.expectFlag ? "ok" : "XX"}`);
  }

  /* ERRORS ARE EXCLUDED, not counted as quiet. A first version scored them as correct
     negatives and reported 100.0% specificity on a run where all fourteen cases failed
     with bad_request - a perfect score for a harness that never reached the model. An
     error is an absence of measurement, not evidence of restraint. */
  const scored = runs.filter((r) => r.verdict !== "error");
  const errored = runs.length - scored.length;
  if (errored > 0) console.log(`
  ${errored} case(s) errored and are EXCLUDED from the rates below.`);
  const pos = scored.filter((r) => r.expectFlag);
  const neg = scored.filter((r) => !r.expectFlag);
  const caught = pos.filter((r) => r.flagged).length;
  const quiet = neg.filter((r) => !r.flagged).length;
  const [slo, shi] = wilson(quiet, neg.length);
  const pct = (a: number, b: number): string => (b === 0 ? "n/a" : `${(a / b * 100).toFixed(1)}%`);

  console.log(`\nverdict vs real outcome - ${model}, ${fixture.cases.length} drugs`);
  console.log(`  SENSITIVITY   ${caught}/${pos.length}   caught the drug whose label carries a hepatotoxicity boxed warning`);
  console.log(`                      (n=1 - a single observation, deliberately not reported as a rate)`);
  console.log(`  SPECIFICITY   ${quiet}/${neg.length}   = ${pct(quiet, neg.length)}   (95% CI ${(slo * 100).toFixed(1)}%-${(shi * 100).toFixed(1)}%)`);
  console.log(`                      did not invent a concern the regulator never found`);
  const wrong = neg.filter((r) => r.flagged).map((r) => r.drug);
  if (wrong.length) console.log(`  false flags   ${wrong.join(", ")}`);
  const dist: Record<string, number> = {};
  for (const r of runs) dist[r.verdict] = (dist[r.verdict] ?? 0) + 1;
  console.log(`  verdicts      ${Object.entries(dist).map(([k, v]) => `${k}=${v}`).join("  ")}`);

  writeFileSync(`results/model-comparison/verdict-real-${model}.json`,
    JSON.stringify({ model, drugs: fixture.cases.length, caught, positives: pos.length,
      quiet, negatives: neg.length, errored, specificity: neg.length ? quiet / neg.length : null,
      specificityInterval: [slo, shi], falseFlags: wrong, runs }, null, 2), "utf8");
  console.log(`\nWritten to results/model-comparison/verdict-real-${model}.json`);
}
