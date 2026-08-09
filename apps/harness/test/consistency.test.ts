import { describe, expect, it } from "vitest";
import { consistencyReport, formatConsistencyReport, type AdjudicationSubset } from "../src/consistency.js";

/**
 * Every test here was written by breaking the implementation first and watching it
 * fail, per §5.1. Two of them exist BECAUSE a plausible implementation passes the
 * obvious tests and gets them wrong: the absent-rule case and the citation-order
 * case. Both are noted where they appear.
 */

function run(
  verdict: string,
  opts: { mechanism?: boolean; rules?: [string, string][]; cites?: string[] } = {},
): AdjudicationSubset {
  return {
    mechanism: { present: opts.mechanism ?? true },
    consequence: { verdict, citedFindingIds: opts.cites ?? ["f1"] },
    ruleDisclosure: (opts.rules ?? [["R1", "applies"], ["R2", "does_not_apply"]])
      .map(([ruleId, position]) => ({ ruleId, position })),
  };
}

describe("consistencyReport", () => {
  it("reports a zero flip rate when every run agrees", () => {
    const r = consistencyReport(Array.from({ length: 20 }, () => run("cannot_conclude")));
    expect(r.runs).toBe(20);
    expect(r.flipRate).toBe(0);
    expect(r.verdictAgreement).toBe(1);
    expect(r.modalVerdict).toBe("cannot_conclude");
  });

  it("reports the real flip rate when runs disagree", () => {
    // 14 of 20 agree, so 6 disagree: 30%.
    const runs = [
      ...Array.from({ length: 14 }, () => run("cannot_conclude")),
      ...Array.from({ length: 6 }, () => run("do_not_advance")),
    ];
    const r = consistencyReport(runs);
    expect(r.modalVerdict).toBe("cannot_conclude");
    expect(r.verdictAgreement).toBeCloseTo(0.7, 10);
    expect(r.flipRate).toBeCloseTo(0.3, 10);
    expect(r.verdicts).toEqual({ cannot_conclude: 14, do_not_advance: 6 });
  });

  it("counts a run that OMITTED a rule as its own position, not as agreement", () => {
    // THE SUBTLE ONE. An implementation that filters out runs missing the rule
    // computes agreement over the survivors and reports 100% stability for a rule
    // the model kept forgetting - which is precisely backwards. Breaking the
    // implementation to `.filter(Boolean)` instead of `?? "(absent)"` makes this
    // test report 1.0 and pass every other test in this file.
    const runs = [
      ...Array.from({ length: 6 }, () => run("advance", { rules: [["R1", "applies"]] })),
      ...Array.from({ length: 4 }, () => run("advance", { rules: [] })),
    ];
    const r = consistencyReport(runs);
    const r1 = r.ruleStability.find((s) => s.ruleId === "R1");
    expect(r1).toBeDefined();
    expect(r1!.positions).toEqual({ applies: 6, "(absent)": 4 });
    expect(r1!.agreement).toBeCloseTo(0.6, 10);
  });

  it("does not count citation ORDER as a disagreement", () => {
    // Serialisation detail. Counting it would inflate instability with noise, and
    // an implementation that joins without sorting reports 50% here.
    const runs = [
      run("advance", { cites: ["f1", "f2"] }),
      run("advance", { cites: ["f2", "f1"] }),
    ];
    expect(consistencyReport(runs).citationAgreement).toBe(1);
  });

  it("does count a genuinely different citation set as a disagreement", () => {
    // The other half of the pair: the sort must not flatten real differences into
    // agreement. Without this, "compare sorted" and "compare nothing at all" are
    // indistinguishable.
    const runs = [
      run("advance", { cites: ["f1", "f2"] }),
      run("advance", { cites: ["f1", "f3"] }),
    ];
    expect(consistencyReport(runs).citationAgreement).toBe(0.5);
  });

  it("sorts rule stability worst-first, so the unstable rule is the one you read", () => {
    const runs = [
      run("advance", { rules: [["R1", "applies"], ["R2", "applies"]] }),
      run("advance", { rules: [["R1", "applies"], ["R2", "does_not_apply"]] }),
    ];
    const r = consistencyReport(runs);
    expect(r.ruleStability[0]!.ruleId).toBe("R2");
    expect(r.ruleStability[0]!.agreement).toBe(0.5);
    expect(r.ruleStability[1]!.ruleId).toBe("R1");
    expect(r.ruleStability[1]!.agreement).toBe(1);
  });

  it("tracks mechanism separately from verdict", () => {
    // A model can be stable about the verdict while wobbling on whether a mechanism
    // exists at all. Rolling them together would hide that.
    const runs = [
      run("cannot_conclude", { mechanism: true }),
      run("cannot_conclude", { mechanism: false }),
    ];
    const r = consistencyReport(runs);
    expect(r.flipRate).toBe(0);
    expect(r.mechanismAgreement).toBe(0.5);
  });

  it("treats zero runs as maximally inconsistent rather than perfect", () => {
    // Dividing by zero would give NaN; returning 1.0 agreement for no evidence
    // would report a pass for a probe that never ran.
    const r = consistencyReport([]);
    expect(r.runs).toBe(0);
    expect(r.flipRate).toBe(1);
    expect(r.modalVerdict).toBeNull();
  });
});

describe("formatConsistencyReport", () => {
  it("says PASS only when the flip rate is within the pre-committed mark", () => {
    const pass = formatConsistencyReport(consistencyReport([run("advance"), run("advance")]), 0.1);
    expect(pass.at(-1)).toContain("PASS");
  });

  it("says FAIL and names it a DESIGN defect, not a prompt defect", () => {
    // The wording is load-bearing, not decoration. §7.2a's whole purpose is that a
    // failing flip rate must not be answered by rewriting the prompt, and the
    // report is where that instruction is actually read.
    const fail = formatConsistencyReport(consistencyReport([run("advance"), run("do_not_advance")]), 0.1);
    const last = fail.at(-1)!;
    expect(last).toContain("FAIL");
    expect(last).toContain("DESIGN defect");
    expect(last).toContain("Do not respond by rewriting the prompt");
  });
});
