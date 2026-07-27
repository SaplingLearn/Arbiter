import { describe, expect, it } from "vitest";
import { reason, reasonVerdictOnly } from "../src/index.js";
import { argue } from "../src/argue.js";
import { pivotalRules, planNextExperiment, resolvesRule, type AssayOperator } from "../src/plan.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import assayFile from "../../../data/assays.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;
const ASSAYS = (assayFile as { assays: AssayOperator[] }).assays;
/** Extras-free, so the planner's own probes cannot recurse through the counterfactual. */
const bare = reasonVerdictOnly;

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    ...over,
  };
}

const byId = (id: string) => ASSAYS.find((a) => a.id === id)!;

/**
 * The TAK-994 pass-1 SHAPE: four non-contradicting safe claims, two non-human and
 * two human, none with an established exposure margin. Abstains because nothing
 * licenses a safety conclusion, and R3 is the pivotal rule. Used wherever a test
 * needs a case with real argument structure rather than a bare abstention.
 */
const PASS_ONE: EvidenceClaim[] = [
  claim({ id: "rat", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent" }),
  claim({ id: "primate", assertion: "safe", strength: 0.85, system: "nonrodent", stream: "invivo_nonrodent" }),
  claim({ id: "invitro", assertion: "safe", strength: 0.8, system: "human", stream: "cytotox", measuresKeyEvent: "KE:HEPATOCYTE-DEATH" }),
  claim({ id: "bsep", assertion: "safe", strength: 0.75, system: "human", stream: "transporter", measuresKeyEvent: "KE:BSEP" }),
];

describe("pivotalRules", () => {
  it("identifies R1 as pivotal when R1 is what defeated the opposing claim", () => {
    // Klimisch EQUAL and exposure established on both sides, deliberately. The
    // plan's fixture used Klimisch 1 against 2, where turning R1 off simply lets R5
    // defeat the same claim for a different reason and the verdict never moves - so
    // R1 was not pivotal there and the assertion failed. Measured, not assumed:
    // with the margins equalised, `without R1` flips do_not_advance -> abstain.
    const claims = [
      claim({ id: "h", assertion: "toxic", system: "human", klimisch: 2, strength: 0.9, exposureRelevant: true }),
      claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 2, strength: 0.9, exposureRelevant: true }),
    ];
    expect(reasonVerdictOnly(claims, RS).verdict).toBe("do_not_advance");
    expect(pivotalRules(claims, RS, bare)).toContain("R1");
  });

  it("FINDS PIVOTAL RULES WHEN NO ATTACK OCCURRED - the pass-1 shape", () => {
    // The load-bearing test for this task. Four safe claims, none contradicting any
    // other, so `argue()` produces ZERO attacks - asserted below so the premise
    // cannot rot. Since Task 7, R1-R5 also act as evidence-quality discounts that
    // apply without any conflict, and it is those discounts that drive this
    // abstention.
    //
    // The plan's version took its candidate rules from `argue().attacks`, so on
    // this input it returned an EMPTY list, and the planner had no argument
    // structure to reason about in precisely the scenario spec beat 5 is built on.
    const passOne = PASS_ONE;
    expect(argue(passOne, RS).attacks).toHaveLength(0);
    expect(reasonVerdictOnly(passOne, RS).verdict).toBe("abstain");

    const pivotal = pivotalRules(passOne, RS, bare);
    expect(pivotal.length).toBeGreaterThan(0);
    // R3 is the one doing the work here: every claim asserts safe with an
    // unestablished exposure margin, so R3 discounts all four. Turning it off is
    // what lets a conclusion be licensed.
    expect(pivotal).toContain("R3");
  });

  it("returns no pivotal rule when the verdict does not rest on any rule", () => {
    // A single human, in-domain, Klimisch 2, positive claim: no discount clause
    // applies and there is nothing to defeat, so disabling any rule leaves the
    // verdict untouched.
    const claims = [claim({ id: "a", assertion: "toxic" })];
    expect(reasonVerdictOnly(claims, RS).verdict).toBe("do_not_advance");
    expect(pivotalRules(claims, RS, bare)).toHaveLength(0);
  });

  it("never reports an already-disabled rule as pivotal", () => {
    const off: Ruleset = { ...RS, rules: RS.rules.map((r) => (r.id === "R3" ? { ...r, enabled: false } : r)) };
    expect(pivotalRules([
      claim({ id: "rat", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent" }),
    ], off, bare)).not.toContain("R3");
  });

  it("is order-stable, returning rules in R1..R6 order", () => {
    const claims = [
      claim({ id: "rat", assertion: "safe", strength: 0.9, system: "rodent", stream: "invivo_rodent", klimisch: 4 }),
    ];
    const p = pivotalRules(claims, RS, bare);
    expect([...p]).toEqual([...p].sort());
  });
});

describe("resolvesRule", () => {
  it("accepts Klimisch 2 for R5, not only Klimisch 1", () => {
    // R5 discounts Klimisch 3 and 4, so a Klimisch 2 assay escapes it and also
    // out-defeats any Klimisch 3 or 4 study. Requiring exactly 1 wrongly discarded
    // the mitochondrial panel as a way to resolve R5.
    expect(resolvesRule("R5", byId("mito-tox-panel"))).toBe(true);
    expect(byId("mito-tox-panel").produces.klimisch).toBe(2);
    expect(resolvesRule("R5", byId("readacross-refinement"))).toBe(false);
  });

  it("never claims to resolve R6, which has no verdict-path mechanism", () => {
    for (const a of ASSAYS) expect(resolvesRule("R6", a)).toBe(false);
  });

  it("maps each remaining rule to the property that escapes its discount", () => {
    expect(resolvesRule("R1", byId("human-hepatocyte-spheroid"))).toBe(true);
    expect(resolvesRule("R1", byId("murine-cyp-induction"))).toBe(false);
    expect(resolvesRule("R2", byId("bsep-inhibition"))).toBe(true);
    expect(resolvesRule("R2", byId("readacross-refinement"))).toBe(false);
    expect(resolvesRule("R3", byId("bsep-inhibition"))).toBe(true);
    expect(resolvesRule("R3", byId("readacross-refinement"))).toBe(false);
  });
});

describe("planNextExperiment", () => {
  it("recommends nothing when the verdict is committed over unanimous evidence", () => {
    const settled = [
      claim({ id: "a", assertion: "safe", strength: 0.95, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.95, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
    ];
    // The preconditions are ASSERTED, not used as an `if` guard. The plan wrapped
    // this expectation in `if (verdict !== "abstain" && gap < 0.2)`, and on its own
    // fixture that condition was false - so the test asserted nothing at all.
    const r = reasonVerdictOnly(settled, RS);
    expect(r.verdict).not.toBe("abstain");
    expect(r.contested).toBe(false);
    expect(planNextExperiment(settled, RS, ASSAYS, bare)).toBeNull();
  });

  it("recommends an assay when the case abstains, and names the rule it would settle", () => {
    const rec = planNextExperiment(PASS_ONE, RS, ASSAYS, bare);
    expect(rec).not.toBeNull();
    expect(rec!.assay).toBeTruthy();
    expect(rec!.expectedGapReduction).toBeGreaterThan(0);
    expect(rec!.score).toBeGreaterThan(0);
    expect(rec!.rationale.length).toBeGreaterThan(10);
    // The whole point of the mechanism: it must name a rule, not just an assay.
    expect(rec!.resolvesRule).not.toBeNull();
    expect(rec!.rationale).toContain(rec!.resolvesRule!);
  });

  it("ARGUMENT STRUCTURE OUTRANKS RAW VALUE PER COST", () => {
    // The test that separates this planner from a generic value-of-information
    // planner wearing the right label. The plan computed the pivotal rules and then
    // ranked purely on gap reduction per cost, using pivotality only to phrase the
    // rationale - so it would pick `cheap-rodent` here.
    //
    // Two animal claims with unestablished margins: R1 is pivotal (non-human
    // evidence is discounted). One candidate is human but expensive; the other is
    // rodent and almost free, so it wins on score by a wide margin and resolves
    // nothing.
    expect(pivotalRules(PASS_ONE, RS, bare)).toContain("R3");

    const pricey: AssayOperator = {
      ...byId("bsep-inhibition"), id: "pricey-resolver", name: "Pricey resolving assay", cost: 1000,
    };
    const cheap: AssayOperator = {
      ...byId("readacross-refinement"), id: "cheap-nonresolver", name: "Cheap non-resolving assay", cost: 1,
    };
    expect(resolvesRule("R3", pricey)).toBe(true);
    expect(resolvesRule("R3", cheap)).toBe(false);

    const rec = planNextExperiment(PASS_ONE, RS, [pricey, cheap], bare)!;
    expect(rec).not.toBeNull();
    expect(rec.assay).toBe("Pricey resolving assay");
    expect(rec.resolvesRule).toBe("R3");

    // Prove the cheap one really would have won on score alone, so this is a
    // genuine reordering and not an assay that happened to be best anyway.
    const cheapAlone = planNextExperiment(PASS_ONE, RS, [cheap], bare)!;
    const priceyAlone = planNextExperiment(PASS_ONE, RS, [pricey], bare)!;
    expect(cheapAlone.score).toBeGreaterThan(priceyAlone.score);
  });

  it("scores by information gain PER UNIT COST among equals", () => {
    const claims = [claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", strength: 0.5 })];
    const cheap: AssayOperator[] = [{ ...byId("bsep-inhibition"), id: "cheap", cost: 1 }];
    const pricey: AssayOperator[] = [{ ...byId("bsep-inhibition"), id: "pricey", cost: 1000 }];
    const a = planNextExperiment(claims, RS, cheap, bare);
    const b = planNextExperiment(claims, RS, pricey, bare);
    // Unconditional. The plan guarded this with `if (a && b)`, which passes when
    // either is null - including when the planner is broken and returns null always.
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.score).toBeGreaterThan(b!.score);
    // Same assay, same expected gain: only the cost differs, by exactly 1000x.
    expect(a!.expectedGapReduction).toBeCloseTo(b!.expectedGapReduction, 12);
    expect(a!.score / b!.score).toBeCloseTo(1000, 6);
  });

  it("is deterministic across repeated calls and independent of catalogue order", () => {
    const claims = [claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent" })];
    const runs = Array.from({ length: 25 }, () => JSON.stringify(planNextExperiment(claims, RS, ASSAYS, bare)));
    expect(new Set(runs).size).toBe(1);
    // Catalogue order must not decide the answer either.
    const reversed = JSON.stringify(planNextExperiment(claims, RS, [...ASSAYS].reverse(), bare));
    expect(reversed).toBe(runs[0]);
  });

  it("THROWS on an assay operator that would build an invalid claim, rather than mis-weighting it", () => {
    // The carried-forward trap: the schema forbids an in_silico or qsar claim from
    // asserting it MEASURED a key event, because such a claim escapes every
    // discount clause and gets weighted like human clinical evidence. The planner
    // constructs claims itself, so it is exactly the "built outside the validated
    // path" case - it must validate rather than trust the catalogue.
    const bogus: AssayOperator = {
      ...byId("readacross-refinement"),
      id: "bogus-qsar",
      produces: { ...byId("readacross-refinement").produces, measuresKeyEvent: "KE:INVENTED" },
    };
    const claims = [claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent" })];
    expect(() => planNextExperiment(claims, RS, [bogus], bare)).toThrow(/bogus-qsar/);
    expect(() => planNextExperiment(claims, RS, [bogus], bare)).toThrow(/cannot MEASURE/);
  });

  it("degrades HONESTLY to value alone when no single rule is individually pivotal", () => {
    // Measured behaviour worth pinning, because it is a real limitation of defining
    // pivotal as "disabling this one rule changes the verdict". Two animal claims
    // with unestablished margins are discounted by BOTH R1 (x0.1) and R3 (x0.15),
    // and either discount alone is enough to force abstention - so neither rule is
    // individually pivotal and the set comes back empty.
    //
    // The planner must then say so rather than inventing a rule it is resolving.
    const twoAnimals = [
      claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", strength: 0.6 }),
      claim({ id: "p", assertion: "safe", system: "nonrodent", stream: "invivo_nonrodent", strength: 0.6 }),
    ];
    expect(reasonVerdictOnly(twoAnimals, RS).verdict).toBe("abstain");
    expect(pivotalRules(twoAnimals, RS, bare)).toHaveLength(0);

    const rec = planNextExperiment(twoAnimals, RS, ASSAYS, bare)!;
    expect(rec).not.toBeNull();
    expect(rec.resolvesRule).toBeNull();
    expect(rec.rationale).toMatch(/best available on value alone/);
  });

  it("EXCLUDES an assay whose expected result would WIDEN the range", () => {
    // The murine CYP-induction study has a NEGATIVE expected gap reduction on the
    // pass-1 shape: R1 discounts rodent evidence to 10% of its stated strength, so
    // the assay adds little mass while its toxic branch adds conflict, and the
    // range comes out wider than before. Recommending it would be incoherent with
    // the same ruleset's own discounting, so it is filtered out.
    //
    // NOTE FOR TASK 12 AND THE DEMO SCRIPT: spec beat 5 names this exact study as
    // the planner's recommendation. It cannot be, while R1 discounts rodent
    // evidence - the mechanism and the script disagree, and the mechanism is being
    // self-consistent. Flagged in the ledger; not resolved by tuning the catalogue,
    // which would be fitting data to a desired demo outcome.
    const murine = byId("murine-cyp-induction");
    const soloRun = planNextExperiment(PASS_ONE, RS, [murine], bare);
    expect(soloRun).toBeNull();

    const chosen = planNextExperiment(PASS_ONE, RS, ASSAYS, bare)!;
    expect(chosen.assay).not.toBe(murine.name);
    expect(chosen.expectedGapReduction).toBeGreaterThan(0);
  });

  it("returns null when no candidate assay would narrow the gap", () => {
    const claims = [claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent" })];
    expect(planNextExperiment(claims, RS, [], bare)).toBeNull();
  });
});

describe("reason() integration", () => {
  it("populates nextExperiment only when a catalogue is supplied", () => {
    const claims = PASS_ONE;
    expect(reason(claims, RS).nextExperiment).toBeNull();
    const withAssays = reason(claims, RS, "h", ASSAYS);
    expect(withAssays.nextExperiment).not.toBeNull();
    expect(withAssays.nextExperiment!.resolvesRule).not.toBeNull();
    // The extras-free path never runs the planner, whatever is passed.
    expect(reasonVerdictOnly(claims, RS).nextExperiment).toBeNull();
  });

  it("keeps the verdict identical whether or not the planner ran", () => {
    const claims = PASS_ONE;
    const withAssays = reason(claims, RS, "h", ASSAYS);
    const without = reason(claims, RS, "h");
    expect(withAssays.verdict).toBe(without.verdict);
    expect(withAssays.mass).toEqual(without.mass);
    expect(withAssays.trace).toEqual(without.trace);
  });
});
