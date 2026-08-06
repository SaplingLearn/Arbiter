import { describe, expect, it } from "vitest";
import { assertExposureBacked, DataLoadError, loadData } from "../src/data/load.js";
import type { HeroCase } from "../src/data/heroCases.js";
import type { EvidenceClaim } from "@arbiter/engine";

const claim = (over: Partial<EvidenceClaim>): EvidenceClaim => ({
  id: "X:cytotox", compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.9,
  system: "human", measuresKeyEvent: "KE:HEPATOCYTE-DEATH", exposureRelevant: false,
  inApplicabilityDomain: true, klimisch: 1, availableFrom: "2020-01-01",
  provenance: { kind: "literature", source: "test", retrieved: "2026-08-05" },
  ...over,
} as EvidenceClaim);

const hero = (over: Partial<HeroCase>): HeroCase => ({
  compoundId: "X", displayName: "X", source: "fixture", subtitle: "",
  claims: [], asOfMilestones: {}, citationStatus: "UNVERIFIED",
  splitDisclosure: null, exposure: null, ...over,
});

describe("the exposure gate", () => {
  it("refuses a safe claim asserting exposure relevance with no cited Cmax", () => {
    const h = hero({ claims: [claim({ exposureRelevant: true })] });
    expect(() => assertExposureBacked(h)).toThrow(DataLoadError);
    // The failure must name the claim, not just complain.
    expect(() => assertExposureBacked(h)).toThrow(/X:cytotox/);
  });

  it("accepts it once a cited Cmax is present", () => {
    const h = hero({
      claims: [claim({ exposureRelevant: true })],
      exposure: { cmax: 120, basis: "free", citation: "a real source" },
    });
    expect(() => assertExposureBacked(h)).not.toThrow();
  });

  // The gate is written against SAFE claims specifically. TAK-994's murine claim is
  // the corpus's only exposureRelevant: true and it is TOXIC - a positive finding at
  // a clinically relevant dose needs no exposure margin to be defensible, which is
  // what R3 says. Widening the gate to every assertion would break the one fixture
  // that already exists.
  it("leaves a toxic exposure-relevant claim alone", () => {
    const h = hero({ claims: [claim({ assertion: "toxic", exposureRelevant: true })] });
    expect(() => assertExposureBacked(h)).not.toThrow();
  });

  it("ignores corpus-backed cases, which author nothing", () => {
    expect(() => assertExposureBacked(hero({ source: "corpus", claims: null }))).not.toThrow();
  });

  // Isolates the `hero.source !== "fixture"` clause. The sibling test above sets
  // `source: "corpus"` AND `claims: null` together, so either clause alone would
  // make it pass - it cannot tell which one is load-bearing. Here `claims` carries
  // a safe, exposureRelevant claim that WOULD trip the gate on a fixture-backed
  // case, so only the source check can be why this does not throw.
  it("ignores a corpus-backed case even when it carries a claim that would trip the gate", () => {
    const h = hero({ source: "corpus", claims: [claim({ exposureRelevant: true })] });
    expect(() => assertExposureBacked(h)).not.toThrow();
  });

  it("loads the shipped data with TAK-994's murine claim intact", () => {
    const data = loadData();
    const murine = data.heroCases.get("TAK-994")!.claims!
      .find((c) => c.id === "TAK-994:toxicogenomics-murine")!;
    expect(murine.exposureRelevant).toBe(true);
    expect(murine.assertion).toBe("toxic");
  });
});
