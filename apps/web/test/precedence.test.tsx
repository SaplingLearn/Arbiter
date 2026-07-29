import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DefeatRuleId } from "@arbiter/engine";
import { StoreProvider } from "../src/state/store.js";
import { RulesetTab } from "../src/tabs/Ruleset.js";
import { loadData, type LoadedData } from "../src/data/load.js";

const data = loadData();
const renderTab = (d: LoadedData = data) =>
  render(<StoreProvider data={d}><RulesetTab /></StoreProvider>);

describe("the precedence order", () => {
  it("renders the registered order, in order, with each rule's name", () => {
    // R3 first is the answer to "why does exposure relevance outrank human
    // relevance?" - a judge question with a prepared answer that the app could
    // not previously point at, because the field was rendered nowhere.
    renderTab();
    expect(screen.getAllByTestId("precedence-entry").map((e) => e.textContent)).toEqual([
      "R3 Exposure relevance",
      "R1 Human relevance",
      "R2 Mechanistic proximity",
      "R5 Study reliability",
    ]);
  });

  it("renders the REGISTERED rationale verbatim, not a paraphrase of it", () => {
    // Both assertions are needed. The first pins the rendering to the ruleset;
    // the second spells out the registered text, so a rewrite that still reads
    // from state - a summary, a truncation, a "see the spec" - fails here.
    renderTab();
    const text = screen.getByTestId("precedence-rationale").textContent ?? "";
    expect(text).toBe(data.ruleset.precedenceRationale);
    expect(text).toContain(
      "Exposure relevance (R3) is checked before human relevance (R1). A negative finding only "
      + "carries weight across the exposure range it actually tested",
    );
    expect(text).toContain(
      "Mechanistic proximity (R2) is checked next, ahead of study reliability (R5)",
    );
  });

  it("reads the order from the ruleset rather than from a copy in the component", () => {
    // The clincher against a hand-typed "R3 → R1 → R2 → R5". A ruleset whose order
    // differs must render differently, or the tab is displaying a claim about the
    // pre-registration instead of the pre-registration.
    const reordered: LoadedData = {
      ...data,
      ruleset: { ...data.ruleset, precedenceOrder: ["R5", "R2", "R1", "R3"] as DefeatRuleId[] },
    };
    renderTab(reordered);
    expect(screen.getAllByTestId("precedence-entry").map((e) => e.textContent)).toEqual([
      "R5 Study reliability",
      "R2 Mechanistic proximity",
      "R1 Human relevance",
      "R3 Exposure relevance",
    ]);
  });
});

describe("the abstention threshold", () => {
  it("shows the registered value, and it is the value the engine gates on", () => {
    renderTab();
    const shown = screen.getByTestId("abstention-threshold-value").textContent ?? "";
    expect(shown).toBe("0.5");
    expect(Number(shown)).toBe(data.ruleset.abstentionGapThreshold);
  });

  it("says what the threshold gates, so the number is not bare", () => {
    renderTab();
    expect(screen.getByTestId("abstention-threshold").textContent)
      .toMatch(/declines rather than answer when the belief-to-plausibility gap exceeds/);
  });

  it("says where the value comes from, which is the actual answer to 'why 0.5?'", () => {
    // The ruleset registers a rationale for the precedence order and NOT for this
    // number, so the honest defence is provenance: pre-registered and hashed, read
    // by the engine rather than held as a constant in it. Inventing a
    // justification for 0.5 here would be exactly the fudge factor the ruleset
    // exists to rule out.
    renderTab();
    expect(screen.getByTestId("abstention-threshold-provenance").textContent)
      .toMatch(/could not be tuned after the results were seen/);
  });
});

describe("navigator anchors (§8.1)", () => {
  it("carries an anchor on each block, so a question can be pointed at one", () => {
    const { container } = renderTab();
    expect(container.querySelector('[data-anchor="ruleset.precedenceOrder"]')).not.toBeNull();
    expect(container.querySelector('[data-anchor="ruleset.abstentionThreshold"]')).not.toBeNull();
  });

  it("keeps the two anchors on distinct elements", () => {
    // One element carrying both ids would scroll to the same place for two
    // different questions and the navigator would look broken rather than wrong.
    const { container } = renderTab();
    expect(container.querySelector('[data-anchor="ruleset.precedenceOrder"]'))
      .not.toBe(container.querySelector('[data-anchor="ruleset.abstentionThreshold"]'));
  });
});
