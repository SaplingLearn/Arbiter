/**
 * A seat is a participant's identity on screen: it picks their colour, and the
 * colour is how a reveal screen reads as people rather than as heat.
 *
 * ALLOCATED, NOT DERIVED, and that is a correctness requirement rather than a
 * preference. The obvious cheap reading - "seat = index in participantIds" - is
 * broken, because that array is a sorted set: deliberation.ts sorts it on create
 * and on every add, and filters on remove. A reviewer joining with an id that
 * sorts early shifts everyone after them, so half the room would change colour
 * when the roster changed. That instability is the exact thing seats exist to
 * prevent.
 *
 * A removed participant KEEPS their entry. The seat stays taken so it is never
 * reissued, and their sealed marks keep the colour the room already learned.
 */
export const SEAT_COUNT = 6;

export type SeatMap = Record<string, number>;

export function allocateSeat(seats: SeatMap): number | null {
  const taken = new Set(Object.values(seats));
  for (let i = 0; i < SEAT_COUNT; i++) if (!taken.has(i)) return i;
  return null;
}

/** Returns the SAME object when nothing changes, so callers can compare by identity. */
export function withParticipant(seats: SeatMap, userId: string): SeatMap {
  if (userId in seats) return seats;
  const seat = allocateSeat(seats);
  if (seat === null) return seats;
  return { ...seats, [userId]: seat };
}

export function seatOf(seats: SeatMap, userId: string): number | null {
  return seats[userId] ?? null;
}
