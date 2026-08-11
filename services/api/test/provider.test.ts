import { describe, expect, it, vi, afterEach } from "vitest";
import { geminiComplete, resolveProvider } from "../provider.js";

/**
 * These tests never reach a network. `geminiComplete` is exercised against a stubbed
 * `fetch`, which is the only way to assert the thing that actually matters here:
 * that the schema the verifier trusts is the schema the model is given, byte for
 * byte. A translation layer between those two is where `verifyAdjudication` would
 * quietly start checking output against a contract nobody enforced.
 */

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["present"],
  properties: {
    present: { type: "boolean" },
    pathway: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
};

/**
 * Typed with fetch's parameters on purpose. `vi.fn(async () => ...)` infers a
 * zero-argument signature, so `mock.calls[0][1]` is a type error and the assertions
 * that read the request body cannot be written at all.
 */
function fetchSpy(reply: () => Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(reply()));
}

function geminiOk(body: unknown): Response {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(body) }] } }],
    }),
  } as unknown as Response;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("resolveProvider", () => {
  it("returns null with no key, so 'no key' stays a state rather than a boot failure", () => {
    expect(resolveProvider({})).toBeNull();
  });

  it("treats an empty key as no key", () => {
    expect(resolveProvider({ GEMINI_API_KEY: "" })).toBeNull();
    expect(resolveProvider({ ANTHROPIC_API_KEY: "" })).toBeNull();
  });

  it("selects gemini from GEMINI_API_KEY and names its default model", () => {
    const r = resolveProvider({ GEMINI_API_KEY: "k" });
    expect(r?.provider).toBe("gemini");
    expect(r?.model).toBe("gemini-3.6-flash");
  });

  it("selects anthropic from ANTHROPIC_API_KEY and names its default model", () => {
    const r = resolveProvider({ ANTHROPIC_API_KEY: "k" });
    expect(r?.provider).toBe("anthropic");
    expect(r?.model).toBe("claude-opus-5");
  });

  it("lets ARBITER_PROVIDER decide when both keys are present", () => {
    const env = { ANTHROPIC_API_KEY: "a", GEMINI_API_KEY: "g" };
    expect(resolveProvider({ ...env, ARBITER_PROVIDER: "gemini" })?.provider).toBe("gemini");
    expect(resolveProvider({ ...env, ARBITER_PROVIDER: "anthropic" })?.provider).toBe("anthropic");
  });

  it("returns null when ARBITER_PROVIDER names a provider whose key is absent, rather than silently using the other one", () => {
    // Silently falling through to the key that IS present would run a model the
    // operator did not ask for and record it as the one they did.
    expect(resolveProvider({ ANTHROPIC_API_KEY: "a", ARBITER_PROVIDER: "gemini" })).toBeNull();
  });

  it("honours ARBITER_MODEL over the built-in default", () => {
    expect(resolveProvider({ GEMINI_API_KEY: "k", ARBITER_MODEL: "gemini-3.5-flash" })?.model)
      .toBe("gemini-3.5-flash");
  });

  it("ignores an unrecognised ARBITER_PROVIDER rather than failing closed on a typo", () => {
    expect(resolveProvider({ GEMINI_API_KEY: "k", ARBITER_PROVIDER: "gemmini" })?.provider).toBe("gemini");
  });
});

