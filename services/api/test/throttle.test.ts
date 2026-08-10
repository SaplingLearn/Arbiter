import { describe, expect, it } from "vitest";
import { DECAY_MS, LoginThrottle, SPRAY_THRESHOLD, delayFor } from "../throttle.js";

const T0 = 1_000_000;
const ANN = "ann@lab.com";
const SRC = "127.0.0.1";

describe("delayFor", () => {
  it("lets real people mistype a few times for free", () => {
    for (const n of [0, 1, 2, 3]) expect(delayFor(n), `${n}`).toBe(0);
  });

  it("doubles from one second once the free attempts are gone", () => {
    expect(delayFor(4)).toBe(1000);
    expect(delayFor(5)).toBe(2000);
    expect(delayFor(6)).toBe(4000);
  });

  it("stops at five minutes, because unbounded backoff is a lockout by another name", () => {
    expect(delayFor(50)).toBe(5 * 60 * 1000);
    expect(delayFor(500)).toBe(5 * 60 * 1000);
  });
});

describe("LoginThrottle, per address", () => {
  it("allows the first attempt", () => {
    expect(new LoginThrottle().retryAfter(ANN, SRC, T0)).toBe(0);
  });

  it("starts delaying after the fourth failure", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < 3; i++) t.recordFailure(ANN, SRC, T0);
    expect(t.retryAfter(ANN, SRC, T0)).toBe(0);
    t.recordFailure(ANN, SRC, T0);
    expect(t.retryAfter(ANN, SRC, T0)).toBe(1000);
  });

  it("clears the moment somebody signs in successfully", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < 6; i++) t.recordFailure(ANN, SRC, T0);
    expect(t.retryAfter(ANN, SRC, T0)).toBeGreaterThan(0);
    t.recordSuccess(ANN);
    expect(t.retryAfter(ANN, SRC, T0)).toBe(0);
  });

  it("forgets failures after the decay window", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < 6; i++) t.recordFailure(ANN, SRC, T0);
    expect(t.retryAfter(ANN, SRC, T0 + DECAY_MS + 1)).toBe(0);
  });

  it("expires the block as the clock advances", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < 4; i++) t.recordFailure(ANN, SRC, T0);
    expect(t.retryAfter(ANN, SRC, T0)).toBe(1000);
    expect(t.retryAfter(ANN, SRC, T0 + 999)).toBe(1);
    expect(t.retryAfter(ANN, SRC, T0 + 1000)).toBe(0);
  });

  it("throttles one address across many sources", () => {
    // Per-source alone would let a botnet grind a single account at full speed.
    const t = new LoginThrottle();
    for (let i = 0; i < 6; i++) t.recordFailure(ANN, `10.0.0.${i}`, T0);
    expect(t.retryAfter(ANN, "10.0.0.99", T0)).toBeGreaterThan(0);
  });
});

describe("LoginThrottle, per source", () => {
  it("does NOT punish a shared address for one person's typos", () => {
    // The defect this rule was rewritten for. Behind any proxy - including the dev
    // server's own /api proxy - every user shares one source address, so counting raw
    // failures per source meant one mistyped password throttled the whole building.
    const t = new LoginThrottle();
    for (let i = 0; i < 10; i++) t.recordFailure(ANN, SRC, T0);
    expect(t.retryAfter("bystander@lab.com", SRC, T0)).toBe(0);
  });

  it("throttles a source spraying many distinct addresses", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < SPRAY_THRESHOLD + 6; i++) t.recordFailure(`user${i}@lab.com`, SRC, T0);
    expect(t.retryAfter("fresh@lab.com", SRC, T0)).toBeGreaterThan(0);
  });

  it("stays quiet up to the spray threshold", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < SPRAY_THRESHOLD; i++) t.recordFailure(`user${i}@lab.com`, SRC, T0);
    expect(t.retryAfter("fresh@lab.com", SRC, T0)).toBe(0);
  });

  it("counts distinct addresses, not attempts", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < 200; i++) t.recordFailure(ANN, SRC, T0);
    expect(t.addressesTriedBy(SRC, T0)).toBe(1);
    expect(t.retryAfter("someone.else@lab.com", SRC, T0)).toBe(0);
  });

  it("does not let one successful sign-in reset a spraying source", () => {
    // Otherwise: spray a hundred addresses, sign in to an account you already own,
    // and the counter is clear.
    const t = new LoginThrottle();
    for (let i = 0; i < SPRAY_THRESHOLD + 6; i++) t.recordFailure(`user${i}@lab.com`, SRC, T0);
    t.recordSuccess("attacker-own-account@lab.com");
    expect(t.retryAfter("fresh@lab.com", SRC, T0)).toBeGreaterThan(0);
  });

  it("leaves other sources alone", () => {
    const t = new LoginThrottle();
    for (let i = 0; i < SPRAY_THRESHOLD + 6; i++) t.recordFailure(`user${i}@lab.com`, SRC, T0);
    expect(t.retryAfter("fresh@lab.com", "10.1.1.1", T0)).toBe(0);
  });
});
