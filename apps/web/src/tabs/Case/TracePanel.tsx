import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { BeliefTrack } from "./BeliefTrack.js";
import { traceStep } from "../../ai/anchors.js";

export function TracePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const r = useCaseReasoning();
  const claimSteps = r.trace.filter((s) => s.kind !== "verdict");
  const verdictStep = r.trace.find((s) => s.kind === "verdict");

  if (collapsed) {
    return (
      <button type="button" className="case-rail" onClick={onExpand} aria-label="Expand the argument trace">
        Trace
      </button>
    );
  }

  return (
    <div>
      <h3 className="label">Argument</h3>
      <BeliefTrack belief={r.belief} plausibility={r.plausibility} />

      <p className="small muted case-mass" data-anchor="trace.mass">
        mass toxic <span className="num">{r.mass.toxic.toFixed(3)}</span> ·
        safe <span className="num">{r.mass.safe.toFixed(3)}</span> ·
        uncommitted <span className="num">{r.mass.uncommitted.toFixed(3)}</span>
        {r.contested && " · contested"}
      </p>

      {/*
        The conflict measure, shown rather than averaged away. Dempster's rule
        normalises conflict out of the combined mass; this engine keeps the
        quantity and reports it, which is the whole answer to the standard
        high-conflict objection. A boolean cannot carry that - 0.122 and 0.999 are
        different situations - so the magnitude is on screen.
      */}
      <p
        className="small muted case-mass"
        data-testid="conflict-mass"
        data-conflict={r.conflictMass.toFixed(3)}
      >
        conflict mass <span className="num">{r.conflictMass.toFixed(3)}</span>
        {" - the belief removed in combination, reported rather than normalised away."}
      </p>

      <ol className="trace-list small">
        {claimSteps.map((s) => (
          <li key={s.claimId} data-testid="trace-step" data-anchor={traceStep(s.claimId)} className="trace-step">
            <strong className="mono">{s.claimId}</strong> - {s.status}
            {/* The rule that fired is one of the three jobs --pfizer-blue is
                reserved for, and it is a field value rather than a badge. */}
            {s.byRule && <span className="chip chip-fired">{s.byRule}</span>}
            <div className="muted">{s.rationale}</div>
          </li>
        ))}
      </ol>

      {verdictStep && (
        <p data-testid="verdict-reason" data-anchor="trace.verdictReason" className="case-reason">{verdictStep.rationale}</p>
      )}

      {r.counterfactual && (
        <section data-testid="counterfactual" data-anchor="trace.counterfactual" className="case-aside">
          <h4 className="label">What would change it</h4>
          <p className="small">
            {r.counterfactual.flips.map((f) => `${f.claimId} → ${f.to}`).join(" and ")}
            {" "}gives <strong>{r.counterfactual.newVerdict}</strong>.
          </p>
        </section>
      )}

      {r.nextExperiment && (
        <section data-testid="next-experiment" data-anchor="trace.nextExperiment" className="case-aside">
          <h4 className="label">The experiment it asks for</h4>
          <p className="small">{r.nextExperiment.rationale}</p>
        </section>
      )}
    </div>
  );
}
