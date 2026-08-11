import { Counter, Tick, TopTicks } from "../ui/primitives.js";

/**
 * What the thing is, in six cells, on the anchor the nav calls "Method".
 *
 * CAP.02 prints the ruleset hash. It is the only place on the page where a raw hash
 * appears at full weight, and it is in accent blue, because pre-registration is the
 * claim everything else on the page rests on: if the rules could be edited after a
 * result was seen, none of the other five cells mean anything.
 */
const CAPABILITIES: readonly { id: string; title: string; body: string; hash?: string }[] = [
  {
    id: "CAP.01",
    title: "Adjudication, Not Prediction",
    body: "Everyone else builds tools to predict toxicity. ARBITER reasons through the conflicts between those predictions.",
  },
  {
    id: "CAP.02",
    title: "Pre-Registered Ruleset",
    body: "Six rules registered and hashed before any result was seen. The harness refuses to run if the computed hash differs.",
    hash: "ed073a8a7f6d…0b5db136",
  },
  {
    id: "CAP.03",
    title: "Deterministic Engine",
    body: "No clock, no randomness, no I/O. Deterministic to a single hash across 1,000 runs; golden-file CI catches a moved number.",
  },
  {
    id: "CAP.04",
    title: "Argument-Driven Planner",
    body: "It asks which rule is doing the defeating and what evidence would overturn it, not which assay is usually informative.",
  },
  /**
   * CAP.05 and CAP.06 were "Counterfactual On Every Position" and "Hash-Chained
   * Sign-Off". Both are real, and both were already on this page - the counterfactual
   * as a Features vignette, the sign-off as a Features vignette AND a comparison row
   * AND an FAQ answer. Twelve cells across two grids were carrying about eight ideas.
   *
   * They are replaced by two capabilities the product genuinely has and the page
   * never mentioned, which is the worse failure of the two: a reader could finish the
   * old page without learning that the ruleset is live or that the evidence has a
   * clock. Both are in apps/web - Ruleset.tsx renders a slider per rule strength, and
   * the Case tab's as-of control recomputes from the evidence visible at a date.
   */
  {
    id: "CAP.05",
    title: "A Ruleset You Can Move",
    body: "Every rule strength is a slider and the verdict recomputes as you drag it. Disagree with a weight and see exactly what your disagreement costs.",
  },
  {
    id: "CAP.06",
    title: "Evidence, As Of A Date",
    body: "Wind the record back to what was known before first-in-human. The position is recomputed from that evidence alone, not filtered after the fact.",
  },
];

export function Capabilities() {
  return (
    <section className="section" id="method">
      <div className="rails rails--padded">
        <TopTicks />
        <Counter n={3} name="Capabilities" className="counter--tight" />
        <h2 data-reveal className="h2" style={{ maxWidth: 900, marginBottom: 64 }}>
          Not Another Predictor.
          <br />
          The Layer That Adjudicates.
        </h2>

        <div className="cells cells--3">
          {CAPABILITIES.map((cap, i) => (
            <div data-reveal key={cap.id} className="cell capability">
              {i < 3 ? <Tick at="tr" small /> : null}
              <div className="id">{cap.id}</div>
              <h3>{cap.title}</h3>
              <p>{cap.body}</p>
              {cap.hash === undefined ? null : <div className="hash">{cap.hash}</div>}
            </div>
          ))}
        </div>

        <div className="tail" />
      </div>
    </section>
  );
}
