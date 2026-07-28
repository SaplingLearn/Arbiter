import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { reason } from "../src/index.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;

const CLAIMS: EvidenceClaim[] = [
  { id: "a", compoundId: "X", stream: "qsar", assertion: "ambiguous", strength: 0.5, system: "in_silico", measuresKeyEvent: null, exposureRelevant: null, inApplicabilityDomain: true, klimisch: null, availableFrom: "2020-01", provenance: { kind: "database", source: "t", retrieved: "2026-07-26" } },
  { id: "b", compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8, system: "human", measuresKeyEvent: null, exposureRelevant: true, inApplicabilityDomain: true, klimisch: 1, availableFrom: "2020-01", provenance: { kind: "database", source: "t", retrieved: "2026-07-26" } },
  { id: "c", compoundId: "X", stream: "toxicogenomics", assertion: "toxic", strength: 0.7, system: "rodent", measuresKeyEvent: "KE:1", exposureRelevant: true, inApplicabilityDomain: true, klimisch: 2, availableFrom: "2022-01", provenance: { kind: "literature", source: "PMID:1", retrieved: "2026-07-26" } },
  { id: "d", compoundId: "X", stream: "transporter", assertion: "safe", strength: 0.6, system: "human", measuresKeyEvent: "KE:2", exposureRelevant: null, inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01", provenance: { kind: "database", source: "t", retrieved: "2026-07-26" } },
];

describe("determinism", () => {
  it("produces exactly ONE output hash across 1000 runs", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      hashes.add(createHash("sha256").update(JSON.stringify(reason(CLAIMS, RS, "h"))).digest("hex"));
    }
    expect(hashes.size).toBe(1);
  });

  it("does not mutate its inputs, including nested objects", () => {
    // Built fresh and frozen INSIDE this test. The previous version snapshotted a
    // shared array that the 1000-run test above had already passed through
    // reason(), so any mutation that converged after the first call was invisible
    // to it - verified by injecting an idempotent write, which it did not catch.
    const fresh: EvidenceClaim[] = JSON.parse(JSON.stringify(CLAIMS));
    for (const c of fresh) Object.freeze(c.provenance);
    Object.freeze(fresh);
    const rs: Ruleset = JSON.parse(JSON.stringify(RS));
    rs.rules.forEach((r) => { Object.freeze(r.framework); Object.freeze(r); });
    Object.freeze(rs.rules);
    Object.freeze(rs);

    const before = JSON.stringify({ fresh, rs });
    reason(fresh, rs, "h");
    expect(JSON.stringify({ fresh, rs })).toBe(before);
  });
});
