import { Counter, Cta, TopTicks } from "../ui/primitives.js";
import { HANDOVER_URL, REPO_URL } from "../links.js";

/**
 * The close, and the anchor the nav calls "Record".
 *
 * The headline is the product's actual position on itself: the committee decides.
 * Both actions go to the repository rather than to a signup, because there is nothing
 * to sign up for - this is an internal capability, and the page says so in the footer
 * rather than implying otherwise here.
 */
export function GetStarted() {
  return (
    <section className="section" id="record">
      <div className="rails cta-section">
        <TopTicks />
        <Counter n={11} name="Get Started" className="counter--tight" />
        <h2 data-reveal className="h2">
          The Committee Decides.
          <br />
          ARBITER Shows Its Work.
        </h2>
        <p data-reveal className="lede">
          A pre-registered ruleset, a deterministic engine, and a hash-chained record whose tamper-evidence was
          tested rather than asserted.
        </p>
        <div data-reveal className="cta-row" style={{ marginBottom: 64 }}>
          <Cta href={HANDOVER_URL} variant="primary">
            Read The Handover
          </Cta>
          <Cta href={REPO_URL} variant="secondary">
            Clone The Repo
          </Cta>
        </div>
      </div>
    </section>
  );
}
