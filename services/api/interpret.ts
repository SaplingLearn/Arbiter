import Anthropic from "@anthropic-ai/sdk";

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
 * Build the model call from the environment, or return null when no key is set.
 *
 * Returning null rather than throwing is what makes "no key" a first-class state
 * instead of a boot failure - the service must come up and answer 503 so the client
 * can descend, not refuse to start.
 */
/**
 * THE ONE COPY OF THE DEFAULT MODEL. Imported by navigate.ts and probe.ts.
 *
 * It is a constant rather than three literals because probe.ts writes the model
 * name into `results/probe-runs.json` while calling the client built HERE. Two
 * copies that drift produce a probe that runs on one model and reports another,
 * which is not a bug in a label - it is a fabricated result, and HANDOVER §3.2
 * rules out exactly that when it forbids the `fallbacks` parameter in the ablation.
 * One copy makes the divergence unrepresentable.
 *
 * Sonnet 5 and not Opus 5 because this call configures away what Opus is for:
 * thinking is disabled, effort is "low" and the ceiling is 1024 tokens. The
 * judgment lives in packages/engine; a model here does language only (navigate.ts's
 * own system prompt says so in as many words). Sonnet is also faster into the 2.5s
 * client abort. Haiku 4.5 is NOT a candidate - it rejects `output_config.effort`.
 *
 * Spec §16 leaves provider and model a deployment decision recorded at deploy time.
 * Written down here so the decision is visible in source rather than only in a
 * Railway dashboard, and overridable per-run with ARBITER_MODEL.
 */
export const DEFAULT_MODEL = "claude-sonnet-5";

export function completeFromEnv(env: NodeJS.ProcessEnv = process.env): Complete | null {
  const apiKey = env["ANTHROPIC_API_KEY"];
  if (apiKey === undefined || apiKey === "") return null;

  const client = new Anthropic({ apiKey });
  const model = env["ARBITER_MODEL"] ?? DEFAULT_MODEL;

  return async (system, user, schema) => {
    const message = await client.messages.create({
      model,
      // Small on purpose. The proposal is seven short fields, and the client aborts
      // at 2.5s (apps/web/src/ai/client.ts LIVE_TIMEOUT_MS) - a large budget here
      // buys nothing the caller would still be waiting for.
      max_tokens: 1024,
      system,
      // Omitting `thinking` runs ADAPTIVE on claude-sonnet-5, and thinking shares the
      // max_tokens budget with the answer - a thinking pass would spend the whole 2.5s
      // window before the first field of the proposal was emitted. So it is disabled
      // explicitly rather than by omission. There are no tools on this call and the
      // response is schema-constrained, so neither of the disabled-thinking failure
      // modes (a tool call written as prose, internal tags in the text) can reach the
      // caller. NOTE for a model swap: Opus 5 accepts `disabled` only at effort "high"
      // or below, so the "low" beside it is load-bearing there and merely cheap here.
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: user }],
    });

    // Check stop_reason BEFORE reading content: on a refusal the content array is
    // empty and indexing it throws something less informative than this does.
    if (message.stop_reason === "refusal") throw new Error("refused");

    // Truncation is named rather than left to JSON.parse. A cut-off answer under a
    // json_schema constraint IS invalid JSON, so parse would throw either way - but it
    // would throw "Unexpected end of JSON input", and the probe records that string as
    // the run's error. A Gate 0 flip rate computed over runs that were truncated
    // measures max_tokens, not the model, and the ceiling here was sized for
    // interpret's seven short fields rather than for an adjudication carrying prose
    // and citations. Saying so makes that failure legible in results/probe-runs.json
    // instead of looking like model instability.
    if (message.stop_reason === "max_tokens") throw new Error("truncated: max_tokens too low");

    const text = message.content.find((b) => b.type === "text");
    if (text === undefined || text.type !== "text") throw new Error("no text block");
    return JSON.parse(text.text) as unknown;
  };
}
