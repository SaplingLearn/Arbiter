import { describe, expect, it } from "vitest";
import { loadData } from "../src/data/load.js";
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
