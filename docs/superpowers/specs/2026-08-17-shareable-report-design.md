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

---

## 2. The public surface

A second Vite entry — `apps/deliberation/public.html` and `src/public.tsx` — importing `report.tsx`, `@arbiter/design` and `app.css`.

It does **not** import `App.tsx`, the authenticated api client, or `screens.tsx`.

This is the whole security argument, and it is structural rather than conditional. `App.tsx` authenticates on load from `AUTO_EMAIL` / `AUTO_PASSWORD`. A public route inside that shell would sign its visitor in, and the only thing preventing it would be a boolean somebody has to keep remembering. A separate entry cannot sign anybody in, because the code that signs people in is not in the bundle.

**One cleanup this forces.** `report.tsx` imports `basisOf` from `screens.tsx`, which would drag the authenticated screens into the public bundle. `basisOf` is a pure function about positions, not about screens; it moves to `apps/deliberation/src/basis.ts` and both import it from there.

The public page renders the same sheets with the same pager, without the share controls or the "Back to the verdict" link.

Served at `/r/:caseId/:token`. In development Vite serves both entries; in a container the static handler resolves `/r/*` to `public.html`.

---

## 3. Palette

`.report-doc` takes its colours from CSS custom properties, dark by default, re-lit inside `@media print`.

Same DOM, same block list, same paginator. Pagination cannot diverge from the preview because there is only one of it.

### The invariant

**The print stylesheet may change colour and nothing else.**

No `font-size`, `line-height`, `padding`, `margin`, `width`, `border-width` or `letter-spacing` may differ between screen and print inside `.rep-*`. Those feed the measurement pass in `Paginate`, and changing one is exactly how a preview starts lying about where pages break — the failure PR #30 built the paginator to prevent.

This is enforced, not merely documented: a test parses `app.css`, extracts the `@media print` block, and fails if any rule targeting a `.rep-*` selector sets a property outside the colour allowlist (`color`, `background`, `background-color`, `border-color`, `box-shadow`, `fill`).

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

No Postgres files and no migration: see Storage above — that layer is not on this branch.

## Risks

**The secret is new deployment state.** A deployment that sets `DATABASE_URL` but forgets `ARBITER_SHARE_SECRET` gets a product where publishing is off. That is the correct failure, and the boot banner already prints storage configuration — it prints sharing too, so the state is visible rather than discovered.

**Rotating the secret invalidates every published link at once.** Stated here because it will not be obvious later, and it is the right behaviour: the secret is the thing that makes every token unforgeable.

**A published record cannot be unpublished from paper.** Revocation kills the URL, not the copy somebody already printed or saved. The share control says so, in those words.
