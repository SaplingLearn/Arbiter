import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { ValidationTab } from "../src/tabs/Validation.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const renderTab = () => render(<StoreProvider data={data}><ValidationTab /></StoreProvider>);

describe("ValidationTab: what the baselines table is scored over", () => {
  it("renders per-stream coverage from the metrics document", () => {
    // Every row derived, in the order and with the counts the harness measured.
    // A stream added or dropped by data/prep must appear here rather than leaving
    // a table that silently describes a different evidence base.
    renderTab();
    const cov = screen.getByTestId("stream-coverage").textContent ?? "";
    const streams = data.metrics.sampleSizes.streamCoverage;
    expect(Object.keys(streams).length).toBeGreaterThan(0);
    for (const [name, c] of Object.entries(streams)) {
      expect(cov).toContain(name);
      expect(cov).toContain(String(c.compounds));
    }
  });

  it("says the thinnest stream is what the tied baseline is scored over", () => {
    // The load-bearing claim on this screen. `single:transporter` commits on 4
    // compounds because 4 is every compound it has - so "ARBITER ties the best
    // baseline" is a comparison over a set the evidence base chose. A judge who
    // works that out unaided has found something we did not say.
    renderTab();
    const streams = data.metrics.sampleSizes.streamCoverage;
    const thinnest = Object.entries(streams).sort((a, b) => a[1].compounds - b[1].compounds)[0]!;
    const note = screen.getByTestId("coverage-caveat").textContent ?? "";
    expect(note).toContain(thinnest[0]);
    expect(note).toContain(String(thinnest[1].compounds));
  });
});

describe("ValidationTab", () => {
  it("shows n and coverage BEFORE any accuracy figure", () => {
    renderTab();
    const text = screen.getByTestId("headline").textContent ?? "";
    expect(text.indexOf("coverage")).toBeGreaterThan(-1);
    expect(text.indexOf("coverage")).toBeLessThan(text.indexOf("balanced accuracy"));
  });

  it("renders the single-class warning rather than hiding it in a JSON field", () => {
    // balancedAccuracy substitutes 0.5 for an absent class. Four all-positive
    // compounds score 0.75 and that is indistinguishable from a real 0.75 unless
    // the flag is on screen.
    renderTab();
    expect(screen.getByTestId("single-class-warning")).toBeTruthy();
  });

  it("does NOT attach a confidence interval to a single-class balanced accuracy", () => {
    // The defect this guards: the headline read "balanced accuracy 0.75 (95% CI
    // 0.51-1.00)", where the interval was wilson(4,4) on RAW accuracy 4/4 = 1.0 -
    // an uncertainty claim about a different statistic than the one beside it.
    // ARBITER's committed set is single-class, so there is no interval to report.
    const acc = data.metrics.metric1_conflictSubsetAccuracy;
    expect(acc.arbiter.singleClass).toBe(true);
    expect(acc.arbiter.balancedAccuracyCi).toBeNull();

    renderTab();
    const text = screen.getByTestId("headline").textContent ?? "";
    expect(text).toMatch(/no confidence interval/i);
    expect(text).toMatch(/substituted 0\.5/);
    // And specifically not the raw-accuracy bounds, which is what leaked before.
    expect(text).not.toMatch(/95% CI 0\.51/);
  });

  it("shows the pre-registration hash and the perturbation seed", () => {
    renderTab();
    expect(screen.getByTestId("provenance").textContent).toMatch(/ed073a8a/);
    expect(screen.getByTestId("provenance").textContent).toMatch(/20260726/);
  });

  it("names the scoring target, so no figure on this page is quotable alone", () => {
    // Every number here was scored under ruleset v1.0, whose binarisation
    // HANDOVER section 13.1 declares invalid: it counted vLess-DILI-Concern as
    // positive, so a system correctly declining to flag amlodipine was scored
    // wrong. rules/ruleset-v2.0.json re-registered the target on 2026-08-09 and
    // this file has not been regenerated under it.
    //
    // Asserting all three parts because each fails differently: the version says
    // WHICH target, "superseded" says the reader must not quote it as current,
    // and the filename says where the corrected numbers live. A label carrying
    // only the version reads as provenance rather than as a warning.
    renderTab();
    const scoring = screen.getByTestId("scoring-target").textContent ?? "";
    expect(scoring).toMatch(/v1\.0/);
    expect(scoring).toMatch(/supersed/i);
    expect(scoring).toMatch(/ruleset-v2\.0\.json/);
  });

  it("reports the planner stability number, which IS reportable", () => {
    renderTab();
    expect(screen.getByTestId("planner-stability").textContent).toMatch(/0\.99/);
  });

  it("names the LLM ablation as not yet run rather than omitting it", () => {
    renderTab();
    expect(screen.getByTestId("llm-ablation").textContent).toMatch(/not present|ANTHROPIC_API_KEY/i);
  });
});
