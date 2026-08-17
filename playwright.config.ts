import { defineConfig } from "@playwright/test";

/**
 * TWO ARRANGEMENTS, BECAUSE THE PRODUCT HAS TWO AND THEY FAIL DIFFERENTLY.
 *
 * The suite used to live in apps/web/e2e and boot that app's preview server. With
 * apps/web deleted there is no single-app artifact left to open, and the thing
 * most worth guarding is the arrangement itself.
 *
 *   unified  `npm run dev` - Vite in front, the product proxied behind it, the API
 *            same-origin. This is what a developer sees, and `one-origin.spec.ts`
 *            guards it.
 *   built    `npm run site:build` served by `services/api` with ARBITER_STATIC_DIR
 *            set. This is what a DEPLOYMENT is, and until `public-record.spec.ts`
 *            there was nothing anywhere that opened it.
 *
 * The second one is not a duplicate of the first. `/r/:caseId/:token` was answered
 * by Vite's own dev middleware in one and by nothing at all in the other, and the
 * whole suite was green throughout - which is the general hazard: a dev server that
 * resolves paths for you hides every question about how the built site is laid out.
 *
 * 127.0.0.1 rather than localhost in both baseURLs, because tools/dev-all.mjs binds
 * every server to 127.0.0.1 explicitly and `localhost` resolves to ::1 first on
 * this machine - Playwright would then fail to connect to a server that is
 * demonstrably running.
 *
 * Both ports are off the defaults so a dev server already open on 5173 (or an API on
 * 8787) does not collide with the suite.
 */
const UNIFIED_PORT = 4173;
const BUILT_PORT = 4174;

/**
 * Comfortably over the 32-byte floor `shareSecret()` enforces, and a literal rather
 * than random: `share_links` has no backfill, so a token minted under one secret is
 * dead under the next, and a suite that re-rolled this on every run would be unable
 * to open a link a previous run published. Nothing outside this file's servers ever
 * sees it.
 */
const SHARE_SECRET = "arbiter-e2e-share-secret-not-for-any-deployment";

/**
 * EVERY MODEL CREDENTIAL, BLANKED - and each of these five is load-bearing.
 *
 * `public-record.spec.ts` calls `/adjudicate`, which is three model calls when a
 * credential is present. `buildComplete` returns null - and the free, offline,
 * deterministic `stubComplete` takes over - only when the provider `providerFor`
 * names has nothing to authenticate with, and `providerFor` names exactly two:
 *
 *   GEMINI_API_KEY, ARBITER_GEMINI_API_KEY   the vertex key paths
 *   ARBITER_GCP_PROJECT, GOOGLE_CLOUD_PROJECT  without a project, `geminiCredentialsPresent`
 *                                            returns before it looks at the ADC file
 *                                            this machine may well have
 *   ANTHROPIC_API_KEY                        the other provider, reached whenever
 *                                            ARBITER_MODEL does not start `gemini-`
 *
 * Blank rather than absent, because `loadEnv` only fills in variables that are not
 * already set - so an empty string here beats a `.env` on the machine, while deleting
 * the key would let that `.env` supply one. The spec asserts `source: "stub"` as the
 * backstop: if any of this stops working the test fails instead of billing quietly.
 */
const OFFLINE = {
  GEMINI_API_KEY: "",
  ARBITER_GEMINI_API_KEY: "",
  ARBITER_GCP_PROJECT: "",
  GOOGLE_CLOUD_PROJECT: "",
  ANTHROPIC_API_KEY: "",
};

export default defineConfig({
  testDir: "e2e",
  projects: [
    {
      name: "unified",
      testMatch: /one-origin\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${String(UNIFIED_PORT)}` },
    },
    {
      name: "built",
      testMatch: /public-record\.spec\.ts/,
      use: { baseURL: `http://127.0.0.1:${String(BUILT_PORT)}` },
    },
  ],
  webServer: [
    {
      command: `ARBITER_PORT=${String(UNIFIED_PORT)} npm run dev`,
      url: `http://127.0.0.1:${String(UNIFIED_PORT)}/`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    /**
     * BUILT FIRST, THEN SEEDED, THEN SERVED, in one command because a webServer entry is
     * one process and the ordering matters:
     *
     *   site:build   nothing about this project is exercised by a stale `dist`. The gap
     *                this project exists to catch was in the staging step itself.
     *   seed:demo    the spec signs in as the demonstration team. Idempotent - it reports
     *                accounts that already exist and creates the rest - so a developer's
     *                populated store is fine, and CI's empty one gets a team.
     *   api          with the site pointed at, sharing on, and the model offline.
     *
     * `reuseExistingServer` is FALSE here, unlike the unified server above. That one is a
     * dev server a developer plausibly already has open on this port and reusing it saves
     * a slow start. This one has to be the build that matches the working tree; adopting
     * whatever happened to be listening would silently test an older `dist` - the exact
     * class of stale-artifact failure the project was added to prevent.
     *
     * The health route rather than `/` as the readiness signal: it answers before the
     * store is touched, and it is the one route that means "this process parsed a request
     * and ran the handler" rather than "a file was found".
     */
    {
      command: "npm run site:build && npm run seed:demo && npm run api",
      url: `http://127.0.0.1:${String(BUILT_PORT)}/api/health`,
      reuseExistingServer: false,
      // The build is two Vite builds and a staging pass; on a cold cache with the suite's
      // other server starting beside it this has been the slowest thing in the run.
      timeout: 300_000,
      env: {
        ...OFFLINE,
        PORT: String(BUILT_PORT),
        ARBITER_STATIC_DIR: "apps/landing/dist",
        ARBITER_SHARE_SECRET: SHARE_SECRET,
      },
    },
  ],
});
