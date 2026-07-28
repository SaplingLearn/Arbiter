import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { CaseHeader } from "../src/tabs/Case/CaseHeader.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const renderHeader = () => render(<StoreProvider data={data}><CaseHeader /></StoreProvider>);

describe("CaseHeader", () => {
  it("names the compound and states the verdict", () => {
    renderHeader();
    expect(screen.getByText(/TAK-994/)).toBeTruthy();
    expect(screen.getByTestId("verdict").textContent).toMatch(/abstain/i);
  });

  it("reports belief and plausibility as a range, not a single number", () => {
    // The gap IS the product. A header showing only belief would hide it.
    renderHeader();
    const range = screen.getByTestId("belief-range").textContent ?? "";
    expect(range).toMatch(/0\.\d+/);
    expect(range).toMatch(/–|-|to/);
  });

  it("states how many claims the current as-of date hides", () => {
    // Without this the two-pass replay is mysterious rather than legible.
    renderHeader();
    expect(screen.getByTestId("hidden-count")).toBeTruthy();
  });
});
