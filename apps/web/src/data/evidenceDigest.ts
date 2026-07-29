import type { EvidenceClaim } from "@arbiter/engine";
import { canonicalJson } from "../../../harness/src/preregistration.js";
import { sha256Hex } from "../record/chain.js";

/**
 * A digest over the evidence, computed IN THE BROWSER.
 *
 * `rules/ruleset-v1.0.json` is pre-registered and hashed, so the pre-flight panel
 * can say "the ruleset on screen is the registered one" BECAUSE check-ruleset
 * proved it. `data/out/evidence.json` is bundled and schema-validated but has never
 * been hashed - so with an evidence working copy added, the matching line beside it
 * would be a hardcoded string that reads identically on evidence that had silently
 * drifted. That is the exact defect HANDOVER §5.4 records the panel being rewritten
 * to remove, and it is why this file exists (Phase 3 spec §9.2).
 *
 * canonicalJson is imported from the harness rather than reimplemented, exactly as
 * rulesetHash.ts does, and for the same reason: a second copy of "what counts as
 * the thing being hashed" is how a digest comes to match nothing at all.
 *
 * There is deliberately no committed constant to compare against. This digest is
 * not a pre-registration claim - it is used to compare the WORKING evidence against
 * the REGISTERED evidence. This supersedes the predicate Task 3 installed on this line
 * (§9.3): Task 3 made the badge and the panel agree, and this upgrades the panel from
 * an in-memory comparison to a digest, so the line is a check rather than a caption:
 * a content comparison, so editing a field and editing it back clears the warning
 * instead of leaving it stuck on a reference inequality.
 */

/**
 * The engine-read surface of a claim, sorted by id.
 *
 * Excludes `provenance`, which the engine never reads (spec §5.3) - a corrected
 * citation is not an evidence edit and must not report as one. The sort makes the
 * digest independent of load order, which claimsByCompound does not guarantee.
 */
export function projectClaimsForDigest(claims: EvidenceClaim[]): unknown[] {
  return [...claims]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => ({
      id: c.id,
      compoundId: c.compoundId,
      stream: c.stream,
      assertion: c.assertion,
      strength: c.strength,
      system: c.system,
      measuresKeyEvent: c.measuresKeyEvent,
      exposureRelevant: c.exposureRelevant,
      inApplicabilityDomain: c.inApplicabilityDomain,
      klimisch: c.klimisch,
      availableFrom: c.availableFrom,
    }));
}

export async function browserEvidenceDigest(claims: EvidenceClaim[]): Promise<string> {
  return sha256Hex(canonicalJson(projectClaimsForDigest(claims)));
}
