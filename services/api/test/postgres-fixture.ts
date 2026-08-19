import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
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
 * THE SCHEMA COMES FROM `supabase/migrations/`, executed as it ships, rather than from a
 * hand-written copy of the interesting tables. A copy is a second definition of the
 * schema that can drift from the one production runs, and drift in exactly the direction
 * that matters: the constraints. `auth_users.email` being unique, `invites`' composite
 * primary key and `share_links`' version floor are not decoration here, they are the
 * mechanism three of these stores rely on, and a test schema that forgot one would still
 * pass every single-threaded test in the file.
 *
 * EVERY migration, in filename order - not just `0001_init.sql`, which is what this read
 * until `0002_share_links.sql` was added. A fixture pinned to the first migration builds
 * a database that was correct on the day it was written and silently lacks every table
 * added since, so the suite for the newest store fails on "relation does not exist" while
 * pointing at the store rather than at the fixture. Numbered prefixes are what make
 * sorting the filenames the same as ordering the migrations.
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

const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

/** The `.sql` files, in the order a deployment applies them. */
async function migrations(): Promise<string[]> {
  const names = (await readdir(MIGRATIONS)).filter((n) => n.endsWith(".sql")).sort();
  if (names.length === 0) throw new Error(`No migrations found in ${MIGRATIONS}`);
  return names.map((n) => join(MIGRATIONS, n));
}

/**
 * Every migration's SQL, in order, for the two suites that build their own database
 * rather than going through `freshDatabase`.
 *
 * EXPORTED SO THIS FILE IS THE ONLY PLACE THAT KNOWS WHERE THE SCHEMA COMES FROM.
 * `postgres-store.test.ts` and `supabase-documents.test.ts` each held their own
 * `new URL(".../0001_init.sql")`, which was true when it was written and became a lie the
 * moment a second migration existed: they would have gone on building a database that had
 * the tables of 2026-08-17 and none added since, so a later `alter table` would be applied
 * by production and by three of the five store suites and NOT by those two. The suite for
 * a store would then pass against a schema no deployment has - or fail on "column does not
 * exist" while pointing at the store rather than at the fixture, which is the exact failure
 * this file's header says it exists to prevent.
 *
 * A LIST RATHER THAN ONE CONCATENATED STRING, because `postgres-store.test.ts` re-applies
 * these between every test and a failure has to name the file it came from.
 */
export async function migrationSql(): Promise<string[]> {
  return Promise.all((await migrations()).map((f) => readFile(f, "utf8")));
}

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
  /* CLOSED FIRST, BECAUSE `pool()` IGNORES ITS ARGUMENT ONCE A POOL EXISTS. It returns
     the shared one without comparing connection strings, so a second `freshDatabase()`
     in the same process would drop and recreate the right database, apply the migration
     to it, and hand back a pool still pointed at the FIRST one - a suite passing or
     failing against a database that is not the one it just built. Nothing calls it twice
     today; this is what makes it safe when something does. */
  await closePool();
  // `db.ts`'s pool, which is the one the stores under test would use in production, and
  // the one `closePool()` closes. A pool built here instead would keep the event loop
  // alive after the last assertion and the suite would hang rather than fail.
  const p = pool(mine.toString());
  // One statement batch per file, in order, so a later migration sees the tables an
  // earlier one created. Applied serially rather than concatenated: a failure names the
  // file it came from.
  for (const sql of await migrationSql()) await p.query(sql);
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
