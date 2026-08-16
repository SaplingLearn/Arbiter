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

## 3. The one piece of the design that is not built

**There is no top-level "Read" entry in the rail after Dashboard.** The user asked for
it and approved the "launcher" shape for it; it is not done.

It is blocked on nothing technical any more — the scene exists, which was the previous
blocker — but it needs a decision made in code:

- `NAV` entries bind to a `Route` (`shell/nav.ts:22`), and `read` requires a `caseId`.
  A menu entry has none.
- So it needs a **launcher route** — a `read` landing page with no case, listing cases
  and their documents, that jumps into `{ name: "read", caseId, documentId }`.
- Then a `NAV` entry between Dashboard and New case, and `currentNav` updated: today
  `read` lights the Library (`shell/nav.ts:126`) precisely because it has no entry of
  its own. That comment is the marker for this work.

**Do not do this by index.** `currentNav` used `NAV[2]` and `NAV[0]` until an entry was
inserted second; that moved Library from 2 to 3 and would have lit the wrong rail entry
on every case route, silently, because an index that still resolves does not throw. It
is `navByScene(...)` now. Keep it that way.

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
- **The upload gate rejects toy PDFs with a 422 `unreadable`** — `documents.ts:173`,
  measured by `data/prep/measure_pdf.py`. A 1-page placeholder does not get in; the
  fixture that did was 4 pages of real toxicology prose. Read the measurement code
  before building a fixture rather than guessing at what will pass, and note the
  comment at `documents.ts:114` — this gate was deliberately tightened after a version
  that let "probably fine" through.
- **Run the scene and look at it.** The previous handoff said this and it earned its
  place three times over in one session: typecheck, lint and the full suite all passed
  on a scene that rendered nothing at all.

---

## 6. Commands

```bash
npm install                    # first, always, after any pull
npm run check:deps             # after PR #24 — says what npm install would fix
npm run dev                    # http://localhost:5173/deliberation/
npx vitest run                 # 821 tests / 58 files here; 829 / 59 once #24 lands
npm run typecheck
npm run lint

# the scene, in isolation
npx vite --config apps/atmosphere/vite.config.ts --port 5187
ATMOSPHERE_URL=http://127.0.0.1:5187/ node apps/atmosphere/shot.mjs shots
```

## 7. State at handoff

- 821 tests / 58 files, typecheck clean, lint clean, on `652adf5` + this document.
  (829 / 59 on PR #24, which adds eight tests of its own.)
- PR #22 — this branch → `main`, open.
- PR #24 — `fix/dev-dependency-preflight` → this branch, open, **merge first**.
- PR #23 — the reading-trails phase 1 record, merged to `main`.
- Design and plan: `docs/superpowers/specs/2026-08-15-reading-trails-design.md`,
  `docs/superpowers/plans/2026-08-15-reading-trails-phase-1.md`. Task 8's body in the
  plan is marked SUPERSEDED where it teaches the filename join — see §2.2 above.
