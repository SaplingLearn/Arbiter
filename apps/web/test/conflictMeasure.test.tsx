import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider, initialState } from "../src/state/store.js";
import { TracePanel } from "../src/tabs/Case/TracePanel.js";
import { loadData } from "../src/data/load.js";
import { CYCLOSPORINE } from "../src/data/heroCases.js";

const data = loadData();

const renderTraceFor = (compoundId?: string) => {
  const state = compoundId === undefined
    ? initialState(data)
    : { ...initialState(data), selectedCompoundId: compoundId };
  return render(
    <StoreProvider data={data} initialState={state}>
      <TracePanel collapsed={false} onExpand={() => {}} />
    </StoreProvider>,
  );
};

describe("the conflict measure", () => {
  it("puts the conflict figure on screen for the one case that has one", () => {
    // Cyclosporine carries conflictMass 0.1215, the only non-zero value among the
    // rendered cases. The engine has computed this from the beginning and no
    // component read it, so only the derived `contested` boolean reached a reader.
    renderTraceFor(CYCLOSPORINE);
    expect(screen.getByTestId("conflict-measure").textContent).toContain("0.12");
  });

  it("reads a near-zero conflict as missing evidence, not as agreement", () => {
    // TAK-994: gap 0.910 with conflict 0.000. A wide interval where nothing
    // opposed anything is ABSENT evidence, and the answer is the experiment the
    // planner names. Calling that a disagreement would send a reader to argue
    // about sources that never contradicted each other.
    renderTraceFor();
    const reading = screen.getByTestId("conflict-reading").textContent ?? "";
    expect(reading).toMatch(/missing evidence rather than disputed evidence/i);
    // Discriminating on the clause that only the dispute branch carries, rather
    // than on the bare word "contradict": the zero branch legitimately uses it to
    // say there is NO contradiction, so a bare word check fails a correct reading.
    expect(reading).not.toMatch(/how much of their combined mass/i);
  });

  it("reads a non-zero conflict as the sources contradicting each other", () => {
    // The other branch, and the reason the reading exists at all: the same
    // interval width means two different things and they have different fixes.
    renderTraceFor(CYCLOSPORINE);
    expect(screen.getByTestId("conflict-reading").textContent).toMatch(/how much of their combined mass/i);
  });

  it("shows the figure even when it is zero, because zero is the useful reading", () => {
    // Hiding the row on zero would lose the most common and most actionable
    // statement in the corpus: these sources did not disagree, so the uncertainty
    // you are looking at is absence rather than dispute.
    renderTraceFor();
    expect(screen.getByTestId("conflict-measure").textContent).toContain("0.000");
  });
});
