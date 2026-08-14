/**
 * Screenshot harness for tuning the atmosphere.
 *
 * Not a test. This exists so the scenes can be judged as IMAGES against the
 * reference frames rather than by reading shader source and hoping. Run it, look at
 * the output, change a number, run it again.
 *
 * Usage: node apps/atmosphere/shot.mjs [outDir]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] ?? "shots";
const URL = "http://127.0.0.1:5180/";
const STATES = ["dashboard", "new", "library", "ask", "method"];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    // SwiftShader is far too slow for these particle counts; force real GPU paths and
    // accept that this must run on a machine with a GPU.
    "--use-gl=angle",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: "networkidle" });

// Let the overture finish and the first scene settle.
await page.waitForTimeout(6000);
await page.screenshot({ path: `${OUT}/00-loaded.png` });

for (let i = 0; i < STATES.length; i++) {
  if (i > 0) {
    await page.keyboard.press(String(i + 1));
    // Mid-transition frame, to check the displacement actually tears.
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${i}-transition.png` });
    await page.waitForTimeout(2400);
  }
  // Settled frame.
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${i + 1}-${STATES[i]}.png` });
}

// Frame-rate probe on the heaviest scene.
await page.keyboard.press("4");
await page.waitForTimeout(2500);
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

console.log(`fps(ask) = ${fps}`);
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no console errors");

await browser.close();
