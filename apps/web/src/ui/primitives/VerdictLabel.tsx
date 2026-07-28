import type { Verdict } from "@arbiter/engine";

const FACE: Record<Verdict, { text: string; colour: string; marker: string }> = {
  advance: { text: "Advance", colour: "var(--clean)", marker: "●" },
  do_not_advance: { text: "Do not advance", colour: "var(--toxic)", marker: "■" },
  abstain: { text: "Abstain", colour: "var(--ambiguous)", marker: "▲" },
};

/**
 * Colour is never the sole carrier of meaning (master spec section 9): each
 * verdict also has a distinct marker glyph, so the label survives greyscale,
 * colour-blindness and screen-share compression.
 */
export function VerdictLabel({ verdict }: { verdict: Verdict }) {
  const f = FACE[verdict];
  return (
    <span data-testid="verdict" style={{ color: f.colour, fontFamily: "var(--serif)", fontSize: 27 }}>
      <span aria-hidden="true" style={{ marginRight: 8 }}>{f.marker}</span>{f.text}
    </span>
  );
}
