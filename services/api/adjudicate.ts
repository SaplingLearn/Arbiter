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
  /**
   * Checklist items the inventory marks PRESENT, tagged by half. Feeds
   * `consequenceBasis` below: a severity verdict must name evidence from here, so an
   * absent dimension is unnameable rather than merely discouraged.
   *
   * OPTIONAL, deliberately. The deliberation path builds a request from an inventory
   * and supplies it; `data/probe-case.json` is built by tools/build_probe_case.py from
   * a fixture and carries no inventory at all, so it cannot. Making this required would
   * have forced that script to reimplement inventory.ts in Python - the duplicated
   * DEFINITION this project keeps refusing - or invalidated the committed 20-run
   * baseline in results/probe-runs.json.
   *
   * The cost is stated rather than hidden: the basis requirement binds on the PRODUCT
   * path and is inert on the probe. So the probe cannot measure it, and closing that
   * gap means giving the probe case an inventory rather than weakening this.
   */
  present?: { field: string; half: "mechanism" | "consequence" }[];
}

/**
 * THE ONE COPY OF THE ADJUDICATOR PROMPT PATH.
 *
 * Same argument as interpret.ts's model constants, and the same failure it prevents.
 * This literal was written out in five files - server.ts, probe.ts,
 * deliberation-demo.ts and two test files - so minting prompt v1.1 was five chances to
 * update four of them. probe.ts is the trap again: it hashes whatever it loaded into
 * `promptHash` and writes that beside the result, so a probe reading v1.0 while the
 * server ran v1.1 would produce a correctly-hashed, honestly-labelled measurement OF
 * THE WRONG PROMPT. §7.2a's rule that a number belongs to the prompt version that
 * produced it is only enforceable if there is one answer to which version that was.
 *
 * v1.0 is never deleted and never edited - it is the version every result already
 * committed was measured under. Pointing here at v1.1 changes what runs NEXT.
 */
