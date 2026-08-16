# Reading Trails — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "Read & mark" case tab — a PDF viewer scoped to one case's documents, showing existing findings as system highlights, with every participant carrying a stable seat colour and attributed badge.

**Architecture:** Seats are allocated server-side and stored on the case, because `participantIds` is a sorted set whose indices shift under roster changes. The client gains one hash route (`#/case/:id/read/:documentId/:page`), one tab in the existing `Steps` sequence, one `<Reviewer>` badge component reusing the existing `initials()` and `.avatar` rule, and a `pdfjs-dist` viewer that renders only documents returned by `documents.forCase(caseId)`. No `Mark` type exists yet — Phase 1 renders system highlights from `Finding.sourcePage`, which is already populated on every finding in all three cases.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React 18, Vitest + @testing-library/react (jsdom for `apps/**`, node for `services/**`), hand-rolled hash router, `pdfjs-dist` (the one new dependency).

**Spec:** `docs/superpowers/specs/2026-08-15-reading-trails-design.md`

## Global Constraints

- **Import specifiers carry `.js`**, in `src` and `test` alike: `from "./api.js"`, `from "../src/screens.js"`, `from "../deliberation.js"`. Never extensionless.
- **`packages/engine` is off limits.** Lint forbids `Date`, `Math.random`, `node:*`, `fs`, `crypto`, dynamic imports and parent imports anywhere in its `src`. Nothing in this plan touches it.
- **Six seats.** `SEAT_COUNT = 6`. A seventh participant gets no seat and renders neutral.
- **Reserved hues — never use for a seat:** `--stop` red (`#E5484D` / `#FF8A8E`), `--go` green (`#1CA64C` / `#55C97F`), `--accent` indigo (`#2B2BF0` / `#7B84FF`), `--open` grey (`#74747B` / `#9A9AA0`).
- **Every seat token is declared three times** in `apps/deliberation/src/app.css`: under `:root`, under `@media (prefers-color-scheme: dark)`, and under `:root[data-theme="dark"]`. Task 3 enforces this with a test.
- **A document is reachable only through `documents.forCase(caseId)`.** The shared library under `results/library/` is never served to this tab.
- **Nothing in Phase 1 exposes another participant's activity** while the case is `open`. Seat colour and initials are identity and are always visible; counts and aggregates are not built in this phase at all.
- Run the full suite with `npm test`. Typecheck with `npm run typecheck`. Lint with `npm run lint`.

---

### Task 1: Seat allocation

Pure functions, no I/O. Lives beside the other API modules so both the store and the HTTP layer can use it.

**Files:**
- Create: `services/api/seats.ts`
- Test: `services/api/test/seats.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SEAT_COUNT: 6`, `type SeatMap = Record<string, number>`, `allocateSeat(seats: SeatMap): number | null`, `withParticipant(seats: SeatMap, userId: string): SeatMap`, `seatOf(seats: SeatMap, userId: string): number | null`.

- [ ] **Step 1: Write the failing test**

Create `services/api/test/seats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SEAT_COUNT, allocateSeat, seatOf, withParticipant, type SeatMap } from "../seats.js";

describe("seat allocation", () => {
  it("gives the first participant seat 0", () => {
    expect(withParticipant({}, "u_a")).toEqual({ u_a: 0 });
  });

  it("gives each new participant the lowest unused seat", () => {
    let s: SeatMap = {};
    s = withParticipant(s, "u_a");
    s = withParticipant(s, "u_b");
    s = withParticipant(s, "u_c");
    expect(s).toEqual({ u_a: 0, u_b: 1, u_c: 2 });
  });

  it("returns the same map when a participant is already seated", () => {
    const s = withParticipant({}, "u_a");
    expect(withParticipant(s, "u_a")).toBe(s);
  });

  // The point of seats. A departed reviewer keeps their entry so the seat stays
  // taken; their sealed marks must keep rendering in the colour the room learned.
  it("never reissues the seat of a removed participant", () => {
    let s: SeatMap = {};
    s = withParticipant(s, "u_a");
    s = withParticipant(s, "u_b");
    // u_a leaves. deliberation.ts does NOT delete the entry.
    s = withParticipant(s, "u_c");
    expect(s["u_c"]).toBe(2);
    expect(s["u_a"]).toBe(0);
  });

  it("hands out no seat past SEAT_COUNT", () => {
    let s: SeatMap = {};
    for (let i = 0; i < SEAT_COUNT; i++) s = withParticipant(s, `u_${i}`);
    const full = withParticipant(s, "u_seventh");
    expect(full["u_seventh"]).toBeUndefined();
    expect(allocateSeat(s)).toBeNull();
  });

  it("reports no seat for an unknown or unseated participant", () => {
    expect(seatOf({}, "u_a")).toBeNull();
    expect(seatOf({ u_a: 3 }, "u_a")).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run services/api/test/seats.test.ts`
Expected: FAIL — cannot resolve `../seats.js`.

- [ ] **Step 3: Write minimal implementation**

Create `services/api/seats.ts`:

