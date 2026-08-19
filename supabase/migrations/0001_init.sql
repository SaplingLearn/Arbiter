-- ARBITER, initial schema. docs/design/supabase-contract.md is the authority for
-- everything below; where this file adds something the contract does not state, the
-- comment beside it says so.
--
-- WHAT THIS REPLACES. Every table here is a file today: the log is
-- results/deliberation-log.jsonl, the cases and invites are JSON sidecars beside it,
-- the accounts are results/deliberation-log.jsonl.users.json, and the documents are
-- bytes under results/documents with an index.json. On an ephemeral container all of
-- them are wiped on redeploy, which is the whole reason this exists.
--
-- TIMESTAMPS ARE timestamptz AND THE STORES HOLD ISO STRINGS. Every `at`, `createdAt`
-- and `expiresAt` in services/api is a string produced by `new Date(...).toISOString()`
-- and compared with `Date.parse`. Postgres will accept those strings on the way in and
-- must be rendered back to the same form on the way out - a store that hands a
-- JavaScript Date to a caller expecting a string breaks the comparison silently rather
-- than loudly, because `Date.parse(someDate)` is NaN and `NaN <= now` is false, so an
-- expired session would read as live.
--
-- NOT IDEMPOTENT ON PURPOSE. No `if not exists` anywhere: a migration that has already
-- run should fail loudly on a second attempt rather than half-apply against a schema
-- that has since moved on.

-- ---------------------------------------------------------------------------
-- The record itself
-- ---------------------------------------------------------------------------

-- `seq` is the primary key, so a duplicate sequence number is a database error rather
-- than a silently forked chain. `hash` is unique for the same reason from the other
-- end: two entries cannot claim the same link.
--
-- prev_hash/hash are char(64) because sha256Hex() always produces exactly 64 hex
-- characters. A shorter value would be space-padded by bpchar rather than rejected,
-- but that is not a hole worth widening the type for - a padded hash fails
-- verifyChain immediately, which is the chain doing its job.
create table deliberation_log (
  seq       bigint      primary key,
  -- TEXT, NOT TIMESTAMPTZ, AND THIS IS NOT A STYLE CHOICE.
  --
  -- `at` is inside the hash preimage: `chainEntry` hashes it as the STRING it arrived
  -- as. `timestamptz` does not store a string, it stores an instant - so it reinterprets
  -- and re-serialises, and "2026-08-09T10:00:00Z" comes back "2026-08-09T10:00:00.000Z".
  -- Same instant, different bytes, different hash. `verifyChain` then reports `bad_hash`
  -- - "has been altered since it was written" - against an entry nobody touched, which
  -- is the single most damaging false statement this product can make.
  --
  -- It was reachable from outside, not theoretical: `DeliberationService.submit` passes
  -- the request body's `submittedAt` through as `at` with no normalisation, so any client
  -- sending a legal ISO-8601 timestamp in a non-canonical spelling would have poisoned
  -- its own entry. The file stores never had this failure - they write the string back
  -- verbatim - so it would have arrived with Postgres and looked like corruption.
  --
  -- The rule, for anything added here later: A COLUMN COVERED BY THE HASH MUST ROUND-TRIP
  -- BYTE-FOR-BYTE. Storage may not normalise a hash preimage.
  at        text        not null,
  kind      text        not null,
  case_id   text        not null,
  actor_id  text        not null,
  -- The sealed body of the entry: a position, a roster change, an adjudication. Its
  -- shape varies with `kind` and it is hashed whole, so it is stored whole.
  --
  -- `jsonb` IS safe here, and the asymmetry with `at` above is worth stating so nobody
  -- "fixes" one to match the other. jsonb does normalise - it reorders keys, drops
  -- duplicates, and rewrites number spellings - but nothing downstream hashes the stored
  -- text. The driver parses it back to a JavaScript value and `canonicalJson` re-derives
  -- the preimage from that value, sorting every key itself. So the hash is taken over the
  -- parsed object, which survives the round trip, rather than over the bytes, which do
  -- not. `at` has no such re-derivation: it is a string, hashed as a string.
  payload   jsonb       not null,
  prev_hash char(64)    not null,
  hash      char(64)    not null unique
);

-- The chain is global, not per-case (store.ts:222), so `seq` alone orders it. This
-- index serves the per-case reads - one case's history out of everybody's.
create index deliberation_log_case_seq on deliberation_log (case_id, seq);

-- APPEND-ONLY AT THE DATABASE, NOT JUST BY CONVENTION.
--
-- A JSONL file opened for append cannot be edited in place by accident. A Postgres row
-- can: one `update deliberation_log set payload = ...` from a psql session is all it
-- takes, and the row would look ordinary afterwards. The chain still DETECTS that -
-- that is its whole job - but detection after the fact is a worse guarantee than the
-- file had, so the database refuses the write as well.
create function deliberation_log_immutable() returns trigger as $$
begin
  raise exception 'deliberation_log is append-only';
