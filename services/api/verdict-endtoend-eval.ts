import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ADJUDICATOR_PROMPT_PATH, type Adjudication, type AdjudicateRequest } from "./adjudicate.js";
import { adjudicateConsensus, runsFrom } from "./consensus.js";
import { proposeFindings } from "./extract.js";
import {
  absentForAdjudication, buildInventory, presentForAdjudication,
  type EvidenceChecklist, type Modality,
} from "./inventory.js";
import { completeFromEnv } from "./interpret.js";
import { loadEnv } from "./env.js";
import { wilson } from "./verdict-eval.js";

/**
 * The verdict, end to end, from the document alone.
 *
 * WHAT EVERY OTHER VERDICT EVALUATION IN THIS REPO LEAVES OUT. `verdict-five-eval`
 * hands the adjudicator findings somebody constructed. `verdict-real-eval` hands it
 * findings a script pulled out of the review. Both then hand it the ABSENT list as
 * well - `absent` is a caller-supplied field in AdjudicateRequest, because in the
 * product a human curator records what was searched for and not found. So the gaps
 * were always supplied, never detected, and gap recall was measuring retention rather
 * than discovery. It could not fail, and it did not.
 *
 * This harness removes both supports. The model gets the extracted document and
 * nothing else:
 *
 *   1 `proposeFindings` walks the 12-item evidence checklist and searches the document
 *     for each one. Every proposal must carry a verbatim quote and a page or extract.ts
 *     discards it, so nothing enters that a reader cannot check against the source.
 *
 *   2 The items it finds nothing for come back in `notFound`. THOSE ARE THE GAPS, and
 *     the model determined them by reading. Nobody told it what was missing.
 *
 *   3 `buildInventory` turns the proposals into present/absent state, and the
 *     adjudicator is given exactly that - the model's own view of what the document
 *     does and does not contain.
 *
 *   4 The verdict is then compared against what the FDA actually concluded, taken from
 *     the label: a boxed warning or a Warnings-and-Precautions hepatotoxicity action
 *     counts as a positive.
 *
 * SO THE ONLY HUMAN INPUT IS THE ANSWER KEY, and that is checked against the published
 * label rather than authored. Everything between the PDF and the verdict is the product.
 *
 * WHAT THIS CAN AND CANNOT SHOW. Section 8 of HANDOFF-evaluation.md argues the target is
 * a proxy: a nonclinical package is not obliged to predict what a regulator concluded
 * after clinical data, and ponatinib is the worked example - its transaminase rises had
 * no microscopic correlate and reversed, so there is nothing in its nonclinical evidence
 * to catch. That objection applies here too and is not answered by better extraction.
 * What changes is that the pipeline being measured is now the whole product rather than
 * its last step, so a failure can be attributed: to extraction, to the inventory, or to
 * the adjudicator.
 *
 * SPECIFICITY IS THE NUMBER THIS CAN CARRY. How often the product invents a
 * hepatotoxicity concern the regulator never found is a real question with a real
 * denominator. Sensitivity is reported beside it and must be read with the proxy
 * objection attached.
 *
 * Run:  npx tsx services/api/verdict-endtoend-eval.ts [--limit=N]
 */

interface RealCase {
  id: string;
  drug: string;
  expectFlag: boolean;
  labelEvidence: string;
  outcomeTier: string;
}

/** A biologic has no QSAR and no reactive-metabolite question; saying so keeps
 *  `not_applicable` out of the absent list, which is what that state is for. */
const BIOLOGIC = new Set(["nipocalimab"]);

const CACHE = "results/library";

