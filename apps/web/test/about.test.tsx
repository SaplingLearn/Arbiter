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

    // All THREE causes, not the one this page used to name. HANDOVER section 2
    // records the correction: R3's exposure discount accounts for 118 of the 225
    // discounted claims, so naming it alone reads as a complete explanation of a
    // number it explains about half of.
    const causes = screen.getByTestId("about-causes").textContent ?? "";
    expect(causes).toContain("exposureRelevant");
    expect(causes).toContain("measures no key event");
    expect(causes).toContain("single claim");
  });

  it("derives the single-claim count instead of typing it into the copy", () => {
    // The count is the third cause and the only one carrying a live number, so it
    // is the one that can go stale. Recomputed here from the same evidence the
    // page renders from - if the copy is ever pinned to a literal, the run that
    // changes the corpus fails this rather than shipping a wrong number to a
    // landing page nobody re-reads.
    renderAbout();
    const expected = data.testSplit.filter(
      (id) => (data.claimsByCompound.get(id)?.length ?? 0) <= 1,
    ).length;
    expect(expected).toBeGreaterThan(0);
    const causes = screen.getByTestId("about-causes").textContent ?? "";
    expect(causes).toContain(`${expected} of ${data.metrics.sampleSizes.scored}`);
  });

  it("does not let the decline rate read as a consequence of conflict", () => {
    // The two numbers measure different predicates and are close to independent -
    // measured, non-conflicting compounds abstain MORE often than conflicting ones
    // (98.5% against 93.4%). A reader who conflates them concludes the engine is
    // broken, which is exactly the inference this page used to invite by putting
    // the decline rate two clicks from the conflict rate with nothing between.
    renderAbout();
    const text = (document.body.textContent ?? "").toLowerCase();
    expect(text).toContain("not because they disagree");
    expect(screen.getByText(/none of them is disagreement/i)).toBeTruthy();
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
