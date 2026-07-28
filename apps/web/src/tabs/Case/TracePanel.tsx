import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { BeliefTrack } from "./BeliefTrack.js";

export function TracePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const r = useCaseReasoning();
  const claimSteps = r.trace.filter((s) => s.kind !== "verdict");
  const verdictStep = r.trace.find((s) => s.kind === "verdict");

  if (collapsed) {
    return <button type="button" onClick={onExpand} aria-label="Expand the argument trace">Trace</button>;
  }

  return (
    <div>
      <h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>Argument</h3>
      <BeliefTrack belief={r.belief} plausibility={r.plausibility} />

      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>
        mass toxic {r.mass.toxic.toFixed(3)} · safe {r.mass.safe.toFixed(3)} · uncommitted {r.mass.uncommitted.toFixed(3)}
        {r.contested && " · contested"}
      </p>

      <ol style={{ paddingLeft: 18 }}>
        {claimSteps.map((s) => (
          <li key={s.claimId} data-testid="trace-step" style={{ marginBottom: 8, fontSize: 13 }}>
            <strong>{s.claimId}</strong> — {s.status}
            {s.byRule && <span style={{ color: "var(--pfizer-blue)" }}> · {s.byRule}</span>}
            <div style={{ color: "var(--muted)" }}>{s.rationale}</div>
          </li>
        ))}
      </ol>

      {verdictStep && (
        <p data-testid="verdict-reason" style={{ fontFamily: "var(--serif)" }}>{verdictStep.rationale}</p>
      )}

      {r.counterfactual && (
        <section data-testid="counterfactual">
          <h4>What would change it</h4>
          <p style={{ fontSize: 13 }}>
            {r.counterfactual.flips.map((f) => `${f.claimId} → ${f.to}`).join(" and ")}
            {" "}gives <strong>{r.counterfactual.newVerdict}</strong>.
          </p>
        </section>
      )}

      {r.nextExperiment && (
        <section data-testid="next-experiment">
          <h4>The experiment it asks for</h4>
          <p style={{ fontSize: 13 }}>{r.nextExperiment.rationale}</p>
        </section>
      )}
    </div>
  );
}
