import { useAppState, useDispatch, visibleClaims, workingClaims } from "../../state/store.js";
import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { VerdictLabel } from "../../ui/primitives/VerdictLabel.js";

/**
 * The as-of control lives HERE, not in global settings: it is an input to this
 * case, not an application preference (master spec section 9).
 *
 * Call site 2 of the four (§9). The hidden-count is computed from the same list
 * the verdict beside it was computed from, which is the property the refactor
 * exists to guarantee.
 */
export function CaseHeader() {
  const state = useAppState();
  const { data, asOf, selectedCompoundId } = state;
  const dispatch = useDispatch();
  const r = useCaseReasoning();

  const hero = data.heroCases.get(selectedCompoundId);
  const all = workingClaims(state, selectedCompoundId);
  const shown = visibleClaims(all, asOf);
  const hidden = all.length - shown.length;
  const compound = data.compounds.get(selectedCompoundId);
  const name = hero?.displayName ?? compound?.name ?? selectedCompoundId;
  const compoundClass = hero?.subtitle
    ?? compound?.dilirankLabel
    ?? "DILIrank class not recorded";
  const milestones = Object.entries(hero?.asOfMilestones ?? {});

  return (
    <header className="case-header">
      {/* The masthead: the compound on the left, what ARBITER concluded about it
          on the right, sharing one baseline so they read as a single line. */}
      <div className="case-masthead">
        <div>
          <h2 className="display">{name}</h2>
          <p className="muted case-subtitle">{compoundClass}</p>
        </div>
        {/* The anchor wraps the primitive rather than living inside it: the
            testid `verdict` is frozen by Playwright and VerdictLabel is shared. */}
        <span data-anchor="case.verdict"><VerdictLabel verdict={r.verdict} /></span>
      </div>

      {/* Belief, plausibility and the gap are read against each other, so they
          are one set of pairs in tabular figures rather than a sentence. */}
      <div data-testid="belief-range" data-anchor="case.beliefRange" className="case-figures">
        <dl className="kv">
          <dt>Belief – plausibility</dt>
          <dd>{r.belief.toFixed(3)} – {r.plausibility.toFixed(3)}</dd>
        </dl>
        <dl className="kv">
          <dt>Gap</dt>
          <dd>{(r.plausibility - r.belief).toFixed(3)}</dd>
        </dl>
      </div>

      <div className="case-asof" data-anchor="case.asOf">
        <span className="label">As of</span>
        <button type="button" className="btn" onClick={() => dispatch({ type: "setAsOf", asOf: null })}
                aria-pressed={asOf === null}>All evidence</button>
        {milestones.map(([label, date]) => (
          <button key={date} type="button" className="btn"
                  onClick={() => dispatch({ type: "setAsOf", asOf: date })}
                  aria-pressed={asOf === date}>
            {label} ({date})
          </button>
        ))}
        <span data-testid="hidden-count" data-anchor="case.hiddenCount" className="small muted">
          {hidden === 0 ? "nothing hidden" : `${hidden} of ${all.length} claims hidden by this date`}
        </span>
      </div>
    </header>
  );
}
