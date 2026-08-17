# Handoff — the open pull requests

Written 2026-08-17, for whoever picks this up. Sibling to `HANDOFF-evaluation.md` and
`HANDOFF-reading-and-atmosphere.md`, which were written the day before from the branch
that has since become `main`. Those two own the numbers and the reading surface; this one
owns the open PRs and the branch topology underneath them.

A previous session reconciled that topology and merged what was ready. As of the overnight
review on 2026-08-17, **no pull request is open**: #24, #25, #33 and #34 merged; #27, #28
and #30 closed, each for a reason recorded in §4. What remains is one gap in a shipped
feature (§7 item 9), not a queue. Read all of this before touching anything.

**This document is now mostly a record rather than a plan**, and the parts of it that were
wrong are marked where they were wrong rather than deleted — twice this session a stale
paragraph nearly produced the opposite of the right decision, and both times what saved it
was the sentence that had been left in place to argue with.

An earlier revision of this document said "five PRs" and listed five. There were six, and
#25 was the one missing. Count against `gh pr list` rather than against this section.

---

## 1. Repo state as of 2026-08-17

- Repo: `/home/andresl/Projects/Arbiter` (GitHub `SaplingLearn/Arbiter`), default branch `main`.
- **`main` and `feat/product-in-the-atmosphere` were identical — 0/0 divergence — at
  `0ad996e`, and are not any more.** For months these had diverged, which is why most of
  the PRs below target the atmosphere branch and none of them ever reached the product.
  That was fixed, and then #24, #33 and #28's harvest all landed on `main` alone, so the
  gap has reopened: see §7 for the current count. The atmosphere branch should be deleted
  once the remaining PRs retarget to `main` — leaving it alive is how this recurs.
- The working tree was **clean** when this was written, so the primary worktree is safe to
  work in. That was not true the day before, and it may not be true when you read this.
  Check `git status` first. If it is dirty, do not `checkout`, `stash`, `reset`, `merge`
  or `pull` in place — clone instead:
  `git clone --shared --no-hardlinks /home/andresl/Projects/Arbiter <scratch>/wk`
- Local `main` can sit well behind `origin/main` — it was 24 commits behind at the start of
  this session, which makes every conflict you compute wrong in a way that looks like the
  base moved. `git fetch` before you believe any diff.
- **`origin/main` also moves while you work.** On 2026-08-17 it went `d80f2ca` → `1c25747`
  mid-session when #34 merged from another working session, and a branch that had been a
  clean fast-forward twenty minutes earlier no longer was. Re-check immediately before
  pushing, not only at the start.
- **Count the open PRs against `gh pr list`, never against a prose sentence.** This document
  has now miscounted twice in opposite directions: an early revision said "five" when six
  were open and omitted #25, and the overnight prompt written from it said "four" when five
  were open and omitted #34 — the very PR that then landed and moved `main`. Both times the
  count was written as prose and nothing made the omission detectable.

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

