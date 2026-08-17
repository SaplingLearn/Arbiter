# Handoff — the five open pull requests

Written 2026-08-17, for whoever picks this up. Sibling to `HANDOFF-evaluation.md` and
`HANDOFF-reading-and-atmosphere.md`, which were written the day before from the branch
that has since become `main`. Those two own the numbers and the reading surface; this one
owns the open PRs and the branch topology underneath them.

A previous session reconciled that topology and merged what was ready. #24 and #33 have
since landed; **four remain** — #25, #27, #28, #30. Read all of this before touching
anything.

An earlier revision of this document said "five PRs" and listed five. There were six, and
#25 was the one missing. Count against `gh pr list` rather than against this section.

---

## 1. Repo state as of 2026-08-17

- Repo: `/home/andresl/Projects/Arbiter` (GitHub `SaplingLearn/Arbiter`), default branch `main`.
- **`main` and `feat/product-in-the-atmosphere` are identical — 0/0 divergence**, tip
  `0ad996e`. For months these had diverged, which is why most of the PRs below target the
  atmosphere branch and none of them ever reached the product. That is fixed.
  `feat/product-in-the-atmosphere` is now a duplicate ref and should be deleted once the
  PRs retarget to `main`.
- The working tree was **clean** when this was written, so the primary worktree is safe to
  work in. That was not true the day before, and it may not be true when you read this.
  Check `git status` first. If it is dirty, do not `checkout`, `stash`, `reset`, `merge`
  or `pull` in place — clone instead:
  `git clone --shared --no-hardlinks /home/andresl/Projects/Arbiter <scratch>/wk`
- Local `main` can sit well behind `origin/main` — it was 24 commits behind at the start of
  this session, which makes every conflict you compute wrong in a way that looks like the
  base moved. `git fetch` before you believe any diff.

## 2. The environment gotcha that will waste an hour

`vitest.setup.ts` sets `PYTHON=.venv/bin/python` when that path exists. `services/api`
shells out to `data/prep/measure_pdf.py` (PyMuPDF) for every document upload. In a fresh
clone with no `.venv`, PDF text extraction fails, uploads are silently refused, and the
test `"attaches the source document and joins the findings to it"` fails with 0 documents.

**This is not a regression.** Symlink the venv into any scratch clone before running tests:

```
ln -sfn /home/andresl/Projects/Arbiter/.venv <scratch>/wk/.venv
```

Same for `node_modules`, root and each workspace, to avoid a reinstall.

## 3. Verification standard — do not lower it

Green CI on these PRs means nothing. Every one of them had `verify` and CodeRabbit passing
while carrying real defects, including a committed `<<<<<<< HEAD` conflict marker that
survived typecheck, lint and CI because it sat inside a JSDoc block.

Before claiming any PR is good, run it and report actual numbers:

```
npm run typecheck && npm run lint && npm test
```

Baseline at `bf0e605` (current `main`): typecheck 0, lint 0, and **two** test numbers now,
because #33 made the suite conditional on a database:

| environment | result |
|---|---|
| no `DATABASE_URL` | 1048 passed / 76 skipped / 72 files |
| Postgres + Storage | **1124 passed / 0 skipped / 72 files** |

**A run without a database is not a verification of anything touching the stores.** 76
tests skip, and a skipped suite and a passing suite are the same green. CI runs Postgres 17
as a service so the Postgres suites execute there, but `supabase-documents.test.ts` needs
the full Supabase stack and still skips in CI — `.github/workflows/ci.yml` says so out
loud. Locally, `supabase start` and then:

```
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<from `supabase status`> \
npm test
```

The suites provision themselves — each creates and drops its own `arbiter_test_*_<pid>`
database and applies `supabase/migrations/0001_init.sql` — so this does not touch the
development database. Earlier baselines in this document's history were 985/67 at `0ad996e`
and 993/68 after #24; both are superseded.

---

## 4. The five open PRs

