/**
 * The belief-plausibility range, drawn as a band rather than a point.
 *
 * The band spreads outward from centre as the range widens, which is literally
 * what the gap is - the hardest concept in the pitch becomes something a
 * non-technical viewer understands by watching. On the TAK-994 replay the verdict
 * label never changes between passes; this is what moves.
 */
export function BeliefTrack({ belief, plausibility }: { belief: number; plausibility: number }) {
  const width = Math.max(0, plausibility - belief);
  const label = `Belief ${belief.toFixed(3)} to plausibility ${plausibility.toFixed(3)}`;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
        <span data-testid="belief-lo">{belief.toFixed(3)}</span>
        <span data-testid="belief-hi">{plausibility.toFixed(3)}</span>
      </div>
      <div role="img" aria-label={label}
           style={{ position: "relative", height: 14, background: "var(--surface)",
                    border: "1px solid var(--hairline)", borderRadius: "var(--radius)" }}>
        <div
          data-testid="belief-fill"
          data-width={width.toFixed(3)}
          style={{
            position: "absolute", top: 0, bottom: 0,
            left: `${belief * 100}%`, width: `${width * 100}%`,
            background: "var(--pfizer-blue)", opacity: 0.25,
            transition: "left 900ms ease, width 900ms ease",
          }}
        />
      </div>
    </div>
  );
}
