/**
 * The belief-plausibility range, drawn as a band rather than a point.
 *
 * The band spreads outward from centre as the range widens, which is literally
 * what the gap is - the hardest concept in the pitch becomes something a
 * non-technical viewer understands by watching. On the TAK-994 replay the verdict
 * label never changes between passes; this is what moves.
 *
 * `left` and `width` stay inline because they are data. The transition that
 * carries them lives in case.css, where ui/motion.css can kill it - see the
 * comment on .belief-fill and e2e/demo.spec.ts.
 */
export function BeliefTrack({ belief, plausibility }: { belief: number; plausibility: number }) {
  const width = Math.max(0, plausibility - belief);
  const label = `Belief ${belief.toFixed(3)} to plausibility ${plausibility.toFixed(3)}`;
  return (
    <div data-anchor="trace.beliefTrack">
      <div className="belief-ends small muted">
        <span data-testid="belief-lo" className="num">{belief.toFixed(3)}</span>
        <span data-testid="belief-hi" className="num">{plausibility.toFixed(3)}</span>
      </div>
      <div role="img" aria-label={label} className="belief-track">
        <div
          data-testid="belief-fill"
          data-width={width.toFixed(3)}
          className="belief-fill"
          style={{ left: `${belief * 100}%`, width: `${width * 100}%` }}
        />
      </div>
    </div>
  );
}
