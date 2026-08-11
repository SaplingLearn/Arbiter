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

  // Widest stream first, so the row that reads as broad coverage sits at the top
  // and the one carrying the tie sits at the bottom where the caveat points at it.
  const streams = Object.entries(m.sampleSizes.streamCoverage)
    .sort((a, b) => b[1].compounds - a[1].compounds);
  const thinnest = streams[streams.length - 1] ?? null;

  // Surface 2, the live ablation spot check: SPECIFIED, NOT BUILT (Phase 3 spec §6).
  // The headline it would append to is pre-computed per compound, and that ablation
  // does not exist - `npm run ablation` is absent from the repo (HANDOVER §3.2).
  // metric2a_llmConsistency is a genuine union (LlmConsistencyPending has `note`,
  // LlmConsistencyMeasured does not) rather than one shape with an optional half, so
  // narrowing on "note" is the type-correct read of "has the ablation run yet". The
  // placeholder already correctly reports its own absence, so the tooltip is READ
  // FROM IT rather than written here; the day the ablation lands, this stops
  // claiming it is missing without anyone editing a string.
  const ablation = m.metric2a_llmConsistency;
  const ablationNote = "note" in ablation ? ablation.note : null;
  const ablationTooltip = ablationNote
    ?? "The live spot check is specified but not built (Phase 3 spec §6) - the button stays disabled.";

  return (
    // The shell supplies .container. Prose gets a measure; the baseline table
    // does not.
    <section>
      <div className="prose">
        <p className="label">Measured</p>
        <h2 className="display">Validation</h2>

        <p className="small muted" data-testid="provenance" data-anchor="validation.provenance">
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
        <p className="lede" data-testid="headline" data-anchor="validation.headline">
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
          <p className="caveat caveat-warn" data-testid="single-class-warning" data-anchor="validation.singleClassWarning">
            <strong>Single-class:</strong> ARBITER committed on only one label, so this balanced accuracy is
            half a substituted 0.5. It must not be quoted as an accuracy. Coverage is the finding, and it is
            about how thin the evidence is rather than about the streams disagreeing - see the stream table
            below, and About for the three causes.
          </p>
        )}
      </div>

      <hr className="rule" />

      {/* Heading and table share one anchor: scrolling to the bare table would
          put "Baselines" off screen and the numbers would arrive unlabelled. */}
      <section data-anchor="validation.baselines">
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
      </section>

      {/* Its own section rather than a second table under validation.baselines: that
          anchor names the baseline comparison, and an anchor that resolves to two
          different tables is one the Navigator cannot spotlight precisely. */}
      <section data-anchor="validation.streamCoverage">
        <h3 className="subtitle">What each pipeline had to work with</h3>
        <table className="table" data-testid="stream-coverage">
          <caption className="label">Evidence streams on the scored split, n = {m.sampleSizes.scored}</caption>
          <thead>
            <tr>
              <th scope="col">Stream</th>
              <th scope="col" className="n">Claims</th>
              <th scope="col" className="n">Compounds</th>
              <th scope="col" className="n">Of the split</th>
            </tr>
          </thead>
          <tbody>
            {streams.map(([name, c]) => (
              <tr key={name}>
                <td>{name}</td>
                <td className="n">{c.claims}</td>
                <td className="n">{c.compounds}</td>
                <td className="n">{((c.compounds / m.sampleSizes.scored) * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* .caveat, not .small.muted, for the same reason the decline note is: this
            is the unflattering half of the table above it, and it is the thing a
            judge will otherwise derive unaided. */}
        {thinnest ? (
          <p className="caveat" data-testid="coverage-caveat" data-anchor="validation.coverageCaveat">
            A single-stream baseline is scored over exactly the compounds that stream reaches, not
            over the split. <strong>{thinnest[0]}</strong> supplies evidence on{" "}
            <strong>{thinnest[1].compounds}</strong> of {m.sampleSizes.scored} compounds, so
            single:{thinnest[0]} commits on {thinnest[1].compounds} because {thinnest[1].compounds}{" "}
            is every compound it has. Read the n committed column before the accuracy beside it.
          </p>
        ) : null}
      </section>

      <hr className="rule" />

      <div className="prose">
        <h3 className="subtitle">What is reportable</h3>
        <p data-testid="planner-stability" data-anchor="validation.plannerStability">
          Planner recommendation unchanged under ±50% perturbation of every expert-elicited prior:{" "}
          <strong className="num">{m.metric5_plannerSensitivity.meanUnchangedFraction.toFixed(3)}</strong>.
          The recommendation is driven by argument structure, not by the priors.
        </p>
        <p data-anchor="validation.robustness">
          Robustness on committed compounds:{" "}
          <span className="num">{m.metric2b_arbiterRobustness.meanHeldFractionOnCommitted.toFixed(3)}</span> ·{" "}
          determinism verified by a 1000-run single-hash test.
        </p>
        <p className="small muted" data-testid="llm-ablation" data-anchor="validation.llmAblation">
          LLM ablation: <span className="mono">{JSON.stringify(m.metric2a_llmConsistency)}</span>
        </p>

        {/* Disabled under every one of §11's five conditions, and under a sixth: the
            ablation it would append to has not been built. The baselines table above
            is untouched either way - that is the whole of Surface 2's §11 row (the
            master spec's own wording: the button disables with a tooltip and the
            table is untouched). Stays disabled even once metric2a_llmConsistency
            carries real numbers - a specified-but-not-built surface must not enable
            itself the day the harness lands under it. */}
        <p className="small muted">
          <button
            type="button"
            className="btn"
            data-testid="live-ablation-run"
            disabled
            title={ablationTooltip}
          >
            Append one live consistency run
          </button>
        </p>
      </div>
    </section>
  );
}
