import { useAppState } from "../state/store.js";

/**
 * The landing page - the first thing anyone sees, because an empty hash resolves
 * here (see router.ts).
 *
 * Every number on this page is read from the bundled `results/metrics.json` at
 * render time rather than typed into the copy. That is not a nicety. A landing
 * page is exactly where a stale number survives longest, and HANDOVER section 2
 * exists because an earlier draft of the spec omitted an unflattering
 * comparison. Rendering both the flattering figure and the unflattering one from
 * the same file means a re-run cannot leave one of them behind.
 *
 * Language is constrained by HANDOVER section 1.3: "review-ready evidence
 * package" not "dossier", "positions / sign-off / decision owner" not "voting",
 * "hash-chained audit log" not "blockchain".
 */
export function AboutTab() {
  const { data } = useAppState();
  const m = data.metrics;
  const acc = m.metric1_conflictSubsetAccuracy;
  const arbiter = acc.arbiter;

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const conf = (c: { tp: number; fp: number; tn: number; fn: number }) =>
    `${c.tp} / ${c.fp} / ${c.tn} / ${c.fn}`;

  // The baseline ARBITER ties. Looked up rather than named in prose alone, and
  // optional because `baselines` is an open record keyed by stream name - if the
  // scored set ever changes, the comparison table disappears rather than
  // asserting a tie against a pipeline nobody ran.
  const TIED = "single:transporter";
  const tied = acc.baselines[TIED];

  return (
    <>
      <header className="hero">
        <div className="hero-grid">
          <div>
            <p className="label">Preclinical toxicity · evidence under conflict</p>
            <h1 className="display">Conflicting evidence, one decision, and the argument that produced it.</h1>
            <div className="prose">
              <p className="lede">
                A compound&apos;s toxicity evidence rarely agrees with itself. A QSAR model predicts
                risk, a transporter assay comes back clean, a cytotoxicity screen is equivocal, an
                in vivo study was run in the wrong species. ARBITER takes those claims as they are
                and returns one of three decisions — advance, do not advance, or abstain — with the
                argument that led there, the evidence that would change it, and a hash-chained audit
                log of who signed off.
              </p>
              <p>
                The output is a review-ready evidence package rather than a score. Its point is that
                a toxicologist can disagree with it in a specific, named place.
              </p>
              <p>
                <a className="btn btn-primary" href="#/case">Open the worked case</a>{" "}
                <span className="small muted">TAK-994 — where every baseline says advance</span>
              </p>
            </div>
          </div>

          <div className="stack">
            <div className="figure">
              <div className="figure-n">{m.metric5_plannerSensitivity.meanUnchangedFraction.toFixed(3)}</div>
              <p className="figure-cap">
                Planner recommendation unchanged under ±50% perturbation of every expert-elicited
                prior ({m.metric5_plannerSensitivity.samplesPerCompound} samples per compound, seed{" "}
                {m.metric5_plannerSensitivity.seed}). The recommendation follows argument structure
                rather than the priors. This is the number worth leading with.
              </p>
            </div>
            <div className="figure">
              <div className="figure-n">{pct(m.metric4_abstentionQuality.declineRate)}</div>
              <p className="figure-cap">
                Of {m.sampleSizes.scored} scored compounds, ARBITER declines to commit on{" "}
                {m.metric4_abstentionQuality.nDeclined} of them. Coverage is the finding here, not a
                footnote — the reason is two sections down.
              </p>
            </div>
            <div className="figure">
              <div className="figure-hash">{m.provenance.rulesetHash.slice(0, 8)}…</div>
              <p className="figure-cap">
                The ruleset, pre-registered and hashed before the run. The harness refuses to run
                when the bundled rules do not hash to this value, and the pre-flight panel
                recomputes it in the browser rather than printing it.
              </p>
            </div>
          </div>
        </div>
      </header>

      <section className="stack">
        <p className="label">How it works, in three moves</p>
        <div className="about-grid">
          <div className="prose">
            <h2 className="title">1 · Fuse the evidence</h2>
            <p>
              Each claim becomes a mass assignment under Dempster–Shafer: some weight on toxic, some
              on safe, the rest left uncommitted. Evidence that cannot speak to the question leaves
              its mass uncommitted instead of splitting it between the two answers, which is what
              keeps ignorance and disagreement distinguishable after combination.
            </p>
          </div>
          <div className="prose">
            <h2 className="title">2 · Argue over it</h2>
            <p>
              Six pre-registered rules, R1 to R6, decide what each claim actually licenses: which
              claims defeat which, what is discounted for species, exposure or assay relevance, and
              where two sources genuinely contradict rather than merely differ. The argumentation is
              defeasible — a conclusion stands until something beats it — and every rule that fires
              is shown beside the claim that triggered it.
            </p>
          </div>
          <div className="prose">
            <h2 className="title">3 · Abstain when it must</h2>
            <p>
              Belief and plausibility bound the answer from below and above. When the gap between
              them is wider than the registered threshold, the engine commits to nothing and names
              the experiment that would narrow it. An abstention is an output with a reason
              attached, not a failure to produce one.
            </p>
          </div>
          <div className="prose">
            <h2 className="title">Registered before it was run</h2>
            <p>
              The rules were written down and hashed first, so none could be tuned after seeing a
              result. Positions are then recorded with dissent intact, a named decision owner signs,
              and every entry chains to the digest of the one before it. ARBITER itself holds no
              position.
            </p>
          </div>
        </div>
      </section>

      <hr className="rule" />

      <section className="stack">
        <p className="label">The result, stated plainly</p>
        <div className="prose stack">
          <h2 className="title">It does not beat the best baseline. It ties one, exactly.</h2>
          <p className="caveat" data-testid="about-tie">
            On the pre-registered conflict subset, ARBITER and <span className="mono">{TIED}</span>{" "}
            return the same figure in every column: {arbiter.balancedAccuracy.toFixed(3)} balanced
            accuracy, {pct(arbiter.coverage)} coverage, {arbiter.nCommitted} compounds committed, and
            the identical confusion matrix. Not close to — the same.
          </p>
          <p>
            Fusing five streams under six rules bought no accuracy over reading the transporter
            assay alone on this benchmark. That belongs on the front page rather than in a footnote:
            an earlier draft of this project&apos;s own specification left the comparison out, and it
            was corrected as a flattering omission.
          </p>
        </div>

        {tied ? (
          <table className="table table-narrow">
            <caption className="label">Conflict subset, n = {acc.n}, test split only</caption>
            <thead>
              <tr>
                <th scope="col">Pipeline</th>
                <th scope="col" className="n">Balanced accuracy</th>
                <th scope="col" className="n">Coverage</th>
                <th scope="col" className="n">Committed</th>
                <th scope="col" className="n">tp / fp / tn / fn</th>
              </tr>
            </thead>
            <tbody>
              {[["ARBITER", arbiter] as const, [TIED, tied] as const].map(([name, p]) => (
                <tr key={name}>
                  <td className="mono">{name}</td>
                  <td className="n">{p.balancedAccuracy.toFixed(3)}</td>
                  <td className="n">{pct(p.coverage)}</td>
                  <td className="n">{p.nCommitted}</td>
                  <td className="n mono">{conf(p.confusion)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <div className="prose">
          <p>
            Two things make even the tie weaker than it looks. Both pipelines commit on{" "}
            {arbiter.nCommitted} compounds carrying a single label, so half of that balanced accuracy
            is a substituted 0.5 rather than an estimate: it must not be quoted as an accuracy, and
            there is no honest interval to attach to it. And a comparison drawn over{" "}
            {arbiter.nCommitted} compounds is not strong evidence in either direction. The
            Validation tab carries the full table, including the baselines that cover far more of
            the set at lower balanced accuracy.
          </p>
        </div>
      </section>

      <hr className="rule" />

      <section className="stack">
        <p className="label">Why it abstains so much</p>
        <div className="prose stack">
          <h2 className="title">No benchmark compound carries exposure-relevant evidence.</h2>
          <p>
            All {m.metric4_abstentionQuality.nDeclined} abstentions are the belief–plausibility gap.
            None is an applicability-domain refusal and none is total conflict. The cause is
            structural and measurable: R3 discounts a claim that cannot be tied to clinical
            exposure, QSAR has no exposure axis, and Tox21 qHTS concentrations are not clinical
            ones. The only claim in the corpus marked{" "}
            <span className="mono">exposureRelevant: true</span> is the TAK-994 murine study, which
            the benchmark excludes by design. So R3 fires on 100% of safe claims and 0% of toxic
            ones, the engine structurally cannot license an advance on this evidence base, and it
            returned none.
          </p>
          <p className="caveat">
            This is the engine being correct about weak evidence — an HTS inactive at an unknown
            multiple of clinical exposure genuinely licenses nothing — and it is a coverage problem.
            Those are the same fact, not two competing readings of it.
          </p>
          <p>
            What would move the number is evidence with an exposure axis, not a lower threshold.
            Widening the abstention threshold to buy coverage was considered once and rejected: it
            would change the figure without changing what the evidence supports, and the ruleset is
            registered precisely so that it cannot be tuned toward a better-looking result.
          </p>
        </div>
      </section>

      <hr className="rule" />

      <section className="stack">
        <p className="label">Using the demo</p>
        <div className="about-grid">
          <div className="prose">
            <p>
              The demo runs on the keyboard, so nobody has to find a mouse mid-sentence. Eight beats
              walk one case from the desk before first-in-human through to the recorded sign-off,
              then a second where the engine commits.
            </p>
            <dl className="keys">
              <div>
                <dt><kbd className="chip">→</kbd> <kbd className="chip">←</kbd></dt>
                <dd className="small">Step forward and back through the eight beats.</dd>
              </div>
              <div>
                <dt><kbd className="chip">?</kbd></dt>
                <dd className="small">
                  Open the pre-flight panel. Every line in it is a check computed now: the ruleset
                  hash and the committed verdicts are recomputed in the browser and compared, not
                  printed.
                </dd>
              </div>
              <div>
                <dt><kbd className="chip">M</kbd></dt>
                <dd className="small">Stop all motion, for a compressed screen-share or a slow machine.</dd>
              </div>
              <div>
                <dt><kbd className="chip">Esc</kbd></dt>
                <dd className="small">Clear the focused region and return to the whole case.</dd>
              </div>
            </dl>
          </div>
          <div className="prose">
            <h2 className="title">Where to start</h2>
            <p>
              TAK-994, a compound whose development was halted for hepatotoxicity. On the evidence
              available before first-in-human, every baseline here says advance. ARBITER abstains,
              states how wide the gap is, and asks for a human BSEP assay at matched exposure — the
              experiment that would settle it.
            </p>
            <p>
              <a className="btn btn-primary" href="#/case">Open the case</a>{" "}
              <a className="btn" href="#/validation">See the numbers</a>
            </p>
            <p className="small muted">
              Scored on the {m.provenance.scoredSplit} split only: the model was fitted on train and
              the conformal threshold set on calibration, so scoring either would be leakage.
              Ruleset v{m.provenance.rulesetVersion}, split seed {m.provenance.splitSeed}.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