Every finding below comes from a full per-PR review already performed. Trust them as a
starting point, but re-verify anything you act on before you act on it.

### ~~#33 — "Put the record in Postgres and the product in a container"~~ — LANDED 2026-08-17

Merged as `f4469a8`, joined to `main` in `bf0e605`. Absent `DATABASE_URL` the product runs
on local files exactly as before; present, all four stores move together. `buildStores()`
in `services/api/stores.ts` is the only place that asks, and it refuses to boot
half-migrated — Postgres for the log with documents still on local disk would keep a
record that cites evidence the next redeploy throws away.

Two conflicts in `services/api/server.ts`, both from `main` moving underneath it. The
findings route keeps `main`'s unanchored-quote guard and takes the PR's `await`, since
`addFinding` is async now. The startup banner keeps `main`'s working-directory suffix on
the Config line and the PR's Site/Record/Docs lines — and takes the PR's `accounts` for the
Accounts line, because `auth.list()` returns a promise now and `HEAD`'s
`deps.auth.list().length` would have printed `Accounts: undefined registered`.

**What the review found.** The five concerns this section used to list were checked:

- *The audit chain survives.* `PostgresStore.append` reuses `chainEntry` from `store.ts`
  rather than reimplementing it, takes a global `pg_advisory_xact_lock` before reading the
  tail, and stores `at` as `text` so the hash preimage round-trips byte-for-byte. The
  transaction-scoped lock is also the right choice for the Supabase pooler both toml files
  recommend.
- *Pool handling is sound.* One pool per process, a connection timeout, an idle-error
  listener so a background disconnect cannot take the process down.
- *No committed secrets.* `fly.toml`, `railway.toml`, `supabase/config.toml` and
  `.env.example` carry only placeholders and `env(...)` references.
- *Hashes are compatible in both directions*, so the move is reversible — there are tests
  pinning exactly that.
- *The seeding path was migrated*, but see the defect below.

**Verified against a live stack, not against the skips.** With no database: 1048 passed /
76 skipped. With Postgres and Storage: **1124 passed / 0 skipped / 72 files**, measured in
a clean worktree at the merge commit. typecheck 0, lint 0. The API boots on Postgres and
serves an authenticated round trip; that is where both banner resolutions were confirmed
against a running process rather than by reading them.

**One defect found, not fixed, and it is not this PR's code.**
`tools/seed-demo-documents.mjs --reset` is file-only: it deletes `results/*`, prints
"Store cleared", and on a Postgres deployment leaves every row intact. The ordinary seeding
path goes through the HTTP API and so follows whichever backing the server opened — only
`--reset` reaches around it. This matters more than it looks, because §4's #27 entry names
`--reset` as the *only* way to repair a duplicated seed. On Postgres that escape hatch now
silently does nothing while reporting success.

**One thing worth a second look**, unproven and non-blocking: `withTransaction` in
`services/api/db.ts` calls `await client.query("ROLLBACK")` inside its own `catch`. If the
ROLLBACK itself throws, its error replaces the original — and `release()` is called with no
argument, so a client that may still hold an open transaction returns to the pool.
`client.release(err)` is the usual remedy. Every other error path in this file is defended
to a much higher standard, which is why this one stands out.

### ~~#24 — dev-server dependency preflight (Darkest-Teddy)~~ — LANDED 2026-08-17

Merged into `main` as `94ed8e4`. `tools/check-deps.mjs` compares each workspace manifest
against `node_modules` before `dev-all.mjs` spawns anything, so a stale install names the
install instead of surfacing as a vite overlay blaming whichever source file imported the
missing package.

Both conflicts resolved as prescribed. `package.json` keeps all four scripts — `seed:demo`,
`seed:documents` and `library:fetch` from `main`, `check:deps` from the PR — and keeps the
PR's `check-deps` prefix on `deliberate:dev`. `tools/dev-all.mjs` keeps both sides:
`main`'s `existsSync`/`join` still drive the repo-local venv lookup the upload path needs,
with `assertDeps()` above that block.

