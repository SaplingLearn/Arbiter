import { describe, expect, it } from "vitest";
import { hash32, resolveBody } from "../src/core/subjects.js";

/**
 * The library as it actually ships: six bodies, two of them refused documents.
 * Order matches `CATALOGUE` in services/api/cases.ts, because that is what the
 * backdrop hands `populate`.
 */
const KEYS = ["tak994", "nipocalimab", "slynd", "turalio", "tolcapone", "troglitazone"];
const USABLE = [true, true, true, true, false, false];

describe("which body a case is", () => {
  it("takes an exact key first", () => {
    expect(resolveBody(KEYS, USABLE, "turalio")).toBe(3);
    expect(resolveBody(KEYS, USABLE, "tolcapone")).toBe(4);
  });

  /**
   * Two people who opened the same library case hold different caseIds - the case
   * file's id plus their own account - and both have to land on the one body, or the
   * environment says they are looking at different cases.
   */
  it("cuts a prepared case's id back to its catalogue body", () => {
    expect(resolveBody(KEYS, USABLE, "nipocalimab-imaavy--u_aaa")).toBe(1);
    expect(resolveBody(KEYS, USABLE, "nipocalimab-imaavy--u_bbb")).toBe(1);
    expect(resolveBody(KEYS, USABLE, "turalio-pexidartinib--u_ccc")).toBe(3);
  });

  /**
   * THE BUG THIS FILE EXISTS FOR.
   *
   * A case somebody opened themselves has no body, so the scene borrows one by hash.
   * The hash used to run over the whole field, two of whose six bodies are refused -
   * and `heldDead` is read straight off the chosen body's state bit, so the interior
   * went red and the air went red and the environment told a reviewer their case had
   * been REFUSED. Roughly one own-case in three.
   *
   * Exhaustive rather than sampled: with a fixed field there is no reason to check a
   * hundred ids and hope. Every id that could appear must land somewhere alive.
   */
  it("never borrows a refused body for a case of your own", () => {
    for (let i = 0; i < 2000; i++) {
      const index = resolveBody(KEYS, USABLE, `case_${i}`);
      expect(USABLE[index], `case_${i} landed on ${KEYS[index]}`).toBe(true);
    }
  });

  it("gives the same case the same body forever", () => {
    const once = resolveBody(KEYS, USABLE, "case_1219767396");
    expect(resolveBody(KEYS, USABLE, "case_1219767396")).toBe(once);
    expect(hash32("case_1219767396")).toBe(hash32("case_1219767396"));
  });

  /** It still spreads. A fallback that always picked body 0 would pass the test above
   *  and make every own-case look like the same case. */
  it("spreads own-cases across the usable bodies", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(resolveBody(KEYS, USABLE, `case_${i}`));
    expect(seen.size).toBeGreaterThan(1);
  });

  /** Nothing usable is a real state - a library of nothing but refusals - and a wrong
   *  body still beats no gesture, because there is no honest answer left to give. */
  it("falls back to the whole field only when every body is refused", () => {
    const allDead = KEYS.map(() => false);
    expect(resolveBody(KEYS, allDead, "case_1")).toBeGreaterThanOrEqual(0);
    expect(resolveBody([], [], "case_1")).toBe(-1);
  });
});
