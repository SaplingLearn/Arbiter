# Handoff — the reading surface and its environment

Written 2026-08-16, for whoever picks this up. Branch `feat/product-in-the-atmosphere`,
PR #22. Sibling to `HANDOFF-evaluation.md`, which was written the same day from a
different session on this same branch — that one owns the numbers, this one owns the
reading surface, the scene behind it, and the dev-server preflight.

**Before anything else:** `HANDOVER.md` records the submission as due **16 Aug 2026**,
which is the day this was written. Confirm what is actually still open before starting
anything with a long runway. Everything below is scoped so it can be stopped after any
one item.

---

## 1. Do this first

**PR #24 is open against this branch and is not merged.** It is small, tested, and it
fixes a failure that has already cost one round trip and will cost another on the next
machine. Merge it before doing anything else on this branch.

What it fixes: opening a document in Read & mark threw

```
[plugin:vite:import-analysis] Failed to resolve import "pdfjs-dist"
from "src/read.tsx". Does the file exist?
```

Nothing was wrong with `read.tsx`. `pdfjs-dist` is declared by `apps/deliberation` and
recorded in `package-lock.json`; it was simply not installed, because that checkout's
`node_modules` predated the merge that added it. The overlay names a correct file, a
correct line, and a correct import, and asks whether a file nobody wrote exists — every
fact in it points away from the cause.

The trigger is not that package. It is **any `npm install` older than the last
dependency added on any branch**, which is every collaborator after every pull. So the
fix is a preflight (`tools/check-deps.mjs`), wired into `npm run dev` in-process before
a single server spawns, into `deliberate:dev`, and standalone as `npm run check:deps`:

```
Dependencies on disk do not match the manifests:
  - pdfjs-dist (4.10.38) declared by @arbiter/deliberation — not installed

  Fix:  npm install
```

**If you hit that vite overlay before merging #24, the answer is `npm install`. It is
never `read.tsx`.**

---

## 2. What is on this branch and working

### Read & mark — the second case stage

A tab between Evidence and Your position (`apps/deliberation/src/Layout.tsx:130`) that
renders a case's PDFs and draws what extraction already found on top of them.

| Piece | File |
|---|---|
| Route `read` / `:caseId` / `:documentId?` / `:page?` | `apps/deliberation/src/router.ts` |
| The screen and the pdf.js viewer | `apps/deliberation/src/read.tsx` |
| Reviewer badge, initials, seat colour | `apps/deliberation/src/Reviewer.tsx` |
| Stable per-person seat allocation | `services/api/seats.ts` |
| `GET /api/cases/:caseId/documents/:documentId/raw` | `services/api/server.ts:398` |
| Seat tokens `--seat-0..5` | `apps/deliberation/src/app.css:117` |

26 tests in `apps/deliberation/test/read.test.tsx`, plus `Reviewer.test.tsx` and
`theme.test.ts`.

**Three things in here are load-bearing and easy to break:**

1. **Seats are stored, not derived.** The first design took a person's colour from their
   index in `participantIds`. That is a sorted set, so adding anyone to a case
   re-coloured everyone below them — every existing highlight silently changed
   attribution. `seats: SeatMap` is persisted on the case and `removeParticipant`
   *retains* the entry, so a colour is never reissued to a different person.

2. **`sourceDocumentId` is the join, not the filename.** `read.tsx:27` matches on the id
   first and falls back to the filename only for findings whose extraction predates the
   id. Real finding data holds `"FDA NDA 211810"` and `"EMA/CHMP/290491/2025"` in
   `sourceDocument` while the file on disk is `turalio-211810-multidiscipline.pdf` — a
   filename join matches nothing and shows an empty page that looks like a rendering
   bug. **Do not add fuzzy matching here.** A wrong highlight on a safety document is
   worse than an honest empty state.

3. **Blindness is server-side.** Positions stay hidden before reveal because the API
   does not return them (`visibleTo`), not because the client hides them. Any new
   reading-surface endpoint has to go inside the same `can(kase, user.id, "read")`
   guard, or the blind stage stops meaning anything.

### SECTION — the scene behind reading

`packages/atmosphere/src/scenes/section.ts`, registered second in
`scenes/registry.ts` (after Culture), id `read`, codename **Section**.

