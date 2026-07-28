import type { Ruleset } from "@arbiter/engine";
import { canonicalJson, projectForHash } from "../../../harness/src/preregistration.js";
import { sha256Hex } from "../record/chain.js";

/**
 * The pre-registration hash of a ruleset, computed IN THE BROWSER.
 *
 * The projection and the canonicalisation are imported from the harness rather
 * than reimplemented, because a second copy of "what counts as the ruleset" is
 * how a hash comes to match nothing at all. Only the digest differs by platform:
 * node:crypto there, Web Crypto here.
 *
 * This is what makes the pre-flight panel a check rather than a caption. Printing
 * a hardcoded constant next to the words "as registered" would read identically
 * on a ruleset that had silently drifted.
 */
export async function browserRulesetHash(ruleset: Ruleset): Promise<string> {
  return sha256Hex(canonicalJson(projectForHash(ruleset)));
}

export { PRE_REGISTERED_HASH } from "../../../harness/src/preregistration.js";
