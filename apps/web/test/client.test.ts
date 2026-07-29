import { afterEach, describe, expect, it, vi } from "vitest";

type Client = typeof import("../src/ai/client.js");

/**
 * `liveEnabled` is a module-level const evaluated once at import, which is the
 * point: Vite replaces import.meta.env statically, so on the static build the
 * expression folds to false rather than becoming a branch nobody took. Every case
 * below therefore resets the module registry and re-imports instead of
 * reassigning anything.
 */
async function loadClient(flag: string | undefined, protocol: string): Promise<Client> {
  vi.stubEnv("VITE_ARBITER_LIVE", flag);
  vi.stubGlobal("location", { protocol, href: `${protocol}//host/index.html` });
  vi.resetModules();
  return import("../src/ai/client.js");
}

/**
 * The slice of fetch's init this module actually sets. Spelled out rather than
 * reaching for the DOM lib's RequestInit, which is a type-only interface and not
 * a runtime global, so eslint's no-undef does not recognise it.
 */
interface FetchInit { method?: string; body?: string; signal?: AbortSignal }

/** A fetch that resolves to a body, so the null-returning cases below can fail. */
function stubFetch(impl: (path: string, init: FetchInit) => Promise<unknown>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("liveEnabled - two independent gates (spec section 2)", () => {
  it("is TRUE only when the build flag is 1 and the page is not on file://", async () => {
    // Without this case every gate test below would pass on a client that hard-
    // coded false, and the live rung would be dead code nobody noticed.
    const c = await loadClient("1", "http:");
    expect(c.liveEnabled).toBe(true);
  });

  it("is false when the build flag is absent, even over http", async () => {
    // Gate 1 alone. This is the state the submitted ZIP is compiled in.
    const c = await loadClient(undefined, "http:");
    expect(c.liveEnabled).toBe(false);
  });

  it("is false when the build flag is any value other than 1", async () => {
    const c = await loadClient("true", "https:");
    expect(c.liveEnabled).toBe(false);
  });

  it("is FALSE over file:// even when the build flag is on", async () => {
    // Gate 2 alone, and the single most important assertion in this task.
    // static-file.spec.ts collects page.on("request") as well as requestfailed and
    // asserts both are empty, so a ZIP built from the wrong config must not even
    // ATTEMPT the call. A false positive here breaks the submitted artifact.
    const c = await loadClient("1", "file:");
    expect(c.liveEnabled).toBe(false);
  });

  it("is false when both gates are shut", async () => {
    const c = await loadClient(undefined, "file:");
    expect(c.liveEnabled).toBe(false);
  });
});

describe("postJson - a miss, never a throw (spec sections 3 and 11)", () => {
  it("returns the parsed value when the service answers well", async () => {
    // The case that makes every "returns null" test below able to fail.
    const c = await loadClient("1", "http:");
    const spy = stubFetch(async () => ok({ shape: "right" }));
    const parse = (u: unknown) => ((u as { shape?: string }).shape === "right" ? "PARSED" : null);

    await expect(c.postJson("/api/interpret", { challenge: "x" }, parse)).resolves.toBe("PARSED");
    expect(spy).toHaveBeenCalledTimes(1);
    const [path, init] = spy.mock.calls[0]!;
    expect(path).toBe("/api/interpret");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ challenge: "x" }));
  });

  it("does not call fetch AT ALL when liveEnabled is false", async () => {
    // Not "survives the failure" - never attempts it. Surviving a failed request
    // still fails static-file.spec.ts.
    const c = await loadClient("1", "file:");
    const spy = stubFetch(async () => ok({ shape: "right" }));

    await expect(c.postJson("/api/interpret", {}, () => "PARSED")).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null when the network rejects", async () => {
    // Spec section 11, network-off.
    const c = await loadClient("1", "http:");
    stubFetch(async () => { throw new TypeError("Failed to fetch"); });
    await expect(c.postJson("/api/interpret", {}, () => "PARSED")).resolves.toBeNull();
  });

  it("returns null on a non-2xx status", async () => {
    // Spec section 11, HTTP 500.
    const c = await loadClient("1", "http:");
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({ shape: "right" }) }));
    await expect(c.postJson("/api/interpret", {}, () => "PARSED")).resolves.toBeNull();
  });

  it("returns null on the 503 no_key a keyless service returns", async () => {
    // Spec section 11, missing key. Identical to a timeout from the caller's side,
    // which is the whole point of the invariant.
    const c = await loadClient("1", "http:");
    stubFetch(async () => ({ ok: false, status: 503, json: async () => ({ error: "no_key" }) }));
    await expect(c.postJson("/api/interpret", {}, () => "PARSED")).resolves.toBeNull();
  });

  it("returns null when the body will not parse as JSON", async () => {
    // Spec section 11, malformed JSON.
    const c = await loadClient("1", "http:");
    stubFetch(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } }));
    await expect(c.postJson("/api/interpret", {}, () => "PARSED")).resolves.toBeNull();
  });

  it("returns null when the body parses but the caller's parse REJECTS it", async () => {
    // A 200 carrying well-formed JSON of the wrong shape. Spec section 11 singles this
    // out: malformed JSON fails loudly and this does not, so it is the case that
    // would otherwise reach the confirm panel.
    const c = await loadClient("1", "http:");
    stubFetch(async () => ok({ totally: "wrong" }));
    const parse = (u: unknown) => ((u as { shape?: string }).shape === "right" ? "PARSED" : null);
    await expect(c.postJson("/api/interpret", {}, parse)).resolves.toBeNull();
  });

  it("returns null when the caller's parse THROWS, as zod's .parse does", async () => {
    const c = await loadClient("1", "http:");
    stubFetch(async () => ok({ totally: "wrong" }));
    const parse = () => { throw new Error("Invalid literal"); };
    await expect(c.postJson("/api/interpret", {}, parse)).resolves.toBeNull();
  });

  it("aborts at LIVE_TIMEOUT_MS and returns null", async () => {
    // Spec section 11, timeout. Driven on fake timers rather than by waiting 2.5s.
    const c = await loadClient("1", "http:");
    expect(c.LIVE_TIMEOUT_MS).toBe(2500);

    stubFetch((_path, init) => new Promise((_res, rej) => {
      init.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")));
    }));

    vi.useFakeTimers();
    const pending = c.postJson("/api/interpret", {}, () => "PARSED");
    await vi.advanceTimersByTimeAsync(2500);
    await expect(pending).resolves.toBeNull();
  });
});
