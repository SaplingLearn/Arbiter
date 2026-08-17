# Brand assets

Exported for use outside the apps — decks, docs, anywhere the logo has to sit on a
ground this repo does not control.

| File | What it is |
| --- | --- |
| `arbiter-logo-black.png` | Full lockup — mark + wordmark. 5774×1200, black on transparent. |
| `arbiter-mark-black.png` | The four-square mark alone. 1200×1200, black on transparent. |
| `arbiter-mark-black.svg` | The same mark as vector. Pure rects, no font dependency — scales to any size. |

**Why the lockup is a PNG and the mark is an SVG.** The wordmark is live text in Inter
Tight. An SVG that keeps it as `<text>` renders in whatever the viewing machine happens
to have installed, which in PowerPoint means the logo silently becomes a different logo
on someone else's laptop. A 5774px raster cannot do that. The mark is only four
rectangles with no type in it, so it ships as vector with nothing to go wrong.

**Provenance.** These are not traced from a screenshot. The geometry is taken from
`apps/atmosphere/src/shell.css` — `.brand` (11/15 gap, weight 650, tracking −0.02em) and
`.brand .mark` (2×2 grid, 2/15 gutters) — rendered at 600px and shot with
`omitBackground`, so every non-ink pixel is alpha 0. In the app the tiles are `--cyan`
and pulse; here they are flat `#000000`.

**To regenerate or recolour**, re-render the same CSS at the size you want and screenshot
the element with a transparent background. Change `#000000` in one place for a white
version for dark slides.
