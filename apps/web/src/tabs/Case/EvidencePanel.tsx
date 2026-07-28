import { useAppState, visibleClaims } from "../../state/store.js";
import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { Dot } from "../../ui/primitives/Dot.js";

export function EvidencePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const { data, asOf, selectedCompoundId } = useAppState();
  const r = useCaseReasoning();
  const isFixture = selectedCompoundId === data.fixture.compoundId;
  const all = isFixture ? data.fixture.claims : (data.claimsByCompound.get(selectedCompoundId) ?? []);
  const claims = visibleClaims(all, asOf);
  const stepFor = (id: string) => r.trace.find((s) => s.claimId === id);

  if (collapsed) {
    return (
      <button type="button" onClick={onExpand} aria-label="Expand the evidence panel"
              style={{ display: "flex", flexDirection: "column", gap: 6, background: "none", border: 0, cursor: "pointer" }}>
        {claims.map((c) => (
          <Dot key={c.id} assertion={c.assertion} defeated={stepFor(c.id)?.status === "defeated"} />
        ))}
      </button>
    );
  }

  return (
    <div>
      <h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>Evidence</h3>
      {/* 14px below, not the 13px used for incidental captions. UNVERIFIED citations
          is a disclosure, and it was measured as the smallest text on the Case tab -
          the caveat least likely to survive a compressed share. */}
      {isFixture && (
        <p data-testid="citation-status" style={{ color: "var(--ambiguous)", fontSize: 14, fontWeight: 600 }}>
          Literature fixture · citations {data.fixture.citationStatus}
        </p>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {claims.map((c) => {
          const step = stepFor(c.id);
          const defeated = step?.status === "defeated";
          return (
            <li key={c.id} data-testid="evidence-row"
                style={{ padding: "10px 0", borderBottom: "1px solid var(--hairline-soft)", opacity: defeated ? 0.55 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Dot assertion={c.assertion} defeated={defeated} />
                <strong style={{ fontSize: 15, textDecoration: defeated ? "line-through" : "none" }}>{c.stream}</strong>
                <span style={{ color: "var(--muted)" }}>{c.system} · strength {c.strength.toFixed(2)}</span>
              </div>
              <div data-testid="provenance" style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                {c.provenance.kind.toUpperCase()} · {c.provenance.source}
              </div>
              {step && <div style={{ fontSize: 13, marginTop: 4 }}>{step.rationale}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
