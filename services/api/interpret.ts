import Anthropic from "@anthropic-ai/sdk";
import { geminiComplete, geminiCredentialsPresent } from "./gemini.js";

/**
 * POST /api/interpret - Surface 1's rung 1.
 *
 * Mounted on the same Railway service as the static app (spec §10), therefore
 * same-origin, therefore no CORS. THE KEY LIVES HERE AND NOWHERE ELSE: it is read
 * from the process environment by `completeFromEnv` and never crosses into a
 * response, a log line or the browser bundle. `apps/web` does not import this file
 * and a test asserts so (apps/web/test/boundaries.test.ts).
 *
 * The request carries the challenge text, the ruleset as (id, enabled, strength),
 * and claim IDS AND LABELS ONLY - never raw evidence values. That is enforced on
 * the caller's side, where the body is built, and asserted there.
 *
 * There is deliberately no shared module between this file and navigate.ts. Spec §4
 * fixes the contents of services/api at two handlers, and what the two share is
 * five lines of SDK construction rather than a definition - the prompt, the schema
 * and the request validation differ completely. A second copy of a DEFINITION is
 * what preregistration.ts exists to prevent; a second copy of a constructor is not
 * the same defect.
 */

export interface ApiResponse {
  status: number;
  body: unknown;
}

/** The model call, injected so tests never construct a client and never need a key. */
export type Complete = (
  system: string,
  user: string,
  schema: Record<string, unknown>,
) => Promise<unknown>;

export interface InterpretRequest {
  challenge: string;
  rules: { id: string; enabled: boolean; strength: number }[];
  claims: { id: string; label: string }[];
}

/**
 * The reclassifiable field set, spelled out because services/ does not import the
 * engine. It is `keyof AssayOperator["produces"]` (packages/engine/src/plan.ts:13-16).
 *
 * If it ever drifts from the engine the failure is SAFE: the browser re-validates
 * every response against ProposalSchema, which IS derived from the engine type, so a
 * stale field here produces a schema failure - a rung-1 miss by §11 - rather than a
 * proposal the confirm panel would display.
 */
const RECLASSIFIABLE_FIELDS = [
  "stream",
  "system",
  "measuresKeyEvent",
  "exposureRelevant",
  "inApplicabilityDomain",
  "klimisch",
] as const;

const SYSTEM_PROMPT = [
  "You translate a toxicologist's plain-English objection into ONE proposed change to a",
  "pre-registered ruleset, or to the classification of one evidence claim.",
  "",
  "You are doing a LANGUAGE task, not a judgment task. You do not decide whether a",
  "compound is safe, you do not weigh evidence, and you do not evaluate the rules. You",
  "identify which registered rule or which claim the objection is about, and what change",
  "it is asking for. The change is shown to the user for confirmation before anything is",
  "applied, and it is then run through the same engine as every other route.",
  "",
  "Set confidence to 'low' when the objection targets the discount MECHANISM rather than a",
  "named rule, or when more than one rule would be a defensible reading.",
  "The paraphrase is one sentence, in the user's own vocabulary, stating what will change.",
].join("\n");

function proposalSchema(req: InterpretRequest): Record<string, unknown> {
  // Built FROM THE REQUEST: targetRule and targetClaimId can only name things the
  // client offered. This is the same structural guarantee as Surface 3's ids-only
  // return type, applied to Surface 1 - there is nowhere to put an invented rule.
  const ruleIds = req.rules.map((r) => r.id);
  const claimIds = req.claims.map((c) => c.id);
  const nullableEnum = (values: string[]) => ({
    anyOf: values.length > 0 ? [{ type: "string", enum: values }, { type: "null" }] : [{ type: "null" }],
  });

  return {
    type: "object",
    additionalProperties: false,
    required: [
      "targetRule",
      "targetClaimId",
      "action",
      "field",
      "newValue",
      "paraphrase",
      "confidence",
    ],
    properties: {
      targetRule: nullableEnum(ruleIds),
      targetClaimId: nullableEnum(claimIds),
      action: {
        type: "string",
        enum: ["disable", "lower_strength", "raise_strength", "reclassify_field"],
      },
      field: nullableEnum([...RECLASSIFIABLE_FIELDS]),
      newValue: {
        anyOf: [
          { type: "string" },
          { type: "number" },
          { type: "boolean" },
          { type: "null" },
        ],
      },
      paraphrase: { type: "string" },
      confidence: { type: "string", enum: ["high", "low"] },
    },
  };
}

