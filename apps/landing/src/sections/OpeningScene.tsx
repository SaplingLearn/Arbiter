import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../motion/reducedMotion.js";

/**
 * The opening scene: an ink field, the mark, a counter running to 100, and a bar
 * line that fills before the whole thing wipes up off the page.
 *
 * WHY THIS IS NOT THE FRAMER MODULE IT WAS ASKED FOR. The requested component
 * (framer.com/m/Animation-loader-eHagKV.js) is a COMPILED FRAMER CANVAS component.
 * It imports `ComponentViewportProvider`, `SmartComponentScopedContainer` and
 * `useComponentViewport` from "framer" - three symbols the public `framer` npm
 * package does not export, because they belong to the canvas runtime that only
 * exists inside Framer's own hosting. Measured, not assumed: with react,
 * react-dom, framer-motion and framer all resolved from esm.sh, the module still
 * dies on `The requested module 'framer' does not provide an export named
 * 'ComponentViewportProvider'`. No import map or bundler plugin fixes that.
 *
 * So this is a native re-implementation of the same scene, to its own numbers: the
 * 3s counter, the [.12,.23,.5,1] ease it counts on, the bar line, the wipe. What
 * changed is the dressing - BLUEPRINT's ink and paper and the four-square mark in
 * place of the original's brand slug - and the fact that it costs no runtime
 * dependency on framer.com being up.
 *
 * THREE RULES IT OBEYS THAT A LOADER USUALLY DOES NOT:
 *  - In PRODUCTION it plays once a session. A three-second gate on every visit is a
 *    tax, not an entrance, and the second viewing is the one that annoys.
 *  - It is skippable by click or by any key, and it says so.
 *  - Under prefers-reduced-motion it never mounts at all. There is nothing behind
 *    it to wait for: the page is fully rendered underneath, so skipping the scene
 *    costs the reader nothing.
 *
 * WHEN IT PLAYS, in precedence order:
 *   `?intro=0`                  never  - for screenshots and for demos of the page
 *                                        itself rather than of the entrance
 *   prefers-reduced-motion      never  - the reader's setting, not overridable
 *   `?intro=1`                  always
 *   `vite dev`                  always - the session gate makes the scene impossible
 *                                        to iterate on, and a deliberate reload
 *                                        during development means "show me again".
 *                                        This is the whole reason the gate is not
 *                                        simply unconditional.
 *   built / previewed           once a session
 */

/** The Framer component's own counter duration and easing curve. */
const DURATION_MS = 3000;
const EASE: readonly [number, number, number, number] = [0.12, 0.23, 0.5, 1];
/** The wipe. Its own curve in the source, and faster than the count. */
const EXIT_MS = 620;
const SESSION_KEY = "arbiter.openingScene.played";

/**
 * Evaluate a CSS cubic-bezier at time t.
 *
 * Written out rather than handed to a CSS transition because the counter and the
 * bar have to agree to the frame: they are one progress value read two ways, and
 * driving the number in JS while the bar eased in CSS would let them drift apart
 * at exactly the moment both are on screen. Newton-Raphson on x, then y.
 */