describe("geminiComplete", () => {
  it("sends the caller's JSON Schema verbatim as responseJsonSchema", async () => {
    const fetchMock = fetchSpy(() => geminiOk({ present: true, pathway: null }));
    vi.stubGlobal("fetch", fetchMock);

    await geminiComplete("k", "gemini-3.6-flash")("sys", "usr", SCHEMA);

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    // Verbatim, not merely equivalent. This is the assertion that would fail the
    // day somebody introduces a schema translation step.
    expect(body.generationConfig.responseJsonSchema).toEqual(SCHEMA);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.contents[0].parts[0].text).toBe("usr");
  });

  it("pins temperature to 0, because spec 7.1 applies deterministic decoding BEFORE consistency is measured", async () => {
    const fetchMock = fetchSpy(() => geminiOk({ present: false }));
    vi.stubGlobal("fetch", fetchMock);

    await geminiComplete("k", "m")("s", "u", SCHEMA);

    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    // A flip rate measured at a temperature we chose is a property of that choice.
    expect(body.generationConfig.temperature).toBe(0);
  });

  it("puts the key in a header and never in the URL, where it would reach access logs", async () => {
    const fetchMock = fetchSpy(() => geminiOk({ present: true }));
    vi.stubGlobal("fetch", fetchMock);

    await geminiComplete("SECRET-KEY", "gemini-3.6-flash")("s", "u", SCHEMA);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("SECRET-KEY");
    expect((init!.headers as Record<string, string>)["x-goog-api-key"]).toBe("SECRET-KEY");
  });

  it("parses the model's JSON into the value the caller receives", async () => {
    vi.stubGlobal("fetch", fetchSpy(() => geminiOk({ present: true, pathway: "BSEP" })));
    const out = await geminiComplete("k", "m")("s", "u", SCHEMA);
    expect(out).toEqual({ present: true, pathway: "BSEP" });
  });

  it("throws 'truncated' on MAX_TOKENS instead of failing later as a parse error", async () => {
    // The failure this names is a budget problem. Left unnamed it surfaces as
    // invalid JSON and gets debugged as a schema defect.
    vi.stubGlobal("fetch", fetchSpy(() => ({
      ok: true,
      json: async () => ({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"pres' }] } }] }),
    } as unknown as Response)));

    await expect(geminiComplete("k", "m")("s", "u", SCHEMA)).rejects.toThrow("truncated");
  });

  it("throws 'refused' on a safety stop", async () => {
    vi.stubGlobal("fetch", fetchSpy(() => ({
      ok: true,
      json: async () => ({ candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] }),
    } as unknown as Response)));

    await expect(geminiComplete("k", "m")("s", "u", SCHEMA)).rejects.toThrow("refused");
  });

  it("reports the status on an HTTP error and never the body, which can echo the key back", async () => {
    vi.stubGlobal("fetch", fetchSpy(() => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "quota for key SECRET-KEY exceeded" } }),
    } as unknown as Response)));

    // The no-op sleep is injected because 429 is retryable; with the real backoff
    // this test would spend 30 seconds proving something about a string.
    await expect(geminiComplete("SECRET-KEY", "m", 4096, async () => {})("s", "u", SCHEMA))
      .rejects.toThrow("gemini_http_429");
  });

  it("retries a 503 and returns the answer the retry produced", async () => {
    let n = 0;
    const spy = fetchSpy(() => {
      n++;
      return n === 1
        ? ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response)
        : geminiOk({ present: true });
    });
    vi.stubGlobal("fetch", spy);

    const out = await geminiComplete("k", "m", 4096, async () => {})("s", "u", SCHEMA);
    expect(out).toEqual({ present: true });
    expect(n).toBe(2);
  });

  it("gives up after a bounded number of transport retries rather than sleeping through a daily quota", async () => {
    // A per-minute 429 clears; a per-day one does not, and a harness that keeps
    // waiting on it looks hung instead of reporting an exhausted quota.
    const spy = fetchSpy(() => ({ ok: false, status: 429, json: async () => ({}) } as unknown as Response));
    vi.stubGlobal("fetch", spy);

    await expect(geminiComplete("k", "m", 4096, async () => {})("s", "u", SCHEMA))
      .rejects.toThrow("gemini_http_429");
    expect(spy.mock.calls.length).toBe(4); // the first attempt plus three retries
  });

  it("does not retry a 400, which retrying cannot fix", async () => {
    const spy = fetchSpy(() => ({ ok: false, status: 400, json: async () => ({}) } as unknown as Response));
    vi.stubGlobal("fetch", spy);

    await expect(geminiComplete("k", "m", 4096, async () => {})("s", "u", SCHEMA))
      .rejects.toThrow("gemini_http_400");
    expect(spy.mock.calls.length).toBe(1);
  });

  it("never retries a response that ARRIVED, however bad its content", async () => {
    // The line this guards: retrying transport is asking again because nothing was
    // heard. Retrying a returned-but-unciteable adjudication would be re-rolling
    // until the model says something acceptable, which is what probe.ts forbids.
    const spy = fetchSpy(() => ({
      ok: true,
      json: async () => ({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] }),
    } as unknown as Response));
    vi.stubGlobal("fetch", spy);

    await expect(geminiComplete("k", "m", 4096, async () => {})("s", "u", SCHEMA)).rejects.toThrow("truncated");
    expect(spy.mock.calls.length).toBe(1);
  });

  it("throws rather than returning undefined when the response carries no candidate", async () => {
    vi.stubGlobal("fetch", fetchSpy(() => ({
      ok: true, json: async () => ({}),
    } as unknown as Response)));

    await expect(geminiComplete("k", "m")("s", "u", SCHEMA)).rejects.toThrow("no candidate");
  });
});
