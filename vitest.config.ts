import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Web tests render components and need a DOM. The engine and harness tests
    // must stay on node - jsdom would mask a purity violation by providing
    // browser globals the engine is forbidden to use.
    environmentMatchGlobs: [["apps/web/**", "jsdom"]],
    setupFiles: ["apps/web/test/setup.ts"],
  },
});
