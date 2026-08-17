import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chainEntry, commitmentFor, FileStore, GENESIS, MemoryStore, verifyChain, verifySeals,
  type LogEntry,
} from "../store.js";
import { canonicalJson } from "../canonical.js";
import { canonicalJson as harnessCanonicalJson } from "../../../apps/harness/src/preregistration.js";
import { addParticipant, type Position } from "../deliberation.js";

const pos = (participantId: string, over: Partial<Position> = {}): Position => ({
  participantId, call: "advance", reasoning: "Because.",
  citedFindingIds: ["f1"], external: [], submittedAt: "2026-08-09T10:00:00Z", ...over,
});

const build = (n: number): LogEntry[] => {
  const out: LogEntry[] = [];
  for (let i = 0; i < n; i++) {
    out.push(chainEntry(out.at(-1) ?? null, {
      at: `t${i}`, kind: "position_sealed", caseId: "c", actorId: `p${i}`, payload: { i },
    }));
  }
  return out;
};

describe("canonicalJson drift guard", () => {
  // The duplication in services/api/canonical.ts is held in place by this test, not
  // by discipline. If the two ever disagreed, positions sealed by one and verified
  // by the other would report tampering that never happened.
  const fixtures: unknown[] = [
    null, 0, "", "a\"b", true,
    [1, "two", null],
    { b: 1, a: 2 },
    { z: { y: [1, { b: 2, a: 3 }] }, a: "x" },
    { nested: [[{ d: 4, c: [null, false] }]] },
    { "key with spaces": 1, "ünïcode": "ü" },
  ];

  it.each(fixtures.map((f, i) => [i, f]))("agrees with the harness on fixture %i", (_i, f) => {
    expect(canonicalJson(f)).toBe(harnessCanonicalJson(f));
  });

  it("sorts keys so load order cannot change a hash", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
});

describe("chainEntry", () => {
  it("chains the first entry to genesis, so the front cannot be truncated silently", () => {
    const [first] = build(1);
    expect(first!.prevHash).toBe(GENESIS);
    expect(first!.seq).toBe(0);
  });

  it("chains each entry to the previous hash", () => {
    const entries = build(3);
    expect(entries[1]!.prevHash).toBe(entries[0]!.hash);
    expect(entries[2]!.prevHash).toBe(entries[1]!.hash);
  });

  it("is deterministic: the same inputs produce the same hash", () => {
    expect(build(3).map((e) => e.hash)).toEqual(build(3).map((e) => e.hash));
  });
});

describe("verifyChain", () => {
  it("passes a well-formed chain", () => {
    expect(verifyChain(build(5))).toEqual([]);
  });

  it("passes an empty log", () => {
    expect(verifyChain([])).toEqual([]);
  });

  it("catches an edited payload", () => {
    const entries = build(3);
    entries[1] = { ...entries[1]!, payload: { i: 99 } };
    const f = verifyChain(entries);
    expect(f.some((x) => x.kind === "bad_hash")).toBe(true);
  });

  it("catches a removed entry", () => {
    const entries = build(4);
    const f = verifyChain([entries[0]!, entries[2]!, entries[3]!]);
    expect(f.some((x) => x.kind === "bad_sequence")).toBe(true);
    expect(f.some((x) => x.kind === "broken_link")).toBe(true);
  });

  it("catches reordering", () => {
    const entries = build(3);
    const f = verifyChain([entries[0]!, entries[2]!, entries[1]!]);
    expect(f.length).toBeGreaterThan(0);
  });

  it("catches an entry appended in front of the genesis link", () => {
    const entries = build(2);
    const forged = chainEntry(null, { at: "t", kind: "signed", caseId: "c", actorId: "x", payload: {} });
    expect(verifyChain([forged, ...entries]).length).toBeGreaterThan(0);
  });
});

describe("verifySeals - the blindness audit", () => {
  const sealFor = (p: Position): LogEntry[] => [chainEntry(null, {
    at: p.submittedAt, kind: "position_sealed", caseId: "c", actorId: p.participantId,
    payload: { participantId: p.participantId, commitment: commitmentFor(p) },
  })];

  it("passes a position revealed exactly as it was sealed", () => {
    const p = pos("ann");
    expect(verifySeals(sealFor(p), [p])).toEqual([]);
  });

  it("catches a position edited after sealing", () => {
    const p = pos("ann");
    const edited = { ...p, call: "do_not_advance" as const };
    const breaks = verifySeals(sealFor(p), [edited]);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.detail).toContain("edited after sealing");
  });

  it("catches an edit to the reasoning alone", () => {
    // The commitment covers every field, not an enumerated subset. An enumeration
    // fails silently the day somebody adds a field and forgets to list it.
    const p = pos("ann");
    expect(verifySeals(sealFor(p), [{ ...p, reasoning: "Different." }])).toHaveLength(1);
  });

  it("catches an edit to the citations alone", () => {
    const p = pos("ann");
    expect(verifySeals(sealFor(p), [{ ...p, citedFindingIds: [] }])).toHaveLength(1);
  });

  it("catches a position inserted after the reveal with no seal at all", () => {
    const breaks = verifySeals(sealFor(pos("ann")), [pos("ann"), pos("bea")]);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]!.participantId).toBe("bea");
    expect(breaks[0]!.detail).toContain("not submitted through the blind phase");
  });

  it("is insensitive to key order, so a round-trip through JSON still verifies", () => {
    const p = pos("ann");
    const roundTripped = JSON.parse(JSON.stringify({
      submittedAt: p.submittedAt, external: p.external, citedFindingIds: p.citedFindingIds,
      reasoning: p.reasoning, call: p.call, participantId: p.participantId,
    })) as Position;
    expect(verifySeals(sealFor(p), [roundTripped])).toEqual([]);
  });
});

