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
      <button type="button" className="case-rail" onClick={onExpand} aria-label="Expand the evidence panel">
        {claims.map((c) => (
          <Dot key={c.id} assertion={c.assertion} defeated={stepFor(c.id)?.status === "defeated"} />
        ))}
      </button>
    );
  }

  return (
    <div>
      <h3 className="label">Evidence</h3>
      {/* .caveat, not the 13px used for incidental captions. UNVERIFIED citations
          is a disclosure, and it was measured as the smallest text on the Case tab -
          the caveat least likely to survive a compressed share. */}
      {isFixture && (
        <p data-testid="citation-status" className="caveat case-caveat">
          Literature fixture · citations {data.fixture.citationStatus}
        </p>
      )}
      <ul className="evidence-list">
        {claims.map((c) => {
          const step = stepFor(c.id);
          const defeated = step?.status === "defeated";
          return (
            <li key={c.id} data-testid="evidence-row"
                className={`evidence-row${defeated ? " is-defeated" : ""}`}>
              <div className="evidence-head">
                <Dot assertion={c.assertion} defeated={defeated} />
                <strong className="evidence-stream">{c.stream}</strong>
                <span className="muted">{c.system} · strength <span className="num">{c.strength.toFixed(2)}</span></span>
              </div>
              <div data-testid="provenance" className="small muted">
                {c.provenance.kind.toUpperCase()} · {c.provenance.source}
              </div>
              {step && <div className="small">{step.rationale}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
