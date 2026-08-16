# Reading Trails — attributed PDF marks as the middle layer of the record

**Status:** design, approved in conversation 2026-08-15. Not yet planned or implemented.
**Supersedes:** nothing. **Depends on:** `services/api/deliberation.ts`, `services/api/store.ts`,
`services/api/inventory.ts`, `apps/deliberation`.

---

## 1. The problem this solves

ARBITER records the **conclusion** of a reading: a position, the findings it cites, and a
signature, hash-chained so none of it can be rewritten afterwards.

It does not record **the reading**. Between "here is a 288-page FDA multidiscipline review"
and "I call do-not-advance, citing F3" there is a person going through a document, and
nothing in the system holds any trace of that passage. The README states the failure this
project exists to prevent:

> the reasoning that produced the answer is not recoverable six months later when a
> regulator, or a colleague, asks why.

Today the recoverable unit is a page number on a finding. That is a citation, not
provenance. A regulator asking "what did your reviewers actually look at" gets an answer
assembled from memory.

The marks a reviewer makes while forming a position are that missing layer. This design
records them, seals them under the same gate as positions, and — critically — attributes
every one of them to an account, so the collective views are readable as *people who
disagreed* rather than as anonymous heat.

**What this is not.** It is not a comment sidebar. A generic comment box bolted onto a PDF
adds nothing to this system and costs it the blind-submission property. Every element below
either feeds existing machinery (`inventory`, `disagreementReport`, `unanimityCheck`, the
experiment planner) or is cut.

---

## 2. The unit: a Mark

```ts
export type MarkKind = "highlight" | "note" | "question" | "challenge";

export interface Mark {
  id: string;
  caseId: string;
  documentId: string;
  page: number;
  /** Word-index span into that page's extracted text (`results/**/*.pages.json`).
   *  Word indices, not character offsets: the extracted text carries hard newlines
   *  mid-sentence, so character offsets are brittle against any re-extraction. */
  span: { start: number; end: number };
  /** The exact text as it read when marked. FROZEN. A later re-extraction that
   *  shifts indices must not be able to silently change what somebody highlighted;
   *  if `quotedText` no longer matches the span, the mark renders as orphaned and
   *  says so, rather than pointing confidently at different words. */
  quotedText: string;
  authorId: string;
  kind: MarkKind;
  /** Empty for a bare highlight. Required for the other three kinds. */
  body: string;
  createdAt: string;
  /** Set when the author promotes this mark into an approved, citable finding. */
  promotedFindingId?: string;
  /** Sealed with the author's position; released at reveal. Null while private. */
  sealedAt: string | null;
}
```

### 2.1 Why four kinds and not a free-text comment

The kinds are not decoration. They are routing.

| Kind | The act | Where it goes |
|---|---|---|
| `highlight` | "this is load-bearing for me" | attention rail, stacked page view |
| `note` | "here is how I read it" | stacked page view, reveal |
| `question` | "I cannot tell what this means" | **the inventory, as a gap** |
| `challenge` | "the study does not support this" | **the adjudicator, as contested evidence** |

`externalClaimsAsGaps` in `deliberation.ts` already performs exactly this move for external
claims — an assertion made outside the case documents becomes an item on the missing-evidence
list rather than evaporating. A `question` mark is the same routing with a page anchor
attached, which makes it strictly better: the gap it raises points at the sentence that
raised it.

A single untyped comment field cannot be routed, so it would sit in a sidebar and decay.

---

## 3. Identity: which account, its icon, its colour

Every mark is attributed on screen to the account that made it. Three requirements, in
priority order: the attribution must be **unambiguous**, **reproducible six months later**,
and **not carried by colour alone**.

### 3.1 Seats, not hashes

Each participant on a case holds a **seat** — a small integer — and the seat determines the
colour.

The obvious implementation is `hash(participantId) % paletteSize`. It is rejected: hashing
collides, and two reviewers rendering in the same amber on the same reveal screen is the one
failure this feature cannot have. Distinctness within a case is the whole requirement.

Seats are therefore **allocated, not derived**: the lowest unused seat index is assigned when
a participant joins, and recorded in the `participant_added` log entry that already exists in
`LogKind`. Three consequences, all wanted:

- **Distinctness is structural.** Two participants on one case cannot share a seat.
- **Stability.** A seat is assigned once. Adding a fifth reviewer in week three does not
  reshuffle the four colours everyone has already been reading.
