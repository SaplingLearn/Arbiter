import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Reviewer, collidingInitials } from "../src/Reviewer.js";

describe("Reviewer badge", () => {
  it("shows the initials of the display name", () => {
    render(<Reviewer name="Andres Lopez" seat={0} />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("carries the seat class so colour comes from the token", () => {
    const { container } = render(<Reviewer name="Jack He" seat={3} />);
    expect(container.querySelector(".avatar.seat-3")).not.toBeNull();
  });

  it("falls back to a neutral badge past the last seat", () => {
    const { container } = render(<Reviewer name="Jose Cruz-Lopez" seat={null} />);
    expect(container.querySelector(".avatar.seat-none")).not.toBeNull();
    expect(container.querySelector(".avatar.seat-0")).toBeNull();
  });

  // Colour is never the only channel: the name reaches assistive tech even when
  // the badge shows two letters.
  it("names the account for a screen reader", () => {
    render(<Reviewer name="Andres Lopez" seat={1} />);
    expect(screen.getByLabelText("Andres Lopez")).toBeInTheDocument();
  });

  // aria-label carries the name, and it used to be duplicated into `title`. Several
  // screen readers announce both, so the badge said the name twice for a tooltip
  // that added nothing.
  it("does not repeat the name in a title attribute", () => {
    const { container } = render(<Reviewer name="Andres Lopez" seat={1} />);
    expect(container.querySelector(".avatar")).not.toHaveAttribute("title");
  });

  // THE BOUNDARY. app.css paints .seat-0 through .seat-5; a seat outside that range
  // used to emit `seat-6` (or `seat--1`), a class with no rule behind it, so the badge
  // rendered with no border and no colour - indistinguishable from a layout bug. The
  // neutral badge is the honest degradation.
  it("renders neutral for a seat the palette has no colour for", () => {
    for (const seat of [6, 99, -1]) {
      const { container } = render(<Reviewer name="Andres Lopez" seat={seat} />);
      expect(container.querySelector(".avatar.seat-none")).not.toBeNull();
      expect(container.querySelector(`.avatar.seat-${seat}`)).toBeNull();
    }
  });

  // The last seat the palette DOES paint, asserted beside the first one it does not,
  // so an off-by-one in either direction fails here.
  it("still paints the last seat in the palette", () => {
    const { container } = render(<Reviewer name="Andres Lopez" seat={5} />);
    expect(container.querySelector(".avatar.seat-5")).not.toBeNull();
    expect(container.querySelector(".avatar.seat-none")).toBeNull();
  });

  it("appends the seat numeral when two reviewers share initials", () => {
    render(<Reviewer name="Jack He" seat={2} disambiguate />);
    expect(screen.getByText("JH·2")).toBeInTheDocument();
  });

  it("finds which names collide on initials", () => {
    expect(collidingInitials(["Jack He", "Jane Hart", "Andres Lopez"])).toEqual(new Set(["JH"]));
    expect(collidingInitials(["Jack He", "Andres Lopez"])).toEqual(new Set());
  });
});
