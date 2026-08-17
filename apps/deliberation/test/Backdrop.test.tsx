import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { STATE_IDS } from "@arbiter/atmosphere";
import { Backdrop } from "../src/shell/Backdrop.js";
import { sceneFor } from "../src/shell/nav.js";
import type { Route } from "../src/router.js";

/**
 * THE SCENE THE PRODUCT ASKS FOR HAS TO BE A SCENE THE ENGINE HAS.
 *
 * `sceneFor` names an environment per route and the engine holds a catalogue keyed by
 * the same ids. Nothing checks that the two agree, and the failure when they do not is
 * the worst kind: `transitionTo` throws for an unknown id, the throw happens inside an
 * effect, and React responds to an effect that threw by unmounting the tree. The whole
 * product goes dark over a background.
 */

const EVERY_ROUTE: Route[] = [
  { name: "signin" },
  { name: "dashboard" },
  { name: "new" },
  { name: "cases" },
  { name: "case", caseId: "c1" },
  { name: "position", caseId: "c1" },
  { name: "reveal", caseId: "c1" },
  { name: "record", caseId: "c1" },
  { name: "read", caseId: "c1" },
  { name: "ask" },
];

describe("the scene catalogue", () => {
  it("has a scene for every environment a route can name", () => {
    for (const route of EVERY_ROUTE) {
      const scene = sceneFor(route);
      expect(STATE_IDS, `route "${route.name}" wants scene "${scene}", which no state defines`)
        .toContain(scene);
    }
  });
});

/**
 * The engine, minus WebGL. `register`, `mount` and `transitionTo` keep the real class's
 * contract exactly - an id that was never registered is an error, not a no-op (see
 * core/Atmosphere.ts) - because that throw IS the bug being reproduced here. A forgiving
 * fake would pass against the broken code and prove nothing.
 *
 * Hoisted, because `vi.mock` is: the factory below runs before any top-level statement
 * in this file, so a class declared out here does not exist yet when it reads it.
 */
const engine = vi.hoisted(() => {
  const registered: string[] = [];
  const moves: string[] = [];
  /* Stands in for the faults a renderer really produces mid-session - a shader that
     will not compile on this driver, a lost context - none of which can be provoked
     from a test but all of which arrive as a throw from exactly this call. */
  const refuse = { transitions: false };

  class FakeAtmosphere {
    private readonly scenes = new Set<string>();
    private id = "";

    get activeId(): string { return this.id; }

    register(id: string): void {
      this.scenes.add(id);
      registered.push(id);
    }

    mount(id: string): void {
      if (!this.scenes.has(id)) throw new Error(`atmosphere: unknown scene "${id}"`);
      this.id = id;
      moves.push(`mount:${id}`);
    }

    transitionTo(id: string): void {
      if (refuse.transitions) throw new Error("atmosphere: the renderer gave up");
      if (!this.scenes.has(id)) throw new Error(`atmosphere: unknown scene "${id}"`);
      this.id = id;
      moves.push(`to:${id}`);
    }

    resize(): void {}
    populate(): void {}
    focus(): void {}
    reveal(): void {}
    start(): void {}
    stop(): void {}
    dispose(): void {}
  }

  return { registered, moves, refuse, FakeAtmosphere };
});

const { registered, moves, refuse } = engine;

// Only the renderer is replaced. STATES and the scene factories stay real, so this
// tests the catalogue the product actually ships rather than one written for the test.
vi.mock("@arbiter/atmosphere", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@arbiter/atmosphere")>()),
  Atmosphere: engine.FakeAtmosphere,
}));

describe("the backdrop", () => {
  const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); }); };

  beforeEach(() => { registered.length = 0; moves.length = 0; refuse.transitions = false; });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("registers every state the package publishes", async () => {
    render(<Backdrop route={{ name: "dashboard" }} catalogue={[]} focusKey={null} />);
    await flush();
    for (const id of STATE_IDS) expect(registered).toContain(id);
  });

  /**
   * The reported failure, in the order a reader produces it: open a case, then press
   * Read & mark. Before the fix this threw `unknown scene "read"` out of the effect and
   * took the page down with it.
   */
  it("moves to the reading scene without taking the page down", async () => {
    const { rerender } = render(
      <Backdrop route={{ name: "case", caseId: "c1" }} catalogue={[]} focusKey={null} />,
    );
    await flush();

    rerender(<Backdrop route={{ name: "read", caseId: "c1" }} catalogue={[]} focusKey={null} />);
    await flush();

    expect(moves).toContain("to:read");
  });

  /**
   * The same route reached by opening its URL directly, which takes the mount path
   * rather than the transition. It failed there too - silently, because that call sits
   * inside the loader's try/catch - and a reader who reloaded got a product with no
   * scene at all. That is why reloading "fixed" it.
   */
  it("mounts straight into the reading scene on a deep link", async () => {
    render(<Backdrop route={{ name: "read", caseId: "c1" }} catalogue={[]} focusKey={null} />);
    await flush();
    expect(moves).toContain("mount:read");
  });

  /**
   * THE FILE'S OWN RULE, APPLIED TO THE OTHER EFFECT.
   *
   * "A background may not take the product down with it" is the header of Backdrop.tsx,
   * and the loader honours it - everything there is inside a try and the failure path is
   * simply no canvas. The scene CHANGE was not, so a throw from the renderer during
   * navigation escaped into React, which unmounts a tree whose effect threw. That is the
   * difference between the missing scene and the dark page: one is the fault, the other
   * is the whole product going with it.
   *
   * Fixing the catalogue removed this particular throw. It did not remove the class of
   * them - a driver that refuses a shader mid-session arrives at the same line.
   */
  it("survives a renderer that fails during a scene change", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container, rerender } = render(
      <Backdrop route={{ name: "dashboard" }} catalogue={[]} focusKey={null} />,
    );
    await flush();

    refuse.transitions = true;
    rerender(<Backdrop route={{ name: "ask" }} catalogue={[]} focusKey={null} />);
    await flush();

    expect(container.querySelector("canvas.backdrop")).not.toBeNull();
    expect(logged).toHaveBeenCalled();
  });
});
