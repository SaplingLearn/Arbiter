/**
 * Shared timing for the two signature text effects.
 *
 * THE WHOLE FAMILY IS MECHANICAL. No bounce, no elastic, no overshoot — `power3` and
 * `expo` only. The distinction matters more than it sounds: an overshoot says something
 * physical moved and settled, and everything on this page is meant to read as a machine
 * writing to a screen. A single `back.out` anywhere in here would undo the whole
 * register.
 */

/** The scramble alphabet. Uppercase, digits, and a few terminal punctuation marks. */
export const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/\\_-|";

/** The scramble re-rolls at ~30fps, not per animation frame. At 60 the characters churn
 *  so fast they average into a grey blur and you cannot see individual glyphs — which is
 *  the entire effect. Half rate reads as discrete characters being tried. */
export const ROLL_MS = 33;

/** Frames a character spends scrambling before it locks. Deterministic per index rather
 *  than random, so a label decodes identically every time it is triggered — a nav item
 *  that resolves differently on each hover reads as noise, not as a signature. */
export function scrambleFrames(i: number): number {
  return 4 + ((i * 7) % 5); // 4..8
}

/**
 * Per-character stagger, scaled to the length of the string.
 *
 * A fixed 40ms stagger is right for a six-letter chapter label and wrong for
 * "Ready to explore": at sixteen characters it takes 640ms to even START the last one,
 * and the whole effect blows through its budget. The brief caps a word at 600ms, so the
 * stagger is derived from that ceiling and clamped to a range that still reads as
 * left-to-right rather than as everything at once.
 */
export function staggerFor(length: number): number {
  if (length <= 1) return 0;
  const budget = 400; // 600ms total, less ~200ms for the last character's own scramble
  return Math.min(50, Math.max(18, budget / (length - 1)));
}

export function reducedMotion(): boolean {
  return typeof window !== "undefined"
    ? (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
    : false;
}

export function randomGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
}
