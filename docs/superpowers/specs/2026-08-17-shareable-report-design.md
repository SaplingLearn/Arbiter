# The record, site-native on screen and shareable off it

Design, 2026-08-17. Builds on the printable record merged in `78a8096`.

## What this changes

Three things, in one feature because they are one journey:

1. The report reads as **part of Arbiter** on screen — dark, the product's palette — instead of a light sheet floating in a dark app.
2. **Print or Save as PDF** still produces the light document, because paper is white.
3. A convener can **publish** a record to a tokenised URL and print a **QR code** onto the document, so a page on a desk leads back to the live record.

## What it does not change

The document itself. Same blocks, same order, same words, nothing summarised, no model on this path. `buildCaseReport` stays pure. This is a change of palette and of audience, not of content.

---

## 1. Sharing

### The token is derived, not stored

```
token = base64url(HMAC-SHA256(ARBITER_SHARE_SECRET, `${caseId}:${version}`))
```

`auth.ts` stores only token digests, and for sessions that is right. It cannot work here: a QR printed on a sheet must be re-renderable every time the convener opens the report, and a digest cannot be turned back into a URL. The alternative — storing the plaintext — puts working capability URLs in the store.

Deriving avoids both. The store holds no secret material:

```ts
interface ShareLink {
  caseId: string;
  version: number;      // bumped on revoke, so a re-publish mints a different token
  createdBy: string;
  createdAt: string;
  revokedAt: string | null;   // non-null means no active link right now
}
```

`version` and `revokedAt` answer different questions, and conflating them is how a revoked link comes back to life. `revokedAt` says whether there is an active link *at all*; `version` says which token the case is on. Precisely:

- **Publish** on a case with no row writes `version: 1, revokedAt: null`. Publish on a revoked row clears `revokedAt` and leaves the already-bumped `version`, so the new token differs from the dead one.
- **Verify** requires `revokedAt === null`, then recomputes the token for the current `version` and compares with `timingSafeEqual`. Both conditions, in that order.
- **Revoke** sets `revokedAt` and increments `version`. Every QR already printed stops working, and cannot be resurrected by publishing again. This is what makes revocation mean something on paper.
- **Re-render** recomputes from `caseId` and `version`. Always available, nothing stored.
- **A stolen database yields nothing** without `ARBITER_SHARE_SECRET`.

Two distinct configuration failures, deliberately handled differently:

- **Unset** — sharing is disabled, not degraded. The publish route answers 501 naming the variable and where it looked, and the report page does not offer the control. The rest of the product is unaffected.
- **Set but shorter than 32 bytes** — the process **refuses to boot**, naming the variable. A weak secret is worse than none: it produces capability URLs that look unguessable and are not, and nothing downstream would ever reveal that.

### Access

`access.ts` gains `"share"` to `CaseAction`:

```ts
export function canShare(c: DeliberationCase, userId: string): boolean {
  return isOwner(c, userId);
}
```

Convener only. Publishing to the world is a different act from reading, and the person accountable for the record under §6.7 is the one who signs it. The deny-by-default shape is preserved: the function returns false unless it finds a reason to return true.

### Routes

| Route | Auth | Behaviour |
|---|---|---|
| `GET /api/cases/:id/share` | convener | `{enabled, published, url}`. `enabled` is the deployment's, not the case's - `false` when there is no secret, so the report page can withhold the control instead of drawing one that can only 501. The only gate on this route is the handler's own `denial()` check: a GET always resolves to the `"read"` action one level up, so there is no outer ternary arm protecting it the way there is for POST and DELETE. |
| `POST /api/cases/:id/share` | convener | Mints, or returns the current link. 501 if no secret. |
| `DELETE /api/cases/:id/share` | convener | Bumps `version`. Printed QR codes die. |
| `GET /api/public/report/:caseId/:token` | **none** | The report, emails stripped. |

The caseId is in the URL because HMAC is not reversible and a reverse-lookup table would be storage this design otherwise avoids. The caseId is not the secret; the token is.

The public route inherits the existing refusal: a case with no adjudication answers 409, because a document titled "deliberation record" with a blank verdict reads as a panel that concluded nothing.

An adjudicated-but-unsigned case **may** be published. It carries the existing banner — "Nobody has signed this... a deliberation in progress and not a decision" — which is the honest thing for it to say. Gating on signature was considered and rejected: a panel that has answered has produced something real, and the banner already prevents it being mistaken for a decision.

### Redaction happens in the builder

`buildCaseReport` takes `audience: "case" | "public"`. On `"public"`, every `ReportPerson.email` is `""`.