A stained tissue section held in depth with a focal plane travelling through it. Bodies
resolve as it passes and swell into soft out-of-focus discs on either side; ~7% stay
faintly lit out of focus so you catch them coming. The argument is in the file header
and is worth keeping if the scene is ever replaced: reading a 288-page review for the
few passages that decide a case *is* a dense body of material, mostly illegible at any
moment, with a narrow band where things resolve — and preclinical hepatotoxicity is
literally read off stained sections.

`sceneFor()` (`apps/deliberation/src/shell/nav.ts:65`) sends `read` here. It is the one
case route that leaves the Archive, because its subject is one document rather than the
case among its neighbours.

---

## 3. The reading room — BUILT, and what it turned up

**Done.** There is a top-level Read entry in the rail, second, between Dashboard and
New case, and a launcher behind it.

| Piece | File |
|---|---|
| Route `{ name: "reading" }` at `#/read` | `apps/deliberation/src/router.ts` |
| The page | `ReadingRoom` in `apps/deliberation/src/read.tsx` |
| `NAV` entry (`Read` / `Section` / `read`) | `apps/deliberation/src/shell/nav.ts` |
| Document row styling | `app.css`, `a.inv-row` |

It lists **documents, not cases** — each is its own link straight to
`{ name: "read", caseId, documentId }`. A launcher that stopped at the case would land
everyone on `documents[0]` and make them pick again, which is what the case reader
already does. Only cases whose `CaseListing.documents` count is non-zero are fetched,
and the ones skipped are counted at the foot rather than dropped.

`read` is a **separate route name from `reading`** on purpose: `read` carries a `caseId`
in its type and a lot of this app narrows on that fact. See the comment in `router.ts`.

**Do not do this by index.** `currentNav` used `NAV[2]` and `NAV[0]` until an entry was
inserted second; that moved Library from 2 to 3 and would have lit the wrong rail entry
on every case route, silently, because an index that still resolves does not throw. It
is `navByScene(...)` now. Keep it that way. An entry HAS now been inserted second and
nothing moved, which is the lookup doing its job.

### Three bugs this uncovered, all pre-existing, all invisible to the suite

Every one was found by running the product and looking at it, which is what §5's last
bullet has been saying.

1. **The product could not draw its own reading scene.** `Backdrop.tsx` registered
   scenes with five hand-written `atmo.register(...)` lines and `createSection` was
   never among them, so `transitionTo("read")` threw `unknown scene "read"`. The throw
   was in an effect *outside* the mount try/catch, so React unmounted the whole tree:
   opening Read & mark blanked the product. It now registers from `STATES`, so the
   copy is gone rather than corrected.

2. **The viewer had never loaded a PDF.** pdf.js does not go through `api.ts`; handed a
   bare URL it makes its own request, which carried no `Authorization` header, and
   `/raw` is behind the same `can(..., "read")` guard as everything else — so it
   answered **401** every time. `getDocument` now takes `{ url, httpHeaders }`. The
   tests could not see this: `read.test.tsx` mocks pdf.js so no request is made, and
   `server.test.ts` calls `/raw` *with* a header. Neither covered the only thing the
   product actually does.

3. **The record lit the wrong rail entry.** `record` was not in `currentNav`'s
   case-route branch, so it fell to the `dashboard` fallback and the rail read CULTURE
   over the Helix. Nothing threw, because a fallback is a legitimate answer.

`apps/deliberation/test/nav.test.ts` is new and exists for this class: it checks the
rail against the real scene registry, and asserts every route names a scene that
exists — which is exactly the condition for the backdrop not throwing.

**`apps/deliberation/shot.mjs` had its own copy of the route list too**, and did not
include `read`. Same trap as its sibling, one level up. Fixed; keep it in step with
`NAV`.

---

## 4. Open design decision, for a human

The seat palette (`app.css:117`) was re-fitted from a rainbow to this branch's blue
wedge, which the branch's design rule requires. The consequence, stated rather than
buried: **seats now separate mostly by lightness**, and seats 3–5 (`#93B2F5`, `#B3CBF9`,
`#CFE0FB`) are close at badge size. Six people on one case is the worst case and it is a
supported one.

The three ways out are all design-system calls, not code calls:

1. Accept it — badges also carry initials and an `aria-label`, so colour is not the only
   channel.
2. Let seats vary in saturation as well as lightness inside the wedge.
3. Break the wedge for seat identity specifically, and say so in the design doc.

