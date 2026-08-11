import { loadInputs } from "./load.js";

const { claimsByCompound, benchmarkIds, fixtureIds, splits, ruleset, hash } = loadInputs();
const nClaims = [...claimsByCompound.values()].reduce((s, v) => s + v.length, 0);

/**
 * Fixture ids that reached the benchmark population.
 *
 * Membership, not `startsWith("TAK-994")`. The prefix form was correct for exactly
 * one fixture and silently correct-looking for any other - the failure mode
 * HANDOVER §6.4 names, where a silent empty result looks exactly like a working
 * pipeline. The list comes from `evidence.json`'s `fixtureCompoundIds`, which the
 * Python assembly layer has always emitted as a list.
 */
export function findLeakedFixtures(fixtureIds: string[], benchmarkIds: string[]): string[] {
  const benchmark = new Set(benchmarkIds);
  return fixtureIds.filter((id) => benchmark.has(id));
}

const leaked = findLeakedFixtures(fixtureIds, benchmarkIds);
if (leaked.length > 0) throw new Error(`Fixture leaked into the benchmark: ${leaked.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  claims: nClaims,
  compoundsWithEvidence: claimsByCompound.size,
  benchmarkCompounds: benchmarkIds.length,
  testSplit: splits.test.length,
  rulesetVersion: ruleset.version,
  rulesetHash: hash,
}, null, 2));
