import { defeats, downweightFactor, precedenceRank } from "./rules.js";
import type { ClaimStatus, EvidenceClaim, RuleId, Ruleset, TraceStep } from "./types.js";

export interface Attack {
  attackerId: string;
  targetId: string;
  byRule: RuleId;
  rationale: string;
}

export interface Argumentation {
  statuses: Map<string, ClaimStatus>;
  attacks: Attack[];
  trace: TraceStep[];
}

/**
 * Defeasible argumentation under grounded semantics.
 *
 * The attack graph is induced by the preference ordering in rules.ts. We then
 * compute the grounded extension by the standard characteristic-function
 * fixpoint: a claim is IN when every one of its attackers is OUT, and OUT when
 * some IN claim attacks it. Iterating to a fixpoint is what produces
 * REINSTATEMENT for free - if A defeats B and C defeats A, then C goes IN, A
 * goes OUT, and on the next pass B's only attacker is OUT so B goes back IN.
 *
 * Claims that never settle are UNDECIDED. That is a real state, not a bug: two
 * equally-ranked opposed sources is genuine conflict, and the honest answer is
 * that neither wins.
 */
export function argue(claims: EvidenceClaim[], ruleset: Ruleset): Argumentation {
  const attacks: Attack[] = [];
  for (const attacker of claims) {
    for (const target of claims) {
      const d = defeats(attacker, target, ruleset);
      if (d) attacks.push({ attackerId: attacker.id, targetId: target.id, byRule: d.byRule, rationale: d.rationale });
    }
  }

  const attackersOf = new Map<string, Attack[]>();
  for (const c of claims) attackersOf.set(c.id, []);
  for (const a of attacks) attackersOf.get(a.targetId)!.push(a);

  /** Bind the shared ranking to this ruleset. Imported from rules.ts rather than
   * re-implemented: the two copies were identical, and an ordering that exists
   * twice is an ordering that eventually disagrees with itself. */
  const rank = (byRule: RuleId): number => precedenceRank(byRule, ruleset);

  /**
   * Among several surviving attackers of a defeated claim, pick the one to
   * report as "the" defeater deterministically - by strength of defeat
   * (highest-precedence rule), not by array/input position. Ties break on
   * attackerId. This is more than tie-breaking for its own sake: the most
   * informative thing to show a toxicologist is the STRONGEST reason a claim
   * fell, and that must not depend on the order evidence happened to load in.
   */
  function strongestKiller(survivors: Attack[]): Attack {
    return survivors.reduce((best, cand) => {
      const bestRank = rank(best.byRule);
      const candRank = rank(cand.byRule);
      if (candRank !== bestRank) return candRank < bestRank ? cand : best;
      return cand.attackerId < best.attackerId ? cand : best;
    });
  }

  const IN = new Set<string>();
  const OUT = new Set<string>();
  const settled = (id: string) => IN.has(id) || OUT.has(id);

  // Fixpoint. Bounded by claims.length iterations - each pass settles at least
  // one claim or we stop, so this cannot loop forever.
  for (let pass = 0; pass <= claims.length; pass++) {
    const newlyIn = claims
      .filter((c) => !settled(c.id))
      .filter((c) => attackersOf.get(c.id)!.every((a) => OUT.has(a.attackerId)))
      .map((c) => c.id);
    if (newlyIn.length === 0) break;
    for (const id of newlyIn) IN.add(id);

    for (const c of claims) {
      if (settled(c.id)) continue;
      if (attackersOf.get(c.id)!.some((a) => IN.has(a.attackerId))) OUT.add(c.id);
    }
  }

  const statuses = new Map<string, ClaimStatus>();
  const trace: TraceStep[] = [];

  for (const c of claims) {
    const incoming = attackersOf.get(c.id)!;

    if (OUT.has(c.id)) {
      const killer = strongestKiller(incoming.filter((a) => IN.has(a.attackerId)));
      statuses.set(c.id, "defeated");
      trace.push({
        claimId: c.id,
        status: "defeated",
        byRule: killer.byRule,
        defeatedBy: killer.attackerId,
        rationale: killer.rationale,
      });
      continue;
    }

    if (!IN.has(c.id)) {
      statuses.set(c.id, "undecided");
      trace.push({
        claimId: c.id,
        status: "undecided",
        rationale:
          "Caught in a cycle of mutual defeats: this claim is attacked, and every " +
          "attacker is itself attacked from within the same cycle, so grounded " +
          "semantics never settles whether any of them stands. Not 'outranked' - no " +
          "rule ever wins the comparison. Contributes uncommitted mass only.",
      });
      continue;
    }

    // IN. Two sub-cases: R4 downweighting, and reinstatement.
    const dw = downweightFactor(c, ruleset);
    if (dw) {
      statuses.set(c.id, "downweighted");
      trace.push({ claimId: c.id, status: "downweighted", byRule: dw.byRule, rationale: dw.rationale });
      continue;
    }

    statuses.set(c.id, "admitted");
    const wasAttacked = incoming.length > 0;
    trace.push({
      claimId: c.id,
      status: "admitted",
      rationale: wasAttacked
        ? `Reinstated: attacked by ${incoming.map((a) => a.attackerId).join(", ")}, but every attacker was itself defeated.`
        : "Admitted; unchallenged.",
    });
  }

  return { statuses, attacks, trace };
}
