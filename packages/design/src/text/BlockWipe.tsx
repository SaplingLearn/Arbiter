import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { reducedMotion } from "./motion.js";

/**
 * BLOCK-WIPE — an inverted bar sweeping a label away, or across it to change it.
 *
 * The effect reads as a character cell being overwritten rather than as a fade, which is
 * the point: a crossfade between two strings looks like a website, and this has to look
 * like a terminal repainting a line.
 *
 * THE STRUCTURE IS LOAD-BEARING:
 *
 *   span.relative.overflow-hidden   the wrapper
 *     span.invisible                a SIZING GHOST holding the longest string
 *     span.z-10                     the real text, per character
 *     span.absolute.inset-0.z-20    the bar: off-blue ground, dark text, same string
 *
 * The ghost is easy to leave out and impossible to do without. Both the text and the bar
 * are absolutely positioned, so the wrapper would collapse to zero width and every swap
 * would jolt the layout. `overflow-hidden` is what lets the bar leave via
 * `translateX(100%)` without painting outside the label's box.
 *
 * ANIMATED ON `transform` ONLY. Animating `width` or `clip-path` relayouts or repaints
 * every frame; a transform is composited, which is what keeps this at 60fps while a
 * WebGL scene is drawing behind it.
 *
 * THE FLICKER IS TWO FRAMES, and it is the detail that sells the whole thing. A bar that
 * simply slides off is clean and slightly lifeless; two frames of the bar blinking as it
 * releases reads as a display struggling for an instant, which is the register the rest
 * of the page is written in.
 */

export type BlockWipeHandle = {
  /** Sweep the bar across, change the text underneath, sweep it off. */
  swap: (next: string) => Promise<void>;
  /** Reveal the text from under a bar that is already covering it. */
  reveal: () => Promise<void>;
};

export function BlockWipe({
  initial,
  /** The longest string this label will ever hold — sizes the ghost. */
  sizeFor,
  /** Start with the bar covering the text, ready for `reveal()`. */
  covered = false,
  className = "",
  onReady,
}: {
  initial: string;
  sizeFor: string;
  covered?: boolean;
  className?: string;
  onReady?: (handle: BlockWipeHandle) => void;
}) {
  const [text, setText] = useState(initial);
  const barRef = useRef<HTMLSpanElement>(null);
  const barTextRef = useRef<HTMLSpanElement>(null);
  // Captured by the handle below; a ref keeps the handle stable across renders so a
  // caller's sequence does not have to be rebuilt on every text change.
  const setTextRef = useRef(setText);
  setTextRef.current = setText;

  useEffect(() => {
    const bar = barRef.current;
    const barText = barTextRef.current;
    if (!bar || !barText || !onReady) return;

    /** Two frames of blink as the bar releases. */
    const flicker = (tl: gsap.core.Timeline) =>
      tl
        .set(bar, { opacity: 0 })
        .set(bar, { opacity: 1 }, "+=0.033")
        .set(bar, { opacity: 1 }, "+=0.033");

    onReady({
      swap(next) {
        return new Promise<void>((resolve) => {
          if (reducedMotion()) {
            setTextRef.current(next);
            resolve();
            return;
          }
          barText.textContent = next;
          const tl = gsap.timeline({ onComplete: resolve });
          // In from the left, covering the old string.
          tl.set(bar, { xPercent: -100, opacity: 1 })
            .to(bar, { xPercent: 0, duration: 0.2, ease: "power3.in" });
          flicker(tl);
          // The swap happens UNDER the bar, on the one frame where nothing is visible.
          tl.add(() => setTextRef.current(next))
            // Out to the right.
            .to(bar, { xPercent: 100, duration: 0.26, ease: "expo.out" });
        });
      },

      reveal() {
        return new Promise<void>((resolve) => {
          if (reducedMotion()) {
            gsap.set(bar, { xPercent: 100 });
            resolve();
            return;
          }
          const tl = gsap.timeline({ onComplete: resolve });
          tl.set(bar, { xPercent: 0, opacity: 1 });
          flicker(tl);
          tl.to(bar, { xPercent: 100, duration: 0.3, ease: "expo.out" });
        });
      },
    });
  }, [onReady]);

  return (
    <span className={`relative inline-block overflow-hidden whitespace-nowrap ${className}`}>
      {/* Sizing ghost — never seen, holds the box open at the longest string. */}
      <span className="invisible" aria-hidden="true">
        {sizeFor}
      </span>

      {/* The real text, per character, already in place under the bar. */}
      <span className="absolute inset-0 z-10 flex items-center justify-center">
        {[...text].map((ch, i) => (
          <span key={`${ch}-${i}`} className="inline-block">
            {ch === " " ? " " : ch}
          </span>
        ))}
      </span>

      {/* The bar. `will-change` because it is transformed every frame of the wipe while
          a WebGL scene is drawing behind it. */}
      <span
        ref={barRef}
        aria-hidden="true"
        className="absolute inset-0 z-20 flex items-center justify-center bg-off-blue text-dark-blue [will-change:transform]"
        style={{ transform: covered ? "translateX(0%)" : "translateX(100%)" }}
      >
        <span ref={barTextRef}>{covered ? initial : ""}</span>
      </span>
    </span>
  );
}