```ts
/**
 * A seat is a participant's identity on screen: it picks their colour, and the
 * colour is how a reveal screen reads as people rather than as heat.
 *
 * ALLOCATED, NOT DERIVED, and that is a correctness requirement rather than a
 * preference. The obvious cheap reading - "seat = index in participantIds" - is
 * broken, because that array is a sorted set: deliberation.ts sorts it on create
 * and on every add, and filters on remove. A reviewer joining with an id that
 * sorts early shifts everyone after them, so half the room would change colour
 * when the roster changed. That instability is the exact thing seats exist to
 * prevent.
 *
 * A removed participant KEEPS their entry. The seat stays taken so it is never
 * reissued, and their sealed marks keep the colour the room already learned.
 */
export const SEAT_COUNT = 6;

export type SeatMap = Record<string, number>;

export function allocateSeat(seats: SeatMap): number | null {
  const taken = new Set(Object.values(seats));
  for (let i = 0; i < SEAT_COUNT; i++) if (!taken.has(i)) return i;
  return null;
}

/** Returns the SAME object when nothing changes, so callers can compare by identity. */
export function withParticipant(seats: SeatMap, userId: string): SeatMap {
  if (userId in seats) return seats;
  const seat = allocateSeat(seats);
  if (seat === null) return seats;
  return { ...seats, [userId]: seat };
}

export function seatOf(seats: SeatMap, userId: string): number | null {
  return seats[userId] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run services/api/test/seats.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add services/api/seats.ts services/api/test/seats.test.ts
git commit -m "Allocate seats rather than deriving them from a sorted set"
```

---

### Task 2: Seats on the case

**Files:**
- Modify: `services/api/deliberation.ts` — the `DeliberationCase` interface (~line 95), `openCase` (~line 152), `addParticipant` (~line 179), `removeParticipant` (~line 193)
- Test: `services/api/test/deliberation.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `withParticipant`, `seatOf`, `type SeatMap` from `../seats.js` (Task 1).
- Produces: `DeliberationCase.seats: SeatMap`, populated by `openCase` and maintained by `addParticipant` / `removeParticipant`.

- [ ] **Step 1: Write the failing test**

Append to `services/api/test/deliberation.test.ts`. Note the existing file already builds a `CASE` via `openCase` at the top — reuse that pattern rather than a new fixture.

```ts
describe("seats", () => {
  it("seats every participant when the case opens", () => {
    const c = openCase({
      caseId: "case-seats", compoundLabel: "X", context: "ctx",
      ownerId: "u_owner", participantIds: ["u_b", "u_a"],
    });
    // participantIds is sorted on create, so u_a takes seat 0.
    expect(c.seats).toEqual({ u_a: 0, u_b: 1 });
  });

  // THE regression test for this design. An id that sorts before every existing
  // participant must not move anybody's colour.
  it("does not move existing seats when a low-sorting id joins", () => {
    const c = openCase({
      caseId: "case-seats", compoundLabel: "X", context: "ctx",
      ownerId: "u_owner", participantIds: ["u_b", "u_c"],
    });
    const before = { ...c.seats };
    const r = addParticipant(c, "u_a");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.participantIds).toEqual(["u_a", "u_b", "u_c"]);
    expect(r.value.seats["u_b"]).toBe(before["u_b"]);
    expect(r.value.seats["u_c"]).toBe(before["u_c"]);
    expect(r.value.seats["u_a"]).toBe(2);
  });

  it("keeps a removed participant's seat taken", () => {
    const c = openCase({
      caseId: "case-seats", compoundLabel: "X", context: "ctx",
      ownerId: "u_owner", participantIds: ["u_a", "u_b"],
    });
    const gone = removeParticipant(c, "u_a");
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    expect(gone.value.participantIds).toEqual(["u_b"]);
    expect(gone.value.seats["u_a"]).toBe(0);

    const added = addParticipant(gone.value, "u_z");
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.seats["u_z"]).toBe(2);
  });
});
```

Extend the import at the top of the file to include `addParticipant` and `removeParticipant` if they are not already imported.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run services/api/test/deliberation.test.ts`
Expected: FAIL — `c.seats` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `services/api/deliberation.ts`, add the import:

```ts
import { withParticipant, type SeatMap } from "./seats.js";
```

Add to the `DeliberationCase` interface:

```ts
  /** Participant -> seat index, which picks their colour everywhere they appear.
   *  Allocated rather than derived: see seats.ts. Entries for removed
   *  participants are RETAINED so their seat is never reissued. */
  seats: SeatMap;
```

In `openCase`, after `participantIds` is computed, seat them in sorted order:

```ts
  const participantIds = [...new Set(init.participantIds)].sort();
  const seats = participantIds.reduce<SeatMap>((acc, id) => withParticipant(acc, id), {});
  return { /* ...existing fields... */ participantIds, seats };
```

In `addParticipant`, on the success branch:

```ts
  return {
    ok: true,
    value: {
      ...c,
      participantIds: [...c.participantIds, userId].sort(),
      seats: withParticipant(c.seats, userId),
    },
  };
```

