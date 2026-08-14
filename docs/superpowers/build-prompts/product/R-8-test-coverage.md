# R-8: Close the deliberation client's test coverage hole

| | |
|---|---|
| **Priority** | Post-submission |
| **Estimated effort** | 2 to 3 days |
| **Depends on** | nothing. Do P1-C first so the new panel is covered as it lands. |
| **Touches** | `apps/deliberation/test/**` (new files), `apps/deliberation/e2e/**` (new), `playwright.config.ts` |

---

## The hole, stated precisely

The repository has strong test discipline overall: 77 Vitest files and roughly 938 cases,
plus 3 Playwright specs. `services/api/test/deliberation.test.ts` alone carries 47 tests
and `packages/engine/test/rules.test.ts` carries 39.

**The deliberation client is the exception.** `apps/deliberation/test/screens.test.tsx` is
the only test file in that app, 28 tests, and it imports from `screens.tsx` only. Untested:

| file | lines | what is in it |
|---|---|---|
| `apps/deliberation/src/App.tsx` | 355 | all routing, data loading, the 3000ms poll, every fetch |
| `apps/deliberation/src/pages.tsx` | 474 | AuthPage, Dashboard, NewCasePage, LibraryPage, MethodPage |
| `apps/deliberation/src/Layout.tsx` | 156 | shell, step indicator |
| `apps/deliberation/src/api.ts` | 250 | every client call |

Playwright covers `apps/web` only (`playwright.config.ts` sets `testDir: "apps/web/e2e"`).
So the multi-party workflow, which the external research identifies as the strongest
differentiator in the product, has **no end-to-end test at all**.

The server side of that same workflow is heavily covered, so the risk is concentrated
exactly in the client: routing, loading, and what the screens do with what they receive.

**The playbook's guidance on this:** know it, do not volunteer it, answer honestly if
asked.

---

## Order of work, by what would actually catch a regression

Not by file size. Start with the pure functions, because they cost minutes.

- [ ] **Step 1: The two exported pure functions, first**

`bucketOf` in `pages.tsx:169` sorts a case into `yours`, `sign`, `waiting` or `closed`,
and it decides what every user sees on their dashboard. `initials` in `Layout.tsx:12`
is trivial but exported.

Create `apps/deliberation/test/pages.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { bucketOf } from "../src/pages.js";

describe("bucketOf", () => {
  it("puts a case needing my position in yours, even when others have answered", () => {
    expect(bucketOf(caseWhere({ status: "open", iHaveAnswered: false }), "me")).toBe("yours");
  });

  it("puts a locked case I own in sign, and the same case in waiting for a participant", () => {
    const locked = caseWhere({ status: "locked", ownerId: "me" });
    expect(bucketOf(locked, "me")).toBe("sign");
    expect(bucketOf(locked, "someone-else")).toBe("waiting");
  });

  it("puts a signed case in closed for everyone", () => {
    expect(bucketOf(caseWhere({ status: "signed" }), "me")).toBe("closed");
    expect(bucketOf(caseWhere({ status: "signed" }), "other")).toBe("closed");
  });
});
```

Read `bucketOf`'s real signature and case shape before writing `caseWhere`; do not guess
at field names.

- [ ] **Step 2: The client, against a fake fetch**

`api.ts` is 250 lines of URL and method construction, and a wrong verb or path fails
silently at runtime. Test that each method issues the right request and threads the bearer
token, using a stub `fetch`. This is cheap and it catches the class of bug that is
otherwise invisible until a human clicks the right button.

Assert on the URL and method, not on the response shape, since the server tests already
cover the latter.

- [ ] **Step 3: The routing, which is where a real regression would hide**

`App.tsx` decides what renders from `parseHash` plus case status plus whether the viewer is
the owner. The rule that matters most: **the reveal route must render an empty state while
the case is open**, because that is the client half of the blindness guarantee.

```tsx
it("refuses to show the reveal route while the case is still open", () => {
  renderAppAt("#/case/c1/reveal", { status: "open" });
  expect(screen.queryByText(/every position, at once/i)).toBeNull();
  expect(screen.getByText(/not everyone has answered/i)).toBeTruthy();
});
```

The server already enforces this by not sending positions, and this test covers the second
lock rather than duplicating the first.

- [ ] **Step 4: A Playwright spec for the whole workflow**

Add `apps/deliberation/e2e/` and extend `playwright.config.ts` to include it. The config
currently pins `testDir: "apps/web/e2e"` with a `webServer` that builds and previews the
web app; the deliberation client needs the API running too, so use `npm run dev` as the
webServer command and drive `http://localhost:5173/deliberation/`.

The one flow worth automating, because it is the demo and it is the differentiator:

1. seed with `npm run seed:demo`
2. sign in as participant A, submit a position
3. assert participant A cannot see B's position
4. sign in as B, submit a **different** call
5. reveal
6. assert both positions and the split panel are visible
7. sign with an override and **no reason**, and assert the button is disabled
8. add a reason, sign, and assert the audit chain verifies

Step 3 and step 7 are the two that protect real guarantees. Everything else is navigation.

- [ ] **Step 5: Commit**

```bash
git add apps/deliberation/test apps/deliberation/e2e playwright.config.ts
git commit -m "Test the deliberation client, which had one test file and no e2e

App.tsx, pages.tsx, Layout.tsx and api.ts had no unit tests, and Playwright
covered apps/web only, so the multi-party workflow had no end-to-end coverage at
all while its server side carried 47 tests.

The two specs that protect guarantees rather than navigation: the reveal route
renders an empty state while the case is open, which is the client half of the
blindness rule, and an override with no stated reason cannot be signed."
```

---

## Definition of done

- [ ] `bucketOf` and `api.ts` have unit tests.
- [ ] A test asserts the reveal route stays empty while a case is open.
- [ ] A Playwright spec drives blind submission through reveal, split and signed override.
- [ ] `npx vitest run apps/deliberation && npm run e2e` passes.

## Traps specific to this task

- **Do not duplicate the server tests.** The server has 47 tests on this workflow. Test
  what the **client** does with what it receives.
- **The 3000ms poll will make tests flaky** if you assert on timing. Drive state directly
  or use Playwright's auto-waiting rather than sleeping.
- **`npm run seed:demo` writes to disk.** The API persists to JSON and JSONL files, so an
  e2e run mutates real state. Point the store at a temp path for the test run rather than
  cleaning up afterwards.
- **Test the guarantees, not the pixels.** Blindness before reveal and no unreasoned
  override are the two properties this product actually promises.
