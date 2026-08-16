/**
 * Boot smoke check for the unified dev server.
 *
 * Answers one question only: does every surface come up on the one origin, does the
 * overture's WebGL actually initialise, and does anything throw on the way. Not a
 * visual test — the stills are for a human to look at.
 *
 * Assumes `npm run dev` is already running. Usage:
 *   node apps/landing/smoke.mjs [outDir]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] ?? "apps/landing/shots";
const PORT = process.env["ARBITER_PORT"] ?? "5173";
const BASE = `http://127.0.0.1:${PORT}`;

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(7000); // the preloader is tied to real work; let it finish
await page.screenshot({ path: `${OUT}/boot.png` });

// A canvas that exists but never took a context is the failure mode worth catching:
// the page still renders its chrome, so it looks fine until you notice it is flat.
const gl = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return { canvas: false };
  const ctx = c.getContext("webgl2") ?? c.getContext("webgl");
  return { canvas: true, context: Boolean(ctx), w: c.width, h: c.height };
});

// Walk the chapters.
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(1700);
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

// The product, through the proxy rather than on its own port — that path is the
// whole point of the one-origin arrangement and is the bit most likely to be broken
// by a config merge.
await page.goto(`${BASE}/deliberation/`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/product.png` });
const productTitle = await page.title();

console.log("overture webgl:", JSON.stringify(gl));
console.log("overture fps:  ", fps);
console.log("product title: ", productTitle);
console.log(errors.length ? `ERRORS (${errors.length}):\n${errors.slice(0, 10).join("\n")}` : "no console errors");

await browser.close();
