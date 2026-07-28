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
  const name = isFixture ? "TAK-994" : (data.compounds.get(selectedCompoundId)?.name ?? selectedCompoundId);
  const milestones = Object.entries(data.fixture.asOfMilestones);

  return (
    <header style={{ borderBottom: "1px solid var(--hairline)", padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 24 }}>
        <h2 style={{ fontFamily: "var(--serif)", margin: 0, fontSize: 22 }}>{name}</h2>
        <VerdictLabel verdict={r.verdict} />
      </div>

      <div data-testid="belief-range" style={{ color: "var(--muted)", marginTop: 6 }}>
        Belief {r.belief.toFixed(3)} – plausibility {r.plausibility.toFixed(3)}
        <span style={{ marginLeft: 12 }}>gap {(r.plausibility - r.belief).toFixed(3)}</span>
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)" }}>As of</span>
        <button type="button" onClick={() => dispatch({ type: "setAsOf", asOf: null })}
                aria-pressed={asOf === null}>All evidence</button>
        {milestones.map(([label, date]) => (
          <button key={date} type="button" onClick={() => dispatch({ type: "setAsOf", asOf: date })}
                  aria-pressed={asOf === date}>
            {label} ({date})
          </button>
        ))}
        <span data-testid="hidden-count" style={{ color: "var(--muted)" }}>
          {hidden === 0 ? "nothing hidden" : `${hidden} of ${all.length} claims hidden by this date`}
        </span>
      </div>
    </header>
  );
}
