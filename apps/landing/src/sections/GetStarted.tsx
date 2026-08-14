import { Counter, Cta, TopTicks } from "../ui/primitives.js";
import { APP_URL, HANDOVER_URL, REPO_URL } from "../links.js";

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
        {/* The close now ends on the product. "There is nothing to sign up for"
            is still true and is still why neither of the other two is a signup -
            but it argued for pointing at the repository INSTEAD of the app, which
            left the page's last word as more reading. Opening the app is the one
            action here that is not reading. */}
        <div data-reveal className="cta-row" style={{ marginBottom: 64 }}>
          <Cta href={APP_URL} variant="primary">
            Open The App
          </Cta>
          <Cta href={HANDOVER_URL} variant="secondary">
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
