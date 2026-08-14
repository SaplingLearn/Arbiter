import { Counter, Eyebrow, Marquee, TopTicks } from "../ui/primitives.js";

/**
 * The testimonial section, minus the testimonials.
 *
 * A product whose entire claim is that its rules were fixed before any result was
 * seen cannot open this slot with invented praise, and it has no customers to quote
 * honestly. So the quotes are the engine's own output and the rules it fired -
 * attributable, checkable against the run, and the only thing here that has actually
 * been said about these compounds.
 */
type Quote = {
  text: string;
  badge: string;
  who: string;
  what: string;
  fill?: boolean;
};

const ROW_ONE: readonly Quote[] = [
  {
    text: "Abstain. Belief 0.090, gap 0.910. Full confidence on every live claim still cannot clear 0.50.",
    badge: "TK",
    who: "TAK-994",
    what: "Hepatotoxicity · gap rule",
  },
  {
    text: "Do not advance. Conflict mass 0.122, non-zero and contested. Driven by BSEP inhibition, not structure.",
    badge: "CY",
    who: "Cyclosporine",
    what: "Transporter · committed",
    fill: true,
  },
  {
    text: "R3 defeats the negative rodent read. The exposure margin was never tested at clinically relevant Cmax.",
    badge: "R3",
    who: "Exposure relevance",
    what: "Rule fired · strength 0.85",
  },
  {
    text: "Would change it: a transporter assay at clinically relevant Cmax. Named by the planner, not guessed.",
    badge: "CF",
    who: "Counterfactual",
    what: "Minimal-flip search",
  },
];

const ROW_TWO: readonly Quote[] = [
  {
    text: "Recommendation unchanged across 2,000 draws per compound, every expert prior perturbed by ±50%.",
    badge: "σ",
    who: "Robustness 0.992",
    what: "Perturbation study",
  },
  {
    text: "Deterministic to a single hash across 1,000 runs. No clock, no randomness, no I/O in the engine.",
    badge: "#",
    who: "Determinism",
    what: "Golden-file CI",
    fill: true,
  },
  {
    text: "Ruleset hashed ed073a8a before any result was seen. The harness refuses to run if the hash differs.",
    badge: "v1",
    who: "Pre-registration",
    what: "Ruleset v1.0",
  },
  {
    // `what` labels the 0.750, which is a conflict-subset figure. The 0.500 carries
    // its own population inside the sentence rather than borrowing this caption: it
    // is the FULL scored split (n=267), and letting a caption reading "n=61" stand
    // over both would be the two-populations-one-fraction error again.
    text: "Ties single:transporter exactly under target v1.0, because both pipelines score the same four compounds. Under the corrected target, 0.500 on the full scored split of 267. We say so.",
    badge: "=",
    who: "Balanced acc. 0.750 (v1.0, superseded)",
    what: "Conflict subset n=61",
  },
];

function Quotes({ quotes }: { quotes: readonly Quote[] }) {
  return (
    <>
      {quotes.map((q) => (
        <figure key={q.who} className={`quote${q.fill ? " quote--fill" : ""}`}>
          <blockquote>“{q.text}”</blockquote>
          <figcaption>
            <span className="quote-avatar" aria-hidden="true">
              {q.badge}
            </span>
            <span>
              <span className="quote-who">{q.who}</span>
              <span className="quote-what">{q.what}</span>
            </span>
          </figcaption>
        </figure>
      ))}
    </>
  );
}

export function RecordSpeaks() {
  return (
    <section className="section" style={{ overflow: "hidden" }}>
      <div className="rails rails--padded-short">
        <TopTicks />
        <Counter n={9} name="The Record Speaks" />
        <div className="centred">
          <Eyebrow>No Testimonials, By Design</Eyebrow>
          <h2 data-reveal className="h2 h2--centred" style={{ maxWidth: 920 }}>
            We Will Not Quote
            <br />
            Customers We Do Not Have.
          </h2>
          <p data-reveal className="lede lede--centred lede--flush" style={{ maxWidth: 660 }}>
            A tool built on pre-registration cannot lead with invented praise. So the record speaks instead: the
            engine's own positions, verbatim from the run.
          </p>
        </div>
      </div>

      {/* Full bleed, outside the rails: these two rows are the only thing on the page
          that runs past the content column, which is what makes them read as a feed
          rather than as another cell grid. */}
      <div data-reveal>
        <Marquee slow className="quote-rail">
          <Quotes quotes={ROW_ONE} />
        </Marquee>
      </div>

      <div className="hatch hatch--strip" />

      <div data-reveal>
        <Marquee slow reverse>
          <Quotes quotes={ROW_TWO} />
        </Marquee>
      </div>
    </section>
  );
}
