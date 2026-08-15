/**
 * Destinations outside the product.
 *
 * There is exactly one, and it earns a file because it is the counterpart to
 * `apps/landing/src/links.ts` — that page holds `APP_URL` pointing in here, and this
 * holds the way back out. Written inline in a footer, the pair drifts apart the first
 * time a deployment moves either surface.
 */

/**
 * The public site: apps/landing.
 *
 * The origin root, because `npm run dev` (tools/dev-all.mjs) and any deployment that
 * serves the two together front everything with the landing page and mount the product
 * beneath it. `VITE_SITE_URL` overrides it for an arrangement that puts the site
 * elsewhere, matching the override the landing page already offers for the product.
 *
 * THIS IS WHERE THE METHOD ARGUMENT LIVES NOW. The product used to carry a Method page
 * explaining what the record proves and what it does not; the landing page makes that
 * case at length, and two copies of one argument is one copy too many to keep honest.
 */
export const SITE_URL: string = import.meta.env["VITE_SITE_URL"] ?? "/";
