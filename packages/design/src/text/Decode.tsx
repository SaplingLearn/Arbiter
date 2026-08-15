import { useEffect, useRef } from "react";
import { ROLL_MS, randomGlyph, reducedMotion, scrambleFrames, staggerFor } from "./motion.js";

/**
 * DECODE — a label resolving out of noise, left to right.
 *
 * The terminal effect, used on every mono label: the chapter index when its chapter
 * activates, button and nav labels on hover, small eyebrows on reveal.
 *
 * IT IS A DECODE, NOT A TYPEWRITER. Every character is present from the first frame and
 * each settles at its own moment. A typewriter says "this is being written"; a decode
 * says "this was always here and is now legible" — the right claim for a navigation
 * label that has been on screen the whole time at 35% opacity.
 *
 * THREE STRUCTURAL DECISIONS, all of which look like over-engineering until the effect
 * is running next to real layout:
 *
 *   THE SIZING GHOST. An invisible copy of the final string, in flow, holding the box
 *   open. Without it the wrapper is only as wide as whatever glyphs happen to be showing
 *   this frame, and since the pool contains both `|` and `W` the label's width flickers
 *   for the whole animation — which in the chapter index shoves the five other entries
 *   sideways forty times a second.
 *
 *   `whitespace-nowrap`. Mid-scramble a two-word label is a sequence of random glyphs
 *   with a space in it, and the browser will happily wrap at that space if the box is
 *   even slightly tight. The label would reflow to two lines and back.
 *
 *   TEXT WRITTEN THROUGH REFS, NOT STATE. At 30fps across six chapter labels plus
 *   whatever is hovered, re-rendering React for every roll is real work for no benefit.
 *   The spans are rendered once and their `textContent` is mutated in place.
 */

export function Decode({
  text,
  /** Rising edge triggers a run. Ignored when `hover` is set. */
  play,
  /** Trigger on pointer-enter of the nearest enclosing button or link instead. */
  hover,
  className,
}: {
  text: string;
  play?: boolean;
  hover?: boolean;
  className?: string;
}) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const charsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const rafRef = useRef(0);
  const wasPlaying = useRef(play ?? false);

  const run = useRef(() => {});
  run.current = () => {
    const spans = charsRef.current;
    if (spans.length === 0) return;

    // A reader who asked for less motion gets the answer, not the performance.
    if (reducedMotion()) {
      spans.forEach((el, i) => el && (el.textContent = text[i] ?? ""));
      return;
    }

    cancelAnimationFrame(rafRef.current);

    const chars = [...text];
    const stagger = staggerFor(chars.length);
    const lockAt = chars.map((_, i) => i * stagger + scrambleFrames(i) * ROLL_MS);
    const total = Math.max(...lockAt);

    const t0 = performance.now();
    let lastRoll = -Infinity;

    const tick = () => {
      const elapsed = performance.now() - t0;
      const roll = elapsed - lastRoll >= ROLL_MS;
      if (roll) lastRoll = elapsed;

      for (let i = 0; i < chars.length; i++) {
        const el = spans[i];
        if (!el) continue;
        const real = chars[i]!;
        // Spaces never scramble. A space cycling through `#` and `|` closes the word gap
        // and the label reads as one long token until it resolves.
        if (real === " ") {
          el.textContent = " ";
          continue;
        }
        if (elapsed >= lockAt[i]!) {
          el.textContent = real;
        } else if (roll) {
          el.textContent = randomGlyph();
        }
      }

      if (elapsed < total) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        spans.forEach((el, i) => el && (el.textContent = chars[i] === " " ? " " : chars[i]!));
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  // Rising edge only. Without the edge check the effect re-runs on every unrelated
  // re-render and the label scrambles continuously the whole time its chapter is active.
  useEffect(() => {
    if (hover) return;
    const rising = !!play && !wasPlaying.current;
    wasPlaying.current = !!play;
    if (rising) run.current();
  }, [play, hover]);

  useEffect(() => {
    if (!hover) return;
    const el = wrapRef.current;
    // The hover target is the whole control, not the eleven-pixel run of text inside it.
    const target = el?.closest("button, a") ?? el;
    if (!target) return;
    const onEnter = () => run.current();
    target.addEventListener("pointerenter", onEnter);
    return () => target.removeEventListener("pointerenter", onEnter);
  }, [hover]);

  /* A RUN IN FLIGHT OUTLIVES A PROP CHANGE, and it will happily overwrite React.
     
     This animation writes `textContent` imperatively, so it is not participating in
     reconciliation — if `text` changes while a run is going, the loop keeps writing the
     OLD string over whatever React just rendered. It is not hypothetical: hovering the
     header's MENU starts a ~600ms decode, clicking it swaps the label to "Close", and the
     surviving loop finished by writing "Menu" back. The button read MENU while its
     accessible name and its sizing ghost both said Close.
     
     Cancel on every change of `text`, then re-sync the spans to the new string. */
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    const chars = [...text];
    charsRef.current.forEach((el, i) => {
      if (el) el.textContent = chars[i] === " " ? " " : (chars[i] ?? "");
    });
  }, [text]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const chars = [...text];

  return (
    <span ref={wrapRef} className={`relative inline-block whitespace-nowrap ${className ?? ""}`}>
      {/* Sizing ghost — in flow, never seen, holds the width steady. */}
      <span className="invisible" aria-hidden="true">
        {text}
      </span>

      {/* The animated glyphs. Hidden from assistive tech: mid-run this says "QX#7|R". */}
      <span className="absolute inset-0" aria-hidden="true">
        {chars.map((ch, i) => (
          <span
            key={i}
            ref={(el) => {
              charsRef.current[i] = el;
            }}
          >
            {ch === " " ? " " : ch}
          </span>
        ))}
      </span>

      <span className="sr-only">{text}</span>
    </span>
  );
}
