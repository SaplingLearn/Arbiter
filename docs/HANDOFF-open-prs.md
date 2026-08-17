# Handoff — the five open pull requests

Written 2026-08-17, for whoever picks this up. Sibling to `HANDOFF-evaluation.md` and
`HANDOFF-reading-and-atmosphere.md`, which were written the day before from the branch
that has since become `main`. Those two own the numbers and the reading surface; this one
owns the open PRs and the branch topology underneath them.

A previous session reconciled that topology and merged what was ready. Five PRs remain.
Read all of this before touching anything.

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

Baseline at `0ad996e`: typecheck 0, lint 0, **985 passed / 67 files**.

---

## 4. The five open PRs

Every finding below comes from a full per-PR review already performed. Trust them as a
starting point, but re-verify anything you act on before you act on it.

### #33 — "Put the record in Postgres and the product in a container" (AndresL230)

Base `main`, 41 files, +6913/−569, 6 commits, CI green.

Swaps the file-backed stores for Postgres/Supabase: `postgres-store.ts`, `postgres-auth.ts`,
`postgres-invites.ts`, `supabase-documents.ts`, plus `Dockerfile`, `fly.toml`,
`railway.toml`, `supabase/migrations/0001_init.sql`. It ships contract tests
(`auth-store-contract.ts`, `invite-store-contract.ts`, `postgres-fixture.ts`), which is the
right shape for a storage swap.

There is a known conflict in `services/api/server.ts` against the merged `main`. It is
expected and understood — resolve it once, now that `main` carries everything.

**This PR has not been substantively reviewed.** Only its mechanics were checked. It
replaces the entire persistence layer, so review it properly: data loss on migration, the
hash-chained audit log surviving the move, connection and pool handling, secrets in
`fly.toml` and `railway.toml`, and whether the atmosphere branch's seeding, document and
library code paths were migrated too. Those landed on `main` *after* this branch was cut,
so they may still be written against `FileStore`.

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
2. **#33** — resolve the `server.ts` conflict, review the persistence swap properly, merge.
   Note that its conflict is now against a `main` that also carries #24.
3. **#28** — cherry-pick the corner readout only.
4. **#30** — author drops the duplicate adjudication transport, then merge.
5. **#27** — split; land the env layering, redesign the seeder.
6. Delete `feat/product-in-the-atmosphere`, and address the dependabot alerts.

`feat/product-in-the-atmosphere` no longer tracks `main` — #24 landed on `main` alone, so
the two have diverged again by one merge. Retarget the remaining three PRs before that gap
grows into the thing §1 describes.
