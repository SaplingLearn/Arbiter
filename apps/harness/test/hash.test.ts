import { describe, expect, it } from "vitest";
import { PRE_REGISTERED_HASH, projectForHash, rulesetHash } from "../src/hash.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };

/**
 * The pre-registration surface: the fields a toxicologist actually commits
 * to before any evaluation. Deliberately excludes `version`, `registeredAt`,
 * and `precedenceRationale` (prose, not a decision) - see hash.ts's doc
 * comment for why the projection is the caller's job, not rulesetHash's.
 */
// Imported, not redefined. This function used to be duplicated here, and the
// harness loader's copy silently omitted precedenceOrder.

describe("rulesetHash", () => {
  it("is stable against key reordering, at any nesting depth", () => {
    const a = { x: 1, y: { p: 1, q: 2 }, z: [{ m: 1, n: 2 }] };
    const b = { z: [{ n: 2, m: 1 }], y: { q: 2, p: 1 }, x: 1 };
    expect(rulesetHash(a)).toBe(rulesetHash(b));
  });

  it("is stable against JSON whitespace formatting", () => {
    const tight = JSON.parse('{"a":1,"b":[1,2,3],"c":{"d":"e"}}');
    const spaced = JSON.parse(`
      {
        "a": 1,
        "b": [ 1,  2,   3 ],
        "c": { "d": "e" }
      }
    `);
    expect(rulesetHash(tight)).toBe(rulesetHash(spaced));
  });

  it("changes when any hashed field's value changes", () => {
    const base = projectForHash(ruleset);
    const mutated = { ...base, abstentionGapThreshold: base.abstentionGapThreshold + 0.01 };
    expect(rulesetHash(mutated)).not.toBe(rulesetHash(base));
  });

  it("computes a stable 64-hex-char digest over the pre-registered ruleset's projected surface", () => {
    const projected = projectForHash(ruleset);
    const hash = rulesetHash(projected);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Regression pin. If this value changes, the pre-registered rules,
    // thresholds, binarisation policy, or precedence order changed - which
    // is exactly what this hash exists to make visible. See the pre-
    // registration commit and the Phase 2 report for the recorded value.
    expect(hash).toBe("ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136");
    // And the constant the harness gates on is the same value, so the two cannot
    // drift into disagreeing about what was registered.
    expect(hash).toBe(PRE_REGISTERED_HASH);
  });
});
