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

test("the artifact requests nothing over the network", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("file://")) external.push(`${r.method()} ${r.url()}`);
  });

  await page.goto(`${artifact}#/validation`);
  await expect(page.getByTestId("single-class-warning")).toBeVisible();

  // No runtime fetch anywhere in the app: all data is imported at build time.
  // Over file:// a fetch of a sibling JSON is blocked as cross-origin, so this
  // is a correctness requirement, not a preference.
  expect(external).toEqual([]);
});
