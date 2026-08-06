import { describe, expect, it } from "vitest";
import { EvidenceClaimSchema } from "@arbiter/engine";
import { ProposalSchema } from "../src/ai/interpret.js";
import { loadData } from "../src/data/load.js";
import CACHE from "../src/ai/cache/interpretations.json";

const data = loadData();
const ruleIds = new Set(data.ruleset.rules.map((r) => r.id));
const claimsById = new Map(data.heroCases.get("TAK-994")!.claims!.map((c) => [c.id, c]));

describe("the authored interpretation cache", () => {
  it("carries the thirteen entries design section 13 registers", () => {
    // Not decoration. The interpreter DROPS an entry that fails ProposalSchema so
    // that a bad edit cannot blank the app on import; without this count the
    // degradation would be silent and rung 2 would just start missing.
    expect(CACHE.entries).toHaveLength(13);
  });

  it("covers all six registered rules", () => {
    const covered = new Set(CACHE.entries.map((e) => e.targetRule));
    expect([...covered].sort()).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
  });

  it("marks exactly four entries low-confidence", () => {
    // The four that object to the discount MECHANISM rather than to a named rule.
    // Design section 5.2 keys the un-armed Apply control off this value, so the
    // count is a behavioural fact, not bookkeeping.
    expect(CACHE.entries.filter((e) => e.confidence === "low")).toHaveLength(4);
  });

  it("names a REAL rule id on every entry", () => {
    for (const e of CACHE.entries) {
      expect(ruleIds.has(e.targetRule as never), `${e.targetRule} on "${e.challenge}"`).toBe(true);
    }
  });

  it("parses every entry through ProposalSchema", () => {
    for (const e of CACHE.entries) {
      const parsed = ProposalSchema.safeParse({
        targetRule: e.targetRule, targetClaimId: e.targetClaimId, action: e.action,
        field: e.field, newValue: e.newValue, paraphrase: e.paraphrase, confidence: e.confidence,
      });
      expect(parsed.success, `"${e.challenge}": ${parsed.success ? "" : parsed.error.issues[0]?.message}`).toBe(true);
    }
  });

  it("names a REAL claim id and a SCHEMA-LEGAL value on every reclassify entry", () => {
    // The check the interpreter itself cannot run: design section 5's request
    // contract denies it the raw values, and schema.ts:26-35's cross-field
    // refinement needs them. Doing it here means the cache path can never deliver
    // a proposal that would be rejected on arrival.
    const reclassify = CACHE.entries.filter((e) => e.action === "reclassify_field");
    expect(reclassify.length).toBeGreaterThan(0);

    for (const e of reclassify) {
      const claim = claimsById.get(e.targetClaimId ?? "");
      expect(claim, `unknown claim id ${e.targetClaimId}`).toBeDefined();
      const merged = { ...claim, [e.field as string]: e.newValue };
      const parsed = EvidenceClaimSchema.safeParse(merged);
      expect(
        parsed.success,
        `${e.targetClaimId}.${e.field} = ${JSON.stringify(e.newValue)}: ${parsed.success ? "" : parsed.error.issues[0]?.message}`,
      ).toBe(true);
    }
  });

  it("would REJECT a reclassify that broke the engine's cross-field constraint", () => {
    // Proves the previous test can fail rather than merely passing vacuously. A
    // measuresKeyEvent on the QSAR claim is the exact case schema.ts:26-35 exists
    // for: it lets a computational prediction escape R2's structural-correlation
    // discount and be weighted like human clinical evidence.
    const qsar = claimsById.get("TAK-994:qsar");
    expect(EvidenceClaimSchema.safeParse({ ...qsar, measuresKeyEvent: "KE:BSEP-INHIBITION" }).success).toBe(false);
    expect(EvidenceClaimSchema.safeParse({ ...qsar, klimisch: 7 }).success).toBe(false);
  });
});
