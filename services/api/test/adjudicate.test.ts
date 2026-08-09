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
