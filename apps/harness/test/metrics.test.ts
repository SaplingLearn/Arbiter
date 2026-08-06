import { describe, expect, it } from "vitest";
import {
  abstentionQuality, calibration, conflictSubsetAccuracy, plannerSensitivity, robustness,
  streamCoverage,
} from "../src/metrics.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import assayFile from "../../../data/assays.json" with { type: "json" };
import type { AssayOperator, EvidenceClaim, Reasoning, Ruleset, Verdict } from "@arbiter/engine";
import type { ResultRow } from "../src/main.js";

const RS = ruleset as Ruleset;
const ASSAYS = (assayFile as { assays: AssayOperator[] }).assays;

function reasoning(over: Partial<Reasoning> = {}): Reasoning {
  return {
    verdict: "do_not_advance", contested: true, belief: 0.4, plausibility: 0.6,
    mass: { toxic: 0.4, safe: 0.2, uncommitted: 0.4 },
    conflictMass: 0.1, trace: [], counterfactual: null, nextExperiment: null, rulesetHash: "h",
    ...over,
  };
}

function row(over: Partial<ResultRow> & { compoundId: string; y: number }): ResultRow {
  return {
    conflicting: true,
    arbiter: reasoning(),
    baselines: { majorityVote: { verdict: "advance", score: 0.3 } },
    ...over,
  } as ResultRow;
}

const verdictRow = (id: string, y: number, v: Verdict, conflicting = true) =>
  row({ compoundId: id, y, conflicting, arbiter: reasoning({ verdict: v }) });

describe("conflictSubsetAccuracy", () => {
  it("scores ONLY the conflict subset - unanimous cases inflate the number", () => {
    const rows = [
      verdictRow("a", 1, "do_not_advance", true),
      verdictRow("b", 0, "do_not_advance", false), // must be ignored
    ];
    const r = conflictSubsetAccuracy(rows);
    expect(r.n).toBe(1);
    expect(r.arbiter.nCommitted).toBe(1);
  });

  it("EXCLUDES abstentions from accuracy and reports coverage alongside", () => {
    const rows = [verdictRow("a", 1, "do_not_advance"), verdictRow("b", 1, "abstain")];
    const r = conflictSubsetAccuracy(rows);
    expect(r.arbiter.nCommitted).toBe(1);
    expect(r.arbiter.coverage).toBeCloseTo(0.5, 10);
    // 85% accuracy while abstaining on 60% is meaningless - the pair must travel
    // together, so both fields must exist on every scored pipeline.
    expect(r.arbiter).toHaveProperty("balancedAccuracy");
    expect(r.arbiter).toHaveProperty("coverage");
  });

  it("FLAGS a single-class committed set instead of quoting a half-substituted number", () => {
    // The live risk, not a hypothetical: this project's conflict subset is 90%
    // positive and ARBITER commits on very few of it. Without the flag a
    // balanced accuracy of 0.75 computed from sensitivity 1 and a substituted
    // specificity of 0.5 looks like a result.
    const rows = [verdictRow("a", 1, "do_not_advance"), verdictRow("b", 1, "do_not_advance")];
    const r = conflictSubsetAccuracy(rows);
    expect(r.arbiter.singleClass).toBe(true);
    expect(r.arbiter.balancedAccuracy).toBeCloseTo(0.75, 10);

    const balanced = conflictSubsetAccuracy([
      verdictRow("a", 1, "do_not_advance"), verdictRow("b", 0, "advance"),
    ]);
    expect(balanced.arbiter.singleClass).toBe(false);
    expect(balanced.arbiter.balancedAccuracy).toBe(1);
  });

  it("reports the subset positive rate, so an imbalanced subset is visible", () => {
    const rows = [
      verdictRow("a", 1, "do_not_advance"), verdictRow("b", 1, "do_not_advance"),
      verdictRow("c", 1, "do_not_advance"), verdictRow("d", 0, "advance"),
    ];
    expect(conflictSubsetAccuracy(rows).positiveRate).toBeCloseTo(0.75, 10);
  });

  it("scores every baseline present on any row", () => {
    const rows = [verdictRow("a", 1, "do_not_advance")];
    rows[0]!.baselines = {
      majorityVote: { verdict: "do_not_advance", score: 0.9 },
      "single:qsar": { verdict: "advance", score: 0.2 },
    };
    const r = conflictSubsetAccuracy(rows);
    expect(Object.keys(r.baselines).sort()).toEqual(["majorityVote", "single:qsar"]);
    expect(r.baselines["majorityVote"]!.confusion.tp).toBe(1);
    expect(r.baselines["single:qsar"]!.confusion.fn).toBe(1);
  });
});

