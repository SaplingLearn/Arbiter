import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Verdict } from "@arbiter/engine";
import { App } from "../src/App.js";
import { StoreProvider, useDispatch, type Action } from "../src/state/store.js";
import { Preflight } from "../src/ui/Preflight.js";
import { loadData, type LoadedData } from "../src/data/load.js";
import { interpret } from "../src/ai/interpret.js";
import { navigate } from "../src/ai/navigate.js";

/** Turns a dispatch into a click, so the ruleset-edited branch below drives the
 *  REAL reducer through the REAL provider rather than faking a working copy by
 *  hand - mirrors the same helper in evidenceEdits.test.tsx. */
function Fire({ id, action }: { id: string; action: Action }) {
  const dispatch = useDispatch();
  return <button type="button" data-testid={id} onClick={() => dispatch(action)}>{id}</button>;
}

// The panel RUNS both ladders when it opens, so the tests control what the ladders
// return. Mocking here rather than stubbing fetch is deliberate: this file is about
// what the panel REPORTS, and the transport is Task 11's subject.
vi.mock("../src/ai/interpret.js", () => ({ interpret: vi.fn() }));
vi.mock("../src/ai/navigate.js", () => ({ navigate: vi.fn() }));

const data = loadData();

const renderWith = (d: LoadedData) => render(<StoreProvider data={d}><Preflight /></StoreProvider>);

beforeEach(() => {
  vi.mocked(interpret).mockResolvedValue({ value: null, rung: 2, source: "cache" });
  vi.mocked(navigate).mockResolvedValue({ value: null, rung: 2, source: "cache" });
});

