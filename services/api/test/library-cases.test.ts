import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { CATALOGUE, loadCase } from "../cases.js";
import { buildInventory, type EvidenceChecklist } from "../inventory.js";

const CHECKLIST = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;

/**
 * A library case is a claim about a document, and this is where the claim is checked.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM `cases.test.ts`. That file checks the SHAPE of
 * the catalogue - that refused documents refuse, that every case carries rules and
 * provenance, that the inventory comes out the size it should. None of it opens the
 * PDF. So a case file could name page 29 of a review, quote a sentence that is on page
 * 31 or nowhere, and pass every test in the suite - and the failure would first appear
 * to a reader as a highlight that silently does not draw.
 *
 * `demo-fixture.test.ts` already does this for the uploaded fixture, and its note
 * records why it must be pdf.js and not whichever PDF library was convenient: PyMuPDF
 * and pdf.js disagree about the micro sign, the two are indistinguishable on screen,
 * and a quote carrying the wrong one matches nothing. The same argument applies to
 * every quote a library case puts in front of a reader, so the same engine checks them.
 */

/** The quoted spans inside a finding's `detail`. The case files embed the source
 *  sentence in double quotes rather than carrying it in its own field - see
 *  data/cases/*.json - so this is where a quote is found to check it. */
function quotedSpans(detail: string): string[] {
  return [...detail.matchAll(/"([^"]{25,})"/g)].map((m) => m[1] ?? "");
}

const bare = (s: string): string => s.replace(/\s+/g, "");

describe("the deucravacitinib case matches the report it was built from", () => {
  const CASE = loadCase("deucravacitinib");
  const PDF = "data/raw/approval-packages/sotyktu-epar-assessment.pdf";

  it("is in the catalogue as a usable case", () => {
    const entry = CATALOGUE.find((c) => c.name === "deucravacitinib");
    expect(entry?.usable).toBe(true);
    expect(CASE.findings.length).toBe(10);
  });

  /**
   * EVERY CONSEQUENCE QUESTION IS COVERED BY A FINDING THAT ASSERTS.
   *
   * `presentForAdjudication` excludes `inconclusive`, and a verdict may only rest on
   * consequence-half items the inventory calls present - so a consequence half covered
   * only by `ambiguous` findings forces `cannot_conclude` no matter what the document
   * says. This is the same rule `demo-fixture.test.ts` pins for the uploaded fixture,
   * and the reason the tucatinib fixture stopped calling two answered questions
   * ambiguous.
   */
  it("covers all six consequence questions with findings that assert", () => {
    const inv = buildInventory(CASE.findings, CHECKLIST, CASE.modality);
    for (const id of ["C1", "C2", "C3", "C4", "C5", "C6"]) {
      expect(inv.entries.find((e) => e.itemId === id)?.state, id).toBe("present");
    }
    expect(inv.entries.filter((e) => e.state === "inconclusive")).toHaveLength(0);
    expect(inv.unmappedFindingIds).toEqual([]);
  });

  /**
   * The mechanism half is mostly absent, and that is the document rather than the
   * transcription. An EMA assessment report summarises the sponsor's package; the
   * human-cell, transporter, mitochondrial and structural-alert assays live in the
   * sponsor's own reports. Asserted here so that a later edit which "fixes" the gap by
   * covering M2 with the transporter TABLE CAPTION on page 69 - which names NTCP and
   * states no result - fails instead of passing quietly.
   */
  it("leaves the mechanism questions the report cannot answer absent", () => {
    const inv = buildInventory(CASE.findings, CHECKLIST, CASE.modality);
    for (const id of ["M1", "M2", "M3", "M4", "M6"]) {
      expect(inv.entries.find((e) => e.itemId === id)?.state, id).toBe("absent");
    }
    expect(inv.entries.find((e) => e.itemId === "M5")?.state).toBe("present");
  });

  it("puts every quoted sentence on the page its finding names", async () => {
    if (!existsSync(PDF)) return; // not in this checkout
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await getDocument({ url: pathToFileURL(PDF).href, useSystemFonts: true }).promise;
    try {
      let checked = 0;
      for (const f of CASE.findings) {
        const page = f.sourcePage;
        expect(page, `${f.id} names no page`).toBeGreaterThan(0);
        const content = await (await doc.getPage(page as number)).getTextContent();
        const text = bare(content.items.map((i) => ("str" in i ? i.str : "")).join(""));
        for (const q of quotedSpans(f.detail)) {
          expect(text.includes(bare(q)), `${f.id} on page ${String(page)}: ${q.slice(0, 60)}`).toBe(true);
          checked++;
        }
      }
      // A regex that silently matched nothing would make every assertion above vacuous.
      expect(checked).toBeGreaterThanOrEqual(10);
    } finally {
      await doc.destroy();
    }
  }, 120_000);
});
