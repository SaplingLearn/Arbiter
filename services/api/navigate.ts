import Anthropic from "@anthropic-ai/sdk";
import type { ApiResponse, Complete } from "./interpret.js";

/**
 * POST /api/navigate - Surface 3's rung 1.
 *
 * Response: { anchorIds: string[], noMatch: boolean } - IDS ONLY, NEVER PROSE
 * (spec §7). This is not a prompt instruction, it is the schema: two keys,
 * `additionalProperties: false`, and anchorIds constrained to an enum of the
 * anchors the client sent. There is nowhere to put an invented claim, so the model
 * cannot invent one. The UI then surfaces text that ALREADY EXISTS at those
 * anchors.
 *
 * Same key handling as interpret.ts: server-side, never in a response, never in the
 * browser bundle.
 */

export type { ApiResponse, Complete } from "./interpret.js";

export interface NavigateRequest {
  question: string;
  anchors: { id: string; label: string }[];
}

const SYSTEM_PROMPT = [
  "You match a question about a reasoning system to the places in its interface that",
  "already answer it. You return anchor IDS ONLY.",
  "",
  "You are doing a LANGUAGE task, not a judgment task. You do not answer the question,",
  "you do not summarise, and you do not describe what is at an anchor. The interface",
  "scrolls to the anchors you name and shows the text that is already there.",
  "",
  "Return between one and three anchor ids, most relevant first. If nothing in the list",
  "addresses the question, return an empty list and set noMatch to true.",
].join("\n");

function navSchema(req: NavigateRequest): Record<string, unknown> {
  const ids = req.anchors.map((a) => a.id);
  return {
    type: "object",
    additionalProperties: false,
    required: ["anchorIds", "noMatch"],
    properties: {
      anchorIds: {
        type: "array",
        items: ids.length > 0 ? { type: "string", enum: ids } : { type: "string" },
      },
      noMatch: { type: "boolean" },
    },
  };
}

function userPrompt(req: NavigateRequest): string {
  return [
    "Available anchors:",
    req.anchors.map((a) => `${a.id}: ${a.label}`).join("\n"),
    "",
    "The question:",
    req.question,
  ].join("\n");
}

function isNavigateRequest(u: unknown): u is NavigateRequest {
  if (typeof u !== "object" || u === null) return false;
  const b = u as Record<string, unknown>;
  if (typeof b["question"] !== "string" || b["question"].trim() === "") return false;
  if (!Array.isArray(b["anchors"])) return false;
  return (b["anchors"] as unknown[]).every((a) => {
    const x = a as Record<string, unknown>;
    return typeof x?.["id"] === "string" && typeof x?.["label"] === "string";
  });
}

export async function handleNavigate(
  rawBody: unknown,
  complete: Complete | null,
): Promise<ApiResponse> {
  if (complete === null) return { status: 503, body: { error: "no_key" } };
  if (!isNavigateRequest(rawBody)) return { status: 400, body: { error: "bad_request" } };

  try {
    const value = await complete(SYSTEM_PROMPT, userPrompt(rawBody), navSchema(rawBody));
    return { status: 200, body: value };
  } catch {
    return { status: 502, body: { error: "upstream" } };
  }
}

/** Same construction as interpret.ts; see the comment there on thinking and effort. */
export function completeFromEnv(env: NodeJS.ProcessEnv = process.env): Complete | null {
  const apiKey = env["ANTHROPIC_API_KEY"];
  if (apiKey === undefined || apiKey === "") return null;

  const client = new Anthropic({ apiKey });
  const model = env["ARBITER_MODEL"] ?? "claude-opus-5";

  return async (system, user, schema) => {
    const message = await client.messages.create({
      model,
      // A list of at most three ids and a boolean. 512 is generous for that.
      max_tokens: 512,
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