Server-side, not a client-side hide. An email absent from the rendering but present in the response body is one devtools tab from being disclosed. Names and seats stay: attribution is the record, and a position without an author is a rumour.

### Storage

A `ShareStore` following the pattern this branch already uses for accounts and invitations: an in-memory `Map` behind a JSON file, constructed in `buildDeps` as `new ShareStore(`${logPath}.shares.json`)` beside `AuthStore` and `InviteStore`.

**Not a Postgres-backed store**, deliberately. The `stores.ts` abstraction with file and Postgres implementations lives on the unmerged Supabase branch (PR #33) and does not exist here. Writing `ShareStore` against an interface this branch does not have would be building for a merge that has not happened. When PR #33 lands, `ShareStore` joins `stores.ts` the same way the other four did — one constructor call moves — and the Postgres implementation and its migration are that merge's work, not this one's.

> **Done, in the merge onto `main`.** PR #33 landed, and the paragraph above was the instruction for what happened next. `ShareStore` gained `ShareStoreApi` (declared in `services/api/postgres-share.ts`, as `AuthStoreApi` and `InviteStoreApi` are in theirs) and an async `ShareStore.open(path)`; `PostgresShareStore` and `supabase/migrations/0002_share_links.sql` are the Postgres half; `buildStores` returns it on both branches and `buildDeps` passes it to `ServerDeps.shares`. `shareSecret` stayed out of `buildStores` — which backing holds the links is a storage decision, whether the deployment can publish at all is not. The behaviour is one suite run against both implementations, in `services/api/test/share-store-contract.ts`; the estimate of "one constructor call moves" was optimistic by about a file and a half.

---

## 2. The public surface

A second Vite entry — `apps/deliberation/public.html` and `src/public.tsx` — importing `report.tsx`, `@arbiter/design` and `app.css`.

It does **not** import `App.tsx`, the authenticated api client, or `screens.tsx`.

This is the whole security argument, and it is structural rather than conditional. `App.tsx` authenticates on load from `AUTO_EMAIL` / `AUTO_PASSWORD`. A public route inside that shell would sign its visitor in, and the only thing preventing it would be a boolean somebody has to keep remembering. A separate entry cannot sign anybody in, because the code that signs people in is not in the bundle.

> Those two values later stopped being unconditional defaults and became development-only unless a build sets them, so the shell hands out a session in fewer circumstances than when this was written. **The argument above is unchanged by that** and should not be softened to lean on it: a build variable is exactly the "boolean somebody has to keep remembering" this paragraph refuses. The separation is what makes the claim hold without one.

**One cleanup this forces.** `report.tsx` imports `basisOf` from `screens.tsx`, which would drag the authenticated screens into the public bundle. `basisOf` is a pure function about positions, not about screens; it moves to `apps/deliberation/src/basis.ts` and both import it from there.

The public page renders the same sheets with the same pager, without the share controls or the "Back to the verdict" link.

Served at `/r/:caseId/:token`. In development, `apps/deliberation/vite.config.ts`'s own dev-server middleware answers `/r/*` with `public.html` - that is what `npm run deliberate:dev` and a manual walk-through of this feature use.

> **Done, in a later change.** `services/api/server.ts`'s `serveStatic` answers a
> three-segment `/r/<caseId>/<token>` with `public.html` from the site root - one rule that
> resolves to one constant filename, so neither segment is ever used to build a path and a
> root without that file answers 404 rather than falling back. `tools/stage-site.mjs` writes
> the document to the root and re-points its root-absolute asset references at the directory
> it staged the client into, which is the reconciliation the paragraph below asks for: the
> mount and the references are now set by the one script that knows where the client landed,
> and it fails the build if a reference does not resolve. `apps/landing/vite.config.ts`
> proxies `/r/` under `npm run dev`, which used to answer a share URL with the marketing
> page at status 200.
>
> The auto-sign-in question below was answered rather than inherited. `VITE_AUTO_EMAIL` and
> `VITE_AUTO_PASSWORD` lost their hardcoded defaults and are now scoped to
> `import.meta.env.DEV`, so a built artifact signs nobody in unless the build asked for an
> identity - which makes the shell fail closed without changing any development flow. The
> product's own choice to open straight into itself, and what one shared identity costs the
> record's attribution, are untouched and still argued in `App.tsx`.
>
> The proof is `e2e/public-record.spec.ts`, a second Playwright project that builds the site,
> publishes a record over the API and opens the share link in a browser. It asserts on failed
> subresource requests *before* asserting on content, because the defect this closes was a
> 200 with a blank body: a content assertion alone fails by timeout naming a compound, while
> the request assertion fails immediately naming the asset that was not found.

**[HISTORICAL — this paragraph describes the state at #34 and was closed later; see the note above.]** **Production static serving of `/r/*` does not exist on this branch, deliberately deferred.** A branch that answered `GET /` with `apps/deliberation/dist/index.html` was written for this task and removed before it shipped (see `services/api/server.ts:74-91` and the README): `index.html` signs its visitor in as `AUTO_EMAIL` on load, so serving it to anyone who merely reached the origin - not someone who signed in, not someone holding a share link - would be anonymous access to every case on the deployment. That is a materially bigger decision than "add a static file server," and it does not belong inside a task about one public route. PR #33 (`worktree-supabase-deploy`) already carries a full static-serving implementation, built against a different `ServerDeps` shape (Postgres-backed stores rather than this branch's file-backed ones); whoever brings that branch's version in must answer the auto-sign-in question above first, as its own decision, before wiring `ARBITER_STATIC_DIR` up to anything that can reach `/`. One more constraint that inherits along with it: `vite.config.ts`'s `renderBuiltUrl` rewrites `public.html`'s own asset references to root-absolute paths (`/${filename}`) specifically because `/r/:caseId/:token` is two real path segments deep, which means the public page requires a root mount and cannot work staged under the `/app/` subpath `tools/stage-site.mjs` produces for `index.html`.

---

## 3. Palette

`.report-doc` takes its colours from CSS custom properties, dark by default, re-lit inside `@media print`.

Same DOM, same block list, same paginator. Pagination cannot diverge from the preview because there is only one of it.

### The invariant

**The print stylesheet may change colour on the document's own elements, and nothing that reaches the paginator's measurements.**

No `font-size`, `line-height`, `padding`, `margin`, `width`, `border-width` or `letter-spacing` may differ between screen and print on a `.rep-*` selector, or on `.report-doc` itself (its typography inherits down into every `.rep-*` child, so a change there is a change to all of them). Those feed the measurement pass in `Paginate`, and changing one is exactly how a preview starts lying about where pages break — the failure PR #30 built the paginator to prevent.

This is enforced, not merely documented, by `apps/deliberation/test/print-invariant.test.ts`: it strips comments from `app.css` file-wide (the block boundary is found by `indexOf`, and a raw comment-first search would match `@media print` inside prose before it ever reaches the real at-rule - this is not hypothetical, see the C1 finding in the fix-round-1 review that this line commemorates), extracts the `@media print` block, and fails if any rule touching `.rep-*` or `.report-doc` sets a property outside four allowlists:

- **Colour**, unconditionally: `color`, `background`, `background-color`, `background-image`, `border-color`, `box-shadow`, `fill`, `stroke`, `opacity`, `filter`, `-webkit-print-color-adjust`, `print-color-adjust`.
- **Structural**, only on selectors that remove or seam rather than resize (`.no-print`, `.rep-page`, `.rep-page-foot`, `.rep-section`, `.rep-position`, `.rep-decision`, `.rep-stub`, `.rep-meta`, `tr`): `display`, `break-before`, `break-after`, `break-inside`, and `.rep-page-foot`'s `margin-top` specifically, replacing a flex `auto` margin the print layout mode has already discarded.
- **The page box**, only on the bare `.rep-page` rule, mirroring `@page`'s own inset rather than resizing the sheet: `width`, `min-height`, `margin`, `padding`, `border`.
- **The wrapper reset**, only on the one rule whose entire comma-separated selector list is exactly `.shell, .work, .work-col, .col, .rep-wrap, .report-doc` - none of which the paginator measures directly - resetting viewport height and clipped overflow so a multi-sheet record does not silently print one screen's worth and stop. This is an EXACT match on that selector set, not a substring test: a compound selector built on top of `.report-doc` (`.report-doc .rep-section`, say) does not qualify, because it is reaching past the wrapper into a measured child. `.report-doc`'s own `--rep-*` custom properties (the token swap that re-lights the sheet for paper) are separately allowlisted by name, since a custom property consumed as a colour cannot itself be a metric.

The scope of what the test actually inspected used to be nothing: `expect(rules.length).toBeGreaterThan(5)` now pins that it examines a real, non-empty set of rules, so an extraction bug that finds the wrong `@media print` again fails loudly instead of passing on an empty loop.

The doc comment at the top of `report.tsx` currently argues the sheet is light on purpose. It becomes wrong and is rewritten: light is what paper is, dark is what the product is, and they are the same document.

---

## 4. QR

`qrcode-generator` — one file, no transitive dependencies, which is the specific objection `router.ts` raises about libraries. QR is a frozen ISO standard, and a wrong implementation fails loudly: the code does not scan. This is not a place a subtle bug hides quietly.

A `QrCode` component in `apps/deliberation/src/qr.tsx` emits **inline SVG**. Not canvas: the document is printed, and vectors stay sharp at any DPI.

**On screen**, a `.no-print` control on the report page: *Publish this record* reveals the URL and the QR; *Revoke* kills it.

**On paper**, when a link exists, a QR block prints onto the **cover sheet** beneath the decision, with the URL in readable text beside it for anyone who cannot scan. When no link exists the document carries no QR and no dead URL — a printed link that never worked is worse than none.

The QR block is a `Block` like every other, so the paginator treats it as indivisible and it can never be split across a page.

---

## Testing

**`share.ts`** — token derivation is stable for a version and different across versions; verification is timing-safe; a revoked row rejects its own token even before the version is considered; re-publishing after a revoke mints a token that differs from the dead one; a secret shorter than 32 bytes is refused at boot; an unset secret disables publishing without throwing.

**`access.ts`** — `canShare` is true for the owner and false for participants, outsiders, and every other role. Enumerated, as the file's own note requires.

**`server.test.ts`** — publish requires the convener (participant gets 403); the public route returns the report for a valid token; **no email appears anywhere in the public response body**, asserted over the serialised JSON rather than field by field; a revoked token 404s; a never-published case 404s; an un-adjudicated case 409s; the authenticated report still carries emails.

**`verdict-report.test.ts`** — `audience: "public"` strips every email and keeps every name, seat and position.

**`report.test.tsx`** — the QR block is absent when unpublished and present when published; it is a single block; the share controls carry `.no-print`.

**`app.css`** — the print-block metric invariant above.

**Manual, in a real browser** — publish a record, scan the printed QR with a phone, confirm it opens the public page; revoke; confirm the same QR now fails.

---

## Files

**New:** `services/api/share.ts`, `services/api/test/share.test.ts`, `apps/deliberation/public.html`, `apps/deliberation/src/public.tsx`, `apps/deliberation/src/qr.tsx`, `apps/deliberation/src/basis.ts`.

**Changed:** `services/api/access.ts`, `services/api/server.ts`, `services/api/verdict-report.ts`, `apps/deliberation/src/report.tsx`, `apps/deliberation/src/screens.tsx`, `apps/deliberation/src/api.ts`, `apps/deliberation/src/app.css`, `apps/deliberation/vite.config.ts`, `.env.example`.

**No container static-serving file, on this branch, at all.** A version of one was written for this task and removed before merge - see "The public surface" above for why, and `services/api/server.ts:74-91` for where it would go. It is PR #33's file to add, not this one's.

No Postgres files and no migration: see Storage above — that layer is not on this branch.

> **After the merge onto `main`:** the static serving arrived with PR #33 (`serveStatic`, behind `ARBITER_STATIC_DIR`) and was kept as it landed. `/r/:caseId/:token` was still **not** routed to `public.html` at that point, so a share URL 404'd on a deployed host — deliberately, for the two reasons then recorded beside `staticRoot()`. The Postgres files and the migration are listed in the Storage note above.
>
> **Closed in a later change.** `serveStatic` routes the share link, `tools/stage-site.mjs` reconciles the mount with the asset references, `apps/landing/vite.config.ts` proxies `/r/` under `npm run dev`, and `apps/deliberation/src/App.tsx` scopes its auto-sign-in credentials to `import.meta.env.DEV` so a built shell fails closed. New: `e2e/public-record.spec.ts`, `apps/deliberation/test/auto-signin.test.tsx`. Also changed: `playwright.config.ts` (a second project, against a built site), `e2e/one-origin.spec.ts`, `services/api/test/server.test.ts`, `README.md`, `.env.example`, `docs/HANDOFF-open-prs.md`. `apps/deliberation/src/pages.tsx` is untouched — its `AuthPage` had been sitting there exported and unreferenced since sign-in was removed, and the change to `App.tsx` is what makes it reachable again. See the note at the head of "The public surface".

## Risks

**The secret is new deployment state.** A deployment that sets `DATABASE_URL` but forgets `ARBITER_SHARE_SECRET` gets a product where publishing is off. That is the correct failure, and the boot banner already prints storage configuration — it prints sharing too, so the state is visible rather than discovered.

**Rotating the secret invalidates every published link at once.** Stated here because it will not be obvious later, and it is the right behaviour: the secret is the thing that makes every token unforgeable.

**A published record cannot be unpublished from paper.** Revocation kills the URL, not the copy somebody already printed or saved. The share control says so, in those words.
