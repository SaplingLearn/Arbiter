import { Counter, TopTicks } from "../ui/primitives.js";

const STEPS = [
  {
    n: "01",
    title: "Assemble",
    body: "Conflicting claims per compound, QSAR, cytotoxicity, transporter, in vivo, keyed to the endpoint.",
  },
  {
    n: "02",
    title: "Discount & Fuse",
    body: "Each rule discounts evidence quality, then Dempster–Shafer fusion computes belief, plausibility and conflict mass.",
  },
  {
    n: "03",
    title: "Argue",
    body: "Defeasible argumentation over the six rules; grounded semantics with reinstatement decides which claims survive.",
  },
  {
    n: "04",
    title: "Position",
    body: "Advance, do not advance, or abstain, with the argument trace, the counterfactual, and the planner's next experiment.",
  },
  {
    n: "05",
    title: "Sign",
    body: "The committee decides. The position and its owner enter the hash-chained audit log.",
  },
] as const;

/**
 * The registered ruleset, verbatim.
 *
 * These statements are quoted from the file that was hashed, not paraphrased for the
 * page. Rewording one to read better on a landing page would make the printed hash a
 * lie, which is the single thing this product cannot afford to do.
 */
const RULES = [
  {
    id: "R1",
    name: "Human relevance",
    statement:
      "Human-cell evidence defeats animal in vivo evidence when the question is human hepatotoxicity.",
    strength: "0.90",
  },
  {
    id: "R2",
    name: "Mechanistic proximity",
    statement:
      "Evidence that directly measures an adverse outcome pathway key event defeats evidence that only correlates with chemical structure.",
    strength: "0.85",
  },
  {
    id: "R3",
    name: "Exposure relevance",
    statement:
      "A positive finding at clinically relevant exposure defeats a negative finding whose exposure margin is unstated or untested at that range.",
    strength: "0.85",
  },
  {
    id: "R4",
    name: "Applicability domain",
    statement:
      "Evidence from a model operating outside its applicability domain is admitted with reduced weight, or excluded.",
    strength: "0.50",
  },
  {
    id: "R5",
    name: "Study reliability",
    statement: "Higher-reliability studies defeat lower-reliability ones at equal mechanistic relevance.",
    strength: "0.60",
  },
  {
    id: "R6",
    name: "Concordance",
    statement: "Independent sources agreeing raises confidence more than one source agreeing with itself.",
    strength: "0.40",
  },
] as const;

export function HowItWorks() {
  return (
    <section className="section">
      <div className="rails rails--padded-full">
        <TopTicks />
        <Counter n={5} name="How It Works" className="counter--tight" />
        <h2 data-reveal className="h2" style={{ maxWidth: 920, marginBottom: 64 }}>
          Evidence In. A Position Out.
          <br />
          Every Step On The Record.
        </h2>

        <div className="cells cells--5 steps">
          {STEPS.map((step) => (
            <div data-reveal key={step.n} className="cell step">
              <div className="n">{step.n}</div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
          ))}
        </div>

        {/* The nav's "Ruleset" lands here, on the rules themselves, rather than on the
            section that only mentions them. */}
        <div data-reveal className="ruleset-label" id="ruleset">
          The Six Pre-Registered Rules · Each Works As A Defeat Rule And An Evidence-Quality Discount
        </div>

        <table className="ruleset">
          {/* Widths belong on <col>, not on the body cells. With `table-layout: fixed`
              only the first row is measured, so a width declared on a tbody cell is
              read and discarded - which is how the ID column ended up six times the
              56px the design gives it. */}
          <colgroup>
            <col className="col-id" />
            <col className="col-name" />
            <col />
            <col className="col-strength" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">ID</th>
              <th scope="col">Name</th>
              <th scope="col">Registered statement</th>
              <th scope="col">Strength</th>
            </tr>
          </thead>
          <tbody>
            {RULES.map((rule) => (
              <tr data-reveal key={rule.id}>
                <th scope="row" className="id">
                  {rule.id}
                </th>
                <td className="name">{rule.name}</td>
                <td className="statement">{rule.statement}</td>
                <td className="strength">{rule.strength}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div data-reveal className="figcaption">
          Precedence R3 › R1 › R2 › R5 · ruleset v1.0 · hash ed073a8a… · registered 2026-07-26 · never edited
          after a result.
        </div>
      </div>
    </section>
  );
}
