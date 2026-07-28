export function TracePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  if (collapsed) return <button type="button" onClick={onExpand} aria-label="Expand the argument trace">Trace</button>;
  return <div><h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>Argument</h3></div>;
}
