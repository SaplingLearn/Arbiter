import { describe, expect, it } from "vitest";
import { geminiCredentialsPresent, geminiEndpointLabel } from "../gemini.js";
import { buildComplete, SHAPE_ASK } from "../interpret.js";

/**
 * The API-key path. It exists because ADC authenticates a PERSON and so cannot be
 * handed to a team: every developer would need their own Google account on the
 * project. A key is one line of environment, which is what "share the key" means.
 *
 * These tests make NO network calls. What they hold is the wiring: that a key alone
 * is sufficient, that it does not silently change which Google service is called,
 * and that the banner tells the truth about which one it is.
 */
describe("sharing Gemini access as a key", () => {
  it("treats a key alone as credentials, with no project and no ADC", () => {
    // The point of the whole path. Requiring ARBITER_GCP_PROJECT alongside a key
    // would reject a configuration that works: the Developer API has no project to
    // name, and on Vertex express the key itself names it.
    expect(geminiCredentialsPresent({ GEMINI_API_KEY: "AQ.test" })).toBe(true);
    expect(buildComplete("gemini-3.5-flash", SHAPE_ASK, { GEMINI_API_KEY: "AQ.test" })).not.toBeNull();
  });

  it("accepts the ARBITER_-prefixed spelling too", () => {
    expect(geminiCredentialsPresent({ ARBITER_GEMINI_API_KEY: "AQ.test" })).toBe(true);
  });

  it("still refuses an empty key rather than reading it as configuration", () => {
    // An unset variable and a variable set to nothing must behave identically, or a
    // half-edited .env comes up "live" and fails on the first adjudication instead.
    expect(geminiCredentialsPresent({ GEMINI_API_KEY: "" })).toBe(false);
    expect(buildComplete("gemini-3.5-flash", SHAPE_ASK, { GEMINI_API_KEY: "" })).toBeNull();
  });

  it("leaves the ADC path exactly as it was: credentials are not enough without a project", () => {
    expect(buildComplete("gemini-3.5-flash", SHAPE_ASK, { GOOGLE_APPLICATION_CREDENTIALS_JSON: "{}" })).toBeNull();
  });

  it("does not let a key move the deployment onto a different Google service", () => {
    // Vertex and the Developer API serve DIFFERENT catalogues - verified against a real
    // key, gemini-2.5-flash-lite is a 404 on the Developer API and fine on Vertex. So
    // the host is something a person types, never something a key implies.
    expect(geminiEndpointLabel({ GEMINI_API_KEY: "AQ.test" })).toMatch(/Vertex AI express/);
    expect(geminiEndpointLabel({ GEMINI_API_KEY: "AQ.test", ARBITER_GEMINI_HOST: "developer" }))
      .toMatch(/Developer API/);
    // An unrecognised value is not a third behaviour.
    expect(geminiEndpointLabel({ GEMINI_API_KEY: "AQ.test", ARBITER_GEMINI_HOST: "nonsense" }))
      .toMatch(/Vertex AI express/);
  });

  it("says ADC when there is no key, so the banner never claims a key it lacks", () => {
    expect(geminiEndpointLabel({ ARBITER_GCP_PROJECT: "p" })).toBe("Vertex AI, ADC");
  });

  it("distinguishes all three states, because the banner prints one of them", () => {
    const labels = new Set([
      geminiEndpointLabel({}),
      geminiEndpointLabel({ GEMINI_API_KEY: "AQ.test" }),
      geminiEndpointLabel({ GEMINI_API_KEY: "AQ.test", ARBITER_GEMINI_HOST: "developer" }),
    ]);
    expect(labels.size).toBe(3);
  });
});
