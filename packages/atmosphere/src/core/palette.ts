import { Color } from "three";

/**
 * ARBITER — ATMOSPHERE PALETTE
 *
 * Sourced from the Pfizer brand film's own palette card and corroborated against the
 * brand deck. The values are theirs; the ARRANGEMENT is ours, and the arrangement is
 * the whole difference between homage and copy.
 *
 * THE ONE IDEA WORTH PROTECTING: this blue family leans VIOLET in the deep tones and
 * CYAN in the highlights. `#22009B` and `#2B00C2` contain literally zero green. Every
 * generic sci-fi background ever made is cyan-to-teal; a violet-to-cyan ramp is not,
 * and it is the single cheapest thing we can do to stop this looking machine-made.
 * Deep = violet. Hot = cyan. Never the reverse, never a teal midtone.
 *
 * Pfizer runs this ramp on WHITE. We run it on near-black. Same pigments, opposite
 * ground, which is what keeps it recognisably adjacent without being a lift.
 *
 * Authored in sRGB, converted once to linear here, because every shader downstream
 * works in linear light.
 */

const srgb = (hex: number): Color => new Color(hex).convertSRGBToLinear();

export const PALETTE = {
  /* -------------------------------------------------- ground
     Not black. A true black ground makes emissive geometry look pasted on; the eye
     needs a hue to read the glow as being IN something. */
  abyss: srgb(0x02030a),
  void: srgb(0x05061a),
  /** Pfizer 662 C. The darkest brand value, used as the deep field. */
  navy: srgb(0x00004e),

  /* -------------------------------------------------- structure
     Silhouette range. Barely above ground — these read as shape, not as surface. */
  reflex: srgb(0x000484),
  violet: srgb(0x22009b),
  /** Pfizer Reflex Blue. The electric violet that is this palette's signature. */
  electric: srgb(0x2b00c2),

  /* -------------------------------------------------- emissive
     The working range. Most glowing geometry lives here. */
  azure: srgb(0x0077cc),
  /** Process Cyan. The workhorse — if one colour reads as "Arbiter", it is this. */
  cyan: srgb(0x0095ff),
  sky: srgb(0x66c5fa),

  /* -------------------------------------------------- hot
     Only the brightest pixels in a frame. Used at the core of a pulse, never on a
     surface. If more than ~2% of the frame is in this range, the shot is blown. */
  pale: srgb(0xd3e9f8),
  white: srgb(0xeaf5ff),

  /* -------------------------------------------------- refusal
     THE ONE HUE OUTSIDE THE WEDGE, and it is here for the same reason the product's
     CSS carries `--stop` outside its own: red means one thing on a safety call, and a
     refused document is that thing. Same value as `--stop` in the deliberation app, so
     a refused case is the same red in the table and in the environment behind it.

     Never decoration, never a second accent. If anything in a scene is red, it is
     because a subject was refused - the moment it is spent on anything else, the
     colour stops carrying the meaning and the scenes go back to being wallpaper. */
  stop: srgb(0xff8a8e),

  /* -------------------------------------------------- neutrals
     From the deck. Violet-tinted greys — a neutral grey would read as dirt against
     this ramp. Used for chrome and type, never for geometry. */
  ink: srgb(0x0f1013),
  slate: srgb(0x5c5c74),
  mist: srgb(0x8a8aa5),
  haze: srgb(0xb9b9ce),
  paper: srgb(0xf1f1fa),
} as const;

/** CSS-side mirror of the same values, for the demo chrome. Kept in sync by hand —
 *  there are only a dozen and generating them at runtime would cost a paint. */
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
  stop: "#FF8A8E",
  ink: "#0F1013",
  slate: "#5C5C74",
  mist: "#8A8AA5",
  haze: "#B9B9CE",
  paper: "#F1F1FA",
} as const;
