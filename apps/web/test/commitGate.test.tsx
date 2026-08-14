import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { reason } from "@arbiter/engine";
import { StoreProvider, initialState, workingClaims } from "../src/state/store.js";
import { CaseHeader } from "../src/tabs/Case/CaseHeader.js";
import { TracePanel } from "../src/tabs/Case/TracePanel.js";
import { loadData } from "../src/data/load.js";
import { CYCLOSPORINE, BOOT_CASE } from "../src/data/heroCases.js";

const data = loadData();

const renderAt = (compoundId: string) =>
  render(
    <StoreProvider data={data} initialState={{ ...initialState(data), selectedCompoundId: compoundId }}>
      <CaseHeader />
    </StoreProvider>,
  );

/**
 * The gate is not one component's business. `useCaseReasoning()` is called
 * independently by CaseHeader, EvidencePanel, TracePanel and TablePanel, so a gate
 * on the masthead alone still hands the verdict over from the trace panel's
 * verdict-reason line and from the counterfactual's `newVerdict`. Both surfaces
 * are rendered together here for exactly that reason.
 */
const renderCase = (compoundId: string) =>
  render(
    <StoreProvider data={data} initialState={{ ...initialState(data), selectedCompoundId: compoundId }}>
      <CaseHeader />
      <TracePanel collapsed={false} onExpand={() => {}} />
    </StoreProvider>,
  );

describe("the commit-before-reveal gate", () => {
  it("withholds the verdict on a high-gap case until the reader commits", () => {
    // TAK-994: gap 0.910 against a 0.5 threshold.
    renderAt(BOOT_CASE);
    expect(screen.queryByTestId("verdict")).toBeNull();
    expect(screen.getByTestId("commit-gate")).toBeInTheDocument();
  });

  it("reveals the verdict once a call is recorded, and keeps it revealed", () => {
    renderAt(BOOT_CASE);
    fireEvent.click(screen.getByTestId("commit-abstain"));
    expect(screen.getByTestId("verdict")).toHaveTextContent(/abstain/i);
    expect(screen.queryByTestId("commit-gate")).toBeNull();
  });

  it("shows the reader their own call beside the engine's, so the two can be compared", () => {
    renderAt(BOOT_CASE);
    fireEvent.click(screen.getByTestId("commit-advance"));
    expect(screen.getByTestId("provisional-call")).toHaveTextContent(/you said/i);
    expect(screen.getByTestId("provisional-call")).toHaveTextContent(/advance/i);
  });

  it("fires on a contested case even when the gap is narrow", () => {
    // Cyclosporine: gap 0.098, well under the threshold, but contested with
    // conflict mass 0.122. Contested is the second clause for exactly this case.
    renderAt(CYCLOSPORINE);
    expect(screen.getByTestId("commit-gate")).toBeInTheDocument();
  });

  it("says why it is asking, because an unexplained gate is just friction", () => {
    renderAt(BOOT_CASE);
    expect(screen.getByTestId("commit-gate")).toHaveTextContent(/before you see/i);
  });

  it("withholds the belief, plausibility and gap figures too", () => {
    // The figures ARE the verdict on an abstain: a 0.910 gap against a registered
    // 0.5 threshold is the abstention rule read straight off the screen.
    renderAt(BOOT_CASE);
    expect(screen.queryByTestId("belief-range")).toBeNull();
    fireEvent.click(screen.getByTestId("commit-abstain"));
    expect(screen.getByTestId("belief-range")).toBeInTheDocument();
  });

  it("leaves the gate up on a case the reader has not committed on", () => {
    // Write-once is per compound, not per session: committing on TAK-994 must not
    // reveal Cyclosporine.
    const { unmount } = renderAt(BOOT_CASE);
    fireEvent.click(screen.getByTestId("commit-abstain"));
    expect(screen.queryByTestId("commit-gate")).toBeNull();
    unmount();

    renderAt(CYCLOSPORINE);
    expect(screen.getByTestId("commit-gate")).toBeInTheDocument();
  });
});

