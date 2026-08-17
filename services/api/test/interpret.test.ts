import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADJUDICATION_MODEL, DEFAULT_SHORT_MODEL, buildComplete,
  providerFor, resolveModel, SHAPE_ASK, SHAPE_INTERPRET, SHAPE_NAVIGATE,
  type CallKind,
} from "../interpret.js";

const KINDS: CallKind[] = ["short", "adjudication", "ask", "summary"];

describe("the model this project runs on", () => {
  it("resolves every call kind to Gemini when nothing is configured", () => {
    // Spec section 16 makes the provider a deployment decision, and this is the
    // decision: Vertex, because Anthropic models are a "generative AI partner model
    // offered as a managed API" and are therefore outside the Google Cloud credit
    // this project is deployed against.
    for (const kind of KINDS) {
      const model = resolveModel(kind, {});
      expect(model, kind).toMatch(/^gemini-/);
      expect(providerFor(model), kind).toBe("vertex");
    }
  });

  it("names Gemini in both defaults, so neither can drift alone", () => {
    expect(DEFAULT_SHORT_MODEL).toMatch(/^gemini-/);
    expect(DEFAULT_ADJUDICATION_MODEL).toMatch(/^gemini-/);
  });

  it("routes ask and summary to the adjudication model, not the short one", () => {
    // They read document prose and must decide when the passages do not answer the
    // question, which is nearer the adjudicator's job than a closed-set classification.
    expect(resolveModel("ask", {})).toBe(DEFAULT_ADJUDICATION_MODEL);
    expect(resolveModel("summary", {})).toBe(DEFAULT_ADJUDICATION_MODEL);
  });

  it("leaves the provider switch to the model name a person typed", () => {
    // Anthropic is reachable, and only deliberately: it takes naming a non-Gemini
    // model in an environment variable. No combination of settings drifts into it.
    expect(providerFor("claude-opus-5")).toBe("anthropic");
    expect(providerFor(resolveModel("ask", { ARBITER_ASK_MODEL: "claude-opus-5" }))).toBe("anthropic");
    expect(providerFor(resolveModel("ask", { ARBITER_MODEL: "gemini-2.5-pro" }))).toBe("vertex");
  });

  it("returns no caller at all when the named provider has no credentials", () => {
    // Null rather than a throw: "no credentials" is a first-class state, so the
    // service comes up and answers 503 instead of refusing to start.
    expect(buildComplete("gemini-3.5-flash", SHAPE_ASK, {})).toBeNull();
    expect(buildComplete("claude-opus-5", SHAPE_ASK, {})).toBeNull();
  });

  it("will not call Vertex without a project, however good the credentials look", () => {
    // ARBITER_GCP_PROJECT is what the URL is built from. Application default
    // credentials alone address no project.
    expect(buildComplete("gemini-3.5-flash", SHAPE_ASK, { GOOGLE_APPLICATION_CREDENTIALS_JSON: "{}" })).toBeNull();
  });
});

/**
 * A CEILING SIZED FOR THE VISIBLE OUTPUT IS TOO SMALL ONCE THINKING IS ON.
 *
 * SHAPE_ASK's own comment counts three occasions - 512, 2048, 4000 - and calls 16000
 * the answer. It was, for the prompt it was measured against. It stopped being one when
 * the prompt began asking for Markdown: headings, bullets and blank lines are more
 * tokens of answer, and thinking shares the budget with them. Measured here, the
 * identical question against the Turalio review came back `truncated: max_tokens too
 * low` on three of four attempts - a 502 in the API, a bare "upstream" over the
 * composer.
 *
 * So this guards the number that was observed to fail rather than a rule about thinking
 * calls in general. SHAPE_ADJUDICATION sits at 16000 on its own measurement - zero
 * truncation across 10 runs on the probe case - and its input is a bounded case rather
 * than however many pages retrieval returned, so nothing here argues with it.
 *
 * maxOutputTokens is a CAP, not a reservation: nothing is spent by raising one, only by
 * generating into it. That asymmetry is why the fix is always to raise it.
 */
describe("output ceilings against thinking", () => {
  it("gives ask more room than the ceiling that was measured truncating", () => {
    expect(SHAPE_ASK.thinkingBudget, "thinking is what overruns the ceiling").toBe(-1);
    expect(SHAPE_ASK.maxOutputTokens).toBeGreaterThan(16000);
  });

  // The other half of the rule. These run with thinking off and answer in a few tokens;
  // a large ceiling would buy nothing and would hide a runaway.
  it("keeps the short calls small, because nothing is thinking on them", () => {
    for (const shape of [SHAPE_NAVIGATE, SHAPE_INTERPRET]) {
      expect(shape.thinkingBudget).toBe(0);
      expect(shape.maxOutputTokens).toBeLessThanOrEqual(1024);
    }
  });
});