- **Reproducibility.** The colours are recoverable from the audit chain alone. Someone
  replaying the log in 2027 renders the same reveal screen this room saw, without needing
  the database. That is the same property the ruleset hash and the deterministic engine
  exist to provide, applied to the record's presentation.

A seat is released on `participant_removed` but **never reissued** within a case. Reissuing
would let a departed reviewer's amber marks and a new reviewer's amber marks coexist on one
page, which is precisely the ambiguity seats exist to prevent.

Owners who are not also participants get no seat. `access.ts` is explicit that "an owner who
is not also a participant convenes and signs but does not hold an opinion on the record" —
such a person makes no marks, so there is nothing to attribute.

### 3.2 The palette, and the three colours it may not use

`apps/deliberation/src/app.css` has already spent its primary colours on meaning:

| Token | Value | Reserved for |
|---|---|---|
| `--stop` | `#ff8a8e` | the do-not-advance verdict |
| `--go` | `#55c97f` | the advance verdict |
| `--accent` | `#4fc3ff` | UI chrome, and here: **system highlights** from extracted findings |

A reviewer palette that reaches for red, green or cyan makes a person's colour read as a
call. On a screen whose entire purpose is showing who called what, a reviewer rendered in
`--go` green would be actively misleading. The reviewer palette is therefore drawn from the
remaining hue space — amber, violet, magenta, teal-leaning-blue, orange, lilac — at a
chroma that survives on `--app: #020a18` and as a ~22% alpha wash behind body text.

Seat colours are defined as tokens (`--seat-0` … `--seat-7`) with a matching
`--seat-N-wash`, following the existing `--stop` / `--stop-wash` / `--stop-line` idiom
rather than inventing a second convention.

Eight seats. A ninth participant is a real case, and it renders in a neutral `--open` grey
with the initials badge doing the identification. Cycling the palette to give seat 8 the
same amber as seat 0 would break distinctness, which is the one property that may not bend.

### 3.3 The icon, and why colour is never alone

Roughly one man in twelve has a colour-vision deficiency. A room of preclinical
toxicologists will contain one, and the reveal screen is the screen that matters most.
Identity is therefore carried on **three independent channels**, and any two suffice:

1. **Initials** — the primary, literal identifier. `initials()` already exists at
   `apps/deliberation/src/Layout.tsx:12`; it strips parentheticals, splits on whitespace and
   dots, takes two letters and falls back to `?`. Reused as-is, not reimplemented. The name
   behind it resolves through the existing `nameOf(participantId)` helper in `screens.tsx`.
2. **Colour** — the seat token, for fast scanning of a dense page.
3. **Seat order** — every stack of reviewers, everywhere in the app, is ordered by seat.
   Seat 2 sits in the same slot on the rail, on a merged span band, and in the reveal list.
   Position is legible at 1px where two letters of mono type are not, and it costs no new
   visual vocabulary.

Where two participants on one case produce the same initials, the badge appends the seat
numeral (`JC·2`). Checked at seat allocation, so it applies to both colliding badges rather
than to whoever joined second.

**No uploaded avatars, and no generated identicon.** `User` in `services/api/auth.ts` carries
`id`, `email`, `displayName` and `signatureMethod`, and this design adds no image field:
uploads mean storage, moderation, a default-avatar path and a new class of PII in a system
whose data is regulatory. A generated identicon avoids all of that but fails a different
test — the design language forbids it. BLUEPRINT sets `--r-sm/--r/--r-lg: 0px` globally, and
`pages.tsx` states outright that it "has no pills, no tinted clouds and no avatars." A
procedural glyph is exactly the decorative flourish that language rejects, so the third
channel is seat order instead: austere, structural, and already implied by the sort.

The badge is one component, `<Reviewer id=… />`, used everywhere a person is named — the
roster, the waiting list, each revealed position, each mark, the rail legend and the audit
log. One component is what makes a colour learnable at all.

It extends the existing `.avatar` rule (`app.css:225`: 30px square, 6px radius, mono 12px)
with a seat modifier. Note that `.avatar` is currently tinted `--accent-wash` / `--accent` /
`--accent-line`, which **collides with the cyan reserved for system highlights in §3.2**.
The resolution: the bare `.avatar` stays accent-tinted for the signed-in user in the header
chrome, where no reviewer attribution is in play, and `<Reviewer>` always applies a seat
modifier that re-tints all three properties. A reviewer badge is never rendered in accent.

### 3.4 What identity may leak before the reveal

Seat colours and badges are visible from the moment a case opens. That is safe: they are
identity, not position, and the roster is already public — `visibleTo` returns
`others: { participantId, submitted }` while the case is open, so who is on the case and
whether they have answered is deliberately not secret.

