import { expect, test } from "@playwright/test";

test("the demo walks end to end on the keyboard alone", async ({ page }) => {
  await page.goto("/#/case");
  await expect(page.getByTestId("verdict")).toContainText(/abstain/i);

  // Drive the whole tour with the arrow key a presenter actually uses.
  for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/#\/validation/);
  await expect(page.getByTestId("single-class-warning")).toBeVisible();

  // And back, without the app losing its footing.
  for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/#\/compounds/);
});

test("the M key actually stops the motion, not just flips an attribute", async ({ page }) => {
  await page.goto("/#/case");
  const fill = page.getByTestId("belief-fill");
  const duration = () => fill.evaluate((el) => getComputedStyle(el).transitionDuration);

  // `.belief-fill` in case.css sets `transition: left 900ms ease, width 900ms ease`,
  // and `motion.css` overrides it with `transition-duration: 0.01ms !important`
  // scoped to `[data-motion="off"]`. That is the whole mechanism this asserts: an
  // attribute that flips while the animation keeps running would be a kill switch
  // in name only.
  //
  // The transition used to be an inline style, and this comment used to explain
  // that inline styles lose only to `!important`. The redesign moved it into
  // case.css; `!important` still wins and the assertion is unchanged, but the
  // stated mechanism was wrong for a while. A comment that confidently explains
  // the wrong mechanism is worse than none.
  await expect(page.locator("[data-motion=on]")).toHaveCount(1);
  expect(await duration()).toBe("0.9s, 0.9s");

  await page.keyboard.press("m");
  await expect(page.locator("[data-motion=off]")).toHaveCount(1);
  // One value, not two: the !important 0.01ms replaces the whole shorthand
  // rather than being applied per-property.
  expect(await duration()).toBe("1e-05s");
});

test("the spotlight's transition never blankets an evidence row or a trace step", async ({ page }) => {
  await page.goto("/#/case");
  const row = page.getByTestId("evidence-row").first();
  const step = page.getByTestId("trace-step").first();

  // .evidence-row and .trace-step (case.css) each declare
  // `transition: background-color var(--speed) ease;` UNCONDITIONALLY - not only
  // under :hover - so, exactly as the belief-fill assertion above reads its
  // transition without simulating a pointer, this reads it directly too.
  // --speed is 180ms (tokens.css).
  //
  // ai/spotlight.css's spotlight transition is a SEPARATE 600ms idiom for the
  // navigator's highlight, scoped to the compound selector
  // [data-anchor][data-anchor-spotlight="on"] specifically so it never applies
  // to these rows merely for carrying data-anchor. A regression here (both
  // rules share equal (0,1,0) specificity if the spotlight rule is ever
  // loosened back to a bare [data-anchor] selector) would have the bundler's
  // import order silently decide which one wins, and previously did: it made
  // every row's ordinary hover 3.3x slower than every other hover surface in
  // the app.
  expect(await row.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0.18s");
  expect(await step.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0.18s");
});

test("the spotlight fades out over the same 600ms it fades in, not instantly", async ({ page }) => {
  await page.goto("/#/case");

  // validation.llmAblation is a PLAIN anchor - a <p> with no class of its own
  // (Validation.tsx) - exactly the shape spec section 8.2's fix round 2 named:
  // "everything outside .evidence-row/.trace-step/.case-rail" has no rival
  // transition to fall back on, which is what made the pre-fix exit snap
  // instant instead of fading.
  await page.getByTestId("nav-input").fill("You use an LLM as your baseline and in the product. Which is it?");
  await page.getByTestId("nav-input").press("Enter");
  await page.getByTestId("nav-anchor").click();

  const target = page.locator('[data-anchor="validation.llmAblation"]');
  const duration = () => target.evaluate((el) => getComputedStyle(el).transitionDuration);

  await expect(target).toHaveAttribute("data-anchor-spotlight", "on");
  expect(await duration()).toBe("0.6s, 0.6s");

  // SPOTLIGHT_HOLD_MS is 1500ms; useAnchorScroll.ts flips the attribute to
  // "off" rather than removing it once the hold expires.
  await expect(target).toHaveAttribute("data-anchor-spotlight", "off", { timeout: 3000 });

  // The bug fix round 2 caught: pre-fix, removing the attribute entirely
  // dropped the element out of the ONLY rule that declared `transition` for it,
  // so this exact read returned "0s" - an instant snap rather than a fade back
  // out. Post-fix, [data-anchor][data-anchor-spotlight] in spotlight.css
  // matches on PRESENCE (either value "on" or "off"), so the 600ms transition
  // is still in effect while box-shadow/background-color animate back to rest -
  // the exit rhymes with the entrance, exactly as .case-grid's own
  // grid-template-columns transition fades symmetrically both ways.
  expect(await duration()).toBe("0.6s, 0.6s");
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