function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number): (t: number) => number {
  const ax = 3 * p1x - 3 * p2x + 1, bx = 3 * p2x - 6 * p1x, cx = 3 * p1x;
  const ay = 3 * p1y - 3 * p2y + 1, by = 3 * p2y - 6 * p1y, cy = 3 * p1y;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (time: number) => {
    let t = time;
    for (let i = 0; i < 5; i++) {
      const slope = dx(t);
      if (slope === 0) break;
      t -= (x(t) - time) / slope;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}

const ease = cubicBezier(...EASE);

/**
 * Has this session already seen it? sessionStorage, not localStorage: a new tab is
 * a new arrival and should get the entrance, but a reload while reading should not.
 * Wrapped because Safari throws on storage access in some privacy modes, and a
 * loader is the last thing that should be able to white-screen a page.
 */
function alreadyPlayed(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function markPlayed(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* Private mode. Worst case it plays again next reload. */
  }
}

/**
 * MODE, not DEV. Vitest sets `import.meta.env.DEV` to true as well, so keying the
 * replay behaviour off DEV would silently disable the session gate under test - and
 * the two tests that assert the gate would be asserting nothing. MODE separates the
 * three environments properly: "development", "test", "production".
 */
const ALWAYS_REPLAY = import.meta.env.MODE === "development";

/** `?intro=1` forces the scene, `?intro=0` suppresses it. Null when unspecified. */
function introOverride(): boolean | null {
  try {
    const value = new URLSearchParams(window.location.search).get("intro");
    if (value === null) return null;
    return value !== "0" && value !== "false";
  } catch {
    return null;
  }
}

/**
 * Should this mount play? Precedence is documented on the component above.
 *
 * prefers-reduced-motion sits ABOVE `?intro=1` on purpose: a query parameter is the
 * author asking, and the media query is the reader telling. The reader wins.
 */
function decidePlay(): boolean {
  const override = introOverride();
  if (override === false) return false;
  if (prefersReducedMotion()) return false;
  if (override === true) return true;
  return ALWAYS_REPLAY || !alreadyPlayed();
}

export function OpeningScene({ duration = DURATION_MS }: { duration?: number }) {
  // Start false and decide in an effect. Deciding during render would read
  // sessionStorage and matchMedia on the server-render path and, more importantly,
  // would make the first paint depend on them - this way the page paints, then the
  // scene covers it, so a failure anywhere in here leaves a working page.
  const [open, setOpen] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [progress, setProgress] = useState(0);
  const frame = useRef(0);
  /**
   * Whether THIS mount plays, decided once and remembered.
   *
   * It cannot be re-derived per effect run, and StrictMode is why. In development
   * React runs an effect, tears it down, and runs it again. The first run called
   * markPlayed() and started the loop; the teardown cancelled the frame; the second
   * run then read its own flag back, concluded the scene had already played, and
   * returned early - leaving `open` true from the first run with nothing driving it.
   * The result was an overlay frozen at 000 forever, in development only, which is
   * the only place anyone would be looking at it.
   */
  const plays = useRef<boolean | null>(null);

  useEffect(() => {
    if (plays.current === null) {
      plays.current = decidePlay();
      if (plays.current) markPlayed();
    }
    if (!plays.current) return;
    setOpen(true);

    // BACKSTOP. requestAnimationFrame does not fire at all in a hidden tab - browsers
    // pause it - so a page opened in a background tab would mount this overlay, never
    // advance it, and hold `body { overflow: hidden }` until the reader came back.
    // setTimeout is only throttled in that state, not stopped, so this guarantees the
    // scene can always leave. Nothing may be able to weld itself over the page.
    const backstop = window.setTimeout(() => setExiting(true), duration + 1000);

    const start = performance.now();
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      setProgress(ease(t));
      if (t < 1) frame.current = requestAnimationFrame(step);
      else setExiting(true);
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame.current);
      window.clearTimeout(backstop);
    };
  }, [duration]);

  // The wipe, then unmount. Kept as state rather than an animationend listener so
  // a dropped event cannot leave the overlay welded over the page.
  useEffect(() => {
    if (!exiting) return;
    const id = window.setTimeout(() => setOpen(false), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [exiting]);

  // Skip on any click or key. The whole scene is three seconds of nothing the
  // reader asked for, so getting out of it must not require finding a button.
  useEffect(() => {
    if (!open || exiting) return;
    const skip = () => setExiting(true);
    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [open, exiting]);

  // Hold the page still underneath. Restored on unmount rather than by setting
  // "auto", so whatever the document had before comes back.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  const count = Math.round(progress * 100);

  return (
    // aria-hidden, and deliberately: everything here is decorative, the page behind
    // it is fully rendered and readable, and a screen reader should be walking that
    // rather than being held at a counter for three seconds.
    <div className="opening" data-exiting={exiting ? "true" : "false"} aria-hidden="true">
      <div className="opening-inner">
        <div className="opening-row">
          <span className="mark opening-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="opening-brand">Arbiter</span>
        </div>

        {/* Foot, bar and hint are one stacked group in normal flow. They were three
            absolutely-positioned siblings, which put the bar straight through the
            counter and pushed the hint off the bottom edge of the viewport. */}
        <div className="opening-foot">
          <div className="opening-row opening-row--foot">
            <span className="opening-meta">Adjudicates Conflicting Evidence</span>
            <span className="opening-count">{String(count).padStart(3, "0")}</span>
          </div>

          <div className="opening-bar">
            <i style={{ transform: `scaleX(${progress})` }} />
          </div>

          <span className="opening-skip">Click or press any key to skip</span>
        </div>
      </div>
    </div>
  );
}
