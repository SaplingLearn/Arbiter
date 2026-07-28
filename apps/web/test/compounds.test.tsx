import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { CompoundsTab } from "../src/tabs/Compounds.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const renderTab = () => render(<StoreProvider data={data}><CompoundsTab /></StoreProvider>);

describe("CompoundsTab", () => {
  it("states the conflict rate across the scored split", () => {
    // Beat 1 exists to show the hero case was not cherry-picked, so the rate has
    // to be on screen as a number, not implied by a list.
    renderTab();
    expect(screen.getByTestId("conflict-rate").textContent).toMatch(/\d+ of 267/);
  });

  it("says plainly how many compounds ARBITER declines", () => {
    // 260 of 267 abstain. Hiding that behind a colour would be the dishonest
    // version of this screen.
    renderTab();
    expect(screen.getByTestId("decline-note").textContent).toMatch(/declines/i);
  });

  it("renders one row per scored compound", () => {
    renderTab();
    expect(screen.getAllByTestId("compound-row")).toHaveLength(267);
  });

  it("never lists the TAK-994 fixture as a scored row", () => {
    renderTab();
    expect(screen.queryByText("TAK-994")).toBeNull();
  });
});
