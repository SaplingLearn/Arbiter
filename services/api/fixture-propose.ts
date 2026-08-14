import { readFileSync, writeFileSync } from "node:fs";
import { LibraryStore } from "./library.js";

/**
 * Proposes fixture items for `data/retrieval-eval.json`, and PROPOSES is the whole
 * word.
 *
 * It writes a candidate question, the pages a regular expression found, and the
 * verbatim quote from each of those pages. A person then reads the quotes and throws
 * out what the pattern got wrong - which on the first run was six of forty-one:
 * "liver to plasma ratios were 5.30" is tissue distribution rather than a finding,
 * "Liver 3.85 3.53 5.18" is a table, "A reverse reaction then catalyzes" is KRAS
 * pharmacology rather than recovery, and "Reversible Posterior Leukoencephalopathy
 * Syndrome" is the name of an adverse event.
 *
 * Keeping it in the repository is the point: a fixture whose provenance is "somebody
 * wrote it" cannot be audited, and every number in the evaluation rests on it. Run it,
 * read the proposals, keep what is right.
 *
 * It never overwrites the fixture - it writes candidates to stdout and to
 * `results/proposed-items.json` for a human to merge.
 */
const lib = new LibraryStore();
const flat = (s: string): string => s.replace(/\s+/g, " ").trim();

interface Gold { page: number; quote: string }
interface Item {
  id: string; document: string; group: string; kind: "answerable" | "unanswerable";
  question: string; goldPages: Gold[]; mustContain?: string[];
}

const NOAEL = /NOAEL[^\n]{0,110}?(\d[\d.,]*)\s*mg\/kg/i;
const LIVER = /(\b(?:hepatocellular|hepatocyte|hepatic|liver|ALT|AST|transaminase|aminotransferase|bilirubin)\b[^\n]{0,140}?(\d[\d.,]*)\s*mg\/kg)/i;
const REVERSIBLE = /(recovery (?:period|phase)[^\n]{0,110}|\b(?:finding|change|effect|lesion|toxicit)\w*[^\n]{0,60}revers\w+[^\n]{0,60})/i;

const findAll = (pages: { page: number; text: string }[], re: RegExp, limit: number): { g: Gold; dose?: string }[] => {
  const out: { g: Gold; dose?: string }[] = [];
  for (const p of pages) {
    const m = re.exec(flat(p.text));
    if (m === null) continue;
    out.push({ g: { page: p.page, quote: m[0].trim().slice(0, 120) }, ...(m[1] !== undefined && /^\d/.test(m[1]) ? { dose: m[1] } : {}) });
    if (out.length >= limit) break;
  }
  return out;
};

const existing = JSON.parse(readFileSync("data/retrieval-eval.json", "utf8")) as { items: Item[]; note: string; version: string };
const have = new Set(existing.items.map((i) => i.document));
const proposed: Item[] = [];

for (const s of lib.list()) {
  if (!s.askable || have.has(s.name)) continue;
  const pages = lib.textFor(s.name);

  const noael = findAll(pages, NOAEL, 2);
  if (noael.length > 0) {
    const doses = [...new Set(noael.flatMap((n) => (n.dose === undefined ? [] : [n.dose.replace(/[.,]$/, "")])))];
    const gold = noael.map((n) => n.g);
    proposed.push({
      id: `${s.name}-noael-a`, document: s.name, group: `${s.name}:noael`, kind: "answerable",
      question: "What NOAEL was set, and in which study?", goldPages: gold,
      // Doubled on purpose: this is a template literal producing a regex SOURCE, so
      // `\\.` becomes the two characters that escape a dot in the pattern the scorer
      // compiles later. A single backslash here silently emits "any character".
      mustContain: [`(${doses.map((d) => d.replace(".", "\\.")).join("|")})\\s*mg/kg`],
    });
    proposed.push({
      id: `${s.name}-noael-b`, document: s.name, group: `${s.name}:noael`, kind: "answerable",
      question: "no observed adverse effect level", goldPages: gold,
      // Doubled on purpose: this is a template literal producing a regex SOURCE, so
      // `\\.` becomes the two characters that escape a dot in the pattern the scorer
      // compiles later. A single backslash here silently emits "any character".
      mustContain: [`(${doses.map((d) => d.replace(".", "\\.")).join("|")})\\s*mg/kg`],
    });
  }

  const liver = findAll(pages, LIVER, 2);
  if (liver.length > 0) {
    proposed.push({
      id: `${s.name}-liver-a`, document: s.name, group: `${s.name}:liver`, kind: "answerable",
      question: "What liver findings are reported, and at what doses?", goldPages: liver.map((l) => l.g),
      mustContain: ["alt|ast|aminotransferase|transaminase|hepat|liver|bilirubin"],
    });
    proposed.push({
      id: `${s.name}-liver-b`, document: s.name, group: `${s.name}:liver`, kind: "answerable",
      question: "does this drug damage the liver?", goldPages: liver.map((l) => l.g),
      mustContain: ["alt|ast|aminotransferase|transaminase|hepat|liver|bilirubin"],
    });
  }

  const rev = findAll(pages, REVERSIBLE, 2);
  if (rev.length > 0) {
    proposed.push({
      id: `${s.name}-reversible-a`, document: s.name, group: `${s.name}:reversibility`, kind: "answerable",
      question: "Were the toxicology findings reversible?", goldPages: rev.map((r) => r.g),
      mustContain: ["reversib|recover|resolv"],
    });
  }
}

console.log(`proposed ${proposed.length} items across ${new Set(proposed.map((p) => p.document)).size} documents\n`);
for (const p of proposed.filter((x) => x.id.endsWith("-a"))) {
  console.log(`${p.id.padEnd(24)} p${p.goldPages.map((g) => g.page).join(",")}  ${p.goldPages[0]!.quote.slice(0, 96)}`);
}
writeFileSync("results/proposed-items.json", JSON.stringify(proposed, null, 2), "utf8");
