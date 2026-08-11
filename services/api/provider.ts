import Anthropic from "@anthropic-ai/sdk";
import type { Complete } from "./interpret.js";

/**
 * WHICH MODEL ANSWERED, decided in one place.
 *
 * Before this file, `completeFromEnv` built an Anthropic client and `probe.ts`
 * separately wrote `process.env["ARBITER_MODEL"] ?? "claude-opus-5"` into the
 * provenance of every result. Two reads of the environment, one decision - so the
 * moment a second provider existed, the probe would have recorded a model that
 * never ran. That is not a cosmetic defect: `rules/pass-marks-v1.0.json` was
 * committed before any model was called precisely so a number could be attached to
 * the thing that produced it, and a result naming the wrong model is worse than one
 * naming none.
 *
 * So provider selection resolves ONCE, here, and both the call and its identity
 * come out of the same resolution. `modelId` is not a label a caller passes in; it
 * is a property of the resolved provider.
 *
 * THE PROMPT IS A MODEL PARAMETER (completion plan §4.1) - and so is the model. A
 * flip rate measured on one model says nothing about another, which is why
 * `ProviderInfo` travels with every recorded run rather than being noted in a commit
 * message.
 */

export type ProviderName = "anthropic" | "gemini";

export interface ProviderInfo {
  provider: ProviderName;
  /** The exact model string sent on the wire. Recorded verbatim in every result. */
  model: string;
}

export interface ResolvedProvider extends ProviderInfo {
  complete: Complete;
}

/** Defaults are written down in source, not left to a deployment dashboard. */
const DEFAULT_MODEL: Record<ProviderName, string> = {
  anthropic: "claude-opus-5",
  // Chosen 2026-08-10 by measurement, not preference: it is the strongest model
  // this key can reach that accepts the adjudication schema unmodified. The 3.1-pro
  // preview returns 429 on this key, and `adjudicationSchema` emits
  // `additionalProperties: false` and `anyOf: [string, null]` - both of which the
  // OpenAPI-subset `responseSchema` field rejects and `responseJsonSchema` accepts.
  gemini: "gemini-3.6-flash",
};

/**
 * Pick a provider from the environment, or null when no key is set.
 *
 * `ARBITER_PROVIDER` wins when set, so a machine holding both keys is not silently
 * at the mercy of the order of the checks below. With neither key set this returns
 * null and the service answers 503 - "no key" stays a first-class state rather than
 * a boot failure, which is the property `completeFromEnv` already had and must keep.
 */
export function resolveProvider(
  env: NodeJS.ProcessEnv = process.env,
  opts: { maxTokens?: number } = {},
): ResolvedProvider | null {
  // 16384, and the number was set by measurement rather than taste. An adjudication
  // is six rule disclosures with reasoning, two verdict halves and a missing-evidence
  // list; at 1024 (surface 1's ceiling) it truncates immediately, and at 4096 it
  // truncated on 5 of 20 runs of the 2026-08-10 probe because Gemini's thinking
  // tokens are drawn from the SAME output budget as the answer. A truncation arrives
  // as invalid JSON, so it gets debugged as a schema defect - which is why the budget
  // is now well clear of the need rather than close to it. A ceiling is not a spend.
  //
  // Surface 1 still passes 1024 explicitly, because its client aborts at 2.5s and
  // that ceiling is load-bearing documentation of an interaction budget.
  const maxTokens = opts.maxTokens ?? 16384;
  const requested = env["ARBITER_PROVIDER"];
  const anthropicKey = env["ANTHROPIC_API_KEY"];
  const geminiKey = env["GEMINI_API_KEY"];

  const chosen: ProviderName | null =
    requested === "anthropic" || requested === "gemini"
      ? requested
      : anthropicKey !== undefined && anthropicKey !== ""
        ? "anthropic"
        : geminiKey !== undefined && geminiKey !== ""
          ? "gemini"
          : null;

  if (chosen === null) return null;

  const model = env["ARBITER_MODEL"] ?? DEFAULT_MODEL[chosen];

  if (chosen === "anthropic") {
    if (anthropicKey === undefined || anthropicKey === "") return null;
    return { provider: "anthropic", model, complete: anthropicComplete(anthropicKey, model, maxTokens) };
  }
  if (geminiKey === undefined || geminiKey === "") return null;
  return { provider: "gemini", model, complete: geminiComplete(geminiKey, model, maxTokens) };
}

