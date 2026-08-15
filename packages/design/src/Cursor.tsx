import { useEffect, useRef } from "react";
import { ease, getPointer, hasFinePointer } from "./pointer.js";
import { reducedMotion } from "./text/motion.js";

/**
 * THE CURSOR — a small square outline trailing the pointer.
 *
 * DESKTOP AND STEADY-MOTION ONLY, and both gates are real. On touch there is no pointer
 * to trail, so the square would sit in a corner forever as an untouchable artefact. Under
 * `prefers-reduced-motion` a lagging element that chases the reader's hand is precisely
 * the class of thing that setting exists to turn off — and unlike most of the effects on
 * this page it cannot degrade to a fade, so it simply does not mount.
 *
 * IT DOES NOT REPLACE THE SYSTEM CURSOR. Hiding the native one is the usual move and it
 * is a mistake: this square lags by design, so at speed there is a visible gap between
 * where the reader is pointing and the only thing on screen indicating it, and text
 * selection and precise clicking both get worse. This rides alongside.
 *
 * The position is written as a `translate3d` on a `position: fixed` element, never as
 * `left`/`top` — the latter lays out and paints on the main thread every frame, at the
 * exact moment the WebGL scene wants it.
 */

/** What counts as hoverable. Anything the reader can act on. */
const TARGETS = "a, button, [role='button']";

export function Cursor() {
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasFinePointer() || reducedMotion()) return;
    const el = dotRef.current;
    if (!el) return;

    const pointer = getPointer();
    const pos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let scale = 1;
    let over = false;

    // Delegated, not per-element. Six chapters of controls come and go as the reader
    // scrolls; binding to each would mean re-binding on every chapter change.
    const onOver = (e: PointerEvent) => {
      over = !!(e.target as Element | null)?.closest?.(TARGETS);
    };
    document.addEventListener("pointerover", onOver, { passive: true });

    let raf = 0;
    let last = performance.now();

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = now - last;
      last = now;

      // The pointer store is normalised -1..1; convert back to pixels here.
      const tx = ((pointer.x + 1) / 2) * window.innerWidth;
      const ty = ((pointer.y + 1) / 2) * window.innerHeight;

      pos.x = ease(pos.x, tx, 0.15, dt);
      pos.y = ease(pos.y, ty, 0.15, dt);
      scale = ease(scale, over ? 1.5 : 1, 0.2, dt);

      el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -50%) scale(${scale})`;
      el.style.backgroundColor = over ? "var(--color-off-blue)" : "transparent";
    };
    raf = requestAnimationFrame(tick);

    el.style.opacity = "1";

    return () => {
      document.removeEventListener("pointerover", onOver);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={dotRef}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[90] size-4 border border-off-blue opacity-0 transition-[background-color] duration-200"
      style={{ willChange: "transform" }}
    />
  );
}
