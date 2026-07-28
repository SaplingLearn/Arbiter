import { describe, expect, it } from "vitest";
import { evidenceSnapshot } from "../src/record/chain.js";
import type { EvidenceClaim, Reasoning } from "@arbiter/engine";

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
