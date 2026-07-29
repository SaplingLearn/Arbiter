import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { NavigatorBar } from "../src/ai/NavigatorBar.js";
import { CaseTab } from "../src/tabs/Case/index.js";
import { TourFooter } from "../src/tour/TourFooter.js";
import { loadData } from "../src/data/load.js";

const data = loadData();

const renderBar = () =>
  render(
    <StoreProvider data={data}>
      <NavigatorBar />
      <TourFooter />
    </StoreProvider>,
  );

const submit = (text: string) => {
  const input = screen.getByTestId("nav-input");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
  return input;
};

describe("the navigator bar", () => {
  it("turns a prepared question into named destinations and says which rung answered", async () => {
    renderBar();
    submit("If R6 has no code of its own, is it really a rule?");

    const anchors = await screen.findAllByTestId("nav-anchor");
    expect(anchors.map((a) => a.getAttribute("data-anchor-id"))).toEqual(["rule.R6"]);
    // The rung is displayed, not just returned: the pre-flight story is that
    // "which rung answered" is a value, and a presenter can see it degrade.
    expect(screen.getByTestId("nav-rung").textContent).toMatch(/2/);
  });

  it("offers the four suggestions instead of an apology when nothing matches", async () => {
    renderBar();
    submit("zzz qqq vvv xxx");

    const suggestions = await screen.findAllByTestId("nav-suggestion");
    expect(suggestions).toHaveLength(4);
    expect(screen.queryByTestId("nav-anchor")).toBeNull();
  });

  it("answers a suggestion when it is clicked, from the cache", async () => {
    renderBar();
    submit("zzz qqq vvv xxx");
    const suggestions = await screen.findAllByTestId("nav-suggestion");

    fireEvent.click(suggestions[0]!);

    const anchors = await screen.findAllByTestId("nav-anchor");
    expect(anchors.map((a) => a.getAttribute("data-anchor-id")))
      .toEqual(["trace.verdictReason", "trace.beliefTrack"]);
  });

  it("un-collapses the region a destination lives in", async () => {
    // Collapsed Case regions unmount their content (spec section 8), so a
    // presentational setFocus is the navigator's own job - the pattern the tour
    // beats already establish.
    render(
      <StoreProvider data={data}>
        <NavigatorBar />
        <CaseTab />
      </StoreProvider>,
    );
    submit("Nothing in pass 1 contradicts anything. So what is there to arbitrate?");
    const anchors = await screen.findAllByTestId("nav-anchor");

    fireEvent.click(anchors[0]!);

    expect(document.querySelector(".case-grid")?.getAttribute("data-focus")).toBe("trace");
  });
});

describe("the navigator bar and the global keys", () => {
  it("does not kill the motion when 'murine' is typed into the question box", () => {
    // Spec section 7.3. This is why the box is a real <input> and not a
    // contenteditable div: isTypingTarget already returns true for INPUT, so the
    // window-level M handler suppresses itself with no new code.
    renderBar();
    expect(screen.getByText(/motion on/)).toBeTruthy();

    const input = screen.getByTestId("nav-input");
    for (const key of ["m", "u", "r", "i", "n", "e"]) fireEvent.keyDown(input, { key });

    expect(screen.getByText(/motion on/)).toBeTruthy();
  });

  it("does not move the beat when an arrow key moves the caret in the question box", () => {
    renderBar();
    const before = screen.getByText(/Beat 1 of/).textContent;

    fireEvent.keyDown(screen.getByTestId("nav-input"), { key: "ArrowRight" });

    expect(screen.getByText(/Beat 1 of/).textContent).toBe(before);
  });

  it("focuses the box on '/' and does not type the slash into it", () => {
    renderBar();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(screen.getByTestId("nav-input"));
    expect((screen.getByTestId("nav-input") as HTMLInputElement).value).toBe("");
  });

  it("does NOT dismiss on Escape, because Escape already means something else", async () => {
    // Spec section 7.3: Escape is deliberately exempt from the isTypingTarget
    // guard (TourFooter.tsx:25) and dispatches setFocus: null. A navigator that
    // also owned Escape would collapse whichever Case region was just opened.
    renderBar();
    submit("If R6 has no code of its own, is it really a rule?");
    await screen.findAllByTestId("nav-anchor");

    fireEvent.keyDown(screen.getByTestId("nav-input"), { key: "Escape" });

    expect(screen.getAllByTestId("nav-anchor")).toHaveLength(1);
  });

  it("dismisses on Backspace once the box is empty, and collapses to one line", async () => {
    renderBar();
    const input = submit("If R6 has no code of its own, is it really a rule?");
    await screen.findAllByTestId("nav-anchor");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Backspace" });

    expect(screen.queryByTestId("nav-anchor")).toBeNull();
    expect(screen.getByTestId("navigator").getAttribute("data-open")).toBe("no");
  });
});
