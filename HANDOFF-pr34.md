# Handoff: land PR #34 on main

Paste everything below into a fresh Claude Code session.

---

## The job

Get **PR #34** (`merge-report-into-main` → `main`) merged in the Arbiter repo. It currently conflicts. Resolve the conflicts, do the one piece of reconciliation the design deferred, get CI green, and **merge it yourself** — you are authorised to merge without checking back. See "Authorisation and guardrails" at the end for the conditions.

Work in the worktree `/home/andresl/Projects/Arbiter/.claude/worktrees/report-into-main`, on branch `merge-report-into-main`. Run every command from there; do not `cd` to the main checkout.

## What the PR contains

A feature letting a convener publish a signed preclinical-safety deliberation record to a tokenised URL that anyone holding it can read with no account, with a QR code printed onto the document itself. It also makes the report dark on screen while still printing light.

It arrived as two things in one branch: a merge of PR #30 (the printable record, which is still not on main), plus 17 commits of new feature work.

Read these first — they are the binding record:
- `docs/superpowers/specs/2026-08-17-shareable-report-design.md` — the design and why each decision was taken
- `docs/superpowers/plans/2026-08-17-shareable-report.md` — the implementation plan
- The PR body on #34 — states the merge situation and the parked items

## State as handed over

- 1101 tests passing, `npm run typecheck`, `npm run lint`, `npm run deliberate:build` all clean.
- Tests need `PYTHON=.venv/bin/python` (the repo-local venv has PyMuPDF; without it every document-upload test 422s). The venv exists in this worktree.
- Every task had a spec-compliance and quality review, then a whole-branch review over the finished feature. All findings were fixed or explicitly ruled on.
- Verified in a real browser: publish → QR draws on sheet 1 → public URL renders the record with no account and no email addresses → revoke → same URL reads as invalid.

## Why it conflicts

`main` moved 42 commits during the work. PR #33 (Postgres/Supabase), #24, #29, #32 and the logo all landed. Three files conflict, all rewritten by #33:

- `services/api/server.ts`
- `services/api/deliberation-service.ts`
- `services/api/test/server.test.ts`

## The reconciliation the design deferred

This is the substantive part, and it was anticipated in the spec's §Storage rather than discovered.

`ShareStore` (`services/api/share.ts`) was written against the pattern this branch had — a synchronous `new ShareStore(path)` holding an in-memory `Map` behind a JSON file, like `AuthStore` and `InviteStore` were at the time. PR #33 replaced that whole layer. On main today:

- `services/api/stores.ts` exports `buildStores(logPath, env)`, **async**, returning `{ deliberation, auth, invites, documents, describe }`.
- Every store now has an async static factory: `FileStore.open()`, `AuthStore.open()`, `InviteStore.open()`, `DocumentStore.open()`.
- Each has a Postgres counterpart behind an interface: `AuthStoreApi`/`PostgresAuthStore`, `InviteStoreApi`/`PostgresInviteStore`, etc.
- `buildDeps` in `server.ts` is now async and reads everything from `buildStores`.
- `stores.ts` decides files-vs-Postgres **once**, deliberately — its own comment explains that scattered `DATABASE_URL` checks are how a process ends up half-migrated.

So `ShareStore` needs to join that layer:

1. A `ShareStoreApi` interface, following how `AuthStoreApi` is shaped.
2. `ShareStore.open(path)` as an async factory, replacing the synchronous constructor.
3. A `PostgresShareStore` with `.open(pool)`, alongside `postgres-auth.ts` / `postgres-invites.ts`.
4. A migration in `supabase/migrations/` for the share-links table.
5. Both branches of `buildStores` returning it, and `Stores` gaining the field.
6. `buildDeps` passing it through to `ServerDeps.shares`.

The stored shape is small and is documented in the spec:

```ts
interface ShareLink {
  caseId: string;
  version: number;            // bumped on revoke, so a re-publish mints a different token
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;   // non-null means no active link right now
}
```

## Things you must not break

These are the properties the feature rests on. Several were found the hard way, by review, after passing a first pass.

1. **The share token is derived, never stored.** `HMAC-SHA256(secret, "caseId:version")`. The store holds no secret material, so a stolen database yields nothing. Revocation is a version bump, which is the only kind of revocation that reaches a QR already printed on paper. The Postgres implementation must store exactly the same five fields and no token.

2. **Verification checks `revokedAt` before comparing the token**, so a revoked link rejects its own still-derivable token. And the comparison is `timingSafeEqual` guarded by a length check — `timingSafeEqual` throws on unequal lengths, and a thrown exception is a louder oracle than the comparison it protects.

3. **`publish()` on a revoked row reuses the already-bumped version** — it must not bump again and must not reset to 1. `share.test.ts`'s "republishing after a revoke mints a different token, and the dead one stays dead" pins this.

