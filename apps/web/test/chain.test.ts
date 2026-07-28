import { describe, expect, it } from "vitest";
import { evidenceSnapshot, recordHash } from "../src/record/chain.js";
import type { EvidenceClaim, Reasoning } from "@arbiter/engine";
import type { ReviewerPosition } from "../src/state/store.js";

const claims = [
  { id: "b", assertion: "safe", strength: 0.5 },
  { id: "a", assertion: "toxic", strength: 0.9 },
] as EvidenceClaim[];
const reasoning = { verdict: "abstain", belief: 0.1, plausibility: 0.9 } as Reasoning;

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

function makePosition(overrides: Partial<ReviewerPosition> = {}): ReviewerPosition {
  return {
    reviewerId: "jack.he",
    displayName: "Jack He",
    role: "Safety reviewer",
    position: "agree",
    rationale: "Looks consistent with the evidence on screen.",
    signedAt: "2026-07-28T00:00:00.000Z",
    rulesetHash: "v1.0",
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
      rulesetHash: "v1.0",
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
      rulesetHash: "v1.0",
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
