import { describe, expect, it } from "vitest";
import { DEFAULT_RUNS, pickMajority, runsFrom } from "../consensus.js";
import type { ConsequenceVerdict } from "../adjudicate.js";

const V = (s: string): ConsequenceVerdict => s as ConsequenceVerdict;

/**
 * The regression this exists for: the verdict is NOT deterministic at temperature 0.
 * Turalio returned do_not_advance three times and cannot_conclude twice on identical
 * input. These tests fix the two decisions that turns into - which answer wins, and what
 * happens when nothing does.
 */
describe("pickMajority", () => {
  it("takes the verdict most runs returned", () => {
    expect(pickMajority([V("do_not_advance"), V("do_not_advance"), V("cannot_conclude")]))
      .toEqual({ verdict: "do_not_advance", votes: 2 });
  });

  it("reports a unanimous vote as unanimous", () => {
    expect(pickMajority([V("advance"), V("advance"), V("advance")]))
      .toEqual({ verdict: "advance", votes: 3 });
  });

  it("handles a single run", () => {
    expect(pickMajority([V("cannot_conclude")])).toEqual({ verdict: "cannot_conclude", votes: 1 });
  });

  /**
   * The decision that matters most. A tie means the evidence did not compel one reading,
   * and reaching for the cheerful option on a coin toss is the failure this whole surface
   * exists to prevent.
   */
  it("breaks a tie toward the MORE CAUTIOUS verdict, never toward advance", () => {
    expect(pickMajority([V("advance"), V("do_not_advance")]).verdict).toBe("do_not_advance");
    expect(pickMajority([V("advance"), V("cannot_conclude")]).verdict).toBe("cannot_conclude");
    expect(pickMajority([V("do_not_advance"), V("cannot_conclude")]).verdict).toBe("cannot_conclude");
  });

  it("breaks a three-way tie the same way", () => {
    expect(pickMajority([V("advance"), V("do_not_advance"), V("cannot_conclude")]).verdict)
      .toBe("cannot_conclude");
  });

  it("still prefers a real majority over caution", () => {
    // Caution orders ties; it must not override a verdict that actually won.
    expect(pickMajority([V("advance"), V("advance"), V("cannot_conclude")]))
      .toEqual({ verdict: "advance", votes: 2 });
  });
});

describe("runsFrom", () => {
  it("defaults when unset", () => {
    expect(runsFrom({})).toBe(DEFAULT_RUNS);
    expect(runsFrom({ ARBITER_ADJUDICATION_RUNS: "" })).toBe(DEFAULT_RUNS);
  });

  it("takes a deployment's own number", () => {
    expect(runsFrom({ ARBITER_ADJUDICATION_RUNS: "5" })).toBe(5);
  });

  /** A malformed value must not make the loop run zero times and return nothing. */
  it("falls back rather than to NaN or zero", () => {
    for (const bad of ["lots", "0", "-3", "NaN"]) {
      expect(runsFrom({ ARBITER_ADJUDICATION_RUNS: bad }), bad).toBe(DEFAULT_RUNS);
    }
  });

  it("caps the runs, because this is paid per call", () => {
    expect(runsFrom({ ARBITER_ADJUDICATION_RUNS: "500" })).toBe(9);
  });
});