export function anthropicComplete(apiKey: string, model: string, maxTokens = 16384): Complete {
  const client = new Anthropic({ apiKey });
  return async (system, user, schema) => {
    const message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: user }],
    });
    if (message.stop_reason === "refusal") throw new Error("refused");
    const text = message.content.find((b) => b.type === "text");
    if (text === undefined || text.type !== "text") throw new Error("no text block");
    return JSON.parse(text.text) as unknown;
  };
}

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * TRANSPORT retries, and the word is doing work.
 *
 * A 429 or a 503 means the request never reached the model; retrying it asks the
 * same question again and is not a second opinion. That is categorically different
 * from retrying a VERIFICATION failure - a run whose citations did not resolve - and
 * probe.ts refuses to do the latter, in a comment that says why: re-rolling until the
 * model produces something citable hides the instability the probe exists to measure.
 * The distinction is the whole reason this retry lives at the HTTP layer, below the
 * point where an adjudication exists to be judged.
 *
 * On the 2026-08-10 probe run, 1 of 20 runs was lost to a 503 and 2 to per-minute
 * 429s. A daily-quota 429 is not recoverable by waiting a few seconds, and this
 * correctly gives up and reports it rather than sleeping through the exhaustion.
 */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_BACKOFF_MS = [2_000, 8_000, 20_000];
const TRANSPORT_RETRIES = RETRY_BACKOFF_MS.length;

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The Gemini call, over plain fetch rather than `@google/genai`.
 *
 * No SDK, for the reason `router.ts` gives for having no routing library and
 * `auth.ts` gives for having no crypto library: this is one POST and one parse, and
 * a transitive dependency tree is a poor trade in a repo that will hold unpublished
 * safety data. Node 20+ has fetch.
 *
 * `responseJsonSchema`, NOT `responseSchema`. The latter is an OpenAPI 3.0 subset
 * that rejects `additionalProperties` and models nullability as `nullable: true`;
 * `adjudicationSchema` emits `additionalProperties: false` and
 * `anyOf: [{string},{null}]`. Measured against the live API on 2026-08-10: the
 * former is accepted verbatim. That matters more than it looks - a translation
 * layer between the schema the verifier trusts and the schema the model is given is
 * a place where the two can silently disagree, and `verifyAdjudication` would then
 * be checking output against a contract nobody enforced.
 *
 * `temperature: 0` because §7.1 lists deterministic decoding as a mitigation applied
 * BEFORE consistency is measured. The probe's flip rate is then a property of the
 * model rather than of a sampling temperature we chose, which is the only version of
 * that number worth reporting.
 */
export function geminiComplete(
  apiKey: string,
  model: string,
  maxTokens = 16384,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Complete {
  return async (system, user, schema) => {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
        responseJsonSchema: schema,
      },
    });

    let res: Response | null = null;
    for (let attempt = 0; attempt <= TRANSPORT_RETRIES; attempt++) {
      res = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body,
      });
      if (res.ok || !RETRYABLE_STATUS.has(res.status)) break;
      if (attempt < TRANSPORT_RETRIES) await sleep(RETRY_BACKOFF_MS[attempt]!);
    }

    if (res === null || !res.ok) {
      // The body can carry the key back in an error echo, so only the status is
      // surfaced - the same reasoning interpret.ts applies to its own catch block.
      throw new Error(`gemini_http_${res?.status ?? 0}`);
    }

    const data = (await res.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];
    if (candidate === undefined) throw new Error("no candidate");
    // MAX_TOKENS truncates mid-JSON, so the parse below would fail with a message
    // that blames the wrong thing. Naming it here keeps a budget problem from being
    // debugged as a schema problem.
    if (candidate.finishReason === "MAX_TOKENS") throw new Error("truncated");
    if (candidate.finishReason === "SAFETY" || candidate.finishReason === "PROHIBITED_CONTENT") {
      throw new Error("refused");
    }

    const text = (candidate.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");
    if (text.trim() === "") throw new Error("no text block");
    return JSON.parse(text) as unknown;
  };
}

interface GeminiResponse {
  candidates?: {
    finishReason?: string;
    content?: { parts?: { text?: string }[] };
  }[];
}
