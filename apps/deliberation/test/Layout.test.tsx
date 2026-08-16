import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Steps } from "../src/Layout.js";

const base = { caseId: "c1", route: { name: "case" as const, caseId: "c1" }, revealed: false };

describe("case stages", () => {
  it("puts Read & mark second, between Evidence and Your position", () => {
    render(<Steps {...base} />);
    const labels = screen.getAllByRole("link").map((a) => a.textContent);
    expect(labels[0]).toContain("Evidence");
    expect(labels[1]).toContain("Read & mark");
    expect(labels[2]).toContain("Your position");
  });

  it("links the tab at the read route", () => {
    render(<Steps {...base} />);
    expect(screen.getByRole("link", { name: /Read & mark/ })).toHaveAttribute("href", "#/case/c1/read");
  });

  // Unlike Reveal, reading is never gated: legitimate before you seal, and after
  // the reveal it is where the room's trails get compared.
  it("is enabled before and after the reveal", () => {
    const { rerender } = render(<Steps {...base} />);
    expect(screen.getByRole("link", { name: /Read & mark/ })).not.toHaveAttribute("aria-disabled");
    rerender(<Steps {...base} revealed />);
    expect(screen.getByRole("link", { name: /Read & mark/ })).not.toHaveAttribute("aria-disabled");
  });

  // The viewer's OWN count only. No pip ever reports another reviewer's activity
  // while the case is open - that is a confidence signal, and visibleTo already
  // refuses to return a running tally for the same reason.
  it("pips the viewer's own mark count when given one", () => {
    render(<Steps {...base} marks={14} />);
    expect(screen.getByRole("link", { name: /Read & mark/ })).toHaveTextContent("14");
  });

  it("shows no pip when no count is given", () => {
    render(<Steps {...base} />);
    expect(screen.getByRole("link", { name: /Read & mark/ })).not.toHaveTextContent(/\d/);
  });
});
