import { Counter, Eyebrow, TopTicks } from "../ui/primitives.js";

/**
 * Native <details>, not a JavaScript accordion.
 *
 * Eight questions in two columns, each one open-able on its own. The element already
 * handles the disclosure state, the keyboard, and the accessible name; a hand-rolled
 * version would be more code doing the same job worse, and would leave the answers
 * unfindable by in-page search when collapsed.
 */
const LEFT = [
  {
    q: "What is Arbiter?",
    a: "A reasoning layer that adjudicates conflicting toxicity evidence and returns a position with the argument that produced it and the evidence that would change it.",
  },
  {
    q: "Is Arbiter deterministic?",
    a: "Yes. The engine is a pure function with no clock, randomness, or I/O. It resolves to a single hash across 1,000 runs, and golden-file CI catches a moved number.",
  },
  {
    q: "How is the ruleset pre-registered?",
    a: "Six rules were hashed to ed073a8a before any result was seen. The harness refuses to run if the computed hash differs, so the rules cannot be edited to fit an outcome.",
  },
  {
    q: "Does Arbiter replace the committee?",
    a: "No. The committee decides; Arbiter shows its work. Every signed position and its owner enter the hash-chained record.",
  },
] as const;

const RIGHT = [
  {
    q: "Who is Arbiter for?",
    a: "Preclinical safety leads and toxicologists deciding whether a compound advances, and reviewers who need a position to survive scrutiny.",
  },
  {
    q: 'What does "abstain" mean?',
    a: "The evidence mass sits below the commitment threshold. Abstention is a result: for 254 of 267 compounds, full confidence on every live claim still cannot reach it.",
  },
  {
    q: "How is the record tamper-evident?",
    a: "Each block hashes the previous one, so altering a past position breaks the chain. The tamper-evidence has been tested, not asserted.",
  },
  {
    q: "Does it work beyond hepatotoxicity?",
    a: "The current ruleset is registered for hepatotoxicity (DILI). New endpoints need their own pre-registered ruleset and validation harness before any result is read.",
  },
] as const;

function Column({ items }: { items: readonly { q: string; a: string }[] }) {
  return (
    <div className="faq-column">
      {items.map((item) => (
        <details key={item.q}>
          <summary>{item.q}</summary>
          <div className="faq-answer">{item.a}</div>
        </details>
      ))}
    </div>
  );
}

export function Faq() {
  return (
    <section className="section">
      <div className="rails rails--bleed">
        <TopTicks />
        <Counter n={10} name="FAQs" className="counter--inset" />

        <div className="centred" style={{ padding: "0 40px 64px" }}>
          <Eyebrow>Common Questions</Eyebrow>
          <h2 data-reveal className="h2 h2--centred" style={{ maxWidth: 900 }}>
            Answers Before
            <br />
            You Read The Record.
          </h2>
          <p data-reveal className="lede lede--centred lede--flush">
            Clear answers on determinism, pre-registration, and how Arbiter sits alongside the committee that
            signs.
          </p>
        </div>

        <div data-reveal className="faq">
          <Column items={LEFT} />
          <Column items={RIGHT} />
        </div>
      </div>
    </section>
  );
}
