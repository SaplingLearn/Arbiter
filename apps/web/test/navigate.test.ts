import { describe, expect, it } from "vitest";
import { isKnownAnchor } from "../src/ai/anchors.js";
import {
  anchorMeta,
  navigate,
  sanitizeNavResult,
  SUGGESTED_QUESTIONS,
  NavResultSchema,
} from "../src/ai/navigate.js";
import anchorMap from "../src/ai/cache/anchor-map.json";
import suggested from "../src/ai/cache/suggested-questions.json";

/**
 * The anchors a caller passes are MATCHING strings, not display strings: rung 4
 * scores the question's tokens against them (spec section 7.1, "keyword match
 * over anchor labels and rule statements"). Supplying them here rather than
 * reading the registry keeps the rung-4 test independent of how Task 2 words a
 * label, while still using ids the registry really has - a fabricated id would
 * be filtered by sanitizeNavResult and the test would prove nothing.
 */
const ANCHOR_LIST = [
  {
    id: "rule.R3",
    label:
      "R3 Exposure relevance A positive finding at clinically relevant exposure defeats a negative finding whose exposure margin is unstated or untested at that range.",
  },
  { id: "trace.beliefTrack", label: "Belief and plausibility track" },
  { id: "validation.llmAblation", label: "LLM ablation" },
];

const ask = (question: string) => navigate({ question, anchors: ANCHOR_LIST });

describe("the navigator ladder", () => {
  it("answers an exact cached question at rung 2, from the cache", async () => {
    // Asserting "it produced an answer" passes on every rung and is worthless
    // (spec section 12, trap 1). The rung and the source are the assertion.
    const r = await ask("Did you tune the rules to fit DILIrank?");
    expect(r.rung).toBe(2);
    expect(r.source).toBe("cache");
    expect(r.value?.anchorIds).toEqual(["ruleset.hash", "validation.provenance"]);
  });

  it("matches punctuation and casing loosely at rung 2 rather than dropping to rung 3", async () => {
    // A judge types "dilirank", not "DILIrank". Normalisation is what keeps the
    // strongest cached answer on the top cached rung.
    const r = await ask("did you tune the rules to fit dilirank");
    expect(r.rung).toBe(2);
    expect(r.value?.anchorIds).toEqual(["ruleset.hash", "validation.provenance"]);
  });

  it("answers a reworded question at rung 3 by trigram similarity", async () => {
    // Rung 3 exists because master spec section 7 gave the navigator no fuzzy
    // step and never said why; spec section 7.1 records the departure. Without
    // it, five extra words would drop this question to keyword matching.
    const r = await ask("Did you tune the rules to fit the DILIrank labels?");
    expect(r.rung).toBe(3);
    expect(r.source).toBe("cache");
    expect(r.value?.anchorIds).toEqual(["ruleset.hash", "validation.provenance"]);
  });

  it("answers an unseen question at rung 4 from the anchor labels alone", async () => {
    // Nothing in the cache is close to this, but R3's registered statement
    // contains four of its content words. Rung 4 is what stops a rephrased
    // question landing on the suggestions.
    const r = await ask("What happens to a negative finding whose exposure margin nobody measured?");
    expect(r.rung).toBe(4);
    expect(r.source).toBe("local");
    expect(r.value?.anchorIds).toEqual(["rule.R3"]);
  });

  it("falls to rung 5 with noMatch when nothing matches at all", async () => {
    const r = await ask("zzz qqq vvv xxx");
    expect(r.rung).toBe(5);
    expect(r.source).toBe("none");
    expect(r.value?.noMatch).toBe(true);
  });

  it("caps a resolution at three anchors, because four destinations is not navigation", async () => {
    const many = sanitizeNavResult({
      anchorIds: ["ruleset.hash", "trace.verdictReason", "trace.beliefTrack", "validation.provenance"],
      noMatch: false,
    });
    expect(many?.anchorIds).toEqual(["ruleset.hash", "trace.verdictReason", "trace.beliefTrack"]);
  });
});

