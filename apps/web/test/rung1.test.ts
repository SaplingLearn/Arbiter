import { afterEach, describe, expect, it, vi } from "vitest";
import { loadData } from "../src/data/load.js";
import { ANCHORS } from "../src/ai/anchors.js";

const data = loadData();

/**
 * The slice of fetch's init this file actually reads. Spelled out rather than
 * reaching for the DOM lib's RequestInit, which is a type-only interface and not
 * a runtime global, so eslint's no-undef does not recognise it - the same
 * convention apps/web/test/client.test.ts already uses for the same reason.
 */
interface FetchInit { body?: string }

/**
 * `liveEnabled` is computed once, at module load, from import.meta.env and
 * location.protocol. So a test that wants the live rung has to set the flag BEFORE
 * the module is evaluated - hence resetModules + a dynamic import rather than a
 * top-level one. Getting this wrong produces a test that silently exercises the
 * cache rung and passes no matter what rung 1 does.
 */
async function withLive<T>(fn: (mod: {
  interpret: typeof import("../src/ai/interpret.js")["interpret"];
  navigate: typeof import("../src/ai/navigate.js")["navigate"];
}) => Promise<T>): Promise<T> {
  vi.resetModules();
  vi.stubEnv("VITE_ARBITER_LIVE", "1");
  const interpretMod = await import("../src/ai/interpret.js");
  const navigateMod = await import("../src/ai/navigate.js");
  return fn({ interpret: interpretMod.interpret, navigate: navigateMod.navigate });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Surface 1 rung 1", () => {
  it("SENDS NO RAW EVIDENCE VALUE - ids and labels only", async () => {
    // Spec §5 and HANDOVER §3.3: the interpreter receives claim ids and labels and
    // never raw evidence values. Asserting "the body contains claims" would pass on
    // a body that shipped the whole claim objects, so this asserts the exact key set
    // AND that no value from the fixture claims appears anywhere in the serialised
    // body.
    let sent = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: FetchInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({
        targetRule: "R1", targetClaimId: null, action: "lower_strength",
        field: null, newValue: 0.2, paraphrase: "Lower R1", confidence: "high",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const claims = data.fixture.claims;
    await withLive(async ({ interpret }) => {
      await interpret({
        challenge: "The rat study should not carry this much weight",
        rules: data.ruleset.rules.map((r) => ({ id: r.id, enabled: r.enabled, strength: r.strength })),
        claims: claims.map((c) => ({ id: c.id, label: c.stream })),
      });
    });

    const body = JSON.parse(sent) as { claims: Record<string, unknown>[] };
    expect(body.claims.length).toBe(claims.length);
    for (const c of body.claims) expect(Object.keys(c).sort()).toEqual(["id", "label"]);

    // And nothing leaked by another route. Each of these is a real value on the
    // fixture claims; any of them appearing means a raw value crossed the wire.
    for (const c of claims) {
      expect(sent).not.toContain(c.provenance.source);
      if (c.measuresKeyEvent !== null) expect(sent).not.toContain(c.measuresKeyEvent);
    }
    expect(sent).not.toContain("klimisch");
    expect(sent).not.toContain("exposureRelevant");
    expect(sent).not.toContain("inApplicabilityDomain");
  });

  it("posts to the same-origin path, so no CORS is involved", async () => {
    let url = "";
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      url = u;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }));
    await withLive(async ({ interpret }) => {
      await interpret({ challenge: "x", rules: [], claims: [] });
    });
    // A relative path. An absolute one would be a cross-origin request and would
    // also mean the ZIP could be pointed at a live host by editing one string.
    expect(url).toBe("/api/interpret");
  });

  it("treats a WELL-FORMED 200 OF THE WRONG SHAPE as a rung-1 miss", async () => {
    // Spec §11, and the reason the response is schema-validated rather than parsed.
    // Malformed JSON fails loudly; THIS does not, and it is the case that would
    // otherwise reach the confirm panel with a proposal missing its action.
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ targetRule: "R1", paraphrase: "looks fine" }), {
        status: 200, headers: { "content-type": "application/json" },
      })));

    const res = await withLive(async ({ interpret }) =>
      interpret({ challenge: "The rat study should not carry this much weight", rules: [], claims: [] }));

    expect(res.rung).toBeGreaterThan(1);
    expect(res.source).not.toBe("live");
  });
});

describe("Surface 3 rung 1", () => {
  it("returns ids only and never prose", async () => {
    const anchorId = Object.keys(ANCHORS)[0]!;
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ anchorIds: [anchorId], noMatch: false }), {
        status: 200, headers: { "content-type": "application/json" },
      })));

    const res = await withLive(async ({ navigate }) =>
      navigate({
        question: "Which rule discounted the murine study?",
        anchors: Object.entries(ANCHORS).map(([id, a]) => ({ id, label: a.label })),
      }));

    expect(res.rung).toBe(1);
    expect(res.source).toBe("live");
    expect(res.value).toEqual({ anchorIds: [anchorId], noMatch: false });
  });

  it("REJECTS a response carrying prose, because the schema has no room for it", async () => {
    // The check that makes the previous test mean something: a 200 with an extra
    // `answer` field is exactly what "the model wrote prose" looks like on the wire.
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ anchorIds: [], noMatch: true, answer: "R3 discounted it." }), {
        status: 200, headers: { "content-type": "application/json" },
      })));

    const res = await withLive(async ({ navigate }) =>
      navigate({ question: "Which rule discounted the murine study?", anchors: [] }));

    expect(res.rung).toBeGreaterThan(1);
    expect(res.source).not.toBe("live");
  });
});
