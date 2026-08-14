import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADJUDICATION_MODEL, DEFAULT_SHORT_MODEL, buildComplete,
  providerFor, resolveModel, SHAPE_ASK, type CallKind,
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
