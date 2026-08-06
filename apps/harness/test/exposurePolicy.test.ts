import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rulesetHash } from "../src/hash.js";
import {
  PRE_REGISTERED_EXPOSURE_POLICY_HASH,
  projectExposurePolicyForHash,
} from "../src/preregistration.js";

const policy = JSON.parse(readFileSync("rules/exposure-policy-v1.0.json", "utf8"));

describe("exposure policy pre-registration", () => {
  it("matches its registered hash", () => {
    expect(rulesetHash(projectExposurePolicyForHash(policy))).toBe(
      PRE_REGISTERED_EXPOSURE_POLICY_HASH,
    );
  });

  // The test that gives the one above its meaning. Without it, a projection that
  // returned a constant would pass the first assertion forever.
  it("a mutated margin factor produces a DIFFERENT hash", () => {
    const tampered = { ...policy, marginFactor: 30 };
    expect(rulesetHash(projectExposurePolicyForHash(tampered))).not.toBe(
      PRE_REGISTERED_EXPOSURE_POLICY_HASH,
    );
  });

  // appliesToStreams is in the surface deliberately - widening it changes which
  // claims R3 governs, so it must not be silently editable.
  it("a mutated appliesToStreams produces a DIFFERENT hash", () => {
    const tampered = { ...policy, appliesToStreams: ["cytotox", "transporter", "qsar"] };
    expect(rulesetHash(projectExposurePolicyForHash(tampered))).not.toBe(
      PRE_REGISTERED_EXPOSURE_POLICY_HASH,
    );
  });

  // Prose is NOT in the surface: reworded rationale must not invalidate a result.
  it("rewording the rationale does NOT change the hash", () => {
    const reworded = { ...policy, rationale: "different words entirely" };
    expect(rulesetHash(projectExposurePolicyForHash(reworded))).toBe(
      PRE_REGISTERED_EXPOSURE_POLICY_HASH,
    );
  });
});
