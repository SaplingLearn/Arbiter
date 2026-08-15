/**
 * THE WORDMARK — "ARBITER", built from rectangular strokes.
 *
 * ON WHAT THIS IS NOT. The reference recording this page's layout comes from carries
 * another company's custom-lettered wordmark, and reproducing it here was asked for and
 * is the one thing in the spec not done. A layout can be borrowed; a mark cannot — a
 * real firm's lettering in this header would make the page carry their identity, which
 * is a different act from taking an arrangement. What IS reproduced is the CONSTRUCTION
 * logic: every glyph made of axis-aligned rectangles on a shared grid, no curves, no
 * diagonals, uniform stroke, and one square with a 45-degree notch cut out of it.
 *
 * ON THE NOTCHED SQUARE. In the reference that notch lives inside the letter O. There is
 * no O in ARBITER, and inventing one would be worse than placing it deliberately — so it
 * leads the wordmark as a standalone glyph. That also makes it usable on its own as a
 * favicon or an avatar, which an notch buried inside a letterform never is.
 *
 * WHY A GRID MAP AND NOT PATHS. Seven letters is roughly forty rectangles. Hand-authored
 * as `<path d="...">` they cannot be adjusted — changing the stroke weight means editing
 * every coordinate — and a reviewer cannot tell a correct glyph from a broken one by
 * reading the numbers. Declared as rects on a 10x14 grid, the letterforms are legible
 * AS SOURCE and the whole mark re-proportions from `S` below.
 */

/** Stroke weight, in grid units. Every rectangle is this thick in its short dimension. */
const S = 3;
/** Letter box, in grid units. */
const H = 14;
const W = 10;
/** Space between letters. */
const GAP = 3.4;

type Rect = [x: number, y: number, w: number, h: number];

/**
 * The letterforms.
 *
 * Read each entry as a stack of strokes: verticals first, then bars. A blocky grotesque
 * has no curves, so a "B" is two verticals and three bars, and an "R" is the same with
 * its lower right stroke moved out to make a leg.
 */
const GLYPHS: Record<string, { width: number; rects: Rect[] }> = {
  A: {
    width: W,
    rects: [
      [0, 0, S, H], // left stem
      [W - S, 0, S, H], // right stem
      [0, 0, W, S], // crossbar, top
      [0, 6, W, S], // crossbar, middle
    ],
  },
  R: {
    width: W,
    rects: [
      [0, 0, S, H],
      [0, 0, W, S],
      [W - S, 0, S, 8], // shoulder, stopping at the middle bar
      [0, 5, W, S],
      [W - S, 8, S, H - 8], // the leg
    ],
  },
  B: {
    width: W,
    rects: [
      [0, 0, S, H],
      [0, 0, W, S],
      [0, 5.5, W, S],
      [0, H - S, W, S],
      [W - S, 0, S, 8.5],
      [W - S, 5.5, S, H - 5.5],
    ],
  },
  I: {
    width: S,
    rects: [[0, 0, S, H]],
  },
  T: {
    width: W,
    rects: [
      [0, 0, W, S],
      [(W - S) / 2, 0, S, H],
    ],
  },
  E: {
    width: W,
    rects: [
      [0, 0, S, H],
      [0, 0, W, S],
      [0, 5.5, W - 2, S], // the middle arm is short — it is what stops E reading as B
      [0, H - S, W, S],
    ],
  },
};

const WORD = "ARBITER";

/** The leading glyph: a square with a 45-degree notch out of its lower-right corner. */
function notchedSquare(x: number): { d: string; width: number } {
  const n = H * 0.38;
  return {
    width: H,
    d: [
      `M ${x} 0`,
      `H ${x + H}`,
      `V ${H - n}`,
      `L ${x + H - n} ${H}`, // the 45-degree cut
      `H ${x}`,
      "Z",
    ].join(" "),
  };
}

export function Wordmark({ className }: { className?: string }) {
  const glyph = notchedSquare(0);

  let cursor = glyph.width + GAP * 1.6;
  const letters: { key: string; rects: Rect[] }[] = [];

  for (const [i, ch] of [...WORD].entries()) {
    const g = GLYPHS[ch];
    // A missing glyph would silently drop a letter and nobody would notice in review.
    if (!g) throw new Error(`Wordmark: no glyph for "${ch}"`);
    letters.push({
      key: `${ch}${i}`,
      rects: g.rects.map(([x, y, w, h]) => [x + cursor, y, w, h] as Rect),
    });
    cursor += g.width + GAP;
  }

  const total = cursor - GAP;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${total} ${H}`}
      fill="currentColor"
      role="img"
      aria-label="Arbiter"
    >
      <path d={glyph.d} />
      {letters.map((l) =>
        l.rects.map(([x, y, w, h], j) => (
          <rect key={`${l.key}-${j}`} x={x} y={y} width={w} height={h} />
        )),
      )}
    </svg>
  );
}

/** The mark on its own — the notched square, square viewBox, for tight spaces. */
export function Mark({ className }: { className?: string }) {
  const n = H * 0.38;
  return (
    <svg
      className={className}
      viewBox={`0 0 ${H} ${H}`}
      fill="currentColor"
      role="img"
      aria-label="Arbiter"
    >
      <path d={`M0 0 H${H} V${H - n} L${H - n} ${H} H0 Z`} />
    </svg>
  );
}
