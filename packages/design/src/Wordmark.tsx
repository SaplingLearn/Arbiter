/**
 * THE LOGO — a ruling, and the word.
 *
 * WHAT THIS REPLACED. The previous mark built every letter of "ARBITER" out of
 * axis-aligned rectangles on a 10x14 grid, with a 3-unit stroke and a 3.4-unit gap. At the
 * size both headers actually render it — 15 pixels tall — the stroke and the counters
 * landed on the same pixel and the word closed into a solid slab; the leading notched
 * square merged into the A. Hand-built letterforms cannot be rescued at that size, and the
 * last bug against it (an R that read as an A, so the header said ARBITEA) was a symptom
 * of the approach rather than of that one glyph.
 *
 * WHY REAL LETTERFORMS. The word is Host Grotesk at weight 600, converted to outlines.
 * Outlines and not live `<text>`: the fonts arrive from the Google CDN, so a wordmark set
 * in markup would reflow to a fallback face on a cold or offline load and break its own
 * viewBox. Outlines also mean the logo owes nothing to the stylesheet.
 *
 * WHY THE SPACING IS NOT TRACKING. Every pair is spaced by the AREA of white between the
 * two letters, with a clearance floor underneath so no two pieces of ink come closer than a
 * minimum. That floor is what keeps the r's arm off the b — a collision uniform tracking
 * cannot see, because tracking only knows advance widths and the r's arm is the one point
 * that sticks out. Tracking a word out to 0.16em, as the old mark effectively did, is what
 * made it read as a HUD label instead of a logo.
 *
 * THE MARK IS DELIBERATELY NOT AN "A". An A beside the word "Arbiter" is a stutter: the eye
 * reads the letter, then reads it again, and in an all-caps setting the lockup is literally
 * "A ARBITER". So the mark is two bars at the wordmark's own measured stem weight, of
 * plainly unequal reach, their ends cut on the same 45 degrees as every chamfer in the
 * interface. One position outweighed the other. No letterform repeats, and there is no
 * second reading to explain.
 *
 * THE NUMBERS ARE MEASURED, NOT PICKED. `STEM` is the width of the wordmark's own i, taken
 * off the outline on this grid. The bars are 1.18 stems thick and separated by 0.95 of a
 * bar, so the mark is built entirely out of the word's own weight. Swap the face and every
 * number here has to be re-derived — which is why this geometry is generated, not typed.
 *
 * DO NOT HAND-EDIT THE PATH DATA. `WORD` is generated: glyph outlines pulled from the face,
 * spaced by the routine described above, then baked into one absolute path. There is
 * nothing in those coordinates a reviewer can check by reading them and nothing a person
 * can correct by nudging them. To change the wordmark, regenerate it.
 *
 * Host Grotesk is licensed under the SIL Open Font License, which permits outlining glyphs
 * for a logo. No font file ships in this repository — only the resulting paths.
 */

/** Cap height. Every coordinate in this file is on a 0-100 cap-height grid. */
const CAP = 100;

/**
 * The word's ink box, and where the cap line sits inside it.
 *
 * These differ: the b and the t rise above cap height, so the ink box is taller than CAP
 * and its top edge is NOT the cap line. Anything aligned to the box rather than to
 * `CAP_TOP` sits visibly high against the letters.
 */
const WORD_W = 457.57;
const WORD_H = 104.57;
const CAP_TOP = 2.86;

/** Space between mark and word — wide enough that they read as two things, not a ligature. */
const GAP = 38;

/**
 * THE RULING. Two bars, unequal reach, ends cut at 45 degrees.
 *
 * Thickness is 1.18 stems (20.2 units against a stem of 17.1). At exactly one stem the
 * bars read as fallen-over letters; the extra weight is what makes them read as rules. The
 * short bar stops at 58 of 100, far enough short of the long one that the inequality reads
 * as the point rather than as a wobble.
 */
const MARK: readonly string[] = [
  "M0 20.16H79.77L100 40.39H0Z",
  "M0 59.61H37.77L58 79.84H0Z",
];

