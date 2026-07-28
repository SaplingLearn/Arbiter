import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";

describe("accessibility basics", () => {
  it("every interactive control has an accessible name", () => {
    render(<App />);
    for (const el of screen.getAllByRole("button")) {
      const name = el.getAttribute("aria-label") ?? el.textContent ?? "";
      expect(name.trim().length).toBeGreaterThan(0);
    }
  });

  it("the tab bar marks the current tab for assistive technology", () => {
    render(<App />);
    expect(document.querySelector('[aria-current="page"]')).not.toBeNull();
  });

  it("the motion kill switch is reflected on the root, so CSS can honour it", () => {
    render(<App />);
    expect(document.querySelector("[data-motion]")).not.toBeNull();
  });
});
