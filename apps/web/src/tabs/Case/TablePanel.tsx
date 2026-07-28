/** The table region. Phase 3 mounts the challenge interpreter inside this panel. */
export function TablePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  if (collapsed) return <button type="button" onClick={onExpand} aria-label="Expand the table">Table</button>;
  return (
    <div>
      <h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>The table</h3>
      <p style={{ color: "var(--muted)" }}>
        Positions and sign-off are recorded on the Record tab. The challenge interpreter arrives in Phase 3.
      </p>
    </div>
  );
}
