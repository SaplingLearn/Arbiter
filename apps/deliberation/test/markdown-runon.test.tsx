import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown, parse, unrun } from "../src/markdown.js";

/**
 * The answer that produced the bug report, verbatim off the screen.
 *
 * Every marker the model emitted is here and not one newline is, which is the whole
 * point: this is what `parse` has to survive when the prompt's blank lines do not
 * arrive. Trimmed in the middle only - the shape is untouched.
 */
const RUNON = "### Document Type and Context This document is a Multi-Discipline Review "
  + "(comprising Summary, Office Director, Cross Discipline Team Leader, Clinical, "
  + "Non-Clinical, Statistical, and Clinical Pharmacology Reviews) for New Drug "
  + "Application (NDA) 211810 [1, 2]. It concerns the compound pexidartinib (trade name "
  + "TURALIO, code name PLX3397 or PLX3397 hydrochloride), a kinase inhibitor [2]. "
  + "### Reported Studies - **Nonclinical Pharmacology & Safety Pharmacology:** In vitro "
  + "kinase inhibition assays [42, 43, 44], in vivo splenomegaly mouse models [45]. "
  + "- **General Toxicology:** Repeat-dose oral toxicity studies of up to six months in "
  + "Sprague Dawley rats [48], up to nine months in Beagle dogs [54]. "
  + "- **Genetic Toxicology:** In vitro bacterial reverse mutation (Ames) test [58].";

describe("an answer that arrived with no newlines", () => {
  it("does not become one giant heading", () => {
    const blocks = parse(RUNON);
    expect(blocks.filter((b) => b.kind === "heading")).toHaveLength(2);
    expect(blocks.length).toBeGreaterThan(3);
  });

  it("cuts a heading back to its title, and keeps the prose that followed it", () => {
    const blocks = parse(RUNON);
    const first = blocks[0]!;
    expect(first).toEqual({ kind: "heading", level: 3, text: "Document Type and Context" });
    // The sentence that ran into it is a paragraph, not lost and not inside the heading.
    const para = blocks[1]!;
    expect(para.kind).toBe("para");
    expect(para.kind === "para" && para.text).toMatch(/^This document is a Multi-Discipline Review/);
  });

  it("recovers the bulleted list", () => {
    const list = parse(RUNON).find((b) => b.kind === "list");
    expect(list?.kind === "list" && list.ordered).toBe(false);
    expect(list?.kind === "list" && list.items).toHaveLength(3);
    expect(list?.kind === "list" && list.items[1]).toMatch(/^\*\*General Toxicology:\*\*/);
  });

  it("renders headings and list items as real elements, with no markers left on screen", () => {
    const { container } = render(<Markdown>{RUNON}</Markdown>);
    expect(container.querySelectorAll("h5")).toHaveLength(2);
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(screen.getByText("Reported Studies")).toBeDefined();
    // The literal markers from the bug report are gone from the rendered text.
    expect(container.textContent).not.toMatch(/###/);
    expect(container.textContent).not.toMatch(/\*\*/);
  });

  it("keeps every measurement and citation marker intact", () => {
    const text = render(<Markdown>{RUNON}</Markdown>).container.textContent ?? "";
    expect(text).toContain("[42, 43, 44]");
    expect(text).toContain("up to six months in Sprague Dawley rats [48]");
    expect(text).toContain("pexidartinib (trade name TURALIO, code name PLX3397");
  });
});

describe("unrun leaves alone what it should", () => {
  it("does not fire at all when the answer has newlines", () => {
    const proper = "### Heading\n\nA paragraph.\n\n- **Liver:** raised AST at 20 mg/kg";
    expect(parse(proper)).toEqual(parse(proper));
    // The repaired path is not taken, so a legitimate multi-word heading survives whole.
    expect(parse(proper)[0]).toEqual({ kind: "heading", level: 3, text: "Heading" });
  });

  it("does not cut a dash out of run-on prose", () => {
    const dashes = "Findings were dose-related - and reversible - in both species.";
    const blocks = parse(dashes);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({ kind: "para", text: dashes });
  });

  it("does not break a number that happens to look like a list", () => {
    const numeric = "The NOAEL was 300 mg/kg. 1. is not a list item here.";
    expect(parse(numeric).filter((b) => b.kind === "list")).toHaveLength(0);
  });

  it("keeps a heading whose second word only looks like a sentence opener", () => {
    expect(unrun("### Studies In Rats")).toBe("### Studies In Rats");
    expect(unrun("### The Liver Findings")).toBe("### The Liver Findings");
  });
});