function userPrompt(req: InterpretRequest): string {
  const rules = req.rules
    .map((r) => `${r.id}: ${r.enabled ? "enabled" : "disabled"}, strength ${r.strength}`)
    .join("\n");
  const claims = req.claims.map((c) => `${c.id}: ${c.label}`).join("\n");
  return [
    "Registered rules currently on screen:",
    rules,
    "",
    "Evidence claims currently on screen (ids and labels only):",
    claims,
    "",
    "The objection:",
    req.challenge,
  ].join("\n");
}

function isInterpretRequest(u: unknown): u is InterpretRequest {
  if (typeof u !== "object" || u === null) return false;
  const b = u as Record<string, unknown>;
  if (typeof b["challenge"] !== "string" || b["challenge"].trim() === "") return false;
  if (!Array.isArray(b["rules"]) || !Array.isArray(b["claims"])) return false;
  const rulesOk = (b["rules"] as unknown[]).every((r) => {
    const x = r as Record<string, unknown>;
    return typeof x?.["id"] === "string"
      && typeof x?.["enabled"] === "boolean"
      && typeof x?.["strength"] === "number";
  });
  const claimsOk = (b["claims"] as unknown[]).every((c) => {
    const x = c as Record<string, unknown>;
    return typeof x?.["id"] === "string" && typeof x?.["label"] === "string";
  });
  return rulesOk && claimsOk;
}

export async function handleInterpret(
  rawBody: unknown,
  complete: Complete | null,
): Promise<ApiResponse> {
  // No key configured. Spec §10: the client treats this exactly like a timeout, so
  // a deploy that lands without a key still demos - it just runs on cache.
  if (complete === null) return { status: 503, body: { error: "no_key" } };

  if (!isInterpretRequest(rawBody)) return { status: 400, body: { error: "bad_request" } };

  try {
    const value = await complete(SYSTEM_PROMPT, userPrompt(rawBody), proposalSchema(rawBody));
    return { status: 200, body: value };
  } catch {
    // Rate limit, refusal, network fault, malformed upstream body - all one thing to
    // the caller by §3. The message is deliberately not echoed: it can quote the
    // request, and the request is the only thing here adjacent to a credential.
    return { status: 502, body: { error: "upstream" } };
  }
}

/**
 * How much room a call gets, and whether it may think.
 *
 * THE TWO CALLS ARE NOT THE SAME SHAPE AND MUST NOT SHARE ONE. Before this split,
 * `completeFromEnv()` returned a single closure sized for interpret's seven short
 * fields, and server.ts handed that same closure to `handleAdjudicate` - so an
 * adjudication carrying prose, citations and one disclosure per registered rule ran
 * with a 1024-token ceiling and thinking off. That truncates, and a truncated
 * adjudication fails verification as `rule_not_addressed`, which reads in
 * results/probe-runs.json as model instability rather than as the config bug it is.
 *
 * `thinkingBudget` is 0 (off) or -1 (the model chooses). It is never left unset:
 * thinking is ON by default on both providers and it SHARES the output budget with
 * the answer.
 */
export interface CallShape {
  maxOutputTokens: number;
  thinkingBudget: 0 | -1;
}

/** At most three ids and a boolean. Measured ~850ms on gemini-2.5-flash-lite. */
export const SHAPE_NAVIGATE: CallShape = { maxOutputTokens: 512, thinkingBudget: 0 };

/**
 * Seven short fields, behind a 2.5s client abort (apps/web/src/ai/client.ts).
 * Thinking off is not a cost choice, it is a correctness one: measured on this
 * project's own ambiguous-objection case, thinking-on runs took 6-13s (3-5x over the
 * abort, so every one is cancelled client-side and the user sees cache) and 1 in 3
 * returned unparseable JSON because ~1960 thought tokens crowded out the answer.
 * Thinking-off got the confidence rule right 3/3 on both candidate models. There was
 * no accuracy to trade for the latency.
 */
export const SHAPE_INTERPRET: CallShape = { maxOutputTokens: 1024, thinkingBudget: 0 };

/**
 * Prose, citations, and one disclosure per registered rule - nothing aborts it, so it
 * gets room and it gets to think. Thinking is the defence against exactly the two
 * failures verifyAdjudication looks for: an ungrounded citedFindingId and an omitted
 * rule. 16000 measured zero truncation across 10 runs on data/probe-case.json.
 */
