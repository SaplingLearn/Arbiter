import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * THE SCROLL ENGINE.
 *
 * This is not page scrolling. Nothing visible on the page scrolls: the canvas and every
 * text block are fixed, and a container full of empty spacer sections is what actually
 * moves. A rAF loop reads that container's `scrollTop`, smooths it, and turns it into
 * one number — global progress, 0→1 — plus a local progress per chapter. Everything
 * else on the page is a function of those numbers.
 *
 * WHY THE SPACERS ARE UNEQUAL. 400vh for the first two and 500vh for the rest, ~2800vh
 * total. Equal tracks feel wrong to scroll because the chapters are not equally dense:
 * the opening is one object and one sentence and wants to be got through, where the
 * later set pieces have a camera flight to perform before they arrive. Tuning the track
 * length per chapter is the only real control over pacing here — there is no duration,
 * only distance.
 *
 * WHY SMOOTHING, AND WHY 0.08. The camera is scrubbed directly by this value, so raw
 * `scrollTop` puts the camera exactly where a trackpad's jitter puts it, and a WebGL
 * camera driven by unsmoothed input reads as broken rather than as responsive. 0.08 per
 * frame is ~10 frames to close 60% of a gap: enough inertia that a flick coasts, little
 * enough that the page still feels attached to your fingers. Below ~0.04 it feels
 * seasick; above ~0.15 the smoothing stops doing anything.
 *
 * THE LOOP DOES NOT setState EVERY FRAME. React re-rendering six text blocks at 60fps
 * to move a camera would be the single most expensive thing on the page. The smoothed
 * value lives in a ref that the render loop reads directly, and React is told only when
 * the ACTIVE CHAPTER changes — six times over the whole page.
 */

/** Track length per chapter, in viewport heights. Order matches the chapter list. */
export const TRACKS = [400, 400, 500, 500, 500, 500] as const;

export type ScrollState = {
  /** 0→1 across the whole document. */
  global: number;
  /** 0→1 within the active chapter's own track. */
  local: number;
  /** Index of the active chapter. */
  chapter: number;
  /**
   * 0→1 across the chapter's TEXT WINDOW — the middle 40% of its track. Below 0 before
   * the window, above 1 after. This is what drives the copy in and out, and keeping it
   * separate from `local` is what creates the read → fly → arrive rhythm: the text is
   * only on screen for 40% of the distance, and the camera has the other 60% to travel.
   */
  window: number;
};

const TOTAL = TRACKS.reduce((a, b) => a + b, 0);

/**
 * The scrollable distance, in viewport heights — NOT the content height.
 *
 * `scrollTop` runs from 0 to `scrollHeight - clientHeight`, so a 2800vh document only
 * yields 2700vh of travel: at maximum scroll the viewport's TOP sits at 2700vh, showing
 * the last screenful. Normalising the chapter boundaries against 2800 instead put every
 * one of them ~3.7% out — small enough to read as vague mistiming rather than as
 * arithmetic, and therefore exactly the kind of bug that survives review.
 */
const SPAN = TOTAL - 100;

/** Cumulative track starts, as a fraction of the scrollable distance. */
const STARTS = TRACKS.reduce<number[]>((acc, _t, i) => {
  acc.push((acc[i - 1] ?? 0) + (i === 0 ? 0 : TRACKS[i - 1]! / SPAN));
  return acc;
}, []);

/** The smoothing constant, expressed as "fraction closed per 60Hz frame" because that
 *  is the intuitive unit — converted to a real time constant in the loop below. */
const SMOOTH_PER_FRAME = 0.08;

/** Where the text is visible inside a chapter's track. */
const WINDOW_FROM = 0.3;
const WINDOW_TO = 0.7;

export function resolve(global: number): ScrollState {
  const g = Math.min(Math.max(global, 0), 1);

  let chapter = 0;
  for (let i = TRACKS.length - 1; i >= 0; i--) {
    if (g >= STARTS[i]!) {
      chapter = i;
      break;
    }
  }

  const span = TRACKS[chapter]! / SPAN;
  const local = Math.min(Math.max((g - STARTS[chapter]!) / span, 0), 1);
  const window = (local - WINDOW_FROM) / (WINDOW_TO - WINDOW_FROM);

  return { global: g, local, chapter, window };
}

