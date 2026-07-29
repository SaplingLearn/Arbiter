import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve, type Rung } from "../src/ai/resolve.js";
import { ANCHORS, isKnownAnchor } from "../src/ai/anchors.js";
import { loadData } from "../src/data/load.js";

const data = loadData();

/**
 * Master spec §11's fifteen-cell matrix, collapsed by the §3 invariant.
 *
 * The conditions differ only at the transport boundary; above it every failure is
 * the same event - a rung-1 miss. So the matrix is one thorough walker suite, five
 * transport tests (plus a sixth proving the collapse itself is legitimate), and
 * three per-surface tests under a forced rung-1 miss, rather than fifteen
 * near-identical ones.
 *
 * THREE TRAPS, written down because HANDOVER §5.1 exists precisely because they
 * recur:
 *
 *   1. Asserting "the ladder produced an answer" PASSES ON EVERY RUNG and is
 *      worthless. Every assertion below is on `rung`.
 *   2. Asserting `noMatch` for an empty anchor list asserts a value that is 0 under
 *      every implementation. The navigator test asserts the specific ids that
 *      survived filtering.
 *   3. The file:// test asserts on ATTEMPTED requests, not failed ones. That one is
 *      apps/web/e2e/ai-static.spec.ts, copying the pattern static-file.spec.ts
 *      already uses.
 *
 * Master spec §11 also explicitly excludes LLM content quality from testing. Only
 * schema validity and failure behaviour are testable here, and pretending otherwise
 * would be dishonest.
 */

async function loadClient() {
  // liveEnabled is computed once at module load from import.meta.env and
  // location.protocol, so the flag has to be set before evaluation.
  vi.resetModules();
  vi.stubEnv("VITE_ARBITER_LIVE", "1");
  return import("../src/ai/client.js");
}

const parseAnything = (u: unknown): { ok: true } | null =>
  typeof u === "object" && u !== null ? { ok: true } : null;

/**
 * The slice of fetch's init this file actually reads. Spelled out rather than
 * reaching for the DOM lib's RequestInit, which is a type-only interface and not a
 * runtime global, so eslint's no-undef does not recognise it - the same convention
 * apps/web/test/client.test.ts and apps/web/test/rung1.test.ts already use for the
 * same reason.
 */
interface FetchInit { signal?: AbortSignal }

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the ladder walker", () => {
  const hit = (v: string): Rung<string, string> => ({ source: "cache", run: async () => v });
  const miss = (): Rung<string, string> => ({ source: "live", run: async () => null });

  it("descends past a missing rung and reports the rung that ANSWERED", async () => {
    // Not "an answer appeared" - trap 1. The value is identical whichever rung
    // produced it, so `rung` is the only thing that distinguishes them.
    const r = await resolve([miss(), miss(), hit("third")], "q");
    expect(r.rung).toBe(3);
    expect(r.value).toBe("third");
  });

  it("carries the SOURCE of the rung that answered, not of the last one tried", async () => {
    const r = await resolve([miss(), { source: "local", run: async () => "x" }], "q");
    expect(r.source).toBe("local");
    expect(r.rung).toBe(2);
  });

  it("STOPS at the first hit - a later rung is never run", async () => {
    // Without this, a walker that ran every rung and kept the first result would
    // pass every other test here while costing a live call on the cache path.
    const later = vi.fn(async () => "never");
    await resolve([hit("first"), { source: "none", run: later }], "q");
    expect(later).not.toHaveBeenCalled();
  });

  it("passes the SAME input to each rung it tries", async () => {
    const seen: string[] = [];
    await resolve([
      { source: "live", run: async (i: string) => { seen.push(i); return null; } },
      { source: "cache", run: async (i: string) => { seen.push(i); return "x"; } },
    ], "the challenge");
    expect(seen).toEqual(["the challenge", "the challenge"]);
  });

  it("reports the LAST rung tried when every rung misses, with a null value", async () => {
    const r = await resolve([miss(), miss(), miss()], "q");
    expect(r.value).toBeNull();
    expect(r.rung).toBe(3);
  });

  it("is 1-BASED, so rung 1 is the live rung and not the second one", async () => {
    // An off-by-one here would silently relabel every source in the pre-flight
    // panel and every assertion in this file.
    const r = await resolve([hit("first")], "q");
    expect(r.rung).toBe(1);
  });
});

