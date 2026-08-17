import pg from "pg";

/**
 * The Postgres connection, and the two type coercions that make it safe to use here.
 *
 * ONE POOL FOR THE PROCESS. Every store shares it. `pg` pools per-Pool, so three stores
 * holding three pools against one database is three times the connection budget for no
 * concurrency gained - and Supabase's connection limits are the smallest number in this
 * deployment, not the largest.
 *
 * ────────────────────────────────────────────────────────────────────────────────
 * THE TWO TYPE PARSERS BELOW ARE NOT TIDYING. Each fixes a bug that fails SILENTLY.
 * ────────────────────────────────────────────────────────────────────────────────
 *
 * `pg` maps Postgres types to JavaScript ones by its own defaults, and two of those
 * defaults are wrong for this codebase in a way that produces no error, no exception and
 * no failing test - just an answer that is quietly incorrect.
 *
 * 1. TIMESTAMPTZ ARRIVES AS A `Date`, AND THIS CODEBASE COMPARES ISO STRINGS.
 *
 *    Every store here holds timestamps as ISO-8601 strings, written by `.toISOString()`,
 *    and compares them by `Date.parse(...)`. Hand `Date.parse` a `Date` object and it
 *    does not throw. It coerces via `toString()`, and what happens next depends on the
 *    engine - which is the actual reason this parser exists, because BOTH outcomes are
 *    wrong and only one of them is survivable:
 *
 *      - On V8, `Date#toString()` is a format `Date.parse` accepts, but it carries no
 *        milliseconds. So the value comes back TRUNCATED TO THE SECOND BELOW, and a
 *        session expires up to 999ms early. Measured, not assumed: re-registering pg's
 *        default parser makes the "one millisecond before expiry" test report
 *        `session_expired`. Fail-closed, and mild - but it makes an exact expiry test
 *        fail for a reason that has nothing to do with expiry.
 *      - On an engine whose `toString()` `Date.parse` does not accept, the answer is
 *        `NaN`, every comparison against `NaN` is `false`, `expiresAt <= now` is false
 *        for an expired session, and `AuthStore.resolve` reports a session that ran out
 *        days ago as LIVE. That one fails open, which is the worst shape an
 *        authentication bug can take.
 *
 *    Neither is a thrown error and neither looks wrong at the call site. Returning the
 *    string the code already expects removes the dependence on which engine is running.
 *
 *    Re-emitting `.toISOString()` rather than handing back the raw Postgres text
 *    (`2026-08-16 21:00:00+00`) because the API returns these values to clients: the
 *    string that comes out of the database must be byte-identical to the string that
 *    went in, or a document's `uploadedAt` changes format depending on whether it was
 *    read from memory or from Postgres. Microsecond precision is lost in the round trip
 *    and that is fine - every value written here originates as a millisecond-precision
 *    JavaScript timestamp, so there are no microseconds to lose.
 *
 * 2. BIGINT ARRIVES AS A STRING, BECAUSE `pg` REFUSES TO LOSE PRECISION SILENTLY.
 *
 *    That default is right in general and wrong here. `int8` exceeds what a JS number
 *    holds exactly, so `pg` returns text and lets the caller decide. But `LogEntry.seq`
 *    and `StoredDocument.bytes` are typed `number`, and a string flows through both
 *    without complaint: `seq` sorts lexicographically ("10" < "9"), and `bytes` renders
 *    as a quoted string in the JSON response. Neither throws.
 *
 *    Coercing to `number` is safe for these two columns specifically, and only because
 *    of what they hold: a sequence number counting log entries and a file size capped at
 *    `MAX_BYTES` (80 MB). Both are many orders of magnitude below 2^53. If a genuinely
 *    large `int8` column is ever added, this parser is wrong for it and the column should
 *    be read as text at its own call site.
 */

const TIMESTAMPTZ_OID = 1184;
const TIMESTAMP_OID = 1114;
const INT8_OID = 20;

pg.types.setTypeParser(TIMESTAMPTZ_OID, (v: string) => new Date(v).toISOString());
pg.types.setTypeParser(TIMESTAMP_OID, (v: string) => new Date(`${v}Z`).toISOString());
pg.types.setTypeParser(INT8_OID, (v: string) => Number(v));

let shared: pg.Pool | null = null;

/** Whether Postgres is configured at all. Absent `DATABASE_URL`, the product runs on the
 *  file stores exactly as it did before - see `stores.ts`. */
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env["DATABASE_URL"];
  return url === undefined || url.trim() === "" ? null : url;
}

export function pool(url?: string): pg.Pool {
  if (shared !== null) return shared;
  const connectionString = url ?? databaseUrl();
  if (connectionString === null) {
    throw new Error("DATABASE_URL is not set; the Postgres stores must not be constructed.");
  }
  shared = new pg.Pool({ connectionString });
  return shared;
}

/** Closes the shared pool. Tests need this - an open pool keeps the event loop alive and
 *  a suite that opens one never exits. */
export async function closePool(): Promise<void> {
  if (shared === null) return;
  const p = shared;
  shared = null;
  await p.end();
}

/**
 * Run `fn` inside a transaction, rolling back on any throw.
 *
 * EVERY CALLER MUST USE THE CLIENT IT IS HANDED, not `pool.query`. A pool hands out a
 * different connection per query, so a `BEGIN` issued on one connection and an `INSERT`
 * issued on another leaves the insert outside the transaction and the transaction empty -
 * and for the chain append that means the advisory lock is held on a connection doing
 * nothing while the insert races unprotected on a second one. The bug looks like the lock
 * simply not working.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  p: pg.Pool = pool(),
): Promise<T> {
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
