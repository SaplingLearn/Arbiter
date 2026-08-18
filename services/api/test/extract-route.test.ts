import { describe, expect, it } from "vitest";
import { proposeFindings } from "../extract.js";
import type { EvidenceChecklist } from "../inventory.js";

/**
 * Reading a document and PROPOSING the evidence in it.
 *
 * WHY THE PROPOSAL IS NOT THE FINDING. `inventory.ts` states the rule this whole route
 * is built around: coverage is DECLARED, never inferred, because an item marked
 * satisfied that nobody verified never appears on the missing-evidence list again. A
 * model writing straight into the case would be inferring it. So the route returns
 * proposals and writes nothing; a reviewer accepts them through the findings route,
 * which is where the declaration - and the accountability for it - happens.
 *
 * The model is stubbed here. What is under test is the part that decides whether to
 * BELIEVE it, and that part must be exercised against a model that lies.
 */

const CHECKLIST: EvidenceChecklist = {
  version: "test",
  items: [
    { id: "M5", half: "mechanism", field: "Repeat-dose in vivo liver findings", whatItBlocks: "R4 cannot be applied." },
    { id: "C4", half: "consequence", field: "Reversibility on withdrawal", whatItBlocks: "Severity cannot be graded." },
  ],
};

const DOCS = [{
  documentId: "d1",
  filename: "review.pdf",
  pages: [
    { page: 41, text: "In both species the liver was a target organ, with bile duct hyperplasia and single cell necrosis at the high dose." },
    { page: 67, text: "The findings reversed after a four week treatment-free recovery period in both rats and monkeys." },
  ],
}];

/** A model that answers every item with whatever it is told to. */
const saying = (answer: unknown) => async (): Promise<unknown> => answer;

describe("proposing findings from a document", () => {
  it("keeps a proposal whose quote is verbatim on the page it cites", async () => {
    const out = await proposeFindings(DOCS, CHECKLIST, "small_molecule", saying({
      found: true, assertion: "toxic", label: "Liver is a target organ",
      detail: "Bile duct hyperplasia and single cell necrosis.",
      quote: "the liver was a target organ", page: 41,
    }));
    expect(out.discarded).toEqual([]);
    expect(out.proposals.length).toBeGreaterThan(0);
    expect(out.proposals[0]?.page).toBe(41);
    expect(out.proposals[0]?.documentId).toBe("d1");
  });

  /**
   * THE CHECK THAT CANNOT BE WAIVED, and the one claim this feature rests on.
   *
   * A quote that is not on the page it cites is the exact failure a reviewer is
   * trusting this not to make - it is a citation that looks checkable and is not. The
   * proposal is DISCARDED rather than repaired or downgraded, because a repaired
   * citation is one nobody chose.
   */
  it("discards a proposal whose quote is not on the page, rather than repairing it", async () => {
    const out = await proposeFindings(DOCS, CHECKLIST, "small_molecule", saying({
      found: true, assertion: "toxic", label: "Invented",
      detail: "A sentence that is not in the document.",
      quote: "the compound caused fulminant hepatic failure in every animal", page: 41,
    }));
    expect(out.proposals).toEqual([]);
    expect(out.discarded.length).toBeGreaterThan(0);
    expect(out.discarded[0]?.reason).toMatch(/not found verbatim on page 41/);
  });

  it("discards a proposal that claims a finding and gives no quote", async () => {
    const out = await proposeFindings(DOCS, CHECKLIST, "small_molecule", saying({
      found: true, assertion: "toxic", label: "No receipt", detail: "Trust me.", quote: null, page: 41,
    }));
    expect(out.proposals).toEqual([]);
    expect(out.discarded[0]?.reason).toMatch(/no quote or no page/);
  });

  /**
   * ABSENCE IS A FINDING, and it is reported separately from a rejection. "The document
   * does not answer this" and "the model answered and I did not believe it" are
   * different facts about the same item, and a reviewer deciding whether to trust the
   * extraction needs to tell them apart.
   */
  it("reports an item the document does not cover as notFound, not as discarded", async () => {
    const out = await proposeFindings(DOCS, CHECKLIST, "small_molecule", saying({ found: false }));
    expect(out.proposals).toEqual([]);
    expect(out.discarded).toEqual([]);
    expect(out.notFound.map((n) => n.itemId).sort()).toEqual(["C4", "M5"]);
  });

  it("survives the model failing on one item rather than losing the whole extraction", async () => {
    let n = 0;
    const out = await proposeFindings(DOCS, CHECKLIST, "small_molecule", async () => {
      n++;
      if (n === 1) throw new Error("model unavailable");
      return { found: true, assertion: "safe", label: "Reversed",
        detail: "Four week recovery.", quote: "reversed after a four week", page: 67 };
    });
    expect(out.discarded[0]?.reason).toMatch(/model unavailable/);
    expect(out.proposals.length).toBe(1);
  });

  /** An assertion the engine does not know is read as `ambiguous` rather than trusted
   *  through - and `ambiguous` leaves its item inconclusive, which is the cautious end. */
  it("reads an unrecognised assertion as ambiguous", async () => {
    const out = await proposeFindings(DOCS, CHECKLIST, "small_molecule", saying({
      found: true, assertion: "catastrophic", label: "Odd",
      detail: "d", quote: "the liver was a target organ", page: 41,
    }));
    expect(out.proposals[0]?.assertion).toBe("ambiguous");
  });
});
