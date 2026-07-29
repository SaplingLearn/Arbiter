import { describe, expect, it, vi } from "vitest";
import { handleInterpret } from "../interpret.js";
import { handleNavigate } from "../navigate.js";

/**
 * These handlers are the ONLY place an API key exists in this system. Every test
 * here injects a fake `complete`, so the suite never constructs an SDK client and
 * never needs a key - which is also the reason the key is a constructor argument
 * rather than a module-level read.
 */

const REQUEST = {
  challenge: "The rat study should not carry this much weight",
  rules: [{ id: "R1", enabled: true, strength: 0.6 }],
  claims: [{ id: "TAK-994:invivo_rodent", label: "in vivo rodent, toxic" }],
};

const NAV_REQUEST = {
  question: "Which rule discounted the murine study?",
  anchors: [{ id: "rule.R1", label: "R1 - species relevance" }],
};

describe("POST /api/interpret", () => {
  it("returns 503 no_key when no key is configured, and never calls a model", async () => {
    // Spec §10: with no key the endpoint returns 503 {"error":"no_key"}, which the
    // client treats exactly like a timeout. A deploy that forgets the key must
    // degrade to the cache, not 500 into the confirm panel.
    const res = await handleInterpret(REQUEST, null);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "no_key" });
  });

  it("rejects a malformed request before it can cost a token", async () => {
    // The 400 branch has to exist and has to be reached WITHOUT calling the model:
    // a handler that forwards junk pays for it and then fails anyway.
    const complete = vi.fn();
    const res = await handleInterpret({ challenge: 42 }, complete);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad_request" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("constrains targetRule and targetClaimId to the ids the CLIENT sent", async () => {
    // The structural guarantee, mirroring Surface 3's ids-only return type: the
    // response schema is built from the request, so the model has nowhere to put a
    // rule or a claim that was not offered. Asserting the enums are non-empty would
    // pass under every implementation; assert the exact members.
    let captured: Record<string, unknown> | null = null;
    const complete = vi.fn(async (_s: string, _u: string, schema: Record<string, unknown>) => {
      captured = schema;
      return { targetRule: "R1", targetClaimId: null, action: "lower_strength",
               field: null, newValue: 0.2, paraphrase: "p", confidence: "high" };
    });

    const res = await handleInterpret(REQUEST, complete);
    expect(res.status).toBe(200);

    const props = (captured as unknown as { properties: Record<string, { anyOf: { enum?: string[] }[] }> }).properties;
    expect(props["targetRule"]!.anyOf[0]!.enum).toEqual(["R1"]);
    expect(props["targetClaimId"]!.anyOf[0]!.enum).toEqual(["TAK-994:invivo_rodent"]);
  });

  it("turns an upstream throw into 502 rather than propagating it", async () => {
    // A refusal, a rate limit and a network fault all land here. §3's invariant is
    // that rung 1 never errors upward, and this is where that starts.
    const complete = vi.fn(async () => { throw new Error("upstream exploded"); });
    const res = await handleInterpret(REQUEST, complete);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "upstream" });
  });
});

describe("POST /api/navigate", () => {
  it("constrains anchorIds to the anchors the CLIENT sent, and forbids prose", async () => {
    // Spec §7: ids only, never prose. `additionalProperties: false` plus a two-key
    // schema is what makes "structurally unable to hallucinate" literally true
    // rather than a claim about prompt wording.
    let captured: Record<string, unknown> | null = null;
    const complete = vi.fn(async (_s: string, _u: string, schema: Record<string, unknown>) => {
      captured = schema;
      return { anchorIds: ["rule.R1"], noMatch: false };
    });

    const res = await handleNavigate(NAV_REQUEST, complete);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ anchorIds: ["rule.R1"], noMatch: false });

    const schema = captured as unknown as {
      properties: { anchorIds: { items: { enum: string[] } } };
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.properties.anchorIds.items.enum).toEqual(["rule.R1"]);
    expect(schema.required).toEqual(["anchorIds", "noMatch"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("returns 503 no_key with no key configured", async () => {
    const res = await handleNavigate(NAV_REQUEST, null);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "no_key" });
  });
});
