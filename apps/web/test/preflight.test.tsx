import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { StoreProvider } from "../src/state/store.js";
import { Preflight } from "../src/ui/Preflight.js";
import { loadData, type LoadedData } from "../src/data/load.js";
import type { Verdict } from "@arbiter/engine";

const data = loadData();

const renderWith = (d: LoadedData) => render(<StoreProvider data={d}><Preflight /></StoreProvider>);

/**
 * These assertions read `data-ok` rather than matching the copy, and that is
 * deliberate. The obvious test - textContent matching /registered/i - passes on
 * BOTH branches, because the failure message also contains the word "registered".
 * A test that cannot tell a passing check from a failing one is a caption with a
 * test around it.
 */
describe("Preflight", () => {
  it("confirms the bundled ruleset hashes to the pre-registered value", async () => {
    renderWith(data);
    const line = await screen.findByTestId("check-ruleset");
    // The hash is computed asynchronously via Web Crypto. Waiting for data-ok to
    // leave "pending" is what makes this deterministic: an earlier version waited
    // for a specific value, and because a null hash compares unequal to the
    // registered one, data-ok was already "false" on first paint while the text
    // still said "Hashing the ruleset…". That raced, and the component was fixed
    // rather than the test - see the comment on the pending state in Preflight.
    await waitFor(() => expect(line.getAttribute("data-ok")).not.toBe("pending"));
    expect(line.getAttribute("data-ok")).toBe("true");
    expect(line.textContent).toContain("ed073a8a");
  });

  it("REFUSES the ruleset when it does not hash to the pre-registered value", async () => {
    // A silently drifted ruleset is the exact thing this line claims to rule out,
    // so it has to be shown failing on one.
    const drifted: LoadedData = {
      ...data,
      ruleset: {
        ...data.ruleset,
        rules: data.ruleset.rules.map((r, i) => (i === 0 ? { ...r, strength: 0.123 } : r)),
      },
    };

    const line = await renderWith(drifted).findByTestId("check-ruleset");
    await waitFor(() => expect(line.getAttribute("data-ok")).not.toBe("pending"));
    expect(line.getAttribute("data-ok")).toBe("false");
    expect(line.textContent).toMatch(/do not present these numbers as pre-registered/);
  });

  it("does not claim a FAILED check while the hash is still being computed", () => {
    // The bug this pins: hashOk compares a null hash before Web Crypto resolves,
    // so String(hashOk) put data-ok="false" - a failed pre-registration check, in
    // red - on the first paint of every render.
    const line = renderWith(data).getByTestId("check-ruleset");
    expect(line.getAttribute("data-ok")).toBe("pending");
    expect(line.textContent).toMatch(/Hashing the ruleset/);
  });

  it("reports that live recomputation agrees with the committed manifest", () => {
    // The app recomputes rather than trusting results.json, so agreement is a
    // property worth showing rather than assuming.
    const line = renderWith(data).getByTestId("check-manifest");
    expect(line.getAttribute("data-ok")).toBe("true");
    expect(line.textContent).toContain(`all ${data.testSplit.length} compounds`);
  });

  it("REPORTS A DISAGREEMENT when the manifest and the engine differ", () => {
    // The check has to be able to fail, or it certifies nothing. Corrupt one
    // manifest row and the panel must say so, in red, naming the compound.
    const victim = data.testSplit[0]!;
    const wrong = data.manifest.get(victim)!.verdict === "advance" ? "do_not_advance" : "advance";
    const corrupted: LoadedData = {
      ...data,
      manifest: new Map(data.manifest).set(victim, { verdict: wrong as Verdict, belief: 0 }),
    };

    const line = renderWith(corrupted).getByTestId("check-manifest");
    expect(line.getAttribute("data-ok")).toBe("false");
    expect(line.textContent).toContain(victim);
    expect(line.textContent).toMatch(/investigate before presenting/);
  });

  it("says plainly that the ruleset on screen is unedited", () => {
    expect(renderWith(data).getByTestId("check-edits").getAttribute("data-ok")).toBe("true");
  });

  it("states that no network call is made, which is the wifi-drop answer", () => {
    expect(renderWith(data).getByTestId("check-network").textContent).toMatch(/no network call/i);
  });
});

describe("the ? key", () => {
  it("opens the panel and closes it again", () => {
    render(<App />);
    expect(screen.queryByTestId("preflight")).toBeNull();

    fireEvent.keyDown(document.body, { key: "?" });
    expect(screen.getByTestId("preflight")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "?" });
    expect(screen.queryByTestId("preflight")).toBeNull();
  });

  it("does not open when ? is a character being typed into a field", () => {
    // A reviewer writing "safe at what exposure?" would otherwise have the
    // pre-flight panel appear over their rationale mid-sentence.
    window.location.hash = "#/record";
    render(<App />);
    fireEvent.keyDown(screen.getByLabelText(/Rationale/), { key: "?" });
    expect(screen.queryByTestId("preflight")).toBeNull();
    window.location.hash = "";
  });
});
