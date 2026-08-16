import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ADJUDICATOR_PROMPT_PATH, handleAdjudicate, type Adjudication, type AdjudicateRequest, type ConsequenceVerdict } from "./adjudicate.js";
import { completeFromEnv } from "./interpret.js";
import { loadEnv } from "./env.js";

/**
 * Measuring the VERDICT, and measuring it apart from Ask.
 *
 * WHY SEPARATE. `retrieval-eval` asks whether the page reached the model. `ask-eval`
 * asks what the model did with the page. Neither touches the surface that actually
 * decides anything: given the evidence a panel has assembled, what follows from it. One
 * accuracy figure spanning both would hide which half failed, and they fail for
 * unrelated reasons - Ask fails on retrieval, the verdict fails on reasoning.
 *
 * WHERE THE LABELS COME FROM, and why I am not the oracle. Every case's answer follows
 * from the RULESET applied to its findings, and the reason is recorded on the case so a
 * reader can disagree with the label rather than take it on trust. No case asks the
 * model to be a toxicologist about a real drug: the three `cannot_conclude` cases are
 * true by construction (no consequence-half evidence at all, no established exposure
 * margin, or a tie R1 cannot break), and the committed cases turn on one rule each.
 *
 * DILIrank COULD NOT SERVE. It was the obvious external ground truth and it does not fit
 * this document set: seven of the fifteen drugs are post-2016 approvals absent from it,
 * six more are labelled `Ambiguous-DILI-concern`, and the two with definite labels are
 * tolcapone and troglitazone - whose documents the upload gate refuses. Usable labelled
 * positives: zero. Recorded here because "why not just use DILIrank" is the first
 * question this file should answer.
 *
 * WHAT IS REPORTED, and why not one number. Accuracy over three classes hides the only
 * asymmetry that matters. Committing to `advance` or `do_not_advance` when the evidence
 * supports neither is the dangerous error - it is a confident answer with nothing under
 * it. Abstaining when the evidence would have supported a call is a cost, not a hazard.
 * So per-class recall is reported separately, and OVERCOMMITMENT gets its own line.
 */

interface VerdictCase {
  id: string;
  expect: ConsequenceVerdict;
  why: string;
  compoundLabel: string;
  context: string;
  findings: AdjudicateRequest["findings"];
  absent: { field: string; whatItBlocks: string }[];
  /** The inventory. See `_presentField` in the fixture for why omitting it made every
   *  case abstain, correctly, and made the harness the thing that was wrong. */
  present: { field: string; half: "mechanism" | "consequence" }[];
}

interface Fixture {
  rules: AdjudicateRequest["rules"];
  cases: VerdictCase[];
}

export interface VerdictRun {
  id: string;
  expect: ConsequenceVerdict;
  got: ConsequenceVerdict | "error";
  correct: boolean;
  citedFindingIds: string[];
  /** Cited ids that are not in the case at all. A hallucinated citation is its own
   *  failure, and a wrong verdict that cites real findings is a different fault from a
   *  right verdict that cites invented ones. */
  hallucinatedCitations: string[];
  reasoning: string;
}

/** Wilson score interval. Third copy in this repo, and the note in ask-eval.ts explains
 *  why: the harness project cannot import this service and this service cannot import
 *  it back. Eight lines beats a build-graph edge. */
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt(p * (1 - p) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}

const CLASSES: ConsequenceVerdict[] = ["do_not_advance", "advance", "cannot_conclude"];

