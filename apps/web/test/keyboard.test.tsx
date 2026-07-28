import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { TourFooter } from "../src/tour/TourFooter.js";
import { RulesetTab } from "../src/tabs/Ruleset.js";
import { RecordTab } from "../src/tabs/Record.js";
import { loadData } from "../src/data/load.js";

const data = loadData();

/**
 * The global keys are the presentation surface, and they are bound on `window`,
 * which means every keystroke anywhere in the app reaches them - including
 * keystrokes meant for a text field.
 */
describe("global keys yield to form fields", () => {
  it("does not advance the beat when the arrow key is nudging a slider", () => {
    // Arrow keys are how you nudge a focused range input. Teleporting the
    // presenter to another tab instead is indistinguishable from a crash from the
    // far end of a Teams call.
    render(<StoreProvider data={data}><RulesetTab /><TourFooter /></StoreProvider>);
    const beatBefore = screen.getByText(/Beat 1 of/).textContent;

    fireEvent.keyDown(screen.getByTestId("strength-R1"), { key: "ArrowRight" });

    expect(screen.getByText(/Beat 1 of/).textContent).toBe(beatBefore);
  });

  it("does not toggle motion when 'm' is a letter being typed into a rationale", () => {
    // "malformed", "murine", "metabolite" - a reviewer typing any of them would
    // silently strip the motion from the demo.
    render(<StoreProvider data={data}><RecordTab /><TourFooter /></StoreProvider>);
    expect(screen.getByText(/motion on/)).toBeTruthy();

    const rationale = screen.getByLabelText(/Rationale/);
    fireEvent.keyDown(rationale, { key: "m" });

    expect(screen.getByText(/motion on/)).toBeTruthy();
  });

  it("still drives the tour from the page body, which is where a presenter is", () => {
    // The guard must not disable the feature it protects.
    render(<StoreProvider data={data}><TourFooter /></StoreProvider>);
    expect(screen.getByText(/Beat 1 of/)).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "ArrowRight" });

    expect(screen.getByText(/Beat 2 of/)).toBeTruthy();
  });

  it("still toggles motion from the page body", () => {
    render(<StoreProvider data={data}><TourFooter /></StoreProvider>);
    fireEvent.keyDown(document.body, { key: "m" });
    expect(screen.getByText(/motion off/)).toBeTruthy();
  });
});
