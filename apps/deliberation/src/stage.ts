import type { CaseListing } from "./api.js";

/**
 * WHERE A CASE HAS GOT TO, in the words the case's own tab strip already uses.
 *
 * The dashboard printed `c.status` onto each card - `open`, `locked`, `adjudicated`,
 * `signed`. Those are the state machine's names, chosen for the guards in
 * `services/api/deliberation.ts`, and they are not written for a reader: `locked` is the
 * worst of them, because it does not mean the case is closed. It means the panel has
 * finished and the verdict is waiting for the convener to run it - the one status on the
 * list that is a call to action, wearing the one word that sounds like the opposite.
 *
 * So a card names the STAGE instead, drawn from the six-item vocabulary `Layout.tsx`'s
 * `Steps` puts inside a case. Somebody who has worked a case recognises the words, and
 * the dashboard stops speaking a second language about the same objects.
 *
 * WHY THIS IS NOT `Steps` ITSELF, and the difference is worth stating because the two
 * lists look like they should be one. `Steps` is NAVIGATION: six tabs, four of them
 * always enabled, and it answers "where can I go". This answers "where has this got to",
 * which is a smaller question with fewer possible answers. `Evidence` and `Read & mark`
 * appear in `Steps` and cannot appear here - they are open at every status, so no case is
 * ever *at* them. Tagging a card "Evidence" would invent a stage the data does not have,
 * and a reader would fairly infer the case had not been read, which nothing here knows.
 *
 * A PURE FUNCTION OVER THE LISTING, so every branch is testable without rendering a
 * card, and so `bucketOf` in `pages.tsx` can be defined in terms of it rather than
 * deriving the same facts from the same fields a second time. Those two disagreeing -
 * a card tagged "Your position" sitting under "In progress" - would be worse than
 * either being wrong alone, because each would look like evidence the other was right.
 */

/**
 * Every label `stageOf` can return, in the order a case passes through them.
 *
 * Exported so a caller can show position-in-sequence without a second table that drifts
 * from this one, and so a test can assert that nothing else is ever returned.
 *
 * `In progress` sits at the end deliberately: it is not a later stage than `Report`, it
 * is the absence of a known one. See the fall-through in `stageOf`.
 */
export const STAGE_ORDER = [
  "Your position",
  "Awaiting the panel",
  "Reveal & verdict",
  "Record",
  "Report",
  "In progress",
] as const;

export type StageLabel = typeof STAGE_ORDER[number];

export interface Stage {
  label: StageLabel;
  /** `answered/total`, and only while that number can still move. */
  pip?: string;
  /** Whether this stage is waiting on the READER rather than on somebody else. The card
   *  uses it to decide emphasis; it is not a claim about urgency. */
  yours: boolean;
}

export function stageOf(c: CaseListing): Stage {
  if (c.status === "open") {
    const count = `${String(c.submitted)}/${String(c.of)}`;
    /**
     * THE DISTINCTION THE OLD CARD COULD NOT MAKE. Inferring "needs your position" from
     * `submitted < of` is true of a case where three of four have answered whether or
     * not the reader is one of the three - so an answered participant was told, on the
     * screen built to answer "what is waiting on me", that a case was waiting on them.
     *
     * `youSubmitted` is on the listing for this. A convener never gets asked: they hold
     * no position at all rather than an unanswered one.
     */
    if (!c.isOwner && !c.youSubmitted) return { label: "Your position", pip: count, yours: true };
    return { label: "Awaiting the panel", pip: count, yours: false };
  }

  /**
   * NO PIP FROM HERE ON. Past the reveal every case has everybody in, so `4/4` carries
   * no information and competes with the label for the same glance. A number that is
   * always the same number is decoration.
   *
   * `yours` is the convener's from here too, and only theirs: locking, adjudicating and
   * signing are all owner-only in `access.ts`, so for a participant these stages are
   * genuinely somebody else's move.
   */
  if (c.status === "locked") return { label: "Reveal & verdict", yours: c.isOwner };
  if (c.status === "adjudicated") return { label: "Record", yours: c.isOwner };
  if (c.status === "signed") return { label: "Report", yours: false };

  /**
   * A STATUS THIS BUNDLE DOES NOT RECOGNISE, and the honest answer is to say so.
   *
   * `CaseListing.status` is a bare `string` over the wire, and a deployment serves a
   * cached bundle for as long as its `no-cache` index.html takes to revalidate - so a
   * server that grows a fifth status will hand one to a client built before it existed.
   * Both obvious fall-throughs are worse than admitting ignorance: landing on "Your
   * position" tells the reader to go and answer something that may not be open, and
   * landing on "Report" tells them a live case is finished.
   */
  return { label: "In progress", yours: false };
}
