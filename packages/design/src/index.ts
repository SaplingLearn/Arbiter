/**
 * The Arbiter design system.
 *
 * Every surface draws its chrome from here: the tokens in `tokens.css`, and the
 * primitives below. Import the stylesheet once per app entry, then the components.
 *
 * NOTHING IN THIS PACKAGE KNOWS ABOUT A ROUTE, AN API OR A URL. That is the line that
 * keeps it reusable: the moment a control here imports the landing page's link table it
 * stops being a design system and becomes that page's components, borrowed. Anything
 * app-specific is passed in.
 */
export { Wordmark, Mark } from "./Wordmark.js";
export { PixelGlyph, Cta, Segment, SegmentPair } from "./Controls.js";
export { Cursor } from "./Cursor.js";
export { getPointer, ease, hasFinePointer } from "./pointer.js";
export { Decode } from "./text/Decode.js";
export { BlockWipe, type BlockWipeHandle } from "./text/BlockWipe.js";
export { Headline, RevealParagraph } from "./text/Headline.js";
export { GLYPHS, reducedMotion, randomGlyph, staggerFor, scrambleFrames, ROLL_MS } from "./text/motion.js";
