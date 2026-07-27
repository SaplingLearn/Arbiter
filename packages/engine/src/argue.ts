import { defeats, downweightFactor } from "./rules.js";
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
      const killer = incoming.find((a) => IN.has(a.attackerId))!;
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
        rationale: "Opposed by evidence of equal standing; no rule separates them. Contributes uncommitted mass only.",
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
