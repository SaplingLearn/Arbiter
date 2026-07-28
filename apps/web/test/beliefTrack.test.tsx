import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BeliefTrack } from "../src/tabs/Case/BeliefTrack.js";

describe("BeliefTrack", () => {
  it("renders both ends of the range and the width between them", () => {
    render(<BeliefTrack belief={0.09} plausibility={1} />);
    expect(screen.getByTestId("belief-lo").textContent).toBe("0.090");
    expect(screen.getByTestId("belief-hi").textContent).toBe("1.000");
    expect(screen.getByTestId("belief-fill").getAttribute("data-width")).toBe("0.910");
  });

  it("shows a wide range as wide - the gap must be visible, not just printed", () => {
    const { rerender } = render(<BeliefTrack belief={0.45} plausibility={0.55} />);
    const narrow = Number(screen.getByTestId("belief-fill").getAttribute("data-width"));
    rerender(<BeliefTrack belief={0} plausibility={1} />);
    const wide = Number(screen.getByTestId("belief-fill").getAttribute("data-width"));
    expect(wide).toBeGreaterThan(narrow);
  });

  it("exposes the range to assistive technology as a range, not two loose numbers", () => {
    render(<BeliefTrack belief={0.09} plausibility={1} />);
    const bar = screen.getByRole("img", { name: /belief/i });
    expect(bar.getAttribute("aria-label")).toMatch(/0\.090.*1\.000/);
  });
});
