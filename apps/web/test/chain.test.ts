import { describe, expect, it } from "vitest";
import { evidenceSnapshot, recordHash } from "../src/record/chain.js";
import { reason, type EvidenceClaim, type Reasoning } from "@arbiter/engine";
import type { ReviewerPosition } from "../src/state/store.js";
import { loadData } from "../src/data/load.js";

const claims = [
  { id: "b", assertion: "safe", strength: 0.5 },
  { id: "a", assertion: "toxic", strength: 0.9 },
] as EvidenceClaim[];
const reasoning = { verdict: "abstain", belief: 0.1, plausibility: 0.9 } as Reasoning;

const data = loadData();

describe("evidenceSnapshot", () => {
  it("is stable against claim ORDER, so the same screen hashes the same", () => {
    const a = evidenceSnapshot(claims, reasoning);
    const b = evidenceSnapshot([...claims].reverse(), reasoning);
    expect(a).toBe(b);
  });

  it("CHANGES when the evidence changes", () => {
    // The whole point of binding a signature to a snapshot: a later data change
    // must not silently rewrite what someone endorsed.
    const changed = [{ ...claims[0]!, strength: 0.6 }, claims[1]!] as EvidenceClaim[];
    expect(evidenceSnapshot(changed, reasoning)).not.toBe(evidenceSnapshot(claims, reasoning));
  });

  it("CHANGES when the verdict changes", () => {
    const other = { ...reasoning, verdict: "do_not_advance" } as Reasoning;
    expect(evidenceSnapshot(claims, other)).not.toBe(evidenceSnapshot(claims, reasoning));
  });
});

/** Every leaf path of a value. `provenance.source` is nested, and swapping a
 *  citation is precisely the tamper case, so the coverage loop below must not stop
 *  at the top level. */
function leafPaths(v: unknown, prefix: string[] = []): string[][] {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return Object.keys(v).flatMap((k) => leafPaths((v as Record<string, unknown>)[k], [...prefix, k]));
  }
  return [prefix];
}

/** A value guaranteed to differ from `v`. Not schema-valid, deliberately: the
 *  snapshot hashes what it is handed, and a tamperer is not bound by the schema. */
function perturb(v: unknown): unknown {
  if (typeof v === "string") return `${v}-ALTERED`;
  if (typeof v === "number") return v + 0.01;
  if (typeof v === "boolean") return !v;
  return "ALTERED";
}

function setAt(obj: unknown, path: string[], value: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  const src = obj as Record<string, unknown>;
  return { ...src, [head]: rest.length === 0 ? value : setAt(src[head], rest, value) };
}

describe("evidenceSnapshot binds the WHOLE claim, not a chosen tuple", () => {
  const fixture = data.heroCases.get("TAK-994")!.claims!;
  const ruleset = data.ruleset;

  /**
   * Admitted, and it carries the entire belief mass on this fixture (measured:
   * argue() reports the four safe claims defeated, and mass.toxic is 0.09 from
   * this claim alone). Reclassifying a DEFEATED claim would be inert for the
   * uninteresting reason that the engine already discarded it.
   */
  const LIVE = "TAK-994:toxicogenomics-murine";

  const withField = (id: string, path: string[], value: unknown): EvidenceClaim[] =>
    fixture.map((c) => (c.id === id ? (setAt(c, path, value) as EvidenceClaim) : c));

  /** Snapshot the claims together with the verdict THEY produce, exactly as
   *  RecordTab does when someone signs. */
  const signedSnapshot = (cs: EvidenceClaim[]) => evidenceSnapshot(cs, reason(cs, ruleset));

  it("CHANGES on a reclassification the verdict cannot see", () => {
    // THE TRAP this test exists to avoid: the snapshot also carries verdict,
    // belief and plausibility, so a reclassification that MOVED the verdict would
    // change the hash for the wrong reason and pass against the narrow tuple too.
    // So the change is chosen to be verdict-inert, and the inertness is MEASURED
    // here rather than trusted - which is also what makes this test self-
    // documenting about why it can fail.
    const before = fixture;
    const after = withField(LIVE, ["inApplicabilityDomain"], null);

    const rBefore = reason(before, ruleset);
    const rAfter = reason(after, ruleset);

    // Measured inertness. R4's discount (rules.ts) and the off-the-map abstention
    // (abstain.ts) both test `=== false`, so `true` and `null` are indistinguishable
    // to every verdict path.
    expect(rAfter.verdict).toBe(rBefore.verdict);
    expect(rAfter.belief).toBe(rBefore.belief);
    expect(rAfter.plausibility).toBe(rBefore.plausibility);

    // ...and the SAME field on the SAME claim is demonstrably load-bearing at
    // `false`, so `true -> null` is a real reclassification of live evidence and
    // not a field the engine ignores outright.
    expect(reason(withField(LIVE, ["inApplicabilityDomain"], false), ruleset).belief)
      .not.toBe(rBefore.belief);

    // Therefore the snapshot can only move if the snapshot itself widened.
    expect(signedSnapshot(after)).not.toBe(signedSnapshot(before));
  });

  it("CHANGES when a citation is swapped, which the engine never reads at all", () => {
    // provenance is not consumed by any rule, but it IS rendered next to the claim
    // (EvidencePanel's `provenance` row), and "what was on screen" is the standard
    // this function sets for itself. A swapped source with identical numbers is the
    // cleanest possible tamper: nothing downstream moves.
    const before = fixture;
    const after = withField("TAK-994:cytotox", ["provenance", "source"], "A different paper entirely.");

    const rBefore = reason(before, ruleset);
    const rAfter = reason(after, ruleset);
    expect(rAfter.verdict).toBe(rBefore.verdict);
    expect(rAfter.belief).toBe(rBefore.belief);
    expect(rAfter.plausibility).toBe(rBefore.plausibility);

    expect(signedSnapshot(after)).not.toBe(signedSnapshot(before));
  });

  it("CHANGES for EVERY field of a claim, including ones no rule reads", () => {
    // The general guard, and the one that catches the NEXT omission: the reasoning
    // is held CONSTANT here, so verdict/belief/plausibility cannot be the channel.
    // Any difference comes from the claim itself.
    const claim = fixture.find((c) => c.id === "TAK-994:cytotox")!;
    const paths = leafPaths(claim);

    // Anti-vacuity (HANDOVER 5.1): an empty path list would leave `missed` empty
    // and the assertion green. Name the fields the defect actually omitted.
    expect(paths.map((p) => p.join("."))).toEqual(
      expect.arrayContaining([
        "stream", "system", "measuresKeyEvent", "exposureRelevant",
        "inApplicabilityDomain", "klimisch", "availableFrom", "provenance.source",
      ]),
    );

    const base = evidenceSnapshot([claim], reasoning);
    const missed = paths
      .filter((p) => evidenceSnapshot([setAt(claim, p, perturb(getAt(claim, p))) as EvidenceClaim], reasoning) === base)
      .map((p) => p.join("."));

    expect(missed).toEqual([]);
  });
});