end $$ language plpgsql;

-- TWO TRIGGERS, ONE FUNCTION, AND NEITHER IS REDUNDANT. The first is the obvious one
-- and it is the one that looks sufficient; do not delete the second as a duplicate of
-- it. They fire at different levels because Postgres offers no level that covers both:
--
--   no_mutate    FOR EACH ROW, and a row trigger fires once per row affected. `update`
--                and `delete` name rows, so this catches them.
--   no_truncate  FOR EACH STATEMENT, because `truncate` affects no rows individually -
--                it discards the whole relation as one operation and fires no row
--                trigger at all. A row-level `before truncate` is not merely useless
--                here, it is rejected by Postgres.
--
-- MEASURED, not assumed. With only the row-level trigger in place,
-- `truncate deliberation_log` returned TRUNCATE TABLE and left zero rows behind.
--
-- TRUNCATE IS THE WORST CASE FOR THIS PARTICULAR TABLE, which is why it is worth a
-- second trigger rather than a note. The chain is global rather than per-case
-- (store.ts:222) precisely so that erasing a case leaves a hole: delete one entry and
-- the next entry's prev_hash no longer matches, and verifyChain says so. Truncate
-- deletes the evidence of the deletion too. An empty chain is internally consistent -
-- there is nothing left to disagree with itself - and it is indistinguishable from a
-- deployment where nothing has happened yet. GENESIS closes the same hole at the front
-- of the chain for the same reason; this closes it for the whole of it.
--
-- WHAT THIS IS NOT. TRUNCATE needs table ownership, so this stops an operator's stray
-- one-liner and a compromised owner session, not a determined owner - `alter table …
-- disable trigger` and `drop trigger` are both still available to whoever holds that
-- role. The real boundary is an application role that owns nothing and holds only
-- insert and select on this table. This is the layer under that, and it costs one
-- statement.
create trigger no_mutate before update or delete on deliberation_log
  for each row execute function deliberation_log_immutable();

create trigger no_truncate before truncate on deliberation_log
  for each statement execute function deliberation_log_immutable();

-- NOT PUT ON THE OTHER SIX TABLES, deliberately. Update and delete are ordinary there:
-- a case is rewritten on every change, sessions expire and are swept, invitations are
-- claimed and dropped, a reset is marked used. Truncating any of them would be a
-- disaster, but a LOUD one - nobody can sign in, no case opens - and it destroys no
-- claim the product makes. Only this table asserts that it can prove nothing was
-- removed from it, and an assertion is the thing that has to be defended.

-- ---------------------------------------------------------------------------
-- Cases and invitations
-- ---------------------------------------------------------------------------

