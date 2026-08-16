import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ADJUDICATOR_PROMPT_PATH, type Adjudication, type AdjudicateRequest } from "./adjudicate.js";
import { adjudicateConsensus, runsFrom } from "./consensus.js";
import { completeFromEnv, type Complete } from "./interpret.js";
import { loadEnv } from "./env.js";
import { wilson } from "./verdict-eval.js";

/**
 * The five things the adjudicator can actually get wrong.
 *
 * Derived from the output contract rather than from the pitch. Most of what could go
 * wrong already cannot: the schema is built FROM THE REQUEST, so `citedFindingIds` can
 * only name findings that were sent, `ruleId` only registered rules, `missing` only
 * genuinely-absent fields, and `consequenceBasis` only present consequence-half
 * dimensions. `AdjudicateRequest` carries no positions at all, so the team's arguments
 * cannot reach the adjudicator even in principle.
 *
 * What is left unguarded is what this measures.
 *
 *   1 VERDICT        the three-class call. Nothing constrains it.
 *
 *   2 PROSE DISCIPLINE  the failure this codebase records as having actually happened:
 *     the model justified `do_not_advance` with "single-cell necrosis is a severe,
 *     IRREVERSIBLE form of cellular injury" while the inventory recorded Reversibility
 *     as ABSENT. The enum stops the VERDICT resting on an unmeasured dimension; it does
 *     not stop the paragraph asserting one, and the paragraph is the part a human reads.
 *     adjudicate.ts: "Every deterministic check passed, because they check ids and this
 *     was an adjective."
 *
 *   3 RULE DISCLOSURE  `position` is free text from an enum of three. Saying `applies`
 *     about a rule that should have been set aside, or `does_not_apply` about the rule
 *     that decides, is how conflict resolution goes wrong while looking right.
 *
 *   4 GAP RECALL     `missing` cannot name a field that is present, but nothing forces
 *     it to name every field that is absent. Silence is the failure mode.
 *
 *   5 STABILITY      same evidence, same position. Measured at 3:3 on turalio before
 *     consensus; this runs through `adjudicateConsensus`, which is now the product path.
 *
 * SCORED PER CASE, NOT POOLED. Averaging five different things into one number is how a
 * weak metric hides behind a strong one.
 */

interface Case {
  id: string; why: string;
  expectVerdict: string;
  decidingRule: { ruleId: string; position: string } | null;
  mustNotRestOn: string[];
  expectMissing: string[];
  expectExperiment: boolean;
  compoundLabel: string; context: string;
  findings: AdjudicateRequest["findings"];
  present: { field: string; half: "mechanism" | "consequence" }[];
  absent: { field: string; whatItBlocks: string }[];
}

/**
 * Does the paragraph ASSERT a property of a dimension nobody measured?
 *
 * A KEYWORD SCREEN WAS TRIED FIRST AND WAS WRONG, which is worth recording because it
 * was wrong in the direction that flatters nothing and misleads badly. It flagged three
 * of eight cases and every one was a false positive: "Although reversibility was not
 * assessed...", "Without the projected human daily dose and exposure margin, we cannot
 * scale the findings", "leaving the injury pattern ... unassessed". Those are the model
 * NAMING THE ABSENCE, which is exactly what the prompt requires of it. A regex cannot
 * separate "reversibility was not assessed" from "the injury is irreversible", because
 * the difference is negation and scope rather than vocabulary - and reporting 62.5% on
 * that basis would have condemned the model for doing its job.
 *
 * So the check is a judge, asked one narrow question per absent dimension. Narrow enough
 * that a human can verify the whole thing by reading eight paragraphs, which is the only
 * reason an LLM grading an LLM is admissible here.
 *
 * SELF-GRADING IS THE STANDING CAVEAT. The same model family judges its own output. The
 * question is nearly mechanical - does this sentence assert a property, or note that it
 * was not measured - but the number should carry the caveat wherever it is quoted.
 */