Verified before merging: typecheck 0, lint 0, **993 passed / 68 files** — the 985/67
baseline plus this branch's own 8 tests, run in isolation to confirm the accounting.
`git diff` against the old `main` was exactly the PR's four files, `+268/−1`.

**Two non-blocking risks came in with it and are still live.** The exact-pin check fires on
the `@arbiter/engine` workspace symlink, so bumping the engine version without bumping
`apps/harness`'s pin hard-fails `npm run dev` for everyone. And
`tools/check-deps.test.mjs:116` runs against the real repo, so `npm test` fails on a partial
install. Neither has been raised with the author.

The head branch `fix/dev-dependency-preflight` was left alive on the remote.

### #30 — printable deliberation record (Darkest-Teddy)

The report feature itself is good: no new dependency, browser `window.print()`, 30 tests,
no injection surface — pure React elements, no `dangerouslySetInnerHTML`.

**Blocker:** roughly a third of it is a second, incompatible implementation of the fix that
`dd140aa` already landed on `main`. It adds `DeliberationService.adjudication()` and a
`case "adjudication"` route; `main` widened `view()` to carry the same fact. **These
auto-merge with no conflict**, so both survive silently — two endpoints, two client types,
and two contradictory provenance rules (`main`: `actorId === "stub" ? stub : live`; the PR:
`actorId === "model" ? live : stub` — opposite defaults).

It also reverts `main`'s Adjudicate gate (`view.status === "locked"`), reintroducing three
wasted model calls per click on cases that can only answer 409.

**Action:** have the author drop the duplicate transport and rebase the report onto `main`'s
`view`-carried verdict. `handleReport` then needs a one-line change. Everything genuinely
new — `verdict-report.ts`, `report.tsx`, the print CSS, the 30 tests — lands untouched.

Jack has been actively pushing to this branch. Tell him before he rebases into a surprise.

### #28 — product chrome fixes (Darkest-Teddy) — DRAFT

The diffstat reads `+295/−40`, which hides **363 MB of PDFs** — binaries count as zero
lines. Those blobs are on `main` anyway via the fast-forward, so this is no longer a reason
to block; see §5.

Two of its three named fixes are already on `main`. Only the **corner readout** is
genuinely new and still needed: the corner reads its name off whichever menu entry is lit,
and `record` is missing from the case-route list in `currentNav`, so a case's Record tab
lights Dashboard. That is commit `51abbfe`, about 110 lines, touching `shell/nav.ts` and
`shell/Chrome.tsx`.

**Conflict trap:** resolving `services/api/gemini.ts` toward the PR *deletes* `main`'s
`responseSchemaFor` and re-breaks every AI surface. Resolving `services/api/server.ts`
toward the PR reverts `main`'s `ServerDeps.complete` test-isolation seam. Keep both sides.

Its `.env.example` and `README.md` edits still say the developer host "cannot serve this
codebase" — `main`'s `347c87f` fixed that. Those files **auto-merge with no conflict**, so
the stale claim lands silently. Rewrite both passages.

Its new `CODENAME` table in `nav.ts` hand-duplicates `codename` from
`packages/atmosphere/src/scenes/registry.ts`. Read `STATES` instead.

**Action:** cherry-pick `51abbfe` onto `main`, port the `role="group"` / `aria-labelledby`
a11y delta plus its 4 tests, drop the rest.

### #25 — all ten benchmarks, and toxic drugs in the corpus (Darkest-Teddy)

**This entry is a placeholder, and the omission is the point.** The first version of this
document opened by saying "five PRs remain" and then named five. Six were open. #25 was
created 2026-08-16T15:32 — half a day *before* this was written — and a merge-tree analysis
of it was sitting in the same scratchpad the rest of these findings came from. It was
simply left out, and nothing in the document made that detectable.

