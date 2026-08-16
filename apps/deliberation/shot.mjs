/**
 * Screenshot harness for the product inside the atmosphere.
 *
 * Not a test, and the sibling of `apps/atmosphere/shot.mjs` for the same reason that
 * one exists: this work can only be judged as IMAGES. Whether a glass panel is legible
 * over a bright colony is not a question source code answers, and the failure mode -
 * type that disappears against one of six backgrounds - is invisible to every check in
 * the repo. Run it, look at the output, change a number, run it again.
 *
 * Needs `npm run dev` up first. Usage: node apps/deliberation/shot.mjs [outDir]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] ?? "shots";
const BASE = process.env.SHOT_URL ?? "http://127.0.0.1:5173/deliberation/";

/** Every surface, plus the transition frame on the way into each. */
const ROUTES = [
  ["dashboard", "#/dashboard"],
  ["new", "#/new"],
  ["library", "#/library"],
  ["ask", "#/ask"],
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  // SwiftShader is far too slow for these particle counts; force real GPU paths, as
  // the atmosphere harness does, and accept that this needs a machine with a GPU.
  args: ["--use-gl=angle", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(BASE + "#/dashboard", { waitUntil: "networkidle" });
// The session establishes itself on arrival and the scene fades up over 1.4s.
await page.waitForTimeout(6000);

for (const [name, hash] of ROUTES) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  // Mid-tear, to check the transition actually displaces rather than dissolving.
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}-transition.png` });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("shot", name);
}

console.log(errors.length ? "CONSOLE ERRORS:\n" + errors.join("\n") : "no console errors");
await browser.close();
