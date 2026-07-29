import { useEffect } from "react";
import { useAppState, useDispatch } from "../state/store.js";
import { isTypingTarget } from "../ui/isTypingTarget.js";
import { BEATS } from "./beats.js";

/**
 * Keyboard driving, so nobody fumbles a mouse mid-sentence and any of the three
 * team members can present with no hidden knowledge.
 */
export function TourFooter() {
  const { tour, motion } = useAppState();
  const dispatch = useDispatch();

  const go = (n: number) => {
    const b = BEATS[Math.max(0, Math.min(BEATS.length - 1, n))]!;
    dispatch({ type: "setTourBeat", beat: b.n, tab: b.tab, focus: b.focus });
    for (const a of b.actions) dispatch(a);
    window.location.hash = `#/${b.tab}`;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape is exempt on purpose: clearing the focused region is harmless from
      // anywhere, and it is what someone stuck in a field will reach for.
      if (e.key === "Escape") { dispatch({ type: "setFocus", focus: null }); return; }
      if (isTypingTarget(e.target)) return;

      if (e.key === "ArrowRight") go(tour.beat + 1);
      else if (e.key === "ArrowLeft") go(tour.beat - 1);
      else if (e.key.toLowerCase() === "m") dispatch({ type: "toggleMotion" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const b = BEATS[tour.beat]!;
  return (
    <footer className="beat-bar">
      <button type="button" className="btn btn-ghost" onClick={() => go(tour.beat - 1)} aria-label="Previous beat">←</button>
      <button type="button" className="btn btn-ghost" onClick={() => go(tour.beat + 1)} aria-label="Next beat">→</button>
      <div>
        {/* One element, one string: the e2e walk reads "Beat n of 7" off this
            node, so the count and the title must not be split apart. */}
        <strong className="beat-title">Beat {b.n + 1} of {BEATS.length} · {b.title}</strong>
        <div className="small muted">{b.line}</div>
      </div>
      <span className="small muted beat-motion">
        motion {motion ? "on" : "off"} (M)
      </span>
    </footer>
  );
}