describe("calibration", () => {
  it("detects when the interval is wider on the cases ARBITER got wrong", () => {
    const rows = [
      row({ compoundId: "ok", y: 1, arbiter: reasoning({ verdict: "do_not_advance", belief: 0.45, plausibility: 0.55 }) }),
      row({ compoundId: "bad", y: 0, arbiter: reasoning({ verdict: "do_not_advance", belief: 0.1, plausibility: 0.9 }) }),
    ];
    const c = calibration(rows);
    expect(c.meanWidthOnIncorrect).toBeGreaterThan(c.meanWidthOnCorrect);
    expect(c.widthDiscriminates).toBe(true);
  });

  it("marks the discrimination flag as NOT meaningful on tiny groups", () => {
    // Two rows can satisfy widthDiscriminates by chance. The flag says so rather
    // than letting a coin flip be quoted as evidence of calibration.
    const rows = [
      row({ compoundId: "ok", y: 1, arbiter: reasoning({ verdict: "do_not_advance", belief: 0.45, plausibility: 0.55 }) }),
      row({ compoundId: "bad", y: 0, arbiter: reasoning({ verdict: "do_not_advance", belief: 0.1, plausibility: 0.9 }) }),
    ];
    expect(calibration(rows).widthDiscriminatesIsMeaningful).toBe(false);
  });

  it("cannot report discrimination when nothing was wrong", () => {
    const rows = [row({ compoundId: "a", y: 1, arbiter: reasoning({ verdict: "do_not_advance" }) })];
    const c = calibration(rows);
    expect(c.nIncorrect).toBe(0);
    expect(c.widthDiscriminates).toBe(false);
  });

  it("applies the literal Dempster-Shafer reading for strict coverage", () => {
    // y=1 is covered only when plausibility is 1; y=0 only when belief is 0.
    const covered = row({ compoundId: "a", y: 1, arbiter: reasoning({ belief: 0.3, plausibility: 1 }) });
    const notCovered = row({ compoundId: "b", y: 1, arbiter: reasoning({ belief: 0.3, plausibility: 0.9 }) });
    expect(calibration([covered]).strictCoverage).toBe(1);
    expect(calibration([notCovered]).strictCoverage).toBe(0);
  });
});

describe("abstentionQuality", () => {
  it("reports decline rate inseparably from accuracy", () => {
    // Each row carries one undiscounted claim it actually reasoned over. A row with
    // no claims at all has a committed-mass ceiling of zero, which is genuinely
    // "could never have committed" - so a bare verdict fixture would trip the
    // structural-forcing guard rather than exercise the decline rate.
    const rows = ["a", "b", "c"].map((id, i) =>
      row({
        compoundId: id, y: i === 2 ? 0 : 1,
        arbiter: reasoning({
          verdict: i === 0 ? "do_not_advance" : "abstain",
          trace: [{ claimId: `${id}:c`, status: "admitted", rationale: "" }],
        }),
      }));
    const claims = new Map(rows.map((r) => [r.compoundId, [{
      id: `${r.compoundId}:c`, compoundId: r.compoundId, stream: "cytotox" as const,
      assertion: "toxic" as const, strength: 1, system: "human" as const,
      measuresKeyEvent: "KE:55", exposureRelevant: true, inApplicabilityDomain: true,
      klimisch: 2 as const, availableFrom: "2020-01-01",
      provenance: { kind: "database" as const, source: "t", retrieved: "2026-07-26" },
    }]]));
    const q = abstentionQuality(rows, claims, RS);
    expect(q.nDeclined).toBe(2);
    expect(q.nCommitted).toBe(1);
    expect(q.declineRate).toBeCloseTo(2 / 3, 10);
    expect(q.singleClassOnCommitted).toBe(true);
  });
});

/**
 * nStructurallyForced separates the two kinds of abstention, which mean opposite
 * things to a toxicologist. "The evidence could have settled this and did not"
 * invites more of the same assay. "No strength of the evidence this compound
 * carries could ever have settled it" says the assay class itself is the wrong
 * instrument, and running more of it is wasted money.
 *
 * HANDOVER section 2 measures the second group at most of the corpus, which is
 * why the decline rate is not the engine being timid.
 */
