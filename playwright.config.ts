import { defineConfig } from "@playwright/test";

/**
 * These specs drive the UNIFIED dev server, not one app in isolation.
 *
 * The suite used to live in apps/web/e2e and boot that app's preview server. With
 * apps/web deleted there is no single-app artifact left to open, and the thing
 * most worth guarding is the arrangement itself: one origin, landing at the root,
 * the product mounted behind it, the API proxied same-origin.
 *
 * 127.0.0.1 rather than localhost in the baseURL, because tools/dev-all.mjs binds
 * every server to 127.0.0.1 explicitly and `localhost` resolves to ::1 first on
 * this machine - Playwright would then fail to connect to a server that is
 * demonstrably running.
 *
 * ARBITER_PORT moves the whole group off 5173 for the test run, so a dev server
 * already open on the default port does not collide with the suite.
 */
const PORT = 4173;

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: `ARBITER_PORT=${PORT} npm run dev`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
