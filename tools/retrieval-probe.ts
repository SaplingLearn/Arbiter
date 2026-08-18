/**
 * Which pages retrieval hands the model for each checklist item.
 *
 * NO MODEL CALLS. The extraction has two failure modes that look identical from
 * outside - the retriever never surfaced the page, or it did and the model declined to
 * find anything on it - and telling them apart decides whether to change searchTerms or
 * the prompt. This answers the first half for free.
 *
 *   node tools/dump-pages.mjs <pdf> > pages.json     (or any {page,text}[] JSON)
 *   npx tsx tools/retrieval-probe.ts pages.json [C2 C3 ...]
 *
 * With no item ids it probes all twelve. `--expect P` marks whether a named page made
 * the cut, which is the question worth asking when the fact is known to be on page 34
 * and the item comes back not-found.
 */
import { readFileSync } from "node:fs";
import { buildIndex, search } from "../services/api/retrieval.js";
import type { EvidenceChecklist } from "../services/api/inventory.js";

const checklist = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;

const args = process.argv.slice(2);
const pagesFile = args[0];
if (pagesFile === undefined) {
  console.error("usage: npx tsx tools/retrieval-probe.ts <pages.json> [ITEM ...] [--expect N]");
  process.exit(1);
}
const expectAt = args.indexOf("--expect");
const expect = expectAt === -1 ? null : Number(args[expectAt + 1]);
const wanted = args.slice(1).filter((a) => !a.startsWith("--") && Number.isNaN(Number(a)));

const pages = JSON.parse(readFileSync(pagesFile, "utf8")) as { page: number; text: string }[];
const index = buildIndex([{ documentId: "d", filename: "doc.pdf", pages }]);

for (const item of checklist.items) {
  if (wanted.length > 0 && !wanted.includes(item.id)) continue;
  const query = [item.field, ...(item.searchTerms ?? [])].join(" ");
  const hits = search(index, query, 6);
  const got = hits.map((h) => h.page);
  const mark = expect === null ? "" : got.includes(expect) ? `  <- page ${expect} RETRIEVED` : `  <- page ${expect} MISSED`;
  console.log(`${item.id.padEnd(3)} ${got.join(", ").padEnd(34)}${mark}`);
}
