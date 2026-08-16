import { describe, expect, it } from "vitest";
import { SEAT_COUNT, allocateSeat, seatOf, withParticipant, type SeatMap } from "../seats.js";

describe("seat allocation", () => {
  it("gives the first participant seat 0", () => {
    expect(withParticipant({}, "u_a")).toEqual({ u_a: 0 });
  });

  it("gives each new participant the lowest unused seat", () => {
    let s: SeatMap = {};
    s = withParticipant(s, "u_a");
    s = withParticipant(s, "u_b");
    s = withParticipant(s, "u_c");
    expect(s).toEqual({ u_a: 0, u_b: 1, u_c: 2 });
  });

  it("returns the same map when a participant is already seated", () => {
    const s = withParticipant({}, "u_a");
    expect(withParticipant(s, "u_a")).toBe(s);
  });

  // The point of seats. A departed reviewer keeps their entry so the seat stays
  // taken; their sealed marks must keep rendering in the colour the room learned.
  it("never reissues the seat of a removed participant", () => {
    let s: SeatMap = {};
    s = withParticipant(s, "u_a");
    s = withParticipant(s, "u_b");
    // u_a leaves. deliberation.ts does NOT delete the entry.
    s = withParticipant(s, "u_c");
    expect(s["u_c"]).toBe(2);
    expect(s["u_a"]).toBe(0);
  });

  it("hands out no seat past SEAT_COUNT", () => {
    let s: SeatMap = {};
    for (let i = 0; i < SEAT_COUNT; i++) s = withParticipant(s, `u_${i}`);
    const full = withParticipant(s, "u_seventh");
    expect(full["u_seventh"]).toBeUndefined();
    expect(allocateSeat(s)).toBeNull();
  });

  it("reports no seat for an unknown or unseated participant", () => {
    expect(seatOf({}, "u_a")).toBeNull();
    expect(seatOf({ u_a: 3 }, "u_a")).toBe(3);
  });
});