export type ScrollEngine = {
  /** Read the live smoothed state. Safe to call inside a render loop. */
  read: () => ScrollState;
  /** Scroll a chapter's text window to the middle of the viewport. */
  jumpTo: (chapter: number) => void;
};

export function useScrollEngine(
  scroller: RefObject<HTMLElement | null>,
  /** Paused while the preloader is up — otherwise the camera flies during the boot. */
  active: boolean,
): { engine: ScrollEngine; chapter: number } {
  const stateRef = useRef<ScrollState>(resolve(0));
  const smoothRef = useRef(0);

  /**
   * REACT HEARS ABOUT THE CHAPTER AND NOTHING ELSE — six updates over the whole page.
   *
   * The first version also pushed a rounded progress value into state for the edge
   * indicator. Rounded to 1/200 that is ~40 re-renders of the entire tree during a single
   * flick — six copy blocks, six decoded rail labels, and every one of their
   * per-character ref callbacks detaching and reattaching. Anything that changes
   * continuously reads the ref inside its own rAF instead.
   */
  const [chapter, setChapter] = useState(0);

  /* `active` is read from a ref rather than closed over, and is deliberately NOT an
     effect dependency: the loop is created once and gates itself, instead of being torn
     down and rebuilt every time the boot state flips. An animation loop that has to be
     re-created to notice a boolean is one cancelled-frame away from never running. */
  const activeRef = useRef(active);
  activeRef.current = active;

  const engineRef = useRef<ScrollEngine>({
    read: () => stateRef.current,
    jumpTo: () => {},
  });

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;

    engineRef.current.jumpTo = (i) => {
      const span = TRACKS[i]! / SPAN;

      /* LAND WHERE THE TEXT HAS JUST FINISHED ARRIVING, not at the track's start.
         The smooth scroll travels the whole flight either way, so the camera move plays
         through regardless — the only question is where it stops. A track's start is
         `local = 0`, which is the exact MIDPOINT of the tear between two chapters: stop
         there and the reader is parked on a frame that is half one scene and half the
         next, with no text on screen. 0.4 is the first point at which the copy has
         completed its entrance, so the flight resolves into a composed, readable frame. */
      const LAND = WINDOW_FROM + (WINDOW_TO - WINDOW_FROM) * 0.25;
      const at = (STARTS[i]! + span * LAND) * (el.scrollHeight - el.clientHeight);
      el.scrollTo({ top: at, behavior: "smooth" });
    };

    let raf = 0;
    let lastChapter = -1;

    let last = performance.now();

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (!activeRef.current) return;

      /* Read the element directly rather than caching `scrollTop` from a `scroll`
         handler. One property access on an element already in the layout tree, against a
         listener whose lifecycle has to be kept in step with this loop's. */
      const max = el.scrollHeight - el.clientHeight;
      const to = max > 0 ? el.scrollTop / max : 0;
      const from = smoothRef.current;

      /* TIME-BASED, NOT PER-FRAME.
         `from + (to - from) * 0.08` is the version everyone writes, and it ties the feel
         of the page to the refresh rate: the same flick settles in half the distance on a
         120Hz display and crawls on a throttled tick. Expressing the constant as
         "fraction closed per 60Hz frame" and converting it against real elapsed time
         makes the response identical wherever it runs. Measured at 265ms / 15 frames to
         cross a chapter boundary from rest, which is what the arithmetic predicts. */
      const k = 1 - Math.pow(1 - SMOOTH_PER_FRAME, Math.min(dt, 100) / 16.667);
      const next = from + (to - from) * k;

      // Snap when the remaining gap is sub-pixel over the whole document, so the loop is
      // not chasing a target forever and the camera actually comes to rest.
      smoothRef.current = Math.abs(to - next) < 0.00005 ? to : next;

      const s = resolve(smoothRef.current);
      stateRef.current = s;

      if (s.chapter !== lastChapter) {
        lastChapter = s.chapter;
        setChapter(s.chapter);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [scroller]);

  return { engine: engineRef.current, chapter };
}
