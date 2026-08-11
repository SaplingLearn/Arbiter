import { Fragment, type ReactNode } from "react";
import { Counter, Eyebrow, Tick, TopTicks } from "../ui/primitives.js";

/**
 * Three readers, one record - and, in the same section, the comparison against doing
 * this by hand.
 *
 * They share a section because they answer one question between them: who is this
 * for, and what are they doing today instead. Splitting them would put a hatched band
 * between a persona and the workflow that persona is being asked to give up.
 */

function Persona({
  kicker,
  title,
  lede,
  checks,
  art,
  reversed,
  last,
}: {
  kicker: string;
  title: string;
  lede: string;
  checks: readonly string[];
  art: ReactNode;
  reversed?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`persona${reversed ? " persona--reversed" : ""}${last ? " persona--last" : ""}`}>
      <div data-reveal className="persona-copy">
        <div className="kicker">{kicker}</div>
        <h3>{title}</h3>
        <p>{lede}</p>
        <ul className="checks">
          {checks.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <div data-reveal className="persona-art">
        {art}
      </div>
    </div>
  );
}

type Bar = { h: string; on?: boolean };

/**
 * THE VIGNETTES SHOW SCREENS THE PRODUCT ACTUALLY HAS.
 *
 * They used to show two that it does not: an "Executive Overview / Q3" dashboard,
 * and an "Automated read | Manual | Flagged" tab bar. Neither exists in apps/web,
 * whose surfaces are Case, Compounds, Ruleset, Validation, Record and Intake. The
 * overview panel also carried "Coverage -2.6%", a figure that appears nowhere in
 * results/metrics.json - invented to look like a dashboard.
 *
 * On a page whose argument is that it does not overclaim, drawing an interface that
 * does not exist is the same failure as quoting a customer you do not have.
 */

/** The Compounds queue, which is the safety lead's real screen. */
const QUEUE_ROWS = [
  { label: "TAK-994", value: "Abstain" },
  { label: "Cyclosporine", value: "Do not advance" },
  { label: "Troglitazone", value: "Abstain" },
  { label: "Isoniazid", value: "Abstain" },
] as const;

/** The six registered rules and their registered strengths - rules/ruleset-v1.0.json. */
const TRACE_ROWS = [
  { label: "R3 exposure relevance", value: "0.85", opacity: 1 },
  { label: "R1 human relevance", value: "0.90", opacity: 1 },
  { label: "R2 mechanistic proximity", value: "0.85", opacity: 1 },
  { label: "R5 study reliability", value: "0.60", opacity: 1 },
  { label: "R4 applicability domain", value: "0.50", opacity: 0.6 },
  { label: "R6 concordance", value: "0.40", opacity: 0.35 },
] as const;

const SPREAD_BARS: readonly Bar[] = [
  { h: "60%" },
  { h: "72%" },
  { h: "66%" },
  { h: "88%" },
  { h: "79%" },
  { h: "99%", on: true },
  { h: "83%" },
  { h: "75%" },
];

const COMPARISON = [
  ["Reconciled case by case, from scratch each time", "One deterministic pass over every claim"],
  ["Rubrics drift between reviewers", "A pre-registered ruleset, hashed and unedited"],
  ["Conclusions asserted, not shown", "Every position carries its argument trace"],
  ["Confidence hides untested assumptions", "Abstains and names the evidence that would change it"],
  ["Verdicts hard to audit after the fact", "Hash-chained sign-off, tamper-evidence tested"],
] as const;

