export function EvidencePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  if (collapsed) return <button type="button" onClick={onExpand} aria-label="Expand the evidence panel">Evidence</button>;
  return <div><h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>Evidence</h3></div>;
}
