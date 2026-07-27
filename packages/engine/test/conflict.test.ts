import { describe, expect, it } from "vitest";
import { detectConflict } from "../src/conflict.js";
import type { EvidenceClaim } from "../src/types.js";

function claim(id: string, assertion: EvidenceClaim["assertion"], stream: EvidenceClaim["stream"]): EvidenceClaim {
  return {
    id, compoundId: "X", stream, assertion, strength: 0.8, system: "human",
    measuresKeyEvent: null, exposureRelevant: null, inApplicabilityDomain: true,
    klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
  };
}

describe("detectConflict", () => {
  it("is a conflict only when two DIFFERENT streams commit to opposite verdicts", () => {
    const r = detectConflict([claim("a", "toxic", "cytotox"), claim("b", "safe", "transporter")]);
    expect(r.conflicting).toBe(true);
    expect(r.opposedStreams.sort()).toEqual(["cytotox", "transporter"]);
  });

  it("is not a conflict within a single stream", () => {
    expect(detectConflict([claim("a", "toxic", "cytotox"), claim("b", "safe", "cytotox")]).conflicting).toBe(false);
  });

  it("ignores ambiguous claims", () => {
    expect(detectConflict([claim("a", "toxic", "cytotox"), claim("b", "ambiguous", "qsar")]).conflicting).toBe(false);
  });

  it("is not a conflict when all streams agree", () => {
    expect(detectConflict([claim("a", "toxic", "cytotox"), claim("b", "toxic", "qsar")]).conflicting).toBe(false);
  });
});
