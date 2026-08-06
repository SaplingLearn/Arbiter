import { createElement } from "react";
import { act, renderHook } from "@testing-library/react";
import { reason } from "@arbiter/engine";
import { describe, expect, it } from "vitest";
import { loadData } from "../src/data/load.js";
import { CYCLOSPORINE } from "../src/data/heroCases.js";
import { initialState, StoreProvider, useDispatch, workingClaims } from "../src/state/store.js";
import { useCaseReasoning } from "../src/engine/useCaseReasoning.js";
import { useLibraryVerdicts } from "../src/engine/useLibraryVerdicts.js";

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
  // itself would prove nothing: because Cyclosporine carries `claims: null`,
  // `workingClaims(...)` resolves to the SAME array reference as
  // `data.claimsByCompound.get(...)`, so two direct `reason()` calls on those two
  // expressions guard only that evidence-source fallback, not the two hooks. A
  // regression inside `useLibraryVerdicts` (say, switching it to `workingClaims`,
  // which would let one compound's evidence edit move a corpus statistic) would be
  // invisible to that comparison. Routed instead through the REAL hooks, sharing
  // one store, with a real `selectCompound` dispatch switching the Case tab onto
  // Cyclosporine - not two calls to the same selector (design spec §11, test 2).
  it("shows the same verdict on the Case tab as in the library table", () => {
    function useBoth() {
      return { dispatch: useDispatch(), caseReasoning: useCaseReasoning(), library: useLibraryVerdicts() };
    }
    const { result } = renderHook(() => useBoth(), {
      wrapper: ({ children }) => createElement(StoreProvider, { data, children }),
    });

    act(() => result.current.dispatch({ type: "selectCompound", compoundId: CYCLOSPORINE }));

    expect(result.current.caseReasoning.verdict).toBe(result.current.library.get(CYCLOSPORINE)!.verdict);
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
