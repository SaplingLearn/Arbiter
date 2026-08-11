import { useEffect, type RefObject } from "react";
import { prefersReducedMotion } from "./reducedMotion.js";

/**
 * The retro bitmap-dither field the hero sits on.
 *
 * A canvas rather than a CSS gradient because the effect is a THRESHOLDED one: each
 * 3px cell is either painted or not, with the probability of being painted rising
 * quadratically towards the bottom. A gradient interpolates, which gives a smooth
 * ramp and none of the grain. The grain is the whole point - BLUEPRINT asks for a
 * bitmap texture, and a bitmap is made of decisions, not of blends.
 *
 * The PRNG is seeded and local, so the field is IDENTICAL on every load at a given
 * size. Math.random would give a different dither each refresh, which reads as noise
 * rather than as texture, and would make a screenshot diff useless.
 */

/** mulberry32. Small, fast, and good enough for deciding whether to paint a pixel. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CELL = 3;
const SEED = 424242;
/** The two lighter blues sprinkled through the field, thicker towards the edges. */
const PALE = "#DDE2FF";
const MID = "#5A66F7";

function draw(canvas: HTMLCanvasElement, accent: string): void {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  // Below this the canvas has not been laid out yet, and dividing by its width
  // would put NaN into every coordinate.
  if (w < 4 || h < 4) return;

  // Capped at 2: a 3px cell drawn at 3x costs 2.25x the fill calls of 2x and is not
  // distinguishable, and this canvas can be 1600px wide.
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const rand = seededRandom(SEED);
  // Solid from halfway down; above that the paint probability ramps as p², which is
  // what makes the top edge dissolve rather than end.
  const fade = h * 0.5;

  for (let y = 0; y < h; y += CELL) {
    for (let x = 0; x < w; x += CELL) {
      if (y < fade) {
        const p = y / fade;
        if (rand() >= p * p) continue;
      }
      // 0 at either edge, 1 at the centre - so `edge` is 1 at the edges.
      const centre = Math.min(x, w - x) / (w * 0.5);
      const edge = 1 - Math.min(1, centre);
      const lightProbability = 0.05 + 0.22 * edge;
      const r = rand();
      ctx.fillStyle = r < lightProbability * 0.45 ? PALE : r < lightProbability ? MID : accent;
      ctx.fillRect(x, y, CELL, CELL);
    }
  }
}

/**
 * Seven cells per tick blink pale and fall back to the accent a beat later, in the
 * bottom 40% where the field is solid. Slow enough (320ms) to read as a signal
 * arriving rather than as static.
 */
function twinkle(canvas: HTMLCanvasElement, accent: string, pending: Set<number>): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  if (w < 4) return;

  for (let k = 0; k < 7; k++) {
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(h * (0.58 + Math.random() * 0.4));
    ctx.fillStyle = PALE;
    ctx.fillRect(x, y, CELL, CELL);
    const id = window.setTimeout(() => {
      pending.delete(id);
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, CELL, CELL);
    }, 170 + Math.random() * 170);
    pending.add(id);
  }
}

export function useDitherField(canvasRef: RefObject<HTMLCanvasElement>, accent: string): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    draw(canvas, accent);

    // Debounced: a drag-resize fires this continuously, and a full redraw is
    // ~150k fillRect calls at rail width.
    let debounce = 0;
    const onResize = (): void => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => draw(canvas, accent), 120);
    };
    window.addEventListener("resize", onResize);

    // The field itself is static texture and stays under reduced motion; only the
    // blinking stops.
    const pending = new Set<number>();
    const ticker = prefersReducedMotion() ? 0 : window.setInterval(() => twinkle(canvas, accent, pending), 320);

    return () => {
      window.removeEventListener("resize", onResize);
      window.clearTimeout(debounce);
      window.clearInterval(ticker);
      pending.forEach((id) => window.clearTimeout(id));
    };
  }, [canvasRef, accent]);
}
