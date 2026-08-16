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

  it("keeps the media-query dark block in step with the explicit toggle block", () => {
    // The file comments "Keep in step with the media-query block above."
    // This test enforces that: dark values in @media must equal dark values in :root[data-theme="dark"],
    // and both must differ from the light :root block.

    // Extract block 1 (light theme :root)
    const rootStart = css.indexOf(":root {");
    const rootEnd = css.indexOf("@media");
    const rootBlock = css.slice(rootStart, rootEnd);

    // Extract block 2 (dark theme @media prefers-color-scheme: dark)
    const mediaStart = css.indexOf("@media (prefers-color-scheme: dark)");
    const mediaEnd = css.indexOf(":root[data-theme=\"dark\"]");
    const mediaBlock = css.slice(mediaStart, mediaEnd);

    // Extract block 3 (dark theme :root[data-theme="dark"])
    const dataThemeStart = css.indexOf(":root[data-theme=\"dark\"]");
    const dataThemeEnd = css.indexOf("* { box-sizing: border-box; }");
    const dataThemeBlock = css.slice(dataThemeStart, dataThemeEnd);

    // Helper: extract hex value that follows a token name in a block
    const extractTokenValue = (block: string, tokenName: string): string | null => {
      const regex = new RegExp(`${tokenName}:\\s*(#[0-9A-Fa-f]{6})`);
      const match = block.match(regex);
      return match?.[1] ?? null;
    };

    // For each seat and variant, verify media-query and explicit toggle have identical values
    for (let i = 0; i < SEAT_COUNT; i++) {
      for (const suffix of ["", "-wash", "-line"]) {
        const tokenName = `--seat-${i}${suffix}`;
        const lightValue = extractTokenValue(rootBlock, tokenName);
        const mediaValue = extractTokenValue(mediaBlock, tokenName);
        const dataThemeValue = extractTokenValue(dataThemeBlock, tokenName);

        expect(mediaValue, `${tokenName} in @media should exist`).not.toBeNull();
        expect(dataThemeValue, `${tokenName} in :root[data-theme="dark"] should exist`).not.toBeNull();
        expect(mediaValue, `${tokenName}: @media and :root[data-theme="dark"] must be identical`).toBe(dataThemeValue);
        expect(mediaValue !== lightValue, `${tokenName}: dark value must differ from light value`).toBe(true);
      }
    }
  });
});
