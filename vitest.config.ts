import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Web tests render components and need a DOM. The engine and harness tests
    // must stay on node - jsdom would mask a purity violation by providing
    // browser globals the engine is forbidden to use.
    environmentMatchGlobs: [
      ["apps/web/**", "jsdom"],
      ["apps/deliberation/**", "jsdom"],
      ["apps/landing/**", "jsdom"],
    ],
    setupFiles: ["apps/web/test/setup.ts"],
    // apps/web/e2e holds Playwright specs, driven by `npm run e2e`, not vitest.
    // Spread the defaults rather than replacing them: writing the list out by
    // hand would silently drop vitest's exclusions for dist/ and .idea/ and let
    // a built copy of a test be collected twice.
    exclude: [...configDefaults.exclude, "apps/web/e2e/**"],
  },
});
