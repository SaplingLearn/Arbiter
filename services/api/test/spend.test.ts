import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUDGET, ModelBudget, SOURCE_MULTIPLE, WINDOW_MS, budgetFrom,
} from "../spend.js";

const T0 = 1_000_000;
const ANN = "ann@lab.com";
const BEN = "ben@lab.com";
const SRC = "127.0.0.1";

describe("budgetFrom", () => {
  it("uses the default when nothing is set", () => {
    expect(budgetFrom({})).toBe(DEFAULT_BUDGET);
    expect(budgetFrom({ ARBITER_MODEL_BUDGET: "" })).toBe(DEFAULT_BUDGET);
  });

  it("takes a deployment's own number", () => {
    expect(budgetFrom({ ARBITER_MODEL_BUDGET: "5" })).toBe(5);
  });

  /**
   * The failure this exists to prevent: `Number("lots")` is NaN, and `NaN >= budget` is
   * FALSE - so a typo in a deployment's environment would not tighten the cap or loosen
   * it, it would remove it silently and the first sign would be the bill.
   */
  it("falls back rather than disabling itself on a malformed value", () => {
    for (const bad of ["lots", "-1", "0", "NaN", "Infinity"]) {
      expect(budgetFrom({ ARBITER_MODEL_BUDGET: bad }), bad).toBe(DEFAULT_BUDGET);
    }
  });
});

describe("ModelBudget, per account", () => {
  it("admits calls up to the budget and then holds them", () => {
    const b = new ModelBudget(3);
    for (let i = 0; i < 3; i++) {
      expect(b.retryAfter(ANN, SRC, T0), `call ${i}`).toBe(0);
      b.record(ANN, SRC, T0);
    }
    expect(b.retryAfter(ANN, SRC, T0)).toBeGreaterThan(0);
  });

  it("tells the caller how long to wait, not merely that they may not", () => {
    const b = new ModelBudget(1);
    b.record(ANN, SRC, T0);
    expect(b.retryAfter(ANN, SRC, T0 + 60_000)).toBe(WINDOW_MS - 60_000);
  });

  it("opens a fresh window once the old one has passed", () => {
    const b = new ModelBudget(1);
    b.record(ANN, SRC, T0);
    expect(b.retryAfter(ANN, SRC, T0 + WINDOW_MS)).toBe(0);
  });

  it("budgets each account separately", () => {
    const b = new ModelBudget(1);
    b.record(ANN, SRC, T0);
    expect(b.retryAfter(ANN, SRC, T0)).toBeGreaterThan(0);
    expect(b.retryAfter(BEN, SRC, T0)).toBe(0);
  });
});

describe("ModelBudget, per source", () => {
  /**
   * One host driving many accounts is what the per-account rule cannot see, and it is
   * what an abused deployment actually looks like.
   */
  it("catches a host spending through many accounts", () => {
    const b = new ModelBudget(2);
    const ceiling = 2 * SOURCE_MULTIPLE;
    for (let i = 0; i < ceiling; i++) b.record(`user${i}@lab.com`, SRC, T0);
    expect(b.retryAfter("fresh@lab.com", SRC, T0)).toBeGreaterThan(0);
  });

  it("leaves a shared egress alone below that", () => {
    const b = new ModelBudget(2);
    // A room of people each making one call. Well under the source ceiling.
    for (let i = 0; i < SOURCE_MULTIPLE; i++) b.record(`user${i}@lab.com`, SRC, T0);
    expect(b.retryAfter("fresh@lab.com", SRC, T0)).toBe(0);
  });

  it("does not let one source's spending block another", () => {
    const b = new ModelBudget(1);
    for (let i = 0; i < SOURCE_MULTIPLE; i++) b.record(`user${i}@lab.com`, SRC, T0);
    expect(b.retryAfter("fresh@lab.com", "10.0.0.9", T0)).toBe(0);
  });
});

describe("ModelBudget counts admissions, not successes", () => {
  it("charges a call that was let through", () => {
    const b = new ModelBudget(10);
    b.record(ANN, SRC, T0);
    b.record(ANN, SRC, T0);
    expect(b.spentBy(ANN, T0)).toBe(2);
  });

  it("forgets the spend once the window has rolled", () => {
    const b = new ModelBudget(10);
    b.record(ANN, SRC, T0);
    expect(b.spentBy(ANN, T0 + WINDOW_MS)).toBe(0);
  });
});
