import { readFileSync } from "node:fs";
import { EvidenceClaimSchema, RulesetSchema, type AssayOperator, type EvidenceClaim, type Ruleset } from "@arbiter/engine";
import {
  PRE_REGISTERED_EXPOSURE_POLICY_HASH, PRE_REGISTERED_HASH,
  projectExposurePolicyForHash, projectForHash, rulesetHash,
} from "./hash.js";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

export interface ExposurePolicy {
  version: string;
  registeredAt: string;
  marginFactor: number;
  basis: "unbound" | "total";
  statement: string;
  rationale: string;
  appliesToStreams: string[];
}

export interface Inputs {
  claimsByCompound: Map<string, EvidenceClaim[]>;
  benchmarkIds: string[];
  fixtureIds: string[];
  splits: { seed: number; train: string[]; calibration: string[]; test: string[] };
  truth: Map<string, number>;
  ruleset: Ruleset;
  hash: string;
  assays: AssayOperator[];
}

/**
 * Load and VALIDATE every input before the harness computes anything.
 *
 * A malformed evidence file must fail here, loudly, rather than producing a
 * plausible-looking number downstream. Every claim is parsed through the real zod
 * schema: this is the authoritative cross-language check that the Python prep layer
 * emits exactly what the TypeScript engine accepts, and it is what catches a claim
 * built outside the validated path.
 */
export function loadInputs(): Inputs {
  const ruleset = RulesetSchema.parse(read("rules/ruleset-v1.0.json")) as Ruleset;
  const evidence = read("data/out/evidence.json");
  const splits = read("data/out/splits.json");
  const compounds = read("data/out/compounds.json").compounds as { compoundId: string; y: number }[];
  // data/assays.json, NOT data/out/assays.json: the catalogue is hand-authored
  // input, and data/out holds generated artifacts.
  const assays = read("data/assays.json").assays as AssayOperator[];

  const hash = rulesetHash(projectForHash(ruleset));
  if (hash !== PRE_REGISTERED_HASH) {
    throw new Error(
      `Ruleset hash ${hash} does not match the pre-registered ${PRE_REGISTERED_HASH}.\n`
      + "rules/ruleset-v1.0.json has changed. Contesting the rules is the product, but it "
      + "must be a deliberate re-registration - not something that happens silently "
      + "underneath a results file claiming to be pre-registered.",
    );
  }

  const exposurePolicy = read("rules/exposure-policy-v1.0.json") as ExposurePolicy;
  const exposureHash = rulesetHash(projectExposurePolicyForHash(exposurePolicy));
  if (exposureHash !== PRE_REGISTERED_EXPOSURE_POLICY_HASH) {
    throw new Error(
      `Exposure policy hash ${exposureHash} does not match the pre-registered `
      + `${PRE_REGISTERED_EXPOSURE_POLICY_HASH}.\n`
      + "rules/exposure-policy-v1.0.json has changed. The margin factor was registered "
      + "before the first margin was computed, precisely so it could not be tuned "
      + "afterwards to improve a number.",
    );
  }

  const claimsByCompound = new Map<string, EvidenceClaim[]>();
  for (const raw of evidence.claims) {
    const claim = EvidenceClaimSchema.parse(raw) as EvidenceClaim;
    const list = claimsByCompound.get(claim.compoundId) ?? [];
    list.push(claim);
    claimsByCompound.set(claim.compoundId, list);
  }

  return {
    claimsByCompound,
    benchmarkIds: evidence.benchmarkCompoundIds as string[],
    fixtureIds: evidence.fixtureCompoundIds as string[],
    splits,
    truth: new Map(compounds.map((c) => [c.compoundId, c.y])),
    ruleset,
    hash,
    assays,
  };
}

/** Claims visible as of a date. The engine cannot do this - it has no clock. */
export function asOf(claims: EvidenceClaim[], date: string): EvidenceClaim[] {
  return claims.filter((c) => c.availableFrom <= date);
}