export const SHAPE_ADJUDICATION: CallShape = { maxOutputTokens: 16000, thinkingBudget: -1 };

/**
 * A question against retrieved document pages. Thinking ON, and a middle ceiling.
 *
 * Thinking, because the failure this surface must avoid is answering from an adjacent
 * passage when the retrieved set does not contain the answer - deciding "the documents
 * do not say this" is the reasoning step, and it is the one that keeps the answer
 * honest. Disabled thinking is what produced the fluent, unsupported severity claim
 * that consequenceBasis was built to catch.
 *
 * 16000, and it was 4000 for about ten minutes. The ANSWER is a paragraph and a
 * citation list, so 4000 looked generous - but thinking shares this budget, and the
 * questions that need thinking most are the ones where the model has to decide the
 * passages do not support an answer. On "should this compound advance", thinking
 * consumed the budget and the answer was cut mid-string; JSON.parse reported
 * "Unterminated string in JSON at position 726" and the caller saw `upstream`.
 *
 * That is the third time on this project that a ceiling sized for the visible output
 * has been too small once thinking was on - measured at 512 and at 2048 before this.
 * Size these for thinking plus answer, never for the answer.
 *
 * 64000, AND 16000 WAS RIGHT UNTIL THE ANSWER GREW. This is the fifth time, and the
 * first where the ceiling did not move but the output did: ask.ts began asking for
 * Markdown, and headings, bullets and blank lines are more answer for the same
 * question. Measured on this deployment, "What liver findings are reported, and at what
 * doses?" against the 264-page Turalio review returned `truncated: max_tokens too low`
 * on three of four attempts - 502 from the route, a bare `upstream` over the composer,
 * and no answer at all for a question the retrieval had already served correctly.
 *
 * The number is SHAPE_SUMMARY's, for SHAPE_SUMMARY's reason: the answer is bounded by
 * the prompt, so the only job left for this ceiling is to stop being the binding
 * constraint on thinking. A cap is not a reservation - nothing is spent by raising one,
 * only by generating into it - so there is no case for tuning it finely, and every
 * previous attempt to do so is the list above.
 */
export const SHAPE_ASK: CallShape = { maxOutputTokens: 64000, thinkingBudget: -1 };

/**
 * A summary of a WHOLE document, and the FOURTH time on this project that a ceiling
 * sized for the visible output has been too small once thinking was on.
 *
 * The visible output is a paragraph or two and a citation list - smaller than an
 * adjudication - so SHAPE_ASK's 16000 looked generous, and it is: for a question
 * answered from eight pages. Measured on the 178-page EMA assessment report, that call
 * ran 56 seconds and came back `truncated: max_tokens too low`, because the input is
 * ~124,000 tokens of document and thinking scales with what there is to read, not with
 * what there is to write.
 *
 * 64000 rather than a tuned number: the answer is bounded by the prompt and the only
 * thing this ceiling has to do is stop being the binding constraint on thinking.
 */
export const SHAPE_SUMMARY: CallShape = { maxOutputTokens: 64000, thinkingBudget: -1 };

/**
 * EXTRACTION IS A SMALL ANSWER AFTER A LARGE READ, and it was running under the ask
 * shape, which is the opposite arrangement.
 *
 * `SHAPE_ASK` pairs a 64000-token ceiling with adaptive thinking, because a question
 * against a review can need a long answer and a long think. An extraction call cannot:
 * retrieval has already chosen six pages, the schema permits a label, a detail, a quote
 * and a page, and no correct answer is more than a few hundred tokens. What the adaptive
 * budget bought instead was room to think until the ceiling and be cut off before
 * answering - `finishReason: MAX_TOKENS`, surfaced as `truncated: max_tokens too low`,
 * which the sweep saw discard C4 on the ponatinib review.
 *
 * So thinking is OFF here, which this interface's own note makes the decisive argument
 * for: the budget is shared with the answer, so any thinking at all can crowd the answer
 * out, and only zero removes that by construction rather than by hoping the ceiling is
 * high enough. The retrieval has already done the part that would benefit from thought -
 * choosing which six pages to look at - and what remains is finding a sentence on them
 * and copying it exactly, which is the shape the short calls already run at zero.
 *
 * It is also much faster, and this call is made twelve times per document.
 */