**What must not appear before the reveal is any per-person mark activity.** "Alice — 14
marks" is a confidence signal, and a running signal of how hard someone is working is
exactly the kind of drag `visibleTo`'s comment rejects when it refuses to return a running
tally of calls. The rule:

> Before the reveal, a reviewer badge carries identity and submitted-or-not, and nothing
> else. Mark counts, page coverage, rail shading and every other aggregate appear only
> once `status !== "open"`.

Enforced the same way blindness is enforced everywhere in this system: the aggregate
endpoints do not return the data while the case is open. Not by hiding it in the client.

---

## 4. Where it lives: a case tab of its own

### 4.1 The tab

`Steps` in `Layout.tsx` renders the case stages, and its comment is emphatic that "the order
IS the product". A new tab therefore has to earn a position in that sequence rather than be
appended to the end of it.

**"Read & mark" is inserted second, between Evidence and Your position.**

| # | Tab | What it is for |
|---|---|---|
| 1 | Evidence | what is on this case: findings, documents, what is absent |
| 2 | **Read & mark** | **the documents themselves, and your passage through them** |
| 3 | Your position | your call, written before you can see anyone else's |
| 4 | Reveal & verdict | the split, the disagreement, the adjudication |
| 5 | Record | sign-off and the hash-chained log |

That position is the argument for the tab. Evidence lists what exists; Read & mark is where
you engage with it; Your position is where you commit. Read-then-decide is the order the work
already has, and the strip currently skips it — today a reviewer goes from a list of documents
straight to a verdict form, and the reading happens off-system. Inserting the stage makes the
sequence describe the actual job rather than the parts of it the software happened to hold.

`enabled: true` at every case status. Unlike Reveal, this tab is never gated: reading is
legitimate before you seal, and after the reveal it becomes the screen where the room's trails
are compared. What changes with status is what it *shows*, never whether it opens.

Its pip carries the viewer's **own** mark count. Own activity is not an aggregate over other
people, so this does not violate §3.4 — you already know how much you have marked. No pip
renders another reviewer's count while the case is open.

### 4.2 The route

`Route` gains one member, and deep-linking is not optional:

```ts
| { name: "read"; caseId: string; documentId?: string; page?: number }
```

`#/case/:caseId/read` → `#/case/:caseId/read/:documentId/:page`

Deep links are what make the collective views usable at all. A `contestedSpans` row on the
reveal screen is a claim about one specific sentence, and it has to be one click from that
sentence — otherwise the reader is hunting page 112 of a 288-page review by hand, and will not
bother. The same applies to a `question` mark surfaced on the missing-evidence list, and to a
citation read back out of the audit record.

`parseHash` extends the existing `case`/`:id` switch. A malformed or unknown sub-route keeps
falling through to the case overview, which the router already does deliberately rather than
404ing.

### 4.3 A document belongs to a case

The viewer reads `documents.forCase(caseId)` — already present at
`services/api/documents.ts:155` — and nothing else. Documents are stamped with `caseId` at
upload, so this enforces a binding the store already has rather than inventing one.

The consequence worth stating plainly: **the shared library under `results/library/` is not
readable in this tab.** A mark means "this reviewer, reading the evidence for this case,
stopped here." A mark against a document that is not on the case cannot mean that. Every
aggregate in §6 counts reviewers across one case's documents, and admitting a library PDF
would quietly mix a document nobody on the case was asked to read into a rail that claims to
describe how this case was read.

A `Mark` therefore carries both `caseId` and `documentId`, and the server rejects any mark
whose `documentId` does not resolve through `forCase(caseId)`. The same PDF uploaded to two
cases is two `StoredDocument` rows with two ids, so its marks stay separate — which is
correct. Those are two different rooms reading it for two different questions.

---

## 5. Per member, stage by stage

### Stage 1 — Read & mark (case `open`)

The reviewer opens a case document — one of `documents.forCase(caseId)`, never a library
document (§4.3) — and marks it freely. **Every mark is private to its author**, returned by
no endpoint to anyone else, enforced server-side.

What the reviewer does see besides their own marks: the existing findings, rendered as
**system highlights** in `--accent` cyan — visually a different class of object from any
person's mark. These come from `sourceDocument` and `sourcePage`, which are already populated
on every finding in all three cases in `data/cases/`. So the document arrives pre-annotated
with what extraction already found, and the reviewer's task reads as *what did this miss,
and what did it read wrongly* rather than as an unaided pass over 288 pages.

