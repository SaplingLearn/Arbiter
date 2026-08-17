import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown, parse } from "../src/markdown.js";

/**
 * The renderer exists because an answer is structured prose, not a sentence. Every case
 * below is a shape a model on this deployment actually produces, or a shape that would
 * corrupt a regulatory number if the parser guessed.
 */
describe("Markdown blocks", () => {
  it("splits paragraphs on blank lines instead of running them together", () => {
    const { container } = render(<Markdown>{"First finding.\n\nSecond finding."}</Markdown>);
    const paras = container.querySelectorAll("p");
    expect(paras).toHaveLength(2);
    expect(paras[0]).toHaveTextContent("First finding.");
    expect(paras[1]).toHaveTextContent("Second finding.");
  });

  it("joins a soft-wrapped paragraph into one, with a space at the seam", () => {
    // A model wrapping mid-sentence must not produce "doses of20 mg/kg".
    const { container } = render(<Markdown>{"Findings at doses of\n20 mg/kg and above."}</Markdown>);
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.textContent).toBe("Findings at doses of 20 mg/kg and above.");
  });

  it("renders bullets as a list rather than as literal hyphens", () => {
    render(<Markdown>{"- Hemosiderin deposition\n- Biliary cysts"}</Markdown>);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Hemosiderin deposition");
    expect(screen.getByRole("list").tagName).toBe("UL");
  });

  it("renders a numbered list as an ordered list", () => {
    render(<Markdown>{"1. Ames assay\n2. Micronucleus assay"}</Markdown>);
    expect(screen.getByRole("list").tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("does not merge a bullet list into a numbered one that follows it", () => {
    // One <ul> holding both would renumber nothing and mislabel everything.
    render(<Markdown>{"- Rats\n- Dogs\n1. First\n2. Second"}</Markdown>);
    const lists = screen.getAllByRole("list");
    expect(lists.map((l) => l.tagName)).toEqual(["UL", "OL"]);
  });

  it("opens a list directly under a paragraph, with no blank line between", () => {
    // Models are inconsistent about the blank line; the line's own shape opens a block.
    render(<Markdown>{"Findings in rats:\n- Necrotising inflammation"}</Markdown>);
    expect(screen.getByRole("listitem")).toHaveTextContent("Necrotising inflammation");
  });

  it("renders headings below the page's own outline, never at h1 or h2", () => {
    // "Animal findings" is subordinate to the page title and to a section header. A
    // screen reader walking the outline must not find it level with "Ask the documents".
    const { container } = render(<Markdown>{"## Animal findings\n### In rats"}</Markdown>);
    expect(container.querySelector("h4")).toHaveTextContent("Animal findings");
    expect(container.querySelector("h5")).toHaveTextContent("In rats");
    expect(container.querySelector("h1, h2, h3")).toBeNull();
  });

  it("drops a horizontal rule instead of drawing an empty bullet", () => {
    // "---" satisfies the bullet rule too, so order of testing is load-bearing.
    render(<Markdown>{"Above.\n\n---\n\nBelow."}</Markdown>);
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

describe("Markdown inline", () => {
  it("renders bold and emphasis", () => {
    const { container } = render(<Markdown>{"The **NOAEL** was set in a *pivotal* study."}</Markdown>);
    expect(container.querySelector("strong")).toHaveTextContent("NOAEL");
    expect(container.querySelector("em")).toHaveTextContent("pivotal");
    expect(container.textContent).toBe("The NOAEL was set in a pivotal study.");
  });

  it("renders inline code", () => {
    const { container } = render(<Markdown>{"The field is `historyTurnsUsed`."}</Markdown>);
    expect(container.querySelector("code")).toHaveTextContent("historyTurnsUsed");
  });

  /**
   * THE CASE THAT DECIDES THE PARSER. These are doses, ratios and passage markers off a
   * regulatory page. A greedy emphasis rule eats characters out of them, and a dose that
   * silently loses a digit on screen is the worst defect this surface can have.
   */
  it("leaves a lone asterisk between numbers alone", () => {
    const { container } = render(<Markdown>{"Ratio 2 * 3 * 4 across arms."}</Markdown>);
    expect(container.textContent).toBe("Ratio 2 * 3 * 4 across arms.");
    expect(container.querySelector("em")).toBeNull();
  });

  it("never italicises the middle of an identifier", () => {
    // NDA_211810 and snake_case field names are quoted verbatim off pages. Underscore
    // emphasis is not in the grammar precisely so this cannot happen.
    const { container } = render(<Markdown>{"Filed as NDA_211810_multidiscipline."}</Markdown>);
    expect(container.textContent).toBe("Filed as NDA_211810_multidiscipline.");
    expect(container.querySelector("em")).toBeNull();
  });

  it("keeps passage markers as the literal text they are", () => {
    // `[3, 8]` is a passage index, not a link. Provenance is the citation rows below.
    const { container } = render(<Markdown>{"Increased AST and ALT [3, 8]."}</Markdown>);
    expect(container.textContent).toBe("Increased AST and ALT [3, 8].");
    expect(container.querySelector("a")).toBeNull();
  });

  it("preserves a dose exactly when it carries emphasis around it", () => {
    // ask-eval matches `30[06]\s*mg/kg` against the raw string; the rendered text has to
    // read the same to a person as the pattern does to the eval.
    const { container } = render(<Markdown>{"The NOAEL was **300 mg/kg** per day."}</Markdown>);
    expect(container.textContent).toBe("The NOAEL was 300 mg/kg per day.");
  });
});

describe("Markdown safety", () => {
  it("renders HTML in a model's answer as text, never as nodes", () => {
    // There is no dangerouslySetInnerHTML in the module. This is the test that says so.
    const { container } = render(
      <Markdown>{"<img src=x onerror=alert(1)> and <script>alert(2)</script>"}</Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("does not make a link out of markdown link syntax", () => {
    // An answer is drawn from a PDF page and has nowhere legitimate to point.
    const { container } = render(<Markdown>{"See [the report](https://example.com/x)."}</Markdown>);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("https://example.com/x");
  });

  it("renders an empty answer as nothing at all", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("parse, on the shape this deployment actually returns", () => {
  it("keeps a 5,953-character wall in one block when it has no newlines", () => {
    // The measured answer before the prompt asked for structure. The renderer cannot
    // invent paragraphs that are not there - which is why services/api/ask.ts changed.
    const wall = `${"Animal findings in rats included hemosiderin deposition. ".repeat(40)}`;
    const blocks = parse(wall);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("para");
  });

  it("reads a structured answer as heading, paragraph and list", () => {
    const blocks = parse("## Animal findings\n\nIn rats, at 20 mg/kg and above:\n\n- Hemosiderin deposition\n- Increased AST");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "para", "list"]);
  });
});
