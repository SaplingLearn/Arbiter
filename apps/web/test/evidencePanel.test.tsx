import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { EvidencePanel } from "../src/tabs/Case/EvidencePanel.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const renderPanel = (collapsed = false) =>
  render(<StoreProvider data={data}><EvidencePanel collapsed={collapsed} onExpand={() => {}} /></StoreProvider>);

describe("EvidencePanel", () => {
  it("lists one row per visible claim, with its stream and provenance", () => {
    renderPanel();
    const rows = screen.getAllByTestId("evidence-row");
    expect(rows).toHaveLength(data.heroCases.get("TAK-994")!.claims!.length);
    expect(within(rows[0]!).getByTestId("provenance").textContent).toMatch(/literature|database/i);
  });

  it("shows the discount note the engine attached, not an invented one", () => {
    // The trace rationale is the engine's own words. The UI must not paraphrase a
    // weight reduction it did not compute.
    renderPanel();
    expect(screen.getAllByTestId("evidence-row").some((r) => /Weight reduced/.test(r.textContent ?? ""))).toBe(true);
  });

  it("still shows every verdict as a dot when collapsed to a rail", () => {
    // A judge must be able to see that nothing was hidden while another region
    // has the spotlight.
    renderPanel(true);
    expect(screen.getAllByTestId("evidence-dot")).toHaveLength(data.heroCases.get("TAK-994")!.claims!.length);
  });

  it("badges the fixture as unverified literature", () => {
    renderPanel();
    expect(screen.getByTestId("citation-status").textContent).toMatch(/UNVERIFIED/);
  });
});
