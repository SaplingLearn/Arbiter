import { useEffect, useRef, type ReactElement } from "react";
import type { Atmosphere, SceneSubject } from "@arbiter/atmosphere";
/* The population rule, from the entry point that reaches no graphics. A value import
   from "@arbiter/atmosphere" would pull `three` into first paint - see the note on the
   dynamic import below, which exists to stop precisely that. */
import { mergeSubjects } from "@arbiter/atmosphere/subjects";
import type { CaseSummary } from "../api.js";
import { type Route } from "../router.js";
import { sceneFor, transitionFor } from "./nav.js";

/**
 * THE LIVING BACKGROUND.
 *
 * One WebGL context for the whole session, a scene per surface, and a band-tear
 * transition when you move between them. The scenes come from
 * `packages/atmosphere`, where they were written for exactly these tabs.
 *
 * A BACKGROUND MAY NOT TAKE THE PRODUCT DOWN WITH IT. This is a few thousand lines
 * of shader against a driver surface that varies by machine, and the failure without
 * a guard is the one the landing page already hit once: a bad renderer property threw
 * from an effect, React unmounted the tree, and the page went blank - over a fault in
 * the DECORATION behind the type. Everything here is inside a try/catch and the
 * failure path is simply no canvas. The product is a dark page with glass panels on
 * it, which is a product; the artwork is the part that is allowed to be missing.
 *
 * `three` is ~500KB, more than the whole rest of this bundle, and it draws scenery.
 * Imported dynamically so it never blocks first paint - the case list is on screen
 * and usable before the environment arrives behind it.
 */
