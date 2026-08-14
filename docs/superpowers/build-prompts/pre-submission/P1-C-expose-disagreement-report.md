# P1-C: Ship the disagreement report, which is written, tested, and reaches no user

| | |
|---|---|
| **Priority** | P1. The Evidence-Integrated Playbook calls this "the single most valuable feature already written and not shipped." |
| **Estimated effort** | 3 to 4 hours |
| **Depends on** | nothing |
| **Touches** | `services/api/deliberation-service.ts`, `services/api/server.ts`, `apps/deliberation/src/api.ts`, `apps/deliberation/src/screens.tsx`, `apps/deliberation/src/App.tsx`, tests in both |
| **Do not touch** | `services/api/deliberation.ts` `disagreementReport` itself (it is correct; only its reachability is broken) |

---

## Context you need before starting

ARBITER has two front ends. `apps/deliberation` is the multi-party workflow: several
named people submit positions **blind**, the reveal is simultaneous, a model adjudicates,
and one named person signs or overrides on the record. It is a Vite + React app that
depends on `react` and `react-dom` only. It does **not** depend on `@arbiter/engine`;
everything deterministic in that workflow is plain arithmetic in `services/api/`.

`services/api` is a hand-rolled `node:http` server with no framework, bound to
`127.0.0.1:8787`, persisting to JSON and JSONL files on disk. Run everything with
`npm run dev`, which serves the whole product on one origin at `http://localhost:5173`
with the deliberation client under `/deliberation/` and the API under `/api`.

**The governing design rule for this task**, from the redesign spec sections 6.4 and 6.7:

> Counts are never an input to the verdict, and are shown to a later reader as context only.
> No consensus mechanism, no quorum, no threshold to proceed. A committee advises; one
> named individual signs.

So this feature describes a split. It must never rank a camp by its size. **The words
"majority", "minority" and "outvoted" are forbidden in the copy**, and there is an
existing language-discipline test in the repo that greps rendered output for exactly this
class of word. Also: no em dashes anywhere.

---

## What is true today

`services/api/deliberation.ts:439` defines the type and `:447` the function:

```ts
export interface DisagreementReport {
  split: { call: Call; participantIds: string[] }[];
  /** Cited by more than one camp - the same evidence, read differently. */
  contested: string[];
  /** Cited by exactly one camp - evidence the others did not answer. */
  oneSided: { findingId: string; call: Call }[];
}

export function disagreementReport(c: DeliberationCase): DisagreementReport | null {
```

It returns `null` when fewer than two distinct calls exist, which means the room did not
split. `Call` is `"advance" | "do_not_advance" | "cannot_conclude"`
(`services/api/deliberation.ts:28`).

It is correct, it is unit tested, and **it reaches no user.** Verify all three absences:

```bash
git grep -n "disagreement" -- services/api/server.ts          # no route
git grep -n "disagreement" -- apps/deliberation/src/api.ts    # no client method
git grep -n "disagreement" -- apps/deliberation/src           # no renderer
git grep -rn "disagreementReport" -- services/api | grep -v test
```

The only production caller is `services/api/deliberation-demo.ts`, a terminal script.

**The consequence, which is the reason this is P1.** `apps/deliberation/src/screens.tsx`
ends its `Reveal` component with:

```tsx
      {unanimity !== null && unanimity.unanimous && (
        <>
          <h2 style={{ marginTop: 32 }}>Everyone agreed. That is not the same as being right.</h2>
          ...
          {unanimity.concerns.map((c, i) => <div className="concern" key={i}>{c}</div>)}
        </>
      )}
```

When the room **agrees**, the reader gets that block and its concerns. When the room
**splits**, which is the case this entire product is named for, the condition is false,
nothing renders, and the reader gets the raw positions side by side and nothing else.

---

## What to build

The full path: a service method, an HTTP route, a client method, and a panel mounted as
the else branch of that unanimity block.

## Step by step

- [ ] **Step 1: Read the three files you will change**

```bash
sed -n '430,480p' services/api/deliberation.ts
sed -n '300,325p' services/api/server.ts
sed -n '553,590p' apps/deliberation/src/screens.tsx
```

Note the route pattern at `server.ts:315-318`, which you will copy:

```ts
          case "unanimity": {
            const u = deps.service.unanimity(caseId);
            return u === null ? json(res, 404, { error: "no_case" }) : json(res, 200, u);
          }
```