`removeParticipant` is left alone apart from carrying `seats` through unchanged, which `...c` already does. Do not delete the entry.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run services/api/test/deliberation.test.ts`
Expected: PASS. Then run `npm run typecheck` — other constructors of `DeliberationCase` (in `deliberation-service.ts`, `seed-demo.ts`, `deliberation-demo.ts` and existing test fixtures) will fail to compile until they supply `seats`. Fix each by calling `openCase` where possible, or by adding `seats: {}` where a literal is constructed in a test.

- [ ] **Step 5: Commit**

```bash
git add services/api/deliberation.ts services/api/test/deliberation.test.ts
git commit -m "Store the seat map on the case"
```

---

### Task 3: Seat colour tokens, in all three theme blocks

**Files:**
- Modify: `apps/deliberation/src/app.css` — the `:root` block (~line 38-56), the `@media (prefers-color-scheme: dark)` block (~line 96-115), and the `:root[data-theme="dark"]` block (~line 118-136)
- Test: `apps/deliberation/test/theme.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--seat-0` … `--seat-5`, each with `-wash` and `-line` siblings, plus the `.seat-0` … `.seat-5` and `.seat-none` classes consumed by `<Reviewer>` in Task 4.

- [ ] **Step 1: Write the failing test**

Create `apps/deliberation/test/theme.test.ts`. This guards the hazard the file itself names — `app.css` already carries the comment *"Keep in step with the media-query block above."*

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/app.css", import.meta.url), "utf8");

describe("seat tokens", () => {
  // Duplicated from services/api/seats.ts rather than imported: apps/deliberation's
  // tsconfig does not include services/, and reaching across that boundary for one
  // integer would be the first crack in it. If SEAT_COUNT changes, this fails loudly.
  const SEAT_COUNT = 6;
  // :root, the prefers-color-scheme block, and :root[data-theme="dark"].
  const BLOCKS = 3;

  it("declares every seat token in all three theme blocks", () => {
    for (let i = 0; i < SEAT_COUNT; i++) {
      for (const suffix of ["", "-wash", "-line"]) {
        const token = `--seat-${i}${suffix}:`;
        const hits = css.split(token).length - 1;
        expect(hits, `${token} should appear once per theme block`).toBe(BLOCKS);
      }
    }
  });

  it("never gives a seat one of the reserved semantic hues", () => {
    const reserved = ["#E5484D", "#FF8A8E", "#1CA64C", "#55C97F", "#2B2BF0", "#7B84FF", "#74747B", "#9A9AA0"];
    for (const line of css.split("\n").filter((l) => l.includes("--seat-"))) {
      for (const hex of reserved) {
        expect(line.toUpperCase(), `a seat reuses ${hex}`).not.toContain(hex);
      }
    }
  });

  it("defines a class for every seat and a neutral fallback", () => {
    for (let i = 0; i < SEAT_COUNT; i++) expect(css).toContain(`.seat-${i}`);
    expect(css).toContain(".seat-none");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/deliberation/test/theme.test.ts`
Expected: FAIL — `--seat-0:` appears 0 times, expected 3.

- [ ] **Step 3: Write minimal implementation**

In `apps/deliberation/src/app.css`, inside the `:root` (light) block, directly after the `--open:` line:

```css
  /* Reviewer seats. Orange, amber, olive, teal, violet, magenta - chosen to miss
     every hue that already carries meaning here (--stop red, --go green,
     --accent indigo, --open grey), because a reviewer rendered in --go would read
     as a call rather than as a person. Six, not eight: four reserved hues do not
     leave eight slots that stay separable in BOTH themes, and a palette whose last
     two entries are near-neighbours of its first two breaks the only property
     seats have. A seventh participant renders .seat-none. */
  --seat-0: #C2410C;  --seat-0-wash: #FDEEE5;  --seat-0-line: #F3CDB6;
  --seat-1: #A16207;  --seat-1-wash: #FBF3E0;  --seat-1-line: #E9D6A4;
  --seat-2: #4D7C0F;  --seat-2-wash: #F0F5E4;  --seat-2-line: #CFE0AC;
  --seat-3: #0F766E;  --seat-3-wash: #E4F2F0;  --seat-3-line: #AFD8D2;
  --seat-4: #7E22CE;  --seat-4-wash: #F3E9FB;  --seat-4-line: #DCC3F2;
  --seat-5: #BE185D;  --seat-5-wash: #FCE8F0;  --seat-5-line: #F2BFD4;
```

Inside **both** the `@media (prefers-color-scheme: dark)` block and the `:root[data-theme="dark"]` block, after their `--open:` lines, add the identical dark values to each:

```css
    --seat-0: #FB923C;  --seat-0-wash: #2A1A0E;  --seat-0-line: #4A2E17;
    --seat-1: #FBBF24;  --seat-1-wash: #2A2310;  --seat-1-line: #4A3D19;
    --seat-2: #A3C948;  --seat-2-wash: #1D2410;  --seat-2-line: #35441C;
    --seat-3: #2DD4BF;  --seat-3-wash: #10262A;  --seat-3-line: #1B4249;
    --seat-4: #C084FC;  --seat-4-wash: #241A2E;  --seat-4-line: #3E2C50;
    --seat-5: #F472B6;  --seat-5-wash: #2A1520;  --seat-5-line: #4A2438;
```

Then, next to the existing `.avatar` rule (~line 225), add the seat modifiers. `.avatar` alone stays accent-tinted for the signed-in user in the header; a reviewer badge always re-tints all three properties so it is never mistaken for chrome:

