import { describe, expect, it } from "vitest";
import {
  extractionSchema,
  extractUserPrompt,
  handleExtract,
  verifyExtraction,
  type ExtractRequest,
  type Extraction,
  type ProposedFinding,
} from "../extract.js";

/**
 * The tests that matter here are the ones about FABRICATION, because the pass mark
 * for it is zero rather than small. Each is written so that it fails against an
 * implementation that merely trusts the model.
 */

const PAGE_41 = `
5.2 Repeat-dose toxicity

In the 13-week repeat-dose toxicity study in Sprague-Dawley rats, ALT elevations
of up to 4-fold were observed at 100 mg/kg/day, accompanied by centrilobular
hepatocellular hypertrophy. The NOAEL was established at 30 mg/kg/day.
`;

const PAGE_42 = `
5.3 Genotoxicity

The compound was negative in the Ames assay and in the in vitro micronucleus
assay in human peripheral blood lymphocytes.
`;

const REQ: ExtractRequest = {
  documentName: "FDA NDA 999999 Multi-disciplinary Review",
  compoundLabel: "Compound X",
  checklist: [
    { id: "M1", field: "Human-cell hepatotoxicity result" },
    { id: "C1", field: "Injury pattern: hepatocellular, cholestatic or mixed" },
  ],
  pages: [{ page: 41, text: PAGE_41 }, { page: 42, text: PAGE_42 }],
};

function finding(over: Partial<ProposedFinding> = {}): ProposedFinding {
  return {
    id: "X:alt-elevation",
    label: "ALT elevation with centrilobular hypertrophy",
    assertion: "toxic",
    detail: "Four-fold ALT elevation at 100 mg/kg/day with centrilobular hepatocellular hypertrophy.",
    quote: "ALT elevations\nof up to 4-fold were observed at 100 mg/kg/day",
    sourcePage: 41,
    covers: ["C1"],
    ...over,
  };
}

const ok = (findings: ProposedFinding[]): Extraction => ({ findings });

describe("verifyExtraction — fabrication", () => {
  it("keeps a finding whose quote really is on the page it cites", () => {
    const r = verifyExtraction(ok([finding()]), REQ);
    expect(r.failures).toEqual([]);
    expect(r.findings).toHaveLength(1);
  });

  it("tolerates the line breaks PDF extraction inserts mid-sentence", () => {
    // Without whitespace normalisation this check rejects every honest quote, and a
    // check with a 100% false-positive rate is deleted within a week.
    const r = verifyExtraction(ok([finding({ quote: "ALT   elevations of up to 4-fold\n\n were observed" })]), REQ);
    expect(r.failures).toEqual([]);
  });

  it("DISCARDS a finding whose quote appears nowhere on the page", () => {
    const r = verifyExtraction(ok([finding({
      quote: "Massive hepatic necrosis was observed in all treated animals",
    })]), REQ);
    expect(r.findings).toEqual([]);
    expect(r.failures[0]!.kind).toBe("quote_not_on_page");
  });

  it("DISCARDS a quote that exists in the document but not on the cited page", () => {
    // A real span attached to the wrong page is a citation a reviewer cannot follow,
    // and it is exactly what a model does when it half-remembers where it read something.
    const r = verifyExtraction(ok([finding({
      quote: "negative in the Ames assay",
      sourcePage: 41,
    })]), REQ);
    expect(r.failures[0]!.kind).toBe("quote_not_on_page");
  });

  it("DISCARDS an empty quote rather than treating the check as trivially satisfied", () => {
    const r = verifyExtraction(ok([finding({ quote: "   " })]), REQ);
    expect(r.failures[0]!.kind).toBe("empty_quote");
  });

  it("does not accept an approximate quote", () => {
    // One word changed. If this passes, the check can no longer tell a copied span
    // from an invented one, which is the only thing it exists to do.
    const r = verifyExtraction(ok([finding({
      quote: "ALT elevations of up to 8-fold were observed at 100 mg/kg/day",
    })]), REQ);
    expect(r.failures[0]!.kind).toBe("quote_not_on_page");
  });
});

