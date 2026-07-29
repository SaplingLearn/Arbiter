import { render } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RAW } from "../src/data/bundle.js";
import { ErrorBoundary } from "../src/ui/ErrorBoundary.js";

/**
 * A malformed bundled file must produce a VISIBLE failure, not a blank page.
 *
 * `load.ts` promises that "a malformed file must fail HERE, naming itself", and it
 * does throw - but `loadData()` was called at MODULE SCOPE in App.tsx, before
 * React mounted anything. The ErrorBoundary in main.tsx only catches render-phase
 * errors, so the throw escaped module evaluation, `createRoot(...).render(...)`
 * never ran, and the page came up empty. An error message nobody can see does not
 * name itself, and a blank page under presentation conditions is exactly the
 * defect recorded in HANDOVER 6.1.
 *
 * The metrics document is corrupted rather than the evidence file because
 * metrics.json is the artifact this change put a schema on, and its readers are
 * the judge-facing Validation tab.
 */
vi.mock("../src/data/bundle.js", async () => {
  const actual = await vi.importActual<typeof import("../src/data/bundle.js")>("../src/data/bundle.js");
  const metrics = JSON.parse(JSON.stringify(actual.RAW.metrics));
  // A plausible drift, not vandalism: a count that arrives as a string. Nothing
  // about the rest of the document is disturbed, so the app would otherwise render.
  metrics.sampleSizes.scored = "two hundred and sixty-seven";
  return { RAW: { ...actual.RAW, metrics } };
});

describe("a malformed metrics.json", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("is corrupted by this file's mock, so the test is testing something", () => {
    // Guards the mock itself. If the module mock silently stopped applying, every
    // assertion below would pass for the wrong reason - the app renders fine and
    // getByText would simply not find an error, which is not what these assert.
    expect((RAW.metrics as { sampleSizes: { scored: unknown } }).sampleSizes.scored).toBe(
      "two hundred and sixty-seven",
    );
  });

  it("renders a visible error naming the file and the field, not a blank page", async () => {
    // Imported HERE rather than at the top of the file on purpose. While loadData()
    // ran at module scope, this import threw, and that is precisely the failure
    // being demonstrated: the error escapes before any React tree exists, so no
    // boundary can catch it and nothing reaches the screen.
    const { App } = await import("../src/App.js");

    const { container } = render(
      <React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>,
    );

    expect(container.textContent).toMatch(/results\/metrics\.json/);
    expect(container.textContent).toMatch(/sampleSizes\.scored/);
    expect(container.textContent).toMatch(/expected number, received string/i);
  });

  it("puts enough on screen to read across a room, not an empty root", async () => {
    // The failure mode is a blank page, so assert against blankness directly.
    const { App } = await import("../src/App.js");
    const { container } = render(<ErrorBoundary><App /></ErrorBoundary>);

    expect(container.textContent?.length ?? 0).toBeGreaterThan(40);
    expect(container.querySelector("h1")?.textContent).toMatch(/ARBITER could not render/);
  });
});
