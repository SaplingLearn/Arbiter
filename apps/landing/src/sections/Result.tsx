import { Counter, TopTicks } from "../ui/primitives.js";

/**
 * The result, stated the way the run actually came out.
 *
 * This section exists because the headline is a tie, and a landing page that buried
 * that would be making exactly the claim the product is built to refuse. The
 * comparison table is printed in full, including the row where a weighted average
 * covers 100% of the split and ARBITER covers 6.6%.
 */
// RE-GRADED UNDER ruleset-v2.0, from results/rescore-v2.txt. These were the v1.0
// figures (ARBITER, single:transporter and majorityVote all 0.750, weightedAverage
// 0.547) until 2026-08-14. HANDOVER section 13.1 declares the v1.0 binarisation
// invalid: it counted vLess-DILI-Concern as positive, so 330 of 536 positives sat in
// a class holding aspirin, amoxicillin, atenolol, amlodipine and apixaban, and a
// system correctly declining to flag amlodipine scored as wrong.
//
// The re-grade changes the SHAPE of the comparison and not only the numbers. Under
// v1.0 ARBITER tied exactly one baseline. Under v2.0 it ties three and is beaten by
// weightedAverage, which is why the heading no longer claims a single tie.
const BASELINES: readonly {
  pipeline: string;
  accuracy: string;
  coverage: string;
  committed: string;
  ours?: boolean;
  muted?: boolean;
}[] = [
  { pipeline: "ARBITER", accuracy: "0.500", coverage: "6.6%", committed: "4", ours: true },
  { pipeline: "single:transporter", accuracy: "0.500", coverage: "6.6%", committed: "4" },
  { pipeline: "single:qsar", accuracy: "0.500", coverage: "98.4%", committed: "60" },
  { pipeline: "weightedAverage", accuracy: "0.519", coverage: "100%", committed: "61", muted: true },
  { pipeline: "majorityVote", accuracy: "0.250", coverage: "4.9%", committed: "3", muted: true },
];

const FINDINGS: readonly { kicker: string; title: string; body: string; fill?: boolean }[] = [
  {
    kicker: "The correction",
    title: "We Re-Graded Ourselves Downward",
    body: "Our first headline was 0.750. We checked it and it was wrong: the positive class had swallowed 62% of its members from the Less-concern grade, so correctly declining to flag amlodipine scored as a mistake. Re-graded honestly we get 0.500, and under that target nothing we tested clears 0.601.",
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
          Under An Honest Target, Nothing Does.
        </h2>
        <p data-reveal className="lede lede--centred" style={{ maxWidth: 660, marginBottom: 56 }}>
          Measured on the test split only, 267 compounds scored, 61 in the pre-registered conflict subset,
          90.2% of them positive. Re-graded under ruleset v2.0 after we found our own target definition
          invalid. Read the reason, not the headline.
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