export const SHAPE_EXTRACT: CallShape = { maxOutputTokens: 16000, thinkingBudget: 0 };

export type CallKind = "short" | "adjudication" | "ask" | "summary" | "extract";

/**
 * THE ONE COPY OF THE DEFAULT MODELS, and the one copy of how a model name is
 * resolved. probe.ts REPORTS what this returns while server.ts CALLS what this
 * returns; two copies that drift produce a probe that runs on one model and reports
 * another, which is not a bug in a label - it is a fabricated result, and HANDOVER
 * §3.2 rules out exactly that when it forbids the `fallbacks` parameter in the
 * ablation. One copy makes the divergence unrepresentable.
 *
 * Gemini on Vertex AI, because Anthropic models are a "generative AI partner model
 * offered as a managed API" and are therefore excluded from the Google Cloud credit
 * this project is deployed against; Gemini on Vertex is not.
 *
 * gemini-2.5-flash-lite for the short calls: the only candidate that emits ZERO
 * thought tokens by default, ~850ms against the 2.5s abort, and on the ambiguous
 * mechanism-objection case it returned targetRule=null where gemini-3.5-flash-lite
 * consistently named a rule the objection never named.
 *
 * gemini-3.5-flash for adjudication, and it is a flash model on purpose. Measured on
 * data/probe-case.json (caseHash 9677b5a68c09) at 20 runs with temperature 0, it is
 * the ONLY candidate that clears all three of Gate 0's pass marks: flip rate 0.0%,
 * zero hallucinated citations, and every rule at or above the 0.80 agreement mark
 * (worst 80.0%). gemini-2.5-pro fails the third at R1 75.0%; gemini-3.1-pro-preview
 * failed it at R5 55.0% before the fixes.
 *
 * THE PRO TIER LOST HERE, which is worth stating because it inverts the usual
 * instinct. This call wants an identical answer every time far more than it wants a
 * cleverer one - §7.1 makes consistency the primary claim and says accuracy is not
 * first - and on that axis the flash models were simply better behaved.
 *
 * Three earlier readings of this same question were WRONG, all in the same way -
 * called before the measurement could support them:
 *   n=5   said 3.1-pro-preview beat 2.5-pro. n=20 reversed it; one flip is 20% at n=5.
 *   n=20  said 2.5-pro. Adding temperature 0 put both flash models ahead of both Pros.
 *   temp0 said 3.5-flash passed Gate 0 - true, but it was answering R4 `applies` 20/20
 *         when the fixture says every finding is IN domain. Stable and wrong passes a
 *         consistency gate, which is §10 rule 12 in miniature.
 * The env var exists so the next person can overturn this one the same way.
 *
 * Note gemini-2.5-pro REJECTS thinkingBudget 0 outright (HTTP 400) - irrelevant to
 * adjudication, which wants thinking on, but it can never serve a SHAPE_* with
 * thinkingBudget 0 and so can never take a short call.
 *
 * Spec §16 leaves provider and model a deployment decision recorded at deploy time.
 * Written down here so the decision is visible in source rather than only in a
 * Railway dashboard.
 */
export const DEFAULT_SHORT_MODEL = "gemini-2.5-flash-lite";
export const DEFAULT_ADJUDICATION_MODEL = "gemini-3.5-flash";

export function resolveModel(kind: CallKind, env: NodeJS.ProcessEnv = process.env): string {
  if (kind === "adjudication") {
    return env["ARBITER_ADJUDICATION_MODEL"] ?? env["ARBITER_MODEL"] ?? DEFAULT_ADJUDICATION_MODEL;
  }
  // "ask" resolves to the ADJUDICATION model, not the short one. It reads document
  // prose and has to decide when the passages do not answer the question, which is
  // nearer the adjudicator's job than interpret's closed-set classification - and the
  // short model is chosen for a 2.5s abort this surface does not have.
  // A summary reads the same prose on the same terms and answers under the same
  // prompt, so it resolves exactly as "ask" does. Only the output ceiling differs.
  // Extraction reads the same document prose on the same terms as a question does, so
  // it resolves to the same model. Only the SHAPE differs - see SHAPE_EXTRACT.
  if (kind === "ask" || kind === "summary" || kind === "extract") {
    return env["ARBITER_ASK_MODEL"] ?? env["ARBITER_ADJUDICATION_MODEL"] ?? env["ARBITER_MODEL"] ?? DEFAULT_ADJUDICATION_MODEL;
  }
  return env["ARBITER_MODEL"] ?? DEFAULT_SHORT_MODEL;
}

