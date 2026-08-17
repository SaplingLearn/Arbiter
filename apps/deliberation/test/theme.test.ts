import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, "../src/app.css"), "utf8");

/**
 * REWRITTEN FOR THE ATMOSPHERE BRANCH, and the change is a change of hazard.
 *
 * These tests arrived from main guarding a three-block palette: `:root`, the
 * `prefers-color-scheme` query, and `:root[data-theme="dark"]`, which had to be kept
 * in step by hand. That hazard no longer exists - app.css's header records the fork
 * being deleted, because the design system ships one palette and three copies were
 * three places to disagree. A test still asserting three blocks would fail for the
 * right reason and teach the wrong one.
 *
 * The hazard here is different and worth a guard: this surface is a BLUE WEDGE. The
 * same header states that red and green "are the only hues on the surface that are
 * not in the blue wedge", because they carry verdict meaning. A seat colour that
 * wanders out of the wedge is off-system, and a seat that lands ON a reserved value
 * reads as a verdict or as evidence rather than as a person.
 */
describe("seat tokens", () => {
  // Duplicated from services/api/seats.ts rather than imported: apps/deliberation's
  // tsconfig does not include services/, and reaching across that boundary for one
  // integer would be the first crack in it. If SEAT_COUNT changes, this fails loudly.
  const SEAT_COUNT = 6;

  const seatLines = css.split("\n").filter((l) => l.includes("--seat-"));

  const hexOf = (token: string): string | null => {
    const m = css.match(new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})`));
    return m?.[1] ?? null;
  };

  it("declares every seat token exactly once, because there is one palette", () => {
    for (let i = 0; i < SEAT_COUNT; i++) {
      for (const suffix of ["", "-wash", "-line"]) {
        const token = `--seat-${i}${suffix}:`;
        const hits = css.split(token).length - 1;
        expect(hits, `${token} should be declared once`).toBe(1);
      }
    }
  });

  /**
   * The reserved values are this branch's, not main's. --accent is cyan here rather
   * than indigo, and it is the colour a system highlight wears - a reviewer badge in
   * accent would read as extracted evidence rather than as a person.
   */
  it("never gives a seat a reserved value", () => {
    const reserved = [
      "#4FC3FF", // --accent, and system highlights
      "#8AD8FF", // --accent-hover
      "#FF8A8E", // --stop, the do-not-advance verdict
      "#55C97F", // --go, the advance verdict
      "#D5E0FF", // --ink
      "#020A18", // --app
    ];
    for (const line of seatLines) {
      for (const hex of reserved) {
        expect(line.toUpperCase(), `a seat reuses ${hex}`).not.toContain(hex);
      }
    }
  });

  /**
   * THE WEDGE. Blue has to dominate every seat, and green may not exceed it - that is
   * what keeps the palette inside the one hue family this surface allows. Seats
   * separate by lightness within it rather than by hue, so this test says nothing
   * about how far apart they are; it only says none of them left.
   */
  it("keeps every seat inside the blue wedge", () => {
    for (let i = 0; i < SEAT_COUNT; i++) {
      const hex = hexOf(`--seat-${i}`);
      expect(hex, `--seat-${i} should have a hex value`).not.toBeNull();
      const r = Number.parseInt(hex!.slice(1, 3), 16);
      const g = Number.parseInt(hex!.slice(3, 5), 16);
      const b = Number.parseInt(hex!.slice(5, 7), 16);
      expect(b, `--seat-${i} (${hex}) must be blue-dominant`).toBeGreaterThan(r);
      expect(b, `--seat-${i} (${hex}) must not tip green`).toBeGreaterThanOrEqual(g);
    }
  });

  /**
   * Lightness is the only channel separating these, so a duplicate is not a cosmetic
   * slip - it is two reviewers rendering identically, which is the one thing a seat
   * exists to prevent.
   */
  it("gives no two seats the same value", () => {
    const values = Array.from({ length: SEAT_COUNT }, (_, i) => hexOf(`--seat-${i}`));
    expect(new Set(values).size, "two seats share a colour").toBe(SEAT_COUNT);
  });

  it("defines a class for every seat and a neutral fallback", () => {
    for (let i = 0; i < SEAT_COUNT; i++) expect(css).toContain(`.seat-${i}`);
    expect(css).toContain(".seat-none");
  });
});

/**
 * EVERY CLASS THE MARKUP NAMES HAS A RULE.
 *
 * A className with no matching rule does not throw, does not warn, and does not show
 * up in a type check - it renders as an unstyled element that looks like a mistake
 * nobody made on purpose. That is not hypothetical: `.rail` and `.persona` survived a
 * redesign that dropped them, so the three-way call control on the position form -
 * the single most important input in the product - rendered as three words run
 * together with no gap, no border and no pressed state.
 *
 * Only plain string classNames are read. Template literals interpolate a value
 * (`state ${e.state}`) and the branch names are data, not markup, so they are covered
 * by the state rules those files already have.
 */
describe("the stylesheet covers the markup", () => {
  const sources = [
    "screens.tsx", "pages.tsx", "read.tsx", "Layout.tsx", "App.tsx",
    "Reviewer.tsx", "shell/Chrome.tsx", "shell/Backdrop.tsx",
  ];

  const defined = new Set<string>();
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(m[1]!);

  it("has a rule for every class the components ask for", () => {
    const orphans: string[] = [];
    for (const file of sources) {
      const tsx = readFileSync(join(__dirname, "../src", file), "utf8");
      for (const m of tsx.matchAll(/className="([^"{]+)"/g)) {
        for (const cls of m[1]!.split(/\s+/)) {
          if (cls !== "" && !defined.has(cls)) orphans.push(`${cls} (${file})`);
        }
      }
    }
    expect(orphans, `classes with no rule in app.css: ${orphans.join(", ")}`).toEqual([]);
  });
});

/**
 * A FIELD HAS TO READ AS A FIELD ON THE GROUND IT SITS ON.
 *
 * The form rule's own comment says a field is "darker than paper" - contrast comes
 * from taking light OUT of the ground, because the ink is near-white. It was not:
 * paper carries 0.50 alpha and the field carried 0.46, so once the position form was
 * put on a plate the two composited to nearly the same colour and the textarea
 * disappeared into the panel behind it. A reviewer could not see where to type.
 *
 * Alpha, not the colour channels, is what decides this. Both are near-black, so the
 * one that covers more of what is behind it is the one that reads as lower.
 */
describe("a field against its plate", () => {
  const alphaOf = (rgba: string): number => {
    const m = rgba.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/);
    expect(m, `no alpha in "${rgba}"`).not.toBeNull();
    return Number.parseFloat(m![1]!);
  };

  const paper = css.match(/--paper:\s*(rgba\([^)]+\))/);
  const field = css.match(/textarea\s*\{[^}]*?background:\s*(rgba\([^)]+\))/s);

  it("gives a field a heavier ground than the plate it sits in", () => {
    expect(paper, "--paper should be an rgba value").not.toBeNull();
    expect(field, "the field rule should set an rgba background").not.toBeNull();
    expect(alphaOf(field![1]!), "a field must cover more than the paper behind it")
      .toBeGreaterThan(alphaOf(paper![1]!));
  });
});
