import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { closePool, databaseUrl, pool } from "../db.js";

/**
 * A throwaway database with the real schema in it, for the Postgres store tests.
 *
 * NOT THE DEVELOPMENT DATABASE. These suites truncate tables between tests, and the
 * local Supabase stack is shared - by the other stores being written against it, by
 * `npm run api`, by whatever is open in a SQL client. A test that truncates
 * `auth_users` in a database somebody is holding a session in is a test that fails for
 * them and passes for you.
 *
 * THE SCHEMA COMES FROM `supabase/migrations/0001_init.sql`, executed as it ships,
 * rather than from a hand-written copy of the interesting tables. A copy is a second
 * definition of the schema that can drift from the one production runs, and drift in
 * exactly the direction that matters: the constraints. `auth_users.email` being unique
 * and `invites`' composite primary key are not decoration here, they are the mechanism
 * two of these stores rely on, and a test schema that forgot one would still pass every
 * single-threaded test in the file.
 *
 * ONE DATABASE PER TEST FILE PER PROCESS, and the process id is in the name. Two names
 * would be enough for the two files in one run - vitest runs files in parallel, and a
 * shared name would have them pulling the schema out from under each other - but a
 * fixed name is not enough for two RUNS. That is not hypothetical: this suite was
 * written on a checkout three agents share, a second `npm test` overlapped the first,
 * and fourteen tests failed with rows nothing in them had inserted and a truncate that
 * landed between two assertions. Every one of those failures pointed at the store and
 * none of them was about it, which is the expensive kind of flake. The pid makes the
 * collision impossible instead of unlikely.
 */

const MIGRATION = fileURLToPath(new URL("../../../supabase/migrations/0001_init.sql", import.meta.url));

/** The name each test file actually gets. Exported so a leftover from a killed run is
 *  recognisable: they are all `arbiter_test_*_<pid>` and safe to drop by hand. */
export function testDatabaseName(base: string): string {
  // A database name cannot be a bound parameter, so it is interpolated - and these are
  // constants in the test files rather than input. The guard is here so that stays true.
  if (!/^[a-z][a-z0-9_]*$/.test(base)) throw new Error(`Not a safe database name: ${base}`);
  return `${base}_${process.pid}`;
}

/** `postgres` rather than whatever `DATABASE_URL` names, because a connection to a
 *  database is what stops it being dropped. */
async function withAdmin(fn: (admin: pg.Client) => Promise<void>): Promise<void> {
  const base = databaseUrl();
  if (base === null) throw new Error("The Postgres fixture needs DATABASE_URL; the suite should have skipped.");
  const adminUrl = new URL(base);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await fn(admin);
  } finally {
    await admin.end();
  }
}

/**
 * Drop the database, recreate it, apply the migration, and hand back the shared pool
 * from `db.ts` pointed at it.
 *
 * Dropped first so a run is repeatable rather than repeatable-once: a previous run
 * killed part way through leaves its rows behind, and a suite that inherits them fails
 * on a count that has nothing to do with the change being tested. `with (force)` for
 * the same reason - that dead run's connections may still be registered.
 */
export async function freshDatabase(base: string): Promise<pg.Pool> {
  const name = testDatabaseName(base);
  const url = databaseUrl();
  if (url === null) throw new Error("freshDatabase needs DATABASE_URL; the suite should have skipped.");

  await withAdmin(async (admin) => {
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
  });

  const mine = new URL(url);
  mine.pathname = `/${name}`;
  // `db.ts`'s pool, which is the one the stores under test would use in production, and
  // the one `closePool()` closes. A pool built here instead would keep the event loop
  // alive after the last assertion and the suite would hang rather than fail.
  const p = pool(mine.toString());
  await p.query(await readFile(MIGRATION, "utf8"));
  return p;
}

/** Closes the pool and removes the database, so a suite leaves the server as it found
 *  it. The pool has to go first: `drop database` counts our own connections too. */
export async function dropDatabase(base: string): Promise<void> {
  await closePool();
  await withAdmin(async (admin) => {
    await admin.query(`drop database if exists ${testDatabaseName(base)} with (force)`);
  });
}
