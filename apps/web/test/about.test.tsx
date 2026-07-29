import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AboutTab } from "../src/tabs/About.js";
import { StoreProvider } from "../src/state/store.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const renderAbout = () => render(<StoreProvider data={data}><AboutTab /></StoreProvider>);

/**
 * The landing page is the one surface written to be read by someone who will
 * never open the Validation tab, which makes it the easiest place for a
 * flattering number to survive. HANDOVER section 2 records that an earlier draft
 * of the spec omitted the baseline tie and that the omission was corrected; these
 * assertions are what make a re-omission fail rather than ship.
 */
describe("the landing page", () => {
  it("states that ARBITER ties the best baseline rather than beating it", () => {
    renderAbout();
    const tie = screen.getByTestId("about-tie");
    expect(tie.textContent).toContain("single:transporter");
    // Read off the metrics document, so this fails if the copy is ever pinned to
    // a number the run no longer produces.
    const acc = data.metrics.metric1_conflictSubsetAccuracy.arbiter;
    expect(tie.textContent).toContain(acc.balancedAccuracy.toFixed(3));
    expect(tie.textContent).toContain(`${(acc.coverage * 100).toFixed(1)}%`);
    expect(screen.getByText(/does not beat the best baseline/i)).toBeTruthy();
  });

  it("names the abstention rate and its cause, not just the good number", () => {
    renderAbout();
    const q = data.metrics.metric4_abstentionQuality;
    expect(document.body.textContent).toContain(`${(q.declineRate * 100).toFixed(1)}%`);
    expect(document.body.textContent).toContain("No benchmark compound carries exposure-relevant evidence");
  });

  it("keeps to the language discipline in HANDOVER 1.3", () => {
    // Every term here overclaims something the submission cannot support, and a
    // landing page is where marketing vocabulary gets in. Checked on the rendered
    // text rather than the source so a word introduced through a data field is
    // caught too.
    renderAbout();
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const banned of ["blockchain", "dossier", "regulator-ready", "majority", "tally", "voting"]) {
      expect(text).not.toContain(banned);
    }
  });
});