export function scoreRuns(runs: VerdictRun[]): {
  n: number; correct: number; accuracy: number; accuracyInterval: [number, number];
  perClass: Record<string, { n: number; correct: number; recall: number }>;
  confusion: Record<string, Record<string, number>>;
  overcommitted: number; overcommittedIds: string[];
  overAbstained: number; overAbstainedIds: string[];
  hallucinatedCitationCases: string[];
} {
  const correct = runs.filter((r) => r.correct).length;
  const perClass: Record<string, { n: number; correct: number; recall: number }> = {};
  const confusion: Record<string, Record<string, number>> = {};

  for (const cls of CLASSES) {
    const of = runs.filter((r) => r.expect === cls);
    perClass[cls] = {
      n: of.length,
      correct: of.filter((r) => r.correct).length,
      recall: of.length === 0 ? 0 : of.filter((r) => r.correct).length / of.length,
    };
    confusion[cls] = {};
    for (const got of [...CLASSES, "error"]) {
      confusion[cls][got] = of.filter((r) => r.got === got).length;
    }
  }

  // The dangerous direction: the evidence supported no call and one was made anyway.
  const over = runs.filter((r) => r.expect === "cannot_conclude" && r.got !== "cannot_conclude" && r.got !== "error");
  // The costly direction: the evidence supported a call and the model declined it.
  const under = runs.filter((r) => r.expect !== "cannot_conclude" && r.got === "cannot_conclude");

  return {
    n: runs.length,
    correct,
    accuracy: runs.length === 0 ? 0 : correct / runs.length,
    accuracyInterval: wilson(correct, runs.length),
    perClass,
    confusion,
    overcommitted: over.length,
    overcommittedIds: over.map((r) => r.id),
    overAbstained: under.length,
    overAbstainedIds: under.map((r) => r.id),
    hallucinatedCitationCases: runs.filter((r) => r.hallucinatedCitations.length > 0).map((r) => r.id),
  };
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (invokedDirectly) {
  loadEnv();

  const fixture = JSON.parse(readFileSync("data/verdict-eval.json", "utf8")) as Fixture;
  const prompt = JSON.parse(readFileSync(ADJUDICATOR_PROMPT_PATH, "utf8")) as { system: string[]; userTemplate: string[] };
  const complete = completeFromEnv(process.env, "adjudication");
  const model = process.env["ARBITER_ADJUDICATION_MODEL"] ?? process.env["ARBITER_MODEL"] ?? "gemini-3.5-flash";

  if (complete === null) {
    console.error(`No credentials for ${model}. Set ARBITER_GCP_PROJECT (Vertex, via ADC) or ANTHROPIC_API_KEY.`);
    console.error("Refusing to score against the stub: a stub verdict measures the harness, not the model.");
    process.exit(2);
  }

  const repeatsArg = process.argv.find((a) => a.startsWith("--repeats="));
  const repeats = repeatsArg === undefined ? 1 : Math.max(1, Number(repeatsArg.split("=")[1]));

  const runs: VerdictRun[] = [];
  for (const c of fixture.cases) {
    const request: AdjudicateRequest = {
      compoundLabel: c.compoundLabel,
      context: c.context,
      rules: fixture.rules,
      findings: c.findings,
      absent: c.absent,
      present: c.present,
    } as AdjudicateRequest;

    for (let i = 0; i < repeats; i++) {
      const res = await handleAdjudicate(request, complete, prompt);
      if (res.status !== 200) {
        runs.push({ id: c.id, expect: c.expect, got: "error", correct: false,
          citedFindingIds: [], hallucinatedCitations: [], reasoning: JSON.stringify(res.body).slice(0, 200) });
        console.log(`  ${c.id.padEnd(32)} ERROR ${JSON.stringify(res.body).slice(0, 80)}`);
        continue;
      }
      const adj = res.body as Adjudication;
      const got = adj.consequence.verdict;
      const known = new Set(c.findings.map((f) => f.id));
      const cited = adj.consequence.citedFindingIds ?? [];
      const run: VerdictRun = {
        id: c.id, expect: c.expect, got, correct: got === c.expect,
        citedFindingIds: cited,
        hallucinatedCitations: cited.filter((id) => !known.has(id)),
        reasoning: adj.consequence.reasoning,
      };
      runs.push(run);
      console.log(`  ${c.id.padEnd(32)} want ${c.expect.padEnd(16)} got ${got.padEnd(16)} ${run.correct ? "ok" : "XX"}`);
    }
  }

  const s = scoreRuns(runs);
  console.log(`\nverdict - ${model}, ${fixture.cases.length} cases x ${repeats} run(s)`);
  console.log(`  accuracy            ${(s.accuracy * 100).toFixed(1)}%   (95% CI ${(s.accuracyInterval[0] * 100).toFixed(1)}%-${(s.accuracyInterval[1] * 100).toFixed(1)}%)`);
  console.log("\n  by class (recall)");
  for (const cls of CLASSES) {
    const p = s.perClass[cls]!;
    console.log(`    ${cls.padEnd(18)} ${(p.recall * 100).toFixed(1).padStart(5)}%   ${p.correct}/${p.n}`);
  }
  console.log("\n  confusion (want -> got)");
  for (const cls of CLASSES) {
    const row = CLASSES.map((g) => `${g.slice(0, 6)}=${s.confusion[cls]![g]}`).join("  ");
    console.log(`    ${cls.padEnd(18)} ${row}  error=${s.confusion[cls]!["error"]}`);
  }
  console.log(`\n  OVERCOMMITTED       ${s.overcommitted}   committed a call where the evidence supported none${s.overcommittedIds.length ? ` (${s.overcommittedIds.join(", ")})` : ""}`);
  console.log(`  over-abstained      ${s.overAbstained}   declined a call the evidence supported${s.overAbstainedIds.length ? ` (${s.overAbstainedIds.join(", ")})` : ""}`);
  console.log(`  hallucinated cites  ${s.hallucinatedCitationCases.length}${s.hallucinatedCitationCases.length ? ` (${s.hallucinatedCitationCases.join(", ")})` : ""}`);

  writeFileSync("results/verdict-eval.json",
    JSON.stringify({ model, repeats, cases: fixture.cases.length, ...s, runs }, null, 2), "utf8");
  console.log("\nWritten to results/verdict-eval.json");
}
