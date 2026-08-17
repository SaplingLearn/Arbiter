import { describe, expect, it } from "vitest";
import { STATES } from "@arbiter/atmosphere";
import { CODENAME, NAV, codenameFor, currentNav, sceneFor, transitionFor } from "../src/shell/nav.js";
import type { Route } from "../src/router.js";

/**
 * THE RAIL AND THE BACKDROP ARE ONE DECISION, and nothing was checking that they
 * agreed.
 *
 * nav.ts opens by saying so: kept apart, the menu entry and the scene behind it drift
 * the first time a tab is reordered or a scene renamed, "and the failure is silent: a
 * rail that says ARCHIVE over a field of cells". Every failure this file catches is of
 * that shape - nothing throws, nothing renders blank, the product simply names the
 * wrong world. There was no test here at all until the Read entry was added, which is
 * how `record` spent its life lighting Dashboard over the Helix.
 *
 * `@arbiter/atmosphere` IS IMPORTED FOR REAL rather than stubbed. The scene ids and
 * codenames in NAV are claims ABOUT that package, and a stub would assert them against
 * a copy of themselves - which is precisely the second-copy failure `shot.mjs` already
 * demonstrated when it silently skipped a scene it had never mounted.
 */

/** A case route, with a caseId the assertions never look at. */
const on = (name: "case" | "position" | "reveal" | "record"): Route =>
  ({ name, caseId: "c1" });

/**
 * Every route the router can produce, named once so the three checks that must cover
 * ALL of them cannot quietly cover different subsets. The record and the two `read`
 * shapes are the ones that matter here: they are the routes with no menu entry, which
 * is where both bugs this file records actually lived.
 */
const EVERY_ROUTE: Route[] = [
  { name: "dashboard" }, { name: "new" }, { name: "cases" }, { name: "ask" },
  { name: "reading" }, { name: "signin" },
  on("case"), on("position"), on("reveal"), on("record"),
  { name: "read", caseId: "c1" },
  { name: "read", caseId: "c1", documentId: "d1", page: 9 },
];

describe("the rail against the scene registry", () => {
  it("gives every menu entry a scene the atmosphere package actually publishes", () => {
    for (const n of NAV) {
      const state = STATES.find((s) => s.id === n.scene);
      expect(state, `NAV entry "${n.label}" names scene "${n.scene}"`).toBeDefined();
    }
  });

  /**
   * THE LOCAL TABLE AGAINST THE REGISTRY THAT OWNS IT. `CODENAME` duplicates a field of
   * `STATES` on purpose - nav.ts explains why it cannot import the registry without
   * pulling `three` into the shell chunk - and this is where that duplication is paid
   * for. A name that drifts from the registry puts one scene's word under another
   * scene, which is the silent failure this whole file exists to catch.
   */
  it("names each scene the same thing the registry does", () => {
    for (const [scene, codename] of Object.entries(CODENAME)) {
      const state = STATES.find((s) => s.id === scene);
      expect(state, `CODENAME names scene "${scene}"`).toBeDefined();
      expect(state?.codename, `scene "${scene}"`).toBe(codename);
    }
  });

  /**
   * AND EVERY SCENE A ROUTE CAN REACH MUST BE IN IT. The check above only proves the
   * names present are right; it says nothing about one that is missing, and missing is
   * the shape this bug actually had. `record` had no name of its own, so the corner
   * borrowed the lit menu entry's and said ARCHIVE over the Helix.
   */
  it("has a name for every scene a route can stand in", () => {
    for (const r of EVERY_ROUTE) {
      expect(codenameFor(r), `route "${r.name}" stands in scene "${sceneFor(r)}"`)
        .toBeDefined();
    }
  });

  /**
   * THE CORNER AND THE BACKDROP, ASKED SEPARATELY AND COMPARED. This is the assertion
   * that fails on the original bug: before `codenameFor` existed the corner read the lit
   * menu entry, and for `{ name: "record" }` that answered `Archive` while `sceneFor`
   * mounted `record`, whose name is `Helix`.
   *
   * Written against the two questions rather than against the table, so it still means
   * something after the table is rewritten.
   */
  it("says the name of the scene actually drawn, on every route", () => {
    for (const r of EVERY_ROUTE) {
      const drawn = STATES.find((s) => s.id === sceneFor(r))?.codename;
      expect(codenameFor(r), `route "${r.name}"`).toBe(drawn);
    }
  });

  // navByScene resolves by scene id, so two entries sharing one would make the lookup
  // return whichever came first - silently, and correctly-looking.
  it("gives each entry a distinct scene", () => {
    expect(new Set(NAV.map((n) => n.scene)).size).toBe(NAV.length);
  });

  /**
   * EVERY SCENE A ROUTE CAN ASK FOR MUST EXIST, and this is the check that was missing
   * when the product could not draw its own reading surface.
   *
   * `Backdrop` registers from `STATES`, and the engine throws `unknown scene "x"` from
   * both `mount` and `transitionTo`. So "is this id in STATES" is not a tidiness
   * question - it is exactly the condition for the backdrop not throwing, and the
   * throw came out of an effect and unmounted the product.
   *
   * Written over ROUTES rather than over NAV because `sceneFor` answers for routes that
   * have no menu entry at all - the case routes, the record, and the reader - which is
   * precisely where the missing one was.
   */
  it("names a real scene for every route in the product", () => {
    for (const r of EVERY_ROUTE) {
      const scene = sceneFor(r);
      expect(STATES.map((s) => s.id), `route "${r.name}" asks for scene "${scene}"`)
        .toContain(scene);
    }
  });
});

