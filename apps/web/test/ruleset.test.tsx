import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { RulesetTab } from "../src/tabs/Ruleset.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const renderTab = () => render(<StoreProvider data={data}><RulesetTab /></StoreProvider>);

describe("RulesetTab", () => {
  it("shows all six rules with statement and framework citation", () => {
    renderTab();
    expect(screen.getAllByTestId("rule-card")).toHaveLength(6);
    expect(screen.getByText(/FDA Roadmap/)).toBeTruthy();
  });

  it("shows the pre-registered hash and no modified badge until something changes", () => {
    renderTab();
    expect(screen.getByTestId("ruleset-hash").textContent).toMatch(/ed073a8a/);
    expect(screen.queryByTestId("modified-badge")).toBeNull();
  });

  it("RECOMPUTES LIVE when a strength changes, and badges the ruleset as modified", () => {
    // This is why the engine runs in the browser. With precomputed verdicts this
    // control would be a canned animation and a judge who moved it would get
    // nothing back.
    //
    // R1, not R3: measured directly against the engine (see task-9-report.md),
    // dropping R3's strength on the TAK-994 fixture changes NOTHING - the four
    // "safe" claims R3's discount would apply to are already categorically
    // defeated by R3 before the discount step runs, and the one admitted claim
    // R3's discount could reach is "toxic", which R3 never discounts (R3 is
    // deliberately directional). R1 is the rule whose strength actually moves
    // this fixture's belief (0.090 -> 0.855, verdict flips to do_not_advance),
    // so R1 is what proves the live recompute rather than a stale render.
    renderTab();
    const before = screen.getByTestId("live-belief").textContent;
    fireEvent.change(screen.getByTestId("strength-R1"), { target: { value: "0.05" } });
    expect(screen.getByTestId("live-belief").textContent).not.toBe(before);
    expect(screen.getByTestId("modified-badge")).toBeTruthy();
  });

  it("restores the registered values on reset", () => {
    renderTab();
    const original = screen.getByTestId("live-belief").textContent;
    fireEvent.change(screen.getByTestId("strength-R1"), { target: { value: "0.05" } });
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(screen.getByTestId("live-belief").textContent).toBe(original);
    expect(screen.queryByTestId("modified-badge")).toBeNull();
  });
});
