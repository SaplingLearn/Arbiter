import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { BeliefTrack } from "./BeliefTrack.js";
import { traceStep } from "../../ai/anchors.js";

/**
 * Below this, treat the conflict as none.
 *
 * Not a comparison against exactly 0: fusing many claims can leave a residue like
 * 1e-17 on a case where nothing actually opposed anything, and printing "the
 * sources contradict each other" for 1e-17 would be false. Cyclosporine, the only
 * rendered case with real conflict, sits at 0.1215, so the floor is nowhere near
 * anything it has to distinguish.
 */
const CONFLICT_FLOOR = 0.05;

/**
 * The plain-language half of the conflict measure, and the reason the number is
 * worth rendering at all.
 *
 * The same belief-to-plausibility width means two different things, and they have
 * different next steps. Wide with near-zero conflict is ABSENT evidence: nobody
 * measured the question, and the planner's experiment is the answer. Wide with
 * high conflict is a DISPUTE: the sources contradict each other and somebody has
 * to decide which to believe. A reader given only the width cannot tell which
 * problem they have.
 */
function conflictReading(conflictMass: number): string {
  if (conflictMass < CONFLICT_FLOOR) {
    return "The sources barely contradict each other, so a wide interval here is missing evidence rather than disputed evidence. The experiment below is what would narrow it.";
  }
  return "The sources contradict each other, and this is how much of their combined mass was contradiction. Dempster's rule divides that out to renormalise; it is reported here rather than absorbed, because an interval derived from only the surviving fraction reads as more confidence than the evidence supports.";
}

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

      <p className="small muted case-conflict" data-testid="conflict-measure" data-anchor="trace.conflict">
        conflict <span className="num">{r.conflictMass.toFixed(3)}</span>
      </p>
      <p className="small muted case-conflict-reading" data-testid="conflict-reading">
        {conflictReading(r.conflictMass)}
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
