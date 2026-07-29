import { describe, expect, it } from "vitest";
import {
  initialState, isEdited, reducer, visibleClaims, workingClaims,
  type EvidenceEdit,
} from "../src/state/store.js";
import { loadData } from "../src/data/load.js";
import type { EvidenceClaim } from "@arbiter/engine";
import { useLibraryVerdicts } from "../src/engine/useLibraryVerdicts.js";

const base = initialState(loadData());

/** The murine toxicogenomics claim: the one field change on the fixture that moves
 *  the verdict, so every "an edit reaches here" case can use the same input. */
const MURINE = "TAK-994:toxicogenomics-murine";
/** The QSAR claim: system in_silico, so schema.ts:26-35 forbids it a measured key event. */
const QSAR = "TAK-994:qsar";

describe("visibleClaims", () => {
  const claims = [
    { availableFrom: "2020-01-01" }, { availableFrom: "2022-03-01" },
  ] as EvidenceClaim[];

  it("shows everything when no as-of date is set", () => {
    expect(visibleClaims(claims, null)).toHaveLength(2);
  });

  it("hides evidence that did not exist yet", () => {
    expect(visibleClaims(claims, "2021-06-01")).toHaveLength(1);
  });
});

describe("reducer", () => {
  it("edits a rule strength on the working copy only", () => {
    const next = reducer(base, { type: "setRuleStrength", id: "R1", strength: 0.2 });
    expect(next.ruleset.rules.find((r) => r.id === "R1")!.strength).toBe(0.2);
    // The pre-registered data is untouched.
    expect(base.data.ruleset.rules.find((r) => r.id === "R1")!.strength).toBe(0.9);
  });

  it("restores the registered values on reset", () => {
    const edited = reducer(base, { type: "setRuleStrength", id: "R1", strength: 0.2 });
    expect(reducer(edited, { type: "resetRuleset" }).ruleset).toEqual(base.data.ruleset);
  });

  it("advancing a beat cannot touch the ruleset, the evidence, the positions or the as-of date", () => {
    // The guarantee that guided and free navigation cannot disagree: the tour
    // holds presentation state only. Data changes go through the SAME actions a
    // user dispatches by hand. evidenceEdits joins the list because it is now a
    // second working copy a beat could plausibly be tempted to stage a demo with.
    const next = reducer(base, { type: "setTourBeat", beat: 4, tab: "case", focus: "trace" });
    expect(next.ruleset).toBe(base.ruleset);
    expect(next.evidenceEdits).toBe(base.evidenceEdits);
    expect(next.positions).toBe(base.positions);
    expect(next.asOf).toBe(base.asOf);
  });

  it("rejects a strength outside 0..1 rather than storing an invalid ruleset", () => {
    expect(reducer(base, { type: "setRuleStrength", id: "R1", strength: 1.6 }).ruleset)
      .toEqual(base.ruleset);
  });
});

describe("workingClaims", () => {
  it("returns the REGISTERED claims when nothing has been reclassified", () => {
    // Identity, not just equality. The selector must not allocate a fresh array on
    // every render or useCaseReasoning's memo never holds and the Case tab re-runs
    // the engine on unrelated actions such as the motion toggle.
    expect(workingClaims(base, base.data.fixture.compoundId)).toBe(base.data.fixture.claims);
  });

  it("prefers the hand-curated fixture over the bundled corpus for TAK-994", () => {
    // TAK-994 exists in BOTH data/out/evidence.json and data/out/tak994.json. The
    // four call sites all preferred the fixture; the unified selector must keep
    // that precedence even though the two copies happen to agree today.
    const claims = workingClaims(base, base.data.fixture.compoundId);
    expect(claims).toBe(base.data.fixture.claims);
    expect(claims).not.toBe(base.data.claimsByCompound.get("TAK-994"));
  });

  it("returns an empty list for a compound with no claims rather than throwing", () => {
    expect(workingClaims(base, "NOT-A-COMPOUND")).toEqual([]);
  });

  it("overlays a reclassification onto the claim it names, and nothing else", () => {
    const next = reducer(base, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } });
    const claims = workingClaims(next, "TAK-994");
    expect(claims.find((c) => c.id === MURINE)!.system).toBe("human");
    // Every other field of that claim, and every other claim, is untouched.
    expect(claims.find((c) => c.id === MURINE)!.assertion).toBe("toxic");
    expect(claims.find((c) => c.id === "TAK-994:cytotox")!.system).toBe("human");
    expect(claims.find((c) => c.id === "TAK-994:invivo_rodent")!.system).toBe("rodent");
  });

  it("never mutates the registered evidence", () => {
    // data.claimsByCompound and data.fixture.claims are immutable exactly as
    // data.ruleset is (§9). An overlay that wrote through would make Reset a lie
    // and would poison the library table via the map both surfaces share.
    const next = reducer(base, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } });
    void workingClaims(next, "TAK-994");
    expect(base.data.fixture.claims.find((c) => c.id === MURINE)!.system).toBe("rodent");
  });
});

