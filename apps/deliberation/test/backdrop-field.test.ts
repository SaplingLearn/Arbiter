import { describe, expect, it } from "vitest";
import { fieldFor } from "../src/shell/Backdrop.js";
import type { CaseSummary } from "../src/api.js";

/**
 * The population rule, which decides what the Archive draws behind every surface.
 *
 * Tested here rather than through the component because the component needs a WebGL
 * context to do anything at all, while every failure this file pins was arithmetic over
 * lists - one that reached a reader as a colour, a count, an empty screen, or an archive
 * that rearranged itself while they walked into it. None of those is a thing a renderer
 * would have reported.
 */

const shelf: CaseSummary[] = [
  { name: "tak994", label: "TAK-994", shape: "", usable: true },
  { name: "turalio", label: "Turalio", shape: "", usable: true },
  { name: "tolcapone", label: "Tolcapone", shape: "", usable: false },
  { name: "troglitazone", label: "Troglitazone", shape: "", usable: false },
] as CaseSummary[];

const mine = [
  { caseId: "turalio-pexidartinib--u_1" }, // an OPENED library case
  { caseId: "case_bms_986165" },           // and one of the reader's own
];

/** Every surface a reader can stand on, as `Backdrop` sees them. */
const SURFACES = ["dashboard", "cases", "case", "position", "reveal", "report",
  "record", "read", "reading", "ask", "new", "signin"] as const;

describe("fieldFor", () => {
  /**
   * THE REGRESSION THIS FILE EXISTS FOR, and the reason the rule stopped varying by
   * surface at all.
   *
   * `archive.ts` lays its field out from ONE seeded sequence walked in index order, over
   * a span of `max(30, n * 8.5)`. A different count rescales the span and a different
   * membership shifts every draw, so ANY variation between two surfaces re-lays the
   * whole archive on the way from one to the other - and the tower the camera was flying
   * into is somewhere else when it arrives. The field is a place; places do not move.
   *
   * Note what this asserts: not that the rule is correct, but that it is the SAME. A
   * future branch on the route would fail here however sensible it looked.
   */
  it("draws the identical field on every surface", () => {
    // TAKES NO ROUTE, which is the assertion: a field that cannot see where the reader
    // is standing cannot lay itself out differently depending on it. `fieldFor(route,
    // catalogue, mine)` is what this replaced, and a branch on the route is what the
    // arity check would catch coming back.
    expect(fieldFor).toHaveLength(2);
    const first = fieldFor(shelf, mine);
    // Same inputs, same field, every time it is asked - the engine is re-told this on
    // every poll, and a field that differed between two identical calls would jump.
    for (const surface of SURFACES) {
      const again = fieldFor(shelf, mine);
      expect(again, surface).toEqual(first);
      // Order too, because position is decided by index into this array.
      expect(again.map((s) => s.key), surface).toEqual(first.map((s) => s.key));
    }
  });

  /**
   * Own cases are all usable by construction - a refused document cannot be opened, the
   * server answers 422 - so a field of own cases ALONE held no refused body, and the
   * library's two red cubes turned blue when a case route swapped the field for one.
   * Refusal is a property of the catalogue, so the catalogue stays in the field.
   */
  it("keeps the library's refusals, and only those, red", () => {
    const f = fieldFor(shelf, mine);
    expect(f.filter((s) => !s.usable).map((s) => s.key)).toEqual(["tolcapone", "troglitazone"]);
  });

  /**
   * An opened library case is the same case wearing an account's name, not a second
   * case: `turalio-pexidartinib--<userId>` already resolves to the catalogue body by
   * prefix, so adding it again would put two cubes on screen for one case.
   */
  it("gives every case one body, and an opened library case no second one", () => {
    const f = fieldFor(shelf, mine);
    expect(f.map((s) => s.key)).not.toContain("turalio-pexidartinib--u_1");
    expect(f.map((s) => s.key)).toContain("case_bms_986165");
    expect(new Set(f.map((s) => s.key)).size).toBe(f.length);
  });

  it("keeps the catalogue at the front, so the shelf holds a stable order", () => {
    expect(fieldFor(shelf, mine).slice(0, shelf.length).map((s) => s.key))
      .toEqual(["tak994", "turalio", "tolcapone", "troglitazone"]);
  });

  it("is empty only when there is genuinely nothing to draw", () => {
    expect(fieldFor([], [])).toHaveLength(0);
    expect(fieldFor(shelf, []).length).toBe(shelf.length);
    expect(fieldFor([], mine).length).toBe(mine.length);
  });
});