/**
 * Stream coverage is the most concrete explanation of the decline rate in the
 * whole chain: the engine adjudicates BETWEEN sources, and on this corpus most
 * compounds have only one. It is also what explains the reported tie - a baseline
 * built on a stream present on a handful of compounds is scored over exactly
 * those compounds, so "ties the best baseline" is a comparison over a set the
 * evidence base chose, not the pipelines.
 */
describe("streamCoverage", () => {
  const c = (id: string, compoundId: string, stream: EvidenceClaim["stream"]): EvidenceClaim => ({
    id, compoundId, stream, assertion: "toxic", strength: 1, system: "human",
    measuresKeyEvent: "KE:55", exposureRelevant: true, inApplicabilityDomain: true,
    klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
  });

  it("counts claims AND distinct compounds per stream, over the scored rows only", () => {
    // Both counts, because they answer different questions: claims says how much
    // evidence exists, compounds says how much of the set it can speak to. A stream
    // with many claims on few compounds is not broad coverage.
    const rows = [verdictRow("a", 1, "abstain"), verdictRow("b", 1, "abstain")];
    const claims = new Map([
      ["a", [c("a1", "a", "qsar"), c("a2", "a", "cytotox")]],
      ["b", [c("b1", "b", "qsar")]],
      // Not in `rows`, so it must not be counted - scoring anything outside the
      // test split is the leakage this whole document exists to rule out.
      ["z", [c("z1", "z", "transporter")]],
    ]);
    const cov = streamCoverage(rows, claims);
    expect(cov.qsar).toEqual({ claims: 2, compounds: 2 });
    expect(cov.cytotox).toEqual({ claims: 1, compounds: 1 });
    expect(cov.transporter).toBeUndefined();
  });

  it("counts a compound once per stream however many claims it carries there", () => {
    const rows = [verdictRow("a", 1, "abstain")];
    const claims = new Map([["a", [c("a1", "a", "cytotox"), c("a2", "a", "cytotox")]]]);
    expect(streamCoverage(rows, claims).cytotox).toEqual({ claims: 2, compounds: 1 });
  });
});

describe("abstentionQuality: structurally forced abstentions", () => {
  const claim = (over: Partial<EvidenceClaim> & { id: string; compoundId: string }): EvidenceClaim => ({
    stream: "cytotox", assertion: "toxic", strength: 1, system: "human",
    measuresKeyEvent: "KE:55", exposureRelevant: true, inApplicabilityDomain: true,
    klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    ...over,
  });

  /** Discounted by R2 (0.15) and R3 (0.15) to 2.25% of stated confidence. */
  const structuralSafe = (id: string, compoundId: string) =>
    claim({ id, compoundId, stream: "qsar", assertion: "safe", measuresKeyEvent: null, exposureRelevant: null });

  const rowWith = (id: string, v: Verdict, claimIds: string[]) =>
    row({
      compoundId: id, y: 1,
      arbiter: reasoning({
        verdict: v,
        trace: claimIds.map((cid) => ({ claimId: cid, status: "admitted" as const, rationale: "" })),
      }),
    });

  it("counts a compound no strength of its own evidence could have rescued", () => {
    // One QSAR claim surviving at 0.0225. Even granted full confidence it cannot
    // reach the 0.5 of committed mass the registered threshold demands, so the
    // abstention was settled before a single value was read.
    const claims = new Map([["a", [structuralSafe("c1", "a")]]]);
    const q = abstentionQuality([rowWith("a", "abstain", ["c1"])], claims, RS);
    expect(q.nStructurallyForced).toBe(1);
  });

  it("does NOT count a compound whose evidence could have committed and did not", () => {
    // An undiscounted claim reaches 1.0, comfortably past the bar. This compound
    // abstained on what its evidence actually said, not on what it could not say -
    // exactly the distinction the field exists to draw, so conflating the two
    // would make the number worthless.
    const claims = new Map([["a", [claim({ id: "c1", compoundId: "a" })]]]);
    const q = abstentionQuality([rowWith("a", "abstain", ["c1"])], claims, RS);
    expect(q.nDeclined).toBe(1);
    expect(q.nStructurallyForced).toBe(0);
  });

  it("ignores defeated and ambiguous claims, which commit no mass to begin with", () => {
    // A defeated claim is excluded from fusion and an ambiguous one is vacuous, so
    // neither can lift a compound over the bar. Counting either would understate
    // the forced set by crediting mass that never existed.
    const claims = new Map([["a", [
      claim({ id: "beaten", compoundId: "a" }),
      claim({ id: "vague", compoundId: "a", assertion: "ambiguous" }),
      structuralSafe("weak", "a"),
    ]]]);
    const q = abstentionQuality([row({
      compoundId: "a", y: 1,
      arbiter: reasoning({
        verdict: "abstain",
        trace: [
          { claimId: "beaten", status: "defeated", rationale: "" },
          { claimId: "vague", status: "admitted", rationale: "" },
          { claimId: "weak", status: "admitted", rationale: "" },
        ],
      }),
    })], claims, RS);
    expect(q.nStructurallyForced).toBe(1);
  });

  it("THROWS if a compound it called forced actually committed", () => {
    // The bound is an over-estimate by construction, so a committed compound
    // inside the forced set means the arithmetic is wrong and every conclusion
    // drawn from the field is void. HANDOVER section 6.4's recurring lesson is
    // that a silently wrong number looks exactly like a working pipeline - so
    // this fails the run rather than writing the field.
    const claims = new Map([["a", [structuralSafe("c1", "a")]]]);
    expect(() => abstentionQuality([rowWith("a", "do_not_advance", ["c1"])], claims, RS))
      .toThrow(/structurally forced/i);
  });
});

