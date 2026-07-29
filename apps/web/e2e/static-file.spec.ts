import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

// The submitted artifact is a ZIP that a judge double-clicks. It is opened from
// the filesystem, with no server. Every other test in this suite runs over
// http://localhost, which cannot see the failure mode this one exists for: a
// crossorigin subresource is blocked over file:// and the page renders blank.
//
// The absolute URL overrides the config's baseURL on purpose.
const artifact = pathToFileURL(path.resolve("apps/web/dist/index.html")).href;

test("the built artifact works opened from the filesystem, with no server", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(`pageerror: ${String(e)}`));
  page.on("console", (m) => {
    if (m.type() === "error") failures.push(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => {
    failures.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ""}`);
  });

  await page.goto(`${artifact}#/case`);

  // The engine ran in the browser and produced a verdict. If the bundle were
  // blocked, #root would still be empty and this would time out.
  await expect(page.getByTestId("verdict")).toContainText(/abstain/i);
  await expect(page.locator("body")).toContainText("TAK-994");

  // And the stylesheet applied. --deep is defined only in tokens.css, so a
  // transparent nav means the CSS was inlined but never parsed, or was dropped
  // from the build entirely - which is how a previous attempt at this failed.
  const navBackground = await page.evaluate(() => {
    const nav = document.querySelector("nav");
    return nav ? getComputedStyle(nav).backgroundColor : "NO_NAV";
  });
  expect(navBackground).not.toBe("NO_NAV");
  expect(navBackground).not.toBe("rgba(0, 0, 0, 0)");

  // A blocked subresource shows up here as ERR_FAILED even when the page
  // happens to render, so assert the clean load rather than only the outcome.
  expect(failures).toEqual([]);
});

test("all seven beats walk on the keyboard alone, from the filesystem", async ({ page }) => {
  // The plan's acceptance criterion is the walk on the ARTIFACT, not on localhost.
  // demo.spec.ts covers the served build; this is the one that matches the ZIP a
  // judge opens.
  await page.goto(`${artifact}#/case`);

  const seen: string[] = [];
  for (let beat = 1; beat <= 7; beat++) {
    const footer = await page.getByText(/Beat \d of 7/).textContent();
    seen.push(footer ?? "");
    expect(footer).toContain(`Beat ${beat} of 7`);
    if (beat < 7) await page.keyboard.press("ArrowRight");
  }

  // Seven DISTINCT beats, not the same one re-rendered seven times.
  expect(new Set(seen).size).toBe(7);
  await expect(page).toHaveURL(/#\/validation/);
});

test("Web Crypto works over file://, so the audit log and the hash check are real", async ({ page }) => {
  // Two headline claims run on crypto.subtle: the hash-chained audit log, and the
  // pre-flight ruleset check. crypto.subtle is gated on a secure context, and
  // whether file:// counts as one is a browser policy decision rather than
  // something the code controls - so it gets measured on the actual artifact
  // rather than assumed from the localhost run.
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(`pageerror: ${String(e)}`));

  await page.goto(`${artifact}#/record`);
  await page.getByRole("button", { name: "Sign" }).click();

  // A signed entry proves the digest resolved. If crypto.subtle were missing, sign()
  // would reject and no row would ever appear.
  const row = page.getByTestId("position-row").first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(/snapshot [0-9a-f]{12}…/);

  // The second entry must chain to the first rather than to the genesis zeros.
  await page.getByRole("button", { name: "Sign" }).click();
  await expect(page.getByTestId("position-row").nth(1)).not.toContainText("prev 000000000000");

  // And the pre-flight hash check, which recomputes the pre-registered hash in the
  // browser and compares it rather than printing a constant.
  await page.keyboard.press("?");
  await expect(page.getByTestId("check-ruleset")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("check-manifest")).toHaveAttribute("data-ok", "true");

  expect(failures).toEqual([]);
});

test("the honesty caveats are not the least legible text on screen", async ({ page }) => {
  // Screen-share compression degrades silently: it looks fine locally while a judge
  // cannot read the small print. The small print here is what stops us overclaiming,
  // so it is the last thing that should be hard to read. Measured, because "it looked
  // fine on my monitor" is how this goes wrong.
  const measure = (id: string) =>
    page.getByTestId(id).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) };
    });

  await page.goto(`${artifact}#/validation`);
  const single = await measure("single-class-warning");
  expect(single.size).toBeGreaterThanOrEqual(15);
  expect(single.weight).toBeGreaterThanOrEqual(600);

  await page.goto(`${artifact}#/case`);
  const citation = await measure("citation-status");
  expect(citation.size).toBeGreaterThanOrEqual(14);
  expect(citation.weight).toBeGreaterThanOrEqual(600);
});

test("the artifact requests nothing over the network", async ({ page }) => {
  // BELT AND BRACES, NOT THE GUARANTEE. These two channels catch a request over
  // http:// - which is the shape a regression takes on the served build, and the
  // shape a judge never sees. Over file:// they catch nothing at all: measured,
  // with the liveEnabled gate ablated so both AI ladders fire real fetches on
  // every panel open, NEITHER "request" NOR "requestfailed" fired, and all five
  // tests in this file stayed green. A relative "/api/interpret" resolves against
  // a file:// document as file:///api/interpret, and the Fetch API refuses the
  // file: scheme synchronously, before any CDP network event exists to observe.
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("file://")) external.push(`${r.method()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    external.push(`FAILED ${r.method()} ${r.url()} ${r.failure()?.errorText ?? ""}`);
  });

  // THIS is the channel that can fail over file://. The refused fetch leaves one
  // trace and only one:
  //   Fetch API cannot load file:///api/interpret. URL scheme "file" is not supported.
  // A caught TypeError produces no pageerror either, so the console is what makes
  // the zero-network claim falsifiable on the artifact a judge actually opens.
  // ai-static.spec.ts:41-43 already does this for the AI surfaces; this file is
  // where the claim is made, so the check belongs here too.
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(`pageerror: ${String(e)}`));
  page.on("console", (m) => {
    if (m.type() === "error") failures.push(`console: ${m.text()}`);
  });

  await page.goto(`${artifact}#/validation`);
  await expect(page.getByTestId("single-class-warning")).toBeVisible();

  // And the two paths that CAN reach for a network: opening the pre-flight panel
  // runs both AI ladders with their real resolvers. Without this the test never
  // drives the only code in the app that owns a fetch call at all, so the gate it
  // claims to guard is never exercised.
  await page.goto(`${artifact}#/case`);
  await expect(page.getByTestId("verdict")).toContainText(/abstain/i);
  await page.keyboard.press("?");
  await expect(page.getByTestId("check-surface-1")).not.toHaveAttribute("data-source", "pending");
  await expect(page.getByTestId("check-surface-3")).not.toHaveAttribute("data-source", "pending");
  // Neither ladder may report a live answer: on this artifact both of client.ts's
  // gates hold, so rung 1 is skipped rather than attempted and failed.
  await expect(page.getByTestId("check-surface-1")).not.toHaveAttribute("data-source", "live");
  await expect(page.getByTestId("check-surface-3")).not.toHaveAttribute("data-source", "live");

  // No runtime fetch anywhere in the app: all data is imported at build time.
  // Over file:// a fetch of a sibling JSON is blocked as cross-origin, so this
  // is a correctness requirement, not a preference.
  expect(external).toEqual([]);
  expect(failures).toEqual([]);
});
