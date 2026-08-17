import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { QrCode } from "../src/qr.js";

describe("the QR code", () => {
  it("draws as SVG, so it stays sharp at print resolution", () => {
    const { container } = render(<QrCode value="https://example.test/r/c1/tok" size={120} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("scales by viewBox rather than by redrawing, so one encoding serves every size", () => {
    const { container } = render(<QrCode value="https://example.test/r/c1/tok" size={120} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toMatch(/^0 0 \d+ \d+$/);
    expect(svg.getAttribute("width")).toBe("120");
  });

  it("encodes a longer URL without throwing, since case ids are not short", () => {
    const long = `https://arbiter.example/r/${"turalio-pexidartinib--u_1e1a1bc16a48c9d440"}/${"x".repeat(43)}`;
    const { container } = render(<QrCode value={long} size={120} />);
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(1);
  });

  it("carries the URL as its accessible name, so it is not a blank image to a screen reader", () => {
    const { container } = render(<QrCode value="https://example.test/r/c1/tok" size={120} />);
    expect(container.querySelector("svg")?.getAttribute("role")).toBe("img");
    expect(container.querySelector("title")?.textContent).toContain("example.test");
  });

  it("changes its drawing when the value changes", () => {
    const a = render(<QrCode value="https://example.test/a" size={120} />).container.innerHTML;
    const b = render(<QrCode value="https://example.test/b" size={120} />).container.innerHTML;
    expect(a).not.toBe(b);
  });
});
