import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { StoreProvider, useDispatch } from "../src/state/store.js";
import { useAnchorScroll, SPOTLIGHT_HOLD_MS } from "../src/ai/useAnchorScroll.js";
import { loadData } from "../src/data/load.js";

const data = loadData();

interface ScrollCall {
  el: Element;
  behavior: string | undefined;
}
let calls: ScrollCall[] = [];

/** jsdom implements neither of these, and both are the subject of the test. */
function stubMatchMedia(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  calls = [];
  // `Parameters<...>` rather than naming `ScrollIntoViewOptions` directly: that
  // interface is a TypeScript-only ambient type with no runtime constructor, so
  // it is absent from the `browser` env's global list and the base `no-undef`
  // rule (which is not type-aware) flags a bare reference to it as undefined.
  Element.prototype.scrollIntoView = function (opts?: Parameters<Element["scrollIntoView"]>[0]) {
    calls.push({ el: this, behavior: typeof opts === "object" ? opts.behavior : undefined });
  };
  stubMatchMedia(false);
  window.location.hash = "#/case";
});

afterEach(() => {
  window.location.hash = "#/case";
});

const submit = (text: string) => {
  const input = screen.getByTestId("nav-input");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
};

describe("the deferred resolve", () => {
  it("scrolls only once the other tab has actually mounted", async () => {
    // hashchange fires ASYNCHRONOUSLY, so the target element does not exist on
    // the next statement. This is the one piece of genuinely new machinery
    // Surface 3 needs (spec section 8): without pendingAnchor plus an effect
    // that fires when the tab matches, a naive implementation queries the DOM
    // in the click handler, finds nothing, and silently does nothing forever.
    render(<App />);
    submit("You use an LLM as your baseline and in the product. Which is it?");
    const anchor = await screen.findByTestId("nav-anchor");

    // Precondition, asserted on the DOM rather than on a call count: the
    // destination is genuinely not mounted while the Case tab is showing.
    expect(document.querySelector('[data-anchor="validation.llmAblation"]')).toBeNull();

    fireEvent.click(anchor);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.el.getAttribute("data-anchor")).toBe("validation.llmAblation");
    expect(calls[0]!.el).toHaveAttribute("data-anchor-spotlight", "on");
  });

  it("un-collapses a collapsed Case region before it scrolls into it", async () => {
    // While the tour sits on beat 2 with focus "trace", the evidence panel has
    // unmounted its content and no evidence-row exists in the DOM at all
    // (Case/index.tsx:18, EvidencePanel.tsx:13). Scrolling first would scroll to
    // nothing.
    render(<App />);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await waitFor(() =>
      expect(document.querySelector(".case-grid")?.getAttribute("data-focus")).toBe("trace"),
    );
    expect(document.querySelector('[data-anchor="evidence.citationStatus"]')).toBeNull();

    submit("Isn't feeding it the mouse study hindsight?");
    const anchors = await screen.findAllByTestId("nav-anchor");
    const target = anchors.find((a) => a.getAttribute("data-anchor-id") === "evidence.citationStatus");
    fireEvent.click(target!);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.el.getAttribute("data-anchor")).toBe("evidence.citationStatus");
  });
});

/** A component the test drives directly, for the cases the cache cannot reach. */
function Harness({ anchorId, text }: { anchorId: string; text: string }) {
  const dispatch = useDispatch();
  useAnchorScroll("case");
  return (
    <>
      <div data-anchor={anchorId}>{text}</div>
      <button type="button" onClick={() => dispatch({ type: "setPendingAnchor", anchorId })}>go</button>
      <button type="button" onClick={() => dispatch({ type: "toggleMotion" })}>motion</button>
    </>
  );
}

const renderHarness = (anchorId: string, text: string) =>
  render(
    <StoreProvider data={data}>
      <Harness anchorId={anchorId} text={text} />
    </StoreProvider>,
  );

describe("never point at nothing", () => {
  it("scrolls to an anchor that has text", () => {
    // The control. Without it the empty-element test below would pass on an
    // implementation that never scrolls at all.
    renderHarness("trace.counterfactual", "One claim would have to change.");
    fireEvent.click(screen.getByText("go"));
    expect(calls).toHaveLength(1);
  });

  it("drops an anchor whose element is empty rather than pointing at nothing", () => {
    // "The UI surfaces text that already exists" is the whole non-hallucination
    // guarantee (spec section 7.2). An anchor resolving to an empty element
    // falsifies it as surely as invented prose would.
    renderHarness("trace.counterfactual", "");
    fireEvent.click(screen.getByText("go"));
    expect(calls).toHaveLength(0);
    expect(document.querySelector("[data-anchor]")).not.toHaveAttribute("data-anchor-spotlight");
  });
});

describe("the motion kill switch reaches the scroll, which CSS cannot", () => {
  it("glides when motion is on and the media query is not asking for less", () => {
    renderHarness("trace.counterfactual", "One claim would have to change.");
    fireEvent.click(screen.getByText("go"));
    expect(calls[0]!.behavior).toBe("smooth");
  });

  it("jumps when the M toggle is off, even though the media query says nothing", () => {
    // motion.css overrides animation-duration and transition-duration only.
    // scrollIntoView({behavior}) is a JS argument no stylesheet can reach, so a
    // naive spotlight keeps gliding after M is pressed - the first thing a judge
    // would notice (spec section 8.2).
    stubMatchMedia(false);
    renderHarness("trace.counterfactual", "One claim would have to change.");
    fireEvent.click(screen.getByText("motion"));
    fireEvent.click(screen.getByText("go"));
    expect(calls[0]!.behavior).toBe("auto");
  });

  it("jumps when the media query asks for less motion, even with the M toggle on", () => {
    // The second signal, independently. tokens.css:29 cannot reach the scroll
    // either, so prefers-reduced-motion has to be read in JS.
    stubMatchMedia(true);
    renderHarness("trace.counterfactual", "One claim would have to change.");
    fireEvent.click(screen.getByText("go"));
    expect(calls[0]!.behavior).toBe("auto");
  });
});

describe("the spotlight", () => {
  it("clears itself well inside the 1.5s motion budget", () => {
    expect(SPOTLIGHT_HOLD_MS).toBeLessThanOrEqual(1500);

    vi.useFakeTimers();
    try {
      renderHarness("trace.counterfactual", "One claim would have to change.");
      fireEvent.click(screen.getByText("go"));
      expect(document.querySelector("[data-anchor]")).toHaveAttribute("data-anchor-spotlight", "on");

      act(() => { vi.advanceTimersByTime(SPOTLIGHT_HOLD_MS + 1); });

      expect(document.querySelector("[data-anchor]")).not.toHaveAttribute("data-anchor-spotlight");
    } finally {
      vi.useRealTimers();
    }
  });
});
