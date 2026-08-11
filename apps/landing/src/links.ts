/**
 * Every off-page destination, in one place.
 *
 * The page links out eleven times and ten of those go to the same repository. Written
 * inline they drift: one of them ends up on a branch that was deleted, and nothing
 * catches it because a 404 on a marketing page is not a test failure anywhere.
 */
/**
 * The product itself.
 *
 * apps/web is a SEPARATE Vite app - it has to be, because it is the artifact a
 * judge opens from the filesystem and it cannot share a bundle with a page that
 * loads webfonts. So the landing page cannot route into it; it can only link, and
 * where that link points depends on how the two are deployed next to each other.
 *
 * `/app/` is the default because it is the arrangement that needs no
 * configuration: serve apps/web/dist under /app/ beside this page and it works.
 * `.env.development` overrides it to the Vite dev server so `npm run landing:dev`
 * reaches a running product rather than a 404.
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
