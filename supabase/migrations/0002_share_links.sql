-- ARBITER, share links: which cases have been published to a tokenised URL.
--
-- ADDITIVE, AND A SEPARATE FILE RATHER THAN AN EDIT TO 0001. `0001_init.sql` has been
-- applied to deployed databases; changing it would leave the file in this repository
-- describing a schema no running cluster has, and the next `create table` in it would
-- fail against every database that already ran the old version. New tables arrive as
-- new files, in order, forever.
--
-- Everything 0001's header says still holds here: not idempotent on purpose (a second
-- application should fail loudly rather than half-apply), and timestamptz columns hold
-- ISO strings that `db.ts`'s parser re-emits byte-identically to what went in.
--
-- ---------------------------------------------------------------------------
-- THERE IS NO TOKEN COLUMN, AND ITS ABSENCE IS THE SECURITY PROPERTY.
-- ---------------------------------------------------------------------------
--
-- The URL a stranger opens carries `HMAC-SHA256(ARBITER_SHARE_SECRET, "caseId:version")`,
-- computed on demand from `case_id` and `version` (services/api/share.ts). Neither of
-- those is secret, so this table can be dumped, backed up, or stolen and still yield no
-- working link without the deployment's secret - which lives in the environment and
-- never in Postgres.
--
-- The two rejected alternatives, recorded because both are the obvious thing to reach
-- for: storing the token plaintext puts live capability URLs in a backup, and storing a
-- digest of it cannot be reversed into the URL a printed QR code has to be re-rendered
-- from every time the convener reopens the report. So: DO NOT ADD A TOKEN COLUMN, a
-- digest of one, or the secret. Any of them would be replayable from a dump, and every
-- test in the suite would still pass.

create table share_links (
  -- One link per case, so publishing twice cannot leave two live versions of the same
  -- record reachable at two URLs. `ShareStore` keys its map the same way.
  case_id    text        primary key,
  -- WHAT MAKES REVOCATION REACH PAPER. It is part of the HMAC preimage, so bumping it
  -- changes the token, and every QR already printed stops resolving. Revoke increments
  -- it; publish must NOT reset it (see PostgresShareStore.publish - `version` is
  -- deliberately absent from the upsert's `set` list), because re-minting version 1
  -- after a revoke would bring the killed link back to life.
  --
  -- `integer`, not `bigint`: `ShareLink.version` is a JavaScript `number`, and this
  -- counts deliberate revocations of one case's link - a number that reaches the int4
  -- ceiling is not a version, it is a bug that has been running for a very long time.
  version    integer     not null,
  -- The account id of whoever published it. The convener is the one accountable for the
  -- record under spec §6.7, and the public route reads the report as this id - so it is
  -- who the document says generated it, not decoration.
  created_by text        not null,
  created_at timestamptz not null,
  -- Null means there is a live link RIGHT NOW; a timestamp means there is not.
  --
  -- DISTINCT FROM `version`, and conflating the two is how a revoked link comes back.
  -- This column says WHETHER a link is live, `version` says WHICH token the case is on.
  -- Verification requires this to be null BEFORE it compares the token, so a revoked
  -- row rejects its own still-derivable token (services/api/share.ts:verifyToken).
  revoked_at timestamptz,
  -- Versions start at 1 and only ever climb. Written as a constraint rather than left to
  -- the two store implementations because a reset to 0 or 1 is precisely the bug that
  -- re-animates a revoked token, and it would be invisible in a row nobody looks at.
  constraint share_links_version_positive check (version >= 1)
);

-- NO INDEX BEYOND THE PRIMARY KEY, deliberately. Every query this table serves is by
-- `case_id` - `get`, the upsert in `publish`, the update in `revoke` - and the primary
-- key index answers all three. There is no "list every published case" screen; if one
-- is ever added it will want an index on `revoked_at`, and it can add it then.

-- ---------------------------------------------------------------------------
-- THIS TABLE STARTS EMPTY, AND MOVING BACKINGS WITHOUT ROTATING THE SECRET
-- RESURRECTS EVERY REVOKED TOKEN.
-- ---------------------------------------------------------------------------
--
-- There is no backfill here and nothing imports the file store's
-- `results/deliberation-log.jsonl.shares.json` into it. That is fine for the version
-- numbers of cases that were never published, and it is NOT fine for the ones that were
-- revoked, because the version is half the HMAC preimage and this table has no memory of
-- how high it had climbed.
--
-- Concretely: a deployment publishes case `c` on files, revokes it (the file store is now
-- at version 3, and the sheets carrying `HMAC(secret, "c:1")` are dead), then sets
-- `DATABASE_URL`. `get("c")` finds no row, so the convener is offered "Publish this
-- record" again, and `publish` inserts version 1. With the same `ARBITER_SHARE_SECRET`
-- the minted token is byte-identical to the one that was killed - `revoked_at` is null
-- and the version matches, so `verifyToken` accepts it, and every QR code printed before
-- the revoke resolves again. The same hazard runs in reverse, Postgres back to files.
--
-- ROTATE `ARBITER_SHARE_SECRET` WHEN YOU CHANGE BACKINGS. Rotating invalidates every
-- token derived under the old secret at once - which is exactly the blunt, fail-safe
-- outcome wanted here: it cannot resurrect anything, because nothing minted before the
-- rotation verifies afterwards. Conveners re-publish the records they still want live.
--
-- The alternative, if a deployment cannot afford to invalidate live links, is to carry the
-- versions across before the first publish on the new backing - insert one row per case
-- from the old store, `revoked_at` and all. Nothing in this repository does that yet, and
-- doing it by hand is a smaller job than it sounds: the file is five fields per case.
