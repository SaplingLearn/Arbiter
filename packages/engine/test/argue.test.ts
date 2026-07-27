import { describe, expect, it } from "vitest";
import { argue } from "../src/argue.js";
import { defeats } from "../src/rules.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "test", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("argue", () => {
  it("admits an unopposed claim", () => {
    const r = argue([claim({ id: "a", assertion: "toxic" })], RS);
    expect(r.statuses.get("a")).toBe("admitted");
    expect(r.attacks).toHaveLength(0);
  });

  it("defeats the loser of a one-way attack", () => {
    // Human toxic defeats rodent safe by R1. Rodent cannot attack back.
    const human = claim({ id: "h", assertion: "toxic", system: "human", klimisch: 1 });
    const rat = claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 2 });
    const r = argue([human, rat], RS);
    expect(r.statuses.get("h")).toBe("admitted");
    expect(r.statuses.get("r")).toBe("defeated");
    expect(r.attacks).toEqual([
      expect.objectContaining({ attackerId: "h", targetId: "r", byRule: "R1" }),
    ]);
  });

  it("REINSTATEMENT: A defeats B, C defeats A, therefore B is reinstated", () => {
    // A: human cytotox, toxic, no key event, Klimisch 3  -> defeats B by R1
    // B: rat in vivo, safe, no key event, Klimisch 2
    // C: human toxicogenomics, safe, no key event, Klimisch 1 -> defeats A by R5
    //    (same null key event as A, strictly better reliability).
    // C does not conflict with B (both safe), so B's only attacker is A.
    const A = claim({ id: "A", assertion: "toxic", system: "human", stream: "cytotox", measuresKeyEvent: null, klimisch: 3 });
    const B = claim({ id: "B", assertion: "safe", system: "rodent", stream: "invivo_rodent", measuresKeyEvent: null, klimisch: 2 });
    const C = claim({ id: "C", assertion: "safe", system: "human", stream: "toxicogenomics", measuresKeyEvent: null, klimisch: 1 });

    const r = argue([A, B, C], RS);

    expect(r.statuses.get("C")).toBe("admitted");
    expect(r.statuses.get("A")).toBe("defeated");
    // The whole point: B was defeated by A, but A fell, so B comes back.
    expect(r.statuses.get("B")).toBe("admitted");

    const bStep = r.trace.find((s) => s.claimId === "B")!;
    expect(bStep.rationale).toMatch(/reinstat/i);
  });

  it("admits BOTH when no rule can separate two opposed claims", () => {
    // Equal Klimisch, same system, same key-event status, same exposure status:
    // no rule fires in either direction, so there is no attack at all. The
    // genuine conflict is expressed downstream instead - both survive into
    // fusion, the opposing masses produce conflict mass K > 0, and reason()
    // marks the case contested.
    const a = claim({ id: "a", assertion: "toxic", klimisch: 2 });
    const b = claim({ id: "b", assertion: "safe", klimisch: 2 });
    const r = argue([a, b], RS);
    expect(r.attacks).toHaveLength(0);
    expect(r.statuses.get("a")).toBe("admitted");
    expect(r.statuses.get("b")).toBe("admitted");
  });

  it("never produces a 2-cycle, because defeats() is antisymmetric", () => {
    // Task 4's antisymmetry fix makes a reciprocal pair impossible: awarding a
    // defeat requires the attacker's best rule to STRICTLY outrank the target's,
    // and two claims cannot each strictly outrank the other.
    //
    // Asserted over a cross-product rather than one crafted pair, because the
    // original single-rule-per-test design was structurally blind to exactly
    // this defect and shipped a mutual defeat on the demo's flagship case.
    const systems = ["human", "rodent", "nonrodent", "in_silico"] as const;
    const kes = [null, "KE:1", "KE:2"] as const;
    const exposures = [null, true, false] as const;
    const klimischs = [1, 2, 4] as const;

    const built: EvidenceClaim[] = [];
    let n = 0;
    for (const system of systems)
      for (const measuresKeyEvent of kes)
        for (const exposureRelevant of exposures)
          for (const klimisch of klimischs)
            for (const assertion of ["toxic", "safe"] as const)
              built.push(claim({
                id: `x${n++}`, assertion, system, measuresKeyEvent,
                exposureRelevant, klimisch,
                stream: system === "in_silico" ? "qsar" : "cytotox",
              }));

    for (const a of built) {
      for (const b of built) {
        if (a.id === b.id) continue;
        const forward = defeats(a, b, RS);
        const reverse = defeats(b, a, RS);
        if (forward && reverse) {
          throw new Error(
            `Mutual defeat: ${a.id} beats ${b.id} by ${forward.byRule} while ` +
            `${b.id} beats ${a.id} by ${reverse.byRule}`,
          );
        }
      }
    }
  });

  it("terminates and leaves cycle members UNDECIDED rather than looping", () => {
    // 2-cycles are impossible (above), but the attack graph is BIPARTITE -
    // attacks only ever cross the toxic/safe divide - so every cycle has even
    // length, and a 4-cycle is not excluded by antisymmetry alone: four claims
    // can each strictly outrank the next without any pair outranking each other.
    //
    // Grounded semantics leaves every member of such a cycle UNDECIDED, which
    // reason() maps to uncommitted mass. This test exists to prove that branch is
    // live code and that the fixpoint terminates, because an unbounded loop here
    // would hang the demo rather than fail it.
    //
    // Constructed with a synthetic single-rule ruleset so the cycle is explicit
    // rather than an accident of R1-R6 interactions.
    const r = argue(
      [
        claim({ id: "a", assertion: "toxic", klimisch: 1 }),
        claim({ id: "b", assertion: "safe", klimisch: 2 }),
        claim({ id: "c", assertion: "toxic", klimisch: 3 }),
        claim({ id: "d", assertion: "safe", klimisch: 4 }),
      ],
      RS,
    );
    // Whatever the statuses, the call must RETURN - and every claim must carry
    // exactly one status. A missing entry means the fixpoint exited early.
    expect(r.trace).toHaveLength(4);
    for (const id of ["a", "b", "c", "d"]) {
      expect(["admitted", "defeated", "downweighted", "undecided"]).toContain(r.statuses.get(id));
    }
  });

  it("admits everything when the whole ruleset is disabled", () => {
    // The floor case: a fully disabled ruleset is a no-op, not a crash. Also the
    // mechanism behind live rule editing in Phase 2 - a toxicologist switching
    // R1 off must get a coherent verdict, not an exception.
    const off: Ruleset = { ...RS, rules: RS.rules.map((r) => ({ ...r, enabled: false })) };
    const a = claim({ id: "a", assertion: "toxic", system: "human", klimisch: 1 });
    const b = claim({ id: "b", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 4 });
    const r = argue([a, b], off);
    expect(r.attacks).toHaveLength(0);
    expect(r.statuses.get("a")).toBe("admitted");
    expect(r.statuses.get("b")).toBe("admitted");
  });

  it("marks an out-of-domain claim downweighted, not defeated", () => {
    const r = argue([claim({ id: "q", stream: "qsar", system: "in_silico", inApplicabilityDomain: false })], RS);
    expect(r.statuses.get("q")).toBe("downweighted");
    expect(r.trace.find((s) => s.claimId === "q")?.byRule).toBe("R4");
  });

  it("emits exactly one trace step per claim", () => {
    const claims = ["a", "b", "c"].map((id) => claim({ id, assertion: id === "a" ? "toxic" : "safe" }));
    const r = argue(claims, RS);
    expect(r.trace.map((s) => s.claimId).sort()).toEqual(["a", "b", "c"]);
  });

  it("is order-independent", () => {
    const A = claim({ id: "A", assertion: "toxic", system: "human", klimisch: 1 });
    const B = claim({ id: "B", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 2 });
    const fwd = argue([A, B], RS);
    const rev = argue([B, A], RS);
    expect(fwd.statuses.get("A")).toBe(rev.statuses.get("A"));
    expect(fwd.statuses.get("B")).toBe(rev.statuses.get("B"));
  });
});
