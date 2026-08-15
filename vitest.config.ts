import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // App tests render components and need a DOM. The engine, harness and API
    // tests must stay on node - jsdom would mask a purity violation by
    // providing browser globals the engine is forbidden to use.
    environmentMatchGlobs: [
      ["apps/deliberation/**", "jsdom"],
      ["apps/landing/**", "jsdom"],
    ],
    // Repo-root rather than inside an app: this registers testing-library's
    // cleanup and two jsdom polyfills for EVERY suite, so it cannot live in one
    // app's folder. It did (apps/web/test/setup.ts) until that app was deleted,
    // which would have taken the whole suite's cleanup down with it.
    setupFiles: ["vitest.setup.ts"],
    // e2e/ holds Playwright specs, driven by `npm run e2e`, not vitest. Their
    // filenames match vitest's default `*.spec.ts` glob, so without this vitest
    // collects them and they fail on an undefined `page` fixture.
    // Spread the defaults rather than replacing them: writing the list out by
    // hand would silently drop vitest's exclusions for dist/ and .idea/ and let
    // a built copy of a test be collected twice.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
