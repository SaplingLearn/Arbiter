import { describe, expect, it } from "vitest";
import { aggregate } from "../src/ablation/aggregate.js";
import {
  customId, parseCustomId, parseRunsJsonl, pendingWork, runsFromBatch,
  type BatchResult, type RecordedRun, type WorkItem,
} from "../src/ablation/resume.js";

/**
 * Three compounds whose verdicts differ, so a positional read cannot
 * accidentally produce the right answer. If results were attributed by position
 * after shuffling, A would inherit C's verdicts and the aggregate would still
 * look entirely plausible.
 */
const RESULTS: BatchResult[] = [
  { customId: "A:0", verdict: "abstain", confidence: 0.4, stopReason: "end_turn" },
  { customId: "A:1", verdict: "abstain", confidence: 0.4, stopReason: "end_turn" },
  { customId: "B:0", verdict: "do_not_advance", confidence: 0.8, stopReason: "end_turn" },
  { customId: "B:1", verdict: "do_not_advance", confidence: 0.8, stopReason: "end_turn" },
  { customId: "C:0", verdict: "advance", confidence: 0.9, stopReason: "end_turn" },
  { customId: "C:1", verdict: "advance", confidence: 0.9, stopReason: "end_turn" },
];

/** Deterministic reversal, not a random shuffle - a test that shuffles randomly
 *  can pass by luck on the run that matters. */
const SHUFFLED = [...RESULTS].reverse();

describe("batch results are keyed by custom_id", () => {
  // Test 4, written first because the failure it guards is silent, total, and
  // produces a plausible-looking metrics.json.
  it("attributes every verdict to the right compound when results arrive reordered", () => {
    const inOrder = runsFromBatch(RESULTS);
    const reordered = runsFromBatch(SHUFFLED);

    const key = (r: { compoundId: string; runIndex: number }): string => customId(r.compoundId, r.runIndex);
    const sort = <T extends { compoundId: string; runIndex: number }>(rs: T[]): T[] =>
      [...rs].sort((a, b) => (key(a) < key(b) ? -1 : 1));

    expect(sort(reordered)).toEqual(sort(inOrder));
  });

  /**
   * Asserts the KNOWN-CORRECT aggregate, not merely that both orders agree.
   *
   * Written that way after watching the weaker version pass against a
   * deliberately positional implementation: both orderings produced the same
   * WRONG answer, so self-consistency proved nothing. Every compound here is
   * unanimous, so each agreementRate must be exactly 1 - a mis-attribution
   * splits at least one compound's verdicts and drops it below 1.
   */
  it("produces the known-correct aggregate from reordered results", () => {
    const doc = aggregate(runsFromBatch(SHUFFLED), {});
    expect(doc.byCompound).toEqual({
      A: { agreementRate: 1, confidenceStdDev: 0, nScored: 2 },
      B: { agreementRate: 1, confidenceStdDev: 0, nScored: 2 },
      C: { agreementRate: 1, confidenceStdDev: 0, nScored: 2 },
    });
    expect(doc).toEqual(aggregate(runsFromBatch(RESULTS), {}));
  });

  it("never lets one compound's verdict land on another", () => {
    for (const run of runsFromBatch(SHUFFLED)) {
      const expected = RESULTS.find((r) => r.customId === customId(run.compoundId, run.runIndex));
      expect(run.verdict).toBe(expected?.verdict);
    }
  });

  it("round-trips a custom_id", () => {
    expect(parseCustomId(customId("TAK-994", 7))).toEqual({ compoundId: "TAK-994", runIndex: 7 });
  });

  it("splits on the LAST colon, so an id containing one cannot truncate", () => {
    expect(parseCustomId("CHEMBL:1234:12")).toEqual({ compoundId: "CHEMBL:1234", runIndex: 12 });
  });

  it("refuses a malformed custom_id rather than guessing", () => {
    expect(() => parseCustomId("no-colon")).toThrow(/malformed custom_id/);
    expect(() => parseCustomId("A:notanumber")).toThrow(/run index/);
  });
});

describe("resuming a partial run", () => {
  const ALL: WorkItem[] = [
    { compoundId: "A", runIndex: 0 },
    { compoundId: "A", runIndex: 1 },
    { compoundId: "B", runIndex: 0 },
  ];
  const recorded = (over: Partial<RecordedRun>): RecordedRun => ({
    compoundId: "A", runIndex: 0, verdict: "abstain", confidence: 0.5,
    stopReason: "end_turn", promptSha256: "hash-1", model: "model-1", ...over,
  });

  // Test 5. Fails if the guard is removed - re-runs would re-spend the budget.
  it("skips work already recorded for the same prompt and model", () => {
    expect(pendingWork(ALL, [recorded({})], "hash-1", "model-1")).toEqual([
      { compoundId: "A", runIndex: 1 },
      { compoundId: "B", runIndex: 0 },
    ]);
  });

  it("redoes everything when the prompt changed", () => {
    expect(pendingWork(ALL, [recorded({})], "hash-2", "model-1")).toEqual(ALL);
  });

  it("redoes everything when the model changed", () => {
    expect(pendingWork(ALL, [recorded({})], "hash-1", "model-2")).toEqual(ALL);
  });

  /** A refusal is data. Retrying it until the classifier relents would make the
   *  reported prompt a fiction. */
  it("treats a recorded refusal as done, not as work to retry", () => {
    const refusal = recorded({ verdict: null, confidence: null, stopReason: "refusal" });
    expect(pendingWork(ALL, [refusal], "hash-1", "model-1")).toEqual([
      { compoundId: "A", runIndex: 1 },
      { compoundId: "B", runIndex: 0 },
    ]);
  });

  it("returns everything when nothing has been recorded", () => {
    expect(pendingWork(ALL, [], "hash-1", "model-1")).toEqual(ALL);
  });
});

describe("the resumable JSONL", () => {
  it("tolerates blank lines", () => {
    const text = '{"compoundId":"A","runIndex":0}\n\n{"compoundId":"A","runIndex":1}\n';
    expect(parseRunsJsonl(text)).toHaveLength(2);
  });

  /** Silently dropping a bad line would understate `requests` and inflate every
   *  rate computed from it. */
  it("refuses a malformed line rather than dropping it", () => {
    expect(() => parseRunsJsonl('{"compoundId":"A"}\nnot json\n')).toThrow(/line 2/);
  });
});
