import { useEffect, useMemo } from "react";
import { useAppState, useDispatch } from "../state/store.js";
import { isTypingTarget } from "../ui/isTypingTarget.js";
import { buildBeats } from "./beats.js";

/**
 * Keyboard driving, so nobody fumbles a mouse mid-sentence and any of the three
 * team members can present with no hidden knowledge.
 */
export function TourFooter() {
  const { data, tour, motion, selectedCompoundId } = useAppState();
  const dispatch = useDispatch();
  const beats = useMemo(() => buildBeats(data), [data]);

  const go = (n: number) => {
    const b = beats[Math.max(0, Math.min(beats.length - 1, n))]!;
    dispatch({ type: "setTourBeat", beat: b.n, tab: b.tab, focus: b.focus });
    // Before the beat's own actions: an as-of date is applied to the compound the
    // beat is about, not to the one that happened to be selected. Guarded on
    // inequality only to avoid a no-op re-render, never to make the field optional.
    if (b.compoundId !== selectedCompoundId) {
      dispatch({ type: "selectCompound", compoundId: b.compoundId });
    }
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

  const b = beats[tour.beat]!;
  return (
    <footer className="beat-bar">
      <button type="button" className="btn btn-ghost" onClick={() => go(tour.beat - 1)} aria-label="Previous beat">←</button>
      <button type="button" className="btn btn-ghost" onClick={() => go(tour.beat + 1)} aria-label="Next beat">→</button>
      <div>
        {/* One element, one string: the e2e walk reads "Beat n of 8" off this
            node, so the count and the title must not be split apart. */}
        <strong className="beat-title">Beat {b.n + 1} of {beats.length} · {b.title}</strong>
        <div className="small muted">{b.line}</div>
      </div>
      <span className="small muted beat-motion">
        motion {motion ? "on" : "off"} (M)
      </span>
    </footer>
  );
}