/**
 * These assertions read `data-ok` and `data-source` rather than matching the copy,
 * and that is deliberate. The obvious test - textContent matching /registered/i -
 * passes on BOTH branches, because the failure message also contains the word
 * "registered". A test that cannot tell a passing check from a failing one is a
 * caption with a test around it.
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
    const line = renderWith(data).getByTestId("check-manifest");
    expect(line.getAttribute("data-ok")).toBe("true");
    expect(line.textContent).toContain(`all ${data.testSplit.length} compounds`);
  });

  it("REPORTS A DISAGREEMENT when the manifest and the engine differ", () => {
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

  it("says plainly that the ruleset on screen is unedited - once it has PROVED it", async () => {
    // check-edits now compares the working ruleset hash to the registered one
    // rather than comparing values (§9.3, superseded by the digest check-ruleset
    // already proved out). That makes it async, so it has the same pending state
    // check-ruleset does, and for the same reason.
    const line = renderWith(data).getByTestId("check-edits");
    expect(line.getAttribute("data-ok")).toBe("pending");
    await waitFor(() => expect(line.getAttribute("data-ok")).toBe("true"));
  });

  it("WARNS that the ruleset on screen has live edits, once the digest has proved it", async () => {
    // The direction that matters: a predicate that can only ever say "unedited"
    // certifies nothing. Dragging a rule's strength is the same live edit
    // evidenceEdits.test.tsx's §9.3 pair drives against the MODIFIED badge; this
    // confirms check-edits alone, on its own digest comparison, still catches it.
    render(
      <StoreProvider data={data}>
        <Preflight />
        <Fire id="drop-r1" action={{ type: "setRuleStrength", id: "R1", strength: 0.05 }} />
      </StoreProvider>,
    );
    const line = screen.getByTestId("check-edits");
    await waitFor(() => expect(line.getAttribute("data-ok")).toBe("true"));

    fireEvent.click(screen.getByTestId("drop-r1"));
    await waitFor(() => expect(line.getAttribute("data-ok")).toBe("false"));
    expect(line.textContent).toMatch(/press Reset .* before quoting a metric/);
  });

  it("reports NO evidence edits on a clean load, and says which digest proved it", async () => {
    const line = renderWith(data).getByTestId("check-evidence-edits");
    await waitFor(() => expect(line.getAttribute("data-ok")).toBe("true"));
    // The digest prefix is on screen. Without it the line is a caption again: it
    // would read identically on evidence that had drifted.
    expect(line.textContent).toMatch(/[0-9a-f]{8}…/);
  });

  it("WARNS when the evidence on screen carries live edits", async () => {
    // The direction that matters. An implementation that hardcoded data-ok="true"
    // passes the previous test and fails this one.
    const claim = data.fixture.claims[0]!;
    const { container } = render(
      <StoreProvider data={data} initialEvidenceEdits={{ [claim.id]: { klimisch: 4 } }}>
        <Preflight />
      </StoreProvider>,
    );
    const line = container.querySelector('[data-testid="check-evidence-edits"]')!;
    await waitFor(() => expect(line.getAttribute("data-ok")).toBe("false"));
    expect(line.textContent).toMatch(/press Reset .* before quoting a metric/);
  });

  it("tones the evidence-edits warning as a note rather than a failure - editing is the product", async () => {
    // check-edits gets the same treatment (data-tone="note" while data-ok="false"):
    // a reviewer contesting the evidence is using the system correctly, and the
    // fail tone (red) would say they broke it. Reading data-tone rather than a
    // computed style keeps this test honest about what the component controls -
    // the actual colour is CSS (`app.css`'s `.check[data-tone="note"]` rule), which
    // this design's Check component renders through a class, not an inline style.
    const claim = data.fixture.claims[0]!;
    const { container } = render(
      <StoreProvider data={data} initialEvidenceEdits={{ [claim.id]: { klimisch: 4 } }}>
        <Preflight />
      </StoreProvider>,
    );
    const line = container.querySelector('[data-testid="check-evidence-edits"]') as HTMLElement;
    await waitFor(() => expect(line.getAttribute("data-ok")).toBe("false"));
    expect(line.getAttribute("data-tone")).toBe("note");
    expect(line.getAttribute("data-tone")).not.toBe("fail");
  });

  it("clears the evidence warning when a reclassification is edited back to its registered value", async () => {
    // The content-comparison guarantee the digest buys over a reference compare:
    // editing a field and editing it back must clear the warning, not leave it
    // stuck. The registered klimisch for this claim is known from the fixture, so
    // setting the edit to that same value is "edited back", not "never edited".
    const claim = data.fixture.claims[0]!;
    const { container } = render(
      <StoreProvider data={data} initialEvidenceEdits={{ [claim.id]: { klimisch: claim.klimisch } }}>
        <Preflight />
      </StoreProvider>,
    );
    const line = container.querySelector('[data-testid="check-evidence-edits"]')!;
    await waitFor(() => expect(line.getAttribute("data-ok")).toBe("true"));
  });

  it("reports each surface as CACHE when its ladder answered from cache", async () => {
    renderWith(data);
    const one = await screen.findByTestId("check-surface-1");
    const three = await screen.findByTestId("check-surface-3");
    await waitFor(() => expect(one.getAttribute("data-source")).toBe("cache"));
    expect(three.getAttribute("data-source")).toBe("cache");
    expect(one.textContent).toMatch(/rung 2/);
    expect(one.textContent).toMatch(/losing the connection changes nothing/i);
  });

  it("reports a LOCAL answer as local, and never as a cache answer", async () => {
    // The defect this pins. `surfaceLine` had two branches - "live", and everything
    // else rendered as "answered from the bundled cache" - so rung 4 shipped the
    // sentence "answered from the bundled cache (rung 4, source local)", which
    // contradicts itself inside one set of parentheses. Measured on the built
    // artifact: today's PROBE_CHALLENGE and PROBE_QUESTION both land on rung 4,
    // source "local", so this was the sentence the panel actually printed.
    vi.mocked(interpret).mockResolvedValue({ value: null, rung: 4, source: "local" });
    renderWith(data);
    const one = await screen.findByTestId("check-surface-1");
    await waitFor(() => expect(one.getAttribute("data-source")).toBe("local"));
    expect(one.textContent).toMatch(/rung 4/);
    expect(one.textContent).not.toMatch(/answered from the bundled cache/i);
    expect(one.textContent).toMatch(/deterministic matcher/i);
    expect(one.textContent).toMatch(/losing the connection changes nothing/i);
  });

  it("reports an EXHAUSTED ladder as having answered nothing, never as a cache answer", async () => {
    // resolve.ts:42-44 refuses to name a source when nothing answered - "nothing
    // answered, so nothing may be reported as having answered". A line claiming a
    // cache answer for a rung-5 noMatch says the opposite of the module it reports on.
    vi.mocked(navigate).mockResolvedValue({ value: null, rung: 5, source: "none" });
    renderWith(data);
    const three = await screen.findByTestId("check-surface-3");
    await waitFor(() => expect(three.getAttribute("data-source")).toBe("none"));
    expect(three.textContent).toMatch(/rung 5/);
    expect(three.textContent).not.toMatch(/answered from/i);
    expect(three.textContent).toMatch(/no rung answered/i);
  });

  it("reports a surface as LIVE when the live rung answered, and says what a drop costs", async () => {
    // The other direction, and the reason the old check-network line had to go: on a
    // served build with a live surface, "no network call is made at any point" is
    // false. A line that cannot report "live" is the same caption with new words.
    vi.mocked(interpret).mockResolvedValue({ value: null, rung: 1, source: "live" });
    renderWith(data);
    const one = await screen.findByTestId("check-surface-1");
    await waitFor(() => expect(one.getAttribute("data-source")).toBe("live"));
    expect(one.textContent).toMatch(/rung 1/);
    expect(one.textContent).toMatch(/falls back to the bundled cache/i);
  });

  it("does not claim a source before the ladder has answered", async () => {
    // The check-ruleset lesson applied to a second async line: "cache" printed
    // before anything ran is a reassuring statement about nothing.
    vi.mocked(navigate).mockImplementation(() => new Promise(() => { /* never resolves */ }));
    const line = renderWith(data).getByTestId("check-surface-3");
    expect(line.getAttribute("data-source")).toBe("pending");
    expect(line.textContent).toMatch(/Checking/);
  });

  it("no longer claims that no network call is made at any point", async () => {
    // Spec §10 and correction 6: that sentence is false on a served build with a
    // live surface. This asserts the false sentence is GONE, which a rewrite that
    // merely added lines beside it would fail.
    const { container } = renderWith(data);
    await waitFor(() => expect(screen.getByTestId("check-surface-1")).toBeTruthy());
    expect(container.querySelector('[data-testid="check-network"]')).toBeNull();
    expect(container.textContent).not.toMatch(/No network call is made at any point/i);
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