describe("verifyExtraction — the rest of the contract", () => {
  it("discards a finding citing a page that was never supplied", () => {
    const r = verifyExtraction(ok([finding({ sourcePage: 99 })]), REQ);
    expect(r.failures[0]!.kind).toBe("unknown_page");
  });

  it("discards a finding claiming to cover an unregistered checklist question", () => {
    const r = verifyExtraction(ok([finding({ covers: ["M1", "Z9"] })]), REQ);
    expect(r.failures[0]!.kind).toBe("unknown_checklist_id");
  });

  it("accepts an empty covers list, because a real finding answering none of the twelve is ordinary", () => {
    // Forcing a declaration would manufacture coverage, which is the failure the
    // inventory exists to prevent.
    const r = verifyExtraction(ok([finding({ covers: [] })]), REQ);
    expect(r.failures).toEqual([]);
  });

  it("discards a repeated id rather than letting one finding overwrite another downstream", () => {
    const r = verifyExtraction(ok([finding(), finding()]), REQ);
    expect(r.findings).toHaveLength(1);
    expect(r.failures[0]!.kind).toBe("duplicate_id");
  });

  it("costs the bad finding and not the whole extraction", () => {
    // One fabrication in a set should not throw away the honest findings beside it.
    const good = finding();
    const bad = finding({ id: "X:invented", quote: "no such sentence anywhere" });
    const r = verifyExtraction(ok([good, bad]), REQ);
    expect(r.findings.map((f) => f.id)).toEqual(["X:alt-elevation"]);
    expect(r.failures).toHaveLength(1);
  });

  it("names what was discarded and why, so the reviewer learns how far to trust this document's extraction", () => {
    const r = verifyExtraction(ok([finding({ quote: "invented" })]), REQ);
    expect(r.failures[0]!.findingId).toBe("X:alt-elevation");
    expect(r.failures[0]!.detail).toContain("page 41");
  });
});

describe("extractionSchema", () => {
  it("constrains sourcePage to pages that were actually sent", () => {
    const s = extractionSchema(REQ) as never as {
      properties: { findings: { items: { properties: { sourcePage: { enum: number[] } } } } };
    };
    expect(s.properties.findings.items.properties.sourcePage.enum).toEqual([41, 42]);
  });

  it("constrains covers to registered checklist ids", () => {
    const s = extractionSchema(REQ) as never as {
      properties: { findings: { items: { properties: { covers: { items: { enum: string[] } } } } } };
    };
    expect(s.properties.findings.items.properties.covers.items.enum).toEqual(["M1", "C1"]);
  });

  it("stays satisfiable when a document has no checklist, instead of failing at the model", () => {
    const s = extractionSchema({ ...REQ, checklist: [] }) as never as {
      properties: { findings: { items: { properties: { covers: { items: Record<string, unknown> } } } } };
    };
    expect(s.properties.findings.items.properties.covers.items["enum"]).toBeUndefined();
  });

  it("requires a quote on every finding, because that is the anti-fabrication mechanism", () => {
    const s = extractionSchema(REQ) as never as {
      properties: { findings: { items: { required: string[] } } };
    };
    expect(s.properties.findings.items.required).toContain("quote");
  });
});

describe("extractUserPrompt", () => {
  it("labels each page so a cited page number means something", () => {
    const p = extractUserPrompt(REQ);
    expect(p).toContain("--- page 41 ---");
    expect(p).toContain("--- page 42 ---");
  });

  it("sends the checklist question text, not only its id", () => {
    expect(extractUserPrompt(REQ)).toContain("M1: Human-cell hepatotoxicity result");
  });
});

describe("handleExtract", () => {
  it("answers 503 with no key rather than failing to start", async () => {
    expect((await handleExtract(REQ, null)).status).toBe(503);
  });

  it("rejects a request with no pages", async () => {
    const r = await handleExtract({ ...REQ, pages: [] }, async () => ok([]));
    expect(r.status).toBe(400);
  });

  it("rejects a malformed request", async () => {
    expect((await handleExtract({ documentName: 5 }, async () => ok([]))).status).toBe(400);
  });

  it("returns the verified findings and marks them as awaiting approval", async () => {
    const r = await handleExtract(REQ, async () => ok([finding()]));
    const body = r.body as { findings: ProposedFinding[]; awaitingApproval: boolean };
    expect(r.status).toBe(200);
    expect(body.findings).toHaveLength(1);
    // The flag is not decoration. Nothing downstream may treat this as evidence.
    expect(body.awaitingApproval).toBe(true);
  });

  it("returns 200 with the fabricated finding removed and named", async () => {
    const r = await handleExtract(REQ, async () => ok([finding(), finding({ id: "X:made-up", quote: "nowhere" })]));
    const body = r.body as { findings: ProposedFinding[]; discarded: { kind: string }[] };
    expect(body.findings).toHaveLength(1);
    expect(body.discarded[0]!.kind).toBe("quote_not_on_page");
  });

  it("returns an empty list rather than inventing content for a document reporting no studies", async () => {
    const r = await handleExtract(REQ, async () => ok([]));
    expect((r.body as { findings: unknown[] }).findings).toEqual([]);
  });

  it("answers 502 when the model call throws", async () => {
    const r = await handleExtract(REQ, async () => { throw new Error("upstream"); });
    expect(r.status).toBe(502);
  });
});
