/**
 * One pointer position, shared by everything that reacts to it.
 *
 * The cursor, the headline parallax, the paragraph parallax and the WebGL camera all
 * follow the same input. Each attaching its own `pointermove` listener means four
 * handlers firing on a stream of events that can arrive faster than the display
 * refreshes — and, worse, four slightly different notions of where the pointer is,
 * which is exactly how a parallax stack ends up subtly out of register.
 *
 * The listener stores RAW position only. Easing is left to each consumer because they
 * genuinely differ: the cursor is nearly attached to the pointer, the headline crawls,
 * and the camera crawls further still. A single pre-eased value would force one
 * compromise on all of them, and the lag between the layers is the depth cue.
 */

const raw = { x: 0, y: 0 };
let attached = false;

function attach(): void {
  if (attached || typeof window === "undefined") return;
  attached = true;
  window.addEventListener(
    "pointermove",
    (e) => {
      // Normalised to -1..1 from the viewport centre, so consumers can scale by whatever
      // their own travel is without knowing the window size.
      raw.x = (e.clientX / window.innerWidth) * 2 - 1;
      raw.y = (e.clientY / window.innerHeight) * 2 - 1;
    },
    { passive: true },
  );
}

/** Current raw pointer, -1..1 from centre. Attaches the listener on first use. */
export function getPointer(): { x: number; y: number } {
  attach();
  return raw;
}

/** Frame-rate independent easing, matching the scroll engine's convention: the factor
 *  is "fraction closed per 60Hz frame" and is converted against real elapsed time. */
export function ease(from: number, to: number, perFrame: number, dt: number): number {
  const k = 1 - Math.pow(1 - perFrame, Math.min(dt, 100) / 16.667);
  return from + (to - from) * k;
}

/** True on machines with a real pointer. The custom cursor and parallax are both
 *  meaningless on touch, and the cursor would be an untouchable square in the corner. */
export function hasFinePointer(): boolean {
  return typeof window !== "undefined"
    ? (window.matchMedia?.("(pointer: fine)").matches ?? false)
    : false;
}