describe("the five §11 transport conditions, each a rung-1 miss", () => {
  it("network-off: fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { postJson } = await loadClient();
    await expect(postJson("/api/interpret", {}, parseAnything)).resolves.toBeNull();
  });

  it("HTTP 500: a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const { postJson } = await loadClient();
    await expect(postJson("/api/interpret", {}, parseAnything)).resolves.toBeNull();
  });

  it("malformed JSON: the body parse throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("{ not json", { status: 200, headers: { "content-type": "application/json" } })));
    const { postJson } = await loadClient();
    await expect(postJson("/api/interpret", {}, parseAnything)).resolves.toBeNull();
  });

  it("timeout: the 2.5s AbortController fires", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u: string, init: FetchInit) =>
      new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener("abort", () =>
          rej(new DOMException("The operation was aborted.", "AbortError")));
      })));

    const { postJson, LIVE_TIMEOUT_MS } = await loadClient();
    const pending = postJson("/api/interpret", {}, parseAnything);
    // Advancing to exactly the budget and no further: a test that advanced by an
    // hour would pass on a 60s timeout too.
    await vi.advanceTimersByTimeAsync(LIVE_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
  });

  it("missing key: 503 {\"error\":\"no_key\"}", async () => {
    // The condition the service produces when it comes up without a key (spec §10).
    // It must be indistinguishable from a timeout to the caller.
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "no_key" }), {
        status: 503, headers: { "content-type": "application/json" },
      })));
    const { postJson } = await loadClient();
    await expect(postJson("/api/interpret", {}, parseAnything)).resolves.toBeNull();
  });

  it("none of the five THROWS - rung 1 never errors upward", async () => {
    // The §3 invariant stated directly. Every test above would still pass if
    // postJson rejected and something upstream swallowed it; this is what makes
    // the collapse from fifteen tests to five legitimate.
    const conditions: (() => Promise<Response>)[] = [
      async () => { throw new TypeError("Failed to fetch"); },
      async () => new Response("boom", { status: 500 }),
      async () => new Response("{ not json", { status: 200 }),
      async () => new Response(JSON.stringify({ error: "no_key" }), { status: 503 }),
      async () => new Response(JSON.stringify({ wrong: "shape" }), { status: 200 }),
    ];
    for (const condition of conditions) {
      vi.stubGlobal("fetch", vi.fn(condition));
      const { postJson } = await loadClient();
      const settled = await Promise.allSettled([postJson("/api/interpret", {}, parseAnything)]);
      expect(settled[0]!.status).toBe("fulfilled");
    }
  });
});

describe("each surface degrades to the CORRECT rung under a forced rung-1 miss", () => {
  // liveEnabled is false in this describe: no VITE_ARBITER_LIVE, so postJson
  // returns null without attempting a request. That IS the network-off condition,
  // and it is also the shape of the submitted ZIP.
  it("Surface 1 answers from the authored cache at rung 2 on an exact challenge", async () => {
    const { interpret } = await import("../src/ai/interpret.js");
    // interpretations.json is `{ entries: [...] }`, not a bare array - interpret.ts
    // reads it the same way via `CACHE.entries.flatMap(...)`.
    const cache = (await import("../src/ai/cache/interpretations.json")).default as
      { entries: { challenge: string }[] };
    const authored = cache.entries[0]!.challenge;

    const r = await interpret({
      challenge: authored,
      rules: data.ruleset.rules.map((x) => ({ id: x.id, enabled: x.enabled, strength: x.strength })),
      claims: [],
    });

    expect(r.rung).toBe(2);
    expect(r.source).toBe("cache");
    expect(r.value).not.toBeNull();
  });

  it("Surface 1 descends to the rule picker at rung 5 on text nothing matches", async () => {
    const { interpret } = await import("../src/ai/interpret.js");
    // Deliberately unlike any authored challenge and containing none of rung 4's
    // keywords, so it has to fall all the way through.
    const r = await interpret({
      challenge: "zzzz qqqq wwww",
      rules: data.ruleset.rules.map((x) => ({ id: x.id, enabled: x.enabled, strength: x.strength })),
      claims: [],
    });

    expect(r.rung).toBe(5);
    expect(r.source).toBe("none");
    // Rung 5 never carries a value - it has no proposal to offer, only a picker the
    // USER answers (resolve.ts's exhaustion branch, already pinned in
    // interpret.test.ts). What §11 asks the matrix to prove is that the surface
    // still renders something usable, and that comes from rung 5 being REACHED - a
    // real declared rung with source "none" - rather than from a value here.
    expect(r.value).toBeNull();
  });

  it("Surface 3 answers at rung 2 and returns THE SPECIFIC surviving anchor ids", async () => {
    // Trap 2: `noMatch` on an empty list is 0 under every implementation, and
    // `anchorIds.length > 0` is barely better. Assert which ids survived.
    // anchor-map.json is an array of {question, anchorIds} entries, matching the
    // CachedEntry[] shape navigate.ts reads it as - not a Record.
    const { navigate } = await import("../src/ai/navigate.js");
    const map = (await import("../src/ai/cache/anchor-map.json")).default as
      { question: string; anchorIds: string[] }[];
    const { question, anchorIds: expected } = map[0]!;

    const r = await navigate({
      question,
      anchors: Object.entries(ANCHORS).map(([id, a]) => ({ id, label: a.label })),
    });

    expect(r.rung).toBe(2);
    expect(r.source).toBe("cache");
    expect(r.value?.anchorIds).toEqual(expected.filter(isKnownAnchor));
    // And every id it returned is real. A cached map entry naming a renamed anchor
    // would otherwise scroll to nothing and look like a UI bug.
    expect(expected.every(isKnownAnchor)).toBe(true);
  });
});
