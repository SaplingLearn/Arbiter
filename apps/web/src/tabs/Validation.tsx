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
    // The shell supplies .container. Prose gets a measure; the baseline table
    // does not.
    <section>
      <div className="prose">
        <p className="label">Measured</p>
        <h2 className="display">Validation</h2>

        <p className="small muted" data-testid="provenance">
          ruleset <span className="mono">{m.provenance.rulesetHash.slice(0, 8)}…</span> · split seed{" "}
          {m.provenance.splitSeed} · perturbation seed {m.provenance.perturbationSeed} · scored on the{" "}
          {m.provenance.scoredSplit} split
        </p>

        {/* The interval attached here must describe the number it sits beside.
            This previously read "balanced accuracy 0.75 (95% CI 0.51-1.00)", where
            the interval was really wilson(4,4) on RAW accuracy 4/4 = 1.0 - an
            uncertainty claim about a different statistic. Where balanced accuracy
            substitutes 0.5 for an absent class there is no interval to report,
            because a substitution is not an estimate, so we say that instead of
            borrowing one. */}
        <p className="lede" data-testid="headline">
          Conflict subset n = <strong>{acc.n}</strong>. ARBITER coverage{" "}
          <strong>{(arbiter.coverage * 100).toFixed(1)}%</strong> ({arbiter.nCommitted} committed).
          {" "}balanced accuracy {arbiter.balancedAccuracy.toFixed(2)}{" "}
          {arbiter.balancedAccuracyCi
            ? `(95% CI ${arbiter.balancedAccuracyCi.lo.toFixed(2)}–${arbiter.balancedAccuracyCi.hi.toFixed(2)})`
            : "(no confidence interval: one class is absent from the committed set, so half of this figure is a substituted 0.5 rather than an estimate)"}.
        </p>

        {/* .caveat .caveat-warn is 15px/600 by construction. It was inline at
            14px/400 once, and static-file.spec.ts measures it now: this is the one
            line in the app that must survive screen-share compression, because the
            balanced accuracy beside it is half a substituted 0.5 and a judge who
            reads the number but not the caveat has been misled by us. */}
        {arbiter.singleClass && (
          <p className="caveat caveat-warn" data-testid="single-class-warning">
            <strong>Single-class:</strong> ARBITER committed on only one label, so this balanced accuracy is
            half a substituted 0.5. It must not be quoted as an accuracy. Coverage is the finding — no compound
            in this set carries exposure-relevant evidence, so R3 discounts every safe claim.
          </p>
        )}
      </div>

      <hr className="rule" />

      <h3 className="subtitle">Baselines</h3>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Pipeline</th>
            <th scope="col" className="n">n committed</th>
            <th scope="col" className="n">Coverage</th>
            <th scope="col" className="n">Balanced accuracy</th>
            <th scope="col">Flag</th>
          </tr>
        </thead>
        <tbody>
          {baselines.map(([name, b]) => (
            <tr key={name}>
              <td>{name}</td>
              <td className="n">{b.nCommitted}</td>
              <td className="n">{(b.coverage * 100).toFixed(1)}%</td>
              <td className="n">{b.balancedAccuracy.toFixed(2)}</td>
              <td>{b.singleClass ? <span className="chip chip-warn">single-class</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <hr className="rule" />

      <div className="prose">
        <h3 className="subtitle">What is reportable</h3>
        <p data-testid="planner-stability">
          Planner recommendation unchanged under ±50% perturbation of every expert-elicited prior:{" "}
          <strong className="num">{m.metric5_plannerSensitivity.meanUnchangedFraction.toFixed(3)}</strong>.
          The recommendation is driven by argument structure, not by the priors.
        </p>
        <p>
          Robustness on committed compounds:{" "}
          <span className="num">{m.metric2b_arbiterRobustness.meanHeldFractionOnCommitted.toFixed(3)}</span> ·{" "}
          determinism verified by a 1000-run single-hash test.
        </p>
        <p className="small muted" data-testid="llm-ablation">
          LLM ablation: <span className="mono">{JSON.stringify(m.metric2a_llmConsistency)}</span>
        </p>
      </div>
    </section>
  );
}
