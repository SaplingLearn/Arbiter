import type { Pool, PoolClient } from "pg";
import { withTransaction, pool } from "./db.js";
import { chainEntry, type DeliberationStore, type LogEntry, type LogKind } from "./store.js";
import type { DeliberationCase } from "./deliberation.js";

/**
 * The deliberation log in Postgres. Same chain, same hashes, different substrate.
 *
 * `store.ts` explains what the chain proves and why it is global rather than per-case;
 * this file only has to preserve that. Everything interesting here is about the one
 * property a file gets for free and a database does not: that reading the tail and
 * writing the next entry cannot be interleaved.
 *
 * `FileStore` buys it with `appendFileSync` - the event loop cannot run anything
 * between the read and the write, so no lock is needed. Every statement below is a
 * round trip over a socket, so the gap `FileStore` does not have is the normal case
 * here. `appendInMemory` + `INSERT` would be wrong in the same way `store.ts:319`
 * describes: two appends read the same tail, both compute the same `seq`, and the
 * chain forks. The advisory lock in `append()` is what closes it.
 *
 * NOTHING IS CACHED IN THIS PROCESS, and that is the point of it rather than an
 * omission. `MemoryStore` keeps `this.log` and answers from it; a Postgres-backed
 * store that did the same would hold a copy that a second server process invalidates
 * on its first append, and the stale tail is exactly what forks the chain. The
 * database is the only copy, and every read goes to it.
 */

/** Every column, in the order `toEntry` reads them. Named once so a column added to
 *  the table cannot be selected by one query and missed by another. */
const LOG_COLUMNS = "seq, at, kind, case_id, actor_id, payload, prev_hash, hash";

/**
 * THE LOCK IS OVER THE WHOLE TABLE, NOT OVER A CASE.
 *
 * `hashtext('deliberation_log')` is a constant: every appender in every process
 * computes the same key and therefore queues behind the same lock. Hashing the case id
 * instead would give each case its own lock and let two cases append concurrently -
 * which reads as a sensible optimisation and forks the chain, because the chain spans
 * every case (store.ts:262). Two appends under two different locks both read the same
 * tail and both claim its successor.
 *
 * The primary key on `seq` is the backstop, not the mechanism: if this lock were ever
 * wrong the second INSERT would fail on a duplicate key rather than silently produce a
 * fork. A loud failure is the point of the constraint, but it is not a substitute for
 * taking the lock, because the append it rejects is one somebody made.
 */
const APPEND_LOCK = "select pg_advisory_xact_lock(hashtext('deliberation_log'))";

type LogRow = {
  seq: number;
  at: string;
  kind: string;
  case_id: string;
  actor_id: string;
  payload: unknown;
  prev_hash: string;
  hash: string;
};

type CaseRow = { data: DeliberationCase };

/**
 * `seq` is a number rather than a string because of the `int8` parser in `db.ts` - by
 * `pg`'s own default a bigint arrives as text, and `LogEntry.seq` is typed `number`, so
 * it would sort lexicographically ("10" < "9") without complaint. Importing `db.ts`,
 * which this file does for `withTransaction`, is what registers that parser.
 *
 * `at` needs no parser at all: the column is `text`, so it arrives as the string that
 * was written. `db.ts`'s `timestamptz` parser exists for the other six tables, whose
 * timestamps are compared rather than hashed.
 */
