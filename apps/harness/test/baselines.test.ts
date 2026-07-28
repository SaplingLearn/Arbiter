import { describe, expect, it } from "vitest";
import { ALL_STREAMS, bestSingleSource, majorityVote, weightedAverage } from "../src/baselines.js";
import type { EvidenceClaim } from "@arbiter/engine";

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("majorityVote", () => {
  it("counts heads regardless of strength - this is the point of the baseline", () => {
    const r = majorityVote([
      claim({ id: "a", assertion: "safe", strength: 0.01 }),
      claim({ id: "b", assertion: "safe", strength: 0.01 }),
      claim({ id: "c", assertion: "toxic", strength: 0.99 }),
    ]);
    expect(r.verdict).toBe("advance");
  });

  it("THE FLAW WE ARE DEMONSTRATING: silence is invisible, so one voice scores as unanimity", () => {
    // Majority vote has nowhere to put "I do not know". This baseline EXCLUDES
    // ambiguous claims rather than counting them as safe votes - counting them
    // would be a strawman, and a competent person would not build it that way.
    //
    // The real flaw is subtler and worse: excluding them makes them INVISIBLE. One
    // toxic source with five others saying nothing produces exactly the same
    // verdict and exactly the same score, 1.0, as five toxic sources agreeing.
    // Dempster-Shafer cannot do this, because the silent sources contribute
    // m(Theta)=1 and the belief-plausibility gap stays wide.
    //
    // (The plan asserted "advance" here, i.e. that ambiguous claims are counted on
    // the safe side. That is not what its own implementation does, so the test
    // described a flaw the code did not have.)
    const oneVoiceFiveSilent = majorityVote([
      claim({ id: "a", assertion: "toxic", strength: 0.9 }),
      ...Array.from({ length: 5 }, (_, i) =>
        claim({ id: `amb${i}`, assertion: "ambiguous", strength: 0 })),
    ]);
    const fiveAgreeing = majorityVote(
      Array.from({ length: 5 }, (_, i) => claim({ id: `t${i}`, assertion: "toxic", strength: 0.9 })),
    );
    expect(oneVoiceFiveSilent).toEqual(fiveAgreeing);
    expect(oneVoiceFiveSilent.score).toBe(1);
  });

  it("abstains only when there is nothing at all to count", () => {
    expect(majorityVote([]).verdict).toBe("abstain");
    expect(majorityVote([claim({ id: "a", assertion: "ambiguous", strength: 0 })]).verdict).toBe("abstain");
  });

  it("breaks a tie by abstaining rather than guessing", () => {
    const r = majorityVote([
      claim({ id: "a", assertion: "toxic" }),
      claim({ id: "b", assertion: "safe" }),
    ]);
    expect(r.verdict).toBe("abstain");
  });

  it("reports score as the toxic fraction, on both sides of the decision", () => {
    // score is a toxicity leaning, so it must be < 0.5 for an advance and > 0.5 for
    // a do_not_advance. A score that only made sense on one branch would corrupt
    // the ranking metrics that consume it.
    const adv = majorityVote([
      claim({ id: "a", assertion: "safe" }), claim({ id: "b", assertion: "safe" }),
      claim({ id: "c", assertion: "toxic" }),
    ]);
    expect(adv.verdict).toBe("advance");
    expect(adv.score).toBeCloseTo(1 / 3, 12);

    const dna = majorityVote([
      claim({ id: "a", assertion: "toxic" }), claim({ id: "b", assertion: "toxic" }),
      claim({ id: "c", assertion: "safe" }),
    ]);
    expect(dna.verdict).toBe("do_not_advance");
    expect(dna.score).toBeCloseTo(2 / 3, 12);
  });
});

describe("weightedAverage", () => {
  it("lets one strong claim outweigh two weak ones", () => {
    const r = weightedAverage([
      claim({ id: "a", assertion: "safe", strength: 0.1 }),
      claim({ id: "b", assertion: "safe", strength: 0.1 }),
      claim({ id: "c", assertion: "toxic", strength: 0.95 }),
    ]);
    expect(r.verdict).toBe("do_not_advance");
  });

  it("treats an ambiguous claim as a zero-strength safe vote - the averaging flaw", () => {
    const withAmbiguous = weightedAverage([
      claim({ id: "a", assertion: "toxic", strength: 0.6 }),
      claim({ id: "b", assertion: "ambiguous", strength: 0 }),
    ]);
    const alone = weightedAverage([claim({ id: "a", assertion: "toxic", strength: 0.6 })]);
    expect(withAmbiguous.score).toBeLessThan(alone.score);
  });

  it("abstains when every claim is ambiguous, rather than scoring them as safe", () => {
    // The guard this exercises could never fire in the plan's version: its
    // `committed` filter read `assertion !== "ambiguous" || strength === 0`, which
    // is TRUE for every ambiguous claim in the corpus, so nothing was excluded and
    // an all-ambiguous compound scored a confident "advance".
    const r = weightedAverage([
      claim({ id: "a", assertion: "ambiguous", strength: 0 }),
      claim({ id: "b", assertion: "ambiguous", strength: 0 }),
    ]);
    expect(r.verdict).toBe("abstain");
  });
});

describe("bestSingleSource", () => {
  it("uses only the named stream and ignores everything else", () => {
    const r = bestSingleSource([
      claim({ id: "a", assertion: "toxic", strength: 0.9, stream: "cytotox" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, stream: "qsar" }),
    ], "qsar");
    expect(r.verdict).toBe("advance");
  });

  it("abstains when the named stream is silent for this compound", () => {
    const r = bestSingleSource([claim({ id: "a", stream: "cytotox" })], "toxicogenomics");
    expect(r.verdict).toBe("abstain");
  });

  it("orients score as a toxicity leaning, not as raw confidence", () => {
    const toxic = bestSingleSource([claim({ id: "a", assertion: "toxic", strength: 0.9 })], "cytotox");
    const safe = bestSingleSource([claim({ id: "a", assertion: "safe", strength: 0.9 })], "cytotox");
    expect(toxic.score).toBeCloseTo(0.9, 12);
    expect(safe.score).toBeCloseTo(0.1, 12);
  });

  it("covers every stream the harness will ask for", () => {
    // main.ts loops ALL_STREAMS; a stream missing from that list would silently
    // never be scored as a baseline.
    expect(new Set(ALL_STREAMS)).toEqual(new Set([
      "qsar", "cytotox", "toxicogenomics", "transporter", "invivo_rodent", "invivo_nonrodent",
    ]));
  });
});

describe("all three baselines", () => {
  it("are deterministic", () => {
    const claims = [claim({ id: "a", assertion: "toxic" }), claim({ id: "b", assertion: "safe", stream: "qsar" })];
    for (const fn of [majorityVote, weightedAverage]) {
      const runs = new Set(Array.from({ length: 50 }, () => JSON.stringify(fn(claims))));
      expect(runs.size).toBe(1);
    }
    const single = new Set(Array.from({ length: 50 }, () => JSON.stringify(bestSingleSource(claims, "qsar"))));
    expect(single.size).toBe(1);
  });

  it("never return a score outside [0,1]", () => {
    const claims = [
      claim({ id: "a", assertion: "toxic", strength: 1 }),
      claim({ id: "b", assertion: "safe", strength: 0 }),
      claim({ id: "c", assertion: "ambiguous", strength: 0, stream: "qsar" }),
    ];
    for (const p of [majorityVote(claims), weightedAverage(claims), bestSingleSource(claims, "qsar")]) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(1);
    }
  });
});
