/**
 * Every off-page destination, in one place.
 *
 * The page links out eleven times and ten of those go to the same repository. Written
 * inline they drift: one of them ends up on a branch that was deleted, and nothing
 * catches it because a 404 on a marketing page is not a test failure anywhere.
 */
/**
 * The product itself: apps/deliberation.
 *
 * A SEPARATE Vite app rather than a route in this one, because it is a client for
 * a service and carries its own design system, its own auth state and its own API
 * proxy. So this page cannot route into it; it can only link.
 *
 * `/deliberation/` is a same-origin path, not a port, and that is the point.
 * `npm run dev` (tools/dev-all.mjs) fronts every surface with this app's dev
 * server, and any deployment that serves the two side by side mounts it at the
 * same path, so dev and production agree and no override is needed. There used to
 * be a `.env.development` here whose entire job was to paper over a port split
 * that no longer exists.
 *
 * VITE_APP_URL still overrides it, for a deployment that puts the app elsewhere.
 */
export const APP_URL: string = import.meta.env["VITE_APP_URL"] ?? "/deliberation/";

const REPO = "https://github.com/SaplingLearn/Arbiter";

export const REPO_URL = REPO;
export const HANDOVER_URL = `${REPO}/blob/main/HANDOVER.md`;
export const README_URL = `${REPO}/blob/main/README.md`;
export const SPECS_URL = `${REPO}/tree/main/docs/superpowers`;
export const RESULTS_URL = `${REPO}/tree/main/results`;
export const RULESET_URL = `${REPO}/blob/main/rules/ruleset-v1.0.json`;
export const ENGINE_URL = `${REPO}/tree/main/packages/engine`;
export const DELIBERATION_URL = `${REPO}/tree/main/apps/deliberation`;
export const HARNESS_URL = `${REPO}/tree/main/apps/harness`;

/**
 * Should this destination open in a new tab?
 *
 * NOT `href.startsWith("http")`, which is the obvious test and is wrong here for one
 * specific reason: `APP_URL` is configurable, and a deployment can still point it at
 * an absolute URL. Under the naive test the product — the single thing this page
 * exists to send people to — would get `target="_blank"` in that arrangement and stay
 * in the same tab in the default one, so the most important link on the site behaves
 * differently depending on how it was configured. It also meant LOGIN opened a popup,
 * which is how this was found: the popup pointed at a dev server bound to IPv6 only
 * and the click read as doing nothing at all.
 *
 * The same-origin `/deliberation/` default now makes that misfire rare rather than
 * routine, but the rule is unchanged and still worth stating: the product is never
 * external, whatever shape its URL takes. Everything else that leaves this origin is.
 */
export function externalAttrs(
  href: string,
): { target: "_blank"; rel: "noreferrer" } | Record<string, never> {
  const leavesTheSite = href.startsWith("http") && href !== APP_URL;
  return leavesTheSite ? { target: "_blank", rel: "noreferrer" } : {};
}