`theme.test.ts` currently asserts every seat is blue-dominant (`b > r && b >= g`) and no
two are equal. Option 2 keeps that test; option 3 changes it deliberately.

---

## 5. Gotchas already paid for

- **The demo store used to be stocked from a TEST FIXTURE, under real filenames.**
  Every document in `results/documents` was output from `readablePdfBytes()` in
  `services/api/test/server.test.ts` — the same four sentences on every page with the
  page number swapped, written to clear the gate's vocabulary floors and nothing else —
  filed under names like `turalio-211810-multidiscipline.pdf` that name real FDA
  reviews. It is a fine test fixture and it was indefensible as demo content: the
  reader looked like it was rendering regulatory reviews and was rendering a
  keyword-stuffed stub. `npm run seed:documents` now fetches the real reports from EMA
  and puts each one through `measure_pdf.py` before uploading it. **If the reader ever
  shows a page reading "Page N of the nonclinical toxicology review", the fixture is
  back.**
- **`accessdata.fda.gov` refuses scripted clients.** Every path — not just the large
  ones — is answered with a 420-byte Akamai abuse-detection page, which will happily
  save itself as a `.pdf` and fail much later as a corrupt document. The FDA reviews
  this project is built on therefore cannot be fetched by any script here that is not
  pretending to be a browser; they are listed as `manual` at the end of
  `seed-demo-documents.mjs` with their URLs. That script checks for the `%PDF-` magic
  bytes on every download for exactly this reason. `data/prep/README.md` set the
  precedent for the DILIrank workbook: asking a human to click once beats a script that
  saves an error page.
- **`apps/atmosphere/shot.mjs` carries its own copy of the scene list.** It silently
  skipped `read` when that scene was added and reported "no console errors" about a
  scene it had never mounted. Add new scenes to that list too.
- **`shot.mjs` attaches to a server it does not start**, on port 5180. If your own dev
  server is not the one holding that port, the probe screenshots *someone else's
  checkout* and reports success. Set `ATMOSPHERE_URL` to your own port.
- **Do not use `PALETTE.reflex` as an out-of-focus or base colour.** The palette file
  describes it as a silhouette value barely above ground. SECTION's first pass used it
  and the scene rendered completely invisible while compiling, typechecking and
  probing clean.
- **`pdfjs-dist` is pinned to exactly `4.10.38`.** 5.x and 6.x require Node ≥ 22.13 and
  crash on Node 20, which is what this repo runs. `check-deps.mjs` version-checks exact
  pins for this reason; a stale hoisted 5.x satisfies a directory check and then fails
  at runtime talking about something else.
- **`services/api` shells out to Python on the upload path**, and a runner without
  PyMuPDF answers *every* upload with `422 unreadable`. CI had no Python step at all,
  so it went red the moment Read & mark landed and stayed red through three commits —
  on two tests that pass on any machine that has ever run the data prep. `ci.yml` now
  installs `pymupdf==1.28.2`. If you add a server path that shells out to a script
  needing more than `fitz`, that list has to grow.
- **The upload gate rejects toy PDFs with a 422 `unreadable`** — `documents.ts:173`,
  measured by `data/prep/measure_pdf.py`. A 1-page placeholder does not get in; the
  fixture that did was 4 pages of real toxicology prose. Read the measurement code
  before building a fixture rather than guessing at what will pass, and note the
  comment at `documents.ts:114` — this gate was deliberately tightened after a version
  that let "probably fine" through.
- **The e2e suite cannot run on Windows.** `playwright.config.ts` starts its server
  with POSIX `VAR=x cmd`, which is a parse error in this shell. CI is the only place
  these five tests have ever run — which is how they went stale unnoticed.
- **`npm run seed:demo` is a prerequisite, not a demo convenience.** The product no
  longer asks anyone to sign in (`App.tsx:195`); it signs itself in as
  `r.okafor@arbiter.demo`, and that account exists only after seeding. Without it the
  app renders "Cannot open the record" and looks like a routing failure.
- **`apps/landing/src/sections/Header.tsx` is dead code that still compiles.** The
  redesign mounts `shell/Chrome.tsx`'s `Header` instead. Reading the wrong one cost
  real time chasing a visibility bug that did not exist — check `Overture.tsx` for
  what is actually mounted before trusting anything under `sections/`.
