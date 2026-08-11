/**
 * Why the decline rate is what it is, derived rather than asserted.
 *
 * `metrics.json` carries the headline figure (`nStructurallyForced`). This
 * script is the working that stands behind it, for anyone who reads HANDOVER
 * section 2 and wants to re-derive rather than trust:
 *
 *   1. the coverage curve over hypothetical gap thresholds - the answer to
 *      "just loosen it", without anyone having to loosen it;
 *   2. claims per compound and the discount ladder that drains their weight;
 *   3. the structural ceiling, split into the two kinds of abstention.
 *
 * It calls `committedMassCeiling` - the SAME function `abstentionQuality` uses,
 * deliberately imported rather than reimplemented. An earlier version of this
 * report was a standalone script that recovered discount factors by regexing
 * the trace's rationale prose, and it was wrong by 94 compounds: it credited
 * every ambiguous claim with full weight, when an ambiguous claim commits no
 * mass at all. Two implementations of one number is how the two drift apart,
 * and here the second one drifted before it was a week old.
 *
 * Usage:  npm run coverage:report
 */
import { readFileSync } from "node:fs";
import type { Ruleset } from "@arbiter/engine";
import { committedMassCeiling } from "./metrics.js";
import { loadInputs } from "./load.js";
import type { ResultRow } from "./main.js";

function main(): void {
  const results = JSON.parse(readFileSync("results/results.json", "utf8")) as { rows: ResultRow[] };
  const { claimsByCompound, ruleset } = loadInputs();
  const rows = results.rows;
  const n = rows.length;
  const bar = 1 - (ruleset as Ruleset).abstentionGapThreshold;

  // ------------------------------------------------------------- 1. the curve
  // Recomputing coverage at other thresholds is arithmetic over results already
  // on disk. It tunes nothing: the registered threshold is read, never written.
  const gaps = rows.map((r) => r.arbiter.plausibility - r.arbiter.belief).sort((a, b) => a - b);
  const pctl = (p: number) => gaps[Math.floor(p * (gaps.length - 1))]!;

  console.log(`registered abstentionGapThreshold: ${ruleset.abstentionGapThreshold}\n`);
  console.log("coverage if the threshold were moved (DIAGNOSTIC - do not act on this):");
  for (const t of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99]) {
    const c = gaps.filter((g) => g <= t).length;
    console.log(`  ${t.toFixed(2)} -> ${String(c).padStart(3)}/${n} commit (${((100 * c) / n).toFixed(1)}%)`);
  }
  console.log(
    `\ngap distribution: p10 ${pctl(0.1).toFixed(3)} · median ${pctl(0.5).toFixed(3)} · p90 ${pctl(0.9).toFixed(3)}`,
  );

  // ---------------------------------------------- 2. thinness and the ladder
  const perCompound = new Map<number, number>();
  const byAssertion = new Map<string, number>();
  for (const row of rows) {
    const claims = claimsByCompound.get(row.compoundId) ?? [];
    perCompound.set(claims.length, (perCompound.get(claims.length) ?? 0) + 1);
    for (const c of claims) byAssertion.set(c.assertion, (byAssertion.get(c.assertion) ?? 0) + 1);
  }

  console.log("\nclaims per compound:");
  for (const [k, v] of [...perCompound].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${k} claim(s): ${v} compounds`);
  }
  console.log("\nclaims by assertion:");
  for (const [k, v] of [...byAssertion].sort((a, b) => b[1] - a[1])) {
    // Ambiguous claims are the trap: they are admitted, they appear in the trace,
    // and they commit exactly nothing. Counting them as evidence is what made the
    // first version of this report wrong.
    const note = k === "ambiguous" ? "  <- commits no mass" : "";
    console.log(`  ${k.padEnd(10)} ${String(v).padStart(4)}${note}`);
  }

  // ------------------------------------------------------- 3. the two kinds
  let forced = 0;
  let couldHave = 0;
  for (const row of rows) {
    if (row.arbiter.verdict !== "abstain") continue;
    const ceiling = committedMassCeiling(row, claimsByCompound.get(row.compoundId) ?? [], ruleset);
    if (ceiling <= bar) forced++;
    else couldHave++;
  }

  console.log(`\nof ${forced + couldHave} abstentions:`);
  console.log(`  ${forced} could NOT have committed at any evidence values (ceiling <= ${bar})`);
  console.log(`  ${couldHave} could have committed and did not`);
  console.log(
    "\nThe first group is the finding: for those compounds the assay class is the wrong\n"
    + "instrument, so more of the same evidence is wasted money. The second is the only\n"
    + "group where better numbers from the same assays would change the verdict.",
  );
}

main();