export function UseCases() {
  return (
    <section className="section">
      <div className="rails rails--bleed">
        <TopTicks />
        <Counter n={7} name="Use Cases" className="counter--inset" />

        <div className="centred" style={{ padding: "0 40px 64px" }}>
          <Eyebrow>Built For The Sceptical Reader</Eyebrow>
          <h2 data-reveal className="h2 h2--centred" style={{ maxWidth: 960 }}>
            Designed For The People
            <br />
            Who Have To Sign.
          </h2>
          <p data-reveal className="lede lede--centred lede--flush" style={{ maxWidth: 660 }}>
            Three readers, one record. The lead who owns the call, the toxicologist who reads the trace, and the
            reviewer who tries to break it.
          </p>
        </div>

        <Persona
          kicker="Persona 01 · Safety Lead"
          title="Control At Scale"
          lede="See every open position at once, and which ones the engine refused to commit. The queue sorts on argument structure first, so a contested call never hides behind a confident-looking score."
          checks={[
            "One queue across every compound and endpoint",
            "Abstentions surfaced, never silently dropped",
            "Every position carries its owner and timestamp",
          ]}
          art={
            <div className="panel" aria-hidden="true">
              <div className="panel-head">
                <span>Compounds · test split</span>
                <span>267</span>
              </div>
              <div className="panel-list">
                {QUEUE_ROWS.map((row) => (
                  <div key={row.label}>
                    <span>{row.label}</span>
                    <b>{row.value}</b>
                  </div>
                ))}
              </div>
              <div className="panel-body">
                <dl className="cells cells--2 panel-figures">
                  <div className="cell">
                    <dt>In conflict</dt>
                    <dd>61</dd>
                  </div>
                  <div className="cell">
                    <dt>Declined</dt>
                    <dd>260</dd>
                  </div>
                </dl>
              </div>
            </div>
          }
        />

        <Persona
          reversed
          kicker="Persona 02 · Toxicologist"
          title="Automate The Repetitive Read"
          lede="The discounts you would apply by hand, applied the same way every time and shown in the trace. You read the argument, not re-derive it from a spreadsheet."
          checks={[
            "Evidence-quality discounts applied consistently",
            "Full argument trace on every claim admitted",
            "The next experiment named, not guessed",
          ]}
          art={
            <div className="panel panel--wide" aria-hidden="true">
              {/* The Case tab's three regions, named as the product names them. */}
              <div className="panel-tabs">
                <span className="is-on">Evidence</span>
                <span>Argument</span>
                <span>Table</span>
              </div>
              <div className="panel-list">
                {TRACE_ROWS.map((row) => (
                  <div key={row.label} style={{ opacity: row.opacity }}>
                    <span>{row.label}</span>
                    <b>{row.value}</b>
                  </div>
                ))}
              </div>
            </div>
          }
        />

        <Persona
          last
          kicker="Persona 03 · Reviewer"
          title="Defensible Under Scrutiny"
          lede="Try to break it. The ruleset was hashed before any result was seen, the engine is deterministic to a single hash, and the recommendation holds when every prior is perturbed by half."
          checks={[
            "Pre-registered ruleset, hashed and unedited",
            "Deterministic to one hash across 1,000 runs",
            "Recommendation stable under ±50% perturbation",
          ]}
          art={
            <div className="panel" aria-hidden="true">
              <div className="panel-head">
                <span>Perturbation stability</span>
                <span>2,000 draws</span>
              </div>
              <div className="spread">
                <div className="spread-badge">0.992</div>
                <div className="spread-line" />
                <div className="spread-bars">
                  {SPREAD_BARS.map((bar, i) => (
                    <i key={i} className={bar.on ? "is-on" : ""} style={{ height: bar.h }} />
                  ))}
                </div>
                <div className="spread-foot">Recommendation unchanged · per-compound</div>
              </div>
            </div>
          }
        />

        <div className="comparison-head">
          <TopTicks />
          <Counter n={8} name="Comparison" />
          <div className="centred" style={{ marginBottom: 60 }}>
            <Eyebrow>Why Arbiter</Eyebrow>
            <h2 data-reveal className="h2 h2--centred" style={{ maxWidth: 940 }}>
              A Defensible Alternative
              <br />
              To Reconciling By Hand.
            </h2>
            <p data-reveal className="lede lede--centred lede--flush">
              The manual read is not slow because people are, it is slow because the reasoning is redone from
              scratch each time and rarely written down. Arbiter writes it down.
            </p>
          </div>
        </div>

        <div data-reveal className="comparison-body">
          <div className="compare">
            <Tick at="tc" />
            <div className="compare-head">
              <div className="them">Reconciling By Hand</div>
              <div className="us">Arbiter</div>
            </div>
            {/* One grid, two cells per pair, so the two halves of a row always line up
                on the same baseline however long either sentence runs. */}
            <div className="compare-rows">
              {COMPARISON.map(([them, us]) => (
                <Fragment key={them}>
                  <div className="them">
                    <span>{them}</span>
                  </div>
                  <div className="us">
                    <span>{us}</span>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