```css
/* A reviewer badge is .avatar plus a seat. The bare .avatar keeps its accent tint
   for the signed-in user in the header chrome, where no attribution is in play;
   --accent is spoken for by system highlights, so a REVIEWER is never accent. */
.avatar.seat-0 { background: var(--seat-0-wash); color: var(--seat-0); border-color: var(--seat-0-line); }
.avatar.seat-1 { background: var(--seat-1-wash); color: var(--seat-1); border-color: var(--seat-1-line); }
.avatar.seat-2 { background: var(--seat-2-wash); color: var(--seat-2); border-color: var(--seat-2-line); }
.avatar.seat-3 { background: var(--seat-3-wash); color: var(--seat-3); border-color: var(--seat-3-line); }
.avatar.seat-4 { background: var(--seat-4-wash); color: var(--seat-4); border-color: var(--seat-4-line); }
.avatar.seat-5 { background: var(--seat-5-wash); color: var(--seat-5); border-color: var(--seat-5-line); }
.avatar.seat-none { background: var(--open-wash); color: var(--open); border-color: var(--open-line); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/deliberation/test/theme.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/deliberation/src/app.css apps/deliberation/test/theme.test.ts
git commit -m "Give reviewers six seat colours that miss every reserved hue"
```

---

### Task 4: The `<Reviewer>` badge

**Files:**
- Create: `apps/deliberation/src/Reviewer.tsx`
- Test: `apps/deliberation/test/Reviewer.test.tsx`

**Interfaces:**
- Consumes: `initials(name: string): string` from `./Layout.js`; `.seat-N` / `.seat-none` classes from Task 3.
- Produces: `Reviewer(props: { name: string; seat: number | null; disambiguate?: boolean }): ReactElement` and `collidingInitials(names: string[]): Set<string>`.

- [ ] **Step 1: Write the failing test**

Create `apps/deliberation/test/Reviewer.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Reviewer, collidingInitials } from "../src/Reviewer.js";

describe("Reviewer badge", () => {
  it("shows the initials of the display name", () => {
    render(<Reviewer name="Andres Lopez" seat={0} />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("carries the seat class so colour comes from the token", () => {
    const { container } = render(<Reviewer name="Jack He" seat={3} />);
    expect(container.querySelector(".avatar.seat-3")).not.toBeNull();
  });

  it("falls back to a neutral badge past the last seat", () => {
    const { container } = render(<Reviewer name="Jose Cruz-Lopez" seat={null} />);
    expect(container.querySelector(".avatar.seat-none")).not.toBeNull();
    expect(container.querySelector(".avatar.seat-0")).toBeNull();
  });

  // Colour is never the only channel: the name reaches assistive tech even when
  // the badge shows two letters.
  it("names the account for a screen reader", () => {
    render(<Reviewer name="Andres Lopez" seat={1} />);
    expect(screen.getByLabelText("Andres Lopez")).toBeInTheDocument();
  });

  it("appends the seat numeral when two reviewers share initials", () => {
    render(<Reviewer name="Jack He" seat={2} disambiguate />);
    expect(screen.getByText("JH·2")).toBeInTheDocument();
  });

  it("finds which names collide on initials", () => {
    expect(collidingInitials(["Jack He", "Jane Hart", "Andres Lopez"])).toEqual(new Set(["JH"]));
    expect(collidingInitials(["Jack He", "Andres Lopez"])).toEqual(new Set());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/deliberation/test/Reviewer.test.tsx`
Expected: FAIL — cannot resolve `../src/Reviewer.js`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/deliberation/src/Reviewer.tsx`:

```tsx
import type { ReactElement } from "react";
import { initials } from "./Layout.js";

/**
 * One badge for one account, used everywhere a person is named. One component is
 * what makes a seat colour learnable: a reviewer who looks different on the roster
 * and on the rail is two people as far as the reader is concerned.
 *
 * THREE CHANNELS, ANY TWO SUFFICIENT. Roughly one man in twelve cannot use the
 * colour, so initials carry the identity literally, colour carries fast scanning,
 * and seat order - which every list of reviewers in the app sorts by - carries it
 * at sizes where two letters of type do not fit.
 */
export function Reviewer({ name, seat, disambiguate = false }: {
  name: string;
  /** Null when the case has more participants than seats; renders neutral. */
  seat: number | null;
  /** Set when another participant on this case has the same initials. */
  disambiguate?: boolean;
}): ReactElement {
  const label = disambiguate && seat !== null
    ? `${initials(name)}·${seat}`
    : initials(name);
  return (
    <span className={`avatar ${seat === null ? "seat-none" : `seat-${seat}`}`}
      title={name} aria-label={name}>
      {label}
    </span>
  );
}

