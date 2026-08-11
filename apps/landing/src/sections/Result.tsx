import { Counter, TopTicks } from "../ui/primitives.js";

/**
 * The result, stated the way the run actually came out.
 *
 * This section exists because the headline is a tie, and a landing page that buried
 * that would be making exactly the claim the product is built to refuse. The
 * comparison table is printed in full, including the row where a weighted average
 * covers 100% of the split and ARBITER covers 6.6%.
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
          It Ties One Stream, Exactly.
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
