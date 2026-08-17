import { describe, expect, it } from "vitest";
import { basisOf } from "../src/basis.js";
import type { Position } from "../src/api.js";
import { positionBasis } from "../../../services/api/deliberation.js";

const position = (over: Partial<Position> = {}): Position => ({
  participantId: "u-a", call: "advance", reasoning: "Because.",
  citedFindingIds: [], external: [], submittedAt: "2026-08-16T09:00:00.000Z", ...over,
});

describe("basisOf", () => {
  it("calls a position cited when it rests on a finding in the case", () => {
    expect(basisOf(position({ citedFindingIds: ["TUR:exposure-margin"] }))).toBe("cited");
  });

  it("calls a position external when it rests only on a claim from outside", () => {
    expect(basisOf(position({ external: [{ claim: "Class experience." }] }))).toBe("external");
  });

  it("calls a position unsupported when it rests on nothing at all", () => {
    expect(basisOf(position())).toBe("unsupported");
  });

  it("prefers cited when a position has both a finding and an outside claim", () => {
    expect(basisOf(position({
      citedFindingIds: ["TUR:reversibility"],
      external: [{ claim: "Class experience." }],
    }))).toBe("cited");
  });

  /**
   * This duplicates `positionBasis` in `services/api/deliberation.ts` on purpose (see
   * `basis.ts`'s doc comment for why). A test that only re-asserted the four
   * input/output pairs would not catch the two implementations drifting apart - it
   * would just be wrong twice, identically. Asserting them against EACH OTHER is what
   * makes a future edit to either branch fail here instead of silently forking the
   * label a position gets depending on which side computed it.
   */
  it("agrees with the server's positionBasis on every case, because the two must not drift", () => {
    const cited = position({ citedFindingIds: ["TUR:exposure-margin"] });
    const external = position({ external: [{ claim: "Class experience." }] });
    const unsupported = position();
    const both = position({
      citedFindingIds: ["TUR:reversibility"],
      external: [{ claim: "Class experience." }],
    });

    for (const p of [cited, external, unsupported, both]) {
      expect(basisOf(p)).toBe(positionBasis(p));
    }
  });
});