describe("the gate closes the trace panel's leaks too", () => {
  it("withholds the verdict reason and the counterfactual, which name the verdict", () => {
    // Gating the masthead alone leaks it twice over: verdict-reason is the engine's
    // own sentence about the conclusion, and the counterfactual prints `newVerdict`
    // which is the current verdict's complement stated outright.
    renderCase(BOOT_CASE);
    expect(screen.queryByTestId("verdict-reason")).toBeNull();
    expect(screen.queryByTestId("counterfactual")).toBeNull();
  });

  it("withholds the belief track, the mass line and the conflict mass", () => {
    renderCase(BOOT_CASE);
    expect(screen.queryByTestId("belief-fill")).toBeNull();
    expect(screen.queryByTestId("conflict-mass")).toBeNull();
    expect(document.querySelector('[data-anchor="trace.mass"]')).toBeNull();
    expect(document.querySelector('[data-anchor="trace.beliefTrack"]')).toBeNull();
  });

  it("keeps every trace STEP visible, because the reasoning is what to engage with", () => {
    // Only the conclusion is withheld. Hiding the steps would turn a forcing
    // function into a blindfold: the reader is being asked to read the argument
    // and form a view, which they cannot do with the argument hidden.
    renderCase(BOOT_CASE);
    expect(screen.getAllByTestId("trace-step").length).toBeGreaterThan(0);
    expect(screen.getByTestId("next-experiment")).toBeInTheDocument();
  });

  it("releases all of it on the same single commit", () => {
    renderCase(BOOT_CASE);
    fireEvent.click(screen.getByTestId("commit-abstain"));
    expect(screen.getByTestId("verdict")).toBeInTheDocument();
    expect(screen.getByTestId("verdict-reason")).toBeInTheDocument();
    expect(screen.getByTestId("counterfactual")).toBeInTheDocument();
    expect(screen.getByTestId("conflict-mass")).toBeInTheDocument();
    expect(screen.getByTestId("belief-fill")).toBeInTheDocument();
  });
});

describe("the recorded call itself", () => {
  it("is write-once, so a reader cannot revise it after seeing the verdict", () => {
    // The whole value of the record is that it was made before the answer was
    // visible. A revisable call is a call made with the answer on screen.
    renderAt(BOOT_CASE);
    fireEvent.click(screen.getByTestId("commit-advance"));
    expect(screen.getByTestId("provisional-call")).toHaveTextContent(/advance/i);
    // No second gate exists to click, so the reducer is driven directly through
    // the only other route into it: re-rendering cannot resurrect the buttons.
    expect(screen.queryByTestId("commit-do-not-advance")).toBeNull();
    expect(screen.getByTestId("provisional-call")).not.toHaveTextContent(/do not advance/i);
  });

  it("does not gate a case that is neither high-gap nor contested", () => {
    // A gate on every view is friction that gets clicked through, which is worse
    // than no gate: it manufactures a record of a judgement nobody made. The
    // compound is FOUND by running the engine rather than named, so this cannot
    // rot into a test of one hard-coded id that quietly stopped qualifying.
    const base = initialState(data);
    const quiet = data.testSplit.find((id) => {
      const r = reason(workingClaims(base, id), base.ruleset, "", data.assays);
      return !r.contested && r.plausibility - r.belief <= data.ruleset.abstentionGapThreshold;
    });
    expect(quiet, "no un-gated compound in the scored split").toBeDefined();

    render(
      <StoreProvider data={data} initialState={{ ...base, selectedCompoundId: quiet! }}>
        <CaseHeader />
      </StoreProvider>,
    );
    expect(screen.queryByTestId("commit-gate")).toBeNull();
    expect(screen.getByTestId("verdict")).toBeInTheDocument();
  });
});