function getAt(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], obj);
}

function makePosition(overrides: Partial<ReviewerPosition> = {}): ReviewerPosition {
  return {
    reviewerId: "jack.he",
    displayName: "Jack He",
    role: "Safety reviewer",
    position: "agree",
    rationale: "Looks consistent with the evidence on screen.",
    signedAt: "2026-07-28T00:00:00.000Z",
    rulesetHash: "ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136",
    evidenceSnapshotHash: "abc123",
    asOfDate: null,
    signatureMethod: "demo-persona",
    prevRecordHash: "0".repeat(64),
    ...overrides,
  };
}

describe("recordHash", () => {
  it("CHANGES when rationale changes", async () => {
    const a = await recordHash(makePosition({ rationale: "Original rationale." }));
    const b = await recordHash(makePosition({ rationale: "Tampered rationale." }));
    expect(a).not.toBe(b);
  });

  it("CHANGES when displayName changes", async () => {
    const a = await recordHash(makePosition({ displayName: "Jack He" }));
    const b = await recordHash(makePosition({ displayName: "Someone Else" }));
    expect(a).not.toBe(b);
  });

  it("CHANGES when position changes", async () => {
    const a = await recordHash(makePosition({ position: "agree" }));
    const b = await recordHash(makePosition({ position: "dissent" }));
    expect(a).not.toBe(b);
  });

  it("CHANGES when the record's OWN prevRecordHash changes (proves the chain is recursive)", async () => {
    const a = await recordHash(makePosition({ prevRecordHash: "1".repeat(64) }));
    const b = await recordHash(makePosition({ prevRecordHash: "2".repeat(64) }));
    expect(a).not.toBe(b);
  });

  it("is STABLE when two otherwise-identical records are built with fields in a different literal order", async () => {
    const a = await recordHash({
      reviewerId: "jack.he",
      displayName: "Jack He",
      role: "Safety reviewer",
      position: "agree",
      rationale: "Same rationale.",
      signedAt: "2026-07-28T00:00:00.000Z",
      rulesetHash: "ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136",
      evidenceSnapshotHash: "abc123",
      asOfDate: null,
      signatureMethod: "demo-persona",
      prevRecordHash: "0".repeat(64),
    });
    const b = await recordHash({
      prevRecordHash: "0".repeat(64),
      signatureMethod: "demo-persona",
      asOfDate: null,
      evidenceSnapshotHash: "abc123",
      rulesetHash: "ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136",
      signedAt: "2026-07-28T00:00:00.000Z",
      rationale: "Same rationale.",
      position: "agree",
      role: "Safety reviewer",
      displayName: "Jack He",
      reviewerId: "jack.he",
    });
    expect(a).toBe(b);
  });

  it("end-to-end: tampering with an earlier entry breaks the chain to later entries", async () => {
    const a = makePosition({ displayName: "Reviewer A", rationale: "A's original rationale." });
    const hashA = await recordHash(a);

    const b = makePosition({ displayName: "Reviewer B", prevRecordHash: hashA });
    const hashB = await recordHash(b);

    const c = makePosition({ displayName: "Reviewer C", prevRecordHash: hashB });
    void c;

    // Tamper with A's rationale after the fact.
    const tamperedA = { ...a, rationale: "A's TAMPERED rationale." };
    const tamperedHashA = await recordHash(tamperedA);

    expect(tamperedHashA).not.toBe(hashA);
    // B's stored prevRecordHash no longer matches the recomputed hash of (tampered) A.
    expect(b.prevRecordHash).not.toBe(tamperedHashA);
  });
});
