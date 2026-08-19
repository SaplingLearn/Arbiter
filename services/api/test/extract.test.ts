import { describe, expect, it } from "vitest";
import { proposeFindings } from "../extract.js";
import type { Complete } from "../interpret.js";
import type { EvidenceChecklist } from "../inventory.js";

/**
 * `proposeFindings` had no tests at all, and the branch that added `searchTerms` to the
 * retrieval query added none either. These pin the behaviour in BOTH directions, because
 * the change buys recall with a budget it also spends: the query is widened, `perItem`
 * is not, and the slots the added terms win are slots something else loses.
 */

/** Records the prompt it was handed, so a test can assert WHICH passages were retrieved. */
function recorder(): { complete: Complete; prompts: string[] } {
  const prompts: string[] = [];
  const complete: Complete = (_system, user) => {
    prompts.push(user);
    // `found: false` - these tests are about retrieval, not about proposal parsing.
    return Promise.resolve({ found: false });
  };
  return { complete, prompts };
}

/** Page A answers the FIELD's words. Page B answers the SEARCH TERMS' words. */
const DOCUMENTS = [{
  documentId: "doc_a",
  filename: "fda-review.pdf",
  pages: [
    { page: 11, text: "Transporter inhibition was evaluated in the transporter inhibition studies submitted by the applicant." },
    { page: 22, text: "The bile salt export pump assay reported an IC50 of 12 micromolar in the vesicular preparation." },
    { page: 33, text: "Product information, packaging specifications and shelf-life data for the finished form." },
  ],
}];

const pagesIn = (prompt: string): number[] =>
  [...prompt.matchAll(/--- page (\d+) ---/g)].map((m) => Number(m[1]));

const checklist = (searchTerms?: string[]): EvidenceChecklist => ({
  version: "test-1",
  items: [{
    id: "M2",
    half: "mechanism",
    field: "Transporter inhibition",
    whatItBlocks: "Cholestatic route untested.",
    ...(searchTerms ? { searchTerms } : {}),
  }],
});

describe("proposeFindings retrieval", () => {
  it("searches the field alone when the item declares no search terms", async () => {
    const { complete, prompts } = recorder();
    await proposeFindings(DOCUMENTS, checklist(), "small_molecule", complete, 1);

    expect(prompts).toHaveLength(1);
    expect(pagesIn(prompts[0]!)).toEqual([11]);
  });

  it("reaches a page the field's own words never match", async () => {
    const { complete, prompts } = recorder();
    await proposeFindings(DOCUMENTS, checklist(["bile salt export pump"]), "small_molecule", complete, 2);

    // Page 22 shares no vocabulary with "Transporter inhibition". Without the search
    // terms it is unreachable; this is the whole point of the change.
    expect(pagesIn(prompts[0]!)).toContain(22);
  });

  it("SPENDS a slot to do it - the added terms can displace the field's own page", async () => {
    const { complete, prompts } = recorder();
    await proposeFindings(DOCUMENTS, checklist(["bile salt export pump"]), "small_molecule", complete, 1);

    // At perItem=1 there is one slot and the search terms win it, so page 11 - which the
    // field alone retrieved in the first test - is now not read at all. A displaced page
    // is reported as a gap the document does not have, which is the same failure the
    // change exists to remove, arriving from the other side. Nothing in the ten
    // benchmarks measures this: retrieval-eval searches with the fixture QUESTION and
    // never with `field + searchTerms`.
    expect(pagesIn(prompts[0]!)).toEqual([22]);
    expect(pagesIn(prompts[0]!)).not.toContain(11);
  });

  it("still reports an item as absent when nothing retrieves for it", async () => {
    const { complete } = recorder();
    const empty: EvidenceChecklist = {
      version: "test-1",
      items: [{ id: "Z9", half: "consequence", field: "Zzzz Qqqq Xxxx", whatItBlocks: "Nothing." }],
    };
    const out = await proposeFindings(DOCUMENTS, empty, "small_molecule", complete, 4);

    expect(out.proposals).toEqual([]);
    expect(out.notFound.map((n) => n.itemId)).toEqual(["Z9"]);
  });

  it("skips an item that cannot apply to the modality, rather than asking for it", async () => {
    const { complete, prompts } = recorder();
    const biologicOnly: EvidenceChecklist = {
      version: "test-1",
      items: [{
        id: "M2", half: "mechanism", field: "Transporter inhibition",
        whatItBlocks: "Cholestatic route untested.", appliesTo: ["small_molecule"],
      }],
    };
    const out = await proposeFindings(DOCUMENTS, biologicOnly, "biologic", complete, 4);

    expect(prompts).toEqual([]);
    expect(out.notFound).toEqual([]);
    expect(out.proposals).toEqual([]);
  });
});
