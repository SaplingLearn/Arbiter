import { createHash } from "node:crypto";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalJson } from "./canonical.js";
import type { DeliberationCase, Position } from "./deliberation.js";

/**
 * The deliberation log: append-only, hash-chained, one JSON object per line.
 *
 * WHY THIS AND NOT POSTGRES, WHICH IS WHAT SPEC §3.3 SAYS.
 *
 * Recorded as a deliberate deviation, with the reason, because the spec is the
 * document a later reader trusts.
 *
 * The property the deliberation actually needs is not a query engine. It is that a
 * position cannot be written, or rewritten, after its author has seen someone
 * else's - and a mutable row in a table cannot demonstrate that, because an UPDATE
 * leaves nothing behind. A hash chain can: every entry commits to the one before it,
 * so altering any earlier entry breaks every hash after it, and the break is
 * detectable by anyone holding the file.
 *
 * The secondary reason is honest and smaller: no database server exists on the
 * machine this has to run on, and a demo that cannot start is not a product. The
 * `DeliberationStore` interface is the seam, and the chain columns transfer as-is.
 *
 * THAT SEAM COST A CALLER CHANGE AFTER ALL. This paragraph used to claim a Postgres
 * implementation would satisfy the interface "without any caller changing". It was
 * wrong, and wrong in the way that matters: every method here returned a value
 * rather than a promise, and no database returns a row synchronously. So the
 * interface below is asynchronous, and `DeliberationService`, `server.ts` and the
 * tests were all made to await it - with File and Memory still the only
 * implementations, deliberately, so the change is reviewable and CI stays green on a
 * machine with no database. See docs/design/supabase-contract.md.
 *
 * WHAT THE CHAIN PROVES, AND WHAT IT DOES NOT.
 *
 * It proves that the content of a position is the content that was sealed at submit
 * time: the commitment hash is written to the log while the case is still open and
 * before anything is revealed, and the plaintext published at reveal must hash to it.
 * Post-hoc editing is therefore detectable by any participant.
 *
 * It does NOT prove that the server never read a position early, and no
 * server-side scheme can - the server holds the plaintext because it has to hand it
 * to the adjudicator. Participants trust the operator on that point. Saying so here
 * matters more than the guarantee itself: a reader who believes this is
 * cryptographically blind will trust a property nobody built.
 */

export interface LogEntry {
  seq: number;
  at: string;
  kind: LogKind;
  caseId: string;
  actorId: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}

export type LogKind =
  | "case_opened"
  | "inventory_published"
  // WHO ANSWERS IS PART OF THE RECORD, and this is why these three exist. Choosing
  // the panel is the strongest lever anybody has on the outcome - a convener who can
  // quietly drop the person most likely to dissent decides the case without ever
  // stating a position. Roster changes used to update the case and leave the log
  // untouched, so exactly that move was invisible to the audit.
  | "participant_added"
  | "participant_removed"
  | "case_described"
  | "position_sealed"
  | "revealed"
  | "adjudicated"
  | "signed";

/** The genesis link. A chain whose first entry chained to nothing could be truncated
 *  from the front without leaving a trace. */
export const GENESIS = "0".repeat(64);

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * The commitment. Covers EVERY field of the position, including the timestamp.
 *
 * Whole-object by default, on the same reasoning as `evidenceSnapshot` in
 * apps/web/src/record/chain.ts: an enumeration of fields to include fails silently
 * when somebody adds a field and forgets to list it, and the seal then certifies
 * something it never saw. If a future field must be excluded, the reason belongs
 * right here and has to answer what makes that field something the author did not
 * commit to.
 */
export function commitmentFor(p: Position): string {
  return sha256Hex(canonicalJson(p));
}

export function chainEntry(
  prev: LogEntry | null,
  e: { at: string; kind: LogKind; caseId: string; actorId: string; payload: unknown },
): LogEntry {
  const prevHash = prev === null ? GENESIS : prev.hash;
  const seq = prev === null ? 0 : prev.seq + 1;
  const body = { seq, at: e.at, kind: e.kind, caseId: e.caseId, actorId: e.actorId, payload: e.payload, prevHash };
  return { ...body, hash: sha256Hex(canonicalJson(body)) };
}

export interface ChainFailure {
  seq: number;
  kind: "bad_hash" | "broken_link" | "bad_sequence";
  detail: string;
}

