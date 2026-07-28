import { expect, test } from "@playwright/test";

test("the demo walks end to end on the keyboard alone", async ({ page }) => {
  await page.goto("/#/case");
  await expect(page.getByTestId("verdict")).toContainText(/abstain/i);

  // Drive the whole tour with the arrow key a presenter actually uses.
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/#\/validation/);
  await expect(page.getByTestId("single-class-warning")).toBeVisible();

  // And back, without the app losing its footing.
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/#\/compounds/);
});

test("the M key actually stops the motion, not just flips an attribute", async ({ page }) => {
  await page.goto("/#/case");
  const fill = page.getByTestId("belief-fill");
  const duration = () => fill.evaluate((el) => getComputedStyle(el).transitionDuration);

  // BeliefTrack sets `transition: left 900ms ease, width 900ms ease` as an INLINE
  // style, and inline styles lose only to `!important` in a stylesheet. That is
  // the whole mechanism this asserts: an attribute that flips while the animation
  // keeps running would be a kill switch in name only.
  await expect(page.locator("[data-motion=on]")).toHaveCount(1);
  expect(await duration()).toBe("0.9s, 0.9s");

  await page.keyboard.press("m");
  await expect(page.locator("[data-motion=off]")).toHaveCount(1);
  // One value, not two: the !important 0.01ms replaces the whole shorthand
  // rather than being applied per-property.
  expect(await duration()).toBe("1e-05s");
});

test("the ruleset slider changes the verdict live", async ({ page }) => {
  await page.goto("/#/ruleset");
  const before = await page.getByTestId("live-belief").textContent();
  // R1, not R3: dropping R3's strength on the TAK-994 fixture changes nothing -
  // see apps/web/test/ruleset.test.tsx and task-9-report.md. R1 is the rule
  // that actually moves this fixture's belief, so R1 is what proves the live
  // recompute rather than a stale render.
  await page.getByTestId("strength-R1").fill("0.05");
  await expect(page.getByTestId("live-belief")).not.toHaveText(before ?? "");
  await expect(page.getByTestId("modified-badge")).toBeVisible();
});