- [ ] **Step 2: Write the failing service test**

Add to `services/api/test/deliberation-service.test.ts`, using whatever case-building
helper that file already has. Read its existing tests first and reuse their setup.

```ts
it("returns the split for a divided room and null for an agreed one", () => {
  const divided = caseWithCalls(["advance", "advance", "do_not_advance"]);
  const report = service.disagreement(divided.caseId);
  expect(report?.split.map((s) => s.call).sort()).toEqual(["advance", "do_not_advance"]);

  const agreed = caseWithCalls(["advance", "advance"]);
  expect(service.disagreement(agreed.caseId)).toBeNull();
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run services/api/test/deliberation-service.test.ts
```

Expected: FAIL, `service.disagreement is not a function`.

- [ ] **Step 4: Add the service method**

In `services/api/deliberation-service.ts`, beside the existing `unanimity` method, and
importing `disagreementReport` from `./deliberation.js`:

```ts
  /**
   * The shape of a split, for a reader who arrives after the fact.
   *
   * Null means the room did not split, which is an ANSWER and not an error. The
   * route therefore returns 200 with a null body rather than a 404; a 404 here
   * would say "no such case", which is a different fact.
   */
  disagreement(caseId: string): DisagreementReport | null {
    const c = this.store.getCase(caseId);
    if (c === undefined) return null;
    return disagreementReport(c);
  }
```

Match the exact store accessor the neighbouring `unanimity` method uses; read it and
copy its shape rather than guessing at `getCase`.

- [ ] **Step 5: Add the route**

In `services/api/server.ts`, immediately after the `case "unanimity"` block at `:315-318`:

```ts
          case "disagreement": {
            // 200 with a null body when the room did not split. A 404 would mean
            // "no such case", and the access check above has already established
            // that this case exists and this account may read it.
            return json(res, 200, deps.service.disagreement(caseId));
          }
```

The access check that runs before this switch already returns 404 `no_case` for a case
the caller may not read, so you do not repeat it here. Confirm that by reading the block
above the switch before you rely on it.

- [ ] **Step 6: Add the client method**

In `apps/deliberation/src/api.ts`, beside `unanimity` at `:335-336`, mirroring its shape
exactly:

```ts
  disagreement: (token: string, caseId: string) =>
    call<DisagreementReport | null>("GET", `/api/cases/${caseId}/disagreement`, token),
```

and add the matching interface to that file, copied from the server so the two stay
readable side by side:

```ts
export interface DisagreementReport {
  split: { call: Call; participantIds: string[] }[];
  contested: string[];
  oneSided: { findingId: string; call: Call }[];
}
```

- [ ] **Step 7: Load it where unanimity is loaded**

In `apps/deliberation/src/App.tsx`, find where `unanimity` is fetched for the reveal
route and fetch `disagreement` alongside it, threading it into `<Reveal>` as a new prop.
The app polls the case every 3000ms; put this on the same path so the two never disagree
about what stage the case is at.

- [ ] **Step 8: Write the failing render test**

`apps/deliberation/test/screens.test.tsx` is the only test file in that app and it
imports from `screens.tsx`. Add:

```tsx
it("shows where the room split, and never ranks a camp by its size", () => {
  const { container } = render(
    <Reveal
      view={revealedViewWithCalls(["advance", "advance", "do_not_advance"])}
      unanimity={{ unanimous: false, call: null, concerns: [] }}
      disagreement={{
        split: [
          { call: "advance", participantIds: ["u1", "u2"] },
          { call: "do_not_advance", participantIds: ["u3"] },
        ],
        contested: ["F1"],
        oneSided: [{ findingId: "F2", call: "do_not_advance" }],
      }}
      nameOf={(id) => id}
    />,
  );
  const text = container.textContent ?? "";
  expect(text).toMatch(/where the room split/i);
  expect(text).toContain("F1");
  for (const banned of ["majority", "minority", "outvoted", "outnumber"]) {
    expect(text.toLowerCase()).not.toContain(banned);
  }
});
```

The banned-word loop is the assertion that matters. It is the one a future change is
most likely to break.

- [ ] **Step 9: Run it and watch it fail**

```bash
npx vitest run apps/deliberation/test/screens.test.tsx
```

