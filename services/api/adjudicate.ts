import type { Complete } from "./interpret.js";

/**
 * POST /api/adjudicate - the redesign's decision surface.
 *
 * WHAT MAKES THIS DIFFERENT FROM interpret.ts, AND WHY IT IS STILL SAFE.
 *
 * Surface 1 is blindfolded on purpose: it receives claim ids and labels only, so a
 * misinterpretation cannot be built on evidence values it never saw. THIS handler
 * is the first in the project that sees real evidence, because it is reasoning
 * about that evidence rather than parsing a sentence about it. That widening is
 * deliberate and it is why `verifyAdjudication` exists downstream: every id the
 * model cites is matched against the findings that were sent, and an output citing
 * anything else does not render. The model may reason; it may not invent.
 *
 * The verdict is TWO answers, not one. `mechanism` asks whether a route to liver
 * injury exists; `consequence` asks whether it is severe enough to stop the
 * programme. Collapsing those two is the exact defect measured on 2026-08-09 -
 * five of the engine's seven commitments were real bile-transport inhibitors that
 * are approved and prescribed, flagged because a mechanism finding alone was
 * allowed to produce "do not advance".
 *
 * There is deliberately no shared prompt module with interpret.ts. What they share
 * is SDK construction, not a definition, and interpret.ts already records why that
 * distinction matters.
 */

/**
 * Mirrors `Assertion` in packages/engine/src/types.ts, which is
 * "toxic" | "safe" | "ambiguous".
 *
 * `ambiguous` is NOT an oversight to be narrowed away. An earlier draft here
 * allowed only toxic and safe, and the TAK-994 fixture immediately produced a
 * request the validator rejected: its QSAR claim asserts `ambiguous`, which is the
 * honest reading of a structural prediction that resolves neither way. Dropping
 * that claim would have silently removed evidence from an adjudication, which is
 * the one thing this surface must never do.
 *
 * services/ does not import the engine (see interpret.ts on the same point), so
 * this is a second spelling of one definition. The drift is safe in the same way:
 * a value the engine accepts and this rejects fails validation loudly at the door
 * rather than being quietly discarded downstream.
 */
export type FindingAssertion = "toxic" | "safe" | "ambiguous";

export interface Finding {
  id: string;
  label: string;
  assertion: FindingAssertion;
  detail: string;
  sourceDocument?: string;
  sourcePage?: number;
}

export interface AdjudicateRequest {
  compoundLabel: string;
  /** Indication, dosing duration, population. A property of the CASE, never of a reviewer. */
  context: string;
  rules: { id: string; name: string; statement: string; enabled: boolean; strength: number }[];
  findings: Finding[];
  /** Fields searched for and not found. Absent is a finding; see spec §3.2. */
  absent: { field: string; whatItBlocks: string }[];
}

export type ConsequenceVerdict = "do_not_advance" | "advance" | "cannot_conclude";

export interface Adjudication {
  mechanism: {
    present: boolean;
    pathway: string | null;
    citedFindingIds: string[];
  };
  consequence: {
    verdict: ConsequenceVerdict;
    reasoning: string;
    citedFindingIds: string[];
  };
  ruleDisclosure: {
    ruleId: string;
    position: "applies" | "does_not_apply";
    reasoning: string;
    citedFindingIds: string[];
  }[];
  missing: { field: string; whyItMatters: string }[];
  nextExperiment: string | null;
}

/**
 * The output contract, built FROM THE REQUEST so `citedFindingIds` can only name
 * findings that were sent and `ruleId` can only name a registered rule.
 *
 * This is the same structural guarantee Surface 3 gets from returning ids only,
 * applied here: there is nowhere in the schema to put an invented finding. It is
 * not a substitute for `verifyAdjudication` - a schema constrains shape, not
 * truthfulness, and a model can still cite a real id for a claim that id does not
 * support - but it removes the crudest failure at zero cost.
 */
