import { useEffect, useRef, type ReactElement } from "react";
import type { Atmosphere } from "@arbiter/atmosphere";
import { caseIdOf, type Route } from "../router.js";
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
export function Backdrop({ route }: { route: Route }): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const atmoRef = useRef<Atmosphere | null>(null);
  /* The scene the LAST effect asked for. Route changes can outrun the dynamic
     import on a cold load, and without this the engine mounts whichever scene won
     the race rather than the one the reader is looking at. */
  const wanted = useRef(sceneFor(route));
  /* Same race, for the focus key: a reader can land straight on a case URL, and the
     effect that announces the key runs long before `three` has finished arriving. */
  const wantedKey = useRef(caseIdOf(route));

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
        atmo.register("dashboard", mod.createCulture);
        atmo.register("new", mod.createGenesis);
        atmo.register("library", mod.createArchive);
        atmo.register("ask", mod.createSynapse);
        atmo.register("record", mod.createHelix);

        atmo.resize(window.innerWidth, window.innerHeight);
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
    atmo.transitionTo(scene, transitionFor(scene));
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
  const key = caseIdOf(route);
  useEffect(() => {
    wantedKey.current = key;
    atmoRef.current?.focus(key);
  }, [key]);

  return <canvas ref={canvasRef} className="backdrop" aria-hidden="true" />;
}
