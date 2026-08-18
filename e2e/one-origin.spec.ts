import { expect, test } from "@playwright/test";

/**
 * The arrangement, not the contents: one origin, landing at the root, the product
 * mounted behind it, the API reachable same-origin.
 *
 * `reducedMotion: "reduce"` is how these tests skip the opening scene. It is not a
 * convenience - `OpeningScene.tsx:28` states that under prefers-reduced-motion the
 * scene never mounts at all, so this is the app's own documented path to "no
 * overlay", rather than a click race against an animation.
 */
test.use({ reducedMotion: "reduce" });

test("the landing page renders at the root", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/ARBITER/i);
  /* The wordmark's accessible name is "Arbiter, back to top" - it carries what the
     link DOES as well as what it says, which is right for a logo that is also a
     navigation control. `exact: true` on "Arbiter" was written against the header
     this one replaced. Anchored at the start rather than pinned to the whole string,
     so rewording the purpose half does not fail a test about the page rendering. */
  await expect(page.getByRole("link", { name: /^Arbiter\b/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /open the app/i }).first()).toBeVisible();
});

/**
 * The regression guard for the blank marketing page.
 *
 * `InteractiveGrid` builds a THREE.WebGLRenderer, which THROWS when no WebGL
 * context can be created. apps/landing has no error boundary, so that throw used to
 * unmount the entire tree and serve a blank white page with a correct <title> - to
 * anyone with a blocked GPU, a hardened browser or a VM.
 *
 * getContext is stubbed rather than the GPU disabled by flag: a flag would depend on
 * how this browser was launched, while an init script reproduces the exact failure
 * on every runner. Asserting on real content rather than on `body` being non-empty,
 * because the failure mode rendered a body that existed and was empty.
 */
test("the landing page survives a browser with no WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (typeof type === "string" && type.toLowerCase().includes("webgl")) return null;
      return (real as (this: HTMLCanvasElement, ...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  await page.goto("/");

  await expect(page.getByRole("link", { name: /open the app/i }).first()).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();
});

/**
 * THE SIGN-IN BUTTON THIS USED TO ASSERT NO LONGER EXISTS, and it was not moved or
 * renamed - it was deliberately removed. `App.tsx` says so where the branch is taken:
 * "NO SIGN-IN. The landing page opens straight into the product." A test guarding a
 * feature the product argued its way out of keeps failing until somebody deletes it,
 * and teaches whoever reads it that the feature should be there.
 *
 * The nav is the honest replacement for what this test is actually named for. It is
 * rendered by the product shell and only after a session exists, so it proves the app
 * is served behind this origin AND that it got far enough to be usable - which the
 * sign-in button proved back when the app opened on a form. Asserting the landmark
 * rather than any tab label, because the tabs are product surface and change; the
 * arrangement this file guards does not.
 */
test("the product is mounted behind the same origin", async ({ page }) => {
  await page.goto("/deliberation/");

  await expect(page).toHaveTitle(/deliberation/i);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

/**
 * Same-origin, and specifically NOT a CORS failure. 401 is the correct answer to an
 * unauthenticated request and proves the proxy carried it to the API; a cross-origin
 * misconfiguration fails before it can produce a status at all.
 */
test("the API answers on the same origin", async ({ request }) => {
  const response = await request.get("/api/cases");
  expect(response.status()).toBe(401);
});

/**
 * THE SHARE LINK REACHES THE RECORD PAGE HERE TOO, and the failure it replaces was not a
 * 404 but a 200.
 *
 * `/r/:caseId/:token` is the one URL in the product that is not under `/deliberation/` -
 * it is what a QR code printed onto a record carries. This server's proxy table did not
 * mention it, so the landing app's own dev server answered it with the MARKETING PAGE at
 * status 200: a share URL opened during development looked like a feature that was broken
 * rather than one that was not routed, which is the more expensive of the two to work out.
 *
 * No token is published here - that needs a case, and `public-record.spec.ts` does it
 * against a built site where it belongs. What this asserts is that the path arrives at the
 * right DOCUMENT, which is the thing the proxy table decides. The page then says the link
 * is not valid, because the API refuses an id it has never seen - and that refusal is the
 * proof it reached the public entry rather than the landing page.
 */
test("a share URL reaches the record page rather than the landing page", async ({ page }) => {
  await page.goto("/r/no-such-case/not-a-token");

  await expect(page).toHaveTitle(/Deliberation record/i);
  await expect(page).not.toHaveTitle(/ARBITER/i);
  await expect(page.getByText(/This link is not valid/i)).toBeVisible();
});

/**
 * DEVELOPMENT ACCEPTS EXACTLY WHAT PRODUCTION ACCEPTS, and this is what keeps them in step.
 *
 * The dev middleware matched `startsWith("/r/")` while `serveStatic` requires exactly three
 * segments, so `/r/onlyonesegment` drew the record page here and 404'd on a built site. And
 * the landing proxy was keyed on the literal `/r/`, which does not match a bare `/r` - so
 * that one path fell through to the landing app and came back as the MARKETING PAGE at
 * status 200, the precise failure the proxy entry exists to remove.
 *
 * Deliberately the same shapes `e2e/public-record.spec.ts` checks against the built site.
 * Two implementations of one rule cannot be held together by a comment; they can be held
 * together by two tests that fail in opposite places when they disagree.
 */
test("a truncated share URL is refused here exactly as it is on a built site", async ({ page }) => {
  for (const path of ["/r", "/r/", "/r/only-one-segment", "/r/a/b/c"]) {
    const res = await page.goto(path);
    await expect(page, path).not.toHaveTitle(/Deliberation record/i);
    expect(res?.status(), `${path} should not be answered with a page`).not.toBe(200);
  }
});

/**
 * The landing page's one link into the product has to resolve on this origin.
 * It used to point at a separate port via `.env.development`, which meant it 404'd
 * for anyone running the unified server.
 */
test("the landing page's call to action reaches the product", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /open the app/i }).first().click();

  await expect(page).toHaveURL(/\/deliberation\//);
  await expect(page).toHaveTitle(/deliberation/i);
});
