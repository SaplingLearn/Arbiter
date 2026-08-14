import { Counter, TopTicks } from "../ui/primitives.js";

/**
 * The result, stated the way the run actually came out.
 *
 * This section exists because the headline is a tie, and a landing page that buried
 * that would be making exactly the claim the product is built to refuse. The
 * comparison table is printed in full, including the row where a weighted average
 * covers 100% of the split and ARBITER covers 6.6%.
 *
 * The table's figures are v1.0 figures, and the note under it says so. They are kept
 * rather than replaced: they are what the pre-registered run actually produced, and
 * deleting a measurement because a later audit invalidated its target would be the
 * same editing-to-fit the hashed ruleset exists to prevent. The correction is stated
 * beside them instead.
 */
const BASELINES: readonly {
  pipeline: string;
  accuracy: string;
  coverage: string;
  committed: string;
  ours?: boolean;
  muted?: boolean;
}[] = [
  { pipeline: "ARBITER", accuracy: "0.750", coverage: "6.6%", committed: "4", ours: true },
  { pipeline: "single:transporter", accuracy: "0.750", coverage: "6.6%", committed: "4" },
  { pipeline: "majorityVote", accuracy: "0.750", coverage: "4.9%", committed: "3" },
  { pipeline: "weightedAverage", accuracy: "0.547", coverage: "100%", committed: "61", muted: true },
];

const FINDINGS: readonly { kicker: string; title: string; body: string; fill?: boolean }[] = [
  {
    kicker: "The tie",
    title: "Ties A Single Stream, Exactly",
    body: "single:transporter matches on every column, because both pipelines score the same four compounds. There are only four transporter claims in the split. We say so.",
  },
  {
    kicker: "The finding",
    title: "Coverage Is The Finding",
    body: "ARBITER abstains on 260 of 267. For 254 of those, full confidence 1.0 on every live claim still cannot reach the threshold. It adjudicates conflict, and 140 compounds carry one claim.",
  },
  {
    kicker: "Lead with this",
    title: "Robust Under Perturbation",
    body: "The planner's recommendation is unchanged under ±50% perturbation of every expert-elicited prior, 0.992 across 2,000 samples per compound. It sorts on argument structure first, score second.",
    fill: true,
  },
];

export function Result() {
  return (
    <section className="section section--surface" id="result">
      <div className="rails rails--padded-full">
        <TopTicks />
        <Counter n={6} name="The Result, Stated Honestly" className="counter--tight" />
        <h2 data-reveal className="h2 h2--centred" style={{ maxWidth: 1000 }}>
          It Does Not Beat The Baseline.
          <br />
          And Under The Corrected Target, Nothing Does.
        </h2>
        <p data-reveal className="lede lede--centred" style={{ maxWidth: 660, marginBottom: 56 }}>
          Measured on the test split only, 267 compounds scored, 61 in the pre-registered conflict subset. Read
          the reason, not the headline.
        </p>

        <table data-reveal className="baselines">
          <thead>
            <tr>
              <th scope="col">Pipeline</th>
              <th scope="col">Bal. acc.</th>
              <th scope="col">Coverage</th>
              <th scope="col">Committed</th>
            </tr>
          </thead>
          <tbody>
            {BASELINES.map((row) => (
              <tr key={row.pipeline} className={row.ours ? "is-ours" : row.muted ? "is-muted" : ""}>
                <th scope="row">{row.pipeline}</th>
                <td>{row.accuracy}</td>
                <td>{row.coverage}</td>
                <td>{row.committed}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/*
          The target every figure in that table was graded under, said on the page
          rather than in the repository.

          NOT A FOOTNOTE, AND NOT THE SMALLEST TEXT HERE. The v1.0 binarisation
          counted Less-DILI-Concern as positive, which put 330 of 536 positives in a
          class containing aspirin, amoxicillin and amlodipine - so 0.750 partly
          scored a system correctly declining to flag amlodipine as WRONG. A page
          that prints the number and not the target is making the claim the product
          exists to refuse. `.metric-note` rather than `.figcaption` for exactly the
          reason this stylesheet's own header names: a caveat set in the page's
          smallest type is a caveat nobody reads.

          POPULATIONS ARE NAMED because they differ. 0.750 is the conflict subset
          (n=61); the corrected 0.500 is the FULL scored split (n=267). Pairing them
          without saying so would be the same two-populations-one-fraction error the
          committed-positions tile was already fixed for.
        */}
        <p
          data-reveal
          className="metric-note result-note"
          style={{ maxWidth: 1000, margin: "-40px auto 64px" }}
        >
          Every figure in that table was graded under target v1.0, which this project&apos;s own
          audit invalidated: it counted Less-DILI-Concern as positive, placing 330 of 536
          positives in a class containing aspirin, amoxicillin and amlodipine. Re-graded
          against the corrected target, ARBITER scores 0.500 on the full scored split, and no
          pipeline tested clears 0.601 - including every baseline. The QSAR figure was fitted
          under v1.0, so its corrected number is a lower bound. The finding is about the
          target, not about this system.
        </p>

        <div className="cells cells--3 findings">
          {FINDINGS.map((f) => (
            <div data-reveal key={f.kicker} className={`cell finding${f.fill ? " cell--fill" : ""}`}>
              <div className="kicker">{f.kicker}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