- [ ] **Step 10: Render the panel**

In `apps/deliberation/src/screens.tsx`, widen the `Reveal` signature:

```tsx
export function Reveal({ view, unanimity, disagreement, nameOf }: {
  view: BlindView;
  unanimity: UnanimityReport | null;
  disagreement: DisagreementReport | null;
  nameOf: (id: string) => string;
}): ReactElement {
```

and add this immediately after the existing unanimity block, before the closing
`</section>`:

```tsx
      {disagreement !== null && (
        <>
          <h2 style={{ marginTop: 32 }}>Where the room split</h2>
          <p className="muted small">
            Nothing below came from a model. This is which findings each position rests
            on, and it is checkable arithmetic. It records the shape of the disagreement
            and stops there: deciding which reading is right is the signer's job.
          </p>

          {disagreement.split.map((camp) => (
            <div className="concern" key={camp.call}>
              <strong>{CALL_LABEL[camp.call]}</strong>
              {": "}
              {camp.participantIds.map(nameOf).join(", ")}
            </div>
          ))}

          {disagreement.contested.length > 0 && (
            <p className="small">
              <strong>Read differently by both sides:</strong>{" "}
              {disagreement.contested.join(", ")}. The same finding is carrying opposite
              conclusions, so the disagreement is about what it means rather than about
              what was measured.
            </p>
          )}

          {disagreement.oneSided.length > 0 && (
            <p className="small">
              <strong>Cited by one side and unanswered by the other:</strong>{" "}
              {disagreement.oneSided.map((o) => o.findingId).join(", ")}. Evidence one
              position rests on that the others did not address.
            </p>
          )}
        </>
      )}
```

`CALL_LABEL` already exists in that file and is used at `:563`. Reuse it.

- [ ] **Step 11: Run and watch it pass**

```bash
npx vitest run apps/deliberation/test/screens.test.tsx services/api/test/
```

- [ ] **Step 12: Drive it end to end in the running app**

```bash
npm run seed:demo
npm run dev
```

Open `http://localhost:5173/deliberation/`, sign in as the seeded users, open a case,
and submit **deliberately different calls** from at least two accounts. Reveal. You must
see the split panel. Then run a case where everyone agrees and confirm you see the
unanimity block instead and no empty split heading.

- [ ] **Step 13: Full suite and commit**

```bash
npm run typecheck && npx vitest run
```

```bash
git add services/api/deliberation-service.ts services/api/server.ts \
        services/api/test apps/deliberation/src apps/deliberation/test
git commit -m "Show where the room split

disagreementReport has been implemented and unit tested since the deliberation
was built, and reached no user: no route, no client method, no component. Its
only caller was a terminal demo.

The consequence was backwards. When the room agreed, the reader got the
unanimity block and its concerns. When the room split, which is the case this
product exists for, nothing rendered and the reader got raw positions side by
side.

Describes camps, never ranks them: a test asserts the rendered output contains
no majority, minority or outvoted wording, because spec section 6.4 forbids
counts from deciding anything."
```

---

## Definition of done

- [ ] `curl -s localhost:5173/api/cases/<id>/disagreement -H "authorization: Bearer <token>"`
      returns the report for a split case and `null` for an agreed one, both with HTTP 200.
- [ ] A split case renders the panel in the browser; an agreed case renders the unanimity
      block and no empty heading.
- [ ] The rendered output contains no ranking-by-size language, enforced by test.
- [ ] `npm run typecheck && npx vitest run` passes.

## Traps specific to this task

- **`null` is a real answer, not a 404.** The room not splitting is a fact about the
  case. Returning 404 makes the client treat it as an error and the panel will flicker or
  log noise on every agreed case.
- **Do not add a count anywhere.** Not "2 of 3 advance", not a percentage, not a sorted
  order that puts the larger camp first. Sort camps by the call label so the order is
  stable and carries no ranking. An agreement statistic is a separate task (P2-B) with its
  own justification for why a measurement is permitted where a tally is not.
- **The blind rule still applies before reveal.** This panel renders only after the case
  locks. `view.revealed` is null while the case is open, and the server does not send
  positions before then. Do not fetch or render this on the open case.
- **`apps/deliberation` has one test file.** There is no e2e for this app at all, so the
  manual walkthrough in Step 12 is the only integration check that exists. Do not skip it.
