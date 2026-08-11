import type { DeliberationCase } from "./deliberation.js";

/**
 * Who may do what to a case. Spec §9 - "per-case access control".
 *
 * SEPARATE FROM AUTHENTICATION ON PURPOSE. `auth.ts` answers *who is this*;
 * this answers *what may they touch*. Fusing them is how "is signed in" quietly
 * becomes "may read", and every case in the system becomes visible to every
 * account the moment somebody registers.
 *
 * PURE, SO IT CAN BE EXHAUSTIVELY TESTED. No store, no request, no clock - a
 * decision that depends only on a case and a user id can be enumerated in a test,
 * and an access rule you cannot enumerate is an access rule nobody has checked.
 *
 * DENY IS THE DEFAULT SHAPE. Every function returns false unless it finds a reason
 * to return true. A rule written the other way round fails open the day someone adds
 * a status the conditions do not mention.
 */

export type CaseAction =
  | "read"
  | "submit"
  | "reveal"
  | "adjudicate"
  | "sign";

export function isOwner(c: DeliberationCase, userId: string): boolean {
  return c.ownerId === userId;
}

export function isParticipant(c: DeliberationCase, userId: string): boolean {
  return c.participantIds.includes(userId);
}

/**
 * Reading a case means seeing the compound, the inventory and - after the reveal -
 * everyone's positions. Restricted to the people named on it.
 *
 * The owner is included because they convened it and must sign it. Note that reading
 * is NOT what protects blind submission: `visibleTo` does that, and it withholds
 * other people's positions from participants too. This is the coarser boundary,
 * keeping the case away from accounts that have nothing to do with it.
 */
export function canRead(c: DeliberationCase, userId: string): boolean {
  return isOwner(c, userId) || isParticipant(c, userId);
}

/**
 * The decision owner's actions: closing the case, running the adjudication, signing.
 *
 * The owner is not privileged in what they can SEE - `visibleTo` gives them exactly
 * what it gives everyone else while the case is open, because an owner who could read
 * positions early is the senior person in the room hearing every answer before
 * speaking. They are privileged only in what they can DO, which is the accountability
 * §6.7 is built around: a committee advises, one named individual signs.
 */
export function can(c: DeliberationCase, userId: string, action: CaseAction): boolean {
  switch (action) {
    case "read":
      return canRead(c, userId);
    case "submit":
      // Participants only. An owner who is not also a participant convenes and signs
      // but does not hold an opinion on the record - and `submitPosition` enforces
      // the same rule, so this is a second gate rather than the only one.
      return isParticipant(c, userId);
    case "reveal":
    case "adjudicate":
    case "sign":
      return isOwner(c, userId);
    default:
      return false;
  }
}

export interface AccessDenial {
  action: CaseAction;
  detail: string;
}

/** The message a denied caller sees. It names the action and the holder, and never
 *  reveals anything about the case itself - a 403 that leaks the compound label
 *  tells an unauthorised reader the one thing they were asking for. */
export function denial(c: DeliberationCase, userId: string, action: CaseAction): AccessDenial | null {
  if (can(c, userId, action)) return null;
  if (action === "read" || action === "submit") {
    return { action, detail: `You are not named on this case.` };
  }
  return { action, detail: `Only the decision owner can ${action} this case.` };
}

/** Cases this user may see, for a list screen. Sorted by id so the list is stable
 *  between requests rather than reflecting insertion order. */
export function visibleCases(cases: DeliberationCase[], userId: string): DeliberationCase[] {
  return cases
    .filter((c) => canRead(c, userId))
    .sort((a, b) => (a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0));
}