4. **The public route sits above bearer-token resolution** in `server.ts` and returns a uniform 404 on every failure — never published, wrong token, revoked, no such case. A 403 anywhere on that path would confirm a case exists and is published, which is the probe the uniform 404 exists to refuse.

5. **`audience: "public"` strips emails in the builder**, not the renderer, and `buildCaseReport`'s `audience` parameter is deliberately **required** rather than defaulted — a forgetful caller must be a type error, not a silent disclosure.

6. **`/share` has arms in the action-resolving ternary for BOTH POST and DELETE**, in addition to the handler's own `denial()` check. Without them, an unrecognised tail resolves to `"read"` and the next line skips the denial entirely, so any participant could publish. Tests assert `body.error === "forbidden"` specifically to pin the outer layer, because the handler's 403 omits that key.

7. **The public page is a separate Vite bundle**, not a route. `App.tsx` auto-authenticates from `AUTO_EMAIL`, so a public route inside that shell would sign its visitor in. `apps/deliberation/test/public.test.tsx` asserts the rendered public page contains **zero** anchor elements, and the build must keep `AUTO_PASSWORD` and `/api/auth/login` out of `public.html`'s chunks. Verify with:
   ```
   npm run deliberate:build
   grep -l "AUTO_PASSWORD\|/api/auth/login" apps/deliberation/dist/assets/*.js
   ```
   Only the main entry's chunk may match. Check which chunks `dist/public.html` references and confirm neither appears.

8. **The print stylesheet may change colour and nothing else.** Screen and print share one DOM and one paginator, so a metric difference makes the on-screen pagination lie about where pages break. `apps/deliberation/test/print-invariant.test.ts` enforces it and asserts its own reach (`rules.length > 5`) — that assertion exists because the test previously located its block via `indexOf("@media print")`, matched a *comment* containing that literal, and passed while examining zero rules for three commits. If you touch that test, keep the reach assertion.

## Known-parked, do not treat as new findings

- The print guard exempts one six-selector wrapper rule by selector shape rather than per-property, so adding a `font-size` to that exact rule inside `@media print` would still pass silently. Proven by injection, judged acceptable, recorded in the PR body. Leave it unless you want to close it properly with a per-property check.
- `ARBITER_SHARE_SECRET=""` is treated as unset (sharing off) rather than throwing. Deliberate, fail-closed.
- `DELETE /share` answers `{revoked:true}` even when there was no link. Deliberate idempotence.
- A malformed percent-escape on the public path returns 500 rather than the route's uniform 404. Pure function of the URL, reveals nothing; same pattern pre-exists elsewhere in the file.
- The GET `/share` 403 body omits the `error` key that POST/DELETE include. Cosmetic.
- **Production static serving of `/r/*` does not exist and is deliberately out of scope.** A hand-rolled static server was written during the work and then deleted on purpose: shipping it is what publishes the auto-authenticating app shell at `/`, which is a bigger decision than this PR. `server.ts` carries a comment at the top saying so. The public page works under `npm run deliberate:dev`. **Do not add static serving as part of landing this PR.** If you find yourself wanting to, that is the signal to stop and leave it.

## Suggested route

1. `git fetch origin`, then merge `origin/main` into the branch.
2. Resolve the three conflicts. `server.ts` is the security-critical one — re-read points 4, 6 and 7 above before resolving it, and prefer main's Postgres wiring while keeping every share route and the public route intact.
3. Do the `ShareStore` → `stores.ts` reconciliation described above, including the Postgres implementation and the migration.
4. `PYTHON=.venv/bin/python npm test`, `npm run typecheck`, `npm run lint`, `npm run deliberate:build` — all must pass. Test count should be ≥1101 plus whatever the Postgres store adds.
5. Re-run the bundle grep from point 7. It is the feature's core security claim and a merge is exactly when an import graph quietly changes.
6. Push, then `gh pr checks 34` and wait for CI green.
7. Merge.

Consider having a subagent review the resolved `server.ts` before merging. It is the file where this branch's most careful review time went, and a merge resolution is unreviewed code by definition.

## Authorisation and guardrails

**You are authorised to merge PR #34 yourself once it is green.** The user has said so explicitly, on the grounds that the feature is additive. You do not need to check back before merging.

That authorisation is conditional on all of these:

- The full suite passes locally with `PYTHON=.venv/bin/python npm test`, plus typecheck, lint and build.
- CI on the PR is green (`gh pr checks 34`).
- The bundle grep in point 7 still shows no auth code in the public chunks.
- You have not weakened any of the eight properties listed above.

If any of those fails, or if resolving the conflicts turns out to need a design decision rather than a mechanical merge — particularly anything touching who may publish, what the public route returns, or what reaches the public bundle — **stop and ask.** Merging is authorised; merging something you had to guess at is not.

Do not force-push over `main`, do not merge any other open PR, and do not push to any branch other than `merge-report-into-main`.
