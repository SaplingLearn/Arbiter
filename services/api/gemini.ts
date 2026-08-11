import { existsSync } from "node:fs";
import { join } from "node:path";
import { GoogleAuth } from "google-auth-library";
import type { CallShape, Complete } from "./interpret.js";

/**
 * The Gemini half of the provider split. Vertex AI, ADC auth, NO API key.
 *
 * This file is the Gemini counterpart of the five lines of SDK construction in
 * interpret.ts. It deliberately hand-rolls `fetch` rather than taking a Google SDK:
 * the two things this call must do that a convenience wrapper hides are (1) name
 * truncation explicitly rather than letting JSON.parse report "Unexpected end of
 * JSON input", and (2) raise the same error STRINGS the Anthropic path raises, so
 * `results/probe-runs.json` stays comparable across providers. A flip rate whose
 * error vocabulary changes with the provider is not a comparison.
 *
 * THINKING SHARES THE OUTPUT BUDGET, exactly as it does on Claude. Measured on this
 * project's own probe case: at maxOutputTokens 512 the Pro models spent ~490 tokens
 * thinking and returned a truncated object; gemini-2.5-flash-lite with
 * thinkingBudget 0 answered in ~850ms. That is why `thinkingBudget` is part of
 * CallShape and never left to the model's default - the default is ON, and on the
 * interpret path it blows the client's 2.5s abort (apps/web/src/ai/client.ts) by 3x
 * before the first field is emitted.
 *
 * `location: global` because that is where this project's models resolve; us-east5
 * returns 404 for them.
 */

const LOCATION = "global";
const SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];

function projectId(env: NodeJS.ProcessEnv): string {
  return env["ARBITER_GCP_PROJECT"] ?? env["GOOGLE_CLOUD_PROJECT"] ?? "";
}

/** The well-known ADC location, which differs by platform. */
function adcPath(env: NodeJS.ProcessEnv): string {
  const appData = env["APPDATA"];
  if (appData !== undefined && appData !== "") {
    return join(appData, "gcloud", "application_default_credentials.json");
  }
  const home = env["HOME"];
  return home === undefined || home === "" ? "" : join(home, ".config", "gcloud", "application_default_credentials.json");
}

/**
 * Synchronous, because `completeFromEnv` returning null is what makes "no
 * credentials" a first-class state rather than a boot failure - the service must
 * come up and answer 503 so the client can descend. GoogleAuth resolves
 * asynchronously, so credential PRESENCE is checked here and credential VALIDITY
 * surfaces on the first call as a 502, the same as an expired Anthropic key would.
 */
export function geminiCredentialsPresent(env: NodeJS.ProcessEnv = process.env): boolean {
  if (projectId(env) === "") return false;
  const inline = env["GOOGLE_APPLICATION_CREDENTIALS_JSON"];
  if (inline !== undefined && inline !== "") return true;
  const keyFile = env["GOOGLE_APPLICATION_CREDENTIALS"];
  if (keyFile !== undefined && keyFile !== "" && existsSync(keyFile)) return true;
  const adc = adcPath(env);
  return adc !== "" && existsSync(adc);
}

export function geminiComplete(
  model: string,
  shape: CallShape,
  env: NodeJS.ProcessEnv = process.env,
): Complete {
  const project = projectId(env);
  const inline = env["GOOGLE_APPLICATION_CREDENTIALS_JSON"];
  // Built once, not per call: GoogleAuth caches the access token and refreshes it
  // when it expires. Constructing per call would mint a token per adjudication.
  const auth = new GoogleAuth(
    inline !== undefined && inline !== ""
      ? { scopes: SCOPES, credentials: JSON.parse(inline) as Record<string, unknown> }
      : { scopes: SCOPES },
  );

  const url =
    `https://aiplatform.googleapis.com/v1/projects/${project}` +
    `/locations/${LOCATION}/publishers/google/models/${model}:generateContent`;

  return async (system, user, schema) => {
    const token = await auth.getAccessToken();
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${String(token)}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          // Gemini's structured-output equivalent of Anthropic's
          // output_config.format. This project's schemas use anyOf, nullable enums
          // and additionalProperties:false; all three are accepted here, so
          // proposalSchema and adjudicationSchema cross over unchanged.
          responseMimeType: "application/json",
          responseSchema: schema,
          maxOutputTokens: shape.maxOutputTokens,
          thinkingConfig: { thinkingBudget: shape.thinkingBudget },
          // DETERMINISTIC DECODING. Redesign spec 7.1 lists it first among the
          // mitigations applied BEFORE the flip rate is measured, and 7.1's flip rate
          // is the redesign's primary claim - the one property measurable without an
          // answer key. It is set here rather than left to the provider default
          // because the default is not 0.
          //
          // This lever exists ONLY on Gemini. `temperature`, `top_p` and `top_k` are
          // removed on every current Claude model - Opus 5, Sonnet 5 and Opus 4.7/4.8
          // all reject them with a 400 - so on the Anthropic path 7.1's first
          // mitigation is unavailable. That is a reason the provider move helps the
          // primary claim, not merely the bill.
          //
          // Determinism is best-effort, not guaranteed: temperature 0 makes decoding
          // greedy, it does not make the service bit-reproducible. `seed` is the
          // further lever and is deliberately NOT set here - adding it would change
          // two variables at once against results already on disk.
          temperature: 0,
        },
      }),
    });

    const data = (await res.json()) as {
      error?: { message?: string };
      candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
    };
    if (data.error !== undefined) throw new Error(`upstream: ${String(data.error.message).slice(0, 120)}`);

    const candidate = data.candidates?.[0];
    // Same three checks, same three strings, as the Anthropic path.
    if (candidate?.finishReason === "MAX_TOKENS") throw new Error("truncated: max_tokens too low");
    if (candidate?.finishReason !== undefined && candidate.finishReason !== "STOP") {
      // SAFETY, PROHIBITED_CONTENT, RECITATION, BLOCKLIST - Gemini's spelling of a refusal.
      throw new Error("refused");
    }

    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    if (text === "") throw new Error("no text block");
    return JSON.parse(text) as unknown;
  };
}
