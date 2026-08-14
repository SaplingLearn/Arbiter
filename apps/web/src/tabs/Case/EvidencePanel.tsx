import { isEdited, useAppState, visibleClaims, workingClaims } from "../../state/store.js";
import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { Dot } from "../../ui/primitives/Dot.js";
import { evidenceClaim } from "../../ai/anchors.js";

/**
 * Call site 3 of the four (§9), and the surface where the evidence working copy
 * becomes visible.
 */
export function EvidencePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const state = useAppState();
  const { data, asOf, selectedCompoundId, evidenceEdits } = state;
  const r = useCaseReasoning();
  const citationStatus = data.heroCases.get(selectedCompoundId)?.citationStatus ?? null;
  const claims = visibleClaims(workingClaims(state, selectedCompoundId), asOf);
  const stepFor = (id: string) => r.trace.find((s) => s.claimId === id);

  // The SAME predicate the Ruleset tab and the pre-flight panel use (§9.3),
  // applied to one claim's overlay against an empty one. Exact because
  // reclassifyClaim prunes a field set back to its registered value rather than
  // storing it, so a present overlay is always a genuine change.
  const modified = (id: string) => isEdited(evidenceEdits[id] ?? {}, {});

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
      {citationStatus !== null && (
        <p data-testid="citation-status" data-anchor="evidence.citationStatus" className="caveat case-caveat">
          Literature fixture · citations {citationStatus}
        </p>
      )}
      <ul className="evidence-list">
        {claims.map((c) => {
          const step = stepFor(c.id);
          const defeated = step?.status === "defeated";
          return (
            <li key={c.id} data-testid="evidence-row" data-anchor={evidenceClaim(c.id)}
                className={`evidence-row${defeated ? " is-defeated" : ""}`}>
              <div className="evidence-head">
                <Dot assertion={c.assertion} defeated={defeated} />
                <strong className="evidence-stream">{c.stream}</strong>
                <span className="muted">{c.system} · strength <span className="num">{c.strength.toFixed(2)}</span></span>
                {/* Mirrors the Ruleset tab's treatment word for word. A verdict
                    computed from reclassified evidence must never be readable as
                    one computed from the registered evidence. */}
                {modified(c.id) && (
                  <strong data-testid="claim-modified-badge" className="chip chip-warn">
                    MODIFIED - not the registered claim
                  </strong>
                )}
                {/*
                  R4 fired on this claim. The trace already says so in a sentence,
                  but a sentence in the rationale is not a property of the ROW - a
                  downweighted claim otherwise looks exactly like an admitted one,
                  and the reduced weight is the whole point of the rule. Rendered
                  on `=== false` and not on `null`, matching R4 itself: not
                  assessable is benign, and badging it would make the badge noise.
                */}
                {c.inApplicabilityDomain === false && (
                  <strong data-testid="domain-badge" className="chip chip-domain">
                    OUT OF DOMAIN - R4
                  </strong>
                )}
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