What is known, and no more: base `feat/product-in-the-atmosphere`, 31 files,
+12444/−441, `CONFLICTING`, last pushed 2026-08-17T01:21 — so it is actively being worked.
The recorded conflict is in `.env.example`, which puts it in the same territory as #27 and
#28. It touches `docs/HANDOFF-evaluation.md`, so it overlaps the evaluation work that
document owns.

**Action:** review it from scratch. Nothing here has been verified, and the size alone
(+12444) means it is not a quick read. Treat every claim in this entry as metadata, because
that is all it is.

### #27 — shared cases on boot, and models in git (Darkest-Teddy)

**Two blockers, both semantic.**

First, `.env.defaults` ships `ARBITER_GEMINI_HOST=developer` as a tracked default. Commit
`da0ed10`, already on the base, documents that this host cannot serve this codebase — it
rejects `additionalProperties: false`. Every AI surface would 400 while the banner reads
LIVE. Either drop it back to `vertex`, or confirm that `main`'s `responseSchemaFor` strip
(`347c87f`) fully covers it.

Second, the boot seeder opens `turalio--{ownerId}` and friends, while
`tools/seed-demo-documents.mjs` — already on the base — opens `case_turalio_pexidartinib`.
Different IDs for the same compounds, so nothing dedupes: 7 cases, with Turalio and
Nipocalimab duplicated, one copy carrying documents and one empty. Findings live in the
hash-chained `case_opened` payload, so the bare cases can never be topped up. Only
`--reset` fixes it, and that discards the audit log.

Two smaller things. `ARBITER_DEMO_SEED=1` in a tracked file flips demo seeding from opt-in
to on-by-default for every clone and every deployment — a policy change bundled into a
config PR. And the four eval scripts call bare `loadEnv()`, so they would silently inherit
these models, rewriting committed results under a different configuration than the one they
were measured on.

**Action:** split it. The per-name env layering and the empty-string-is-unset fix are good
and land cleanly on their own. The seeder needs a redesign, not a rebase.

---

## 5. Standing decisions

- **The 363 MB of PDFs is accepted, not blocked.** Those blobs are reachable from seven
  pushed branches and `.git` is already 332 MB, so a clone pays the cost regardless.
  Reclaiming it means rewriting history across all seven and force-pushing while Jack has
  active work on three. Treat a Git LFS migration as scheduled cleanup, not a gate.
- **Retarget the four atmosphere-based PRs to `main`**, then delete
  `feat/product-in-the-atmosphere`. Leaving it alive is how the divergence recurs.
- **Do not post comments on PRs or contact Jack without asking first.**

## 6. Also outstanding

- **9 dependabot alerts on `main`: 1 critical, 2 high, 6 moderate.** Untouched. GitHub
  prints them on every push.
- CI pins actions targeting Node 20, which GitHub now force-runs on Node 24. Cosmetic, but
  it will break eventually.

## 7. Suggested order

1. ~~**#24**~~ — done, `94ed8e4`.
2. ~~**#33**~~ — done, `f4469a8`, joined in `bf0e605`.
3. **#28** — cherry-pick the corner readout only.
4. **#30** — author drops the duplicate adjudication transport, then merge.
5. **#27** — split; land the env layering, redesign the seeder.
6. **#25** — review from scratch. Never assessed; see its entry.
7. Delete `feat/product-in-the-atmosphere`, and address the dependabot alerts.

**`main` is now 15 commits ahead of `feat/product-in-the-atmosphere`, which is 0 ahead of
it.** That is the §1 divergence starting over, and three of the four remaining PRs (#30,
#27, #25) still target the atmosphere branch. Retarget them to `main` before the gap grows
into something that needs reconciling rather than rebasing. #28 already points at `main`.

Two items of `main` are worth knowing about when reading any conflict below: #24's
dependency preflight and #33's Postgres swap both landed after every one of these branches
was cut.