export function verifyChain(entries: LogEntry[]): ChainFailure[] {
  const failures: ChainFailure[] = [];
  let prev: LogEntry | null = null;

  for (const e of entries) {
    const expectedSeq = prev === null ? 0 : prev.seq + 1;
    if (e.seq !== expectedSeq) {
      failures.push({ seq: e.seq, kind: "bad_sequence", detail: `Entry claims sequence ${e.seq}; the chain expects ${expectedSeq}. An entry has been removed or reordered.` });
    }
    const expectedPrev = prev === null ? GENESIS : prev.hash;
    if (e.prevHash !== expectedPrev) {
      failures.push({ seq: e.seq, kind: "broken_link", detail: `Entry ${e.seq} chains to ${e.prevHash.slice(0, 12)}…; the previous entry hashes to ${expectedPrev.slice(0, 12)}…` });
    }
    const recomputed = sha256Hex(canonicalJson({
      seq: e.seq, at: e.at, kind: e.kind, caseId: e.caseId,
      actorId: e.actorId, payload: e.payload, prevHash: e.prevHash,
    }));
    if (recomputed !== e.hash) {
      failures.push({ seq: e.seq, kind: "bad_hash", detail: `Entry ${e.seq} (${e.kind}) has been altered since it was written.` });
    }
    prev = e;
  }
  return failures;
}

export interface SealBreak {
  participantId: string;
  detail: string;
}

/**
 * The blindness audit: every revealed position must hash to the commitment written
 * while the case was still open.
 *
 * This is the function a sceptical participant runs. It answers "was the answer I am
 * reading the answer that was submitted", which is the only part of blindness that
 * can be demonstrated rather than promised.
 *
 * A position with no `position_sealed` entry is a failure, not a skip. Silently
 * passing an unsealed position would let a position inserted after the reveal be
 * indistinguishable from one submitted honestly - the exact tamper this exists to
 * catch.
 */
export function verifySeals(entries: LogEntry[], revealed: Position[]): SealBreak[] {
  const sealed = new Map<string, string>();
  for (const e of entries) {
    if (e.kind !== "position_sealed") continue;
    const p = e.payload as { participantId?: unknown; commitment?: unknown };
    if (typeof p?.participantId === "string" && typeof p?.commitment === "string") {
      sealed.set(p.participantId, p.commitment);
    }
  }

  const breaks: SealBreak[] = [];
  for (const p of revealed) {
    const commitment = sealed.get(p.participantId);
    if (commitment === undefined) {
      breaks.push({ participantId: p.participantId, detail: `No sealed commitment was recorded for ${p.participantId}. This position was not submitted through the blind phase.` });
      continue;
    }
    const actual = commitmentFor(p);
    if (actual !== commitment) {
      breaks.push({ participantId: p.participantId, detail: `${p.participantId}'s revealed position hashes to ${actual.slice(0, 12)}…, but ${commitment.slice(0, 12)}… was sealed at submit time. It was edited after sealing.` });
    }
  }
  return breaks;
}

/**
 * ASYNCHRONOUS, THOUGH NEITHER IMPLEMENTATION IN THIS FILE HAS ANYTHING TO AWAIT.
 *
 * That is the point of the shape rather than an accident of it. The two stores here
 * hold their state in memory and could answer every one of these synchronously; the
 * store this interface exists to admit cannot. Returning `LogEntry` instead of
 * `Promise<LogEntry>` is a decision every caller inherits, and undoing it later means
 * touching all of them at once - which is precisely the change this phase makes, and
 * the reason it is a phase of its own.
 */
export interface DeliberationStore {
  append(e: { at: string; kind: LogKind; caseId: string; actorId: string; payload: unknown }): Promise<LogEntry>;
  entries(caseId: string): Promise<LogEntry[]>;
  all(): Promise<LogEntry[]>;
  putCase(c: DeliberationCase): Promise<void>;
  getCase(caseId: string): Promise<DeliberationCase | null>;
  allCases(): Promise<DeliberationCase[]>;
}

/**
 * In-memory implementation. The case snapshot is a convenience projection; the LOG
 * is the record. If the two ever disagree the log wins, because the log is the thing
 * whose history is verifiable.
 */
export class MemoryStore implements DeliberationStore {
  protected log: LogEntry[] = [];
  protected cases = new Map<string, DeliberationCase>();

  /**
   * The two mutations, factored out of their own async wrappers so that `FileStore`
   * can reach them WITHOUT an await in between.
   *
   * `override async append() { const e = await super.append(x); appendFileSync(…) }`
   * reads like the obvious subclass and is wrong: the await yields the event loop
   * between the in-memory push and the file write, so a second append can push and
   * write its own line first. The log in memory stays correctly ordered and the file
   * on disk holds seq 1 before seq 0 - a chain that verifies in this process and
   * fails `verifyChain` the moment anybody restarts and reads it back.
   */
  protected appendInMemory(e: { at: string; kind: LogKind; caseId: string; actorId: string; payload: unknown }): LogEntry {
    const entry = chainEntry(this.log.at(-1) ?? null, e);
    this.log.push(entry);
    return entry;
  }

  protected putCaseInMemory(c: DeliberationCase): void {
    this.cases.set(c.caseId, c);
  }

