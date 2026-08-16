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

/**
 * How many seats app.css actually paints: `.avatar.seat-0` through `.avatar.seat-5`.
 *
 * Held HERE, in the client, rather than imported from services/api/seats.ts. It is
 * not the same fact: the server's SEAT_COUNT is how many seats it will ALLOCATE, and
 * this is how many the stylesheet has colours for. They agree today at six, and if
 * they ever disagree the honest outcome is the badge below - neutral, still legible,
 * still labelled - rather than a class with no rule behind it, which is what a seat
 * outside the palette used to render: an unstyled span with no border and no colour,
 * indistinguishable from a layout bug.
 */
const PALETTE_SEATS = 6;

export function Reviewer({ name, seat, disambiguate = false }: {
  name: string;
  /** Null when the case has more participants than seats; renders neutral. */
  seat: number | null;
  /** Set when another participant on this case has the same initials. */
  disambiguate?: boolean;
}): ReactElement {
  const painted = seat !== null && Number.isInteger(seat) && seat >= 0 && seat < PALETTE_SEATS;
  const label = disambiguate && seat !== null
    ? `${initials(name)}·${seat}`
    : initials(name);
  return (
    // No `title`. It duplicated `aria-label` exactly, and several screen readers
    // announce both - "Andres Lopez, Andres Lopez" - for a tooltip that adds nothing
    // the label does not already carry.
    <span className={`avatar ${painted ? `seat-${seat}` : "seat-none"}`}
      aria-label={name}>
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
