import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  adjudicationSchema, handleAdjudicate, userPrompt, verifyAdjudication,
  type AdjudicateRequest, type Adjudication,
} from "../adjudicate.js";

const PROMPT = JSON.parse(readFileSync("prompts/adjudicator-v1.0.json", "utf8")) as {
  system: string[]; userTemplate: string[];
};

const REQUEST: AdjudicateRequest = {
  compoundLabel: "TAK-994",
  context: "Narcolepsy type 1. Chronic dosing in otherwise healthy adults.",
  rules: [
    { id: "R1", name: "Human relevance", statement: "Human-cell evidence defeats animal in vivo.", enabled: true, strength: 0.9 },
    { id: "R3", name: "Exposure relevance", statement: "A positive at clinical exposure defeats an untested negative.", enabled: true, strength: 0.85 },
  ],
  findings: [
    { id: "f1", label: "rodent 28-day", assertion: "safe", detail: "No hepatic findings at 3x projected human exposure." },
    { id: "f2", label: "HepG2 cytotoxicity", assertion: "toxic", detail: "Cell death at 30 uM." },
  ],
  absent: [{ field: "clinical Cmax", whatItBlocks: "Cannot establish an exposure margin for f1." }],
};

const VALID: Adjudication = {
  mechanism: { present: true, pathway: "hepatocyte death", citedFindingIds: ["f2"] },
  consequence: { verdict: "cannot_conclude", reasoning: "No margin for the clean study.", citedFindingIds: ["f1", "f2"] },
  // Empty and legal: this REQ carries no `present`, and the verdict is `cannot_conclude`,
  // which is the one verdict that needs no consequence-half evidence behind it.
  consequenceBasis: [],
  ruleDisclosure: [
    { ruleId: "R1", position: "applies", reasoning: "Human cell data present.", citedFindingIds: ["f2"] },
    { ruleId: "R3", position: "applies", reasoning: "f1's margin is unestablished.", citedFindingIds: ["f1"] },
  ],
  missing: [{ field: "clinical Cmax", whyItMatters: "Without it f1 rules out less than it appears to." }],
  nextExperiment: "Human hepatocyte assay at clinical exposure.",
};

describe("adjudicationSchema", () => {
  it("constrains cited ids to the findings the CALLER sent", () => {
    // The structural guarantee interpret.ts already relies on, applied here: the
    // model has nowhere in the schema to put a finding that does not exist.
    const s = adjudicationSchema(REQUEST) as any;
    expect(s.properties.mechanism.properties.citedFindingIds.items.enum).toEqual(["f1", "f2"]);
    expect(s.properties.consequence.properties.citedFindingIds.items.enum).toEqual(["f1", "f2"]);
    expect(s.properties.ruleDisclosure.items.properties.ruleId.enum).toEqual(["R1", "R3"]);
  });

  it("requires exactly one disclosure per registered rule", () => {
    const s = adjudicationSchema(REQUEST) as any;
    expect(s.properties.ruleDisclosure.minItems).toBe(2);
    expect(s.properties.ruleDisclosure.maxItems).toBe(2);
  });

  it("stays satisfiable for a compound with no findings at all", () => {
    // A case with nothing in it must arrive as the "cannot conclude" it plainly is,
    // NOT fail at the model against an unsatisfiable empty enum. An earlier draft
    // emitted `enum: []`, which no string can satisfy.
    const s = adjudicationSchema({ ...REQUEST, findings: [] }) as any;
    expect(s.properties.consequence.properties.citedFindingIds.items).toEqual({ type: "string" });
  });
});

