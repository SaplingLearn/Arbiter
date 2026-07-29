import { useAppState, useDispatch, visibleClaims } from "../../state/store.js";
import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { VerdictLabel } from "../../ui/primitives/VerdictLabel.js";

/**
 * The as-of control lives HERE, not in global settings: it is an input to this
 * case, not an application preference (master spec section 9).
 */
export function CaseHeader() {
  const { data, asOf, selectedCompoundId } = useAppState();
  const dispatch = useDispatch();
  const r = useCaseReasoning();

  const isFixture = selectedCompoundId === data.fixture.compoundId;
  const all = isFixture ? data.fixture.claims : (data.claimsByCompound.get(selectedCompoundId) ?? []);
  const shown = visibleClaims(all, asOf);
  const hidden = all.length - shown.length;
  const compound = data.compounds.get(selectedCompoundId);
  const name = isFixture ? "TAK-994" : (compound?.name ?? selectedCompoundId);
  // TAK-994 was terminated in Phase 2 and never approved, so it is absent from
  // DILIrank by construction - it is the motivating case, not benchmark evidence.
  const compoundClass = isFixture
    ? "Literature fixture · outside the DILIrank benchmark"
    : (compound?.dilirankLabel ?? "DILIrank class not recorded");
  const milestones = Object.entries(data.fixture.asOfMilestones);

  return (
    <header className="case-header">
      {/* The masthead: the compound on the left, what ARBITER concluded about it
          on the right, sharing one baseline so they read as a single line. */}
      <div className="case-masthead">
        <div>
          <h2 className="display">{name}</h2>
          <p className="muted case-subtitle">{compoundClass}</p>
        </div>
        <VerdictLabel verdict={r.verdict} />
      </div>

      {/* Belief, plausibility and the gap are read against each other, so they
          are one set of pairs in tabular figures rather than a sentence. */}
      <div data-testid="belief-range" className="case-figures">
        <dl className="kv">
          <dt>Belief – plausibility</dt>
          <dd>{r.belief.toFixed(3)} – {r.plausibility.toFixed(3)}</dd>
        </dl>
        <dl className="kv">
          <dt>Gap</dt>
          <dd>{(r.plausibility - r.belief).toFixed(3)}</dd>
        </dl>
      </div>

      <div className="case-asof">
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
        <span data-testid="hidden-count" className="small muted">
          {hidden === 0 ? "nothing hidden" : `${hidden} of ${all.length} claims hidden by this date`}
        </span>
      </div>
    </header>
  );
}
