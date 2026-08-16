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
  await expect(page.getByRole("link", { name: "Arbiter", exact: true })).toBeVisible();
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