describe("verifyAdjudication", () => {
  it("passes a well-formed adjudication", () => {
    expect(verifyAdjudication(VALID, REQUEST)).toEqual([]);
  });

  it("catches a cited finding that does not exist", () => {
    const bad = { ...VALID, consequence: { ...VALID.consequence, citedFindingIds: ["f1", "f99"] } };
    const failures = verifyAdjudication(bad, REQUEST);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.kind).toBe("unknown_finding_id");
    expect(failures[0]!.detail).toContain("f99");
  });

  it("catches a registered rule that was never addressed", () => {
    // "A rule that does not apply must say so." Silence is the failure this catches,
    // and it is the one a schema alone cannot: minItems counts entries, not which.
    const bad = { ...VALID, ruleDisclosure: [VALID.ruleDisclosure[0]!, VALID.ruleDisclosure[0]!] };
    const failures = verifyAdjudication(bad, REQUEST);
    expect(failures.map((f) => f.kind).sort()).toEqual(["rule_addressed_twice", "rule_not_addressed"]);
  });

  it("catches an invented rule id", () => {
    const bad = {
      ...VALID,
      ruleDisclosure: [VALID.ruleDisclosure[0]!, { ruleId: "R9", position: "applies" as const, reasoning: "x", citedFindingIds: [] }],
    };
    const kinds = verifyAdjudication(bad, REQUEST).map((f) => f.kind);
    expect(kinds).toContain("unknown_rule_id");
    expect(kinds).toContain("rule_not_addressed");
  });

  it("checks ids cited inside a rule disclosure, not only the top-level ones", () => {
    // Easy to miss: an implementation that verifies mechanism and consequence but
    // trusts the disclosure array leaves a hole exactly where the reasoning lives.
    const bad = {
      ...VALID,
      ruleDisclosure: [VALID.ruleDisclosure[0]!, { ...VALID.ruleDisclosure[1]!, citedFindingIds: ["nope"] }],
    };
    const failures = verifyAdjudication(bad, REQUEST);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.kind).toBe("unknown_finding_id");
    expect(failures[0]!.detail).toContain("R3");
  });

  // §0: five over-calls on approved drugs came from a severity verdict resting on
  // mechanism evidence alone. These four cases are that defect, made unrepresentable.
  const WITH_INVENTORY: AdjudicateRequest = {
    ...REQUEST,
    present: [
      { field: "Human-cell hepatotoxicity result", half: "mechanism" },
      { field: "Reversibility on withdrawal", half: "consequence" },
    ],
  };

  it("lets a decisive verdict stand when it names present consequence-half evidence", () => {
    const ok = {
      ...VALID,
      consequence: { ...VALID.consequence, verdict: "do_not_advance" as const },
      consequenceBasis: ["Reversibility on withdrawal"],
    };
    expect(verifyAdjudication(ok, WITH_INVENTORY)).toEqual([]);
  });

  it("catches a severity verdict resting on nothing measured", () => {
    // The live failure this check was built for: the model justified `do_not_advance`
    // with "severe, irreversible" while reversibility was recorded ABSENT.
    const bad = {
      ...VALID,
      consequence: { ...VALID.consequence, verdict: "do_not_advance" as const },
      consequenceBasis: [],
    };
    const kinds = verifyAdjudication(bad, WITH_INVENTORY).map((f) => f.kind);
    expect(kinds).toContain("consequence_without_basis");
  });

  it("refuses a basis the inventory does not record as present", () => {
    const bad = { ...VALID, consequenceBasis: ["Expected frequency and the population"] };
    const kinds = verifyAdjudication(bad, WITH_INVENTORY).map((f) => f.kind);
    expect(kinds).toContain("unknown_basis");
  });

  it("exempts cannot_conclude, which is the answer an unmeasured consequence half has", () => {
    // Without this exemption a package with nothing on the consequence side would have
    // no legal verdict at all, and the check would be a deadlock rather than a floor.
    const ok = { ...VALID, consequence: { ...VALID.consequence, verdict: "cannot_conclude" as const }, consequenceBasis: [] };
    expect(verifyAdjudication(ok, WITH_INVENTORY)).toEqual([]);
  });

  it("stays inert when the request carries no inventory, rather than failing every run", () => {
    // REQUEST has no `present`. The probe case is built from a fixture and never will.
    const decisive = { ...VALID, consequence: { ...VALID.consequence, verdict: "do_not_advance" as const } };
    expect(verifyAdjudication(decisive, REQUEST)).toEqual([]);
  });
});

