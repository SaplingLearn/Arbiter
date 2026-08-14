import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loadRescore, pipelineAt } from "../src/data/rescore.js";
import { ScoringVersionNotice } from "../src/ui/ScoringVersionNotice.js";

describe("the re-grade document", () => {
  it("loads both targets and marks v1.0 superseded", () => {
    const doc = loadRescore();
    expect(doc.targets.map((t) => t.version)).toEqual(["1.0", "2.0"]);
    expect(doc.targets.find((t) => t.version === "1.0")!.superseded).toBe(true);
  });

  it("carries the corrected headline on the full split", () => {
    const arbiter = pipelineAt(loadRescore(), "2.0", "fullSplit", "ARBITER")!;
    expect(arbiter.balancedAccuracy.toFixed(3)).toBe("0.500");
    expect(arbiter.confusion).toEqual({ tp: 2, fp: 5, tn: 0, fn: 0 });
  });
});

describe("ScoringVersionNotice", () => {
  it("states which target the figures on screen were graded under", () => {
    render(<ScoringVersionNotice />);
    expect(screen.getByTestId("scoring-version")).toHaveTextContent(/graded under target v1\.0/i);
  });

  it("states the corrected figure and that no pipeline clears it", () => {
    render(<ScoringVersionNotice />);
    const el = screen.getByTestId("scoring-version");
    expect(el).toHaveTextContent(/0\.500/);
    expect(el).toHaveTextContent(/0\.601/);
  });

  it("names the population of each figure, because they are different populations", () => {
    render(<ScoringVersionNotice />);
    expect(screen.getByTestId("scoring-version")).toHaveTextContent(/full scored split/i);
  });

  // The constraint this guards is the one HANDOVER §13.2 breaks: its table pairs a
  // v1.0 CONFLICT-SUBSET confusion (tp 4/fp 0/tn 0/fn 0, n=61) against a v2.0
  // FULL-SPLIT one (tp 2/fp 5/tn 0/fn 0, n=267) under a single "full scored split"
  // heading. Both populations happen to give 0.750 -> 0.500 so the headline
  // survives, but a notice that quotes figures from two populations without naming
  // each of them has reproduced the error rather than corrected it.
  it("names the conflict subset too, since that is the population the page's own headline is on", () => {
    render(<ScoringVersionNotice />);
    const el = screen.getByTestId("scoring-version");
    expect(el).toHaveTextContent(/conflict subset/i);
    expect(el).toHaveTextContent(/n\s*=\s*61/);
    expect(el).toHaveTextContent(/n\s*=\s*267/);
  });

  it("discloses that the QSAR figure is a lower bound", () => {
    render(<ScoringVersionNotice />);
    expect(screen.getByTestId("scoring-version")).toHaveTextContent(/lower bound/i);
  });
});