export function adjudicationSchema(req: AdjudicateRequest): Record<string, unknown> {
  const findingIds = req.findings.map((f) => f.id);
  const ruleIds = req.rules.map((r) => r.id);

  const citedIds = {
    type: "array",
    items: findingIds.length > 0
      ? { type: "string", enum: findingIds }
      // An empty case must still produce a legal (empty) array rather than an
      // unsatisfiable schema, or a compound with no findings fails at the model
      // instead of arriving as the "cannot conclude" it plainly is.
      : { type: "string" },
  };

  return {
    type: "object",
    additionalProperties: false,
    required: ["mechanism", "consequence", "ruleDisclosure", "missing", "nextExperiment"],
    properties: {
      mechanism: {
        type: "object",
        additionalProperties: false,
        required: ["present", "pathway", "citedFindingIds"],
        properties: {
          present: { type: "boolean" },
          pathway: { anyOf: [{ type: "string" }, { type: "null" }] },
          citedFindingIds: citedIds,
        },
      },
      consequence: {
        type: "object",
        additionalProperties: false,
        required: ["verdict", "reasoning", "citedFindingIds"],
        properties: {
          verdict: { type: "string", enum: ["do_not_advance", "advance", "cannot_conclude"] },
          reasoning: { type: "string" },
          citedFindingIds: citedIds,
        },
      },
      ruleDisclosure: {
        type: "array",
        // Every registered rule, exactly once. Stated as a length bound because the
        // schema cannot express "one entry per rule id"; `verifyAdjudication`
        // enforces the set equality that actually matters.
        minItems: ruleIds.length,
        maxItems: ruleIds.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ruleId", "position", "reasoning", "citedFindingIds"],
          properties: {
            ruleId: { type: "string", enum: ruleIds },
            position: { type: "string", enum: ["applies", "does_not_apply"] },
            reasoning: { type: "string" },
            citedFindingIds: citedIds,
          },
        },
      },
      missing: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "whyItMatters"],
          properties: {
            field: { type: "string" },
            whyItMatters: { type: "string" },
          },
        },
      },
      nextExperiment: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
  };
}

export function userPrompt(req: AdjudicateRequest, template: string[]): string {
  const rules = req.rules
    .map((r) => `${r.id} (${r.name}), ${r.enabled ? "enabled" : "disabled"}, strength ${r.strength}: ${r.statement}`)
    .join("\n");

  const findings = req.findings.length === 0
    ? "(none)"
    : req.findings
      .map((f) => {
        const src = f.sourceDocument === undefined
          ? ""
          : ` [source: ${f.sourceDocument}${f.sourcePage === undefined ? "" : ` p.${f.sourcePage}`}]`;
        return `${f.id} | ${f.label} | asserts: ${f.assertion} | ${f.detail}${src}`;
      })
      .join("\n");

  const absent = req.absent.length === 0
    ? "(nothing recorded as searched-for-and-absent)"
    : req.absent.map((a) => `${a.field} - blocks: ${a.whatItBlocks}`).join("\n");

  return template
    .join("\n")
    .replace("{{compoundLabel}}", req.compoundLabel)
    .replace("{{context}}", req.context.trim() === "" ? "(none supplied)" : req.context)
    .replace("{{rules}}", rules)
    .replace("{{findings}}", findings)
    .replace("{{absent}}", absent);
}

export interface VerificationFailure {
  kind: "unknown_finding_id" | "unknown_rule_id" | "rule_not_addressed" | "rule_addressed_twice";
  detail: string;
}

/**
 * The deterministic check that stands between the model and the screen.
 *
 * Spec §10 rule 3: no model output reaches the screen unverified. This is plain
 * code and never a second model - a model grading a model reproduces the first
 * one's blind spots and adds a second set.
 *
 * It verifies what is mechanically checkable: that every cited id exists, and that
 * every registered rule is addressed exactly once. It CANNOT verify that a cited
 * finding actually supports the sentence attached to it - that is the
 * right-answer-wrong-reason failure, and spec §7.2a scores it by hand rather than
 * pretending this function catches it. Saying so here matters: a reader who thinks
 * this function certifies the reasoning will trust output it never examined.
 */