/** The initials that more than one name on the case produces. */
export function collidingInitials(names: string[]): Set<string> {
  const seen = new Map<string, number>();
  for (const n of names) {
    const i = initials(n);
    seen.set(i, (seen.get(i) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([i]) => i));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/deliberation/test/Reviewer.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/deliberation/src/Reviewer.tsx apps/deliberation/test/Reviewer.test.tsx
git commit -m "One badge component for an account, on three channels"
```

---

### Task 5: The `read` route

**Files:**
- Modify: `apps/deliberation/src/router.ts` — the `Route` union (~line 18-28), `parseHash` (~line 32-58), `href`
- Test: `apps/deliberation/test/router.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Route` variant `{ name: "read"; caseId: string; documentId?: string; page?: number }`, parsed from and serialised to `#/case/:caseId/read[/:documentId/:page]`.

- [ ] **Step 1: Write the failing test**

Create `apps/deliberation/test/router.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { href, parseHash } from "../src/router.js";

describe("read route", () => {
  it("parses the bare tab", () => {
    expect(parseHash("#/case/c1/read")).toEqual({ name: "read", caseId: "c1" });
  });

  // Deep links are load-bearing: a divergence row asserts something about one
  // sentence, and a reader who has to hunt page 112 by hand will not bother.
  it("parses a document and page", () => {
    expect(parseHash("#/case/c1/read/doc_9/112")).toEqual({
      name: "read", caseId: "c1", documentId: "doc_9", page: 112,
    });
  });

  it("ignores a page that is not a number", () => {
    expect(parseHash("#/case/c1/read/doc_9/xyz")).toEqual({
      name: "read", caseId: "c1", documentId: "doc_9",
    });
  });

  it("round-trips through href", () => {
    const r = { name: "read" as const, caseId: "c1", documentId: "doc_9", page: 112 };
    expect(parseHash(href(r))).toEqual(r);
    expect(href({ name: "read", caseId: "c1" })).toBe("#/case/c1/read");
  });

  it("still falls back to the case overview for an unknown sub-route", () => {
    expect(parseHash("#/case/c1/nonsense")).toEqual({ name: "case", caseId: "c1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/deliberation/test/router.test.ts`
Expected: FAIL — `parseHash("#/case/c1/read")` returns `{ name: "case", caseId: "c1" }`.

- [ ] **Step 3: Write minimal implementation**

In `apps/deliberation/src/router.ts`, add to the `Route` union:

```ts
  | { name: "read"; caseId: string; documentId?: string; page?: number }
```

In `parseHash`, inside the existing `switch (parts[2])`, before the `default`:

```ts
      case "read": {
        // #/case/:id/read/:documentId/:page. Both tail segments are optional, and a
        // page that is not a number is dropped rather than defaulted - a deep link
        // that silently lands on page 1 is worse than one that lands on the document.
        const documentId = parts[3] === undefined ? undefined : decodeURIComponent(parts[3]);
        const page = parts[4] === undefined ? undefined : Number.parseInt(parts[4], 10);
        return {
          name: "read", caseId,
          ...(documentId === undefined ? {} : { documentId }),
          ...(page === undefined || Number.isNaN(page) ? {} : { page }),
        };
      }
```

In `href`, add the matching case:

```ts
    case "read": {
      const base = `#/case/${encodeURIComponent(route.caseId)}/read`;
      if (route.documentId === undefined) return base;
      const doc = `${base}/${encodeURIComponent(route.documentId)}`;
      return route.page === undefined ? doc : `${doc}/${route.page}`;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/deliberation/test/router.test.ts`
Expected: PASS, 5 tests. Run `npm run typecheck` — `App.tsx`'s route switch must gain a `read` branch to stay exhaustive; render the Task 8 screen there once it exists, and until then a placeholder `<Read />` stub is acceptable within this task only if the next task follows immediately.

- [ ] **Step 5: Commit**

```bash
git add apps/deliberation/src/router.ts apps/deliberation/test/router.test.ts
git commit -m "Route to a document and a page, not just to the tab"
```

---

### Task 6: The "Read & mark" tab

**Files:**
- Modify: `apps/deliberation/src/Layout.tsx` — the `Steps` component (~line 131-158)
- Test: `apps/deliberation/test/Layout.test.tsx`

**Interfaces:**
- Consumes: the `read` route from Task 5.
- Produces: `Steps` accepts one new optional prop, `marks?: number` — the **viewer's own** mark count, rendered as a pip.

- [ ] **Step 1: Write the failing test**

Create `apps/deliberation/test/Layout.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Steps } from "../src/Layout.js";

const base = { caseId: "c1", route: { name: "case" as const, caseId: "c1" }, revealed: false };

describe("case stages", () => {
  it("puts Read & mark second, between Evidence and Your position", () => {
    render(<Steps {...base} />);
    const labels = screen.getAllByRole("link").map((a) => a.textContent);
    expect(labels[0]).toContain("Evidence");
    expect(labels[1]).toContain("Read & mark");
    expect(labels[2]).toContain("Your position");
  });

  it("links the tab at the read route", () => {
    render(<Steps {...base} />);
    expect(screen.getByRole("link", { name: /Read & mark/ })).toHaveAttribute("href", "#/case/c1/read");
  });

  // Unlike Reveal, reading is never gated: legitimate before you seal, and after
  // the reveal it is where the room's trails get compared.
  it("is enabled before and after the reveal", () => {
    const { rerender } = render(<Steps {...base} />);
    expect(screen.getByRole("link", { name: /Read & mark/ })).not.toHaveAttribute("aria-disabled");
    rerender(<Steps {...base} revealed />);
    expect(screen.getByRole("link", { name: /Read & mark/ })).not.toHaveAttribute("aria-disabled");
  });

  // The viewer's OWN count only. No pip ever reports another reviewer's activity
  // while the case is open - that is a confidence signal, and visibleTo already
  // refuses to return a running tally for the same reason.
  it("pips the viewer's own mark count when given one", () => {
    render(<Steps {...base} marks={14} />);
    expect(screen.getByRole("link", { name: /Read & mark/ })).toHaveTextContent("14");
  });

  it("shows no pip when no count is given", () => {
    render(<Steps {...base} />);
    expect(screen.getByRole("link", { name: /Read & mark/ })).not.toHaveTextContent(/\d/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/deliberation/test/Layout.test.tsx`
Expected: FAIL — the second link is "Your position".

- [ ] **Step 3: Write minimal implementation**

In `apps/deliberation/src/Layout.tsx`, extend the `Steps` signature with `marks`:

```tsx
export function Steps({ caseId, route, revealed, answered, of, marks }: {
  caseId: string; route: Route; revealed: boolean; answered?: number; of?: number;
  /** The VIEWER's own mark count. Never another participant's - see the pip note. */
  marks?: number;
}): ReactElement {
```

Insert the new item second in `items`:

```tsx
    { label: "Evidence", to: { name: "case", caseId }, enabled: true },
    {
      // Second, not appended. The strip claims the order is the product and then
      // skipped the part where somebody reads: a reviewer went from a list of
      // documents straight to a verdict form, so the reading happened off-system.
      // Read-then-decide is the order the work already has.
      //
      // Never gated, unlike Reveal. Status changes what this shows, not whether it
      // opens. The pip is the viewer's OWN count: own activity is not an aggregate
      // over other people, so it leaks nothing blind submission protects.
      label: "Read & mark", to: { name: "read", caseId }, enabled: true,
      ...(marks === undefined ? {} : { pip: String(marks) }),
    },
    {
      label: "Your position", to: { name: "position", caseId }, enabled: !revealed,
      ...(answered !== undefined && of !== undefined ? { pip: `${answered}/${of}` } : {}),
    },
```

Leave the remaining two items unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/deliberation/test/Layout.test.tsx`
Expected: PASS, 6 tests. Then `npm test` to confirm no existing screen test asserted a four-item strip.

- [ ] **Step 5: Commit**

```bash
git add apps/deliberation/src/Layout.tsx apps/deliberation/test/Layout.test.tsx
git commit -m "Give reading its own stage in the strip"
```

---

### Task 7: Serve a case's PDF bytes, and only a case's

**Files:**
- Modify: `services/api/server.ts` — the case sub-route switch (~line 321, beside the existing `case "documents":`)
- Test: `services/api/test/server.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: `DocumentStore.forCase(caseId)`, `DocumentStore.pathFor(id)` — both already exist in `services/api/documents.ts`.
- Produces: `GET /api/cases/:caseId/documents/:documentId/raw` → `200` with `content-type: application/pdf`, or `404` when the document is not on that case.

- [ ] **Step 1: Write the failing test**

Append to `services/api/test/server.test.ts`. The file already stands a real server in `beforeAll`, exposes `base` and a token map `tok` keyed by persona (`owner`, `ann`, `bea`, `cal`, `outsider`), and uses case id `c1`.

**Do not use the existing `call` helper here.** It ends with `await res.json()`, which throws on a PDF body. Use `fetch` directly:

```ts
describe("raw document bytes", () => {
  // The upload test above this one puts a document on c1; capture its id the same
  // way that test does, or upload one here first and read the id off the response.
  const raw = (caseId: string, docId: string, who: string) =>
    fetch(`${base}/api/cases/${caseId}/documents/${docId}/raw`, {
      headers: { authorization: `Bearer ${tok[who]}` },
    });

  it("serves a PDF that belongs to the case", async () => {
    const list = await call("GET", "/api/cases/c1/documents", "owner");
    const docId = list.body[0].id as string;
    const res = await raw("c1", docId, "owner");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  // The case-scoping enforcement point. A mark means "this reviewer, reading the
  // evidence for THIS case, stopped here" - so a document that is not on the case
  // must not be reachable here, whatever its id. Resolving by bare id would admit
  // a library PDF nobody on this case was asked to read.
  it("refuses a document id that is not on this case", async () => {
    const res = await raw("c1", "doc_not_on_this_case", "owner");
    expect(res.status).toBe(404);
  });

  it("still refuses somebody who is not on the case at all", async () => {
    const list = await call("GET", "/api/cases/c1/documents", "owner");
    const docId = list.body[0].id as string;
    const res = await raw("c1", docId, "outsider");
    expect(res.status).toBe(403);
  });
});
```

The third test asserts the route sits behind the same case-access check as its neighbours. Read how the existing `case "documents":` branch is guarded (`access.ts`) and place the new branch inside the same guard rather than beside it — if the existing guard returns 404 rather than 403 for an outsider, match that and change the expectation.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run services/api/test/server.test.ts`
Expected: FAIL — 404 on the first case, because no `raw` route exists.

- [ ] **Step 3: Write minimal implementation**

In `services/api/server.ts`, beside the existing `case "documents":` branch, handle the deeper path. The existing branch matches `parts[2] === "documents"` with nothing after it; add a check for the `raw` tail:

```ts
          case "documents": {
            // GET /api/cases/:caseId/documents/:documentId/raw
            //
            // SCOPED THROUGH forCase, NOT through get(). Resolving by id alone would
            // serve any document to anyone holding a case they are on, which quietly
            // admits a library PDF nobody on this case was asked to read. A mark
            // against such a document could not mean what a mark means.
            if (parts[3] !== undefined && parts[4] === "raw") {
              const doc = deps.documents.forCase(caseId).find((d) => d.id === parts[3]);
              if (doc === null || doc === undefined) return json(res, 404, { error: "no_such_document" });
              res.writeHead(200, { "content-type": "application/pdf", "content-length": doc.bytes });
              createReadStream(deps.documents.pathFor(doc.id)).pipe(res);
              return;
            }
            return json(res, 200, deps.documents.forCase(caseId));
          }
```

Add `import { createReadStream } from "node:fs";` at the top of `server.ts` if it is not already imported.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run services/api/test/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/api/server.ts services/api/test/server.test.ts
git commit -m "Serve document bytes through the case, never by bare id"
```

---

### Task 8: The Read & mark screen

**Files:**
- Create: `apps/deliberation/src/read.tsx`
- Modify: `apps/deliberation/src/api.ts` (add `documentUrl` and `findingsFor` helpers), `apps/deliberation/src/App.tsx` (render the `read` route)
- Modify: `apps/deliberation/package.json` (add `pdfjs-dist`)
- Test: `apps/deliberation/test/read.test.tsx`

**Interfaces:**
- Consumes: `Reviewer` (Task 4), the `read` route (Task 5), `GET .../raw` (Task 7), `Finding.sourceDocument` / `Finding.sourcePage` from `services/api/adjudicate.ts`.
- Produces: `Read(props: { caseId: string; documentId?: string; page?: number; documents: StoredDocument[]; findings: Finding[] }): ReactElement`, and `highlightsFor(findings: Finding[], documentId: string, filename: string): Finding[]`.

**Dependency note:** this task adds `pdfjs-dist`, the plan's only new runtime dependency. The codebase is deliberately dependency-averse — `router.ts` and `auth.ts` both record refusing one — so state the reason in the commit: rendering PDF page geometry is not thirty lines, and Mozilla's renderer is the reference implementation. Pin it, and import the worker as a local asset rather than from a CDN, since this app will hold unpublished safety data.

- [ ] **Step 1: Write the failing test**

Create `apps/deliberation/test/read.test.tsx`. The PDF canvas itself is not unit-tested here — the testable surface is the document list, the case scoping, and which findings become highlights.

```tsx
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Read, highlightsFor } from "../src/read.js";
import type { Finding } from "../src/api.js";

const DOCS = [
  { id: "doc_1", caseId: "c1", filename: "turalio.pdf", bytes: 10, sha256: "a", uploadedBy: "u_a", uploadedAt: "2026-08-15T00:00:00.000Z" },
  { id: "doc_2", caseId: "c1", filename: "krazati.pdf", bytes: 10, sha256: "b", uploadedBy: "u_a", uploadedAt: "2026-08-15T00:00:00.000Z" },
];

const FINDINGS: Finding[] = [
  { id: "f1", label: "hepatocellular necrosis", assertion: "toxic", detail: "d", sourceDocument: "turalio.pdf", sourcePage: 112 },
  { id: "f2", label: "no liver signal", assertion: "safe", detail: "d", sourceDocument: "krazati.pdf", sourcePage: 40 },
  { id: "f3", label: "unsourced", assertion: "ambiguous", detail: "d" },
];

describe("read screen", () => {
  it("lists every document on the case", () => {
    render(<Read caseId="c1" documents={DOCS} findings={FINDINGS} />);
    expect(screen.getByText("turalio.pdf")).toBeInTheDocument();
    expect(screen.getByText("krazati.pdf")).toBeInTheDocument();
  });

  it("says so plainly when the case has no documents", () => {
    render(<Read caseId="c1" documents={[]} findings={[]} />);
    expect(screen.getByText(/no documents/i)).toBeInTheDocument();
  });

  // Findings already carry sourceDocument/sourcePage on every case in data/cases,
  // so the document arrives pre-annotated with what extraction found before a
  // single mark exists.
  it("takes only the findings sourced to the open document", () => {
    expect(highlightsFor(FINDINGS, "doc_1", "turalio.pdf").map((f) => f.id)).toEqual(["f1"]);
  });

  it("drops findings with no page, rather than guessing one", () => {
    expect(highlightsFor(FINDINGS, "doc_1", "turalio.pdf").every((f) => f.sourcePage !== undefined)).toBe(true);
    expect(highlightsFor(FINDINGS, "doc_9", "nothing.pdf")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/deliberation/test/read.test.tsx`
Expected: FAIL — cannot resolve `../src/read.js`.

- [ ] **Step 3: Write minimal implementation**

Add the dependency:

```bash
npm install --save-exact pdfjs-dist -w @arbiter/deliberation
```

`--save-exact` because this renders regulatory documents: a caret range means the bytes a reviewer saw on the day they signed are not the bytes a later reader gets. Record the resolved version in the commit message.

Create `apps/deliberation/src/read.tsx`:

```tsx
import { useState, type ReactElement } from "react";
import type { Finding, StoredDocument } from "./api.js";

/**
 * The findings that belong on this document's pages.
 *
 * Matched on FILENAME, because Finding.sourceDocument holds the filename that the
 * extraction wrote, not a document id - the findings in data/cases predate any
 * upload. Matching is exact: a fuzzy match would silently attach a finding to the
 * wrong 288-page review, and a highlight pointing at the wrong study is worse than
 * no highlight.
 *
 * A finding with no sourcePage is DROPPED rather than defaulted to page 1. There is
 * no honest page to put it on, and page 1 of an FDA review is a cover sheet.
 */
export function highlightsFor(findings: Finding[], _documentId: string, filename: string): Finding[] {
  return findings.filter((f) => f.sourceDocument === filename && f.sourcePage !== undefined);
}

export function Read({ caseId, documentId, page, documents, findings }: {
  caseId: string;
  documentId?: string;
  page?: number;
  documents: StoredDocument[];
  findings: Finding[];
}): ReactElement {
  const [openId, setOpenId] = useState<string | undefined>(documentId ?? documents[0]?.id);
  const open = documents.find((d) => d.id === openId) ?? null;
  const marks = open === null ? [] : highlightsFor(findings, open.id, open.filename);

  if (documents.length === 0) {
    return (
      <section>
        <p className="small muted">
          No documents on this case yet. Upload a study PDF on the Evidence stage and it will
          open here.
        </p>
      </section>
    );
  }

  return (
    <section className="read">
      <nav aria-label="Case documents">
        {documents.map((d) => (
          <button key={d.id} className="ghost" aria-current={d.id === openId ? "true" : undefined}
            onClick={() => setOpenId(d.id)}>
            {d.filename}
          </button>
        ))}
      </nav>
      {open !== null && (
        <PdfView caseId={caseId} document={open} page={page} highlights={marks} />
      )}
    </section>
  );
}
```

Add `PdfView` in the same file, merging the imports below into the ones already at the top of `read.tsx` rather than adding a second import block. Note it renders **page-level** highlights only: a link to the page, not a box around a sentence. Span geometry is Phase 2, and §10 of the spec asks for anchor accuracy to be *measured* on the three library documents before anything relies on it.

```tsx
import { useEffect, useRef } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { href } from "./router.js";

// Bundled from node_modules by Vite, never fetched from a CDN. This app holds
// unpublished safety data; a third-party origin in the critical path of rendering
// it is not a trade this project makes.
GlobalWorkerOptions.workerSrc = workerUrl;

function PdfView({ caseId, document: doc, page, highlights }: {
  caseId: string; document: StoredDocument; page?: number; highlights: Finding[];
}): ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shown = page ?? 1;

  useEffect(() => {
    let cancelled = false;
    const task = getDocument(`/api/cases/${caseId}/documents/${doc.id}/raw`);
    void task.promise.then(async (pdf) => {
      // Clamp rather than throw: a stale deep link to page 400 of a 288-page review
      // should land on the last page, not on an error screen.
      const p = await pdf.getPage(Math.min(Math.max(shown, 1), pdf.numPages));
      if (cancelled || canvas.current === null) return;
      const viewport = p.getViewport({ scale: 1.4 });
      const ctx = canvas.current.getContext("2d");
      if (ctx === null) return;
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      await p.render({ canvasContext: ctx, viewport }).promise;
    });
    return () => { cancelled = true; void task.destroy(); };
  }, [caseId, doc.id, shown]);

  return (
    <div className="pdfview">
      <canvas ref={canvas} aria-label={`${doc.filename} page ${shown}`} />
      <aside aria-label="Findings sourced to this document">
        {highlights.length === 0
          ? <p className="small muted">No finding on this case cites this document.</p>
          : highlights.map((f) => (
            <a key={f.id} className="finding-row"
              href={href({ name: "read", caseId, documentId: doc.id, page: f.sourcePage })}>
              <span className="pip">p.{f.sourcePage}</span> {f.label}
            </a>
          ))}
      </aside>
    </div>
  );
}
```

Add a `.pdfview` rule to `app.css` laying the canvas and aside side by side, and tint `.finding-row` with `--accent-wash` / `--accent-line` — system highlights are accent, and §3.2 reserves that colour so no reviewer can ever wear it.

If TypeScript rejects the `?url` import, add `/// <reference types="vite/client" />` to `apps/deliberation/src/vite-env.d.ts` (create it if absent).

Finally, in `apps/deliberation/src/App.tsx`, render the route:

```tsx
    case "read":
      return <Read caseId={route.caseId} documentId={route.documentId} page={route.page}
        documents={documents} findings={findings} />;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/deliberation/test/read.test.tsx`
Expected: PASS, 4 tests. Then `npm test`, `npm run typecheck` and `npm run lint` — all three must be clean.

- [ ] **Step 5: Commit**

```bash
git add apps/deliberation/src/read.tsx apps/deliberation/src/App.tsx apps/deliberation/src/api.ts \
        apps/deliberation/package.json package-lock.json apps/deliberation/test/read.test.tsx
git commit -m "Open a case document, pre-annotated with what extraction found"
```

---

## Done when

- `npm test`, `npm run typecheck` and `npm run lint` are clean.
- A case with documents shows a "Read & mark" tab second in the strip, enabled at every status.
- Opening it lists only that case's documents; a document id from another case 404s.
- Findings sourced to the open document appear as highlights with their page.
- `#/case/:id/read/:docId/:page` deep-links, and round-trips through `href`.
- Every participant renders as a `<Reviewer>` badge with a stable seat colour that survives a theme toggle and a roster change.

## Not in this phase

`Mark` and its four kinds, private marks, `marks_sealed`, the attention rail, the stacked page, `contestedSpans` / `unreadByCamp`, promote-to-finding, `question` → inventory, and post-reveal threads. Phases 2-4 of the spec's build order.
