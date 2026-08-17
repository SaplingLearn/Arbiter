# Brand assets

Exported for use outside the apps — decks, docs, anywhere the logo has to sit on a
ground this repo does not control. All black on transparent.

## The wordmark — what the landing page and the product chrome use

| File | What it is |
| --- | --- |
| `arbiter-wordmark-black.svg` | Notched square + `ARBITER`. Vector, self-contained. **Use this one.** |
| `arbiter-wordmark-black.png` | The same at 8814×1200, for anything that will not take an SVG. |

This is the mark from `packages/design/src/Wordmark.tsx` — the one on the 3D landing
page. It is built entirely from axis-aligned rectangles on a 10×14 grid plus one
45°-notched square, so the SVG carries no font and no background and scales to any size
without going soft. Nothing to substitute, nothing to go wrong on someone else's laptop.

## The four-square mark — the atmosphere chrome

| File | What it is |
| --- | --- |
| `arbiter-mark-black.svg` | The 2×2 square mark alone. Vector. |
| `arbiter-mark-black.png` | The same at 1200×1200. |
| `arbiter-logo-black.png` | Four-square mark + "Arbiter" set in Inter Tight. 5774×1200. |

Geometry from `apps/atmosphere/src/shell.css` — `.brand` (11/15 gap, weight 650,
tracking −0.02em) and `.brand .mark` (2×2 grid, 2/15 gutters). In the app the tiles are
`--cyan` and pulse; here they are flat `#000000`.

`arbiter-logo-black.png` is a raster on purpose: its wordmark is live Inter Tight, and an
SVG holding that as `<text>` renders in whatever font the viewing machine happens to
have, which is how a logo quietly becomes a different logo mid-presentation.

## Regenerating

Both are rendered from their own source rules and screenshotted with `omitBackground`, so
every non-ink pixel is alpha 0 — not traced or keyed out of a screenshot. Change
`#000000` in one place for a white version for dark slides.
