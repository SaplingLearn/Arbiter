import { describe, expect, it } from "vitest";
import { reason } from "@arbiter/engine";
import { buildBeats } from "../src/tour/beats.js";
import { CYCLOSPORINE } from "../src/data/heroCases.js";
import { initialState, reducer, visibleClaims, type AppState } from "../src/state/store.js";
import { loadData } from "../src/data/load.js";
import { majorityVote, weightedAverage } from "../../harness/src/baselines.js";

const data = loadData();
const beats = buildBeats(data);

/** Replay the tour from beat 0 up to and including `n`, applying each beat's actions. */
function stateAtBeat(n: number): AppState {
  let s = initialState(data);
  for (const b of beats.slice(0, n + 1)) {
    s = reducer(s, { type: "setTourBeat", beat: b.n, tab: b.tab, focus: b.focus });
    for (const a of b.actions) s = reducer(s, a);
  }
  return s;
}

const caseReasoning = (s: AppState) =>
  reason(visibleClaims(data.heroCases.get("TAK-994")!.claims!, s.asOf), s.ruleset, "", data.assays);

describe("the eight beats", () => {
  it("has exactly eight, indexed 0..7", () => {
    expect(beats).toHaveLength(8);
    expect(beats.map((b) => b.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("BEAT 2 - every baseline says advance on the pre-first-in-human evidence", () => {
    const s = stateAtBeat(1);
    const claims = visibleClaims(data.heroCases.get("TAK-994")!.claims!, s.asOf);
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

  it("BEAT 8 - the reported coverage is on screen in the metrics we ship", () => {
    const m = data.metrics;
    expect(m.metric1_conflictSubsetAccuracy.arbiter.coverage).toBeLessThan(0.25);
    expect(m.metric5_plannerSensitivity.meanUnchangedFraction).toBeGreaterThan(0.9);
  });

  it("every beat names a real tab and a real focus region", () => {
    for (const b of beats) {
      expect(["compounds", "case", "ruleset", "validation", "record"]).toContain(b.tab);
      if (b.focus !== null) expect(["evidence", "trace", "table"]).toContain(b.focus);
      expect(b.line.length).toBeGreaterThan(10);
    }
  });

  it("BEAT 1 - reads the conflict count off the metrics document, not a literal", () => {
    // Asserting the line CONTAINS "61 of 267" would pass on the hard-coded string
    // this replaced, which is the HANDOVER section 5.1 trap: a test that reads the
    // same on both branches. Building the beats from a DIFFERENT metrics document is
    // what separates a derived line from a typed one - a literal cannot follow.
    const elsewhere: typeof data = {
      ...data,
      metrics: {
        ...data.metrics,
        sampleSizes: { ...data.metrics.sampleSizes, scored: 999, conflictSubset: 42 },
      },
    };
    expect(buildBeats(elsewhere)[0]!.line).toContain("42 of 999");

    // And on the real document it agrees with what the harness measured, so the
    // opening line of the demo cannot drift from the Compounds tab beside it.
    const m = data.metrics.sampleSizes;
    expect(beats[0]!.line).toContain(`${m.conflictSubset} of ${m.scored}`);
  });
});

describe("beats carry a compound", () => {
  const data = loadData();
  const beats = buildBeats(data);

  it("reads its as-of dates from the hero case, not from module literals", () => {
    const milestones = Object.values(data.heroCases.get("TAK-994")!.asOfMilestones);
    const asOfActions = beats
      .flatMap((b) => b.actions)
      .filter((a): a is { type: "setAsOf"; asOf: string | null } => a.type === "setAsOf")
      .map((a) => a.asOf)
      .filter((d): d is string => d !== null);
    expect(asOfActions.length).toBeGreaterThan(0);
    for (const d of asOfActions) expect(milestones).toContain(d);
  });

  it("has one beat that selects the second hero case", () => {
    const contrast = beats.filter((b) => b.compoundId === CYCLOSPORINE);
    expect(contrast).toHaveLength(1);
    expect(contrast[0]!.tab).toBe("case");
  });

  it("puts the contrast beat before the validation beat", () => {
    const contrast = beats.findIndex((b) => b.compoundId === CYCLOSPORINE);
    const validation = beats.findIndex((b) => b.tab === "validation");
    // Coverage is named as the finding on the validation tab. An audience that has
    // just watched the engine commit hears "it abstains on 97%" as a calibration
    // claim rather than an admission.
    expect(contrast).toBeGreaterThan(-1);
    expect(contrast).toBeLessThan(validation);
  });

  it("names a compound on every beat, so none inherits one", () => {
    for (const b of beats) expect(data.heroCases.has(b.compoundId)).toBe(true);
  });

  // The defect that made compoundId required rather than optional: with only the
  // contrast beat naming one, stepping BACKWARD off it left Cyclosporine selected
  // while the record beat narrated TAK-994.
  it("restores the first hero case when stepping back off the contrast beat", () => {
    const contrast = beats.findIndex((b) => b.compoundId === CYCLOSPORINE);
    let state = reducer(initialState(data), {
      type: "selectCompound", compoundId: beats[contrast]!.compoundId,
    });
    expect(state.selectedCompoundId).toBe(CYCLOSPORINE);
    state = reducer(state, {
      type: "selectCompound", compoundId: beats[contrast - 1]!.compoundId,
    });
    expect(state.selectedCompoundId).toBe("TAK-994");
  });
});

describe("no beat inherits its as-of date", () => {
  // Beat 5 (the record tab) used to carry `actions: []`. Reached FORWARD from
  // beat 4 it inherited `postMurineStudy`, correctly - but reached BACKWARD from
  // beat 6 it inherited `null`, because beat 6 sets `null` and nothing restored
  // it. That is the same class of bug that made `compoundId` required: a beat
  // with no `setAsOf` of its own inherits whatever the previous beat left behind,
  // and inheritance is direction-dependent. It is not cosmetic on this beat
  // specifically - `Record.tsx` hashes `visibleClaims(all, asOf)` into the signed
  // evidence snapshot and stores `asOfDate: asOf` on the position, so a presenter
  // stepping backward onto the record beat and signing would have recorded a
  // position against a different evidence snapshot than the forward path
  // produces, inside the hash-chained audit log. Beats 1-3 had the identical
  // defect walking backward from beat 4.
  it("reaches the same as-of date walking backward as walking forward, at every beat", () => {
    // Walk all the way forward first, exactly as a presenter does before ever
    // pressing ←.
    let s = initialState(data);
    for (const b of beats) {
      s = reducer(s, { type: "setTourBeat", beat: b.n, tab: b.tab, focus: b.focus });
      for (const a of b.actions) s = reducer(s, a);
    }

    // Then walk backward one beat at a time, and at each beat compare the as-of
    // date the backward walk reached to the one a pure forward walk to that SAME
    // beat produces (stateAtBeat). They must agree at every beat, not just the
    // endpoints.
    for (let i = beats.length - 1; i >= 0; i--) {
      const b = beats[i]!;
      s = reducer(s, { type: "setTourBeat", beat: b.n, tab: b.tab, focus: b.focus });
      for (const a of b.actions) s = reducer(s, a);
      expect(s.asOf).toBe(stateAtBeat(i).asOf);
    }
  });
});