Baseline at **`1c25747`** (current `main`, after #34): typecheck 0, lint 0, and **two** test
numbers, because #33 made the suite conditional on a database. Measured 2026-08-17:

| environment | result |
|---|---|
| no `DATABASE_URL` | 1185 passed / 95 skipped / 80 files |
| Postgres + Storage | **1280 passed / 0 skipped / 80 files** |

**The `d80f2ca` figures this table used to give were 1048/76 and 1131/0, and the first of
those was wrong.** Re-measured at that same commit it is **1055** passed / 76 skipped. The
arithmetic gives it away without re-running anything: 1055 + 76 = 1131, which is the
Postgres total; 1048 + 76 = 1124, which is not. 1124 was the figure from #33's merge commit
and appears to have been carried forward into a row it no longer belonged in.

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
development database. Earlier baselines in this document's history were 985/67 at `0ad996e`,
993/68 after #24, and 1124 after #33; all are superseded.

---

## 4. The PRs, one by one

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

**One defect found, not fixed, and it is not this PR's code.** ~~
`tools/seed-demo-documents.mjs --reset` is file-only: it deletes `results/*`, prints
"Store cleared", and on a Postgres deployment leaves every row intact.~~ **FIXED
2026-08-17.** The ordinary seeding path goes through the HTTP API and so follows whichever
backing the server opened — only `--reset` reaches around it to the disk, and since #33 the
disk is not always where the store is.

It now **refuses** when `DATABASE_URL` is set, rather than clearing Postgres itself.
Deleting rows from a database the script never opened, on a URL it cannot verify is a
demonstration deployment rather than a live one, is a worse failure than not doing it — and
the log is hash-chained, so a partial delete is not something the product can be talked out
of noticing later. It names the two migrations to re-apply and the bucket to empty instead.

The guard sits at the **top of the file, above the fetch and the PyMuPDF gate**, and that
placement is the point: a Postgres host is the machine least likely to have 363 MB of PDFs
or PyMuPDF on it, so a guard below the gate would have been unreachable from exactly the
deployment that needed it — the run would die on a missing extractor instead. Checked both
ways: with `DATABASE_URL` set it refuses and exits 1 having touched nothing; unset, it falls
through to the ordinary path.

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

### ~~#30 — printable deliberation record (Darkest-Teddy)~~ — LANDED 2026-08-17, inside #34

**Its content is on `main`.** Not by merging #30: PR #34 (shareable report) was cut from a
branch that already carried #30 merged into it, so landing #34 landed both. **#30 itself is
still open and now has nothing left to contribute — close it rather than merge it**, or its
merge will re-apply the duplicate transport this entry was about.

The report feature itself was good: no new dependency, browser `window.print()`, 30 tests,
no injection surface — pure React elements, no `dangerouslySetInnerHTML`.

**The blocker, and how it actually resolved.** Roughly a third of #30 was a second,
incompatible implementation of the fix `dd140aa` already landed on `main`: it added
`DeliberationService.adjudication()` and a `case "adjudication"` route, where `main` had
widened `view()` to carry the same fact. **These auto-merge with no conflict**, which is
what made it dangerous — and both halves of it were still live when #34 was resolved:

- The **route** was already gone. #34's branch dropped it and left a comment where it was
  saying why (`view` carries the adjudication, so a second endpoint is a second thing to
  keep honest). The service method stayed, because `handleReport` reads it.
- The **two provenance rules** had both survived, exactly as predicted — `view`'s
  `actorId === "stub" ? stub : live` beside the report's `actorId === "model" ? live :
  stub`, opposite defaults for an unrecognised actor, on two surfaces that both claim to
  describe the same adjudication. Closed in the #34 merge: one module-level `sourceOf` in
  `deliberation-service.ts`, which both readers now call, failing toward `stub` for
  anything that is not exactly "model". Every writer passes "stub" or "model", so nothing
  observable changed; `deliberation-service.test.ts` pins that the two agree, including on
  the third actor neither was written for.
- **`main`'s Adjudicate gate (`view.status === "locked"`) was NOT reverted** in the end —
  it is live in `App.tsx`, and the server also refuses before spending, via
  `readyToAdjudicate`.

### #28 — product chrome fixes (Darkest-Teddy) — DRAFT, and now mostly harvested

**Its two live fixes are on `main` as `e8569a3`.** The PR itself is still open and still a
draft. What follows is what remains, and what to *not* do with it.

The diffstat reads `+295/−40`, which hides **363 MB of PDFs** — binaries count as zero
lines. Those blobs are on `main` anyway via the fast-forward, so this is no longer a reason
to block; see §5.

**What was taken, reimplemented rather than cherry-picked.** `51abbfe` and `ffb18f2` no
longer apply — `nav.ts` and `screens.tsx` both moved a long way under that branch, and both
cherry-picks conflict. Main had independently fixed more than half of each:

- *The corner readout.* Main had already given `read` its own NAV entry and put `record`
  into `currentNav`'s case-route list, so the menu highlight was correct. What was still
  broken is the corner itself: it read its name off the lit menu entry, and the record has
  no entry, so it borrowed the Library's. `currentNav` answered `Archive` for
  `{ name: "record" }` while `sceneFor` mounted `record`, whose name is `Helix` — verified
  by assertion before the fix, not inferred. Now `codenameFor(route)` →
  `CODENAME[sceneFor(route)]`, and `codename` is off `NavItem` entirely.
- *The call control's accessible name.* Main had already taken the `.choice` /
  `button.ghost` half of `ffb18f2`. It had not taken the a11y half: `<label htmlFor="call">`
  pointed at `<div id="call">`, and a label's `for` names a *labelable form control* — a div
  is not one, so the attribute resolved to nothing and the most consequential control in
  the product had no accessible name. `role="group"` with `aria-labelledby` now carries it.

**The handoff's own advice on this one was wrong, and the reason is worth keeping.** An
earlier revision said the `CODENAME` table hand-duplicates `codename` from
`packages/atmosphere/src/scenes/registry.ts` and should "read `STATES` instead". Doing that
is a bundle regression: `registry.ts` statically imports all seven scene factories and each
imports `three` and `gsap`, `Backdrop.tsx` reaches the package through `await import()` for
exactly that reason, and `Chrome.tsx` imports `nav.ts` eagerly — so a static
`import { STATES }` puts the whole 3D stack in the chunk that draws the sign-in screen. The
duplication is deliberate and is paid for in `test/nav.test.ts`, which imports the registry
for real and fails if the two drift. A test can afford that import; the shell cannot.

**Still true, and still the reason not to merge this branch:** resolving
`services/api/gemini.ts` toward the PR *deletes* `main`'s `responseSchemaFor` and re-breaks
every AI surface. Resolving `services/api/server.ts` toward the PR reverts `main`'s
`ServerDeps.complete` test-isolation seam. Its `.env.example` and `README.md` edits still
say the developer host "cannot serve this codebase", which `347c87f` fixed — and those
files **auto-merge with no conflict**, so the stale claim would land silently.

**Action:** nothing further is needed from this branch. Close it, or let its author
rebase and find it empty of everything except the traps above — but per §5, that
conversation has not been had.

**EMPTINESS VERIFIED 2026-08-17, against current `main`.** All four harvested fixes are
present: `codenameFor` (`nav.ts:136`, used at `Chrome.tsx:180`), `role="group"` with
`aria-labelledby` (`screens.tsx:588`), `geminiCredentialAdvice` (`gemini.ts:153`, wired at
`server.ts:1597`), and the working-directory suffix on the Config line (`server.ts:1608`).

`git merge-tree` against `1c25747` reports **five conflicts, all in files `main` has
superseded**: `screens.tsx`, `shell/Chrome.tsx`, `shell/nav.ts`, and the two test files.
Everything else auto-merges.

**Two corrections to what this document said about it.** The paragraph above is wrong that
resolving `gemini.ts` toward the PR deletes `responseSchemaFor`: neither merge base
(`ec1c8e8`, `0d39766`) contains that function, so `main` ADDED it after this branch was cut
and a merge keeps it. `gemini.ts` and `server.ts` are not in the conflict list at all. A
two-snapshot `git diff main PR` *looks* like a deletion and is not one — that diff shows the
branch being behind, not what a merge would produce.

The async-`auth.list()` hazard is real on the branch — it carries `deps.auth.list().length`
at three places while `main` awaits it at four and warns against exactly that at
`server.ts:1629` — but `server.ts` auto-merges to `main`'s version, so it would not land.

**So: close it.** Not because it is dangerous, but because it is empty. Per §5 that close has
not been actioned here.

### #25 — all ten benchmarks, and toxic drugs in the corpus (Darkest-Teddy) — REVIEWED, prepared, not pushed

Reviewed from scratch 2026-08-17. It was a placeholder before this; the entry below is
what was checked, and how.

**Merged and verified on `review/25-eval-scoreboard` (local).** One conflict, `.env.example`,
in the `ARBITER_ADJUDICATION_RUNS` comment only — the PR's text is a strict superset of
`main`'s (it keeps the cap-9 and the spend warning and adds why consensus exists), so it was
taken whole and nothing of `main`'s was lost. typecheck 0, lint 0, **1190 passed / 95 skipped
/ 81 files** with no database and **1285 passed / 0 skipped / 81 files** on Postgres and
Storage — the baseline plus exactly the five tests added during review.

**The numbers are sound.** `node tools/verify_scoreboard.mjs` exits 0, and every headline was
independently re-derived from the raw rows rather than trusted: all five Ask metrics, all
five verdict metrics, both `tested` denominators, and the counterfactual pass count. They
agree with the summary fields once each is scoped to the rows that can fail it. The Wilson
implementation matches the standard interval (Brown/Cai/DasGupta form) exactly. The Ask and
retrieval results really do come from one fixture — the check at `verify_scoreboard.mjs:77`
is real, and the fixture's 104 answerable ids are identical to Ask's.

**Three defects found in the instrument, all now fixed on the branch.**

1. *Metric 1 was the one headline read from a summary field.* It was
   `Math.round(retrieval.hitRate * retrieval.answerable)`, in the file whose docstring says
   it recomputes from raw items so a drifted number shows up. It now counts the rows, and
   `hitRate`/`answerable` are asserted against them. The value does not move: 99/104.
2. *A cross-check could not fire.* The gap-recall guard keys off `five.scoredMetrics`.
   `verdict-five-eval.ts` has written that field since `cef9ac3` (19:22), but the committed
   `verdict-five-*.json` was last written at `b1e505e` (19:14) and has neither it nor
   `guaranteedNotMeasured` — so the guard no-opped while the tool printed "OK - no drift
   found", and absent looked exactly like correct. It now reports stale provenance as a
   warning. The results file is older than the harness that describes it and still carries
   `score.gaps` from before gap recall was reclassified.
3. *A product change rode along, unmeasured and untested.* `8d66975` widened the extraction
   query from the checklist `field` to `field + searchTerms` and added those terms to
   `rules/evidence-checklist-v1.0.json`. **This is not a §1.1 violation** — only
   `ruleset-v1.0.json` is pre-registered and hashed (`preregistration.ts:54`), and the
   checklist is not. But none of the ten benchmarks touch it: `retrieval-eval.ts:233`
   searches with the fixture QUESTION at k=16, and `extract.ts:137` is the only caller of
   `searchTerms`, at `perItem=6`. Its justifying comment said a stray term "costs a
   discarded proposal, never a wrong finding" — true about precision, silent about recall.
   Five tests now cover `proposeFindings`, which had none; one of them demonstrates the
   displacement directly, at `perItem=1`.

**The end-to-end file is a *before* measurement and should not be read as a result.**
`results/model-comparison/verdict-endtoend-gemini-3.5-flash.json` was written at `b5ead3a`
(19:38), an hour before the retrieval change, and never regenerated. `sensitivity` is
`k=0, n=0` — no hepatotoxic case was ever scored — and `verdict-endtoend-eval.ts:179` sets
`flagged = verdict === "do_not_advance"`, so `cannot_conclude` counts as a correct negative
and both scored rows abstained. A system that abstains on everything scores 2/2 there. No
number in the scoreboard comes from it and §8 does not list it, which is why this is a
caveat rather than a blocker.

**Action:** land it. The branch is a fast-forward of `main` and was verified against both
databases after merging current `main` in. Nothing about it was pushed — see §8.

### ~~#27 — shared cases on boot, and models in git (Darkest-Teddy)~~ — SPLIT, then CLOSED 2026-08-17

The good half landed (below). The remainder was closed rather than rebased, because it does
not compile against `main` and the idea in it is worth more than the diff:

- `seed-cases.ts` calls `service.count()`, which **`DeliberationService` does not have**, and
  `auth.findByEmail(...)` **without awaiting** — it is `async` since #33 (`auth.ts:365`), so
  `owner === null` is never true. Both of its two guards are broken by the same async drift
  that killed #30's duplicate transport. "Needs a redesign, not a rebase" is now demonstrated
  rather than predicted.
- A tracked `.env.defaults` was **considered and rejected on second look.** The mechanism
  landed — `ENV_FILES` reads `.env.defaults` when present — but there is nothing safe to put
  in it. The models it proposed (`gemini-flash-latest`, `gemini-3.1-flash-lite`) are not the
  ones the scoreboard was measured on, and the six bare `loadEnv()` eval scripts would
  inherit them; `gemini-flash-latest` is a floating alias, which is worse again for
  reproducing a committed number. The models that ARE agreed are already in git as
  `DEFAULT_ADJUDICATION_MODEL` / `DEFAULT_SHORT_MODEL`, with the measurement behind them
  written out beside them. A tracked file restating them is a second place for one fact to
  live, and `.gitignore`'s `.env.*` blanket exists precisely so no new `.env.*` name has to
  be remembered. So: no negation was added, and `.env.defaults` stays ignored.

**What is genuinely lost by closing it, and worth rebuilding.** A fresh clone has the case
CONTENT in git (`data/cases/*.json`) but nothing OPEN, so the product looks empty and a new
developer reasonably concludes the data was not shared. Nothing on `main` fixes that. The
PR's reasoning about deliberately NOT seeding the refusal cases — tolcapone and troglitazone
exist in the catalogue precisely because they cannot become cases, and seeding them would
make that refusal decorative — is the part to keep.

One correction to this document, while the branch is still readable: on the id collision the
seeder was on the *right* side. It mirrors the picker, which builds `${loaded.caseId}--${user.id}`
(`server.ts:1400`); it is `tools/seed-demo-documents.mjs` that opens a bare, unsuffixed id.

### #27, as reviewed before the close

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

**SPLIT DONE 2026-08-17, on `feat/env-layering-from-27` (local, not pushed).** It carries
`env.ts`'s per-name layering, the PR's own seven env-share tests, `resolveModel`'s
blank-is-unset fix, and one test for that fix, which the PR shipped without. The banner now
names every file it read rather than the first — reporting one source for a configuration
assembled from several defeats that line's only purpose. typecheck 0, lint 0, **1193 passed
/ 95 skipped** with no database and **1288 passed / 0 skipped** on Postgres and Storage.

Landing the layering *without* the tracked file is behaviour-preserving: `.env.*` is already
gitignored on `main`, so no `.env.defaults` exists, `envFilesInUse()` returns what it always
did, and nothing inherits a model it was not already inheriting. That is what makes the good
half safe to take on its own.

**A third blocker, not previously recorded.** The PR also reverts `SHAPE_ASK` from 64000 back
to 16000 and deletes the comment explaining the raise — `main` raised it after measuring
`truncated: max_tokens too low` on three of four Ask attempts against the Turalio review.
It would not land silently: `interpret.test.ts:79` asserts `maxOutputTokens > 16000`, so the
suite catches it. It is on the branch nonetheless and is a third reason not to merge it whole.

**And it is six eval scripts calling bare `loadEnv()`, not four** — `ask-eval`,
`counterfactual-eval`, `verdict-endtoend-eval`, `verdict-five-eval`, `verdict-eval` and
`verdict-real-eval`. The layering change does not make this worse (an explicit `path` still
reads that file alone, which is what pins a configuration), but the count above was wrong.

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

- **9 dependabot alerts on `main`: 1 critical, 2 high, 6 moderate. TRIAGED 2026-08-17;
  one fixed, eight reported.** Every one is development-scope except the two Python ones.
  - *Fixed*, on `fix/carried-over-risks`: `requests` 2.32.3 → 2.33.0, closing a `.netrc`
    credential leak via malicious URLs (2.32.4) and insecure temp-file reuse in
    `extract_zipped_paths` (2.33.0). Both moves are inside 2.x.
  - *Needs a major upgrade, so not taken*: **vitest 2.1.9 → 3.2.6** (the critical one — but
    it requires the Vitest UI server to be listening, and nothing in this repo runs
    `--ui`), **vite 5.4.21 → 6.4.3** (both vite advisories are Windows-specific: UNC path
    handling and `server.fs.deny` on alternate paths), and **pytest 8.3.4 → 9.0.3**.
  - *Transitive, needs a lockfile regeneration*: **js-yaml → 4.3.1** (the other high; a
    quadratic-CPU DoS in `!!omap`, reached through eslint) and **esbuild → 0.25.0**. Both
    want an `overrides` entry and an `npm install`, which could not be done safely from a
    worktree sharing `node_modules` with the primary checkout.
- **The Node-20 note below was wrong and is corrected.** `.github/workflows/ci.yml` pins
  `node-version: '22'`, not 20. The real item is the *action runtime*: `actions/checkout@v4`,
  `setup-node@v4` and `cache@v4` run on the node20 runtime that GitHub is retiring, and the
  fix is bumping those action majors, not the `node-version` input.
- **The two risks #24 brought in are fixed**, on `fix/carried-over-risks`. `check-deps.mjs`
  no longer compares an exact pin against a WORKSPACE — `apps/harness` pins `@arbiter/engine`
  to `1.0.0` and npm symlinks it to `packages/engine` regardless, so bumping the engine
  alone hard-failed `npm run dev` for everyone with a message about a stale install, which
  is the one diagnosis that cannot be right. Resolved with `realpathSync`; the pin check is
  untouched for real installs and there is now a test either side of the line.
  `check-deps.test.mjs`'s "passes on this repo, which is installed" is left alone
  deliberately — it does still fail `npm test` on a partial install, but its own comment
  explains why it is there, and removing it would delete the only case that catches the
  check reporting false problems.
- **`withTransaction` is fixed**, same branch, and the concern was real. Its `catch` ran
  `await client.query("ROLLBACK")` unguarded, so a rollback that threw REPLACED the error it
  was rolling back; and `finally` called `release()` with no argument, offering a connection
  that might still hold an open transaction back to the pool. Five tests against a fake pool,
  three of which fail against the previous implementation — checked by reverting the file
  and re-running, not assumed.
- **`.gitignore` had `.venv/` with a trailing slash**, which matches a directory and not a
  symlink — and a symlink is what §2 tells you to create. Following §2 and running
  `git add -A` commits a mode-120000 blob holding an absolute path to one machine, which
  then deletes itself from the next person's worktree on checkout and takes PDF extraction
  with it, surfacing as the §2 gotcha rather than as something the repo did to itself. This
  happened during this session and is fixed on `review/25-eval-scoreboard`.

## 7. Suggested order

1. ~~**#24**~~ — done, `94ed8e4`.
2. ~~**#33**~~ — done, `f4469a8`, joined in `bf0e605`.
3. ~~**#28**~~ — harvested, `e8569a3`; emptiness verified against `1c25747`, then **CLOSED**.
4. ~~**#30**~~ — landed inside #34, then **CLOSED**.
5. ~~**#27** — split~~ — the good half landed; the remainder **CLOSED**, because it does not
   compile against `main`. The seeder idea is worth rebuilding — see its entry.
6. ~~**#25** — review from scratch~~ — done, and **MERGED** (`ba2a060`).
7. ~~**Push the four prepared branches**~~ — merged together on `integrate/overnight` and
   pushed to `main`. They were prepared separately (`review/25-eval-scoreboard`,
   `feat/env-layering-from-27`, `fix/carried-over-risks`, `docs/handoff-after-overnight`),
   verified separately, then merged as one fast-forward and verified again — the four touch
   disjoint files, so every merge was clean.

   **`.venv` was committed a second time on the way here**, by the three branches cut before
   the `.gitignore` fix landed on the #25 branch. It is removed at the tip and cannot come
   back now that the pattern covers a symlink, but it is present in intermediate commits on
   this history. If you are bisecting through them and PDF extraction starts failing, that
   is why. The lesson is `git add -A` in a worktree, twice in one session: stage by path, or
   check `git status` for a `.venv` that is not showing as ignored.
8. ~~Delete `feat/product-in-the-atmosphere`~~ — **DONE**, remote and local. It was 0 ahead
   of `main` and fully contained in it (the local copy was a different commit, `51bc0df`,
   and also fully contained), and no open PR targeted it.
9. ~~**Serve `/r/:caseId/:token` in production.**~~ — done, on `feat/serve-public-record-page`
   off `50d6cb9`. `serveStatic` answers a three-segment share link with `public.html` from
   the site root — one rule that resolves to one constant, so neither the case id nor the
   token is ever used to build a filename and a root without that document 404s rather than
   falling back. `tools/stage-site.mjs` puts the document at the root with its asset
   references pointed at the directory it staged the client into, and fails the build if one
   of them does not resolve. `npm run dev` proxies `/r/` instead of answering it with the
   marketing page at status 200.

   **The failure it closes was a 200, not a 404**, which is why it survived a green suite:
   staged under `/deliberation/`, `public.html` still asked for `/assets/public-<hash>.js`,
   where the landing page's own bundle lives under different names — a document that parses,
   a correct content type, and a blank page. `e2e/public-record.spec.ts` is a second
   Playwright project that builds the site, publishes a record over the API and opens the
   link in a browser; it asserts on failed subresource requests *before* asserting on
   content, because with the content check first the same defect fails by five-second
   timeout naming a compound instead of immediately naming the asset. Nothing in the repo
   opened a built site before it.

   The auto-sign-in question this waited on was answered in the same change, because
   serving the share link is what made it urgent. `VITE_AUTO_EMAIL` and `VITE_AUTO_PASSWORD`
   lost their hardcoded defaults and are scoped to `import.meta.env.DEV`, which the minifier
   drops from a production bundle entirely; the `AuthPage` that had been sitting exported and
   unreferenced since sign-in was removed is what a built shell shows instead. Development,
   `npm run dev` and the suite are unchanged. **What was NOT done** is restoring real sign-in
   as the product's own behaviour — `App.tsx` still argues for opening straight into the
   product, and a demo deployment still opts into one shared identity with the attribution
   cost that file describes. That remains a product decision, and it is now the only part of
   this item still open.

**NO PULL REQUESTS REMAIN OPEN as of 2026-08-17.** #25 merged; #27, #28 and #30 closed;
#33 and #34 merged earlier. The retargeting that made this possible — #25, #27 and #30
moved to `main` with `gh pr edit <n> --base main`, #28 already there — is what let
`feat/product-in-the-atmosphere` be deleted without stranding anything.

Item 9 is therefore the only open thread, and it is a gap in a shipped feature rather than
a pull request. Everything else in this document is a record.

**`main` moved under this session, and that is worth knowing about.** It was `d80f2ca` at
the start and `1c25747` by the middle — #34 merged while the work below was in progress, and
a background fetch picked it up at 05:23. Everything here was re-verified against the new
`main` afterwards. The lesson is §1's: `git fetch` before believing any diff, and check
again before pushing, because the answer changes while you are reading it.

Two items of `main` are worth knowing about when reading any conflict below: #24's
dependency preflight and #33's Postgres swap both landed after every one of these branches
was cut.