export function verifyAdjudication(
  a: Adjudication,
  req: AdjudicateRequest,
): VerificationFailure[] {
  const failures: VerificationFailure[] = [];
  const known = new Set(req.findings.map((f) => f.id));
  const registered = new Set(req.rules.map((r) => r.id));

  const checkIds = (ids: string[], where: string): void => {
    for (const id of ids) {
      if (!known.has(id)) {
        failures.push({ kind: "unknown_finding_id", detail: `${where} cites "${id}", which is not a finding in this case.` });
      }
    }
  };

  checkIds(a.mechanism.citedFindingIds, "mechanism");
  checkIds(a.consequence.citedFindingIds, "consequence");

  const seen = new Set<string>();
  for (const d of a.ruleDisclosure) {
    checkIds(d.citedFindingIds, `rule ${d.ruleId}`);
    if (!registered.has(d.ruleId)) {
      failures.push({ kind: "unknown_rule_id", detail: `Disclosure names "${d.ruleId}", which is not a registered rule.` });
      continue;
    }
    if (seen.has(d.ruleId)) {
      failures.push({ kind: "rule_addressed_twice", detail: `Rule ${d.ruleId} is addressed more than once.` });
    }
    seen.add(d.ruleId);
  }

  for (const id of registered) {
    if (!seen.has(id)) {
      failures.push({ kind: "rule_not_addressed", detail: `Rule ${id} was not addressed. A rule that does not apply must say so.` });
    }
  }

  return failures;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export async function handleAdjudicate(
  rawBody: unknown,
  complete: Complete | null,
  prompt: { system: string[]; userTemplate: string[] },
): Promise<ApiResponse> {
  if (complete === null) return { status: 503, body: { error: "no_key" } };
  if (!isAdjudicateRequest(rawBody)) return { status: 400, body: { error: "bad_request" } };

  try {
    const value = await complete(
      prompt.system.join("\n"),
      userPrompt(rawBody, prompt.userTemplate),
      adjudicationSchema(rawBody),
    );

    // Verified HERE, not by the caller. A 200 from this endpoint means the shape is
    // legal AND every citation resolves; anything else is a 502 the client treats
    // like any other upstream fault. Returning an unverified body and trusting the
    // caller to check is how an unverified body eventually reaches a screen.
    const failures = verifyAdjudication(value as Adjudication, rawBody);
    if (failures.length > 0) {
      return { status: 502, body: { error: "unverified", failures } };
    }
    return { status: 200, body: value };
  } catch {
    return { status: 502, body: { error: "upstream" } };
  }
}

function isAdjudicateRequest(u: unknown): u is AdjudicateRequest {
  if (typeof u !== "object" || u === null) return false;
  const b = u as Record<string, unknown>;
  if (typeof b["compoundLabel"] !== "string" || b["compoundLabel"].trim() === "") return false;
  if (typeof b["context"] !== "string") return false;
  if (!Array.isArray(b["rules"]) || !Array.isArray(b["findings"]) || !Array.isArray(b["absent"])) return false;

  const rulesOk = (b["rules"] as unknown[]).every((r) => {
    const x = r as Record<string, unknown>;
    return typeof x?.["id"] === "string" && typeof x?.["name"] === "string"
      && typeof x?.["statement"] === "string" && typeof x?.["enabled"] === "boolean"
      && typeof x?.["strength"] === "number";
  });
  const findingsOk = (b["findings"] as unknown[]).every((f) => {
    const x = f as Record<string, unknown>;
    return typeof x?.["id"] === "string" && typeof x?.["label"] === "string"
      && (x?.["assertion"] === "toxic" || x?.["assertion"] === "safe" || x?.["assertion"] === "ambiguous")
      && typeof x?.["detail"] === "string";
  });
  const absentOk = (b["absent"] as unknown[]).every((a) => {
    const x = a as Record<string, unknown>;
    return typeof x?.["field"] === "string" && typeof x?.["whatItBlocks"] === "string";
  });

  // Rules must be non-empty: an adjudication with nothing to disclose against is
  // not a weaker adjudication, it is a different product.
  return rulesOk && findingsOk && absentOk && (b["rules"] as unknown[]).length > 0;
}
