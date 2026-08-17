import { cp, rm, access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Puts the product where the landing page says it is.
 *
 * apps/landing/src/links.ts holds one destination for the product and every "Open
 * the app" CTA on the page reads it. Nothing in the repo built that destination, so
 * the default was a promise no build kept: `npm run landing:build` produced a page
 * whose one link into the product 404s. Nothing catches that on its own - a dead
 * link on a marketing page is not a test failure anywhere, which is the reason
 * links.ts exists at all.
 *
 * THE DESTINATION IS READ OUT OF links.ts RATHER THAN REPEATED HERE, because
 * repeating it is how this script broke. It was written when APP_URL defaulted to
 * `/app/` and it staged the client into `apps/landing/dist/app`; the default later
 * moved to `/deliberation/` and this line did not follow. Two literals a directory
 * apart with no test between them, and `npm run site:build` went back to producing a
 * site where every CTA into the product 404s - the exact failure the script was
 * written to prevent, reintroduced by the script itself. Derived, it cannot drift.
 *
 * VITE_APP_URL is honoured for the same reason: `npm run site:build` runs the
 * landing build in this process's environment, so an override is already baked into
 * the page by the time this runs. Staging anywhere else would disagree with the page
 * that was just built.
 *
 * `/deliberation/` is also where `npm run dev` serves the client (tools/dev-all.mjs
 * assigns the port, apps/landing/vite.config.ts server.proxy routes the path), so a
 * built site and a dev session name the product by the same URL and a link that
 * works in one works in the other.
 *
 * A copy rather than a Vite `base` rewrite per deployment: apps/deliberation sets
 * `base: "./"`, so the bundle is position-independent and this script only has to
 * decide where it lands.
 *
 * WHAT THIS DOES NOT DO. It does not make /api exist. apps/deliberation is a client for
 * a service - its vite config says so - and it now signs itself in on load rather than
 * showing a sign-in form, so a static host serving this directory ALONE gives you a page
 * that fails on its first request instead of one that merely cannot get past the door.
 *
 * WHAT SERVES IT. `services/api` now does, when `ARBITER_STATIC_DIR` points at the
 * directory this script writes - which is the arrangement the Dockerfile and fly.toml
 * use, and it is what makes the one-origin requirement hold in production without a
 * second process. Left unset, the API still answers 404 to anything outside /api, which
 * is what the dev servers want: `npm run dev` fronts everything with Vite's proxy and
 * must not have a second thing claiming those paths.
 */

const LINKS = "apps/landing/src/links.ts";

/**
 * The URL the built page will actually use, in the same order links.ts resolves it:
 * VITE_APP_URL if set, otherwise the literal default in the source.
 *
 * A regex over TypeScript is a blunt instrument, so it fails loudly rather than
 * falling back to a guess. A guessed path here reproduces the dead link silently,
 * which is worse than a build that stops and says which line it could not read.
 */
async function appUrl() {
  const override = process.env["VITE_APP_URL"];
  if (override !== undefined && override.trim() !== "") return override.trim();

  const source = await readFile(LINKS, "utf8");
  const match = /APP_URL[^=]*=[\s\S]*?\?\?\s*"([^"]+)"/.exec(source);
  if (match === null) {
    console.error(`Could not read APP_URL's default out of ${LINKS}.`);
    console.error(`Expected \`... ?? "/some/path/"\`. Fix the pattern here, or set VITE_APP_URL.`);
    process.exit(1);
  }
  return match[1];
}

const url = await appUrl();

// An absolute URL is a supported configuration - links.ts says so - and it means the
// client is served by something else entirely. Staging it into the landing build
// would write a directory nothing on the page links to, so this is a no-op and says
// why, rather than an error: the site that was just built is correct as it stands.
if (!url.startsWith("/")) {
  console.log(`APP_URL is ${url}, an absolute URL - the client is hosted elsewhere.`);
  console.log(`Nothing staged. apps/landing/dist is the whole site in this arrangement.`);
  process.exit(0);
}

const subpath = url.replace(/^\/+|\/+$/g, "");
// `/` would resolve to apps/landing/dist itself, and the rm below would then delete
// the landing page this script exists to complete.
if (subpath === "") {
  console.error(`APP_URL is "${url}", the site root. There is no subdirectory to stage into.`);
  console.error(`The landing page and the client cannot both be the root of one build.`);
  process.exit(1);
}

const client = resolve("apps/deliberation/dist");
const dest = resolve("apps/landing/dist", subpath);

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

console.log(`staged  apps/deliberation/dist -> apps/landing/dist/${subpath}`);
console.log(`APP_URL ${url} now resolves in the built site.`);
console.log(`NOTE    this client needs /api on the same origin. Static alone is a page that cannot load a case.`);
