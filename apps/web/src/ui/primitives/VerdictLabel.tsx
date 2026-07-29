import type { Verdict } from "@arbiter/engine";

const FACE: Record<Verdict, { text: string; tone: string; marker: string }> = {
  advance: { text: "Advance", tone: "verdict-clean", marker: "●" },
  do_not_advance: { text: "Do not advance", tone: "verdict-toxic", marker: "■" },
  abstain: { text: "Abstain", tone: "verdict-abstain", marker: "▲" },
};

/**
 * Colour is never the sole carrier of meaning (master spec section 9): each
 * verdict also has its own word AND its own marker glyph, so the label survives
 * greyscale, colour-blindness and screen-share compression. The tone class only
 * ever adds colour on top of those two.
 */
export function VerdictLabel({ verdict }: { verdict: Verdict }) {
  const f = FACE[verdict];
  return (
    <span data-testid="verdict" className={`verdict ${f.tone}`}>
      <span aria-hidden="true" className="verdict-marker">{f.marker}</span>{f.text}
    </span>
  );
}
