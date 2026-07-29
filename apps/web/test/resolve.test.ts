import { describe, expect, it } from "vitest";
import { resolve, type Rung, type Source } from "../src/ai/resolve.js";

/** A rung that passes. Returning null is the pass signal (spec section 3). */
const miss = (source: Source): Rung<string, string> => ({ source, run: async () => null });
/** A rung that answers. */
const hit = (source: Source, value: string): Rung<string, string> => ({ source, run: async () => value });

describe("resolve - the shared ladder walker (spec section 3)", () => {
  it("stops at the first rung that returns a value and never runs the rungs below it", async () => {
    // Spec section 12, trap 1: asserting "the ladder produced an answer" passes on
    // every rung and is worthless. `rung` is the assertion that carries weight,
    // and `ran` proves the walker stopped rather than merely preferring rung 2.
    const ran: number[] = [];
    const r = await resolve<string, string>(
      [
        { source: "live", run: async () => { ran.push(1); return null; } },
        { source: "cache", run: async () => { ran.push(2); return "cached"; } },
        { source: "local", run: async () => { ran.push(3); return "local"; } },
      ],
      "q",
    );
    expect(r.value).toBe("cached");
    expect(r.rung).toBe(2);
    expect(r.source).toBe("cache");
    expect(ran).toEqual([1, 2]);
  });

  it("reports rung 1 when rung 1 answers, so a live answer is distinguishable from a cached one", async () => {
    // The pre-flight panel prints exactly this distinction (spec section 10).
    const r = await resolve([hit("live", "fresh"), hit("cache", "stale")], "q");
    expect(r.rung).toBe(1);
    expect(r.source).toBe("live");
    expect(r.value).toBe("fresh");
  });

  it("descends past every passing rung and reports the LAST rung tried, with source none", async () => {
    const r = await resolve([miss("live"), miss("cache"), miss("local"), miss("none")], "q");
    expect(r.value).toBeNull();
    // Four, not zero and not five: a presenter reading the pre-flight panel needs
    // the rung that was actually reached.
    expect(r.rung).toBe(4);
    expect(r.source).toBe("none");
  });

  it("carries the source declared by the rung that answered, not the ladder's first source", async () => {
    // A walker that reported the ladder's head would make every answer look live
    // on a served build - the precise claim spec section 10 forbids the panel to make.
    const r = await resolve([miss("live"), miss("cache"), hit("local", "keyword")], "q");
    expect(r.source).toBe("local");
    expect(r.rung).toBe(3);
  });

  it("hands the same input to every rung it tries", async () => {
    const seen: string[] = [];
    await resolve<string, string>(
      [
        { source: "live", run: async (i) => { seen.push(i); return null; } },
        { source: "cache", run: async (i) => { seen.push(i); return null; } },
        { source: "none", run: async (i) => { seen.push(i); return i.toUpperCase(); } },
      ],
      "the rat study",
    );
    expect(seen).toEqual(["the rat study", "the rat study", "the rat study"]);
  });

  it("lets a throw escape rather than quietly treating it as a miss", async () => {
    // Deliberate, and the reason is in resolve.ts. Rung 1 cannot throw - postJson
    // returns null for every transport failure - so a throw here is a bug in a
    // pure local rung. Swallowing it would silently degrade past a broken rung
    // while still reporting a plausible `rung`.
    const boom: Rung<string, string> = {
      source: "cache",
      run: async () => { throw new Error("cache is corrupt"); },
    };
    await expect(resolve([miss("live"), boom, hit("none", "picker")], "q")).rejects.toThrow(/cache is corrupt/);
  });

  it("returns rung 0 for an empty ladder rather than naming a rung that was never tried", async () => {
    const r = await resolve<string, string>([], "q");
    expect(r).toEqual({ value: null, rung: 0, source: "none" });
  });
});