  async append(e: { at: string; kind: LogKind; caseId: string; actorId: string; payload: unknown }): Promise<LogEntry> {
    return this.appendInMemory(e);
  }

  async entries(caseId: string): Promise<LogEntry[]> {
    return this.log.filter((e) => e.caseId === caseId);
  }

  async all(): Promise<LogEntry[]> {
    return [...this.log];
  }

  async putCase(c: DeliberationCase): Promise<void> {
    this.putCaseInMemory(c);
  }

  async getCase(caseId: string): Promise<DeliberationCase | null> {
    return this.cases.get(caseId) ?? null;
  }

  async allCases(): Promise<DeliberationCase[]> {
    return [...this.cases.values()];
  }
}

/**
 * File-backed, one JSON object per line, opened for append only.
 *
 * The chain is global rather than per-case: a per-case chain lets a whole case be
 * deleted without leaving a hole, and "this case never existed" is a more useful
 * tamper than "this position was edited".
 *
 * TWO FILES, AND THE SPLIT IS LOAD-BEARING. The log holds commitments; the sibling
 * `.cases.json` holds live case state including position plaintext. That is what
 * lets the log be handed to a participant, or an auditor, WHILE A CASE IS STILL
 * OPEN without revealing anybody's answer - the file they receive contains hashes.
 * A single file holding both would make every export a reveal, and the blind phase
 * would end the first time anyone asked to see the audit trail.
 */
export class FileStore extends MemoryStore {
  private readonly casesPath: string;

  /**
   * OPENED, NOT CONSTRUCTED - and the constructor is private so it cannot be done
   * the other way.
   *
   * Both files used to be read here, in the constructor, which works exactly as long
   * as reading them is synchronous. A constructor cannot await. The moment loading
   * becomes asynchronous - and it has to, because the store this seam exists to admit
   * loads over a socket - a `new FileStore(path)` hands back a store whose `log` is
   * still empty and fills in some milliseconds later. The first append against that
   * store chains to GENESIS on top of a file that already has entries in it: a chain
   * forked by a race, which `verifyChain` then reports as tampering nobody did.
   *
   * So construction and loading are separated and only the factory is exported. A
   * caller cannot hold a half-loaded store because there is no syntax for making one.
   */
  private constructor(private readonly path: string) {
    super();
    this.casesPath = `${path}.cases.json`;
  }

  static async open(path: string): Promise<FileStore> {
    const store = new FileStore(path);
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    if (existsSync(this.path)) {
      const text = await readFile(this.path, "utf8");
      this.log = text.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as LogEntry);
    }
    if (existsSync(this.casesPath)) {
      const raw = JSON.parse(await readFile(this.casesPath, "utf8")) as DeliberationCase[];
      // NORMALISED ON LOAD, because this file outlives the schema that wrote it.
      // Every case written before seats existed has no `seats` key, and the seat
      // transitions read it unguarded - `withParticipant(undefined, id)` throws on
      // `'userId' in undefined`, which the request handler's outer catch turns into
      // an opaque 500. That is: adding anybody to any pre-existing case failed, and
      // failed with a message naming nothing. A missing map is an EMPTY map; the
      // first participant added then gets seat 0, exactly as a new case would.
      for (const c of raw) this.cases.set(c.caseId, { ...c, seats: c.seats ?? {} });
    }
  }

  /**
   * THE WRITE STAYS SYNCHRONOUS INSIDE AN ASYNCHRONOUS METHOD, deliberately.
   *
   * `chainEntry` reads the current tail and the entry it produces must be the one
   * that lands next. Anywhere an `await` sits between that read and that write, a
   * second append can run in the gap: both compute from the same tail, both claim the
   * same `seq`, and the second overwrites the first's link. `appendFileSync` cannot
   * be interleaved by the event loop, so read-compute-write is atomic here without a
   * lock, and it is atomic today - swapping in `fs/promises` to make the file access
   * look consistent with the signature would introduce exactly that race.
   *
   * A database implementation has to buy the same property a different way, because
   * it genuinely does await mid-sequence: `SELECT … FOR UPDATE` under a global
   * advisory lock, per docs/design/supabase-contract.md. Global, not per case - the
   * chain is global, so a per-case lock would let two cases fork it.
   */
  override async append(e: { at: string; kind: LogKind; caseId: string; actorId: string; payload: unknown }): Promise<LogEntry> {
    const entry = this.appendInMemory(e);
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }

  /** Synchronous for the same reason `append` is: this serialises the whole map, so
   *  two writes racing across an await would leave the older snapshot on disk. */
  override async putCase(c: DeliberationCase): Promise<void> {
    this.putCaseInMemory(c);
    writeFileSync(this.casesPath, JSON.stringify([...this.cases.values()], null, 2), "utf8");
  }
}
