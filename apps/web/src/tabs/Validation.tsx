import { useAppState } from "../state/store.js";

/**
 * Coverage before accuracy, deliberately.
 *
 * ARBITER commits on 4 of 61 conflict-subset compounds and the best baseline on
 * 3. A balanced accuracy computed over four same-label compounds is half a
 * substituted 0.5, and putting it first would invite it to be read as a result.
 */
export function ValidationTab() {
  const { data } = useAppState();
  // Typed end to end. This read was a `Record<string, any>` cast, and the local
  // Pipeline/Interval interfaces beneath it were a second, unenforced copy of the
  // harness's own types - so `npm run typecheck` stayed green while this file
  // referenced a field the harness had renamed away.
  const m = data.metrics;
  const acc = m.metric1_conflictSubsetAccuracy;
  const arbiter = acc.arbiter;
  const baselines = Object.entries(acc.baselines)
    .filter(([, b]) => b.nCommitted > 0)
    .sort((a, b) => b[1].balancedAccuracy - a[1].balancedAccuracy);

  return (
    <section style={{ padding: 20 }}>
      <h2 style={{ fontFamily: "var(--serif)" }}>Validation</h2>

      <p data-testid="provenance" style={{ color: "var(--muted)", fontSize: 13 }}>
        ruleset {m.provenance.rulesetHash.slice(0, 8)}… · split seed {m.provenance.splitSeed} ·
        perturbation seed {m.provenance.perturbationSeed} · scored on the {m.provenance.scoredSplit} split
      </p>

      {/* The interval attached here must describe the number it sits beside.
          This previously read "balanced accuracy 0.75 (95% CI 0.51-1.00)", where
          the interval was really wilson(4,4) on RAW accuracy 4/4 = 1.0 - an
          uncertainty claim about a different statistic. Where balanced accuracy
          substitutes 0.5 for an absent class there is no interval to report,
          because a substitution is not an estimate, so we say that instead of
          borrowing one. */}
      <p data-testid="headline">
        Conflict subset n = <strong>{acc.n}</strong>. ARBITER coverage{" "}
        <strong>{(arbiter.coverage * 100).toFixed(1)}%</strong> ({arbiter.nCommitted} committed).
        {" "}balanced accuracy {arbiter.balancedAccuracy.toFixed(2)}{" "}
        {arbiter.balancedAccuracyCi
          ? `(95% CI ${arbiter.balancedAccuracyCi.lo.toFixed(2)}–${arbiter.balancedAccuracyCi.hi.toFixed(2)})`
          : "(no confidence interval: one class is absent from the committed set, so half of this figure is a substituted 0.5 rather than an estimate)"}.
      </p>

      {/* The style below was measured at 14px/400 and raised deliberately. This is
          the one line in the app that must survive screen-share compression: the
          balanced accuracy beside it is half a substituted 0.5, and a judge who
          reads the number but not the caveat has been misled by us. The most
          important caveat should not render at the same weight as body copy. */}
      {arbiter.singleClass && (
        <p data-testid="single-class-warning"
           style={{ color: "var(--toxic)", fontSize: 15, fontWeight: 600 }}>
          <strong>Single-class:</strong> ARBITER committed on only one label, so this balanced accuracy is
          half a substituted 0.5. It must not be quoted as an accuracy. Coverage is the finding — no compound
          in this set carries exposure-relevant evidence, so R3 discounts every safe claim.
        </p>
      )}

      <h3>Baselines</h3>
      <table style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th>Pipeline</th><th>n committed</th><th>coverage</th><th>balanced accuracy</th><th></th>
          </tr>
        </thead>
        <tbody>
          {baselines.map(([name, b]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{b.nCommitted}</td>
              <td>{(b.coverage * 100).toFixed(1)}%</td>
              <td>{b.balancedAccuracy.toFixed(2)}</td>
              <td style={{ color: "var(--toxic)" }}>{b.singleClass ? "single-class" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>What is reportable</h3>
      <p data-testid="planner-stability">
        Planner recommendation unchanged under ±50% perturbation of every expert-elicited prior:{" "}
        <strong>{m.metric5_plannerSensitivity.meanUnchangedFraction.toFixed(3)}</strong>.
        The recommendation is driven by argument structure, not by the priors.
      </p>
      <p>
        Robustness on committed compounds:{" "}
        {m.metric2b_arbiterRobustness.meanHeldFractionOnCommitted.toFixed(3)} ·{" "}
        determinism verified by a 1000-run single-hash test.
      </p>
      <p data-testid="llm-ablation" style={{ color: "var(--muted)" }}>
        LLM ablation: {JSON.stringify(m.metric2a_llmConsistency)}
      </p>
    </section>
  );
}
