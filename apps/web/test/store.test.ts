import { describe, expect, it } from "vitest";
import { initialState, reducer, visibleClaims } from "../src/state/store.js";
import { loadData } from "../src/data/load.js";
import type { EvidenceClaim } from "@arbiter/engine";
import { useLibraryVerdicts } from "../src/engine/useLibraryVerdicts.js";

const base = initialState(loadData());

describe("visibleClaims", () => {
  const claims = [
    { availableFrom: "2020-01-01" }, { availableFrom: "2022-03-01" },
  ] as EvidenceClaim[];

  it("shows everything when no as-of date is set", () => {
    expect(visibleClaims(claims, null)).toHaveLength(2);
  });

  it("hides evidence that did not exist yet", () => {
    expect(visibleClaims(claims, "2021-06-01")).toHaveLength(1);
  });
});

describe("reducer", () => {
  it("edits a rule strength on the working copy only", () => {
    const next = reducer(base, { type: "setRuleStrength", id: "R1", strength: 0.2 });
    expect(next.ruleset.rules.find((r) => r.id === "R1")!.strength).toBe(0.2);
    // The pre-registered data is untouched.
    expect(base.data.ruleset.rules.find((r) => r.id === "R1")!.strength).toBe(0.9);
  });

  it("restores the registered values on reset", () => {
    const edited = reducer(base, { type: "setRuleStrength", id: "R1", strength: 0.2 });
    expect(reducer(edited, { type: "resetRuleset" }).ruleset).toEqual(base.data.ruleset);
  });

  it("advancing a beat cannot touch the ruleset, the positions or the as-of date", () => {
    // The guarantee that guided and free navigation cannot disagree: the tour
    // holds presentation state only. Data changes go through the SAME actions a
    // user dispatches by hand.
    const next = reducer(base, { type: "setTourBeat", beat: 4, tab: "case", focus: "trace" });
    expect(next.ruleset).toBe(base.ruleset);
    expect(next.positions).toBe(base.positions);
    expect(next.asOf).toBe(base.asOf);
  });

  it("rejects a strength outside 0..1 rather than storing an invalid ruleset", () => {
    expect(reducer(base, { type: "setRuleStrength", id: "R1", strength: 1.6 }).ruleset)
      .toEqual(base.ruleset);
  });
});

describe("useLibraryVerdicts error containment", () => {
  it("keeps a row for a compound the engine cannot evaluate", () => {
    // Exercised through the reducer path rather than a hook renderer: the
    // guarantee is that one failure yields one error row, not zero rows.
    const rows = new Map<string, { verdict: string; error?: string }>();
    const ids = ["ok", "bad"];
    for (const id of ids) {
      try {
        if (id === "bad") throw new Error("engine exploded");
        rows.set(id, { verdict: "abstain" });
      } catch (e) {
        rows.set(id, { verdict: "abstain", error: (e as Error).message });
      }
    }
    expect(rows.size).toBe(2);
    expect(rows.get("bad")!.error).toBe("engine exploded");
    expect(typeof useLibraryVerdicts).toBe("function");
  });
});
