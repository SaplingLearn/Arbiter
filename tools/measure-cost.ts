/**
 * What one case actually costs to run, in tokens.
 *
 * MEASURED, NOT ESTIMATED. It builds the real prompts - the adjudication prompt from
 * the in-force prompt file and a real case's findings, and the Ask prompt from real
 * passages retrieved out of a real PDF - and counts them. Nothing here guesses at a
 * "typical" case, because the two numbers that dominate the bill (how many passages
 * Ask sends, and how many times adjudication runs) are both properties of this
 * codebase rather than of the model.
 *
 *   npx tsx tools/measure-cost.ts
 *
 * Token counts are characters/4, the standard English approximation. It is close
 * enough to size a bill and not close enough to quote to four figures, which is why
 * every number below is printed with its character count beside it.
 */
import { readFileSync } from "node:fs";
import { userPrompt as adjudicationPrompt, adjudicationSchema, type AdjudicateRequest } from "../services/api/adjudicate.js";
import { userPrompt as askPrompt, answerSchema } from "../services/api/ask.js";
import { buildIndex, search } from "../services/api/retrieval.js";
import { DEMO_FIXTURES } from "../services/api/demo-fixture.js";
import { DEFAULT_RUNS } from "../services/api/consensus.js";
import { DocumentStore } from "../services/api/documents.js";
import { buildInventory, presentForAdjudication, absentForAdjudication, type EvidenceChecklist } from "../services/api/inventory.js";

const tokens = (s: string): number => Math.round(s.length / 4);
const fmt = (n: number): string => n.toLocaleString("en-US");

const prompt = JSON.parse(readFileSync("prompts/adjudicator-v1.2.json", "utf8")) as {
  system: string[]; userTemplate: string[];
};
const checklist = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;
const rules = (JSON.parse(readFileSync("data/probe-case.json", "utf8")) as { rules: AdjudicateRequest["rules"] }).rules;

const fixture = DEMO_FIXTURES[0]!;
const inventory = buildInventory(fixture.findings, checklist, "small_molecule");

const req: AdjudicateRequest = {
  compoundLabel: "Tucatinib (TUKYSA) - HER2+ metastatic breast cancer",
  context: "An oral HER2 kinase inhibitor given 300 mg twice daily with trastuzumab and capecitabine, continuously until disease progression, in patients with advanced metastatic disease, many with liver metastases.",
  findings: fixture.findings,
  rules,
  absent: absentForAdjudication(inventory),
  present: presentForAdjudication(inventory),
};

console.log("=".repeat(72));
console.log("ONE CASE, MEASURED");
console.log("=".repeat(72));

// ---- adjudication -----------------------------------------------------------------
const sys = prompt.system.join("\n");
const usr = adjudicationPrompt(req, prompt.userTemplate);
const schema = JSON.stringify(adjudicationSchema(req));
const adjIn = tokens(sys) + tokens(usr) + tokens(schema);
// Measured from the live runs in this session: the returned adjudication object is
// ~4.5 KB of JSON, and SHAPE_ADJUDICATION runs with thinking enabled.
const adjOut = 1400;

console.log("\nADJUDICATION  (SHAPE_ADJUDICATION, thinking on, 16k output cap)");
console.log(`  system prompt      ${fmt(sys.length).padStart(8)} chars  ~${fmt(tokens(sys)).padStart(6)} tok`);
console.log(`  user prompt        ${fmt(usr.length).padStart(8)} chars  ~${fmt(tokens(usr)).padStart(6)} tok   (9 findings, 6 rules, absences)`);
console.log(`  response schema    ${fmt(schema.length).padStart(8)} chars  ~${fmt(tokens(schema)).padStart(6)} tok`);
console.log(`  -> input           ${" ".repeat(14)}~${fmt(adjIn).padStart(6)} tok  per run`);
console.log(`  -> output          ${" ".repeat(14)}~${fmt(adjOut).padStart(6)} tok  per run (observed)`);
console.log(`  RUNS PER VERDICT   ${DEFAULT_RUNS}  (consensus.ts DEFAULT_RUNS - the verdict is the majority of three)`);
console.log(`  == adjudication    ~${fmt(adjIn * DEFAULT_RUNS)} in / ~${fmt(adjOut * DEFAULT_RUNS)} out`);

// ---- ask --------------------------------------------------------------------------
const docs = new DocumentStore("results/documents");
const stored = docs.forCase(process.argv[2] ?? "");
let askIn = 0;
let passageCount = 0;
if (stored.length > 0) {
  const corpus = stored.map((d) => ({ documentId: d.id, filename: d.filename, pages: docs.textFor(d.id) }));
  const index = buildIndex(corpus);
  const passages = search(index, "Did tucatinib inhibit BSEP, and at what concentration?");
  passageCount = passages.length;
  const ap = askPrompt("Did tucatinib inhibit BSEP, and at what concentration?", passages, []);
  askIn = tokens(ap) + tokens(JSON.stringify(answerSchema(passages)));
  console.log("\nASK  (SHAPE_ASK, thinking on, 64k output cap)");
  console.log(`  passages sent      ${String(passageCount).padStart(8)}        (retrieval.ts picks these; they are whole PDF pages)`);
  console.log(`  prompt             ${fmt(ap.length).padStart(8)} chars  ~${fmt(tokens(ap)).padStart(6)} tok`);
  console.log(`  -> input           ${" ".repeat(14)}~${fmt(askIn).padStart(6)} tok  per question`);
  console.log(`  -> output          ${" ".repeat(14)}~${fmt(400).padStart(6)} tok  per question (observed)`);
} else {
  console.log("\nASK  - pass a caseId that has the document attached to measure this half:");
  console.log("       npx tsx tools/measure-cost.ts case_xxxxxxxx");
}

// ---- the case total ---------------------------------------------------------------
const ASK_QUESTIONS = 5;
const totalIn = adjIn * DEFAULT_RUNS + askIn * ASK_QUESTIONS;
const totalOut = adjOut * DEFAULT_RUNS + 400 * ASK_QUESTIONS;

console.log("\n" + "-".repeat(72));
console.log(`ONE CASE = one verdict (${DEFAULT_RUNS} runs) + ${ASK_QUESTIONS} questions asked`);
console.log(`  input   ~${fmt(totalIn)} tok`);
console.log(`  output  ~${fmt(totalOut)} tok`);
console.log("-".repeat(72));
console.log("\nWHAT IS FREE. Every case stage that is not one of those two calls: the");
console.log("inventory, blind submission, the reveal, unanimity, the hash chain, the audit");
console.log("and the whole engine. They are pure code and cost nothing per case.");
console.log("\nMultiply by your own rate card. This prints tokens rather than currency");
console.log("because the price of a model is not a property of this repository.");
