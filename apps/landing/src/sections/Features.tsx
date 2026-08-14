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

/**
 * The six registered rule strengths, from rules/ruleset-v2.0.json, drawn to scale.
 *
 * The comment here used to read "R3 is the one at full strength; the rest fade by
 * how little they moved the result", over widths of 34/48/82/40/52/30 that
 * corresponded to no quantity in results/ and contradicted the registered
 * strengths on their face - R1 is 0.90, the highest of the six, and was drawn
 * shortest but one. Decoration is fine on a marketing page; decoration with a
 * comment claiming a source is a false claim, and this one was checkable in ten
 * seconds against a file the same page links to.
 *
 * Widths are now the strengths themselves as percentages, so the bars are a chart
 * of something real and the caption can say which file.
 */
const FUSION_BARS: readonly { id: string; width: string; opacity: number; on?: boolean }[] = [
  { id: "R1", width: "90%", opacity: 1, on: true },
  { id: "R2", width: "85%", opacity: 0.85 },
  { id: "R3", width: "85%", opacity: 0.85 },
  { id: "R4", width: "50%", opacity: 0.55 },
  { id: "R5", width: "60%", opacity: 0.6 },
  { id: "R6", width: "40%", opacity: 0.4 },
];

/** Ornament, and labelled as such. These heights encode nothing; the robustness
 *  figure this section quotes in words is 0.992, from metric5 in results/metrics.json. */
const ROBUSTNESS_BARS = ["58%", "74%", "64%", "92%", "80%", "70%"] as const;

/**
 * The SIX evidence streams, from packages/engine/src/types.ts: qsar, cytotox,
 * toxicogenomics, transporter, invivo_rodent, invivo_nonrodent.
 *
 * There were ten glyphs here, commented "the stream keys", which implied four
 * streams that do not exist while the section's own copy names four that do. A
 * decorative row is fine; a decorative row presented as a key is a claim about
 * how much evidence the system reads.
 */
const STREAM_GLYPHS = ["Q", "C", "G", "T", "R", "N"] as const;

const SIGNOFF_ROWS = [
  { compound: "Cyclosporine", position: "Do not adv.", conflict: "0.122", tone: "t-good", opacity: 1 },
  { compound: "TAK-994", position: "Abstain", conflict: "0.000", tone: "t-muted", opacity: 1 },
  // Troglitazone until 2026-08-14, which is in the TRAIN split and carries no
  // scored verdict at all. Perhexiline is a real test-split abstention.
  { compound: "Perhexiline", position: "Abstain", conflict: "0.000", tone: "t-muted", opacity: 0.5 },
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
