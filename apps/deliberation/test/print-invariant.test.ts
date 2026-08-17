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

/** THE VIEWPORT AROUND THE SHEET, NOT THE SHEET ITSELF - AND ONLY WHEN IT IS THE ONE
 *  RULE THAT SAYS SO.
 *
 *  `.rep-wrap` and `.report-doc` hold the pager and the stack of sheets, but the
 *  paginator never measures either of them - `Paginate` reads `.rep-gauge` and the
 *  children of `.rep-column` in a hidden, absolutely positioned pass that answers to
 *  neither ancestor's box. So the geometry reset below (display/padding/margin/
 *  max-width/height/min-height/max-height/overflow, all on the wrapper chain together)
 *  cannot move where a page break falls.
 *
 *  That is NOT the same claim as "every property on every selector that mentions
 *  `.report-doc` is safe" - the previous version of this exemption tested the raw
 *  selector text for the SUBSTRING `.report-doc`, so a descendant selector like
 *  `.report-doc .rep-section { font-size: 6pt }` rode the exemption meant for the
 *  wrapper's own box, despite directly targeting a measured child. Typography
 *  inherits down through `.report-doc` into every `.rep-*` element under it; box
 *  geometry on `.report-doc` itself does not propagate the same way.
 *
 *  So this is a SET of exact selectors, checked only against a rule whose ENTIRE
 *  comma-separated selector list is drawn from it (`length > 1` on top of that: this
 *  is the six-way wrapper-reset rule specifically, not a licence for `.report-doc` or
 *  `.rep-wrap` to appear alone with an arbitrary property - a bare
 *  `.report-doc { font-size: 8pt }` is exactly the shape this must NOT wave through,
 *  and does not, because a single-selector rule never satisfies `length > 1`). */
const CHROME_SELECTORS = new Set([".shell", ".work", ".work-col", ".col", ".rep-wrap", ".report-doc"]);

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

/** `.report-doc`'s only other legitimate print rule: swapping its `--rep-*` design
 *  tokens back to their printed literals (see `.report-doc { --rep-paper: #fff; ... }`
 *  below). These are pure colour carriers by construction - nothing but a custom
 *  property consumed as a colour lives under this prefix - so they are allowlisted by
 *  name rather than added to `COLOUR_ONLY`, which only holds literal, known-safe CSS
 *  property names and would otherwise have to special-case every token this file ever
 *  grows. Scoped to the bare `.report-doc` selector, same reasoning as `isPageBox`
 *  below: a compound selector built on top of `.report-doc` is not this rule. */
const REPORT_DOC_TOKEN_PREFIX = "--rep-";

describe("the print stylesheet", () => {
  /*
   * COMMENTS STRIPPED FILE-WIDE, BEFORE LOCATING THE BLOCK - not on the slice found
   * below, and not by anchoring on a longer literal instead.
   *
   * `app.css` contains the text "@media print" twice: once as the real at-rule, and
   * once inside a comment on `.rep-qr-block` explaining that the block needs no rule of
   * its own there. `indexOf("@media print")` against the raw file finds the COMMENT
   * first, because it comes earlier in the file, and then walks brace-balance from
   * inside prose that has no braces of its own to balance against - which is how this
   * test spent several tasks examining a fragment of a comment plus one unrelated rule,
   * finding a single match, discarding it via `.slice(1)`, and passing on zero rules
   * checked.
   *
   * Anchoring on the longer literal "@media print {" would fix today's collision but
   * not the next one: a future comment that happens to end in "print {" - describing
   * some OTHER `@media print {` block, say - would reproduce exactly this bug one
   * character different. Stripping comments from the whole file before any indexOf
   * removes the entire category, not one instance of it: there is no text left for a
   * literal inside a comment to collide with.
   */
  const cssRaw = readFileSync("apps/deliberation/src/app.css", "utf8");
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");

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
    const block = printBlock();
    // `@page` is excluded BY NAME, not by position. The regex below always yields the
    // at-rule as its first match (see the note further down), and the previous
    // `.slice(1)` dropped "whichever rule comes first" rather than "@page" specifically
    // - harmless while @page truly is first, silent the day a `.rep-*` rule gets
    // inserted above it in the file and is dropped in its place instead.
    const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, rawSelector]) => (rawSelector ?? "").trim() !== "@page");

    // A test that silently examines zero rules passes for the wrong reason, and that is
    // precisely the bug the anchor fix above closes. This is the assertion that would
    // have caught it: the real block carries eleven checkable rules once @page is
    // excluded, comfortably clear of an empty scope.
    expect(rules.length, "expected to find rules inside the print block, found none").toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const [, rawSelector, rawBody] of rules) {
      // Both groups are required by the pattern (`+` and `*`, no `?`), so they always
      // participate in a match; the fallback only satisfies a type that can't express
      // that, the way TS types every element of a regex match array as possibly absent.
      const selector = (rawSelector ?? "").trim();
      if (!selector.includes(".rep-") && !selector.includes(".report-doc")) continue;

      const chromeParts = selector.split(",").map((part) => part.trim());
      const isChromeRule = chromeParts.length > 1 && chromeParts.every((part) => CHROME_SELECTORS.has(part));
      if (isChromeRule) continue;

      const isPageBox = selector === ".rep-page";
      const isReportDoc = selector === ".report-doc";
      for (const decl of (rawBody ?? "").split(";")) {
        const prop = decl.split(":")[0]?.trim();
        if (prop === undefined || prop === "") continue;
        if (COLOUR_ONLY.has(prop)) continue;
        if (STRUCTURAL.has(prop) && STRUCTURAL_SELECTORS.test(selector)) continue;
        if (isPageBox && PAGE_BOX_RESET.has(prop)) continue;
        if (isReportDoc && prop.startsWith(REPORT_DOC_TOKEN_PREFIX)) continue;
        offenders.push(`${selector} { ${prop} }`);
      }
    }

    expect(offenders, "the print block may change colour, not metrics - these would move a page break").toEqual([]);
  });
});
