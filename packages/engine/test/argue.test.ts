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

  it("terminates and leaves a genuine 4-cycle's members UNDECIDED rather than looping", () => {
    // 2-cycles are impossible (see the antisymmetry test above), but the attack
    // graph is BIPARTITE - attacks only ever cross the toxic/safe divide, since
    // conflictsWith() requires opposite assertions - so every cycle has even
    // length, and a 4-cycle is NOT excluded by antisymmetry alone: antisymmetry
    // only forbids a and b each defeating the other directly, it says nothing
    // about a -> b -> c -> d -> a.
    //
    // This is a REAL cycle against the actual R1-R6 ruleset (RS), constructed
    // by hand-tracing defeats() with precedenceOrder = ["R3","R1","R2","R5"]:
    //   a (toxic, human,    klimisch 4) --R1--> b (safe, rodent,    klimisch 1)
    //   b (safe,  rodent,   klimisch 1) --R5--> c (toxic, nonrodent, klimisch 2)
    //   c (toxic, nonrodent,klimisch 2) --R5--> d (safe, in_silico, klimisch 3)
    //   d (safe,  in_silico,klimisch 3) --R5--> a (toxic, human,    klimisch 4)
    // a beats b via R1 (human outranks animal) regardless of Klimisch, because
    // R1 outranks R5 in precedence - so b's much-better Klimisch never gets a
    // chance to reverse it. The other three edges are plain R5 (better Klimisch
    // wins at equal - here, matching null - key event), each one-directional
    // because the target's Klimisch is never better than its attacker's. No
    // other pair among these four conflicts (a/c are both toxic, b/d are both
    // safe), so this is exactly a 4-cycle with no extra edges.
    //
    // Grounded semantics leaves every member of such a cycle UNDECIDED, which
    // reason() maps to uncommitted mass. This test proves that branch is live
    // code reachable from the real ruleset, and that the fixpoint terminates
    // instead of looping forever on it.
    const a = claim({ id: "a", assertion: "toxic", system: "human", klimisch: 4 });
    const b = claim({ id: "b", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 1 });
    const c = claim({ id: "c", assertion: "toxic", system: "nonrodent", stream: "invivo_nonrodent", klimisch: 2 });
    const d = claim({ id: "d", assertion: "safe", system: "in_silico", stream: "qsar", klimisch: 3 });

    const r = argue([a, b, c, d], RS);

    expect(r.trace).toHaveLength(4);
    for (const id of ["a", "b", "c", "d"]) {
      expect(r.statuses.get(id)).toBe("undecided");
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

  it("attributes a defeat to the STRONGEST surviving attacker, independent of input order", () => {
    // X is attacked by two claims that both survive (neither Y nor Z is itself
    // defeated), via two different rules of different precedence:
    //   Y: human vs. X's rodent system -> beats X by R1 (precedence rank 1).
    //   Z: far better Klimisch, same (null) key event -> beats X by R5 (rank 3).
    // R1 outranks R5, so X's trace must always credit Y, never Z - regardless
    // of which order Y and Z appear in the input array. A naive
    // `incoming.find(...)` would instead credit whichever of Y/Z happened to
    // be pushed into the attacker list first, which tracks input order, not
    // rule strength - exactly the bug this test exists to catch.
    const X = claim({ id: "X", assertion: "toxic", system: "rodent", stream: "invivo_rodent", klimisch: 4 });
    const Y = claim({ id: "Y", assertion: "safe", system: "human", klimisch: 4 });
    const Z = claim({ id: "Z", assertion: "safe", system: "nonrodent", stream: "invivo_nonrodent", klimisch: 1 });

    const sortByClaimId = (r: ReturnType<typeof argue>) => [...r.trace].sort((a, b) => a.claimId.localeCompare(b.claimId));

    const orderA = argue([X, Y, Z], RS);
    const orderB = argue([Z, Y, X], RS);
    const orderC = argue([Y, X, Z], RS);

    // Sanity: this is actually the scenario intended - X defeated, credited to Y by R1.
    expect(orderA.statuses.get("X")).toBe("defeated");
    expect(orderA.statuses.get("Y")).toBe("admitted");
    expect(orderA.statuses.get("Z")).toBe("admitted");
    const xStep = orderA.trace.find((s) => s.claimId === "X")!;
    expect(xStep.byRule).toBe("R1");
    expect(xStep.defeatedBy).toBe("Y");

    // Content, not emission order, must be identical across input orderings.
    expect(sortByClaimId(orderB)).toEqual(sortByClaimId(orderA));
    expect(sortByClaimId(orderC)).toEqual(sortByClaimId(orderA));
  });
});
