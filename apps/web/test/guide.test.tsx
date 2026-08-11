import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { TourFooter } from "../src/tour/TourFooter.js";
import { Guide } from "../src/ui/Guide.js";
import { Character, faceForBeat } from "../src/ui/Character.js";
import { CHARACTER_ART, CHARACTER_FACES } from "../src/ui/characterArt.js";
import { TAB_IDS } from "../src/router.js";
import { loadData } from "../src/data/load.js";

const data = loadData();

describe("the guide characters", () => {
  it("draws every face, and draws it in the surrounding ink", () => {
    // The art is line work in `currentColor`. If a regenerated file ever came back
    // with Framer's own black baked in, faces would stop responding to the theme
    // and would be invisible against a dark surface - silently.
    for (const face of CHARACTER_FACES) {
      const art = CHARACTER_ART[face];
      expect(art.viewBox).toMatch(/^0 0 [\d.]+ [\d.]+$/);
    }
    const { container } = render(<Character face="boy2" />);
    const svg = container.querySelector("svg");
    expect(svg?.querySelectorAll("path").length).toBeGreaterThan(0);
    expect(svg?.innerHTML).toContain("currentColor");
    expect(svg?.innerHTML).not.toMatch(/token-|rgb\(0,\s*0,\s*0\)/);
  });

  it("hides the face from assistive tech and keeps the sentence readable", () => {
    // A face carries no information; the line beside it does. Eight unlabelled
    // portraits narrated down a page would be pure noise.
    const { container } = render(<Guide tab="case" />);
    expect(container.querySelector(".character")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(/three panels/i)).toBeInTheDocument();
  });

  it("introduces every tab, with no tab left without one", () => {
    // Guides is a total Record<TabId, ...>, so this is really asserting that the
    // typecheck's promise survives at runtime for each route the nav can reach.
    for (const tab of TAB_IDS) {
      const { container, unmount } = render(<Guide tab={tab} />);
      const strip = within(container).getByTestId(`guide-${tab}`);
      expect(strip.querySelector(".character")).not.toBeNull();
      expect(strip.querySelector(".guide-line")?.textContent ?? "").not.toHaveLength(0);
      unmount();
    }
  });
});

describe("the tour narrator's face", () => {
  it("is stable per beat and identical in both directions", () => {
    // Stepping backward through the tour must not swap the narrator mid-sentence,
    // which is what a random face per render would do.
    expect(faceForBeat(3)).toBe(faceForBeat(3));
    expect(faceForBeat(0)).not.toBe(faceForBeat(1));
    // Four faces over eight beats: each is reused exactly twice, never adjacent.
    const walk = [0, 1, 2, 3, 4, 5, 6, 7].map(faceForBeat);
    expect(new Set(walk).size).toBe(CHARACTER_FACES.length);
    for (let i = 1; i < walk.length; i++) expect(walk[i]).not.toBe(walk[i - 1]);
  });

  it("survives a negative index rather than rendering undefined", () => {
    // `go()` clamps, but faceForBeat is exported and the modulo of a negative in
    // JavaScript is negative - which would index off the front of the array.
    expect(CHARACTER_FACES).toContain(faceForBeat(-1));
    expect(CHARACTER_FACES).toContain(faceForBeat(-7));
  });

  it("changes with the beat as the tour advances", () => {
    const { container } = render(
      <StoreProvider data={data}>
        <TourFooter />
      </StoreProvider>,
    );
    const shown = () => container.querySelector(".beat-face svg")?.getAttribute("viewBox");
    const first = shown();
    expect(first).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Next beat"));
    expect(shown()).not.toBe(first);
  });
});
