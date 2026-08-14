import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider, initialState } from "../src/state/store.js";
import { CaseTab } from "../src/tabs/Case/index.js";
import { loadData } from "../src/data/load.js";
import { CYCLOSPORINE } from "../src/data/heroCases.js";

const data = loadData();

const renderCaseFor = (compoundId?: string) => {
  const state = compoundId === undefined
    ? initialState(data)
    : { ...initialState(data), selectedCompoundId: compoundId };
  return render(
    <StoreProvider data={data} initialState={state}>
      <CaseTab />
    </StoreProvider>,
  );
};

describe("commit before reveal", () => {
  it("holds the verdict on a contested case until the reader has made a call", () => {
    // Cyclosporine is contested with conflict 0.122. Buccinca et al. 2021 measured
    // that an explanation shown before the reader has committed is an anchor, and
    // that explaining WITHOUT a forcing function increases over-reliance rather
    // than reducing it.
    renderCaseFor(CYCLOSPORINE);
    expect(screen.queryByTestId("verdict")).toBeNull();
    expect(screen.getByTestId("provisional-prompt")).toBeTruthy();
  });

  it("keeps the evidence readable before the call, because the call needs it", () => {
    // The gate is on the ANSWER, not on the reading. Hiding the evidence would make
    // it an obstacle rather than a forcing function.
    renderCaseFor(CYCLOSPORINE);
    expect(screen.getAllByTestId("evidence-row").length).toBeGreaterThan(0);
  });

  it("reveals the verdict once a call is recorded, and shows the call back", () => {
    // Showing the reader their own call beside the engine's is the entire payoff of
    // having asked. Without it the gate is only a speed bump.
    renderCaseFor(CYCLOSPORINE);
    fireEvent.click(screen.getByTestId("provisional-advance"));
    expect(screen.getByTestId("verdict")).toBeTruthy();
    expect(screen.getByTestId("your-call").textContent).toMatch(/advance/i);
  });

  it("does not gate during the guided walk, because nobody in the room is being asked", () => {
    // The tour lands on Cyclosporine at beat 6 to SHOW a commitment. The forcing
    // function exists to stop a reader deferring instead of forming a call, and
    // during a narrated walk a presenter is explaining rather than deciding, so a
    // three-button gate costs a keystroke on stage and buys nothing.
    const base = initialState(data);
    render(
      <StoreProvider
        data={data}
        initialState={{ ...base, selectedCompoundId: CYCLOSPORINE, tour: { ...base.tour, beat: 6 } }}
      >
        <CaseTab />
      </StoreProvider>,
    );
    expect(screen.getByTestId("verdict")).toBeTruthy();
    expect(screen.queryByTestId("provisional-prompt")).toBeNull();
  });

  it("does NOT gate a case whose answer is not contestable", () => {
    // The test that keeps this from becoming friction. A gate on every compound is
    // clicked through without reading, which is worse than no gate because it looks
    // like diligence. TAK-994 is uncontested with conflict 0.000.
    renderCaseFor();
    expect(screen.getByTestId("verdict")).toBeTruthy();
    expect(screen.queryByTestId("provisional-prompt")).toBeNull();
  });
});
