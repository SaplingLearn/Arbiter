import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CATALOGUE, isCaseName, loadCase, refusalFor } from "../cases.js";
import { buildInventory, isChecklist, type EvidenceChecklist } from "../inventory.js";

const CHECKLIST = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;

describe("the case catalogue", () => {
  it("lists the refused documents rather than hiding them", () => {
    // A picker showing only what worked would imply every document works. Two of the
    // seven cannot be used, and that ratio is the finding. The refused pair is named
    // exactly; the usable count is derived, so adding a case does not fail this.
    expect(CATALOGUE.filter((c) => !c.usable).map((c) => c.name)).toEqual(["tolcapone", "troglitazone"]);
    expect(CATALOGUE.filter((c) => c.usable).length).toBe(CATALOGUE.length - 2);
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

  // DERIVED FROM THE CATALOGUE, not a hand-kept list: a case added to CATALOGUE and
  // not to a literal here would be a case nothing in this file ever loads.
  it("loads every usable case with provenance attached", () => {
    for (const { name } of CATALOGUE.filter((c) => c.usable)) {
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
    const shape = (name: "tak994" | "nipocalimab" | "slynd" | "turalio"): Record<string, number> => {
      const c = loadCase(name);
      const inv = buildInventory(c.findings, CHECKLIST, c.modality);
      const n = (s: string): number => inv.entries.filter((e) => e.state === s).length;
      const half = (h: "mechanism" | "consequence", st: string): number =>
        inv.entries.filter((e) => e.half === h && e.state === st).length;
      return {
        present: n("present"), absent: n("absent"), na: n("not_applicable"),
        consequencePresent: half("consequence", "present"), mechanismAbsent: half("mechanism", "absent"),
      };
    };
    // Thin: most questions unanswered.
    expect(shape("tak994").absent).toBe(8);
    expect(shape("tak994").na).toBe(0);
    // Rich, and a biologic: four questions do not arise.
    expect(shape("nipocalimab").present).toBe(5);
    expect(shape("nipocalimab").na).toBe(4);
    // Almost nothing to cite - the case §6.5 needs to be testable at all.
    expect(shape("slynd").present).toBe(1);
    // The most complete package, and the exact mirror of TAK-994: every consequence
    // question answered, most mechanism questions not. A regulatory review states
    // dose, margin, pattern and reversibility; it does not carry the screening
    // assays, which live in the sponsor's own reports.
    expect(shape("turalio").consequencePresent).toBe(6);
    expect(shape("turalio").mechanismAbsent).toBe(4);
  });

  it("keeps the leaked clinical outcome visible rather than deleting it", () => {
    // Turalio's nonclinical chapter cross-references the clinical result, so the
    // answer key sits inside the input. The finding is RECORDED and labelled, because
    // deleting it would hide the reason this case cannot score prediction.
    const t = loadCase("turalio");
    const leak = t.findings.find((f) => f.id === "TUR:clinical-forward-reference");
    expect(leak).toBeDefined();
    expect(leak!.label).toContain("FORWARD REFERENCE");
    expect(leak!.detail).toContain("ANSWER KEY, INSIDE THE INPUT");
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
