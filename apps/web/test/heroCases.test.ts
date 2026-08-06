import { reason } from "@arbiter/engine";
import { describe, expect, it } from "vitest";
import { loadData } from "../src/data/load.js";
import { CYCLOSPORINE } from "../src/data/heroCases.js";
import { initialState, workingClaims } from "../src/state/store.js";

describe("hero cases", () => {
  const data = loadData();

  it("registers TAK-994 as a fixture-backed hero case", () => {
    const hero = data.heroCases.get("TAK-994");
    expect(hero).toBeDefined();
    expect(hero!.source).toBe("fixture");
    expect(hero!.displayName).toBe("TAK-994");
    expect(hero!.claims).not.toBeNull();
    expect(hero!.claims!.length).toBe(6);
    expect(hero!.citationStatus).toBe("UNVERIFIED");
  });

  it("boots on a hero case, not on an arbitrary compound", () => {
    expect(data.heroCases.has(initialState(data).selectedCompoundId)).toBe(true);
  });

  // The fall-through is the whole point of the map: a compound that is not a hero
  // case must still resolve, and must resolve to the CORPUS rather than to nothing.
  it("falls through to the corpus for a non-hero compound", () => {
    const id = data.testSplit[0]!;
    expect(data.heroCases.has(id)).toBe(false);
    expect(workingClaims(initialState(data), id)).toEqual(data.claimsByCompound.get(id));
  });

  it("prefers a fixture-backed case's own claims over the corpus copy", () => {
    const state = initialState(data);
    expect(workingClaims(state, "TAK-994")).toBe(data.heroCases.get("TAK-994")!.claims);
  });
});

describe("hero case 2 — Cyclosporine", () => {
  const data = loadData();

  it("is corpus-backed and carries no claims of its own", () => {
    const hero = data.heroCases.get(CYCLOSPORINE)!;
    expect(hero.source).toBe("corpus");
    expect(hero.claims).toBeNull();
    expect(hero.citationStatus).toBeNull();
    expect(hero.asOfMilestones).toEqual({});
  });

  // THE test of this task. The Case tab and the Compounds table are different code
  // paths - useCaseReasoning vs useLibraryVerdicts - and the guarantee is that a
  // corpus-backed hero case cannot make them disagree. Comparing one selector to
  // itself would prove nothing, so both are computed independently here.
  it("shows the same verdict on the Case tab as in the library table", () => {
    const viaCase = reason(
      workingClaims(initialState(data), CYCLOSPORINE),
      data.ruleset, "", data.assays,
    );
    const viaLibrary = reason(
      data.claimsByCompound.get(CYCLOSPORINE)!,
      data.ruleset, "", data.assays,
    );
    expect(viaCase.verdict).toBe(viaLibrary.verdict);
    expect(viaCase.belief).toBe(viaLibrary.belief);
  });

  it("commits, is contested, and carries non-zero conflict mass", () => {
    const r = reason(
      workingClaims(initialState(data), CYCLOSPORINE),
      data.ruleset, "", data.assays,
    );
    expect(r.verdict).toBe("do_not_advance");
    expect(r.belief.toFixed(3)).toBe("0.886");
    expect(r.plausibility.toFixed(3)).toBe("0.985");
    expect(r.contested).toBe(true);
    // Every other rendered case has conflictMass exactly 0.000, TAK-994 included.
    // This is the only one where the number on screen means anything.
    expect(r.conflictMass).toBeGreaterThan(0.1);
    expect(r.conflictMass.toFixed(3)).toBe("0.122");
  });

  it("is in the test split, so it needs no in-sample disclosure", () => {
    expect(data.testSplit).toContain(CYCLOSPORINE);
    expect(data.heroCases.get(CYCLOSPORINE)!.splitDisclosure).toBeNull();
  });
});
