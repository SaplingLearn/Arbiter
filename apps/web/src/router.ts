export const TAB_IDS = ["compounds", "case", "ruleset", "validation", "record"] as const;
export type TabId = (typeof TAB_IDS)[number];

/**
 * Hash routing, not history routing.
 *
 * The static build is opened from index.html over file://, where a history
 * router cannot work - there is no server to rewrite paths. Unrecognised
 * fragments fall back to the case tab rather than rendering nothing, because a
 * blank screen mid-presentation is the worst possible failure.
 */
export function parseHash(hash: string): TabId {
  const raw = hash.replace(/^#\/?/, "").split(/[?/]/)[0] ?? "";
  return (TAB_IDS as readonly string[]).includes(raw) ? (raw as TabId) : "case";
}
