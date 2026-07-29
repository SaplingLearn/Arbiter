import { describe, expect, it } from "vitest";
import { FUZZY_THRESHOLD, jaccard, trigrams } from "../src/ai/trigram.js";

// Drawn from the authored challenge set and the prepared Q&A (spec sections 12b
// and 13): the exposure-margin objection, the species-weighting objection, the
// Klimisch-on-QSAR category error, and a precedence QUESTION - which belongs in
// the navigator's anchor map, not the challenge cache (spec section 13). These are
// the strings rung 3 actually matches against, so they are the strings the
// threshold has to be calibrated on.
const MARGIN = "A margin over 100x should count as exposure relevant";
const MARGIN_REPHRASED = "The margin is over 100x, so this should count as exposure relevant";
const SPECIES = "The rat study should not outweigh the human hepatocyte data";
const SPECIES_REPHRASED = "The rat study shouldn't outweigh the human hepatocyte data";
const KLIMISCH = "A Klimisch score on a QSAR claim is a category error";
const PRECEDENCE = "Why does R3 outrank R1 in the precedence order?";

describe("trigrams", () => {
  it("pads so the first and last words carry boundary trigrams", () => {
    expect([...trigrams("rat")]).toEqual([" ra", "rat", "at "]);
  });

  it("folds case and punctuation, so a trailing question mark costs nothing", () => {
    expect([...trigrams("Rat!")]).toEqual([...trigrams("rat")]);
  });

  it("returns nothing for an input too short to hold a trigram", () => {
    expect(trigrams("").size).toBe(0);
  });
});

describe("jaccard against FUZZY_THRESHOLD", () => {
  it("uses the threshold spec sections 5.1 and 7.1 registered", () => {
    expect(FUZZY_THRESHOLD).toBe(0.55);
  });

  it("scores a contraction rewording of the species objection at 0.850, above the threshold", () => {
    // "should not" against "shouldn't" shares no word and almost every trigram.
    // This is the rewording rung 3 exists for.
    const s = jaccard(SPECIES, SPECIES_REPHRASED);
    expect(s).toBeCloseTo(0.85, 3);
    expect(s).toBeGreaterThan(FUZZY_THRESHOLD);
  });

  it("scores a clause-order rewording of the margin objection at 0.738, above the threshold", () => {
    const s = jaccard(MARGIN, MARGIN_REPHRASED);
    expect(s).toBeCloseTo(0.7385, 3);
    expect(s).toBeGreaterThan(FUZZY_THRESHOLD);
  });

  it("scores two genuinely different challenges at 0.020, far below the threshold", () => {
    // Spec section 5.2: two authored challenges sitting one bad trigram match apart is
    // the failure that flips the position on the hero case. The margin objection
    // and the Klimisch category error must not be near each other.
    const s = jaccard(MARGIN, KLIMISCH);
    expect(s).toBeCloseTo(0.0202, 3);
    expect(s).toBeLessThan(FUZZY_THRESHOLD);
  });

  it("scores a challenge against a navigator QUESTION at 0.052, far below the threshold", () => {
    // The two caches are for different things (spec section 13). A question leaking
    // into the challenge ladder would have to invent a rule edit to justify itself.
    const s = jaccard(SPECIES, PRECEDENCE);
    expect(s).toBeCloseTo(0.0515, 3);
    expect(s).toBeLessThan(FUZZY_THRESHOLD);
  });

  it("is symmetric and scores a string against itself at 1", () => {
    expect(jaccard(MARGIN, SPECIES)).toBe(jaccard(SPECIES, MARGIN));
    expect(jaccard(MARGIN, MARGIN)).toBe(1);
  });

  it("scores an empty challenge at 0 against every cached entry", () => {
    // 0/0 resolved to 0, not 1. At 1 an empty box would match the first cached
    // entry at rung 3 and propose a rule change out of nothing.
    expect(jaccard("", MARGIN)).toBe(0);
    expect(jaccard("", "")).toBe(0);
  });
});