/** "Arbiter" — Host Grotesk 600, optically spaced, outlined. GENERATED; see above. */
const WORD =
  "M1.96 102.86 38.55 2.86H57.67L94.33 102.86H76.2L44.49 12.49H51.69L19.98 102.86ZM18.9 79.25 23.53 65.76H72.76L77.39 79.25ZM104.12 100V29.14H121.26V40.02Q123.96 34.65 128.2 31.58Q132.45 28.51 138.08 28.51H147.57V43.9H136.36Q131.36 43.9 128 46.55Q124.63 49.2 122.95 54.68Q121.26 60.16 121.26 68.49V100ZM200.79 101.71Q192.61 101.71 186.5 98.59Q180.39 95.47 176.67 89.88V100H159.53V-2.86H176.67V39.59Q180.1 34.78 185.93 31.1Q191.75 27.43 200.84 27.43Q210.94 27.43 218.79 32.29Q226.65 37.14 231.16 45.57Q235.67 54 235.67 64.71Q235.67 75.33 231.16 83.73Q226.65 92.14 218.79 96.93Q210.94 101.71 200.79 101.71ZM197.3 86.78Q203.45 86.78 208.19 83.92Q212.94 81.06 215.61 76.08Q218.28 71.1 218.28 64.67Q218.28 58.14 215.61 53.09Q212.94 48.04 208.19 45.2Q203.45 42.37 197.3 42.37Q191.2 42.37 186.49 45.2Q181.77 48.04 179.1 53.04Q176.43 58.04 176.43 64.57Q176.43 71.1 179.1 76.08Q181.77 81.06 186.49 83.92Q191.2 86.78 197.3 86.78ZM247.63 100V29.14H264.78V100ZM247.59 16.96V-0.51H264.94V16.96ZM309.96 100Q303.1 100 298.4 98.37Q293.7 96.73 291.31 92.13Q288.92 87.53 288.92 78.9V43.53H276.74V29.14H288.92V10.57H306.06V29.14H324.55V43.53H306.06V76.63Q306.06 80.45 306.8 82.33Q307.53 84.2 309.58 84.81Q311.64 85.41 315.37 85.41H323.88V100ZM367.06 101.71Q356.35 101.71 348.12 97.07Q339.9 92.43 335.26 84.17Q330.63 75.92 330.63 65.04Q330.63 53.96 335.19 45.47Q339.75 36.98 348.02 32.2Q356.29 27.43 367.14 27.43Q377.63 27.43 385.53 32.02Q393.43 36.61 397.8 44.4Q402.16 52.18 402.16 61.88Q402.16 63.31 402.16 65.03Q402.16 66.76 401.92 68.65H343.04V57.63H384.9Q384.47 50.16 379.48 45.79Q374.49 41.41 367.12 41.41Q361.82 41.41 357.32 43.76Q352.82 46.1 350.15 50.79Q347.49 55.47 347.49 62.59V66.65Q347.49 73.27 350.09 77.99Q352.69 82.71 357.11 85.17Q361.53 87.63 366.96 87.63Q372.82 87.63 376.82 84.99Q380.82 82.35 382.8 77.92H400.16Q398.24 84.65 393.64 90.05Q389.04 95.45 382.3 98.58Q375.55 101.71 367.06 101.71ZM414.12 100V29.14H431.26V40.02Q433.96 34.65 438.2 31.58Q442.45 28.51 448.08 28.51H457.57V43.9H446.36Q441.36 43.9 438 46.55Q434.63 49.2 432.95 54.68Q431.26 60.16 431.26 68.49V100Z";

/**
 * The logo: the ruling, then the word.
 *
 * Both headers size this with `height: 15px; width: auto`, which is the contract this
 * component has always had. The viewBox is therefore the INK box and not a padded square —
 * a bounding box with air in it renders the logo smaller than the number the stylesheet
 * asked for, and every header would silently shrink.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${CAP + GAP + WORD_W} ${WORD_H}`}
      fill="currentColor"
      role="img"
      aria-label="Arbiter"
    >
      {/* Hung off the CAP LINE, not the top of the ink box — see CAP_TOP above. */}
      <g transform={`translate(0,${CAP_TOP})`}>
        {MARK.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
      <g transform={`translate(${CAP + GAP},0)`}>
        <path d={WORD} />
      </g>
    </svg>
  );
}

/**
 * The mark on its own — square viewBox, for the favicon, an avatar, or anywhere too tight
 * for the word. Two bars survive 16 pixels; seven letters do not.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${CAP} ${CAP}`}
      fill="currentColor"
      role="img"
      aria-label="Arbiter"
    >
      {MARK.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
