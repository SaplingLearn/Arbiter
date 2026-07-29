import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { ValidationTab } from "../src/tabs/Validation.js";
import { loadData, type LoadedData } from "../src/data/load.js";

const data = loadData();

const renderWith = (d: LoadedData) =>
  render(<StoreProvider data={d}><ValidationTab /></StoreProvider>);

/**
 * Surface 2's entire §11 row.
 *
 * It is not a ladder rung. Under every one of the five conditions the behaviour is
 * identical and is the master spec's own wording: the button disables with a
 * tooltip and the table is untouched. So there is one test, not five, and what it
 * checks is that the control cannot be used and says why.
 *
 * The surface is specified but NOT BUILT (Phase 3 spec §6): it appends one run to a
 * pre-computed ablation which does not exist - `npm run ablation` is absent from
 * the repo (HANDOVER §3.2). results/metrics.json's metric2a_llmConsistency already
 * carries a placeholder that correctly reports its own absence, and the tooltip is
 * RENDERED FROM IT rather than hardcoded, so the day the ablation lands the panel
 * stops claiming it is missing on its own.
 */
describe("Surface 2 - the live ablation spot check", () => {
  it("renders the control DISABLED", () => {
    renderWith(data);
    expect(screen.getByTestId("live-ablation-run")).toBeDisabled();
  });

  it("takes its tooltip from metrics.json rather than hardcoding the reason", () => {
    // The check that makes this a report rather than a caption: the note is the
    // harness's own account of why the ablation is absent. metric2a_llmConsistency
    // is a genuine union - LlmConsistencyPending carries `note`, LlmConsistencyMeasured
    // does not - so this narrows rather than casting to `any`.
    const ablation = data.metrics.metric2a_llmConsistency;
    expect("note" in ablation).toBe(true);
    const note = "note" in ablation ? ablation.note : null;
    expect(note).toMatch(/ablation\.json not present/);

    expect(screen.queryByTestId("live-ablation-run")).toBeNull();
    renderWith(data);
    expect(screen.getByTestId("live-ablation-run").getAttribute("title")).toBe(note);
  });

  it("STAYS disabled with a different reason when the ablation does exist", () => {
    // The other direction. Surface 2 is specified, not built - so a metrics file
    // carrying real ablation numbers must not silently enable a button with no
    // implementation behind it. The measured shape carries no `note` field at all
    // (LlmConsistencyMeasured, not LlmConsistencyPending), so this is a real,
    // schema-legal "the ablation ran" document, not a stub.
    const withAblation: LoadedData = {
      ...data,
      metrics: {
        ...data.metrics,
        metric2a_llmConsistency: {
          refusals: { refusalRate: 0, refused: 0, requests: 25 },
          meanAgreementRate: 0.91,
          meanConfidenceStdDev: 0.04,
          nCompoundsFullyRefused: 0,
        },
      },
    };
    renderWith(withAblation);
    const button = screen.getByTestId("live-ablation-run");
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toMatch(/specified but not built/);
  });

  it("leaves the baselines table untouched", () => {
    // The master spec's own wording for this row. A control that disabled itself
    // while blanking the table beside it would pass every assertion above.
    const { container } = renderWith(data);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
    const before = [...rows].map((r) => r.textContent);
    expect([...container.querySelectorAll("tbody tr")].map((r) => r.textContent)).toEqual(before);
  });

  it("still exposes the placeholder as text, so the absence is readable without hovering", () => {
    // a11y.test.tsx requires every button to carry an accessible name; a tooltip is
    // not one, and a judge on a projector will not hover.
    renderWith(data);
    expect(screen.getByTestId("llm-ablation").textContent).toMatch(/not present|ANTHROPIC_API_KEY/i);
    expect(screen.getByTestId("live-ablation-run").textContent!.trim().length).toBeGreaterThan(0);
  });
});
