import { describe, expect, it } from "vitest";
import type { EvidenceClaim } from "@arbiter/engine";
import { browserEvidenceDigest, projectClaimsForDigest } from "../src/data/evidenceDigest.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const claims = data.heroCases.get("TAK-994")!.claims!;

describe("browserEvidenceDigest", () => {
  it("is stable against claim ORDER, so a load-order change is not a false alarm", async () => {
    // The same property canonicalJson gives the ruleset hash, applied one level up:
    // claimsByCompound is built by appending in file order, and a reordered
    // evidence.json must not read as an edit.
    const a = await browserEvidenceDigest(claims);
    const b = await browserEvidenceDigest([...claims].reverse());
    expect(a).toBe(b);
  });

  it("MOVES when a reclassifiable field moves", async () => {
    // The check has to be able to fail, or the pre-flight line it feeds is a
    // caption. klimisch is one of the six fields a challenge may reclassify.
    const edited: EvidenceClaim[] = claims.map((c, i) =>
      i === 0 ? { ...c, klimisch: c.klimisch === 1 ? 2 : 1 } : c);
    expect(await browserEvidenceDigest(edited)).not.toBe(await browserEvidenceDigest(claims));
  });

  it("MOVES when an assertion flips", async () => {
    const edited: EvidenceClaim[] = claims.map((c, i) =>
      i === 0 ? { ...c, assertion: c.assertion === "toxic" ? "safe" : "toxic" } : c);
    expect(await browserEvidenceDigest(edited)).not.toBe(await browserEvidenceDigest(claims));
  });

  it("ignores provenance, which the engine never reads", async () => {
    // Same reasoning as projectForHash excluding version and registeredAt: the
    // digest covers what the reasoning is computed from. A corrected PMID is not an
    // evidence edit and must not make the panel warn about one.
    const edited: EvidenceClaim[] = claims.map((c, i) =>
      i === 0 ? { ...c, provenance: { ...c.provenance, source: "PMID:00000000" } } : c);
    expect(await browserEvidenceDigest(edited)).toBe(await browserEvidenceDigest(claims));
  });

  it("projects exactly the eleven engine-read fields, named", async () => {
    // Asserting a count would pass on the wrong eleven. If a field is added to
    // EvidenceClaim this fails and forces a decision about whether it belongs in
    // the digest, which is the point.
    expect(Object.keys(projectClaimsForDigest(claims)[0] as object).sort()).toEqual([
      "assertion", "availableFrom", "compoundId", "exposureRelevant", "id",
      "inApplicabilityDomain", "klimisch", "measuresKeyEvent", "stream",
      "strength", "system",
    ]);
  });
});
