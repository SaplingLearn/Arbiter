/**
 * Where "back to the landing page" goes, or whether it exists at all.
 *
 * THIS APP HAS TWO LIVES and the answer differs between them:
 *
 *  - Served next to apps/landing, it is the product that page's "Open The App"
 *    button leads to, and a one-way door is a bug: there was no way back except the
 *    browser's own Back button, which is invisible to anyone who arrived by typing
 *    the URL or opening a shared link.
 *  - Opened from the filesystem as the submitted artifact, there IS no landing page.
 *    A link to one would be a dead end, and dead chrome in a demo is worse than
 *    missing chrome.
 *
 * So it is decided at runtime from the protocol rather than baked in at build time:
 * one build works correctly in both lives, which matters because the ZIP and the
 * deployment come out of the same `npm run web:build`.
 *
 * VITE_LANDING_URL overrides it for a deployment that does not serve the two from
 * the same origin.
 */
export function landingHref(): string | null {
  const configured = import.meta.env["VITE_LANDING_URL"];
  if (typeof configured === "string" && configured !== "") return configured;
  // No server, no sibling page. The brand stays put and the explicit link is not
  // rendered at all.
  if (typeof window !== "undefined" && window.location.protocol === "file:") return null;
  return "/";
}
