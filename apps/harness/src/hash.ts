import { createHash } from "node:crypto";
import { canonicalJson } from "./preregistration.js";

/**
 * SHA-256 of whatever value is passed in, canonicalised with object keys
 * sorted so the hash is stable against JSON formatting (key order,
 * whitespace, array-vs-object nesting reproduced identically).
 *
 * This function does not decide what "the ruleset" is for pre-registration
 * purposes - it hashes exactly the value it is handed, nothing more or
 * less. Callers must project the pre-registration surface themselves
 * (rules, abstentionGapThreshold, dilirankBinarisation, precedenceOrder)
 * and pass only that object, so the hash answers "did the pre-registered
 * decision surface change" and not "did some unrelated display field change".
 */
export function rulesetHash(ruleset: unknown): string {
  return createHash("sha256").update(canonicalJson(ruleset)).digest("hex");
}

/**
 * Re-exported, not redefined. The projection and the canonicalisation live in
 * preregistration.ts because the web app needs them too and cannot import
 * node:crypto; keeping the names available here means load.ts and hash.test.ts
 * did not have to move, and there is still exactly one definition.
 */
export {
  canonicalJson, PRE_REGISTERED_EXPOSURE_POLICY_HASH, PRE_REGISTERED_HASH,
  projectExposurePolicyForHash, projectForHash,
} from "./preregistration.js";
