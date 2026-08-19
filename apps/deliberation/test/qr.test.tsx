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

  it("keeps its own four-module quiet zone, so it stays scannable regardless of what CSS surrounds it", () => {
    const { container } = render(<QrCode value="https://example.test/r/c1/tok" size={120} />);
    const svg = container.querySelector("svg")!;
    const padded = Number(svg.getAttribute("viewBox")!.split(" ")[2]);

    // Every QR code's finder patterns touch the module grid's own corners, so the
    // darkest module always reaches the edge of the raw grid - meaning the nearest a
    // dark module ever gets to the SVG's edge is exactly the margin this component
    // adds. That makes the margin observable without needing to know the raw module
    // count independently: if the quiet zone shrank, grew, or vanished, these bounds
    // would move with it.
    const darkRects = Array.from(container.querySelectorAll('rect[fill="#000"]'));
    expect(darkRects.length).toBeGreaterThan(0);
    const xs = darkRects.map((r) => Number(r.getAttribute("x")));
    const ys = darkRects.map((r) => Number(r.getAttribute("y")));

    // The viewBox spans eight modules more than the module grid: four of quiet zone on
    // each side. Confirmed here as (rightmost edge) - (leftmost edge) = padded - 8.
    expect(Math.max(...xs) + 1 - Math.min(...xs)).toBe(padded - 8);
    expect(Math.max(...ys) + 1 - Math.min(...ys)).toBe(padded - 8);

    // No dark module is drawn within four units of any edge.
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(4);
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(4);
    for (const x of xs) expect(x + 1).toBeLessThanOrEqual(padded - 4);
    for (const y of ys) expect(y + 1).toBeLessThanOrEqual(padded - 4);
  });
});