- **Run the scene and look at it.** The previous handoff said this and it earned its
  place three times over in one session: typecheck, lint and the full suite all passed
  on a scene that rendered nothing at all. It then earned it three more times — see
  §3. A blanked product, a viewer that had never once loaded a PDF, and a rail naming
  the wrong world were all sitting behind a green suite, and all three were obvious
  within a minute of opening the page.
- **`npm run dev` binds 8787, 5274 and 5173 with `--strictPort`.** A stale API from an
  earlier session holds 8787 and the whole stack refuses to start; `ARBITER_PORT` moves
  only the public port, so it does not help. Find the owner
  (`Get-NetTCPConnection -LocalPort 8787`) before assuming it is yours.
- **Seeding accounts is not seeding cases.** `npm run seed:demo` creates the five
  people and nothing else, so the reading room correctly says "No cases yet" on a fresh
  checkout. To see it with data, open a case and upload through the real routes — the
  upload gate measures every file, so the PDF has to be four-plus pages of genuine
  toxicology vocabulary. `readablePdfBytes` in `services/api/test/server.test.ts`
  builds one that passes.

---

## 6. Commands

```bash
npm install                    # first, always, after any pull
npm run check:deps             # after PR #24 — says what npm install would fix
npm run dev                    # http://localhost:5173/deliberation/
npm run seed:demo              # the five accounts. NOT the cases, and not the documents
npm run seed:documents         # the real EMA reports, gate-checked, onto the demo cases
npx vitest run                 # 821 tests / 58 files here; 829 / 59 once #24 lands
npm run typecheck
npm run lint

# the scene, in isolation
npx vite --config apps/atmosphere/vite.config.ts --port 5187
ATMOSPHERE_URL=http://127.0.0.1:5187/ node apps/atmosphere/shot.mjs shots
```

## 7. State at handoff

- **875 tests / 60 files**, typecheck clean, lint clean, `deliberate:build` clean, and
  `apps/deliberation/shot.mjs` reports no console errors on all five surfaces. This is
  after the reading room (§3), which adds `nav.test.ts` and `readingRoom.test.tsx`, and
  after the viewer work below. (Was 821 / 58 before it; PR #24 adds eight more of its
  own on top.)
- **The viewer rasterises to the column and to the device.** It painted at a fixed
  scale of 1.4 and let `max-width: 100%` resample the result, so the page was soft on
  every display and squashed out of its aspect ratio on a narrow one. It now measures
  its column with a `ResizeObserver`, paints at `fit × devicePixelRatio`, and sets the
  CSS box explicitly in both dimensions. The four guards are in `read.test.tsx` under
  "the page raster" — they only work because the canvas is sized BEFORE `getContext` is
  asked for, since jsdom has no 2d context and the paint returns early.
- **A 144-page document can be read past page 1.** There was no pager at all: the only
  route to any page but the first was a finding in the rail that happened to cite one.
  The controls are links through the existing `:documentId/:page` route, so a page is
  shareable and the back button works, and they sit ABOVE the canvas because a page
  fitted to the column is taller than the window.
- **Local `npx vitest run` needs PyMuPDF**, or two `beforeAll` hooks in
  `server.test.ts` fail with `fixture: 422` and take nine tests down with them — the
  §5 bullet about Python, seen from a laptop rather than from CI. `pip install
  pymupdf==1.28.2`, the same pin `ci.yml` uses.
- **CI is green on this branch, for the first time.** It had been red since Read & mark
  landed, and it took four separate causes, none of them visible from a local run:
  no Python on the runner (so every upload 422'd); no `seed:demo` (so the product could
  not boot at all and every e2e assertion about it was really an assertion about a
  failed login); an e2e test still waiting for a sign-in button the redesign
  deliberately deleted; and a landing assertion written against a header that is no
  longer mounted. The Preloader also ignored `prefers-reduced-motion`, which is fixed
  in the component rather than worked around in the test.
  **Local green never implied CI green here. Check `gh pr checks 22`.**
- PR #22 — this branch → `main`, open.
- PR #24 — `fix/dev-dependency-preflight` → this branch, open, **merge first**.
- PR #23 — the reading-trails phase 1 record, merged to `main`.
- Design and plan: `docs/superpowers/specs/2026-08-15-reading-trails-design.md`,
  `docs/superpowers/plans/2026-08-15-reading-trails-phase-1.md`. Task 8's body in the
  plan is marked SUPERSEDED where it teaches the filename join — see §2.2 above.
