import { describe, expect, it } from "vitest";
import { reason, reasonVerdictOnly } from "@arbiter/engine";
import { BEATS } from "../src/tour/beats.js";
import { initialState, reducer, visibleClaims, type AppState } from "../src/state/store.js";
import { loadData } from "../src/data/load.js";
import { majorityVote, weightedAverage } from "../../harness/src/baselines.js";

const data = loadData();

/** Replay the tour from beat 0 up to and including `n`, applying each beat's actions. */
function stateAtBeat(n: number): AppState {
  let s = initialState(data);
  for (const b of BEATS.slice(0, n + 1)) {
    s = reducer(s, { type: "setTourBeat", beat: b.n, tab: b.tab, focus: b.focus });
    for (const a of b.actions) s = reducer(s, a);
  }
  return s;
}

const caseReasoning = (s: AppState) =>
  reason(visibleClaims(data.fixture.claims, s.asOf), s.ruleset, "", data.assays);

describe("the seven beats", () => {
  it("has exactly seven, indexed 0..6", () => {
    expect(BEATS).toHaveLength(7);
    expect(BEATS.map((b) => b.n)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("BEAT 2 - every baseline says advance on the pre-first-in-human evidence", () => {
    const s = stateAtBeat(1);
    const claims = visibleClaims(data.fixture.claims, s.asOf);
    expect(majorityVote(claims).verdict).toBe("advance");
    expect(weightedAverage(claims).verdict).toBe("advance");
  });

  it("BEAT 3 - ARBITER abstains, nothing is defeated, most mass is uncommitted", () => {
    const r = caseReasoning(stateAtBeat(2));
    expect(r.verdict).toBe("abstain");
    expect(r.trace.filter((t) => t.status === "defeated")).toHaveLength(0);
    expect(r.mass.uncommitted).toBeGreaterThan(0.7);
  });

  it("BEAT 4 - the gap is wide and a single-claim counterfactual exists", () => {
    const r = caseReasoning(stateAtBeat(3));
    expect(r.plausibility - r.belief).toBeGreaterThan(0.5);
    expect(r.counterfactual).not.toBeNull();
    expect(r.counterfactual!.flips).toHaveLength(1);
  });

  it("BEAT 5 - the planner names a HUMAN assay and pass 2 STILL abstains", () => {
    // The beat that was wrong. R1 discounts the murine study to 10%, so feeding it
    // in moves belief off zero without licensing a conclusion. If this test ever
    // starts expecting do_not_advance, either the ruleset was re-registered or the
    // script drifted back to the version the engine contradicts.
    const before = caseReasoning(stateAtBeat(3));
    const after = caseReasoning(stateAtBeat(4));

    expect(before.nextExperiment).not.toBeNull();
    expect(before.nextExperiment!.assay).toMatch(/BSEP/i);
    expect(before.nextExperiment!.resolvesRule).toBe("R3");

    expect(after.verdict).toBe("abstain");
    expect(after.belief).toBeGreaterThan(before.belief);
    expect(after.belief).toBeLessThan(0.5);
  });

  it("BEAT 7 - the reported coverage is on screen in the metrics we ship", () => {
    const m = data.metrics;
    expect(m.metric1_conflictSubsetAccuracy.arbiter.coverage).toBeLessThan(0.25);
    expect(m.metric5_plannerSensitivity.meanUnchangedFraction).toBeGreaterThan(0.9);
  });

  it("every beat names a real tab and a real focus region", () => {
    for (const b of BEATS) {
      expect(["compounds", "case", "ruleset", "validation", "record"]).toContain(b.tab);
      if (b.focus !== null) expect(["evidence", "trace", "table"]).toContain(b.focus);
      expect(b.line.length).toBeGreaterThan(10);
    }
  });

  it("replaying the tour twice gives the identical state", () => {
    expect(JSON.stringify(stateAtBeat(6).asOf)).toBe(JSON.stringify(stateAtBeat(6).asOf));
    expect(reasonVerdictOnly(visibleClaims(data.fixture.claims, stateAtBeat(6).asOf), data.ruleset).verdict)
      .toBe(reasonVerdictOnly(visibleClaims(data.fixture.claims, stateAtBeat(6).asOf), data.ruleset).verdict);
  });
});
