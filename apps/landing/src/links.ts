/**
 * Every off-page destination, in one place.
 *
 * The page links out eleven times and ten of those go to the same repository. Written
 * inline they drift: one of them ends up on a branch that was deleted, and nothing
 * catches it because a 404 on a marketing page is not a test failure anywhere.
 */
/**
 * The product itself - apps/deliberation, and NOT apps/web.
 *
 * This pointed at apps/web, which is the wrong app to send a reader to. apps/web
 * is the seven-tab static artifact: no backend, no AI, no deliberation, built as
 * one inlined index.html because it is submitted as a file a judge opens from
 * disk. apps/deliberation is the redesign this project pivoted to on 2026-08-09
 * (spec 3.5, "a new app, not a conversion") - the four-stage case workflow
 * Evidence, Your position, Reveal & verdict, Record, against a real API with a
 * real adjudicator. Linking the page at the older one meant the landing copy
 * described the redesign and the button opened its predecessor.
 *
 * Both still exist and both are worth keeping. Only one of them is the product.
 *
 * `/app/` is the default because it is the arrangement spec 10 already assumes:
 * the client and the API on one origin, so /api resolves for the page served at
 * /app/. THAT ORIGIN IS NOT THIS STATIC HOST - apps/deliberation is a client for
 * a service and shows nothing without it, so a landing page deployed alone must
 * override this with VITE_APP_URL rather than rely on the default.
 * `.env.development` does exactly that, pointing at the dev server on 5174 whose
 * Vite proxy supplies /api.
 */
export const APP_URL: string = import.meta.env["VITE_APP_URL"] ?? "/app/";

const REPO = "https://github.com/SaplingLearn/Arbiter";

export const REPO_URL = REPO;
export const HANDOVER_URL = `${REPO}/blob/main/HANDOVER.md`;
export const README_URL = `${REPO}/blob/main/README.md`;
export const SPECS_URL = `${REPO}/tree/main/docs/superpowers`;
export const RESULTS_URL = `${REPO}/tree/main/results`;
export const RULESET_URL = `${REPO}/blob/main/rules/ruleset-v1.0.json`;
export const ENGINE_URL = `${REPO}/tree/main/packages/engine`;
export const WEB_URL = `${REPO}/tree/main/apps/web`;
export const HARNESS_URL = `${REPO}/tree/main/apps/harness`;

/**
 * Should this destination open in a new tab?
 *
 * NOT `href.startsWith("http")`, which is the obvious test and is wrong here for one
 * specific reason: `APP_URL` is configurable, and in development it is an absolute
 * `http://localhost:5174/`. Under the naive test the product — the single thing this
 * page exists to send people to — gets `target="_blank"` in dev and stays in the same
 * tab in production, so the most important link on the site behaves differently
 * depending on how it was configured. It also meant LOGIN opened a popup, which is how
 * this was found: the popup pointed at a dev server bound to IPv6 only and the click
 * read as doing nothing at all.
 *
 * The product is never external, whatever shape its URL takes. Everything else that
 * leaves this origin is.
 */
export function externalAttrs(
  href: string,
): { target: "_blank"; rel: "noreferrer" } | Record<string, never> {
  const leavesTheSite = href.startsWith("http") && href !== APP_URL;
  return leavesTheSite ? { target: "_blank", rel: "noreferrer" } : {};
}