export function Backdrop({ route, catalogue, mine = [], focusKey }: {
  route: Route;
  catalogue: CaseSummary[];
  /** The viewer's own cases. See the population effect below for why the field is not
   *  the catalogue alone. */
  mine?: { caseId: string }[];
  /**
   * Which case the environment should single out, or null for the wide shot.
   *
   * DERIVED BY THE APP, not from the route here, and that is the whole point of the
   * prop. A refused case never becomes a route: the server answers the open with a 422
   * and the reader stays on the library looking at the reason. So `caseIdOf(route)` was
   * null for exactly the cases the Archive draws in red, and the refused interior - the
   * one composition written for a failure - could not be reached from the product at
   * all. The app knows it is showing a refusal; this lets it say so.
   */
  focusKey: string | null;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const atmoRef = useRef<Atmosphere | null>(null);
  /* The scene the LAST effect asked for. Route changes can outrun the dynamic
     import on a cold load, and without this the engine mounts whichever scene won
     the race rather than the one the reader is looking at. */
  const wanted = useRef(sceneFor(route));
  /* Same race, for the focus key: a reader can land straight on a case URL, and the
     effect that announces the key runs long before `three` has finished arriving. */
  const wantedKey = useRef(focusKey);
  /* And again for the population. This one loses the race almost every time rather
     than occasionally - the catalogue is a fetch, so on a cold load it arrives after
     the engine, and on a warm one before it. Whoever finishes last wins by reading
     this. */
  const wantedSubjects = useRef<SceneSubject[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    let live = true;
    let atmo: Atmosphere | null = null;

    void (async () => {
      try {
        const mod = await import("@arbiter/atmosphere");
        if (!live) return;

        atmo = new mod.Atmosphere(canvas);

        /**
         * REGISTERED FROM THE REGISTRY, and this was five hand-written lines that had
         * gone stale.
         *
         * `createSection` was missing from them. Nothing said so: the scene existed, it
         * was registered in `scenes/registry.ts`, the demo shell in `apps/atmosphere`
         * mounted it happily because that shell iterates STATES - and this list, the
         * only one the PRODUCT reads, had never gained the entry. So every reader who
         * opened Read & mark hit `transitionTo("read")` against an engine that had
         * never heard of it.
         *
         * This is the third copy of one list to go wrong the same way in this codebase
         * - `apps/atmosphere/shot.mjs` skipped a scene it had never mounted, then
         * `apps/deliberation/shot.mjs` did it again - so the copy is removed rather
         * than corrected. `STATES` is what `sceneFor` and `NAV` are already checked
         * against; registering from it means a scene that exists is a scene the product
         * can mount, with nothing in between to forget.
         *
         * It registers `landing` too, which the product never mounts. Registering is
         * not mounting: the factory sits in a map costing nothing until `sceneFor`
         * names it, and no route does.
         */
        for (const state of mod.STATES) atmo.register(state.id, state.factory);

        atmo.resize(window.innerWidth, window.innerHeight);
        atmo.populate(wantedSubjects.current);
        atmo.focus(wantedKey.current);
        atmo.mount(wanted.current);
        atmo.start();
        // Up from black rather than cutting in - the scene arrives after the page
        // has painted, and a background that snaps on reads as a bug.
        //
        // AND ONLY TO 0.62. On the landing page the scene is the subject and belongs
        // at full strength; here it is behind a document somebody has to read, and
        // the Archive's lit panels put library card copy on a bright ground at full
        // brightness. Dimming the source fixes every surface at once, which raising
        // panel opacity one class at a time does not.
        atmo.reveal(1.4, 0.62);
        atmoRef.current = atmo;
      } catch (e) {
        console.error("[atmosphere] the background failed; the product does not:", e);
      }
    })();

    const onResize = (): void => atmo?.resize(window.innerWidth, window.innerHeight);
    window.addEventListener("resize", onResize);

    /* A hidden tab still burns a GPU on a bloom chain nobody is looking at. rAF is
       throttled by the browser but not stopped, and this product is left open in a
       background tab for the length of a review. */
    const onVisibility = (): void => {
      if (document.hidden) atmo?.stop();
      else atmo?.start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      live = false;
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      atmoRef.current = null;
      atmo?.dispose();
    };
  }, []);

  const scene = sceneFor(route);
  useEffect(() => {
    wanted.current = scene;
    const atmo = atmoRef.current;
    if (atmo === null || atmo.activeId === scene) return;
    /**
     * GUARDED, because the mount path was and this was not - and the gap was the whole
     * difference between a missing background and a blank product.
     *
     * `transitionTo` throws on a scene the engine does not know, exactly as `mount`
     * does. `mount` runs inside the try/catch above, whose comment states the rule this
     * file lives by: a background may not take the product down with it. This call sat
     * outside any catch, in an effect, so the throw went up through React and unmounted
     * the entire tree - over a fault in the DECORATION behind the type. A reviewer
     * opening Read & mark got a blank page, not a plain one.
     *
     * The registration list above is fixed and no scene is unknown today. The guard
     * stays because the failure it prevents is out of proportion to its cause, and a
     * driver can refuse a transition for reasons that have nothing to do with this
     * repo's spelling.
     */
    try {
      atmo.transitionTo(scene, transitionFor(scene));
    } catch (e) {
      console.error("[atmosphere] the transition failed; the product does not:", e);
    }
  }, [scene]);

  /**
   * OPENING A CASE FLIES THE CAMERA INTO ONE CELL OF THE FIELD.
   *
   * The dashboard draws every case as one colony among many. Naming a case here
   * singles out its colony and the camera goes to it - so the background answers
   * "where am I" with "in that one", and the whole field you just came from is still
   * around you rather than replaced by a different world.
   *
   * NOTHING HERE IS CLICKABLE, deliberately. The cells are scenery that reports
   * state, not a control surface: navigation stays in the DOM where it can be
   * tabbed to, read aloud, and hit reliably at any window size. The 3D reacts to
   * where you are; it is never how you get there.
   *
   * `focus` is held by the engine across scene swaps, so going to a closed record -
   * which IS a different world, the seal - and coming back lands on the same cell.
   */
  useEffect(() => {
    wantedKey.current = focusKey;
    atmoRef.current?.focus(focusKey);
  }, [focusKey]);

  /**
   * ONE BODY PER CASE THE READER CAN SEE - the library's, and their own.
   *
   * The scene used to draw a fixed field of forty-two over a catalogue of six, which is
   * a claim about the size of the archive that the table underneath it disproves. That
   * became one body per LIBRARY case, which was right for the library page and wrong
   * everywhere else: a case somebody opened themselves had no body at all, so it
   * borrowed one, and several own-cases ended up sharing a cube while the flight to any
   * of them landed on a body belonging to a different case.
   *
   * `mergeSubjects` gives every case its own, and drops an opened library case rather
   * than drawing it twice - `nipocalimab-imaavy--<userId>` is `nipocalimab` wearing an
   * account's name, not a second case. The dark bodies are still exactly the library's
   * two refusals, so counting them against the REFUSED rows in the table still works.
   *
   * The engine holds this across scene swaps, so it is announced whenever the list
   * changes rather than when the library route opens - the Archive may not be the scene
   * showing when the fetch lands, and it will be built with the right population when
   * it is.
   *
   * Keyed on the joined keys, not on array identity: App re-fetches into a new array on
   * every poll and the contents are almost always the same.
   */
  const names = [...catalogue.map((c) => c.name), ...mine.map((c) => c.caseId)].join(",");
  useEffect(() => {
    const subjects = mergeSubjects(
      catalogue.map((c) => ({ key: c.name, usable: c.usable })),
      mine.map((c) => c.caseId),
    );
    wantedSubjects.current = subjects;
    atmoRef.current?.populate(subjects);
    // `catalogue` and `mine` are the values read and `names` is the identity that
    // decides when to read them. Listing the arrays here instead would rebuild the
    // field on every poll that returned the same cases.
  }, [names]);

  return <canvas ref={canvasRef} className="backdrop" aria-hidden="true" />;
}
