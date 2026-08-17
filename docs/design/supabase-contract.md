# Supabase migration — the fixed contract

Every agent on this branch codes against this file. Do not renegotiate it; if something
here is wrong, say so in your report rather than quietly diverging.

## Why this is bigger than `store.ts` claims

`store.ts`'s header says a Postgres implementation "satisfies [the interface] without any
caller changing". That is false. `DeliberationStore` is **synchronous** (`append()` returns
`LogEntry`, not a promise), and so are `AuthStore`, `InviteStore` and `DocumentStore`.
Postgres is not. So the migration is two jobs, in order:

1. Make the four store interfaces async, and ripple that through `DeliberationService`
   (18 methods, none currently async) and `server.ts` (~52 call sites) and the tests.
2. Implement Postgres/Storage backings behind the now-async interfaces.

Phase 1 lands with **File/Memory stores still the only implementations**. That is
deliberate: it keeps the change reviewable and keeps CI green without a database.

## Library choice — not negotiable

- **`pg` (node-postgres) for all Postgres access.** `@supabase/supabase-js` talks to
  PostgREST, which has **no transactions**. The chain append needs `SELECT … FOR UPDATE`
  inside a transaction. supabase-js cannot express that, so it is not used for data.
- **`@supabase/supabase-js` for Storage only** — the uploaded PDF bytes.

## Configuration

The file stores stay the default. Postgres is opt-in, so `npm test`, `npm run e2e` and CI
keep working on a machine with no database.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string. **Absent ⇒ file stores.** Present ⇒ Postgres. |
| `SUPABASE_URL` | Supabase project URL, for Storage. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key. Server-side only — never a `VITE_` name. |
| `SUPABASE_BUCKET` | Storage bucket for documents. Default `documents`. |

Selection happens in **one** place — a `buildStores()` factory in `services/api/stores.ts`
— never scattered `if (process.env…)` checks at call sites.

## Schema

`seq` is the primary key, so a duplicate sequence number is a database error rather than a
silently forked chain.

> **This block is the original draft. Three parts of it were wrong, and the corrections
> are in `supabase/migrations/0001_init.sql`, which is now the authority. What changed and
> why is recorded under "What testing changed" at the end of this document — read that
> before treating anything here as current.**

```sql
create table deliberation_log (
  seq       bigint      primary key,
  at        timestamptz not null,   -- WRONG: must be `text`. See corrections.
  kind      text        not null,
  case_id   text        not null,
  actor_id  text        not null,
  payload   jsonb       not null,
  prev_hash char(64)    not null,
  hash      char(64)    not null unique
);
create index deliberation_log_case_seq on deliberation_log (case_id, seq);

create table deliberation_cases (
  case_id    text        primary key,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

create table invites (
  email      text        not null,
  case_id    text        not null,
  invited_by text        not null,
  at         timestamptz not null,
  primary key (email, case_id)
);

create table documents (
  id          text        primary key,
  case_id     text        not null,
  filename    text        not null,
  uploaded_by text        not null,
  at          timestamptz not null,
  byte_length bigint      not null,
  storage_key text        not null,
  measurement jsonb
);
```

Auth tables (`auth_users`, `auth_sessions`, `auth_reset_tokens`) mirror **exactly** the
shape `auth.ts` persists today — read that file, do not invent columns. Password hashes
transfer verbatim; this migration must not change the hashing scheme.

### The log is append-only at the database, not just by convention

A JSONL file opened for append cannot be edited in place by accident. A Postgres row can.
The chain still *detects* tampering — that is its whole job — but the database must also
refuse it:

```sql
create function deliberation_log_immutable() returns trigger as $$
begin
  raise exception 'deliberation_log is append-only';
end $$ language plpgsql;

create trigger no_mutate before update or delete on deliberation_log
  for each row execute function deliberation_log_immutable();
```

## The append, and why it must lock globally

`store.ts:222` states the chain is **global, not per-case** — deliberately, so that
deleting a whole case leaves a hole. So the append must serialise across *all* cases:

```
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('deliberation_log'));
SELECT seq, hash FROM deliberation_log ORDER BY seq DESC LIMIT 1;
-- compute the entry with the EXISTING chainEntry() helper, unchanged
INSERT INTO deliberation_log (...) VALUES (...);
COMMIT;
```

