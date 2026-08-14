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
                {/* Strictly === false. The field is boolean | null, and null means
                    the concept does not apply to this kind of claim: a measured
                    assay has no applicability domain. A truthiness check would
                    badge every measured row as an out-of-domain prediction, which
                    is the opposite of what the flag says.

                    Deliberately NOT .chip-warn. That treatment belongs to the
                    MODIFIED badge beside it, which warns that a reader changed the
                    input. This is a property of the REGISTERED evidence and a
                    legitimate kind of claim weighed appropriately, so it reads as a
                    qualifier rather than as tampering. */}
                {c.inApplicabilityDomain === false && (
                  <span data-testid="out-of-domain" className="chip chip-domain">
                    outside applicability domain
                  </span>
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
      {/* Said once beneath the list rather than per row, and only when a row
          carries the badge: an explanation for a badge nobody can see leaves a
          reader hunting for it. */}
      {claims.some((c) => c.inApplicabilityDomain === false) && (
        <p data-testid="domain-note" className="small muted">
          A claim marked outside applicability domain is a prediction about a compound
          unlike the model&apos;s training set. Rule R4 admits it at reduced weight rather
          than excluding it, following the OECD principles for QSAR validation, where the
          applicability domain is a required element of a valid prediction.
        </p>
      )}
    </div>
  );
}