describe("robustness", () => {
  function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
    return {
      compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
      system: "human", measuresKeyEvent: null, exposureRelevant: null,
      inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
      provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
      ...over,
    };
  }

  it("is reproducible from the seed", () => {
    const claims = [claim({ id: "a", assertion: "toxic", strength: 0.7, exposureRelevant: true })];
    const a = robustness(claims, RS, 200, 20260726);
    const b = robustness(claims, RS, 200, 20260726);
    expect(a).toEqual(b);
  });

  it("reports the baseline verdict, so a perfect score on an abstention is readable", () => {
    // A compound far from any threshold holds at 1.0 under any perturbation. That
    // is stability without information, and the corpus mean is dominated by it -
    // so the verdict has to travel with the number.
    const stuck = [claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", strength: 0.5 })];
    const r = robustness(stuck, RS, 200, 20260726);
    expect(r.baselineVerdict).toBe("abstain");
    expect(r.heldFraction).toBe(1);
  });

  it("can actually drop below 1 - the metric is not vacuous", () => {
    // A case deliberately near the decision boundary, so perturbation moves it.
    // Without this the whole metric could be a constant and no test would notice.
    const borderline = [
      claim({ id: "t", assertion: "toxic", strength: 0.52, exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "s", assertion: "safe", strength: 0.5, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
    ];
    const r = robustness(borderline, RS, 400, 20260726);
    expect(r.heldFraction).toBeLessThan(1);
    expect(r.heldFraction).toBeGreaterThan(0);
  });
});

describe("plannerSensitivity", () => {
  function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
    return {
      compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
      system: "human", measuresKeyEvent: null, exposureRelevant: null,
      inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
      provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
      ...over,
    };
  }

  it("returns a null baseline when there is nothing to recommend", () => {
    const settled = [
      claim({ id: "a", assertion: "safe", strength: 0.95, exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.95, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
    ];
    expect(plannerSensitivity(settled, RS, ASSAYS, 50, 1).baselineAssay).toBeNull();
  });

  it("measures how often the recommendation survives a +/-50% prior perturbation", () => {
    const abstaining = [
      claim({ id: "rat", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent" }),
      claim({ id: "primate", assertion: "safe", strength: 0.85, system: "nonrodent", stream: "invivo_nonrodent" }),
      claim({ id: "invitro", assertion: "safe", strength: 0.8, measuresKeyEvent: "KE:HEPATOCYTE-DEATH" }),
    ];
    const s = plannerSensitivity(abstaining, RS, ASSAYS, 200, 20260726);
    expect(s.baselineAssay).not.toBeNull();
    expect(s.unchangedFraction).toBeGreaterThanOrEqual(0);
    expect(s.unchangedFraction).toBeLessThanOrEqual(1);
    expect(s.samples).toBe(200);
  });

  it("is reproducible from the seed", () => {
    const claims = [claim({ id: "rat", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent" })];
    expect(plannerSensitivity(claims, RS, ASSAYS, 100, 7))
      .toEqual(plannerSensitivity(claims, RS, ASSAYS, 100, 7));
  });
});
