/**
 * Why the decline rate is 97.4%, measured rather than asserted.
 *
 * HANDOVER §2 originally attributed the coverage entirely to R3 — no compound
 * carrying exposure-relevant evidence. That is true and it is not the whole
 * cause: it accounts for 118 of the 225 discounted claims. The rest are QSAR
 * claims discounted to 6% or 1% for measuring no key event, and more than half
 * the corpus carries only ONE claim, so there is no second stream to fuse.
 *
 * This script derives the three numbers §2 quotes, so nobody retypes them:
 *
 *   1. the coverage curve over hypothetical gap thresholds — showing the
 *      threshold is not the binding constraint, which is the answer to
 *      "just loosen it" without anyone having to loosen it;
 *   2. claims per compound and the discount ladder;
 *   3. the structural ceiling — compounds that cannot reach the threshold
 *      under ANY evidence values.
 *
 * The ceiling is deliberately GENEROUS. It sums each surviving claim's
 * discount fraction and pretends every claim was stated at full confidence
 * 1.0. Dempster combination always yields less than that sum for masses this
 * small (two 0.15 claims combine to 0.2775, not 0.30), so a compound whose
 * generous ceiling is below the threshold certainly cannot clear it. Being an
 * upper bound is what makes "cannot commit" a safe word.
 *
 * Usage:  node tools/abstention_ceiling.mjs
 *
 * Exits 1 if the self-check fails. That check is the point: every compound the
 * bound calls structurally-forced MUST appear in the abstain set. If one does
 * not, the bound is not an upper bound and every conclusion below is void.
 */
import { readFileSync } from "node:fs";

const results = JSON.parse(readFileSync(new URL("../results/results.json", import.meta.url), "utf8"));
const ruleset = JSON.parse(readFileSync(new URL("../rules/ruleset-v1.0.json", import.meta.url), "utf8"));

const THRESHOLD = ruleset.abstentionGapThreshold;
const rows = results.rows;
const n = rows.length;

const claimsOf = (row) => row.arbiter.trace.filter((t) => t.claimId !== "__verdict__");
const discountOf = (claim) => {
  const m = /Weight reduced to (\d+)% of stated confidence: (.+?)(?:\.|$)/.exec(claim.rationale ?? "");
  return m ? { fraction: Number(m[1]) / 100, why: m[2] } : null;
};

// ---------------------------------------------------------------- 1. the curve
// A committed verdict needs plausibility - belief <= THRESHOLD. Recomputing
// coverage at other thresholds is arithmetic over results already on disk; it
// tunes nothing and rules/ruleset-v1.0.json is opened read-only, for the
// registered value only.
const gaps = rows.map((r) => r.arbiter.plausibility - r.arbiter.belief).sort((a, b) => a - b);
const coverageAt = (t) => gaps.filter((g) => g <= t).length;

console.log(`registered abstentionGapThreshold: ${THRESHOLD}`);
console.log("\ncoverage if the threshold were moved (DIAGNOSTIC — do not act on this):");
for (const t of [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99]) {
  const c = coverageAt(t);
  console.log(`  ${t.toFixed(2)} -> ${String(c).padStart(3)}/${n} commit (${((100 * c) / n).toFixed(1)}%)`);
}

const pct = (p) => gaps[Math.floor(p * (gaps.length - 1))];
console.log(
  `\ngap distribution: p10 ${pct(0.1).toFixed(3)} · median ${pct(0.5).toFixed(3)} · p90 ${pct(0.9).toFixed(3)}`,
);
console.log(`median committed mass ${(1 - pct(0.5)).toFixed(3)} against a bar of ${(1 - THRESHOLD).toFixed(3)}`);

// ------------------------------------------------- 2. thinness and the ladder
const perCompound = {};
const ladder = {};
let discounted = 0;
let totalClaims = 0;
for (const row of rows) {
  const claims = claimsOf(row);
  perCompound[claims.length] = (perCompound[claims.length] ?? 0) + 1;
  for (const c of claims) {
    totalClaims++;
    const d = discountOf(c);
    if (!d) continue;
    discounted++;
    const key = `${(d.fraction * 100).toFixed(0)}% — ${d.why}`;
    ladder[key] = (ladder[key] ?? 0) + 1;
  }
}

console.log("\nclaims per compound:");
for (const [k, v] of Object.entries(perCompound).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  console.log(`  ${k} claim(s): ${v} compounds`);
}
console.log(`\n${discounted}/${totalClaims} claims discounted (${((100 * discounted) / totalClaims).toFixed(1)}%):`);
for (const [k, v] of Object.entries(ladder).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(3)}  ${k}`);
}

// -------------------------------------------------------- 3. the hard ceiling
// Only a LIVE claim can commit mass; a defeated claim contributes zero, which
// is the same reason abstain.ts filters on status before it looks at anything.
const forced = [];
for (const row of rows) {
  let ceiling = 0;
  for (const c of claimsOf(row)) {
    if (c.status !== "admitted" && c.status !== "downweighted") continue;
    ceiling += discountOf(c)?.fraction ?? 1;
  }
  if (ceiling <= 1 - THRESHOLD) forced.push(row);
}

const escaped = forced.filter((r) => r.arbiter.verdict !== "abstain");
console.log(
  `\nstructurally forced to abstain: ${forced.length}/${n} (${((100 * forced.length) / n).toFixed(1)}%)`,
);
console.log("  — their maximum committed mass cannot reach the bar at any evidence values");

if (escaped.length > 0) {
  console.error(`\nSELF-CHECK FAILED: ${escaped.length} compound(s) cleared a ceiling that bounds them.`);
  console.error("The bound is not an upper bound; every conclusion above is void.");
  for (const r of escaped.slice(0, 5)) console.error(`  ${r.compoundId} -> ${r.arbiter.verdict}`);
  process.exit(1);
}
console.log(`  self-check: all ${forced.length} are in the abstain set, so the bound holds`);
