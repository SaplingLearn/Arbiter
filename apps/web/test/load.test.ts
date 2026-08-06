import { describe, expect, it } from "vitest";
import { loadData } from "../src/data/load.js";

describe("loadData", () => {
  const d = loadData();

  it("indexes every claim under its compound", () => {
    const total = [...d.claimsByCompound.values()].reduce((s, v) => s + v.length, 0);
    expect(total).toBeGreaterThan(1000);
    expect(d.claimsByCompound.size).toBeGreaterThan(800);
  });

  it("carries the pre-registered ruleset, unmodified", () => {
    expect(d.ruleset.version).toBe("1.0");
    expect(d.ruleset.rules).toHaveLength(6);
  });

  it("knows which compounds are the reportable test split", () => {
    expect(d.testSplit).toHaveLength(267);
    for (const id of d.testSplit) expect(d.compounds.has(id)).toBe(true);
  });

  it("excludes the TAK-994 fixture from the benchmark compounds", () => {
    // The fixture is the motivating case, not evidence. If it ever appears as a
    // scored row, every reported number is contaminated.
    expect(d.compounds.has("TAK-994")).toBe(false);
    expect(d.heroCases.get("TAK-994")!.claims!.length).toBeGreaterThan(0);
  });

  it("loads the verdict manifest as a cross-check", () => {
    expect(d.manifest.size).toBe(267);
  });

  it("has an assay catalogue with elicited priors and result strengths", () => {
    expect(d.assays.length).toBeGreaterThan(0);
    for (const a of d.assays) {
      expect(a.priorToxic).toBeGreaterThan(0);
      expect(a.resultStrength).toBeGreaterThan(0);
    }
  });
});
