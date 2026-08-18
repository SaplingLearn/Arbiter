import { describe, expect, it } from "vitest";
import { fieldFor } from "../src/shell/Backdrop.js";
import type { CaseSummary } from "../src/api.js";

/**
 * The population rule, which decides what the Archive draws behind each surface.
 *
 * It is tested here rather than through the component because the component needs a
 * WebGL context to do anything at all, and every failure this file pins was a failure
 * of arithmetic over lists - one that reached a reader as a colour, a count, or an
 * empty screen, and none of which a renderer would have reported.
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

const refused = (s: { usable: boolean }[]): number => s.filter((x) => !x.usable).length;

describe("fieldFor", () => {
  it("draws the library's shelf, and only it, on the library list", () => {
    const f = fieldFor("cases", shelf, mine);
    expect(f.map((s) => s.key)).toEqual(["tak994", "turalio", "tolcapone", "troglitazone"]);
    // The count is the point of this branch: the table above it is countable.
    expect(f).toHaveLength(shelf.length);
  });

  it("draws the reader's own cases on the dashboard, one body each", () => {
    const f = fieldFor("dashboard", shelf, mine);
    expect(f.map((s) => s.key)).toEqual(["turalio-pexidartinib--u_1", "case_bms_986165"]);
    expect(f.every((s) => s.usable)).toBe(true);
  });

  /**
   * A brand-new account has no cases, and an Archive with no bodies has no ground
   * lights either - which reads as a broken background rather than as an empty list.
   */
  it("falls back to the shelf rather than an empty field on a dashboard with no cases", () => {
    expect(fieldFor("dashboard", shelf, [])).toHaveLength(shelf.length);
    expect(fieldFor("dashboard", [], [])).toHaveLength(0); // nothing to fall back TO
  });

  /**
   * THE REGRESSION THIS FILE EXISTS FOR.
   *
   * Own cases are all usable by construction - a refused document cannot be opened, the
   * server answers 422 - so a case route drawing own cases ALONE held no refused body,
   * and the library's two red cubes turned blue on the way in.
   */
  it("keeps the library's refusals red on every case route", () => {
    expect(refused(fieldFor("cases", shelf, mine))).toBe(2);
    for (const r of ["case", "position", "reveal", "report", "record"] as const) {
      expect(refused(fieldFor(r, shelf, mine)), r).toBe(2);
    }
  });

  /**
   * An opened library case is the same case wearing an account's name, not a second
   * case: `nipocalimab-imaavy--<userId>` already resolves to the catalogue body by
   * prefix, so adding it again would put two cubes on screen for one case.
   */
  it("does not give an opened library case a second body", () => {
    const f = fieldFor("case", shelf, mine);
    expect(f.map((s) => s.key)).not.toContain("turalio-pexidartinib--u_1");
    expect(f.map((s) => s.key)).toContain("case_bms_986165");
    expect(new Set(f.map((s) => s.key)).size).toBe(f.length);
  });

  it("gives every case a distinct body on every surface", () => {
    for (const r of ["cases", "dashboard", "case", "read", "ask", "new"] as const) {
      const f = fieldFor(r, shelf, mine);
      expect(new Set(f.map((s) => s.key)).size, r).toBe(f.length);
    }
  });
});