### Stage 2 — Your position

The reviewer's own marks appear beside the position form as a working set, grouped by
document and page.

Citation is unchanged. `citedFindingIds` remains a selection against approved findings, and
marks do not become a second citation channel. The comment on `Position.citedFindingIds` is
load-bearing and this design does not weaken it: a typed citation "would have to be run
through a model to decide whether it referred to anything real, and then a model is
gatekeeping dissent."

Two additions:

- **Promote a mark to a finding.** A reviewer who finds something real on page 200 currently
  has no path to make it citable — findings arrive from `data/prep` upstream. Promotion
  submits the mark as a candidate finding carrying its document, page and quoted text; the
  owner approves it; it becomes an ordinary finding with an id, and is then citable by
  *anyone*, including reviewers who would use it to argue the opposite call. Approval is the
  existing human-signature step that `inventory.ts` already requires for declared coverage.
- **Uncited marks still seal and still release.** "I highlighted this and did not rest my
  position on it" is information about a reading, and discarding it would make the trail a
  record only of what was convenient.

**On submit, marks seal atomically with the position.** A new `LogKind`, `marks_sealed`,
whose payload is the **hashes** of the sealed mark set and their count — not the mark
bodies. Two reasons: the log stays small against a reviewer who makes 200 marks, and the
chain still proves exactly what that reviewer had marked at the instant they sealed. A mark
cannot be back-dated into the record, and a mark cannot be quietly edited after the reveal
without breaking its hash. The reading trail becomes as tamper-evident as the position it
supports, which is the property that makes it evidence rather than decoration.

After sealing, a reviewer's own marks are frozen. New marks made post-reveal are a separate,
clearly-labelled class (§7).

### Stage 3 — Reveal

Everything unseals at once, on the existing gate. Marks sort by seat, so the layer order on
a page is stable across every screen and every reviewer's browser — the same argument that
makes `visibleTo` sort `revealed` by participant id rather than by submission time.

---

## 6. What the room sees collectively

### 6.1 The attention rail

A strip representing the whole document, one band per page, each band divided into segments
coloured by the seats of the reviewers who marked that page. Three readings, all currently
invisible:

- **Many seats on one band — converged attention.** Several reviewers independently stopped
  at the same page. Because it was reached blind, this is materially stronger evidence that
  the page matters than the same agreement reached in a meeting.
- **One seat alone — a solo read.** The highest-value signal in the feature. It is either the
  one person who found the thing or the one person down a rabbit hole, and the room cannot
  tell which without looking. Today it cannot even tell that it happened.
- **An unmarked stretch over pages the inventory calls `present`.** This sharpens a concern
  `unanimityCheck` already emits. It currently says *"Present in the documents and cited by
  nobody"*. With trails it can say *present, cited by nobody, and no reviewer's trail ever
  reached that page* — a different and much worse fact about the room, and one the current
  model cannot distinguish from evidence that was read and consciously set aside.

The rail is attributed, not anonymous heat: hovering a band names the reviewers, and the
legend is the same `<Reviewer>` badge used everywhere else.

### 6.2 The stacked page

Any page renders every reviewer's marks layered, each in its author's seat colour, with a
badge in the margin per mark. Spans that overlap collapse into a single band annotated with
the badges of everyone who marked it.

This produces the screen the feature is for: **two reviewers highlight the same sentence and
reach opposite calls.** `disagreementReport` can already say that finding F3 is `contested`.
With trails it says: F3 is contested, here is the exact sentence both camps highlighted, and
here is what each of them wrote about it, over their name. For a safety lead about to sign,
that is the most useful single view in the product.

### 6.3 Extending `disagreementReport`

`DisagreementReport` today distinguishes `contested` (a finding cited by more than one camp —
common ground read two ways) from `oneSided` (cited by exactly one camp — evidence the others
did not engage with). Trails add two categories at span rather than finding granularity (`Span` below is
`Mark["span"]` from §2, extracted to a named type):

```ts
/** The same words, marked by reviewers who reached different calls. */
contestedSpans: { documentId: string; page: number; span: Span;
                  quotedText: string; byCall: { call: Call; participantIds: string[] }[] }[];

/** Marked by every member of one camp and by nobody in the other. */
unreadByCamp: { documentId: string; page: number; span: Span;
                quotedText: string; markedBy: Call; unmarkedBy: Call }[];
```

