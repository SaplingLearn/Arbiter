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

  it("appends the seat numeral when two reviewers share initials", () => {
    render(<Reviewer name="Jack He" seat={2} disambiguate />);
    expect(screen.getByText("JH·2")).toBeInTheDocument();
  });

  it("finds which names collide on initials", () => {
    expect(collidingInitials(["Jack He", "Jane Hart", "Andres Lopez"])).toEqual(new Set(["JH"]));
    expect(collidingInitials(["Jack He", "Andres Lopez"])).toEqual(new Set());
  });
});
