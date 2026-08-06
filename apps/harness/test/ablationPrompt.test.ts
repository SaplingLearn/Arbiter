import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildTemplate, EVIDENCE_PLACEHOLDER, promptSha256, renderUser, type RulesetForPrompt,
} from "../src/ablation/prompt.js";
import { VERDICTS } from "../src/ablation/aggregate.js";

const RULESET: RulesetForPrompt = {
  rules: [
    { id: "R1", name: "Human relevance", statement: "Human-cell evidence defeats animal in vivo evidence." },
    { id: "R2", name: "Mechanistic proximity", statement: "Key-event evidence defeats structural correlation." },
  ],
  abstentionGapThreshold: 0.5,
  precedenceOrder: ["R1", "R2"],
};

describe("the prompt digest", () => {
  // Test 6. Fails if the hash is computed over something other than the prompt.
  it("changes when a rule statement changes", () => {
    const edited: RulesetForPrompt = {
      ...RULESET,
      rules: [{ ...(RULESET.rules[0] as RulesetForPrompt["rules"][number]), statement: "Something else entirely." },
        RULESET.rules[1] as RulesetForPrompt["rules"][number]],
    };
    expect(promptSha256(buildTemplate(edited))).not.toBe(promptSha256(buildTemplate(RULESET)));
  });

  it("changes when the abstention threshold changes", () => {
    const edited = { ...RULESET, abstentionGapThreshold: 0.8 };
    expect(promptSha256(buildTemplate(edited))).not.toBe(promptSha256(buildTemplate(RULESET)));
  });

  it("changes when the precedence order changes", () => {
    const edited = { ...RULESET, precedenceOrder: ["R2", "R1"] };
    expect(promptSha256(buildTemplate(edited))).not.toBe(promptSha256(buildTemplate(RULESET)));
  });

  it("is stable across identical builds", () => {
    expect(promptSha256(buildTemplate(RULESET))).toBe(promptSha256(buildTemplate(RULESET)));
  });

  /**
   * The digest covers the TEMPLATE, not a filled instance. If it moved with the
   * evidence, every compound would have its own hash and the resume guard -
   * which matches on prompt hash - could never match anything.
   */
  it("does not move with the per-compound evidence", () => {
    const t = buildTemplate(RULESET);
    const before = promptSha256(t);
    renderUser(t, [{ id: "c1", assertion: "toxic" }]);
    expect(promptSha256(t)).toBe(before);
  });
});

describe("what the model is shown", () => {
  it("carries every registered rule statement verbatim", () => {
    const { system } = buildTemplate(RULESET);
    for (const r of RULESET.rules) expect(system).toContain(r.statement);
  });

  /** Denying the model `abstain` would rig the comparison in ARBITER's favour
   *  and would be indefensible the moment anyone read the prompt. */
  it("offers all three verdicts, including abstain", () => {
    const { system } = buildTemplate(RULESET);
    for (const v of VERDICTS) expect(system).toContain(v);
    expect(system).toContain("abstain");
  });

  it("serialises claims as canonical JSON with keys sorted, not as prose", () => {
    const t = buildTemplate(RULESET);
    const rendered = renderUser(t, [{ stream: "qsar", assertion: "toxic", id: "c1" }]);
    expect(rendered).toContain('{"assertion":"toxic","id":"c1","stream":"qsar"}');
    expect(rendered).not.toContain(EVIDENCE_PLACEHOLDER);
  });

  it("puts the varying evidence last, so the stable prefix can cache", () => {
    const t = buildTemplate(RULESET);
    expect(t.user.trimEnd().endsWith(EVIDENCE_PLACEHOLDER)).toBe(true);
  });

  /** The rules shown to the model must be the registered ones, read from the
   *  pre-registered file rather than retyped into this module. */
  it("matches the shipped ruleset when built from it", () => {
    const shipped = JSON.parse(readFileSync("rules/ruleset-v1.0.json", "utf8")) as RulesetForPrompt;
    const { system } = buildTemplate(shipped);
    expect(shipped.rules).toHaveLength(6);
    for (const r of shipped.rules) expect(system).toContain(r.statement);
  });
});
