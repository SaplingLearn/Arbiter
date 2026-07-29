import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { ValidationTab } from "../src/tabs/Validation.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const renderTab = () => render(<StoreProvider data={data}><ValidationTab /></StoreProvider>);

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

  it("reports the planner stability number, which IS reportable", () => {
    renderTab();
    expect(screen.getByTestId("planner-stability").textContent).toMatch(/0\.99/);
  });

  it("names the LLM ablation as not yet run rather than omitting it", () => {
    renderTab();
    expect(screen.getByTestId("llm-ablation").textContent).toMatch(/not present|ANTHROPIC_API_KEY/i);
  });
});