const JUDGE_SYSTEM = [
  "You check one paragraph for one specific overreach.",
  "You are told a DIMENSION that was never measured in the study package.",
  "Decide what the paragraph does with that dimension:",
  "  asserts        - it states or implies a property of the dimension as fact. Example, for reversibility: 'the injury is irreversible', 'the damage persists'.",
  "  notes_absence  - it says the dimension was not measured, not assessed, is unknown, or is missing. This is CORRECT behaviour, not an overreach.",
  "  silent         - the paragraph does not mention the dimension at all.",
  "A hypothetical or a conditional is not an assertion. 'to determine if the injury is irreversible' is notes_absence or silent, never asserts.",
].join("\n");

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["call"],
  properties: { call: { type: "string", enum: ["asserts", "notes_absence", "silent"] } },
};

async function proseViolations(
  reasoning: string, absentFields: string[], judge: Complete,
): Promise<string[]> {
  const bad: string[] = [];
  for (const field of absentFields) {
    const user = `DIMENSION NEVER MEASURED: ${field}

PARAGRAPH:
${reasoning}`;
    try {
      const r = await judge(JUDGE_SYSTEM, user, JUDGE_SCHEMA) as { call?: string };
      if (r.call === "asserts") bad.push(field);
    } catch {
      // A judge that could not run is not evidence of an overreach.
    }
  }
  return bad;
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (invokedDirectly) {
  loadEnv();
  const fx = JSON.parse(readFileSync("data/verdict-five.json", "utf8")) as
    { rules: AdjudicateRequest["rules"]; cases: Case[] };
  const prompt = JSON.parse(readFileSync(ADJUDICATOR_PROMPT_PATH, "utf8")) as { system: string[]; userTemplate: string[] };
  const complete = completeFromEnv(process.env, "adjudication");
  const model = process.env["ARBITER_ADJUDICATION_MODEL"] ?? process.env["ARBITER_MODEL"] ?? "gemini-3.5-flash";
  if (complete === null) { console.error(`No credentials for ${model}.`); process.exit(2); }
  const runs = runsFrom(process.env);

  /**
   * `tests*` records whether the CASE could fail the metric at all.
   *
   * Three of the five pass vacuously when the fixture has nothing for them to check:
   * `prose` compares the reasoning against `absent` fields, so a case with no absent
   * fields cannot over-claim one; `gaps` subtracts the named gaps from `expectMissing`,
   * so an empty `expectMissing` is satisfied by naming nothing; and `rule` short-circuits
   * to true when `decidingRule` is null. Counting those as passes inflates both the rate
   * and, worse, the DENOMINATOR - 8/8 claims a sample of eight where four cases were
   * silent. Scoring over the cases that actually exercise a metric is the difference
   * between "100% of 8" and "100% of 4", and those carry Wilson lower bounds of 68% and
   * 51%.
   */
  type Row = {
    id: string; verdict: boolean; prose: boolean; rule: boolean; gaps: boolean; stable: boolean;
    testsProse: boolean; testsRule: boolean; testsGaps: boolean;
    got: string; want: string; violations: string[]; missedGaps: string[]; ruleGot: string | null;
    agreement: number;
  };
  const rows: Row[] = [];

  for (const c of fx.cases) {
    const req = {
      compoundLabel: c.compoundLabel, context: c.context, rules: fx.rules,
      findings: c.findings, absent: c.absent, present: c.present,
    } as AdjudicateRequest;

    const { response, consensus } = await adjudicateConsensus(req, complete, prompt, runs);
    if (response.status !== 200) {
      rows.push({ id: c.id, verdict: false, prose: false, rule: false, gaps: false, stable: false,
        testsProse: c.absent.length > 0, testsRule: c.decidingRule !== null,
        testsGaps: c.expectMissing.length > 0,
        got: "error", want: c.expectVerdict, violations: [], missedGaps: [], ruleGot: null, agreement: 0 });
      console.log(`  ${c.id.padEnd(30)} ERROR`);
      continue;
    }
    const adj = response.body as Adjudication;

    const got = adj.consequence.verdict;
    const verdict = got === c.expectVerdict;

    const absentFields = c.absent.map((a) => a.field);
    const violations = await proseViolations(adj.consequence.reasoning, absentFields, complete);
    const prose = violations.length === 0;

    const disc = c.decidingRule === null
      ? null
      : adj.ruleDisclosure.find((d) => d.ruleId === c.decidingRule!.ruleId) ?? null;
    const ruleGot = disc?.position ?? null;
    const rule = c.decidingRule === null ? true : ruleGot === c.decidingRule.position;

    const named = new Set(adj.missing.map((m) => m.field));
    const missedGaps = c.expectMissing.filter((f) => !named.has(f));
    const gaps = missedGaps.length === 0;

    const stable = consensus !== null && !consensus.split;

    rows.push({ id: c.id, verdict, prose, rule, gaps, stable,
      testsProse: absentFields.length > 0, testsRule: c.decidingRule !== null,
      testsGaps: c.expectMissing.length > 0,
      got, want: c.expectVerdict,
      violations, missedGaps, ruleGot, agreement: consensus?.agreement ?? 0 });

    const mark = (b: boolean): string => (b ? "ok" : "XX");
    console.log(`  ${c.id.padEnd(30)} verdict ${mark(verdict)}  prose ${mark(prose)}  rule ${mark(rule)}  gaps ${mark(gaps)}  stable ${mark(stable)}   ${got}`);
    if (violations.length) console.log(`      PROSE claimed an unmeasured dimension: ${violations.join("; ")}`);
    if (missedGaps.length) console.log(`      GAPS not named: ${missedGaps.join("; ")}`);
    if (c.decidingRule && !rule) console.log(`      RULE ${c.decidingRule.ruleId}: wanted ${c.decidingRule.position}, got ${ruleGot ?? "not disclosed"}`);
  }

  const n = rows.length;
  /** Score over the cases that can actually fail the metric. See the Row docstring. */
  const pctOf = (k: number, d: number): string => {
    if (d === 0) return "     -   no case exercises this metric";
    const [lo, hi] = wilson(k, d);
    return `${(k / d * 100).toFixed(1).padStart(6)}%  ${String(`${k}/${d}`).padStart(6)}  [${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}]`;
  };
  const pct = (k: number): string => pctOf(k, n);

  const proseCases = rows.filter((r) => r.testsProse);
  const ruleCases = rows.filter((r) => r.testsRule);
  const gapsCases = rows.filter((r) => r.testsGaps);

  const score = {
    verdict: rows.filter((r) => r.verdict).length,
    prose: proseCases.filter((r) => r.prose).length,
    rule: ruleCases.filter((r) => r.rule).length,
    gaps: gapsCases.filter((r) => r.gaps).length,
    stable: rows.filter((r) => r.stable).length,
  };
  const tested = { prose: proseCases.length, rule: ruleCases.length, gaps: gapsCases.length };

  console.log(`\nadjudicator - ${model}, ${n} cases, consensus of ${runs}`);
  console.log(`  1 verdict is right          ${pct(score.verdict)}`);
  console.log(`  2 prose stays in evidence   ${pctOf(score.prose, tested.prose)}`);
  console.log(`  3 names the deciding rule   ${pctOf(score.rule, tested.rule)}`);
  console.log(`  4 names every gap           ${pctOf(score.gaps, tested.gaps)}`);
  console.log(`  5 runs agreed (unanimous)   ${pct(score.stable)}`);
  console.log(`\n  Metrics 2, 3 and 4 are scored over the cases that can FAIL them, not all ${n}:`);
  console.log(`    prose  ${n - tested.prose} case(s) have no absent field to over-claim`);
  console.log(`    rule   ${n - tested.rule} case(s) have no deciding rule keyed, which short-circuits to pass`);
  console.log(`    gaps   ${n - tested.gaps} case(s) have an empty expectMissing, so naming nothing satisfies it`);
  console.log(`  Counting those would inflate the denominator, which is the more misleading half.`);

  writeFileSync(`results/model-comparison/verdict-five-${model}.json`,
    JSON.stringify({ model, cases: n, runs, score, tested, rows }, null, 2), "utf8");
  console.log(`\nWritten to results/model-comparison/verdict-five-${model}.json`);
}
