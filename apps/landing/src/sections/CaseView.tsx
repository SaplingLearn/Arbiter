import type { ReactNode } from "react";
import { Counter, TopTicks } from "../ui/primitives.js";

/**
 * The two hero cases, side by side, carrying the anchor the nav calls "Case View".
 *
 * Two cases and not one, because a single worked example only shows the engine can
 * produce an answer. Two, where one abstains at gap 0.910 and the other commits with
 * non-zero conflict mass, show it can tell the difference - which is the only claim
 * worth making.
 */

function Figure({ label, value, fill, accent }: { label: string; value: string; fill?: boolean; accent?: boolean }) {
  return (
    <div className={`cell${fill ? " cell--fill" : ""}`}>
      <dt>{label}</dt>
      <dd className={accent ? "is-accent" : ""}>{value}</dd>
    </div>
  );
}

function Case({
  compound,
  which,
  verdict,
  bad,
  figures,
  children,
}: {
  compound: string;
  which: string;
  verdict: string;
  bad?: boolean;
  figures: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-reveal className="cell case-card">
      <div className="case-head">
        <span>Case · {compound}</span>
        <span>{which}</span>
      </div>
      {/* The position is a word in a box. On a compressed screen-share the red goes
          first, and "Do Not Advance" has to survive that. */}
      <div className={`verdict${bad ? " verdict--bad" : ""}`}>{verdict}</div>
      <dl className="cells case-figures">{figures}</dl>
      <div className="case-trace">{children}</div>
    </div>
  );
}

export function CaseView() {
  return (
    <section className="section section--surface" id="product">
      <div className="rails rails--padded-full">
        <TopTicks />
        <Counter n={4} name="The Case View" className="counter--tight" />
        <h2 data-reveal className="h2" style={{ maxWidth: 1000 }}>
          Two Compounds. Two Positions.
          <br />
          The Argument For Each.
        </h2>
        <p data-reveal className="lede" style={{ marginBottom: 56 }}>
          Where TAK-994 abstains and names the evidence that would change it, Cyclosporine commits to do not
          advance, with non-zero Dempster–Shafer conflict mass, right for the right reason.
        </p>

        <div className="cells cells--2 cells--ink">
          <Case
            compound="TAK-994"
            which="Hero case 1"
            verdict="Abstain"
            figures={
              <>
                <Figure label="Belief" value="0.090" />
                <Figure label="Gap" value="0.910" fill />
                <Figure label="Conflict" value="0.000" />
              </>
            }
          >
            <div>
              <b>R3</b> defeats invivo_rodent(neg) ×4, exposure margin untested
            </div>
            <div>
              <b>R2</b> discounts qsar(pos), structure correlation only
            </div>
            <div>
              <i>gap rule</i> fires before the engine reads a value
            </div>
          </Case>

          <Case
            compound="Cyclosporine"
            which="Hero case 2"
            verdict="Do Not Advance"
            bad
            figures={
              <>
                <Figure label="Belief" value="0.886" fill />
                <Figure label="Gap" value="0.098" />
                <Figure label="Conflict" value="0.122" accent />
              </>
            }
          >
            <div>
              <b>transporter:toxic</b> drives the position, BSEP inhibition
            </div>
            <div>
              <b>R4</b> downweights an out-of-domain read
            </div>
            <div>
              <i>committed</i>, conflict mass non-zero, contested
            </div>
          </Case>
        </div>

        <div data-reveal className="figcaption">
          Fig. B · Case view · both hero cases resolve through one evidence array, Case and Compounds read the
          same source.
        </div>
      </div>
    </section>
  );
}