describe("MemoryStore", () => {
  it("appends into one chain and filters by case on read", async () => {
    const s = new MemoryStore();
    await s.append({ at: "t0", kind: "case_opened", caseId: "a", actorId: "o", payload: {} });
    await s.append({ at: "t1", kind: "case_opened", caseId: "b", actorId: "o", payload: {} });
    await s.append({ at: "t2", kind: "signed", caseId: "a", actorId: "o", payload: {} });
    expect(await s.entries("a")).toHaveLength(2);
    expect(verifyChain(await s.all())).toEqual([]);
  });

  it("interleaves cases without breaking the chain", async () => {
    // The chain is global rather than per-case: a per-case chain lets a whole case
    // be deleted without leaving a hole.
    const s = new MemoryStore();
    for (let i = 0; i < 6; i++) {
      await s.append({ at: `t${i}`, kind: "position_sealed", caseId: i % 2 === 0 ? "a" : "b", actorId: "p", payload: { i } });
    }
    expect(verifyChain(await s.all())).toEqual([]);
    expect(await s.entries("a")).toHaveLength(3);
  });

  /**
   * THE APPEND MUST NOT BE INTERLEAVABLE, and this is the test that can fail if it
   * is. Every other case here awaits each append in turn, which is exactly the
   * pattern that hides the defect: fire six without awaiting between them and any
   * implementation that yields between reading the tail and writing the entry
   * produces two entries claiming the same `seq`, which `verifyChain` reports.
   */
  it("keeps one chain when six appends are issued without awaiting between them", async () => {
    const s = new MemoryStore();
    await Promise.all([0, 1, 2, 3, 4, 5].map((i) =>
      s.append({ at: `t${i}`, kind: "position_sealed", caseId: "a", actorId: "p", payload: { i } })));
    const all = await s.all();
    expect(all.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(verifyChain(all)).toEqual([]);
  });
});

describe("FileStore", () => {
  const tmp = (): string => join(mkdtempSync(join(tmpdir(), "arbiter-store-")), "log.jsonl");

  it("survives a restart with the chain intact", async () => {
    const path = tmp();
    const a = await FileStore.open(path);
    await a.append({ at: "t0", kind: "case_opened", caseId: "c", actorId: "o", payload: { x: 1 } });
    await a.append({ at: "t1", kind: "position_sealed", caseId: "c", actorId: "ann", payload: { commitment: "abc" } });

    const b = await FileStore.open(path);
    expect(await b.all()).toHaveLength(2);
    expect(verifyChain(await b.all())).toEqual([]);

    await b.append({ at: "t2", kind: "signed", caseId: "c", actorId: "o", payload: {} });
    expect(verifyChain(await (await FileStore.open(path)).all())).toEqual([]);
  });

  /**
   * THE FILE HAS TO BE LOADED BEFORE THE STORE IS USABLE, and only the factory can
   * promise that. Loading used to happen in the constructor, which is impossible to
   * keep once it awaits: the store would come back with an empty log and fill in a
   * tick later, so the first append would chain to GENESIS on top of an existing
   * file - a fork that reads as tampering.
   *
   * This asserts the property rather than the mechanism: open, then append, and the
   * new entry must continue the chain rather than restart it.
   */
  it("has the whole log in hand before it hands the store back", async () => {
    const path = tmp();
    const a = await FileStore.open(path);
    await a.append({ at: "t0", kind: "case_opened", caseId: "c", actorId: "o", payload: {} });
    await a.append({ at: "t1", kind: "signed", caseId: "c", actorId: "o", payload: {} });

    const b = await FileStore.open(path);
    const next = await b.append({ at: "t2", kind: "signed", caseId: "c", actorId: "o", payload: {} });
    expect(next.seq).toBe(2);
    expect(next.prevHash).not.toBe(GENESIS);
    expect(verifyChain(await (await FileStore.open(path)).all())).toEqual([]);
  });

  it("keeps position plaintext out of the log file, so a mid-case export reveals nothing", async () => {
    // The two-file split is load-bearing. A single file holding both would make
    // every export a reveal, and the blind phase would end the first time anyone
    // asked to see the audit trail.
    const path = tmp();
    const s = await FileStore.open(path);
    const p = pos("ann", { reasoning: "SECRET-REASONING-TOKEN" });
    await s.append({
      at: p.submittedAt, kind: "position_sealed", caseId: "c", actorId: "ann",
      payload: { participantId: "ann", commitment: commitmentFor(p) },
    });
    expect(readFileSync(path, "utf8")).not.toContain("SECRET-REASONING-TOKEN");
  });

  it("round-trips case state", async () => {
    const path = tmp();
    const a = await FileStore.open(path);
    await a.putCase({
      caseId: "c", compoundLabel: "X", context: "", ownerId: "o", participantIds: ["ann"],
      seats: { ann: 0 },
      status: "open", positions: [pos("ann")], closedEarly: null, adjudication: null,
      consensus: null, signature: null,
    });
    const reloaded = await (await FileStore.open(path)).getCase("c");
    expect(reloaded?.positions).toHaveLength(1);
    // The seat map survives the round trip too. The hand-written `seats: {}` this
    // fixture used to carry made every reload look migrated, which is exactly what
    // hid the missing-seats case below.
    expect(reloaded?.seats).toEqual({ ann: 0 });
    expect(await (await FileStore.open(path)).getCase("nope")).toBeNull();
  });

  /**
   * THE MIGRATION. `.cases.json` outlives the schema that wrote it, and every case
   * written before this branch has no `seats` key at all.
   *
   * Rehydrating those as-is left `seats` undefined, and the seat transitions read it
   * unguarded - `withParticipant(undefined, id)` throws on `'userId' in undefined`,
   * which the request handler's outer catch turns into an opaque 500. So adding
   * anybody to any pre-existing case failed, with a message that named nothing. A
   * missing map is an EMPTY map.
   */
  it("gives a case written before seats existed an empty seat map", async () => {
    const path = tmp();
    // Written by hand, WITHOUT the field - a putCase() fixture would write the
    // current schema and could never reproduce the file this is about.
    writeFileSync(`${path}.cases.json`, JSON.stringify([{
      caseId: "legacy", compoundLabel: "X", context: "", ownerId: "o",
      participantIds: ["ann"], status: "open", positions: [],
      closedEarly: null, adjudication: null, signature: null,
    }]), "utf8");

    const loaded = await (await FileStore.open(path)).getCase("legacy");
    expect(loaded?.seats).toEqual({});
    // And the transition that used to throw now runs, handing out seat 0.
    expect(addParticipant(loaded!, "bea")).toEqual({
      ok: true,
      value: expect.objectContaining({ seats: { bea: 0 } }) as unknown,
    });
  });
});
