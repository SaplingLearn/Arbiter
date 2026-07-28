import { describe, expect, it } from "vitest";
import { loadData } from "../src/data/load.js";
import { browserRulesetHash, PRE_REGISTERED_HASH } from "../src/data/rulesetHash.js";

const data = loadData();

describe("browserRulesetHash", () => {
  it("reproduces the pre-registered hash from the bundled ruleset", async () => {
    // The cross-platform check that matters: the harness computes this with
    // node:crypto and refuses to run on a mismatch, the browser computes it with
    // Web Crypto. Both must land on the constant committed at pre-registration.
    // If the projection or the canonicalisation drifted between them, the
    // pre-flight panel would confidently show a hash the audit trail never saw.
    expect(await browserRulesetHash(data.ruleset)).toBe(PRE_REGISTERED_HASH);
  });

  it("changes when a rule's strength changes", async () => {
    // Editing the ruleset is the product. It must be visible as a different hash,
    // not absorbed silently, or the pre-flight check certifies nothing.
    const edited = {
      ...data.ruleset,
      rules: data.ruleset.rules.map((r, i) => (i === 0 ? { ...r, strength: 0.123 } : r)),
    };
    expect(await browserRulesetHash(edited)).not.toBe(PRE_REGISTERED_HASH);
  });

  it("ignores version and registeredAt, which are metadata rather than decisions", async () => {
    const relabelled = { ...data.ruleset, version: "9.9", registeredAt: "2099-01-01" };
    expect(await browserRulesetHash(relabelled)).toBe(PRE_REGISTERED_HASH);
  });

  it("changes when precedenceOrder is reordered", async () => {
    // precedenceOrder IS a decision - it is the preference ordering a toxicologist
    // edits - and was the field a previous projection omitted.
    const reordered = { ...data.ruleset, precedenceOrder: [...data.ruleset.precedenceOrder].reverse() };
    expect(await browserRulesetHash(reordered)).not.toBe(PRE_REGISTERED_HASH);
  });
});
