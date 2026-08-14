import { describe, expect, it, vi } from "vitest";
import { MAX_SUMMARY_CHARS, SUMMARY_QUESTION, handleSummarise } from "../summarise.js";
import { SYSTEM } from "../ask.js";

const page = (n: number, text = "hepatic necrosis at 20 mg/kg"): { page: number; text: string } => ({ page: n, text });

/** A model that records what it was asked and answers with a citation to page 1. */
const spy = (): { complete: any; calls: { system: string; user: string; schema: any }[] } => {
  const calls: { system: string; user: string; schema: any }[] = [];
  const complete = vi.fn(async (system: string, user: string, schema: unknown) => {
    calls.push({ system, user, schema });
    return { answerable: true, answer: "A 12-week study reports hepatic necrosis.", citedPassages: ["1"] };
  });
  return { complete, calls };
};

describe("summarising a whole document", () => {
  it("sends EVERY page, not a retrieved subset - that is what makes it a summary", async () => {
    // Retrieval picks eight pages by word overlap, and "summary" overlaps with nothing
    // in particular. A summary built from eight pages chosen that way is a summary of
    // eight pages, and the model was right to refuse to call it one.
    const { complete, calls } = spy();
    const pages = [page(1, "first page"), page(2, "second page"), page(177, "last page")];
    const r = await handleSummarise(pages, "review.pdf", complete);

    expect(r.status).toBe(200);
    expect(calls[0]!.user).toContain("first page");
    expect(calls[0]!.user).toContain("last page");
    expect(calls[0]!.user).toContain("page 177");
  });

  it("constrains citations to pages that exist, exactly as a question does", async () => {
    const { complete, calls } = spy();
    await handleSummarise([page(1), page(2), page(3)], "review.pdf", complete);
    const schema = calls[0]!.schema as { properties: { citedPassages: { items: { enum?: string[] } } } };
    expect(schema.properties.citedPassages.items.enum).toEqual(["1", "2", "3"]);
  });

  it("keeps the ask surface's own instructions, including never giving a verdict", async () => {
    // A summary of a safety review is the single most tempting place to write "the
    // liver signal is manageable". The line that forbids it is the ask prompt's, and
    // this must not quietly become a second, laxer prompt.
    const { complete, calls } = spy();
    await handleSummarise([page(1)], "review.pdf", complete);
    expect(calls[0]!.system).toBe(SYSTEM);
    expect(SUMMARY_QUESTION).toMatch(/do not judge the compound/i);
  });

  it("refuses a document with no readable pages, without spending a call", async () => {
    const { complete } = spy();
    const r = await handleSummarise([], "review.pdf", complete);
    expect(r.status).toBe(422);
    expect(complete).not.toHaveBeenCalled();
  });

  it("refuses a document too large to send whole, and says how large it is", async () => {
    // Sampling it instead would produce a summary that LOOKS complete. The refusal is
    // the honest branch: the reader is told the document exceeded the window rather
    // than handed a summary of the part that fitted.
    const { complete } = spy();
    const huge = [page(1, "x".repeat(MAX_SUMMARY_CHARS + 1))];
    const r = await handleSummarise(huge, "review.pdf", complete);
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.body)).toContain(MAX_SUMMARY_CHARS.toLocaleString("en-US"));
    expect(JSON.stringify(r.body)).toContain((MAX_SUMMARY_CHARS + 1).toLocaleString("en-US"));
    expect(complete).not.toHaveBeenCalled();
  });

  it("reports no credentials as 503, so the client can descend", async () => {
    const r = await handleSummarise([page(1)], "review.pdf", null);
    expect(r.status).toBe(503);
  });
});