export const ADJUDICATOR_PROMPT_PATH = "prompts/adjudicator-v1.1.json";

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
  /**
   * Which PRESENT consequence-half checklist items the severity call rests on.
   *
   * §0's defect in one field. The engine said `do_not_advance` about prochlorperazine,
   * thioridazine, glyburide, mifepristone and irbesartan on mechanism evidence alone,
   * and the audit's conclusion was structural rather than a threshold: "a system with
   * no severity inputs cannot produce severity judgments." A model given the same six
   * thin fields fails the same way but persuasively - §9's *fluent wrongness*.
   *
   * Measured, on a live run of this exact prompt: the model justified `do_not_advance`
   * with "single-cell necrosis is a severe, IRREVERSIBLE form of cellular injury" while
   * the inventory it had been handed recorded `C4 Reversibility on withdrawal` as
   * ABSENT. Neither "severe" nor "irreversible" appears in any finding. Every
   * deterministic check passed, because they check ids and this was an adjective.
   *
   * Enum-constrained to the request's PRESENT consequence-half fields, so a severity
   * claim on an unmeasured dimension is unrepresentable - the same guarantee
   * interpret.ts describes as "there is nowhere to put an invented rule". It does NOT
   * stop the prose saying "irreversible"; it stops the VERDICT resting on it.
   */
  consequenceBasis: string[];
  ruleDisclosure: {
    ruleId: string;
    position: "applies" | "does_not_apply" | "cannot_determine";
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
  const absentFields = req.absent.map((a) => a.field);
  // Consequence half only. A severity call resting on mechanism evidence is precisely
  // the §0 defect - five over-calls on approved drugs - so mechanism-half items are
  // deliberately not offered here even though they are present.
  const basisFields = (req.present ?? []).filter((p) => p.half === "consequence").map((p) => p.field);

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
    required: ["mechanism", "consequence", "consequenceBasis", "ruleDisclosure", "missing", "nextExperiment"],
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
            // THREE positions, not two. Added 2026-08-10.
            //
            // §5.1 is right that "a rule that does not apply must be stated as not
            // applying, with a reason - that is information, not a gap". But "this rule
            // does not bite on this evidence" and "this package does not contain what
            // the rule turns on" are different facts, and a two-value enum forces the
            // second to be reported as the first. That is §10 rule 7 - "not measured"
            // and "measured negative" rendering alike - inside the disclosure itself.
            //
            // Measured: at default temperature R4 sat at exactly 50/50 across 20 runs
            // (applies:10, does_not_apply:10). Its determining field never reaches the
            // model, so both answers were guesses and the model had no legal way to
            // say so. A coin flip is what a forced binary looks like from outside.
            //
            // THE RISK, stated because it must be measured rather than assumed: a
            // third option is an escape hatch, and a model that reaches for it on rules
            // it could have answered produces less information than the binary did.
            // `reasoning` is required on every disclosure, so the escape is at least
            // never silent - but whether it is over-used is a number, and the probe is
            // where it should be read.
            position: { type: "string", enum: ["applies", "does_not_apply", "cannot_determine"] },
            reasoning: { type: "string" },
            citedFindingIds: citedIds,
          },
        },
      },
      // Enum-constrained to PRESENT consequence-half fields.
      //
      // WHEN THERE ARE NONE - the probe case carries no inventory, and TAK-994 has all
      // six of C1..C6 absent - this falls back to a free string rather than an empty
      // enum, matching `citedIds` above. That fallback is weaker HERE than it is there,
      // and the difference is worth naming: an empty `findingIds` means any string is
      // as useless as another, whereas an empty `basisFields` means no string is legal
      // and the fallback actively invites the model to invent one. An empty `enum` would
      // express it exactly, but validator support for that is not uniform and an
      // unsatisfiable schema fails the whole request rather than one field.
      //
      // So in the empty case the constraint is enforced by `verifyAdjudication`, not by
      // the schema: an invented basis is `unknown_basis`, and a decisive verdict with
      // none is `consequence_without_basis`. Structural where it can be, verified where
      // it cannot - and said out loud so nobody reads the enum as a guarantee it isn't.
      consequenceBasis: {
        type: "array",
        items: basisFields.length > 0
          ? { type: "string", enum: basisFields }
          : { type: "string" },
      },
      missing: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["field", "whyItMatters"],
          properties: {
            // Built FROM THE REQUEST, exactly as ruleId and citedFindingIds are, so
            // there is nowhere to put an invented gap.
            //
            // This was a free string until 2026-08-10, which left `missing` as the one
            // model-authored field in this schema with NEITHER a structural constraint
            // nor a verification check - on the surface §3.2 calls "the failure mode
            // this project exists to prevent". A fabricated absence is worse than a
            // fabricated citation: a citation names a finding a reader can go and fail
            // to find, whereas an invented gap sends someone to run an experiment that
            // was already run, and a dropped one is the TAK-994 silence itself.
            //
            // Same empty-case fallback as citedIds: a case with nothing recorded as
            // searched-for-and-absent must still produce a legal (empty) array rather
            // than an unsatisfiable schema.
            field: absentFields.length > 0
              ? { type: "string", enum: absentFields }
              : { type: "string" },
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

  // The legal values for `consequenceBasis`, shown to the model rather than left to be
  // guessed. Until prompt v1.1 the schema required this field and the template never
  // named the list it must be drawn from, so the model supplied a finding id and
  // verifyAdjudication rejected it as unknown_basis - a contract the model could not
  // satisfy, not a model that would not follow it.
  //
  // Consequence half only, matching adjudicationSchema's enum exactly. Offering the
  // mechanism half here would invite the substitution §0 measured.
  //
  // The empty case is spelled out rather than left blank: "(none)" beside a required
  // field reads as an omission, and this is a finding - it is the sentence that makes
  // cannot_conclude the answerable verdict.
  const consequencePresent = (req.present ?? []).filter((p) => p.half === "consequence");
  const present = consequencePresent.length === 0
    ? "(none - nothing on the consequence side of this package was measured)"
    : consequencePresent.map((p) => p.field).join("\n");

  return template
    .join("\n")
    .replace("{{compoundLabel}}", req.compoundLabel)
    .replace("{{context}}", req.context.trim() === "" ? "(none supplied)" : req.context)
    .replace("{{rules}}", rules)
    .replace("{{findings}}", findings)
    .replace("{{absent}}", absent)
    // A no-op against prompt v1.0, which has no such placeholder. That is deliberate:
    // an older prompt version must keep rendering exactly as it did, or a result
    // reported under it stops being reproducible - §7.2a's rule that a number belongs
    // to the prompt version that produced it.
    .replace("{{present}}", present);
}

