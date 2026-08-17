import { cp, rm, access, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

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
 * a service - its vite config says so - so a static host serving this directory ALONE
 * gives you a page whose first request fails, whether it opens on a sign-in form or signs
 * itself in from a configured identity.
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
  // BOUNDED TO THE APP_URL STATEMENT. `[\s\S]*?` crossed lines and semicolons, so on
  // any links.ts where APP_URL has lost its `?? "..."` default and some LATER export
  // still has one, the lazy match walked past the end of the statement and returned
  // that unrelated literal. Measured on exactly that source: `/not-the-app/`. The
  // script would then stage the client into the wrong directory and print success -
  // the silent dead link this file exists to prevent, with the loud failure below
  // never firing. Neither condition holds today; the bound is what keeps it that way.
  const match = /APP_URL[^=;]*=[^;]*?\?\?\s*"([^"]+)"/.exec(source);
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
const root = resolve("apps/landing/dist");
const dest = resolve(root, subpath);

/* THE `rm` BELOW DELETES `dest` RECURSIVELY, so `dest` has to be inside the build.
   Stripping slashes does not make a path safe: `VITE_APP_URL=/../secrets/` survives it
   as `../secrets` and resolves to a sibling of the build directory, which this script
   would then delete and replace with a copy of the client. The empty-string check above
   covers the site root and nothing else. Compared with a trailing separator so a
   sibling whose name merely starts with the same characters cannot pass. */
if (dest !== root && !dest.startsWith(`${root}${sep}`)) {
  console.error(`APP_URL is "${url}", which resolves to ${dest} - outside ${root}.`);
  console.error(`A staged path has to be a subdirectory of the landing build.`);
  process.exit(1);
}

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

/**
 * THE PUBLIC RECORD PAGE, RECONCILED WITH WHERE ITS ASSETS ACTUALLY LANDED.
 *
 * `public.html` is what `/r/:caseId/:token` is answered with - the share link a QR code
 * on a printed record carries. Two facts about it have to agree and until now were set by
 * two files that did not know about each other:
 *
 *   1. WHERE IT IS MOUNTED. `services/api/server.ts` serves it for a share link, and it
 *      looks for it at the SITE ROOT under one fixed name. A share URL is two real path
 *      segments deep, so a document at a subpath cannot be the thing that answers it
 *      without the server growing a second opinion about where the client was staged.
 *   2. WHAT ITS ASSET REFERENCES CLAIM. `apps/deliberation/vite.config.ts`'s
 *      `renderBuiltUrl` makes them ROOT-ABSOLUTE - `/assets/public-<hash>.js` - because a
 *      relative `./assets/...` from `/r/<caseId>/<token>` resolves against `/r/<caseId>/`
 *      and finds nothing. Root-absolute was right and root was wrong: the copy staged into
 *      `${subpath}/` still asked for `/assets/...`, where the LANDING page's own bundle
 *      lives under different names, so all three references 404'd.
 *
 * What that produced is the worst failure available: 200 OK, correct content type, a
 * document that parses, and a blank page - because its only script was never found. No
 * status line anywhere says anything is wrong. Nothing in the suite could see it either;
 * the served html was exactly the html that was built.
 *
 * So this script sets both facts, because it is the one that knows `subpath`. It rewrites
 * the references to point into the directory it just staged, and it puts the result at the
 * root under the name the server looks for. Derived from the same value as the copy above,
 * so the two cannot drift apart the way `APP_URL` and this script's destination once did.
 *
 * AND THEN IT CHECKS. Every rewritten reference is resolved against the built site and the
 * build FAILS if one is missing. A blank page that nothing reports is precisely what this
 * paragraph exists to prevent, and the only moment it is cheap to notice is here.
 */
const PUBLIC_PAGE = "public.html";
const staged = resolve(dest, PUBLIC_PAGE);

try {
  await access(staged);
} catch {
  console.error(`Nothing at ${staged}.`);
  console.error(`apps/deliberation/vite.config.ts declares ${PUBLIC_PAGE} as a build input; if that`);
  console.error(`entry was removed then /r/:caseId/:token has no page and the server will 404 it.`);
  process.exit(1);
}

const source = await readFile(staged, "utf8");

/* MATCHED ON `="/assets/` RATHER THAN ON EVERY ROOT-ABSOLUTE URL, and the narrowness is
   load-bearing. `public.html` carries a long comment about why it has no <base> tag, and
   that comment contains the literal `href="/"` twice - a blanket rewrite of root-absolute
   hrefs would edit prose inside an HTML comment. This matches only what `renderBuiltUrl`
   emits, which is `/` followed by Vite's assetsDir (default `assets`, and this build does
   not change it). If that ever stops matching, the count below fails the build rather than
   quietly staging a page whose scripts do not resolve. */
const PREFIX = `="/${subpath}/assets/`;
const rewritten = source.replaceAll(`="/assets/`, PREFIX);
const count = rewritten.split(PREFIX).length - 1;

if (count === 0) {
  console.error(`${PUBLIC_PAGE} names no root-absolute asset, so there was nothing to point at ${subpath}/.`);
  console.error(`Expected at least one \`="/assets/..."\` from renderBuiltUrl in apps/deliberation/vite.config.ts.`);
  console.error(`Either that override is gone - in which case /r/:caseId/:token serves a blank page - or`);
  console.error(`Vite's assetsDir changed and this pattern has to follow it.`);
  process.exit(1);
}

/* Each REWRITTEN reference, resolved as the browser will resolve it: root-absolute against
   the served directory. A missing one here is the blank page, caught before it ships.

   Scoped to the prefix this script just wrote rather than to every root-absolute URL in the
   document, for the same reason the rewrite itself is: the no-<base> comment contains a bare
   `href="/"`, and a checker that read prose out of an HTML comment would either pass by
   accident (that one resolves to the root directory) or fail a build over a sentence.

   Split on the literal prefix rather than matched by a regex built from it: `subpath` comes
   from a URL and may hold a `.` or a `+`, which in a pattern mean something other than
   themselves. */
const missing = [];
for (const tail of rewritten.split(PREFIX).slice(1)) {
  const ref = `/${subpath}/assets/${tail.slice(0, tail.indexOf(`"`))}`;
  try {
    await access(resolve(root, `.${ref}`));
  } catch {
    missing.push(ref);
  }
}
if (missing.length > 0) {
  console.error(`${PUBLIC_PAGE} references ${String(missing.length)} file(s) the built site does not have:`);
  for (const ref of missing) console.error(`  ${ref}`);
  console.error(`Served as-is this is a 200 with a blank body - the one failure no status code reports.`);
  process.exit(1);
}

// Both copies rewritten: the one at the root is what the server answers a share link
// with, and leaving the staged one behind unfixed would leave a document in the build
// that renders blank to anyone who found it.
await writeFile(staged, rewritten);
await writeFile(resolve(root, PUBLIC_PAGE), rewritten);

console.log(`public  ${PUBLIC_PAGE} -> apps/landing/dist/${PUBLIC_PAGE}, ${String(count)} asset ref(s) pointed at /${subpath}/`);
console.log(`        this is what /r/:caseId/:token is served with. All references resolved.`);
console.log(`NOTE    this client needs /api on the same origin. Static alone is a page that cannot load a case.`);
