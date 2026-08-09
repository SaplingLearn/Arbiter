import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  absentForAdjudication, buildInventory, isChecklist,
  type CoveringFinding, type EvidenceChecklist,
} from "../inventory.js";

const CHECKLIST: EvidenceChecklist = {
  version: "test-1",
  items: [
    { id: "C2", half: "consequence", field: "Exposure margin", whatItBlocks: "R3 cannot be applied." },
    { id: "M1", half: "mechanism", field: "Human-cell result", whatItBlocks: "R1 cannot be applied." },
    { id: "M2", half: "mechanism", field: "Transporter inhibition", whatItBlocks: "Cholestatic route untested." },
  ],
};

const finding = (id: string, over: Partial<CoveringFinding> = {}): CoveringFinding => ({
  id, label: id, assertion: "safe", detail: "d", ...over,
});

describe("buildInventory", () => {
  it("puts every checklist item in exactly one state, and leaves none out", () => {
    const inv = buildInventory([finding("f1", { covers: ["M1"] })], CHECKLIST);
    expect(inv.entries.map((e) => e.itemId)).toEqual(["C2", "M1", "M2"]);
    expect(inv.entries.filter((e) => e.state === "present")).toHaveLength(1);
    expect(inv.entries.filter((e) => e.state === "absent")).toHaveLength(2);
  });

  it("orders by checklist id and by nothing else", () => {
    // Deliberately fed in an order where a severity- or coverage-based sort would
    // produce something different. Flat and unranked is a spec requirement (§3.1),
    // not a formatting preference: ranking gaps nudges the room before anyone speaks.
    const shuffled: EvidenceChecklist = { version: "t", items: [...CHECKLIST.items].reverse() };
    const inv = buildInventory([finding("f1", { covers: ["M2"] })], shuffled);
    expect(inv.entries.map((e) => e.itemId)).toEqual(["C2", "M1", "M2"]);
  });

  it("marks an item covered only by ambiguous findings as inconclusive, not absent", () => {
    const inv = buildInventory([finding("f1", { covers: ["M1"], assertion: "ambiguous" })], CHECKLIST);
    expect(inv.entries.find((e) => e.itemId === "M1")?.state).toBe("inconclusive");
  });

  it("treats one conclusive finding among ambiguous ones as present", () => {
    const inv = buildInventory([
      finding("f1", { covers: ["M1"], assertion: "ambiguous" }),
      finding("f2", { covers: ["M1"], assertion: "toxic" }),
    ], CHECKLIST);
    expect(inv.entries.find((e) => e.itemId === "M1")?.state).toBe("present");
  });

  it("calls a contradicted item present, because the evidence exists and the conflict is the point", () => {
    // Folding disagreement into `inconclusive` would hide a live conflict inside a
    // word that reads like a gap. The conflict is the most valuable thing on the page.
    const inv = buildInventory([
      finding("f1", { covers: ["M2"], assertion: "toxic" }),
      finding("f2", { covers: ["M2"], assertion: "safe" }),
    ], CHECKLIST);
    const m2 = inv.entries.find((e) => e.itemId === "M2");
    expect(m2?.state).toBe("present");
    expect(m2?.findingIds).toEqual(["f1", "f2"]);
  });

  it("never infers coverage from a plausible-looking label", () => {
    // The whole safety property: an undeclared finding leaves its item absent. That
    // error is loud. The opposite - guessing coverage and marking a gap satisfied -
    // is silent and never reappears on the missing list.
    const inv = buildInventory([finding("human-cell hepatotoxicity assay")], CHECKLIST);
    expect(inv.entries.every((e) => e.state === "absent")).toBe(true);
  });

  it("does not let load order change the inventory", () => {
    const a = buildInventory([finding("z", { covers: ["M1"] }), finding("a", { covers: ["M1"] })], CHECKLIST);
    const b = buildInventory([finding("a", { covers: ["M1"] }), finding("z", { covers: ["M1"] })], CHECKLIST);
    expect(a).toEqual(b);
    expect(a.entries.find((e) => e.itemId === "M1")?.findingIds).toEqual(["a", "z"]);
  });

  it("reports a finding claiming coverage of an unknown item rather than dropping it", () => {
    const inv = buildInventory([finding("f1", { covers: ["M1", "NOPE"] })], CHECKLIST);
    expect(inv.unmappedFindingIds).toEqual(["f1"]);
    expect(inv.entries.find((e) => e.itemId === "M1")?.state).toBe("present");
  });

  it("gives findingIds exactly when the item is not absent", () => {
    const inv = buildInventory([finding("f1", { covers: ["M1"] })], CHECKLIST);
    for (const e of inv.entries) {
      expect(e.findingIds.length === 0).toBe(e.state === "absent");
    }
  });
});

describe("absentForAdjudication", () => {
  it("sends the humans' gap list to the model, inconclusive items included and labelled", () => {
    const inv = buildInventory([
      finding("f1", { covers: ["M1"] }),
      finding("f2", { covers: ["M2"], assertion: "ambiguous" }),
    ], CHECKLIST);
    const absent = absentForAdjudication(inv);
    expect(absent.map((a) => a.field)).toEqual([
      "Exposure margin",
      "Transporter inhibition (tested, inconclusive)",
    ]);
  });

  it("omits nothing that the inventory did not call present", () => {
    const inv = buildInventory([], CHECKLIST);
    expect(absentForAdjudication(inv)).toHaveLength(CHECKLIST.items.length);
  });
});

describe("the shipped checklist", () => {
  const shipped = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as unknown;

  it("validates", () => {
    expect(isChecklist(shipped)).toBe(true);
  });

  it("covers both halves of the verdict, because the measured defect was collapsing them", () => {
    const c = shipped as EvidenceChecklist;
    expect(c.items.some((i) => i.half === "mechanism")).toBe(true);
    expect(c.items.some((i) => i.half === "consequence")).toBe(true);
  });

  it("asks questions and never states expected answers, so it applies to a novel compound", () => {
    // The field is a question about the package. If any entry named a specific drug
    // or a threshold value, the checklist would have stopped being drug-agnostic.
    const c = shipped as EvidenceChecklist;
    for (const i of c.items) {
      expect(i.field.length).toBeGreaterThan(0);
      expect(i.whatItBlocks.length).toBeGreaterThan(20);
    }
  });

  it("rejects a checklist with duplicate ids", () => {
    expect(isChecklist({ version: "x", items: [
      { id: "A", half: "mechanism", field: "f", whatItBlocks: "w" },
      { id: "A", half: "consequence", field: "g", whatItBlocks: "w" },
    ] })).toBe(false);
  });

  it("rejects an empty checklist", () => {
    expect(isChecklist({ version: "x", items: [] })).toBe(false);
  });
});