`unreadByCamp` is the one the current model structurally cannot express. Citations come only
from reviewers who already decided to cite, so the existing report can describe disagreement
about evidence but never **asymmetric exposure to it**. Those are different conversations:
one camp is wrong about what the page means, or one camp never saw the page. The remedy
differs completely, and today the two are indistinguishable.

Both are plain arithmetic over sealed marks — no model, consistent with
`disagreementReport`'s existing refusal to judge who is right.

### 6.4 Open questions, and the experiment planner

Every `question` and `challenge` mark aggregates onto the missing-evidence list, page-anchored
and attributed, routed exactly as `externalClaimsAsGaps` routes external claims today.

This is where trails reach the planner. The README's claim for it is that it "does not ask
'which assay is usually informative?' It asks *which rule is doing the defeating, and what
evidence would overturn that specific rule?*" A `challenge` mark sitting on the precise
sentence a rule is defeating is a human-authored, page-anchored, attributed input to exactly
that question — and unlike a generic comment, it arrives already bound to the argument
structure.

---

## 7. After the reveal: threads

Once positions are sealed and revealed, marks become collaborative. Any reviewer may reply
to any mark; replies are attributed with the same badge and appended to the chain as
`mark_replied`.

This is the "team members add notes for others to see" that motivated the request, and it is
safe here and only here. Before the reveal it is a side channel around blind submission: a
sticky note reading *"this NOAEL does not convince me"* on page 112 is a position, disclosed
outside the sealed-position mechanism, untracked by `positions[]`, uncovered by
`positionBasis`, and absent from the hash chain. The first confident reviewer would anchor
the room through a channel the record cannot see — the precise dynamic the four-stage
sequence exists to break. After the reveal there is nothing left to anchor, because every
independent reading is already on the record.

Post-reveal marks and replies render in the author's seat colour with a visible
`after reveal` tag, and never merge into the sealed trail or into any §6 aggregate. The
§6 views describe how the room read the document *independently*; letting post-reveal
activity into them would quietly destroy the only reason those views mean anything.

---

## 8. Deliberate marks only — no page-view telemetry

The system records marks. It does **not** record which pages an account opened, how long it
dwelled, or how far it scrolled.

1. **A mark is an act; a page view is an accident of scrolling.** This project's posture is
   that a measured thing must mean what it claims. "Pages opened" would silently conflate
   reading with passing through, and it would be reported next to numbers that were earned.
2. **It would change the room.** Recording which pages a colleague opened, in a system whose
   output is a signed record carrying their name, converts deliberation into surveillance.
   People who know their scrolling is on the record read defensively, and defensive reading
   is worse reading. The feature would corrode the thing it measures.
3. **The asymmetry of the mistake.** Telemetry is cheap to add later and impossible to
   un-ship, because the first version that ships it teaches the room it is being watched.

Consequence, stated plainly and enforced in the copy: the rail says **"no reviewer marked
this page."** It never says "no reviewer read this page," which the system does not know.

---

## 9. Build order

| Phase | Contents | Data model change |
|---|---|---|
| 1 | `read` route + "Read & mark" tab; viewer over `forCase(caseId)`; system highlights from existing `sourcePage`; `<Reviewer>` badge, seats, palette | none |
| 2 | Private marks; seal-with-position; `marks_sealed` chain entry | `Mark`, seat on roster |
| 3 | Reveal aggregates: rail, stacked page, `contestedSpans`, `unreadByCamp` | none |
| 4 | Promote-to-finding; `question`/`challenge` → inventory; post-reveal threads | `mark_replied` |

Phase 1 is demonstrable on its own and touches no schema — every finding in all three cases
in `data/cases/` already carries `sourceDocument` and `sourcePage`.

## 10. Known risks

- **Span anchoring.** The extracted page text in `results/**/*.pages.json` carries hard
  newlines mid-sentence (`"CENTER FOR DRUG EVALUATION AND \nRESEARCH"`). Mapping a mark back
  to PDF geometry requires normalising whitespace and hyphenation. `pymupdf` is already a
  dependency and exposes word-level bounding boxes, so the path exists; this is the main
  engineering unknown and Phase 2 should begin by measuring anchor accuracy on the three
  library documents rather than assuming it.
- **Eight seats.** A case with nine or more participants degrades to a neutral badge for the
  ninth onward. Accepted over palette cycling, which would break distinctness.
- **Mark volume.** A thorough reviewer on a 288-page review may produce hundreds of marks.
  The chain stores hashes, so the log is bounded; the rail and stacked page need to stay
  usable at that density, which is a rendering problem to measure in Phase 3.
