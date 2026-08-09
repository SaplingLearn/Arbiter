import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CATALOGUE, isCaseName, loadCase, refusalFor } from "../cases.js";
import { buildInventory, isChecklist, type EvidenceChecklist } from "../inventory.js";

const CHECKLIST = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;

describe("the case catalogue", () => {
  it("lists the refused documents rather than hiding them", () => {
    // A picker showing only what worked would imply every document works. Two of
    // four cannot be used, and that ratio is the finding.
    expect(CATALOGUE.filter((c) => !c.usable).map((c) => c.name)).toEqual(["tolcapone", "troglitazone"]);
    expect(CATALOGUE.filter((c) => c.usable).length).toBe(3);
  });

  it("accepts every catalogue name and nothing else", () => {
    for (const c of CATALOGUE) expect(isCaseName(c.name)).toBe(true);
    expect(isCaseName("nope")).toBe(false);
    expect(isCaseName(undefined)).toBe(false);
  });

  it("refuses to load a refused document instead of inventing an empty case", () => {
    // If a refused document could still become a case, split_review.py's refusal
    // would be decorative.
    expect(() => loadCase("tolcapone")).toThrow(/refused/i);
    expect(() => loadCase("troglitazone")).toThrow(/refused/i);
  });

  it("quotes the splitter verbatim rather than paraphrasing it", () => {
    expect(refusalFor("tolcapone")?.splitterReason).toContain("needs OCR before anything can read it");
    expect(refusalFor("troglitazone")?.splitterReason).toContain("do not trim by hand");
    expect(refusalFor("tak994")).toBeNull();
  });

  it("loads all three usable cases with provenance attached", () => {
    for (const name of ["tak994", "nipocalimab", "slynd"] as const) {
      const c = loadCase(name);
      expect(c.findings.length).toBeGreaterThan(0);
      expect(c.provenance.length).toBeGreaterThan(20);
      expect(c.rules.length).toBeGreaterThan(0);
    }
  });

  it("gives every case the same rules, because rules are not customised per compound", () => {
    const a = loadCase("tak994").rules;
    const b = loadCase("nipocalimab").rules;
    expect(a).toEqual(b);
  });

  it("produces the three shapes the cases were chosen for", () => {
    const shape = (name: "tak994" | "nipocalimab" | "slynd"): Record<string, number> => {
      const c = loadCase(name);
      const inv = buildInventory(c.findings, CHECKLIST, c.modality);
      const n = (s: string): number => inv.entries.filter((e) => e.state === s).length;
      return { present: n("present"), absent: n("absent"), na: n("not_applicable") };
    };
    // Thin: most questions unanswered.
    expect(shape("tak994").absent).toBe(8);
    expect(shape("tak994").na).toBe(0);
    // Rich, and a biologic: four questions do not arise.
    expect(shape("nipocalimab").present).toBe(5);
    expect(shape("nipocalimab").na).toBe(4);
    // Almost nothing to cite - the case §6.5 needs to be testable at all.
    expect(shape("slynd").present).toBe(1);
  });

  it("carries a document-scope note exactly where the document limits what can be read", () => {
    // Slynd's package contains no new nonclinical studies, which is legitimate and
    // has to be said, or eleven ABSENT rows read as negligence.
    expect(loadCase("slynd").documentScope).toContain("THE SAFETY STUDIES FOR THIS DRUG WERE NEVER RUN");
    expect(loadCase("nipocalimab").documentScope).toBeUndefined();
    expect(loadCase("tak994").documentScope).toBeUndefined();
  });
});

describe("the shipped checklist, after the modality change", () => {
  it("still validates", () => {
    expect(isChecklist(CHECKLIST)).toBe(true);
  });

  it("gives every small-molecule-only question a reason it does not apply", () => {
    // `whatItBlocks` is the wrong sentence for a question that does not arise, so
    // an item restricted by modality must supply the right one.
    for (const i of CHECKLIST.items) {
      if (i.appliesTo !== undefined && !i.appliesTo.includes("biologic")) {
        expect(i.whyNotApplicable, `${i.id} has no whyNotApplicable`).toBeDefined();
        expect(i.whyNotApplicable!.length).toBeGreaterThan(40);
      }
    }
  });

  it("attaches that reason to the inventory entry, and only when not applicable", () => {
    const inv = buildInventory([], CHECKLIST, "biologic");
    const na = inv.entries.find((e) => e.itemId === "M3")!;
    expect(na.state).toBe("not_applicable");
    expect(na.whyNotApplicable).toContain("catabolised to amino acids");

    const absent = inv.entries.find((e) => e.itemId === "M1")!;
    expect(absent.state).toBe("absent");
    expect(absent.whyNotApplicable).toBeUndefined();
  });
});