export interface VerificationFailure {
  kind:
    | "unknown_finding_id"
    | "unknown_rule_id"
    | "rule_not_addressed"
    | "rule_addressed_twice"
    | "unknown_absence"
    | "absence_not_addressed"
    | "absence_addressed_twice"
    | "unknown_basis"
    | "consequence_without_basis";
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

  // The same three checks again, for absences, because §3.2 makes absence a finding and
  // a finding gets checked. Until 2026-08-10 `missing` was the only model-authored field
  // here that nothing verified, which put the project's own stated failure mode on its
  // one unguarded surface: TAK-994's package looked complete because nobody named what
  // was missing, and an adjudication that quietly drops a recorded gap reproduces that
  // exactly - fluently, and over a signature.
  //
  // `unknown_absence` should now be unreachable for a schema-honouring model, since
  // `missing.field` is enum-constrained. It is checked anyway: the schema is the model's
  // constraint and this is ours, and §10 rule 3 is about what reaches the screen rather
  // than about what the model was asked for.
  const recorded = new Set(req.absent.map((x) => x.field));
  const addressed = new Set<string>();

  for (const m of a.missing) {
    if (!recorded.has(m.field)) {
      failures.push({
        kind: "unknown_absence",
        detail: `Missing-evidence list names "${m.field}", which is not recorded as searched-for-and-absent in this case.`,
      });
      continue;
    }
    if (addressed.has(m.field)) {
      failures.push({ kind: "absence_addressed_twice", detail: `Absence "${m.field}" is listed more than once.` });
    }
    addressed.add(m.field);
  }

  for (const field of recorded) {
    if (!addressed.has(field)) {
      failures.push({
        kind: "absence_not_addressed",
        detail: `"${field}" was recorded as searched-for-and-absent and the adjudication does not carry it. A gap that is dropped rather than stated is the silence §3.2 exists to prevent.`,
      });
    }
  }

  // §0, enforced. A severity verdict must name present consequence-half evidence.
  //
  // ONLY when the request carries an inventory: `present` is optional because the
  // probe case is built from a fixture and has none, and a check that silently
  // passed on a request that could never satisfy it would be worse than absent.
  if (req.present !== undefined) {
    const allowed = new Set(req.present.filter((p) => p.half === "consequence").map((p) => p.field));
    const cited = new Set<string>();

    // `?? []` because `a` is JSON.parse of model output, not a typed value. A model
    // that omits the field despite the schema's `required` must produce a recorded
    // failure, not a TypeError from this function - and an omitted basis on a decisive
    // verdict then falls through to `consequence_without_basis` below, which is the
    // right answer rather than a lenient one.
    for (const b of a.consequenceBasis ?? []) {
      if (!allowed.has(b)) {
        failures.push({
          kind: "unknown_basis",
          detail: `Consequence rests on "${b}", which the inventory does not record as present consequence-half evidence in this case.`,
        });
        continue;
      }
      cited.add(b);
    }

    // `cannot_conclude` is exempt, and that exemption is the whole design. The verdict
    // this check forces when the consequence half is unmeasured is not a refusal to
    // answer - it IS the answer, and it is the one §0 says the engine should have given
    // about irbesartan. Requiring a basis for it too would leave no legal output at all.
    const decisive = a.consequence.verdict === "advance" || a.consequence.verdict === "do_not_advance";
    if (decisive && cited.size === 0) {
      failures.push({
        kind: "consequence_without_basis",
        detail: `Verdict "${a.consequence.verdict}" is a severity call and cites no present consequence-half evidence. Nothing on the consequence side of this package was measured, so there is nothing for it to rest on; the answerable verdict is "cannot_conclude".`,
      });
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
