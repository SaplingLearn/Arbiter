import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The preview and the print must break pages in the same places.
 *
 * They share one DOM and one paginator, so the only way they can disagree is if the
 * print stylesheet changes a metric - a size, a spacing, a width - because those are
 * what the measurement pass reads. Colour cannot move a page break. This test is the
 * difference between that being true and it merely being intended.
 */
const COLOUR_ONLY = new Set([
  "color", "background", "background-color", "background-image",
  "border-color", "box-shadow", "fill", "stroke", "opacity",
  "-webkit-print-color-adjust", "print-color-adjust", "filter",
]);

/** Rules that exist to REMOVE things from the printed page rather than to restyle the
 *  document: hiding the app's chrome is the whole job of the print block, `display`
 *  there swaps a block in or out rather than resizing it, and `break-*` only says where
 *  the printer's own hard break falls, never how big anything is. `.rep-page-foot`'s
 *  `margin-top` is the one property here that is a metric by name: on screen it is
 *  `auto`, a flex property with no height of its own; print turns the sheet from a flex
 *  column into a block, where `auto` margins do not exist, so the fixed value replaces
 *  a property the new layout mode has already discarded rather than adding a second
 *  metric on top of the one the paginator measured. */
const STRUCTURAL = new Set(["display", "break-before", "break-after", "break-inside", "margin-top"]);
const STRUCTURAL_SELECTORS = /\.no-print|\.rep-page|\.rep-page-foot|\.rep-section|\.rep-position|\.rep-decision|\.rep-stub|\.rep-meta|tr/;

/** THE VIEWPORT AROUND THE SHEET, NOT THE SHEET ITSELF.
 *
 *  `.rep-wrap` and `.report-doc` hold the pager and the stack of sheets, but the
 *  paginator never measures either of them - `Paginate` reads `.rep-gauge` and the
 *  children of `.rep-column` in a hidden, absolutely positioned pass that answers to
 *  neither ancestor's box. So nothing on this selector can move where a page breaks;
 *  every property on it is fair game. The rule exists to strip the screen's viewport
 *  height and clipped overflow, which `html, body { overflow: visible }` above this
 *  rule does not reach on its own - without it a seven-sheet record would print
 *  whatever fit one screen's worth of paper and silently drop the rest. */
const CHROME_SELECTORS = /\.rep-wrap\b|\.report-doc\b/;

/** THE ONE SHEET'S OWN BOX, RESET TO MIRROR `@page`, NOT TO RESIZE IT.
 *
 *  On screen `.rep-page` supplies its own A4 box - width, min-height, padding, border -
 *  because there is no `@page` there to do it. In print, `@page { size: A4; margin:
 *  16mm 14mm }` (declared at the top of this same block) supplies that identical
 *  16mm/14mm inset from the other side; keeping `.rep-page`'s copy too would apply the
 *  margin twice, shrinking the printed content area below the 182mm x 265mm the
 *  paginator measured against and spilling every sheet onto a second printed page -
 *  moving every break, which is exactly what this test exists to catch. Zeroing
 *  `.rep-page`'s own box does not change the content area a sheet gets; it stops that
 *  area being asked for twice. Scoped to the bare `.rep-page` rule only - not
 *  `.rep-page-foot`, whose own box IS part of what `Paginate` measures via
 *  `probeFoot`, and not `.rep-page--off`, which only ever sets `display`. */
const PAGE_BOX_RESET = new Set(["width", "min-height", "margin", "padding", "border"]);

describe("the print stylesheet", () => {
  const css = readFileSync("apps/deliberation/src/app.css", "utf8");

  const printBlock = (): string => {
    const start = css.indexOf("@media print");
    expect(start, "app.css must contain an @media print block").toBeGreaterThan(-1);
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}") { depth--; if (depth === 0) return css.slice(start, i + 1); }
    }
    throw new Error("unbalanced @media print block");
  };

  it("changes no metric on the document's own elements", () => {
    // Comments stripped before parsing: a rule body split naively on ";" glues any
    // comment sitting between two declarations onto the property name that follows it
    // (`/* ... */\n    -webkit-print-color-adjust` as one string), which never matches
    // an allowlisted name and would fail the test over a comment, not a rule.
    const block = printBlock().replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].slice(1);

    const offenders: string[] = [];
    for (const [, rawSelector, rawBody] of rules) {
      // Both groups are required by the pattern (`+` and `*`, no `?`), so they always
      // participate in a match; the fallback only satisfies a type that can't express
      // that, the way TS types every element of a regex match array as possibly absent.
      const selector = (rawSelector ?? "").trim();
      if (!selector.includes(".rep-")) continue;
      if (CHROME_SELECTORS.test(selector)) continue;
      const isPageBox = selector === ".rep-page";
      for (const decl of (rawBody ?? "").split(";")) {
        const prop = decl.split(":")[0]?.trim();
        if (prop === undefined || prop === "") continue;
        if (COLOUR_ONLY.has(prop)) continue;
        if (STRUCTURAL.has(prop) && STRUCTURAL_SELECTORS.test(selector)) continue;
        if (isPageBox && PAGE_BOX_RESET.has(prop)) continue;
        offenders.push(`${selector} { ${prop} }`);
      }
    }

    expect(offenders, "the print block may change colour, not metrics - these would move a page break").toEqual([]);
  });
});