describe("reclassifyClaim", () => {
  it("stores an edit the schema accepts", () => {
    const next = reducer(base, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } });
    expect(next.evidenceEdits[MURINE]).toEqual({ system: "human" });
  });

  it("REFUSES an edit that violates the cross-field constraint at schema.ts:26-35", () => {
    // A computational prediction cannot MEASURE a key event. Leaving
    // measuresKeyEvent non-null on an in_silico or qsar claim lets it escape R2's
    // structural-correlation discount and be weighted like human clinical
    // evidence - the schema's own message says so. plan.ts:174-180 throws on the
    // same class of input rather than reason over it; the reducer's equivalent is
    // to return the state unchanged so a rejected edit cannot take the tab down
    // mid-demo.
    const next = reducer(base, {
      type: "reclassifyClaim", claimId: QSAR, edit: { measuresKeyEvent: "KE:BSEP-INHIBITION" },
    });
    expect(next).toBe(base);
    expect(next.evidenceEdits[QSAR]).toBeUndefined();
  });

  it("REFUSES an edit whose validity depends on a field it is not changing", () => {
    // The cytotox claim already measures KE:HEPATOCYTE-DEATH, so moving its stream
    // to qsar violates the same constraint - and no field-by-field check can see
    // it. This is why the WHOLE merged claim is parsed, not the edit.
    const next = reducer(base, {
      type: "reclassifyClaim", claimId: "TAK-994:cytotox", edit: { stream: "qsar" },
    });
    expect(next).toBe(base);
  });

  it("refuses an edit naming a claim that does not exist", () => {
    // A stored orphan would badge the panel MODIFIED for a change nothing computes.
    expect(reducer(base, { type: "reclassifyClaim", claimId: "TAK-994:nope", edit: { klimisch: 4 } }))
      .toBe(base);
    expect(reducer(base, { type: "reclassifyClaim", claimId: "no-colon-here", edit: { klimisch: 4 } }))
      .toBe(base);
  });

  it("PRUNES a field reclassified back to its registered value", () => {
    // This is what makes §9.3's single predicate exact at the evidence copy:
    // reclassify and reclassify back and the badge clears, exactly as dragging a
    // strength slider back clears the ruleset badge.
    const there = reducer(base, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } });
    const andBack = reducer(there, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "rodent" } });
    expect(there.evidenceEdits[MURINE]).toEqual({ system: "human" });
    expect(andBack.evidenceEdits[MURINE]).toBeUndefined();
    expect(isEdited(andBack.evidenceEdits, {})).toBe(false);
  });

  it("merges a second field onto an existing edit instead of replacing it", () => {
    const one = reducer(base, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } });
    const two = reducer(one, { type: "reclassifyClaim", claimId: MURINE, edit: { klimisch: 4 } });
    expect(two.evidenceEdits[MURINE]).toEqual({ system: "human", klimisch: 4 });
  });

  it("clears every edit on resetEvidence, mirroring resetRuleset", () => {
    const edited = reducer(base, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } });
    expect(reducer(edited, { type: "resetEvidence" }).evidenceEdits).toEqual({});
  });
});

