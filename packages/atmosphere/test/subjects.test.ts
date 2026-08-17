import { describe, expect, it } from "vitest";
import { hash32, mergeSubjects, resolveBody } from "../src/core/subjects.js";

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

describe("populating the field with every case a reader can see", () => {
  const CATALOGUE = KEYS.map((key, i) => ({ key, usable: USABLE[i]! }));

  it("gives every own-case a body of its own", () => {
    const subjects = mergeSubjects(CATALOGUE, ["case_1", "case_2", "case_3"]);
    expect(subjects).toHaveLength(9);
    expect(subjects.slice(6).map((s) => s.key)).toEqual(["case_1", "case_2", "case_3"]);
  });

  /**
   * THE POINT OF THE WHOLE CHANGE. Before this, own-cases had no body and borrowed one,
   * so several of them shared a cube and flying to any of them landed on somebody
   * else's case. With a body each, `resolveBody` exact-matches and the borrow never
   * runs at all.
   */
  it("stops two cases ever sharing one cube", () => {
    const own = Array.from({ length: 40 }, (_, i) => `case_${i}`);
    const subjects = mergeSubjects(CATALOGUE, own);
    const keys = subjects.map((s) => s.key);
    const usable = subjects.map((s) => s.usable);

    const landedOn = own.map((id) => resolveBody(keys, usable, id));
    expect(new Set(landedOn).size).toBe(own.length);
    // And each one landed on ITS OWN body, not merely on a distinct one.
    own.forEach((id, i) => { expect(keys[landedOn[i]!]).toBe(id); });
  });

  /**
   * The opposite error, and just as wrong. Opening `nipocalimab` from the library mints
   * `nipocalimab-imaavy--<userId>` - the same case wearing an account's name, which
   * already resolves to the catalogue body. A second entry would draw one case twice.
   */
  it("does not draw an opened library case a second time", () => {
    const subjects = mergeSubjects(CATALOGUE, [
      "nipocalimab-imaavy--u_aaa",
      "turalio-pexidartinib--u_aaa",
      "tolcapone--u_aaa",
      "case_new",
    ]);
    expect(subjects).toHaveLength(7);
    expect(subjects.map((s) => s.key)).toContain("case_new");
    expect(subjects.filter((s) => s.key.startsWith("nipocalimab"))).toHaveLength(1);
    // Two people opening the same library case still add nothing.
    expect(mergeSubjects(CATALOGUE, ["nipocalimab-imaavy--u_a", "nipocalimab-imaavy--u_b"]))
      .toHaveLength(6);
  });

  it("never marks a case somebody opened as refused", () => {
    const subjects = mergeSubjects(CATALOGUE, ["case_1", "case_2"]);
    for (const s of subjects.slice(6)) expect(s.usable).toBe(true);
    // And the library's own two refusals are untouched.
    expect(subjects.filter((s) => !s.usable).map((s) => s.key)).toEqual(["tolcapone", "troglitazone"]);
  });

  it("is stable, and idempotent on the same input", () => {
    const once = mergeSubjects(CATALOGUE, ["case_1", "case_1", "case_2"]);
    expect(once.map((s) => s.key)).toEqual([...KEYS, "case_1", "case_2"]);
    expect(mergeSubjects(CATALOGUE, [])).toEqual(CATALOGUE);
  });
});
