import type { AblationRun, Verdict } from "./aggregate.js";

export interface WorkItem {
  compoundId: string;
  runIndex: number;
}

/**
 * A run as it is written to `results/ablation-runs.jsonl`.
 *
 * Carries the prompt digest and the model alongside the outcome, because those
 * two are what make a recorded run reusable: a run produced by a different
 * prompt or a different model is not this run's data, however identical its
 * shape.
 */
export interface RecordedRun extends AblationRun {
  promptSha256: string;
  model: string;
}

/**
 * One result off the Batch API, keyed by the id WE assigned when submitting.
 */
export interface BatchResult {
  customId: string;
  verdict: Verdict | null;
  confidence: number | null;
  stopReason: string;
  refusalCategory?: string | null;
}

/**
 * `<compoundId>:<runIndex>`.
 *
 * Compound ids in this corpus carry no colon, but the parser splits on the LAST
 * one anyway so an id that someday does cannot silently truncate.
 */
export function customId(compoundId: string, runIndex: number): string {
  return `${compoundId}:${runIndex}`;
}

export function parseCustomId(id: string): WorkItem {
  const cut = id.lastIndexOf(":");
  if (cut <= 0) throw new Error(`malformed custom_id, expected "<compoundId>:<runIndex>": ${id}`);
  const runIndex = Number(id.slice(cut + 1));
  if (!Number.isInteger(runIndex) || runIndex < 0) {
    throw new Error(`malformed custom_id, run index is not a non-negative integer: ${id}`);
  }
  return { compoundId: id.slice(0, cut), runIndex };
}

/**
 * Batch results to runs, keyed by `custom_id` and NEVER by position.
 *
 * This is the trap the Batch API sets: results arrive in any order. A positional
 * read would attribute one compound's verdicts to another and every downstream
 * number would be wrong while looking entirely plausible - no exception, no
 * failed parse, just a confidently incorrect metrics.json. `ablationResume.test.ts`
 * shuffles the input specifically to hold this honest.
 */
export function runsFromBatch(results: BatchResult[]): AblationRun[] {
  return results.map((r) => {
    const { compoundId, runIndex } = parseCustomId(r.customId);
    return {
      compoundId,
      runIndex,
      verdict: r.verdict,
      confidence: r.confidence,
      stopReason: r.stopReason,
      refusalCategory: r.refusalCategory ?? null,
    };
  });
}

/**
 * The work still to do: everything not already recorded for THIS prompt and
 * THIS model.
 *
 * A cost control, not a nicety. 1,525 requests is not something to re-run
 * casually, and a crash at request 1,400 must not cost the whole run. Matching
 * on `promptSha256` and `model` together is what stops a prompt edit from
 * quietly inheriting the old prompt's answers.
 *
 * Refusals count as recorded and are NOT retried - re-asking until the
 * classifier relents would make the reported prompt a fiction (spec section 8).
 */
export function pendingWork(
  all: WorkItem[],
  recorded: RecordedRun[],
  promptSha256: string,
  model: string,
): WorkItem[] {
  const done = new Set(
    recorded
      .filter((r) => r.promptSha256 === promptSha256 && r.model === model)
      .map((r) => customId(r.compoundId, r.runIndex)),
  );
  return all.filter((w) => !done.has(customId(w.compoundId, w.runIndex)));
}

/**
 * Parse the resumable JSONL. Blank lines are tolerated; a malformed line is not,
 * because silently dropping one would understate `requests` and inflate every
 * rate computed from it.
 */
export function parseRunsJsonl(text: string): RecordedRun[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l, i) => {
      try {
        return JSON.parse(l) as RecordedRun;
      } catch {
        throw new Error(`results/ablation-runs.jsonl: line ${i + 1} is not valid JSON`);
      }
    });
}
