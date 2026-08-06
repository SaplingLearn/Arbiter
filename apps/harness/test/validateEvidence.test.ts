import { describe, expect, it } from "vitest";
import { findLeakedFixtures } from "../src/validate-evidence.js";
import { loadInputs } from "../src/load.js";

describe("the fixture leak check", () => {
  it("finds a fixture id that reached the benchmark", () => {
    expect(findLeakedFixtures(["TAK-994", "FOO-1"], ["ABC", "FOO-1"])).toEqual(["FOO-1"]);
  });

  // The defect the old check had: it matched one hardcoded prefix, so any other
  // fixture leaked silently.
  it("catches a fixture whose id does not start with TAK-994", () => {
    expect(findLeakedFixtures(["FASIGLIFAM"], ["FASIGLIFAM"])).toEqual(["FASIGLIFAM"]);
  });

  it("passes on the shipped data", () => {
    const { fixtureIds, benchmarkIds } = loadInputs();
    expect(fixtureIds.length).toBeGreaterThan(0);
    expect(findLeakedFixtures(fixtureIds, benchmarkIds)).toEqual([]);
  });
});