const invokedDirectly = process.argv[1] !== undefined
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (invokedDirectly) {
  loadEnv();

  const fixture = JSON.parse(readFileSync("data/verdict-real.json", "utf8")) as
    { rules: AdjudicateRequest["rules"]; cases: RealCase[] };
  const checklist = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;
  const prompt = JSON.parse(readFileSync(ADJUDICATOR_PROMPT_PATH, "utf8")) as { system: string[]; userTemplate: string[] };

  const complete = completeFromEnv(process.env, "adjudication");
  const model = process.env["ARBITER_ADJUDICATION_MODEL"] ?? process.env["ARBITER_MODEL"] ?? "gemini-3.5-flash";
  if (complete === null) {
    console.error(`No credentials for ${model}. Set ARBITER_GCP_PROJECT (Vertex, via ADC).`);
    process.exit(2);
  }
  const runs = runsFrom(process.env);

  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg === undefined ? Infinity : Number(limitArg.split("=")[1]);

  /**
   * `foundItems` and `missingItems` carry the CHECKLIST IDS, not just counts.
   *
   * Counts said extraction was thin and nothing more, which is not actionable: "4 of 12"
   * does not say whether the four were mechanism or consequence, and the adjudicator's
   * behaviour turns entirely on that. `consequenceBasis` can only be populated from
   * CONSEQUENCE-half items, and the prompt requires `cannot_conclude` when it is empty -
   * so six mechanism findings and no consequence ones produce an abstention that looks
   * like caution and is really a retrieval result.
   */
  type Row = {
    id: string; expectFlag: boolean; outcomeTier: string;
    proposed: number; detectedGaps: number; discarded: number;
    foundItems: string[]; missingItems: string[];
    verdict: string; flagged: boolean; correct: boolean; error?: string;
  };
  const rows: Row[] = [];
  let done = 0;

  for (const c of fixture.cases) {
    if (done >= limit) break;
    const path = `${CACHE}/${c.id}.pages.json`;
    if (!existsSync(path)) {
      console.log(`  ${c.id.padEnd(15)} SKIP - no extraction cache in this checkout`);
      continue;
    }
    done++;

    const pages = JSON.parse(readFileSync(path, "utf8")) as { page: number; text: string }[];
    const modality: Modality = BIOLOGIC.has(c.id) ? "biologic" : "small_molecule";

    let row: Row;
    try {
      // 1-2. The model reads the document, proposes findings, and reports what it
      // could not find. Nothing about this case is supplied.
      const result = await proposeFindings(
        [{ documentId: c.id, filename: c.id, pages }], checklist, modality, complete,
      );

      // 3. Its own proposals become the inventory, so present and absent are the
      // model's view rather than a curator's.
      const findings = result.proposals.map((p, i) => ({
        id: `${c.id}:p${i}`,
        label: `${p.field} (p${p.page})`,
        // NEVER pre-labelled, for the same reason the curated fixtures are not:
        // asserting `toxic` here would encode a conclusion in the input and score the
        // adjudicator for reading extraction's opinion back.
        assertion: "ambiguous" as const,
        detail: `Proposed by extraction from ${c.id} p${p.page}: "${p.quote}"`,
      }));

      const inv = buildInventory(
        result.proposals.map((p, i) => ({ ...findings[i]!, covers: [p.itemId] })),
        checklist, modality,
      );

      const req = {
        compoundLabel: c.drug, rules: fixture.rules, findings,
        context: "Nonclinical package. Findings and gaps were proposed by extraction from the document, not curated.",
        absent: absentForAdjudication(inv),
        present: presentForAdjudication(inv),
      } as AdjudicateRequest;

      // 4. The product's own consensus path.
      const { response } = await adjudicateConsensus(req, complete, prompt, runs);
      const foundItems = [...new Set(result.proposals.map((p) => p.itemId))].sort();
      const missingItems = [...new Set(result.notFound.map((n) => n.itemId))].sort();

      if (response.status !== 200) {
        row = {
          id: c.id, expectFlag: c.expectFlag, outcomeTier: c.outcomeTier,
          proposed: result.proposals.length, detectedGaps: result.notFound.length,
          discarded: result.discarded.length, foundItems, missingItems,
          verdict: "error", flagged: false, correct: false,
          error: JSON.stringify((response.body as { error?: string }).error ?? "unverified"),
        };
      } else {
        const adj = response.body as Adjudication;
        const verdict = adj.consequence.verdict;
        const flagged = verdict === "do_not_advance";
        row = {
          id: c.id, expectFlag: c.expectFlag, outcomeTier: c.outcomeTier,
          proposed: result.proposals.length, detectedGaps: result.notFound.length,
          discarded: result.discarded.length, foundItems, missingItems,
          verdict, flagged, correct: flagged === c.expectFlag,
        };
      }
    } catch (e) {
      row = {
        id: c.id, expectFlag: c.expectFlag, outcomeTier: c.outcomeTier,
        proposed: 0, detectedGaps: 0, discarded: 0, foundItems: [], missingItems: [],
        verdict: "error", flagged: false, correct: false,
        error: e instanceof Error ? e.message.slice(0, 120) : String(e),
      };
    }

    rows.push(row);
    console.log(
      `  ${row.id.padEnd(15)} label=${(row.expectFlag ? "HEPATOTOX" : "clean").padEnd(9)} ` +
      `proposed=${String(row.proposed).padStart(2)} gaps=${String(row.detectedGaps).padStart(2)} ` +
      `verdict=${row.verdict.padEnd(15)} ${row.correct ? "ok" : "XX"}${row.error ? `  ${row.error}` : ""}`,
    );
    // The consequence half is what decides whether an abstention was reasoning or
    // retrieval, so print it rather than leaving it in the JSON.
    const cons = (ids: string[]): string => ids.filter((i) => i.startsWith("C")).join(",") || "-";
    console.log(`                  consequence found [${cons(row.foundItems)}] missing [${cons(row.missingItems)}]`);
  }

  const scored = rows.filter((r) => r.verdict !== "error");
  const pos = scored.filter((r) => r.expectFlag);
  const neg = scored.filter((r) => !r.expectFlag);
  const sens = pos.filter((r) => r.flagged).length;
  const spec = neg.filter((r) => !r.flagged).length;
  const pct = (k: number, n: number): string => {
    if (n === 0) return "n/a";
    const [lo, hi] = wilson(k, n);
    return `${(k / n * 100).toFixed(1)}%  (95% CI ${(lo * 100).toFixed(1)}%-${(hi * 100).toFixed(1)}%)`;
  };

  const meanProposed = scored.reduce((n, r) => n + r.proposed, 0) / Math.max(scored.length, 1);
  const meanGaps = scored.reduce((n, r) => n + r.detectedGaps, 0) / Math.max(scored.length, 1);

  console.log(`\nend-to-end from the document - ${model}, ${scored.length} drugs scored, consensus of ${runs}`);
  console.log(`  extraction        ${meanProposed.toFixed(1)} findings and ${meanGaps.toFixed(1)} detected gaps per drug, on a 12-item checklist`);
  console.log(`  SENSITIVITY       ${sens}/${pos.length}   ${pct(sens, pos.length)}`);
  console.log(`                    flagged the drugs whose label carries a hepatotoxicity action`);
  console.log(`  SPECIFICITY       ${spec}/${neg.length}   ${pct(spec, neg.length)}`);
  console.log(`                    did not invent a concern the regulator never found`);
  if (rows.length !== scored.length) {
    console.log(`  errors            ${rows.length - scored.length} drug(s) did not produce a verifiable adjudication`);
  }
  console.log(`\n  Nothing here was curated: the findings and the gaps are the model's own reading of`);
  console.log(`  the document. The only human input is the answer key, taken from the published label.`);
  console.log(`  Sensitivity carries the proxy objection in HANDOFF-evaluation.md section 8 - a`);
  console.log(`  nonclinical package is not obliged to predict a clinical labelling outcome.`);

  writeFileSync(`results/model-comparison/verdict-endtoend-${model}.json`,
    JSON.stringify({
      model, runs, scored: scored.length,
      sensitivity: { k: sens, n: pos.length },
      specificity: { k: spec, n: neg.length },
      extraction: { meanProposed, meanGaps, checklistItems: checklist.items.length },
      rows,
    }, null, 2), "utf8");
  console.log(`\nWritten to results/model-comparison/verdict-endtoend-${model}.json`);
}
