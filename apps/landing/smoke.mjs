/**
 * Boot smoke check for the overture.
 *
 * Answers one question only: does the page come up, does WebGL actually initialise,
 * and does anything throw on the way. Not a visual test — the stills are for a human
 * to look at.
 *
 * Usage: node apps/landing/smoke.mjs [outDir]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] ?? "apps/landing/shots";
const URL = "http://127.0.0.1:5175/";

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(7000); // let the preloader finish
await page.screenshot({ path: `${OUT}/boot-1.png` });

// Is there a live WebGL context with something drawn into it?
const gl = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return { canvas: false };
  const ctx = c.getContext("webgl2") ?? c.getContext("webgl");
  return {
    canvas: true,
    context: Boolean(ctx),
    w: c.width,
    h: c.height,
    // A canvas that is present but never drawn into reads as fully transparent.
    painted: (() => {
      try {
        const g = ctx;
        const px = new Uint8Array(4);
        g.readPixels(Math.floor(c.width / 2), Math.floor(c.height / 2),
          1, 1, g.RGBA, g.UNSIGNED_BYTE, px);
        return [...px];
      } catch { return null; }
    })(),
  };
});

// Walk the chapters and grab a still of each.
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${OUT}/chapter-${i + 1}.png` });
}

const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0;
  const t0 = performance.now();
  const tick = () => {
    n++;
    if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
    else res(Math.round((n * 1000) / (performance.now() - t0)));
  };
  requestAnimationFrame(tick);
}));

console.log("webgl:", JSON.stringify(gl));
console.log("fps:", fps);
console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.slice(0, 12).join("\n") : "no console errors");

await browser.close();