A per-case lock would let two cases interleave and fork the global chain. Do not use one.
`chainEntry()` and `sha256Hex()` in `store.ts` are the canonical hash functions and must be
reused as-is — reimplementing the hashing would silently break `verifyChain`.

## Documents: the Python scripts still need a real file

`measurePdf` and `textFor` shell out to Python with a **filesystem path**
(`documents.ts:112`, `documents.ts:252`). Bytes living in Supabase Storage does not change
that. So the Storage-backed store must download to a temp file, run the script against it,
and clean up. `server.ts:439` streams a document to the client with `createReadStream` —
that becomes a Storage read.

`MAX_BYTES` stays 80 MB.

## Definition of done

`npm run lint && npm run typecheck && npm test` green, with no database present.
Nobody reports success without pasting the actual command output.

---

## What testing changed

Five things in the draft above were wrong. Each was found by running something, not by
reading it, and each is recorded here because the wrong version is the one a reader would
otherwise reinvent.

**1. `deliberation_log.at` must be `text`, not `timestamptz`.** `chainEntry` hashes `at`
as the *string* it arrived as; `timestamptz` stores an instant and re-serialises it.
Measured by re-applying the migration with only this column reverted: four of five legal
ISO-8601 spellings came back rewritten, and `verifyChain` reported `bad_hash` — "has been
altered since it was written" — on entries nobody touched. It was reachable from outside,
because `DeliberationService.submit` passes the request body's `submittedAt` through
unvalidated. The general rule, for any column added later: **a column covered by the hash
must round-trip byte-for-byte. Storage may not normalise a hash preimage.**

`payload` is safe as `jsonb` despite normalising, and the asymmetry is worth holding onto:
nothing hashes the stored *text*. The driver parses jsonb back to a JavaScript value and
`canonicalJson` re-derives the preimage from that value, sorting keys itself.

**2. `documents` needs `sha256 char(64) not null` and `unique (case_id, sha256)`.**
`StoredDocument.sha256` is part of the API response and `DocumentStore` deduplicates on
`(caseId, sha256)`. Without the column a Postgres store can neither round-trip the
response nor dedup.

**3. The append-only trigger must also cover `TRUNCATE`.** A `BEFORE UPDATE OR DELETE …
FOR EACH ROW` trigger does not fire for truncation — verified by truncating the table and
watching the chain vanish. Truncation is the maximal form of the tamper the global chain
exists to make detectable, and unlike a deleted row it leaves no broken link behind.
Both triggers are needed; the row-level one is the one that *looks* sufficient.

**4. `pg`'s default type parsers are wrong for this codebase, in two ways that fail
silently.** `timestamptz` arrives as a `Date` where the code compares ISO strings via
`Date.parse` — on V8 that truncates to the second below, and on an engine whose
`toString()` `Date.parse` rejects it is `NaN`, which makes an expired session read as
**live**. `int8` arrives as a string, so `seq` would sort lexicographically. Both are
fixed once in `services/api/db.ts`; do not defeat them per-caller.

**5. Node must be 22, not 20.** `@supabase/supabase-js` constructs a Realtime client
inside `createClient` — even though this service uses Storage only and opens no channel —
and that requires a global `WebSocket`, available unflagged only from Node 22. Found by
running the container, and invisible everywhere else: the suite passes on a developer
machine with a newer Node, and CI constructs no Storage client because it sets no
`SUPABASE_URL`. The Dockerfile and `.github/workflows/ci.yml` are pinned together and
must move together.

### Two additions the draft did not anticipate

- **`streamFor(id)` replaces `pathFor` on the serving path.** The file store answers
  `pathFor` by joining two strings; the Storage store can only answer it by downloading
  the object, which would have written an 80 MB temp file per document *view*. Its
  `pathFor` therefore throws, and `DocumentStoreApi` — the shared contract — omits it.
- **CI runs a `postgres:17` service.** Without it the Postgres suites `skipIf` themselves
  out and the entire implementation sits in the repository with a green check over code
  that never ran. Storage is still not covered there; that needs the full stack.
