import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider, initialState } from "../src/state/store.js";
import { CaseHeader } from "../src/tabs/Case/CaseHeader.js";
import { loadData } from "../src/data/load.js";
import { CYCLOSPORINE } from "../src/data/heroCases.js";

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

  it("offers no as-of milestones on a compound that is not a hero case", async () => {
    const corpusId = data.testSplit.find((id) => !data.heroCases.has(id))!;
    render(
      <StoreProvider data={data}>
        <CaseHeader />
      </StoreProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /All evidence/ }));
    });
    // The defect this pins: TAK-994's milestone dates rendered on every compound.
    expect(screen.queryByRole("button", { name: /preFirstInHuman/ })).not.toBeNull();

    cleanup();
    const state = { ...initialState(data), selectedCompoundId: corpusId };
    render(
      <StoreProvider data={data} initialState={state}>
        <CaseHeader />
      </StoreProvider>,
    );
    expect(screen.queryByRole("button", { name: /preFirstInHuman/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /postMurineStudy/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /All evidence/ })).not.toBeNull();
  });

  it("renders a split disclosure when the hero case carries one", () => {
    const data = loadData();
    const hero = data.heroCases.get(CYCLOSPORINE)!;
    const patched = new Map(data.heroCases);
    patched.set(CYCLOSPORINE, { ...hero, splitDisclosure: "QSAR read is in-sample (train split)." });
    const state = {
      ...initialState({ ...data, heroCases: patched }),
      selectedCompoundId: CYCLOSPORINE,
    };
    render(
      <StoreProvider data={{ ...data, heroCases: patched }} initialState={state}>
        <CaseHeader />
      </StoreProvider>,
    );
    expect(screen.getByTestId("split-disclosure").textContent).toMatch(/in-sample/);
  });
});
