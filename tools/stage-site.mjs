import { cp, rm, access } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Puts the product where the landing page says it is.
 *
 * apps/landing/src/links.ts defaults APP_URL to `/app/`, and nothing in the repo
 * built that, so the default was a promise no build kept: `npm run landing:build`
 * produced a page whose one link into the product 404s. It was invisible locally
 * only because .env.development overrides APP_URL to a dev server, so the dead
 * link existed exclusively in the builds an outside reader would ever see.
 *
 * STAGES apps/deliberation, NOT apps/web. The redesign is the four-stage app with
 * the real API behind it; apps/web is the older seven-tab static artifact and is
 * still built and still submitted, but it is not what "Open The App" should mean.
 *
 * A copy rather than a Vite `base` rewrite per deployment: apps/deliberation now
 * sets `base: "./"`, so the bundle is position-independent and this script only
 * has to decide where it lands.
 *
 * WHAT THIS DOES NOT DO. It does not make /api exist. apps/deliberation is a
 * client for a service - the vite config says so - so a static host serving this
 * directory alone gives you a sign-in screen that cannot sign anybody in. The
 * arrangement that works is spec 10's: the API and this directory on one origin.
 * Staging the client is the half of that which is a build step; serving them
 * together is a deployment decision this repo does not currently encode anywhere.
 */

const client = resolve("apps/deliberation/dist");
const dest = resolve("apps/landing/dist/app");

try {
  await access(client);
} catch {
  console.error(`Nothing at ${client}. Run \`npm run deliberate:build\` first.`);
  process.exit(1);
}

// Removed rather than merged: a stale asset from a previous build that the new
// index.html no longer references is invisible locally and served forever.
await rm(dest, { recursive: true, force: true });
await cp(client, dest, { recursive: true });

console.log(`staged  apps/deliberation/dist -> apps/landing/dist/app`);
console.log(`APP_URL /app/ now resolves in the built site.`);
console.log(`NOTE    this client needs /api on the same origin. Static alone is a sign-in screen.`);
