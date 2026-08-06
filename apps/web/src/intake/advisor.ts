import {
  reason, relevanceDiscount, type EvidenceClaim, type Ruleset, type Verdict,
} from "@arbiter/engine";

export interface Reachability {
  /** The most committed mass this evidence could ever muster. */
  ceiling: number;
  /** Committed mass a verdict needs: `1 - abstentionGapThreshold`. */
  bar: number;
  /** False when no verdict is reachable at ANY confidence values. */
  reachable: boolean;
  verdict: Verdict;
  /** Plain-English properties no live claim has. Empty when reachable. */
  missing: string[];
}

/**
 * The most committed mass this evidence could possibly muster.
 *
 * Deliberately the same derivation as `committedMassCeiling` in the harness, and
 * for the same purpose: only a LIVE claim can commit anything, an ambiguous one
 * commits to nothing, and every survivor is then granted full confidence 1.0 so
 * the total is its discount factor alone.
 *
 * That makes it an over-estimate twice over - real strengths are below 1, and
 * Dempster combination yields less than the sum for masses this small. Being an
 * upper bound is the entire point: it is what lets the advisor say "could not
 * commit at any values" rather than the far weaker "did not commit".
 *
 * The factor comes from `relevanceDiscount`, the engine function that produced
 * the mass, never from parsing the rationale prose beside it.
 */
export function committedMassCeiling(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  status: Map<string, string>,
): number {
  let ceiling = 0;
  for (const c of claims) {
    const s = status.get(c.id);
    if (s !== "admitted" && s !== "downweighted") continue;
    if (c.assertion === "ambiguous") continue;
    ceiling += relevanceDiscount(c, ruleset).factor;
  }
  return ceiling;
}

/**
 * What a committed position needs, stated as properties rather than as a score.
 *
 * Measured on the corpus: the only evidence that survives discounting with
 * enough mass to decide is human-system evidence that measures a key event and
 * is exposure-relevant. Cyclosporine commits on exactly that shape; the 140
 * single-claim compounds have none of it.
 *
 * Reported as the properties actually absent, so the advice names the missing
 * experiment rather than restating the arithmetic.
 */
function missingProperties(claims: EvidenceClaim[], status: Map<string, string>): string[] {
  const live = claims.filter((c) => {
    const s = status.get(c.id);
    return (s === "admitted" || s === "downweighted") && c.assertion !== "ambiguous";
  });

  const missing: string[] = [];
  if (!live.some((c) => c.system === "human")) {
    missing.push("evidence from a human system - animal and in-silico evidence is discounted by R1 and R2");
  }
  if (!live.some((c) => c.measuresKeyEvent !== null)) {
    missing.push("a claim that measures an AOP key event - structural correlation alone is discounted by R2");
  }
  if (!live.some((c) => c.exposureRelevant === true)) {
    missing.push("a finding at clinically relevant exposure, with a cited Cmax - R3 discounts the rest");
  }
  return missing;
}

/**
 * Whether this evidence could reach a committed position at all, before any
 * confidence value is read.
 *
 * A user who enters three weak claims and receives `abstain` will conclude the
 * tool is broken. They are the 140-compound case, and the honest framing is
 * available before they start rather than after they are disappointed.
 *
 * Not a new inference: this is the ceiling argument HANDOVER §2 already makes
 * for 254 of the 260 corpus declines, pointed at one compound instead of a split.
 */
export function assessReachability(claims: EvidenceClaim[], ruleset: Ruleset): Reachability {
  const reasoning = reason(claims, ruleset);
  const status = new Map<string, string>(reasoning.trace.map((s) => [s.claimId, s.status]));

  const bar = 1 - ruleset.abstentionGapThreshold;
  const ceiling = committedMassCeiling(claims, ruleset, status);
  const reachable = ceiling > bar;

  return {
    ceiling,
    bar,
    reachable,
    verdict: reasoning.verdict,
    missing: reachable ? [] : missingProperties(claims, status),
  };
}

/**
 * The sentence the intake screen shows. Written out here rather than in the
 * component so it can be tested without a DOM, and so the wording that has to
 * stay honest lives beside the arithmetic that makes it true.
 */
export function reachabilitySentence(r: Reachability): string {
  if (r.reachable) {
    return `This evidence can reach a committed position: its ceiling of ${r.ceiling.toFixed(3)} clears the ${r.bar.toFixed(3)} a verdict requires.`;
  }
  const needs = r.missing.length === 0 ? "" : ` Committing would need ${r.missing.join("; ")}.`;
  return (
    `On this evidence no verdict is reachable at any confidence values - the most it could ` +
    `muster is ${r.ceiling.toFixed(3)} against the ${r.bar.toFixed(3)} a verdict requires.${needs}`
  );
}