describe("currentNav", () => {
  /**
   * THE INDEX BUG, GENERALISED. `currentNav` used NAV[2] and NAV[0] until an entry was
   * inserted second, which moved Library from 2 to 3 and lit the wrong entry on every
   * case route - silently, because an index that still resolves does not throw. This
   * asserts the property that made the lookup safe rather than the lookup itself, so
   * it survives the next reordering too.
   */
  it("lights the entry its own route belongs to, for every entry", () => {
    for (const n of NAV) {
      expect(currentNav(n.to), `entry "${n.label}"`).toBe(n);
    }
  });

  it("agrees with the backdrop about which scene each entry stands in", () => {
    for (const n of NAV) {
      expect(sceneFor(n.to), `entry "${n.label}"`).toBe(n.scene);
    }
  });

  it("lights the Library on the library route", () => {
    expect(currentNav({ name: "cases" })?.label).toBe("Library");
  });

  /**
   * EVERY CASE ROUTE LIGHTS THE LIBRARY, record included. Record is the one that was
   * wrong: it is not in NAV and it was not in the case-route branch, so it fell to the
   * closing `dashboard` fallback and the rail said CULTURE over a closing seal.
   */
  it.each(["case", "position", "reveal", "record"] as const)(
    "lights the Library on the %s route", (name) => {
      expect(currentNav(on(name))?.label).toBe("Library");
    });

  it("does not light the Dashboard on any case route", () => {
    for (const name of ["case", "position", "reveal", "record"] as const) {
      expect(currentNav(on(name))?.label, `route "${name}"`).not.toBe("Dashboard");
    }
  });
});

describe("reading", () => {
  it("puts Read between Dashboard and New case", () => {
    expect(NAV.map((n) => n.label)).toEqual(
      ["Dashboard", "Read", "New case", "Library", "Ask"],
    );
  });

  /**
   * BOTH READ ROUTES LIGHT READ, and this is the drift the entry was added to close.
   * `sceneFor` has always sent a case's reader to Section; before there was a Read
   * entry, `currentNav` sent it to the Library, so the rail and the corner readout
   * said ARCHIVE while a focal plane moved through a stained section.
   */
  it("lights Read from the room and from a case's reader alike", () => {
    expect(currentNav({ name: "reading" })?.label).toBe("Read");
    expect(currentNav({ name: "read", caseId: "c1" })?.label).toBe("Read");
    expect(currentNav({ name: "read", caseId: "c1", documentId: "d1", page: 12 })?.label)
      .toBe("Read");
  });

  it("stands both read routes in Section", () => {
    expect(sceneFor({ name: "reading" })).toBe("read");
    expect(sceneFor({ name: "read", caseId: "c1" })).toBe("read");
    expect(codenameFor({ name: "reading" })).toBe("Section");
  });

  /**
   * THE RECORD, WHICH IS WHERE THE CORNER AND THE MENU LEGITIMATELY DISAGREE.
   *
   * Both answers here are correct and they are different, which is the point of there
   * being two functions. The menu lights the Library because the record is the last
   * stage of a case and a case is one of the bodies in the Archive. The corner says
   * Helix because a seal closing is what is actually drawn behind it. One question is
   * "which part of the product", the other is "which place" - and the bug was answering
   * the second with the first.
   */
  it("lights the Library on the record while the corner says Helix", () => {
    expect(currentNav(on("record"))?.label).toBe("Library");
    expect(codenameFor(on("record"))).toBe("Helix");
  });

  // The one case route that leaves the Archive. If this ever equals "library" again,
  // the argument in sceneFor's comment has been undone without anyone saying so.
  it("keeps the case reader out of the Archive", () => {
    expect(sceneFor({ name: "read", caseId: "c1" })).not.toBe("library");
    expect(sceneFor({ name: "case", caseId: "c1" })).toBe("library");
  });
});

describe("transitionFor", () => {
  it("gives reading its own arrival rather than the default wipe", () => {
    expect(transitionFor("read")).not.toEqual(transitionFor("unknown-scene"));
  });

  // Every scene the rail can reach has a deliberate move; a missing one silently
  // becomes the default, which is the "one transition played identically" the file
  // warns turns a transition into a wipe.
  it("has a distinct arrival for each scene the rail names", () => {
    const moves = NAV.map((n) => JSON.stringify(transitionFor(n.scene)));
    expect(new Set(moves).size).toBe(NAV.length);
  });
});
