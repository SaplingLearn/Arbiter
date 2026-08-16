import { handleAdjudicate, type Adjudication, type AdjudicateRequest, type ConsequenceVerdict } from "./adjudicate.js";
import type { ApiResponse, Complete } from "./interpret.js";

/**
 * Adjudicating more than once, and reporting how much the runs agreed.
 *
 * WHY, MEASURED. The verdict is not deterministic at temperature 0. On turalio's package
 * - the most consequential case in the corpus - five runs on byte-identical input
 * returned `do_not_advance` three times and `cannot_conclude` twice. Across fourteen real
 * drugs at three runs each, one flipped, and that 13/14 is an UPPER bound: three draws
 * cannot detect a case that flips one time in five.
 *
 * It is not variable thinking length, which was the obvious suspect - a fixed
 * `thinkingBudget` of 4096 flips exactly as -1 does. It is ordinary nondeterminism in a
 * large model, and there is no configuration that removes it.
 *
 * SO THE DISAGREEMENT IS REPORTED RATHER THAN HIDDEN. Self-consistency (Wang et al.,
 * ICLR 2023) samples a decision several times and takes the majority, which is a
 * standard and unglamorous variance reduction: three draws of a 3:2 coin agree with the
 * modal answer far more often than one draw does.
 *
 * THE VOTE IS THE POINT, NOT JUST THE MAJORITY. A case where three of three runs agree
 * and a case where two of three do are different objects, and the reader of a safety
 * record is exactly the person who should be told which one they have. A single call
 * cannot distinguish them - it returns one verdict with the same confident prose either
 * way, which is `fluent wrongness` in the one place this project cares most about it. So
 * `agreement` travels with the adjudication the same way `source: stub | live` does.
 *
 * WHAT IT COSTS. N times the tokens and N times the latency of one adjudication. This is
 * the rarest call in the product - once per case, not once per question - so three runs
 * of it costs less than three Asks, and buys the difference between a coin and a
 * measurement.
 */

export interface Consensus {
  /** How many times the adjudication was run. */
  runs: number;
  /** How many returned the verdict that won. 2 of 3 is a case worth reading twice. */
  votes: number;
  /** votes / runs. 1.0 is unanimous. */
  agreement: number;
  /** Every verdict seen, with its count. Unanimity is visible; so is a 2:1 split. */
  distribution: Record<string, number>;
  /** True when the runs did not all agree. The flag a reviewer should see. */
  split: boolean;
}

/** Runs to take when nothing says otherwise. Odd, so a two-way split has a winner. */
export const DEFAULT_RUNS = 3;

export function runsFrom(env: NodeJS.ProcessEnv): number {
  const raw = env["ARBITER_ADJUDICATION_RUNS"];
  if (raw === undefined || raw === "") return DEFAULT_RUNS;
  const n = Number(raw);
  // A malformed value falls back rather than to NaN, which would make the loop run zero
  // times and return no adjudication at all.
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RUNS;
  return Math.min(9, Math.floor(n));
}

/**
 * The verdict most runs returned, and the adjudication that argued for it.
 *
 * TIES GO TO THE MOST CAUTIOUS ANSWER, and the order is deliberate: `cannot_conclude`
 * beats `do_not_advance` beats `advance`. A tie means the evidence did not compel one
 * reading, and the honest response to that is to decline rather than to pick the
 * cheerful option. Reaching for `advance` on a coin toss is the one failure this whole
 * surface exists to prevent.
 */
const CAUTION: ConsequenceVerdict[] = ["cannot_conclude", "do_not_advance", "advance"];

export function pickMajority(verdicts: ConsequenceVerdict[]): { verdict: ConsequenceVerdict; votes: number } {
  const counts = new Map<ConsequenceVerdict, number>();
  for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = verdicts[0]!;
  let bestN = 0;
  for (const v of CAUTION) {
    const n = counts.get(v) ?? 0;
    // Strictly greater, walking CAUTION in order, so an equal count keeps the earlier -
    // that is, the more cautious - entry.
    if (n > bestN) { best = v; bestN = n; }
  }
  return { verdict: best, votes: bestN };
}

/**
 * Adjudicate `runs` times and return the majority answer with its vote.
 *
 * Returns the FULL adjudication from a run that reached the winning verdict, never a
 * merge of several. A reasoning paragraph stitched from three different runs argues for
 * a conclusion none of them reached, and the citations underneath it would belong to no
 * single chain of reasoning.
 */
export async function adjudicateConsensus(
  request: AdjudicateRequest,
  complete: Complete,
  prompt: { system: string[]; userTemplate: string[] },
  runs: number = DEFAULT_RUNS,
): Promise<{ response: ApiResponse; consensus: Consensus | null }> {
  const ok: { verdict: ConsequenceVerdict; response: ApiResponse }[] = [];
  let lastFailure: ApiResponse | null = null;

  for (let i = 0; i < runs; i++) {
    const res = await handleAdjudicate(request, complete, prompt);
    if (res.status !== 200) { lastFailure = res; continue; }
    ok.push({ verdict: (res.body as Adjudication).consequence.verdict, response: res });
  }

  // Every run failed. Return the last failure unchanged - a caller that cannot adjudicate
  // must see the reason, not a consensus over nothing.
  if (ok.length === 0) return { response: lastFailure ?? { status: 502, body: { error: "no_adjudication" } }, consensus: null };

  const { verdict, votes } = pickMajority(ok.map((o) => o.verdict));
  const distribution: Record<string, number> = {};
  for (const o of ok) distribution[o.verdict] = (distribution[o.verdict] ?? 0) + 1;

  return {
    response: ok.find((o) => o.verdict === verdict)!.response,
    consensus: {
      runs: ok.length,
      votes,
      agreement: votes / ok.length,
      distribution,
      split: votes !== ok.length,
    },
  };
}
