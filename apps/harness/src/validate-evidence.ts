import { loadInputs } from "./load.js";

const { claimsByCompound, benchmarkIds, splits, ruleset, hash } = loadInputs();
const nClaims = [...claimsByCompound.values()].reduce((s, v) => s + v.length, 0);

// The fixture must never be a benchmark row.
const leaked = benchmarkIds.filter((id) => id.startsWith("TAK-994"));
if (leaked.length > 0) throw new Error(`TAK-994 leaked into the benchmark: ${leaked.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  claims: nClaims,
  compoundsWithEvidence: claimsByCompound.size,
  benchmarkCompounds: benchmarkIds.length,
  testSplit: splits.test.length,
  rulesetVersion: ruleset.version,
  rulesetHash: hash,
}, null, 2));