-- The case document, stored whole. It is read and written as one object by
-- DeliberationService and it is the log that carries the history, so decomposing it
-- into columns would buy queries nobody makes and cost a mapping layer that can drift
-- from the TypeScript type.
create table deliberation_cases (
  case_id    text        primary key,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

-- An invitation to an address that has no account yet. Claimed and deleted on
-- registration (invites.ts:claim), so a row here is always still pending.
--
-- The primary key IS the idempotence InviteStore.add() implements in memory: inviting
-- the same address to the same case twice is one invitation, not two, so claiming it
-- cannot add somebody to a case more than once.
--
-- `email` leads the key, so the by-email lookups - forEmail() and claim() - are served
-- by the primary index and need no second one.
create table invites (
  email      text        not null,
  case_id    text        not null,
  -- The account id of whoever sent it. Who added whom to a panel is a lever on the
  -- outcome, which is why the log records roster changes too.
  invited_by text        not null,
  at         timestamptz not null,
  primary key (email, case_id)
);

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

-- The metadata for an uploaded PDF. The bytes live in Supabase Storage, not here.
create table documents (
  id          text        primary key,
  case_id     text        not null,
  filename    text        not null,
  uploaded_by text        not null,
  at          timestamptz not null,
  byte_length bigint      not null,
  -- CONTENT IDENTITY, AND THE DEDUP KEY. Absent from the first draft of the contract,
  -- which was simply wrong: `StoredDocument.sha256` is a required field on the API
  -- response, and `DocumentStore` indexes `byHash` on `(caseId, sha256)` to recognise
  -- a file it already holds. Without this column a Postgres-backed store can neither
  -- round-trip the response nor deduplicate, so re-uploading the same PDF would make a
  -- second record of identical bytes - the exact thing the content hash exists to stop.
  sha256      char(64)    not null,
  -- The Storage object path. Where the bytes are, as distinct from `filename`, which
  -- is what the uploader called the file and is not unique.
  storage_key text        not null,
  -- The measurement that admitted the document: pages, characters, term hits, and the
  -- verdict. An upload whose measurement is not `ok` is refused, so a stored row
  -- always carries one - nullable here because the contract has it nullable, not
  -- because a null is expected.
  measurement jsonb,
  -- The dedup rule as a constraint rather than a convention. The in-memory store
  -- check-then-inserts against `byHash`, which cannot interleave in one process; two
  -- connections can, so the database has to be the one that says no.
  unique (case_id, sha256)
);

-- Not in the contract, and additive rather than a change to it: DocumentStore.forCase
-- is on the path of every case screen, and it is the only query this table serves.
create index documents_case_id on documents (case_id);

-- ---------------------------------------------------------------------------
-- Accounts, sessions, resets
--
-- These three mirror what services/api/auth.ts persists today, field for field. The
-- contract deliberately does not specify them, so the file is the specification:
--
--   User        -> auth_users         id, email, displayName, passwordHash, salt,
--                                     params {N,r,p,keyLen}, signatureMethod, createdAt
--   Session     -> auth_sessions      tokenHash, userId, issuedAt, expiresAt
--   ResetToken  -> auth_reset_tokens  tokenHash, userId, expiresAt, usedAt
--
-- PASSWORD HASHES TRANSFER VERBATIM. `password_hash` and `salt` are the hex strings
-- auth.ts already wrote, and the four scrypt parameters travel beside them, so an
-- account created before this migration verifies after it. Re-hashing on migration is
-- not possible anyway - the plaintext is not stored, which is the point - and
-- normalising the parameters would invalidate every password in the store.
-- ---------------------------------------------------------------------------

create table auth_users (
  id            text        primary key,
  -- Normalised to trimmed lowercase before it is stored (auth.ts:normaliseEmail), so
  -- "Ann@Lab.com " and "ann@lab.com" are one account rather than two people who
  -- cannot see each other's cases.
  --
  -- UNIQUE is the `byEmail` map made a constraint. In memory the duplicate check and
  -- the insert are one synchronous step and cannot interleave; across connections they
  -- can, and two simultaneous registrations for one address would both succeed and
  -- leave the second silently shadowing the first.
  email         text        not null unique,
  display_name  text        not null,
  -- scrypt(password, salt) as hex. Not char(n): key_len is per-record, so the length
  -- of this string is a property of the row rather than of the column.
  password_hash text        not null,
  -- Per-account random salt, hex. Distinct from the hash and useless without it.
  salt          text        not null,
  -- The scrypt cost parameters THIS hash was produced under, stored per record so
  -- raising them later does not invalidate every existing password (auth.ts:31). They
  -- are four integers with fixed meanings rather than a json blob because the login
  -- path reads N back to size scrypt's memory allowance, and a value it has to cast
  -- out of jsonb on every attempt is a cast that can fail at exactly the wrong moment.
  scrypt_n      integer     not null,
  scrypt_r      integer     not null,
  scrypt_p      integer     not null,
  key_len       integer     not null,
  -- How this person signs. `password` today; `sso` is the intended replacement and is
  -- named here so the record can say which one produced a signature. Constrained
  -- rather than free text because a third value would be a signature method nothing
  -- in the codebase can verify.
  signature_method text     not null check (signature_method in ('password', 'sso')),
  created_at    timestamptz not null
);

-- A live bearer session. Sessions survive a restart on purpose - restarting the
-- service should not sign everybody out mid-deliberation - and they still expire on
-- their own clock.
create table auth_sessions (
  -- SHA-256 of the bearer token, and the token itself is never stored: a leaked store
  -- must not hand the reader a working session, only the useless digest of one. Same
  -- reasoning as storing a password hash rather than a password.
  token_hash char(64)    primary key,
  user_id    text        not null references auth_users (id) on delete cascade,
  issued_at  timestamptz not null,
  expires_at timestamptz not null
);

-- resetPassword() drops every live session for the account, because the reason to
-- reset a password is usually that somebody else may know the old one and leaving
-- their session alive resets nothing. That is a delete-by-user, and without this index
-- it is a sequential scan of every session in the deployment.
create index auth_sessions_user_id on auth_sessions (user_id);

-- pruneExpired() sweeps by clock, on every login.
create index auth_sessions_expires_at on auth_sessions (expires_at);

-- A single-use password reset. Delivery is deliberately absent from this product - the
-- server prints the token rather than pretending an email was sent - so these rows are
-- short-lived by design (30 minutes, auth.ts:RESET_TTL_MS).
create table auth_reset_tokens (
  -- SHA-256 of the reset token, for the same reason sessions store a digest.
  token_hash char(64)    primary key,
  user_id    text        not null references auth_users (id) on delete cascade,
  expires_at timestamptz not null,
  -- Null until the token is spent, and a timestamp afterwards. The row is KEPT rather
  -- than deleted on use: single-use has to be enforceable, and a deleted row and a
  -- never-issued token are the same absence.
  used_at    timestamptz
);
