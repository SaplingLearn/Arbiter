import { Counter, Eyebrow, Stat, Tick, TopTicks } from "../ui/primitives.js";

/**
 * The run's four headline numbers.
 *
 * Note which one is filled: robustness, not accuracy. The accuracy figure ties a
 * single-stream baseline exactly and the abstention rate is 97.4%, so leading on
 * either would be leading on a number that does not say what a reader assumes. Each
 * cell carries the sentence that stops it being read as a win.
 */
const METRICS: readonly {
  to: number;
  decimals: number;
  suffix: string;
  label: string;
  note: string;
  fill?: boolean;
}[] = [
  {
    to: 97.4,
    decimals: 1,
    suffix: "%",
    label: "Compounds Abstained",
    note: "260 of 267 declined; 254 could not commit at any evidence values.",
  },
  {
    // 0.750 until 2026-08-14, which was the figure under ruleset v1.0's
    // binarisation. HANDOVER section 13.1 declares that target invalid, so the
    // number here is the v2.0 re-grade from results/rescore-v2.txt. The note
    // carries the class balance because a balanced accuracy without it is the
    // exact omission that let 0.750 stand for two weeks.
    to: 0.5,
    decimals: 3,
    suffix: "",
    label: "Balanced Accuracy",
    note: "Conflict subset (n=61, 90.2% positive), re-graded under ruleset v2.0. No pipeline we tested clears 0.601.",
  },
  {
    // SEVEN, not four. The page said 4/267, which took the numerator from the
    // conflict subset (metric1.nCommitted = 4, of n=61) and the denominator from the
    // whole split (metric4: nCommitted 7, nDeclined 260, of 267). Two different
    // populations in one fraction. results/metrics.json is the arbiter of both.
    to: 7,
    decimals: 0,
    suffix: "/267",
    label: "Positions Committed",
    note: "Seven across the whole split. Four of them fall in the conflict subset, each resting on a transporter claim.",
  },
  {
    to: 0.992,
    decimals: 3,
    suffix: "",
    label: "Planner Robustness",
    note: "Recommendation held under ±50% perturbation of every prior.",
    fill: true,
  },
];

export function Metrics() {
  return (
    <section className="section">
      <div className="rails rails--padded">
        <TopTicks />
        <Counter n={1} name="Metrics" />

        <div className="centred">
          <Eyebrow>Measured, Not Asserted</Eyebrow>
          <h2 data-reveal className="h2 h2--centred" style={{ maxWidth: 920 }}>
            The Numbers The Run
            <br />
            Actually Produced.
          </h2>
          <p data-reveal className="lede lede--centred">
            Measured on the test split only, 267 compounds scored, 61 in the pre-registered conflict subset. Read
            the reason, not the headline.
          </p>
        </div>

        <div className="cells cells--4">
          {METRICS.map((m, i) => (
            <div data-reveal key={m.label} className={`cell metric${m.fill ? " cell--fill" : ""}`}>
              {i === 0 ? <Tick at="tl" small /> : null}
              <Tick at="tr" small />
              <Stat className="metric-value" to={m.to} decimals={m.decimals} suffix={m.suffix} />
              <div className="metric-rule" />
              <div className="metric-label">{m.label}</div>
              <div className="metric-rule" />
              <div className="metric-note">{m.note}</div>
            </div>
          ))}
        </div>

        <div className="tail" />
      </div>
    </section>
  );
}
