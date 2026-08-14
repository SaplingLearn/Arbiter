import { describe, expect, it } from "vitest";
import { conceptsFor, expandPhrases, normalise, stem } from "../terms.js";

describe("stemming", () => {
  it("matches Porter's worked examples, carried through the WHOLE algorithm", () => {
    // Written out rather than trusted, because a stemmer that is subtly wrong changes
    // every score in the retrieval eval while looking like a retrieval result.
    //
    // The paper's step-1b examples are INTERMEDIATE, and reading them as final output
    // is the trap this comment exists to mark: `agreed -> agree` is where step 1b
    // stops, and step 5a then drops the final e because m("agre") is 1 and the stem
    // is not cvc. Same for conflated and troubled. The values below are what the
    // complete stemmer returns.
    const cases: [string, string][] = [
      ["caresses", "caress"], ["ponies", "poni"], ["ties", "ti"], ["caress", "caress"],
      ["cats", "cat"], ["feed", "feed"], ["agreed", "agre"], ["plastered", "plaster"],
      ["bled", "bled"], ["motoring", "motor"], ["sing", "sing"], ["conflated", "conflat"],
      ["troubled", "troubl"], ["hopping", "hop"], ["tanned", "tan"], ["falling", "fall"],
      ["hissing", "hiss"], ["fizzed", "fizz"], ["happy", "happi"], ["sky", "sky"],
      ["relational", "relat"], ["conditional", "condit"], ["sized", "size"],
    ];
    for (const [word, expected] of cases) expect(stem(word), word).toBe(expected);
  });

  it("collapses the pairs this domain actually asks in two forms", () => {
    expect(stem("studies")).toBe(stem("study"));
    expect(stem("findings")).toBe(stem("finding"));
    expect(stem("increases")).toBe(stem("increased"));
    expect(stem("recovery")).toBe(stem("recoveries"));
    expect(stem("elevations")).toBe(stem("elevation"));
    expect(stem("reversibility")).toBe(stem("reversible"));
  });

  it("leaves a short word alone rather than mangling it", () => {
    for (const w of ["alt", "ast", "auc", "dog", "rat"]) expect(stem(w)).toBe(w);
  });
});

describe("phrases", () => {
  it("recognises an acronym written out in full", () => {
    // The measured failure: "What NOAEL was set?" and "no observed adverse effect
    // level" retrieved one shared page out of fifteen.
    expect(expandPhrases("no observed adverse effect level")).toContain("noael");
    expect(expandPhrases("the no-observed-adverse-effect-level was 300 mg/kg")).toContain("noael");
  });

  it("keeps the original words as well as the acronym", () => {
    // Expansion ADDS a term. Replacing would lose a page that spells it out and
    // never abbreviates it.
    const out = expandPhrases("no observed adverse effect level");
    expect(out).toContain("adverse");
    expect(out).toContain("noael");
  });

  it("recognises the enzymes by their full names", () => {
    expect(expandPhrases("alanine aminotransferase rose")).toContain("alt");
    expect(expandPhrases("aspartate aminotransferase rose")).toContain("ast");
  });
});

describe("concepts", () => {
  it("puts the words a reviewer uses interchangeably on one token", () => {
    for (const w of ["liver", "hepatic", "hepatotoxicity", "hepatocellular"]) {
      expect(conceptsFor(stem(w)), w).toContain("c_liver");
    }
  });

  it("ties the liver enzymes to the liver, because that is what they measure", () => {
    // "were transaminases elevated" and "does this drug damage the liver" are the
    // same question to a toxicologist, and both missed every gold page.
    expect(conceptsFor(stem("transaminase"))).toContain("c_liver");
    expect(conceptsFor("alt")).toContain("c_liver");
  });

  it("does not tie unrelated organs together", () => {
    expect(conceptsFor(stem("kidney"))).not.toContain("c_liver");
  });
});

describe("the whole pipeline", () => {
  it("makes an acronym and its expansion share tokens", () => {
    const a = new Set(normalise("What NOAEL was set, and in which study?"));
    const b = new Set(normalise("no observed adverse effect level"));
    expect([...a].filter((t) => b.has(t))).toContain("noael");
  });

  it("makes a hepatotoxicity question share tokens with an ALT finding", () => {
    const q = new Set(normalise("does this drug damage the liver?"));
    const page = new Set(normalise("increased levels of alanine aminotransferase (ALT) at 20 mg/kg"));
    expect([...q].filter((t) => page.has(t))).toContain("c_liver");
  });

  it("still drops stopwords and single characters", () => {
    expect(normalise("what is the a")).toEqual([]);
  });
});