/**
 * Which service a model name routes to. Named rather than left implicit in a
 * `startsWith` inside `buildComplete`, because "which provider is this deployment
 * actually calling" is a question the startup banner, the evaluation results and the
 * report all have to answer, and three copies of that test would eventually disagree.
 *
 * EVERY DEFAULT IN THIS FILE IS GEMINI ON VERTEX, and a test holds that for all four
 * call kinds. Anthropic is reachable only by naming a non-Gemini model in
 * ARBITER_MODEL, ARBITER_ASK_MODEL or ARBITER_ADJUDICATION_MODEL - so a provider
 * change is always something a person typed, never something that drifted.
 */
export type Provider = "vertex" | "anthropic";

export function providerFor(model: string): Provider {
  return model.startsWith("gemini-") ? "vertex" : "anthropic";
}

/**
 * Provider is INFERRED FROM THE MODEL NAME rather than selected by a second switch,
 * so `ARBITER_MODEL=claude-opus-5` and `ARBITER_MODEL=gemini-2.5-pro` both simply
 * work and no combination of two env vars can name a model one provider cannot serve.
 *
 * Returns null when the chosen provider has no credentials. Null rather than a throw
 * is what makes "no credentials" a first-class state instead of a boot failure - the
 * service must come up and answer 503 so the client can descend, not refuse to start.
 */
export function buildComplete(
  model: string,
  shape: CallShape,
  env: NodeJS.ProcessEnv = process.env,
): Complete | null {
  if (providerFor(model) === "vertex") {
    return geminiCredentialsPresent(env) ? geminiComplete(model, shape, env) : null;
  }

  const apiKey = env["ANTHROPIC_API_KEY"];
  if (apiKey === undefined || apiKey === "") return null;
  const client = new Anthropic({ apiKey });

  return async (system, user, schema) => {
    const message = await client.messages.create({
      model,
      max_tokens: shape.maxOutputTokens,
      system,
      // Explicit rather than by omission: omitting `thinking` runs ADAPTIVE on
      // current Claude models, and thinking shares max_tokens with the answer. On the
      // short shapes there are no tools and the response is schema-constrained, so
      // neither disabled-thinking failure mode (a tool call written as prose, internal
      // tags in the text) can reach the caller. NOTE: Opus 5 accepts `disabled` only
      // at effort "high" or below, so the effort beside it is load-bearing there.
      thinking: shape.thinkingBudget === 0 ? { type: "disabled" } : { type: "adaptive" },
      output_config: {
        effort: shape.thinkingBudget === 0 ? "low" : "high",
        format: { type: "json_schema", schema },
      },
      messages: [{ role: "user", content: user }],
    });

    // Check stop_reason BEFORE reading content: on a refusal the content array is
    // empty and indexing it throws something less informative than this does.
    if (message.stop_reason === "refusal") throw new Error("refused");

    // Truncation is named rather than left to JSON.parse. A cut-off answer under a
    // json_schema constraint IS invalid JSON, so parse would throw either way - but it
    // would throw "Unexpected end of JSON input", and the probe records that string as
    // the run's error. A Gate 0 flip rate computed over runs that were truncated
    // measures max_tokens, not the model. Saying so makes that failure legible in
    // results/probe-runs.json instead of looking like model instability.
    if (message.stop_reason === "max_tokens") throw new Error("truncated: max_tokens too low");

    const text = message.content.find((b) => b.type === "text");
    if (text === undefined || text.type !== "text") throw new Error("no text block");
    return JSON.parse(text.text) as unknown;
  };
}

/**
 * Build the model call for one KIND of call from the environment, or return null
 * when the resolved provider has no credentials.
 *
 * The `kind` argument defaults to "short" so every existing caller keeps its old
 * behaviour; the adjudication callers (server.ts, probe.ts) pass "adjudication"
 * explicitly and get the shape that call actually needs.
 */
export function completeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  kind: CallKind = "short",
): Complete | null {
  const shape = kind === "adjudication" ? SHAPE_ADJUDICATION
    : kind === "summary" ? SHAPE_SUMMARY
      : kind === "ask" ? SHAPE_ASK
        : SHAPE_INTERPRET;
  return buildComplete(resolveModel(kind, env), shape, env);
}