describe("POST /api/adjudicate", () => {
  it("returns 503 no_key without calling a model", async () => {
    const res = await handleAdjudicate(REQUEST, null, PROMPT);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "no_key" });
  });

  it("rejects a malformed request before it can cost a token", async () => {
    const complete = vi.fn();
    const res = await handleAdjudicate({ compoundLabel: "" }, complete, PROMPT);
    expect(res.status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });

  it("accepts an 'ambiguous' assertion, because the engine has three", async () => {
    // REGRESSION. This validator allowed only toxic and safe, and the real TAK-994
    // fixture was rejected on its QSAR claim - which asserts `ambiguous`, the honest
    // reading of a structural prediction resolving neither way. A narrowed validator
    // does not merely reject the request; used less strictly it would DROP the claim
    // and adjudicate on evidence a reviewer believes was considered.
    // packages/engine/src/types.ts:2 is the authority: "toxic" | "safe" | "ambiguous".
    const complete = vi.fn().mockResolvedValue({
      ...VALID,
      consequence: { ...VALID.consequence, citedFindingIds: ["f1", "f2", "f3"] },
      mechanism: { ...VALID.mechanism, citedFindingIds: [] },
    });
    const req: AdjudicateRequest = {
      ...REQUEST,
      findings: [...REQUEST.findings, { id: "f3", label: "QSAR", assertion: "ambiguous", detail: "Resolves neither way." }],
    };
    const res = await handleAdjudicate(req, complete, PROMPT);
    expect(res.status).toBe(200);
    expect(complete).toHaveBeenCalled();
  });

  it("still rejects an assertion the engine does not have", async () => {
    // The other half: widening to three must not become "accept any string".
    const complete = vi.fn();
    const req = {
      ...REQUEST,
      findings: [{ id: "f9", label: "x", assertion: "probably-fine", detail: "y" }],
    };
    const res = await handleAdjudicate(req, complete, PROMPT);
    expect(res.status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects a request carrying no rules at all", async () => {
    // An adjudication with nothing to disclose against is not a weaker
    // adjudication; the required-disclosure property is the product.
    const complete = vi.fn();
    const res = await handleAdjudicate({ ...REQUEST, rules: [] }, complete, PROMPT);
    expect(res.status).toBe(400);
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns 502 unverified rather than 200 when the model cites a phantom finding", async () => {
    // THE LOAD-BEARING TEST. A well-formed 200 carrying an invented citation is the
    // case that reaches a screen if verification is left to the caller. Breaking
    // handleAdjudicate to return the body unchecked makes this the only failure.
    const complete = vi.fn().mockResolvedValue({
      ...VALID,
      mechanism: { ...VALID.mechanism, citedFindingIds: ["ghost"] },
    });
    const res = await handleAdjudicate(REQUEST, complete, PROMPT);
    expect(res.status).toBe(502);
    expect((res.body as any).error).toBe("unverified");
    expect((res.body as any).failures[0].kind).toBe("unknown_finding_id");
  });

  it("returns 200 with the adjudication when everything verifies", async () => {
    const complete = vi.fn().mockResolvedValue(VALID);
    const res = await handleAdjudicate(REQUEST, complete, PROMPT);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(VALID);
  });

  it("turns an upstream fault into 502 without echoing it", async () => {
    // The message can quote the request, and the request is the only thing here
    // adjacent to a credential. Same reasoning as interpret.ts.
    const complete = vi.fn().mockRejectedValue(new Error("sk-ant-secret leaked in a stack trace"));
    const res = await handleAdjudicate(REQUEST, complete, PROMPT);
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("sk-ant");
  });
});

describe("userPrompt", () => {
  it("sends the evidence VALUES, unlike surface 1", async () => {
    const text = userPrompt(REQUEST, PROMPT.userTemplate);
    expect(text).toContain("No hepatic findings at 3x projected human exposure.");
    expect(text).toContain("asserts: toxic");
  });

  it("states what was searched for and not found", () => {
    // Absence is a finding (spec §3.2). If it never reaches the prompt, the model
    // cannot report it and the product's most valuable output disappears silently.
    const text = userPrompt(REQUEST, PROMPT.userTemplate);
    expect(text).toContain("clinical Cmax");
    expect(text).toContain("Cannot establish an exposure margin");
  });

  it("never leaves an unfilled placeholder in the prompt", () => {
    // A stray {{...}} reaches the model as literal braces and quietly degrades the
    // instruction rather than failing.
    const text = userPrompt({ ...REQUEST, context: "", findings: [], absent: [] }, PROMPT.userTemplate);
    expect(text).not.toMatch(/\{\{|\}\}/);
  });
});

describe("the registered prompt", () => {
  it("forbids calling a compound safe", () => {
    // HANDOVER §1.3 applies to generated text exactly as to hand-written copy, and
    // the prompt is where that is enforced for the model.
    expect(PROMPT.system.join("\n")).toContain("NEVER CALL A COMPOUND SAFE");
  });

  it("separates mechanism from consequence, which is the whole redesign", () => {
    // Matched against the joined text with line breaks collapsed: the prompt is
    // stored as an array of display lines, so a phrase that reads as one sentence
    // is split by a newline in the middle. Asserting on the raw join makes this
    // test fail for a formatting reason while the instruction is perfectly present.
    const joined = PROMPT.system.join(" ").replace(/\s+/g, " ");
    expect(joined).toContain("MECHANISM");
    expect(joined).toContain("CONSEQUENCE");
    expect(joined).toContain("Never let a mechanism finding alone produce");
  });
});
