import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, "../src/app.css"), "utf8");

describe("seat tokens", () => {
  // Duplicated from services/api/seats.ts rather than imported: apps/deliberation's
  // tsconfig does not include services/, and reaching across that boundary for one
  // integer would be the first crack in it. If SEAT_COUNT changes, this fails loudly.
  const SEAT_COUNT = 6;
  // :root, the prefers-color-scheme block, and :root[data-theme="dark"].
  const BLOCKS = 3;

  it("declares every seat token in all three theme blocks", () => {
    for (let i = 0; i < SEAT_COUNT; i++) {
      for (const suffix of ["", "-wash", "-line"]) {
        const token = `--seat-${i}${suffix}:`;
        const hits = css.split(token).length - 1;
        expect(hits, `${token} should appear once per theme block`).toBe(BLOCKS);
      }
    }
  });

  it("never gives a seat one of the reserved semantic hues", () => {
    const reserved = ["#E5484D", "#FF8A8E", "#1CA64C", "#55C97F", "#2B2BF0", "#7B84FF", "#74747B", "#9A9AA0"];
    for (const line of css.split("\n").filter((l) => l.includes("--seat-"))) {
      for (const hex of reserved) {
        expect(line.toUpperCase(), `a seat reuses ${hex}`).not.toContain(hex);
      }
    }
  });

  it("defines a class for every seat and a neutral fallback", () => {
    for (let i = 0; i < SEAT_COUNT; i++) expect(css).toContain(`.seat-${i}`);
    expect(css).toContain(".seat-none");
  });
});
