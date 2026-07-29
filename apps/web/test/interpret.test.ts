import { describe, expect, it } from "vitest";
import { interpret, ProposalSchema, type InterpretInput } from "../src/ai/interpret.js";
import { loadData } from "../src/data/load.js";

const data = loadData();

/**
 * The request shape design section 5 permits: the challenge, the ruleset as
 * (id, enabled, strength), and claim ids and labels ONLY. Building it from the
 * real loaded data rather than from a literal means a change to the fixture that
 * breaks the interpreter breaks this test too.
 */
const input = (challenge: string): InterpretInput => ({
  challenge,
  rules: data.ruleset.rules.map((r) => ({ id: r.id, enabled: r.enabled, strength: r.strength })),
  claims: data.fixture.claims.map((c) => ({ id: c.id, label: c.id })),
});

describe("interpret - which rung answered", () => {
  // Trap 1 of design section 12: asserting "an answer appeared" passes on every
  // rung and is worthless. Every case below asserts `rung` and `source`.

  it("answers at RUNG 2 on an exact cached challenge", async () => {
    const r = await interpret(input("the rat data shouldn't be discounted that hard"));
    expect(r.rung).toBe(2);
    expect(r.source).toBe("cache");
    expect(r.value?.targetRule).toBe("R1");
    expect(r.value?.action).toBe("lower_strength");
  });

  it("still answers at RUNG 2 through case and whitespace differences", async () => {
    // A reviewer typing into a box does not reproduce the authored casing. If
    // normalisation were dropped this falls to rung 3, so the assertion on rung 2
    // is what pins the behaviour - `.value !== null` would pass either way.
    const r = await interpret(input("   The Rat Data Shouldn't Be   Discounted That Hard  "));
    expect(r.rung).toBe(2);
    expect(r.value?.targetRule).toBe("R1");
  });

  it("answers at RUNG 3 on a near-miss above the 0.55 threshold", async () => {
    const r = await interpret(input("the rat data shouldnt be discounted that hard really"));
    expect(r.rung).toBe(3);
    expect(r.source).toBe("cache");
    expect(r.value?.targetRule).toBe("R1");
  });

  it("falls past RUNG 3 to RUNG 4 when nothing clears the threshold", async () => {
    // Same topic as the authored Klimisch challenge, none of its wording. This is
    // the case that would silently pass if rung 3 accepted everything.
    const r = await interpret(input("the reliability scoring is too punitive"));
    expect(r.rung).toBe(4);
    expect(r.source).toBe("local");
    expect(r.value?.targetRule).toBe("R5");
  });

  it("answers at RUNG 4 on a keyword, ALWAYS at low confidence", async () => {
    // Design section 5.2: a low-confidence proposal arrives un-armed. A keyword hit
    // is a guess about which rule is meant, so rung 4 may never present itself as
    // a reading.
    const r = await interpret(input("the murine work deserves more credit than this"));
    expect(r.rung).toBe(4);
    expect(r.value?.targetRule).toBe("R1");
    expect(r.value?.confidence).toBe("low");
  });

  it("reads a disabling phrase at RUNG 4 as disable, not as a strength change", async () => {
    const r = await interpret(input("just turn off the klimisch penalty"));
    expect(r.rung).toBe(4);
    expect(r.value?.targetRule).toBe("R5");
    expect(r.value?.action).toBe("disable");
    expect(r.value?.newValue).toBeNull();
  });

  it("reads a raising phrase at RUNG 4 as raise_strength, on the 0.05 grid", async () => {
    // The Ruleset tab's slider has step="0.05". A proposal off that grid would be
    // un-reproducible by hand, which breaks the parity guarantee Apply rests on.
    const r = await interpret(input("R4 is far too gentle, raise it"));
    expect(r.rung).toBe(4);
    expect(r.value?.action).toBe("raise_strength");
    expect(r.value?.newValue).toBe(0.75);
  });

  it("does NOT let the keyword 'rat' fire on the word 'rate'", async () => {
    // A bare substring match routes a challenge about the discount RATE to R1,
    // which is a wrong rule confidently proposed - the exact failure the confirm
    // panel exists to catch, arriving from our own code.
    const r = await interpret(input("the discount rate is arbitrary"));
    expect(r.rung).toBe(5);
    expect(r.value).toBeNull();
  });

  it("reaches RUNG 5 and reports source 'none' when nothing matches", async () => {
    const r = await interpret(input("what is the weather like in Groton"));
    expect(r.rung).toBe(5);
    expect(r.source).toBe("none");
    expect(r.value).toBeNull();
  });
});

describe("ProposalSchema", () => {
  const valid = {
    targetRule: "R1", targetClaimId: null, action: "lower_strength",
    field: null, newValue: 0.45, paraphrase: "Reduce R1.", confidence: "high",
  };

  it("accepts a well-formed strength proposal", () => {
    expect(ProposalSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses every field outside keyof AssayOperator['produces']", () => {
    // Design section 5.3. `assertion` is choosing the answer rather than testing
    // the reasoning; `strength` is the unregistered knob section 12b says does not
    // exist; `compoundId` and `availableFrom` defeat the cross-compound guard and
    // the hindsight defence. None is a member of AssayOperator["produces"], so all
    // four are excluded by the TYPE - this test proves the schema agrees.
    for (const field of ["assertion", "strength", "compoundId", "id", "availableFrom", "provenance"]) {
      const p = { ...valid, action: "reclassify_field", targetClaimId: "TAK-994:qsar", field, newValue: "x" };
      expect(ProposalSchema.safeParse(p).success).toBe(false);
    }
  });

  it("refuses a strength action whose newValue is not a number in 0..1", () => {
    expect(ProposalSchema.safeParse({ ...valid, newValue: "a lot" }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...valid, newValue: 1.4 }).success).toBe(false);
  });

  it("refuses a reclassify that names no claim, and a disable that carries a value", () => {
    expect(ProposalSchema.safeParse(
      { ...valid, action: "reclassify_field", field: "klimisch", newValue: null },
    ).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...valid, action: "disable", newValue: 0.2 }).success).toBe(false);
  });
});
