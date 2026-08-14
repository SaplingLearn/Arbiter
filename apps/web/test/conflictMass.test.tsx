import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StoreProvider, initialState } from "../src/state/store.js";
import { TracePanel } from "../src/tabs/Case/TracePanel.js";
import { loadData } from "../src/data/load.js";
import { CYCLOSPORINE, BOOT_CASE } from "../src/data/heroCases.js";

const data = loadData();

// TracePanel takes { collapsed, onExpand }: collapsed renders a rail button and
// nothing else, so every assertion here is on the expanded panel.
const renderAt = (compoundId: string) =>
  render(
    <StoreProvider data={data} initialState={{ ...initialState(data), selectedCompoundId: compoundId }}>
      <TracePanel collapsed={false} onExpand={() => {}} />
    </StoreProvider>,
  );

afterEach(cleanup);

describe("conflict mass on the Case tab", () => {
  it("shows the magnitude, not just the word contested", () => {
    renderAt(CYCLOSPORINE);
    const el = screen.getByTestId("conflict-mass");
    expect(el.getAttribute("data-conflict")).toBe("0.122");
    expect(el).toHaveTextContent(/0\.122/);
  });

  it("renders zero conflict as a number rather than hiding it", () => {
    renderAt(BOOT_CASE);
    expect(screen.getByTestId("conflict-mass").getAttribute("data-conflict")).toBe("0.000");
  });

  it("says what the number means, because Dempster conflict is not self-explanatory", () => {
    renderAt(CYCLOSPORINE);
    expect(screen.getByTestId("conflict-mass")).toHaveTextContent(/removed in combination/i);
  });
});
