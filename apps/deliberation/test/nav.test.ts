import { describe, expect, it } from "vitest";
import { CODENAME, NAV, codenameFor, currentNav, sceneFor } from "../src/shell/nav.js";
import type { Route } from "../src/router.js";

/**
 * THE CHROME MAY NOT NAME A PLACE THE READER IS NOT IN.
 *
 * `nav.ts` opens by saying the rail and the backdrop are one decision, and that kept
 * apart they drift silently - a rail reading ARCHIVE over a field of cells. The drift
 * arrived from the side the note did not expect: the corner readout took its name from
 * whichever MENU entry was lit, and two of the six environments have no menu entry.
 * Reading and the record are reached from inside a case, so both borrowed somebody
 * else's name and the corner announced the wrong world.
 *
 * These tests are written against the two questions rather than against the table, so
 * they still mean something if the table is rewritten: which place is drawn, and which
 * part of the product is highlighted.
 */

const caseId = "nipocalimab-imaavy--u_1";

describe("the environment a route stands in", () => {
  it("names every scene the product can mount", () => {
    // Not a count - the number has been wrong twice already, per the registry's own
    // note. Every scene `sceneFor` can return has to have a name, whichever they are.
    const reachable: Route[] = [
      { name: "dashboard" }, { name: "new" }, { name: "cases" }, { name: "ask" },
      { name: "case", caseId }, { name: "position", caseId }, { name: "reveal", caseId },
      { name: "read", caseId }, { name: "record", caseId },
    ];
    for (const route of reachable) {
      expect(CODENAME[sceneFor(route)], `no codename for ${route.name}`).toBeDefined();
      expect(codenameFor(route)).toBeDefined();
    }
  });

  it("says SECTION on the reading surface, not the name of the library it came from", () => {
    expect(sceneFor({ name: "read", caseId })).toBe("read");
    expect(codenameFor({ name: "read", caseId })).toBe("Section");
  });

  it("says HELIX on the record, not the name of the dashboard it fell through to", () => {
    expect(sceneFor({ name: "record", caseId })).toBe("record");
    expect(codenameFor({ name: "record", caseId })).toBe("Helix");
  });

  it("agrees with the backdrop on every route, because it is asking the backdrop", () => {
    // The one property worth protecting: the corner cannot say a different word from
    // the scene that mounted, because it is derived from the same call.
    const routes: Route[] = [
      { name: "dashboard" }, { name: "cases" }, { name: "read", caseId }, { name: "record", caseId },
    ];
    for (const route of routes) {
      expect(codenameFor(route)).toBe(CODENAME[sceneFor(route)]);
    }
  });
});

describe("the menu entry a route lights", () => {
  it("lights the library on every stage of an open case, the record included", () => {
    // `record` was the one missing from this list and fell through to the Dashboard,
    // which is the single entry that is not where the reader is standing: the menu
    // disagreed with the breadcrumb, the case title and the stage strip at once.
    const stages: Route[] = [
      { name: "case", caseId }, { name: "read", caseId }, { name: "position", caseId },
      { name: "reveal", caseId }, { name: "record", caseId },
    ];
    for (const route of stages) {
      expect(currentNav(route)?.label, `${route.name} lit the wrong entry`).toBe("Library");
    }
  });

  it("still lights the four top-level entries themselves", () => {
    expect(currentNav({ name: "dashboard" })?.label).toBe("Dashboard");
    expect(currentNav({ name: "new" })?.label).toBe("New case");
    expect(currentNav({ name: "cases" })?.label).toBe("Library");
    expect(currentNav({ name: "ask" })?.label).toBe("Ask");
  });

  it("has a scene for every menu entry", () => {
    for (const item of NAV) expect(CODENAME[item.scene], `${item.label}`).toBeDefined();
  });
});
