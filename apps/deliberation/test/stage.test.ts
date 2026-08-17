import { describe, expect, it } from "vitest";
import { stageOf, STAGE_ORDER } from "../src/stage.js";
import type { CaseListing } from "../src/api.js";

/**
 * WHERE A CASE HAS GOT TO, named in the words the case's own tab strip uses.
 *
 * The dashboard used to print `c.status` straight onto the card - `open`, `locked`,
 * `adjudicated`, `signed`. Those are the state machine's names, chosen for
 * `deliberation.ts`'s guards, and three of the four say nothing to a reader about what
 * happens next: "locked" is the interesting one, because it does not mean the case is
 * finished, it means the panel is done and the verdict is waiting to be run.
 *
 * So the card now names the STAGE, from the same six-item vocabulary `Layout.tsx`'s
 * `Steps` puts inside the case. A reader who has been in a case recognises the words.
 */

const listing = (over: Partial<CaseListing> = {}): CaseListing => ({
  caseId: "c1",
  compoundLabel: "TAK-994",
  status: "open",
  isOwner: false,
  submitted: 0,
  of: 4,
  documents: 0,
  youSubmitted: false,
  ...over,
});

describe("naming the stage a case has reached", () => {
  it("asks a participant who has not answered for their position, and counts the room", () => {
    const s = stageOf(listing({ status: "open", submitted: 1, of: 4, youSubmitted: false }));
    expect(s.label).toBe("Your position");
    expect(s.pip).toBe("1/4");
  });

  /**
   * THE ONE THE OLD INFERENCE GOT WRONG. `submitted < of` is true here - three of four
   * have answered - and the reader is one of the three. The card used to say the case
   * needed their position, on the screen whose whole job is "what is waiting on me".
   */
  it("stops asking once the reader has answered, even with the room still out", () => {
    const s = stageOf(listing({ status: "open", submitted: 3, of: 4, youSubmitted: true }));
    expect(s.label).toBe("Awaiting the panel");
    expect(s.pip).toBe("3/4");
  });

  /** The convener holds no position, so there is nothing to ask them for. They are
   *  waiting on the room exactly as an answered participant is. */
  it("never asks the convener for a position", () => {
    const s = stageOf(listing({ status: "open", isOwner: true, submitted: 2, of: 4, youSubmitted: false }));
    expect(s.label).toBe("Awaiting the panel");
  });

  /**
   * `locked` is the status whose name misleads. The panel has finished and the reveal is
   * open; nothing is locked in the sense of closed. This is the stage a convener has to
   * act on, and the old badge was the least legible of the four.
   */
  it("calls a locked case the reveal, because that is what is now open", () => {
    expect(stageOf(listing({ status: "locked", submitted: 4, of: 4 })).label).toBe("Reveal & verdict");
  });

  it("calls an adjudicated case the record", () => {
    expect(stageOf(listing({ status: "adjudicated", submitted: 4, of: 4 })).label).toBe("Record");
  });

  it("calls a signed case the report, which is the thing it can now produce", () => {
    expect(stageOf(listing({ status: "signed", submitted: 4, of: 4 })).label).toBe("Report");
  });

  /**
   * NO PIP PAST THE REVEAL. "4/4 answered" beside a signed case is true and useless -
   * every case that got this far has everybody in, so the number carries no information
   * and competes with the label for the same glance. It earns its place only while the
   * count can still change.
   */
  it("drops the answered count once it can no longer change", () => {
    for (const status of ["locked", "adjudicated", "signed"]) {
      expect(stageOf(listing({ status, submitted: 4, of: 4 })).pip, status).toBeUndefined();
    }
  });

  it("keeps the count while the room is still answering", () => {
    expect(stageOf(listing({ status: "open", submitted: 0, of: 4 })).pip).toBe("0/4");
  });

  /**
   * EVIDENCE AND READ & MARK ARE NOT STAGES, and leaving them out is the point rather
   * than an omission. `Steps` enables both unconditionally - they are always open, at
   * every status - so no case is ever "at" them. Putting them on this scale would invent
   * a progression the state machine does not have, and a reader would reasonably infer
   * that a case tagged "Evidence" had not been read yet, which nothing here knows.
   */
  it("names no stage the case data cannot actually distinguish", () => {
    expect(STAGE_ORDER).not.toContain("Evidence");
    expect(STAGE_ORDER).not.toContain("Read & mark");
  });

  /** Every label the function can return is in the declared order, so a card can show
   *  position-in-sequence without a second table that drifts from this one. */
  it("only ever returns a label the declared order knows", () => {
    const cases = [
      listing({ status: "open", youSubmitted: false }),
      listing({ status: "open", youSubmitted: true }),
      listing({ status: "open", isOwner: true }),
      listing({ status: "locked" }),
      listing({ status: "adjudicated" }),
      listing({ status: "signed" }),
    ];
    for (const c of cases) {
      expect(STAGE_ORDER, `${c.status}/${String(c.youSubmitted)}`).toContain(stageOf(c).label);
    }
  });

  /**
   * A STATUS THIS CLIENT HAS NOT HEARD OF. `CaseListing.status` is a bare `string` on
   * the wire, so a server that grows a fifth status ships one to an older bundle. The
   * honest answer is the one that does not claim a stage: falling through to "Your
   * position" would tell a reader to go and answer something, and falling through to
   * "Report" would tell them it was finished.
   */
  it("says it does not know, rather than guessing, on an unrecognised status", () => {
    const s = stageOf(listing({ status: "escalated" }));
    expect(s.label).toBe("In progress");
    expect(STAGE_ORDER).toContain("In progress");
  });
});
