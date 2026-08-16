import { useEffect, useRef } from "react";
import type { ScrollEngine } from "../overture/useScrollEngine.js";

/**
 * The right-edge progress indicator: a notch travelling down a hairline track.
 *
 * Deliberately not a scrollbar. The document's own bar is hidden because its thumb would
 * be sized against ~2800vh of empty spacers and read as a 3% sliver — technically
 * accurate and useless. This reports position only, at constant size.
 *
 * It reads the engine in its own rAF and writes `style.top` directly. Taking progress as
 * a prop instead means the parent has to hold it in state, and a continuously-changing
 * value in state re-renders the whole page forty times per flick — which is what it did,
 * and what made the chapter index lag two seconds behind the scroll.
 */
export function ProgressRail({ engine }: { engine: ScrollEngine }) {
  const notch = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let last = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const el = notch.current;
      if (!el) return;
      const p = Math.min(Math.max(engine.read().global, 0), 1);
      // Sub-pixel changes are not worth a style write; the track is ~400px tall.
      const pct = Math.round(p * 1000) / 10;
      if (pct === last) return;
      last = pct;
      el.style.top = `${pct}%`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return (
    <div
      className="absolute z-30 hidden w-px bg-off-blue/12 lg:block"
      style={{
        right: "calc(var(--frame-inset) + var(--hud-gutter))",
        top: "28%",
        bottom: "28%",
      }}
      aria-hidden="true"
    >
      <span
        ref={notch}
        className="absolute -left-[3px] block h-3 w-[7px] bg-off-blue shadow-[0_0_10px_var(--color-accent-bright)]"
        style={{ top: "0%" }}
      />
    </div>
  );
}