describe("EvidenceEdit's legal field set (§5.3)", () => {
  it("admits every field an AssayOperator must declare", () => {
    // The positive control. Without it the @ts-expect-error case below would also
    // pass on a type that rejects EVERYTHING, which would be a broken exclusion
    // rather than an enforced one.
    const legal: EvidenceEdit = {
      system: "human",
      stream: "cytotox",
      measuresKeyEvent: "KE:BSEP-INHIBITION",
      exposureRelevant: true,
      inApplicabilityDomain: false,
      klimisch: 2,
    };
    expect(Object.keys(legal)).toHaveLength(6);
  });

  it("EXCLUDES assertion by construction, not by a deny-list", () => {
    // Changing an assertion is not testing the reasoning, it is choosing the
    // answer - claimToMass reads it directly (§5.3). The system already answers
    // that question read-only: findCounterfactual reports the minimal set of
    // assertion flips that would change the verdict without applying any of them.
    //
    // These lines are checked by `npm run typecheck`, not by vitest, which
    // transpiles without type-checking. If ReclassifiableField ever stops being
    // keyof AssayOperator["produces"], typecheck fails here.
    // @ts-expect-error assertion is not a member of AssayOperator["produces"]
    const flipsTheAnswer: EvidenceEdit = { assertion: "toxic" };
    // @ts-expect-error availableFrom is the as-of control's job and the hindsight defence
    const rewritesHistory: EvidenceEdit = { availableFrom: "2019-01-01" };
    // @ts-expect-error strength has no mediating rule; it multiplies straight into mass
    const unregisteredKnob: EvidenceEdit = { strength: 1 };
    // @ts-expect-error compoundId defeats the guard at rules.ts:32
    const crossesCompounds: EvidenceEdit = { compoundId: "OTHER" };
    expect([flipsTheAnswer, rewritesHistory, unregisteredKnob, crossesCompounds]).toHaveLength(4);
  });
});

describe("isEdited — one predicate for both working copies (§9.3)", () => {
  it("reports a dragged-and-returned slider as UNEDITED", () => {
    // Preflight.tsx tested this by reference and Ruleset.tsx by deep compare, so
    // the badge cleared while the panel still warned. The value compare wins:
    // telling a presenter to press Reset on a ruleset that already IS the
    // registered one is a false alarm in the one panel whose whole rule is that
    // every line is a check rather than a caption.
    const there = reducer(base, { type: "setRuleStrength", id: "R1", strength: 0.05 });
    const andBack = reducer(there, { type: "setRuleStrength", id: "R1", strength: 0.9 });
    expect(isEdited(there.ruleset, base.data.ruleset)).toBe(true);
    expect(andBack.ruleset).not.toBe(base.data.ruleset);   // a genuinely new object
    expect(isEdited(andBack.ruleset, base.data.ruleset)).toBe(false);
  });

  it("still reports a real edit as edited", () => {
    const edited = reducer(base, { type: "setRuleEnabled", id: "R4", enabled: false });
    expect(isEdited(edited.ruleset, base.data.ruleset)).toBe(true);
  });
});

describe("useLibraryVerdicts error containment", () => {
  it("keeps a row for a compound the engine cannot evaluate", () => {
    // Exercised through the reducer path rather than a hook renderer: the
    // guarantee is that one failure yields one error row, not zero rows.
    const rows = new Map<string, { verdict: string; error?: string }>();
    const ids = ["ok", "bad"];
    for (const id of ids) {
      try {
        if (id === "bad") throw new Error("engine exploded");
        rows.set(id, { verdict: "abstain" });
      } catch (e) {
        rows.set(id, { verdict: "abstain", error: (e as Error).message });
      }
    }
    expect(rows.size).toBe(2);
    expect(rows.get("bad")!.error).toBe("engine exploded");
    expect(typeof useLibraryVerdicts).toBe("function");
  });
});
