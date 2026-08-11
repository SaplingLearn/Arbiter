import { CHARACTER_ART, CHARACTER_FACES, type CharacterFace } from "./characterArt.js";

export type { CharacterFace };

/**
 * One of the four faces, drawn in the current text colour.
 *
 * The art is line work in `currentColor`, so a face inherits ink from whatever it
 * sits inside rather than carrying a palette of its own. That is the whole reason
 * these fit a system that says "no decorative colour": they are drawings in the same
 * ink as the prose beside them.
 *
 * aria-hidden without exception. A face never carries information - the sentence
 * next to it does - and eight unlabelled portraits narrated on the way down a page
 * would be pure noise to a screen reader.
 */
export function Character({
  face,
  size = 44,
  className = "",
}: {
  face: CharacterFace;
  size?: number;
  className?: string;
}) {
  const art = CHARACTER_ART[face];
  return (
    <span className={`character ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox={art.viewBox} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        {art.paths}
      </svg>
    </span>
  );
}

/**
 * The face for beat n, cycling.
 *
 * Deterministic by index rather than random: a guide whose face changed on every
 * render would read as four different people interrupting, and stepping backward
 * through the tour has to show the same face it showed on the way down. There are
 * four faces and eight beats, so each appears twice - which the brief allows.
 */
export function faceForBeat(n: number): CharacterFace {
  const faces = CHARACTER_FACES;
  return faces[((n % faces.length) + faces.length) % faces.length]!;
}
