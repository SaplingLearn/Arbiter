import { describe, expect, it } from "vitest";
import { responseSchemaFor } from "../gemini.js";
import { adjudicationSchema } from "../adjudicate.js";

/**
 * The two hosts do not accept the same response schema, and until 2026-08-16 this
 * project assumed they did.
 *
 * Every AI surface here - adjudicate, ask, interpret, extract, navigate - writes
 * `additionalProperties: false` into its schema, because that is what stops a model
 * inventing a field. Vertex accepts it. The Developer API's `response_schema` is a
 * proto with no such field, so the whole request is rejected before any model is
 * chosen:
 *
 *   400  Invalid JSON payload received. Unknown name "additionalProperties"
 *        at 'generation_config.response_schema'
 *
 * The failure was invisible for the worst possible reason: handleAdjudicate's catch
 * turns every upstream fault into a bare `502 upstream`, so a request that never
 * reached a model looked exactly like a model that failed. It was also
 * MODEL-INDEPENDENT - verified against gemini-3.5-flash, gemini-3.1-flash-lite and
 * gemini-flash-latest, all three 400 identically - which means no amount of changing
 * ARBITER_ADJUDICATION_MODEL could ever have fixed it.
 *
 * These tests make no network calls. What they hold is that the sanitising happens on
 * the host that needs it and NOWHERE ELSE, because `additionalProperties` is a real
 * constraint on Vertex and dropping it there would loosen every schema in the project
 * to buy nothing.
 */
describe("response schema per Gemini host", () => {
  const nested = {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: ["advance", "stop"] },
      cited: {
        type: "array",
        items: { type: "object", additionalProperties: false, properties: { id: { type: "string" } } },
      },
      either: {
        anyOf: [
          { type: "object", additionalProperties: false, properties: { a: { type: "string" } } },
          { type: "null" },
        ],
      },
    },
  };

  it("leaves the schema untouched on Vertex, where additionalProperties is honoured", () => {
    // The default host. The committed measurements came from here, so a schema that
    // silently loosened itself would change what those numbers describe.
    expect(responseSchemaFor(nested, { GEMINI_API_KEY: "AQ.test" })).toEqual(nested);
    expect(responseSchemaFor(nested, { ARBITER_GEMINI_HOST: "vertex" })).toEqual(nested);
  });

  it("drops additionalProperties at every depth on the Developer API", () => {
    const out = responseSchemaFor(nested, { ARBITER_GEMINI_HOST: "developer" });
    // Nested inside properties, inside array items, and inside an anyOf branch - the
    // three places this project's schemas actually put it. A top-level-only strip
    // passes a hand-written test and still 400s on the real adjudication schema.
    expect(JSON.stringify(out)).not.toContain("additionalProperties");
  });

  it("changes nothing else: every other keyword survives the strip", () => {
    const out = responseSchemaFor(nested, { ARBITER_GEMINI_HOST: "developer" }) as typeof nested;
    expect(out.type).toBe("object");
    expect(out.properties.verdict).toEqual({ type: "string", enum: ["advance", "stop"] });
    expect(out.properties.either.anyOf).toHaveLength(2);
    expect(out.properties.cited.items.properties).toEqual({ id: { type: "string" } });
  });

  it("does not mutate the caller's schema", () => {
    // adjudicationSchema() is rebuilt per request today, but a cached schema that lost
    // its constraints on the first Developer-API call would be a silent downgrade for
    // every later Vertex call in the same process.
    const before = JSON.stringify(nested);
    responseSchemaFor(nested, { ARBITER_GEMINI_HOST: "developer" });
    expect(JSON.stringify(nested)).toBe(before);
  });

  it("clears the real adjudication schema, which is what actually 400d", () => {
    const req = {
      compoundLabel: "TAK-994",
      context: "",
      rules: [{ id: "r1", name: "n", statement: "s", enabled: true, strength: 1 }],
      findings: [{ id: "f1", label: "l", assertion: "toxic" as const, detail: "d" }],
      absent: [{ field: "x", whatItBlocks: "y" }],
    };
    const raw = adjudicationSchema(req);
    expect(JSON.stringify(raw)).toContain("additionalProperties");
    expect(JSON.stringify(responseSchemaFor(raw, { ARBITER_GEMINI_HOST: "developer" })))
      .not.toContain("additionalProperties");
  });
});
