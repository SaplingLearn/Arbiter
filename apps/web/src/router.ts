export const TAB_IDS = ["about", "compounds", "case", "ruleset", "validation", "record"] as const;
export type TabId = (typeof TAB_IDS)[number];

/**
 * Hash routing, not history routing.
 *
 * The static build is opened from index.html over file://, where a history
 * router cannot work - there is no server to rewrite paths.
 *
 * Two different empty-ish inputs, two different answers, and the difference is
 * deliberate:
 *
 * - NO fragment at all ("", "#", "#/") is a first load - someone has just opened
 *   the artifact and has never seen it. That lands on `about`, which explains
 *   what the thing is.
 * - An UNRECOGNISED fragment ("#/nope", a mistyped or stale link) still falls
 *   back to `case`, for the reason the original comment gave: a blank screen
 *   mid-presentation is the worst possible failure. Landing a fat-fingered
 *   fragment on the landing page instead of the worked case would be the second
 *   worst, so the fallback stays pointed at the case.
 *
 * Nothing in the e2e suite depends on either default - every spec navigates to
 * an explicit fragment - so this decides only what a human sees.
 */
export function parseHash(hash: string): TabId {
  const raw = hash.replace(/^#\/?/, "").split(/[?/]/)[0] ?? "";
  if (raw === "") return "about";
  return (TAB_IDS as readonly string[]).includes(raw) ? (raw as TabId) : "case";
}
