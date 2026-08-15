import { Color } from "three";

/**
 * OVERTURE PALETTE
 *
 * The same values `apps/atmosphere/src/core/palette.ts` carries, copied rather than
 * imported. `apps/atmosphere` is a standalone demo harness with its own Vite root and
 * its own `three` dependency; importing across two app roots would couple the landing
 * page's build to a scratch app's lifecycle for the sake of a dozen hex values.
 *
 * When a second surface needs these, they move to `packages/atmosphere` and both
 * import from there. One consumer does not justify a package.
 *
 * THE ONE IDEA WORTH PROTECTING: this blue family leans VIOLET in the deep tones and
 * CYAN in the highlights. `#22009B` and `#2B00C2` contain literally zero green. Every
 * generic sci-fi background ever made is cyan-to-teal; a violet-to-cyan ramp is not,
 * and it is the single cheapest thing that stops this looking machine-made.
 * Deep = violet. Hot = cyan. Never the reverse, never a teal midtone.
 *
 * Authored in sRGB, converted once to linear here, because every shader downstream
 * works in linear light.
 */

const srgb = (hex: number): Color => new Color(hex).convertSRGBToLinear();

export const PALETTE = {
  /* ground — not black. True black makes emissive geometry look pasted on; the eye
     needs a hue to read the glow as being IN something. */
  abyss: srgb(0x02030a),
  void: srgb(0x05061a),
  navy: srgb(0x00004e),

  /* structure — silhouette range, barely above ground. */
  reflex: srgb(0x000484),
  violet: srgb(0x22009b),
  electric: srgb(0x2b00c2),

  /* emissive — the working range, where most glowing geometry lives. */
  azure: srgb(0x0077cc),
  cyan: srgb(0x0095ff),
  sky: srgb(0x66c5fa),

  /* hot — only the brightest pixels in a frame. Never on a surface. */
  pale: srgb(0xd3e9f8),
  white: srgb(0xeaf5ff),

  /* neutrals — violet-tinted greys. A neutral grey reads as dirt against this ramp. */
  ink: srgb(0x0f1013),
  slate: srgb(0x5c5c74),
  mist: srgb(0x8a8aa5),
  haze: srgb(0xb9b9ce),
  paper: srgb(0xf1f1fa),
} as const;

/** CSS-side mirror, for the chrome that sits over the canvas. Kept in sync by hand —
 *  there are a dozen and generating them at runtime would cost a paint. */
export const CSS = {
  abyss: "#02030A",
  void: "#05061A",
  navy: "#00004E",
  reflex: "#000484",
  violet: "#22009B",
  electric: "#2B00C2",
  azure: "#0077CC",
  cyan: "#0095FF",
  sky: "#66C5FA",
  pale: "#D3E9F8",
  white: "#EAF5FF",
  ink: "#0F1013",
  slate: "#5C5C74",
  mist: "#8A8AA5",
  haze: "#B9B9CE",
  paper: "#F1F1FA",
} as const;