describe("a bad response is not a hallucinated claim, but it is still bad", () => {
  it("drops the ids the registry has never heard of and keeps the ones it has", () => {
    // Spec section 12, trap 2: asserting noMatch on an empty list asserts a
    // value that is 0 under every implementation. Assert the SPECIFIC survivors
    // and the SPECIFIC casualty instead.
    const kept = sanitizeNavResult({
      anchorIds: ["trace.verdictReason", "trace.theModelMadeThisUp", "ruleset.hash"],
      noMatch: false,
    });
    expect(kept?.anchorIds).toEqual(["trace.verdictReason", "ruleset.hash"]);
    expect(kept?.anchorIds).not.toContain("trace.theModelMadeThisUp");
  });

  it("returns null when no id survives, so the ladder descends to the cache", () => {
    // Spec section 7.2 requires the user-visible outcome to be noMatch. Reaching
    // it at rung 5 rather than dead-ending at rung 1 consults the cache on the
    // way, which is exactly when the cache is worth the most.
    expect(sanitizeNavResult({ anchorIds: ["nope.one", "nope.two"], noMatch: false })).toBeNull();
  });

  it("de-duplicates, so the same destination is never offered twice", () => {
    const kept = sanitizeNavResult({ anchorIds: ["rule.R6", "rule.R6", "ruleset.hash"], noMatch: false });
    expect(kept?.anchorIds).toEqual(["rule.R6", "ruleset.hash"]);
  });

  it("accepts a schema-legal response and rejects a shape that carries prose", () => {
    // The return type is the non-hallucination guarantee. A response with a
    // `text` field is not a navigator response, whatever it claims.
    expect(NavResultSchema.safeParse({ anchorIds: ["rule.R6"], noMatch: false }).success).toBe(true);
    expect(NavResultSchema.safeParse({ anchorIds: "rule.R6", noMatch: false }).success).toBe(false);
    expect(NavResultSchema.safeParse({ noMatch: false }).success).toBe(false);
  });
});

describe("the cache is consistent with the registry", () => {
  it("points every cached id at an anchor that exists", () => {
    // Catches an authored entry drifting away from a renamed registry id, which
    // would otherwise degrade silently to the suggestions in front of a judge.
    const all = [...anchorMap, ...suggested];
    const unknown = all.flatMap((e) => e.anchorIds.filter((id) => !isKnownAnchor(id)));
    expect(unknown).toEqual([]);
  });

  it("resolves every cached id to a tab and a region", () => {
    const all = [...anchorMap, ...suggested];
    const unresolved = all.flatMap((e) => e.anchorIds.filter((id) => anchorMeta(id) === null));
    expect(unresolved).toEqual([]);
  });

  it("has no two cached questions that normalise to the same string", () => {
    // A shadowed entry is unreachable and its ids would never be offered.
    const all = [...anchorMap, ...suggested].map((e) =>
      e.question.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(),
    );
    expect(new Set(all).size).toBe(all.length);
  });

  it("offers exactly four suggested questions, each answered from the cache", async () => {
    expect(SUGGESTED_QUESTIONS).toHaveLength(4);
    for (const q of SUGGESTED_QUESTIONS) {
      const r = await ask(q);
      expect(r.rung).toBe(2);
      expect(r.value?.noMatch).toBe(false);
    }
  });
});

describe("dynamic anchor families", () => {
  it("resolves a per-instance id by prefix, never by splitting on the colon", () => {
    // Claim ids contain colons (TAK-994:invivo_rodent), so split(":") would cut
    // the id in half - spec section 8.
    const step = anchorMeta("trace.step:TAK-994:invivo_rodent");
    expect(step?.tab).toBe("case");
    expect(step?.region).toBe("trace");
    expect(step?.label).toContain("TAK-994:invivo_rodent");
  });

  it("returns null for an id in no family and no registry", () => {
    expect(anchorMeta("trace.theModelMadeThisUp")).toBeNull();
  });
});
