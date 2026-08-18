import { describe, expect, it } from "vitest";
import { STATES } from "@arbiter/atmosphere";
import { NAV, currentNav, sceneFor, transitionFor } from "../src/shell/nav.js";
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

describe("the rail against the scene registry", () => {
  it("gives every menu entry a scene the atmosphere package actually publishes", () => {
    for (const n of NAV) {
      const state = STATES.find((s) => s.id === n.scene);
      expect(state, `NAV entry "${n.label}" names scene "${n.scene}"`).toBeDefined();
    }
  });

  // The codename is what the corner readout prints. A NAV entry carrying a codename
  // the registry disagrees with would put one scene's name under another scene.
  it("names each scene the same thing the registry does", () => {
    for (const n of NAV) {
      expect(STATES.find((s) => s.id === n.scene)?.codename).toBe(n.codename);
    }
  });

  /**
   * DISTINCT DESTINATIONS, AND IT USED TO BE DISTINCT SCENES.
   *
   * The old rule existed because `currentNav` resolved entries by scene id, so two
   * entries sharing one made the lookup return whichever came first - silently, and
   * correctly-looking. That is no longer how the lookup works: `navByRoute` keys on the
   * route an entry points at, which held up when the Dashboard briefly shared the
   * Archive with the Library and would hold up again.
   *
   * So the invariant moves rather than being dropped. Two entries may share a world;
   * two entries sharing a DESTINATION would reintroduce the identical ambiguity in the
   * lookup that actually runs.
   */
  it("gives each entry a distinct destination", () => {
    expect(new Set(NAV.map((n) => n.to.name)).size).toBe(NAV.length);
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
    const routes: Route[] = [
      { name: "dashboard" }, { name: "new" }, { name: "cases" }, { name: "ask" },
      { name: "reading" }, { name: "signin" },
      on("case"), on("position"), on("reveal"), on("record"),
      { name: "read", caseId: "c1" },
      { name: "read", caseId: "c1", documentId: "d1", page: 9 },
    ];
    for (const r of routes) {
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
   * THE LOOKUP IS BY DESTINATION, NOT BY SCENE, and this is the case that proved it
   * had to be.
   *
   * The Dashboard was moved into the Archive so its field would draw one body per case,
   * which put TWO rail entries on the `library` scene. The lookup was a `find` by scene
   * id - it returns the first match - so the library page and all four case routes lit
   * DASHBOARD and printed its codename. The Dashboard has since gone back to the
   * Culture and no two entries share a scene today, but the lookup stays keyed on the
   * destination: entries sharing a world is a legitimate arrangement this file should
   * survive, and it did not.
   */
  it("lights each surface from its own route, not from the scene behind it", () => {
    expect(currentNav({ name: "dashboard" })?.label).toBe("Dashboard");
    expect(currentNav({ name: "cases" })?.label).toBe("Library");
    // Case routes stand in the Archive and light the Library, which is the pairing the
    // scene-keyed lookup got wrong the moment a second entry claimed that scene.
    expect(sceneFor({ name: "cases" })).toBe("library");
    expect(currentNav({ name: "case", caseId: "c1" })?.label).toBe("Library");
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
    expect(currentNav({ name: "reading" })?.codename).toBe("Section");
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

  /**
   * Every scene the rail can reach has a deliberate move; a missing one silently
   * becomes the default, which is the "one transition played identically" the file
   * warns turns a transition into a wipe.
   *
   * COUNTED OVER DISTINCT SCENES, NOT OVER ENTRIES. Two rail entries standing in the
   * same world share its arrival by definition - the Dashboard and the Library are both
   * the Archive, and giving them different tears would mean the same scene arriving two
   * ways depending on which tab you pressed. What the check is actually for is that no
   * two DIFFERENT worlds arrive identically.
   */
  it("has a distinct arrival for each scene the rail names", () => {
    const scenes = [...new Set(NAV.map((n) => n.scene))];
    const moves = scenes.map((s) => JSON.stringify(transitionFor(s)));
    expect(new Set(moves).size).toBe(scenes.length);
  });
});
