import type { ReactElement } from "react";
import { initials } from "./Layout.js";

/**
 * One badge for one account, used everywhere a person is named. One component is
 * what makes a seat colour learnable: a reviewer who looks different on the roster
 * and on the rail is two people as far as the reader is concerned.
 *
 * THREE CHANNELS, ANY TWO SUFFICIENT. Roughly one man in twelve cannot use the
 * colour, so initials carry the identity literally, colour carries fast scanning,
 * and seat order - which every list of reviewers in the app sorts by - carries it
 * at sizes where two letters of type do not fit.
 */
export function Reviewer({ name, seat, disambiguate = false }: {
  name: string;
  /** Null when the case has more participants than seats; renders neutral. */
  seat: number | null;
  /** Set when another participant on this case has the same initials. */
  disambiguate?: boolean;
}): ReactElement {
  const label = disambiguate && seat !== null
    ? `${initials(name)}·${seat}`
    : initials(name);
  return (
    <span className={`avatar ${seat === null ? "seat-none" : `seat-${seat}`}`}
      title={name} aria-label={name}>
      {label}
    </span>
  );
}

/** The initials that more than one name on the case produces. */
export function collidingInitials(names: string[]): Set<string> {
  const seen = new Map<string, number>();
  for (const n of names) {
    const i = initials(n);
    seen.set(i, (seen.get(i) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([i]) => i));
}
