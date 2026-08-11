import type { ReactNode } from "react";
import { Counter, Eyebrow, Tick, TopTicks } from "../ui/primitives.js";

/**
 * Six capabilities, each shown as a small piece of the real interface rather than as
 * an icon.
 *
 * An icon of a magnifying glass would say "search". A three-row list showing one
 * stream driving the position, one defeated by R3 and one discounted by R2 says what
 * conflict detection actually produces. The vignettes are the argument for the
 * feature, which is why they get 262px and the sentence gets two lines.
 */

function Feature({
  art,
  artClass = "",
  name,
  children,
  lastRow,
}: {
  art: ReactNode;
  artClass?: string;
  name: string;
  children: ReactNode;
  lastRow?: boolean;
}) {
  return (
    <div data-reveal className="cell">
      {/* The bottom row's ticks would sit on the section's closing boundary, where
          the rails already cross. Two marks on one crossing reads as a smudge. */}
      {lastRow ? null : <Tick at="tr" small />}
      <div className={`feature-art ${artClass}`.trim()}>{art}</div>
      <div className="feature-name">
        <h3 className="h3">{name}</h3>
      </div>
      <div className="feature-copy">
        <p>{children}</p>
      </div>
    </div>
  );
}

/** R3 is the one at full strength; the rest fade by how little they moved the result. */
const FUSION_BARS: readonly { id: string; width: string; opacity: number; on?: boolean }[] = [
  { id: "R1", width: "34%", opacity: 0.4 },
  { id: "R2", width: "48%", opacity: 0.55 },
  { id: "R3", width: "82%", opacity: 1, on: true },
  { id: "R4", width: "40%", opacity: 0.55 },
  { id: "R5", width: "52%", opacity: 0.4 },
  { id: "R6", width: "30%", opacity: 0.3 },
];

const ROBUSTNESS_BARS = ["58%", "74%", "64%", "92%", "80%", "70%"] as const;

/** Q C T V R A K D P M - the stream keys. T, transporter, is the one that is live. */
const STREAM_GLYPHS = ["Q", "C", "T", "V", "R", "A", "K", "D", "P", "M"] as const;

const SIGNOFF_ROWS = [
  { compound: "Cyclosporine", position: "Do not adv.", conflict: "0.122", tone: "t-good", opacity: 1 },
  { compound: "TAK-994", position: "Abstain", conflict: "0.000", tone: "t-muted", opacity: 1 },
  { compound: "Troglitazone", position: "Abstain", conflict: "0.000", tone: "t-muted", opacity: 0.5 },
  { compound: "Isoniazid", position: "Abstain", conflict: "0.000", tone: "t-muted", opacity: 0.25 },
] as const;

export function Features() {
  return (
    <section className="section">
      <div className="rails rails--padded">
        <TopTicks />
        <Counter n={2} name="Main Features" />

        <div className="centred" style={{ marginBottom: 8 }}>
          <Eyebrow>How Arbiter Helps</Eyebrow>
          <h2 data-reveal className="h2 h2--centred" style={{ maxWidth: 900 }}>
            Built To Remove The Guesswork
            <br />
            From Conflicting Evidence.
          </h2>
          <p data-reveal className="lede lede--centred">
            From fusion to sign-off, Arbiter reasons through the conflicts between predictions so a position
            carries its argument, not just a score.
          </p>
        </div>

        <div className="cells cells--3">
          <Feature
            name="Conflict Detection"
            art={
              <div className="vignette">
                <div className="vignette-tabs">
                  <span>Streams</span>
                  <span className="is-on">Conflict</span>
                </div>
                <div className="vignette-row">
                  <div className="top">
                    transporter · toxic<span>0.88</span>
                  </div>
                  <div className="foot is-good">+ drives position</div>
                </div>
                <div className="vignette-row">
                  <div className="top">
                    invivo · negative<span>0.00</span>
                  </div>
                  <div className="foot is-bad">− defeated by R3</div>
                </div>
                <div className="vignette-row is-dim">
                  <div className="top">
                    qsar · positive<span>0.12</span>
                  </div>
                  <div className="foot">discounted by R2</div>
                </div>
              </div>
            }
          >
            Surface which streams agree, which are defeated, and which are merely discounted.
          </Feature>

          <Feature
            name="Belief Fusion"
            artClass="feature-art--wide"
            art={
              <div className="rule-bars">
                {FUSION_BARS.map((bar) => (
                  <div key={bar.id} className={bar.on ? "is-on" : ""} style={{ opacity: bar.opacity }}>
                    <span>{bar.id}</span>
                    <span className="bar" style={{ width: bar.width }} />
                  </div>
                ))}
              </div>
            }
          >
            Dempster–Shafer fusion resolves which rule is doing the defeating, and by how much.
          </Feature>

          <Feature
            name="Counterfactual"
            art={
              <div className="vignette">
                <div className="vignette-caption">Minimal-flip search</div>
                <div className="vignette-bar">
                  <div className="top">
                    As-is<span>Abstain · gap 0.910</span>
                  </div>
                  <div className="fill" style={{ width: "16%" }} />
                </div>
                <div className="vignette-bar">
                  <div className="top">
                    Flip transporter<span className="t-accent">Do not advance</span>
                  </div>
                  <div className="fill is-on" style={{ width: "88%" }} />
                </div>
                <div className="vignette-bar is-dim">
                  <div className="top">
                    Flip qsar<span>No change</span>
                  </div>
                  <div className="fill" style={{ width: "22%" }} />
                </div>
              </div>
            }
          >
            The smallest change in evidence that would move the position, on every case.
          </Feature>

          <Feature
            name="Robustness Check"
            artClass="feature-art--plain"
            lastRow
            art={
              <>
                <div className="column-chart">
                  {ROBUSTNESS_BARS.map((h, i) => (
                    <i key={i} style={{ height: h }} />
                  ))}
                </div>
                <dl className="stat-pair">
                  <div>
                    <dt>Stable</dt>
                    <dd>0.992</dd>
                  </div>
                  <div>
                    <dt>Draws</dt>
                    <dd>2,000</dd>
                  </div>
                </dl>
              </>
            }
          >
            Perturb every prior by ±50% and watch whether the recommendation holds.
          </Feature>

          <Feature
            name="Evidence Streams"
            artClass="feature-art--wide-centred"
            lastRow
            art={
              <div className="glyphs">
                {STREAM_GLYPHS.map((g) => (
                  <span key={g} className={g === "T" ? "is-on" : ""}>
                    {g}
                  </span>
                ))}
              </div>
            }
          >
            QSAR, cytotoxicity, transporter, and in vivo claims keyed to one endpoint.
          </Feature>

          <Feature
            name="Sign-Off Record"
            lastRow
            art={
              <div className="vignette mini-table">
                <div className="head">
                  <span>Compound</span>
                  <span>Position</span>
                  <span>Conflict</span>
                </div>
                {SIGNOFF_ROWS.map((row) => (
                  <div key={row.compound} style={{ opacity: row.opacity }}>
                    <span>{row.compound}</span>
                    <span>{row.position}</span>
                    <span className={row.tone}>{row.conflict}</span>
                  </div>
                ))}
              </div>
            }
          >
            Every position and its owner in a hash-chained, tamper-evident log.
          </Feature>
        </div>

        <div className="tail" />
      </div>
    </section>
  );
}
