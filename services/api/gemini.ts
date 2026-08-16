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

/**
 * THE SHAREABLE CREDENTIAL, and the reason this file no longer says "NO API key".
 *
 * ADC is the right default for a laptop and the wrong shape for handing the model to
 * a team: `gcloud auth application-default login` authenticates a PERSON, so every
 * developer needs their own Google account with access to the project and there is
 * nothing to pass around. A service-account JSON is passable but has to be minted,
 * distributed and revoked. An API key is one line of env, which is what a person
 * asking to "share the key" is actually asking for.
 *
 * It is still a CLOUD credential, not a personal one: an `AQ.`-prefixed key is bound
 * to a Google Cloud project, and calls made with it bill that project exactly as an
 * ADC session would. Sharing it shares the project's spend, which is why the budget
 * in spend.ts matters more, not less, once this path is in use.
 */
function apiKeyFrom(env: NodeJS.ProcessEnv): string {
  return env["GEMINI_API_KEY"] ?? env["ARBITER_GEMINI_API_KEY"] ?? "";
}

/**
 * Which host serves an API key. TWO EXIST AND THEY ARE NOT INTERCHANGEABLE, so this
 * is a named variable rather than a fallback chain - a silent hop from one to the
 * other would change which models answer without changing anything a reader can see.
 *
 *   vertex     aiplatform.googleapis.com, Vertex AI express mode. The same service the
 *              ADC path calls, so the model line-up is the one this project measured -
 *              including gemini-2.5-flash-lite at thinkingBudget 0, which the short
 *              shapes require. Needs `aiplatform.googleapis.com` enabled on the key's
 *              project; until it is, every call returns 403 and names the fix.
 *
 *   developer  generativelanguage.googleapis.com, the Gemini Developer API. Reachable
 *              with no project configuration at all, which makes it the one that works
 *              the moment a key exists. It serves a DIFFERENT catalogue: verified
 *              against this key, gemini-3.5-flash answers schema-constrained calls at
 *              thinkingBudget 0, gemini-2.5-flash-lite returns 404 ("no longer
 *              available to new users"), and gemini-3.5-flash-lite rejects
 *              thinkingBudget 0 with a 400 the way gemini-2.5-pro does on Vertex.
 *              So a deployment on this host must set ARBITER_MODEL to a model that
 *              can take every shape; gemini-3.5-flash is the one that can.
 *
 * Default is vertex, because it is the service the committed numbers came from and the
 * one an ADC deployment already uses - a key should not quietly move the deployment
 * onto a different catalogue.
 */
function apiHost(env: NodeJS.ProcessEnv): "vertex" | "developer" {
  return env["ARBITER_GEMINI_HOST"] === "developer" ? "developer" : "vertex";
}

function keyUrl(model: string, env: NodeJS.ProcessEnv): string {
  return apiHost(env) === "developer"
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    // Express mode takes no project in the path: the key names the project, which is
    // why a key from the wrong project fails with that project's id in the message
    // rather than with a 404 on a URL nobody can check.
    : `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`;
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
  // Checked BEFORE the project, and deliberately without requiring one. On the
  // developer host there is no project to name, and on express mode the key names it -
  // so demanding ARBITER_GCP_PROJECT alongside a key would reject a configuration that
  // works, which is the same class of bug as the ADC path silently ignoring the
  // project id (env.ts). A key is sufficient on its own.
  if (apiKeyFrom(env) !== "") return true;

  if (projectId(env) === "") return false;
  const inline = env["GOOGLE_APPLICATION_CREDENTIALS_JSON"];
  if (inline !== undefined && inline !== "") return true;
  const keyFile = env["GOOGLE_APPLICATION_CREDENTIALS"];
  if (keyFile !== undefined && keyFile !== "" && existsSync(keyFile)) return true;
  const adc = adcPath(env);
  return adc !== "" && existsSync(adc);
}

/**
 * What the banner prints beside a Gemini model name.
 *
 * `providerFor()` answers "Vertex or Anthropic" from the model name, and once a key
 * can send a `gemini-` model to generativelanguage.googleapis.com that answer is no
 * longer the whole truth - a banner reading "Vertex AI" while the deployment talks to
 * the Developer API is exactly the misconfiguration the banner's own comment says it
 * exists to prevent. The catalogues differ, so this distinction decides which models
 * can answer at all.
 */
export function geminiEndpointLabel(env: NodeJS.ProcessEnv = process.env): string {
  if (apiKeyFrom(env) === "") return "Vertex AI, ADC";
  return apiHost(env) === "developer"
    ? "Gemini Developer API, API key"
    : "Vertex AI express, API key";
}

export function geminiComplete(
  model: string,
  shape: CallShape,
  env: NodeJS.ProcessEnv = process.env,
): Complete {
  const project = projectId(env);
  const key = apiKeyFrom(env);
  const inline = env["GOOGLE_APPLICATION_CREDENTIALS_JSON"];

  // Built once, not per call: GoogleAuth caches the access token and refreshes it
  // when it expires. Constructing per call would mint a token per adjudication.
  //
  // Skipped entirely when a key is in play. GoogleAuth with no discoverable
  // credentials does not fail at construction, it fails on the first getAccessToken()
  // - so building it anyway would turn a perfectly configured key deployment into a
  // runtime error on the first adjudication.
  const auth = key !== ""
    ? null
    : new GoogleAuth(
      inline !== undefined && inline !== ""
        ? { scopes: SCOPES, credentials: JSON.parse(inline) as Record<string, unknown> }
        : { scopes: SCOPES },
    );

  const url = key !== ""
    ? keyUrl(model, env)
    : `https://aiplatform.googleapis.com/v1/projects/${project}` +
      `/locations/${LOCATION}/publishers/google/models/${model}:generateContent`;

  return async (system, user, schema) => {
    // `x-goog-api-key` rather than a `?key=` query parameter. Both authenticate; only
    // one keeps the credential out of URLs, and URLs are what end up in proxy logs and
    // in the error strings this file deliberately propagates.
    const authHeader = auth === null
      ? { "x-goog-api-key": key }
      : { Authorization: `Bearer ${String(await auth.getAccessToken())}` };
    const res = await fetch(url, {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
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

    // Truncation that the provider did NOT label. The check above catches an explicit
    // MAX_TOKENS, but a response can arrive with finishReason STOP and still be cut
    // mid-string - observed on the ask surface, where JSON.parse reported "Unterminated
    // string in JSON at position 726" and the caller saw a bare `upstream`.
    //
    // That unhelpfulness is the exact defect 5501c2c named for the Anthropic path: a
    // parse error records the parser's complaint as the run's failure, and a flip rate
    // computed over runs that were truncated measures max_tokens rather than the model.
    // So the condition is named here too, on the provider that can produce it silently.
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error("truncated: max_tokens too low (unparseable under a json_schema constraint)");
    }
  };
}
