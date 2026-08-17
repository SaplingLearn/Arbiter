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
    const link = screen.getByRole("link", { name: /Read & mark/ });
    expect(link).not.toHaveTextContent(/\d/);
    expect(link.querySelector(".pip")).toBeNull();
  });

  it("renders zero as a pip value", () => {
    render(<Steps {...base} marks={0} />);
    expect(screen.getByRole("link", { name: /Read & mark/ })).toHaveTextContent("0");
  });

  /**
   * The report is a stage you can SEE before you can open it.
   *
   * It used to be reachable only from inside the verdict block, so on a case that had
   * not been adjudicated there was no trace of it anywhere and nothing said why. A
   * locked tab with its reason on it is how this strip already answers that question
   * for the reveal.
   */
  describe("the report stage", () => {
    it("is locked until the case has been adjudicated, and says so", () => {
      render(<Steps {...base} />);
      const tab = screen.getByRole("link", { name: /Report/ });
      expect(tab).toHaveAttribute("aria-disabled", "true");
      expect(tab).toHaveAttribute("title", "Opens once the case has been adjudicated");
    });

    it("stays locked after the reveal, because a reveal is not an adjudication", () => {
      // A report with an empty verdict reads as a panel that concluded nothing.
      render(<Steps {...base} revealed />);
      expect(screen.getByRole("link", { name: /Report/ })).toHaveAttribute("aria-disabled", "true");
    });

    it("opens once there is an adjudication to print", () => {
      render(<Steps {...base} revealed adjudicated />);
      const tab = screen.getByRole("link", { name: /Report/ });
      expect(tab).not.toHaveAttribute("aria-disabled");
      expect(tab).toHaveAttribute("href", "#/case/c1/report");
    });

    it("comes last, after the record", () => {
      render(<Steps {...base} />);
      const labels = screen.getAllByRole("link").map((a) => a.textContent);
      expect(labels.at(-2)).toContain("Record");
      expect(labels.at(-1)).toContain("Report");
    });
  });
});