function toEntry(r: LogRow): LogEntry {
  return {
    seq: r.seq,
    at: r.at,
    kind: r.kind as LogKind,
    caseId: r.case_id,
    actorId: r.actor_id,
    payload: r.payload,
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}

/**
 * The case document, with the same repair `FileStore.load` applies.
 *
 * A row in `deliberation_cases` written by `putCase` always carries `seats`. A row
 * imported from an existing `.cases.json` need not: every case written before seats
 * existed has no such key, and the seat transitions read it unguarded, so
 * `withParticipant(undefined, id)` throws on `'userId' in undefined` and the request
 * handler's outer catch turns that into an opaque 500. That is: adding anybody to any
 * migrated case fails, with a message naming nothing. A missing map is an EMPTY map.
 */
function toCase(data: DeliberationCase): DeliberationCase {
  return { ...data, seats: data.seats ?? {} };
}

/**
 * NOTHING VALIDATES OR NORMALISES `at` HERE, AND THAT IS THE FIX RATHER THAN AN
 * OVERSIGHT.
 *
 * `at` is inside the hash preimage - `chainEntry` hashes it as the string it arrived
 * as - so the only thing this store owes it is to hand back the same bytes. It does,
 * because the column is `text`. The migration states the general rule beside it: a
 * column covered by the hash must round-trip byte-for-byte, and storage may not
 * normalise a hash preimage.
 *
 * This file briefly carried a guard that rejected any `at` which was not exactly
 * `Date#toISOString()` output, back when the column was `timestamptz` and the round
 * trip really did rewrite the string. That guard is gone with the column type, and
 * reinstating it as input validation would cost something real: `MemoryStore` and
 * `FileStore` accept any string, so a `PostgresStore` that refused some of them would
 * make swapping the implementation behind `DeliberationStore` a behaviour change
 * rather than a substitution - and the seam exists precisely so it is not one.
 * Validating what a client may put in `submittedAt` is a question for the request
 * boundary, where the untrusted value arrives.
 */

export class PostgresStore implements DeliberationStore {
  /**
   * The pool is injected rather than fetched, so a test can point one store at a
   * throwaway database while the process-wide pool from `db.ts` keeps pointing at the
   * real one. Defaulting to `pool()` keeps the ordinary construction a `new
   * PostgresStore()`; `db.ts` explains why there is only ever one pool per process.
   */
  constructor(private readonly p: Pool = pool()) {}

  /**
   * BEGIN; take the global lock; read the tail; chain; INSERT; COMMIT.
   *
   * Every statement goes to `client`, never to `this.p`. `db.ts` spells out what the
   * other spelling costs: a pool hands out a different connection per query, so a
   * `pool.query` here would run the tail read or the insert on a connection that is
   * not in this transaction and not holding this lock. The advisory lock would be held
   * by a connection doing nothing while the append it was taken for raced unprotected
   * on another - and the symptom is simply that the lock appears not to work.
   *
   * The tail read comes AFTER the lock, and that order is the whole mechanism. Under
   * READ COMMITTED - what `db.ts`'s bare `BEGIN` gives - each statement takes its own
   * snapshot, so the read sees the row committed by whichever appender we just queued
   * behind. Taken before the lock it would see the tail as it was before that
   * appender's insert, and both entries would chain to the same predecessor.
   *
   * `pg_advisory_xact_lock` is released by the COMMIT or the ROLLBACK, so a failed
   * append cannot leave the log locked for the life of the connection.
   */
  async append(e: { at: string; kind: LogKind; caseId: string; actorId: string; payload: unknown }): Promise<LogEntry> {
    return withTransaction(async (client: PoolClient) => {
      await client.query(APPEND_LOCK);
      const tail = await client.query<LogRow>(`select ${LOG_COLUMNS} from deliberation_log order by seq desc limit 1`);
      const prev = tail.rows[0] === undefined ? null : toEntry(tail.rows[0]);

      // `chainEntry` from store.ts, unchanged and not reimplemented: it is the same
      // function `verifyChain` checks against, so a second spelling of it here would
      // produce entries that fail verification for no reason a reader could see.
      //
      // The whole previous row is read rather than just its `seq` and `hash` because
      // `chainEntry` takes a LogEntry and decides for itself which of its fields the
      // link covers. Passing a stub with the other six fields invented would keep
      // working right up until that decision changed, and then break silently.
      const entry = chainEntry(prev, e);

      await client.query(
        `insert into deliberation_log (${LOG_COLUMNS}) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          entry.seq, entry.at, entry.kind, entry.caseId, entry.actorId,
          // Serialised here rather than handed to `pg` as an object: a payload that is
          // a bare string or number would otherwise be sent as text and rejected by
          // jsonb. `?? "null"` covers `payload: undefined`, which JSON.stringify drops
          // entirely and the NOT NULL column would then refuse - and null is already
          // what `canonicalJson` hashed it as, so the stored hash stays honest.
          JSON.stringify(entry.payload) ?? "null",
          entry.prevHash, entry.hash,
        ],
      );

      // The entry as it was built, not as it reads back. They are identical - the
      // round trip is what the tests pin down - and returning the built one keeps the
      // append one round trip rather than two.
      return entry;
    }, this.p);
  }

  /** Ordered by `seq`, the global chain order, so a case's slice of the log reads in
   *  the order it was written. Served by the `(case_id, seq)` index. */
  async entries(caseId: string): Promise<LogEntry[]> {
    const r = await this.p.query<LogRow>(`select ${LOG_COLUMNS} from deliberation_log where case_id = $1 order by seq`, [caseId]);
    return r.rows.map(toEntry);
  }

  /** `order by seq` is not a nicety: `verifyChain` walks the array in order and reports
   *  `bad_sequence` on anything else, and Postgres returns rows in whatever order it
   *  finds them absent an ORDER BY. */
  async all(): Promise<LogEntry[]> {
    const r = await this.p.query<LogRow>(`select ${LOG_COLUMNS} from deliberation_log order by seq`);
    return r.rows.map(toEntry);
  }

  /**
   * The case document is rewritten whole on every change, as it is in both other
   * stores - `deliberation_cases` holds it as one jsonb value for that reason.
   *
   * One statement, so it needs no transaction and `this.p.query` is correct here. The
   * warning in `db.ts` is about issuing a statement on the pool while a transaction is
   * open on a client; a lone upsert is atomic on its own.
   *
   * `updated_at` is set explicitly on the conflict branch because the column default
   * only fires on insert - without this it would silently mean "created_at", and a
   * case would look untouched since the day it was opened.
   */
  async putCase(c: DeliberationCase): Promise<void> {
    await this.p.query(
      `insert into deliberation_cases (case_id, data) values ($1, $2)
       on conflict (case_id) do update set data = excluded.data, updated_at = now()`,
      [c.caseId, JSON.stringify(c)],
    );
  }

  async getCase(caseId: string): Promise<DeliberationCase | null> {
    const r = await this.p.query<CaseRow>("select data from deliberation_cases where case_id = $1", [caseId]);
    const row = r.rows[0];
    return row === undefined ? null : toCase(row.data);
  }

  /**
   * ORDERED, THOUGH THE INTERFACE DOES NOT DEMAND IT. Postgres returns rows in
   * whatever order the scan produces, and that order changes when a row is updated -
   * so the case list on the home screen would reshuffle every time anybody touched any
   * case, which reads as a bug in the UI rather than as an unordered query. `case_id`
   * is stable and never rewritten, so it is the ordering that does not move.
   */
  async allCases(): Promise<DeliberationCase[]> {
    const r = await this.p.query<CaseRow>("select data from deliberation_cases order by case_id");
    return r.rows.map((row) => toCase(row.data));
  }
}
