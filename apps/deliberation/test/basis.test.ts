import { describe, expect, it } from "vitest";
import { basisOf } from "../src/basis.js";
import type { Position } from "../src/api.js";

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
});
