# R-1: Mount the two handlers the web app has been calling into a 404

| | |
|---|---|
| **Priority** | Post-submission, but it is a live bug and it is small |
| **Estimated effort** | 2 to 4 hours |
| **Depends on** | nothing |
| **Touches** | `services/api/server.ts`, `services/api/test/server.test.ts` |
| **Do not touch** | `apps/web/src/ai/client.ts` gating logic, and the static-build guarantee |

---

## The bug

`services/api/interpret.ts` exports `handleInterpret` and `services/api/navigate.ts`
exports `handleNavigate`. Both are fully implemented and unit tested in
`services/api/test/handlers.test.ts`.

`apps/web/src/ai/interpret.ts` POSTs to `/api/interpret` and
`apps/web/src/ai/navigate.ts` POSTs to `/api/navigate`.

**Neither route is mounted.** Verify against the branch you are on:

```bash
git grep -n "handleInterpret\|handleNavigate" -- services/api/server.ts
git grep -n "\"interpret\"\|\"navigate\"" -- services/api/server.ts
```

`server.ts` imports `completeFromEnv`, `providerFor` and `resolveModel` from
`interpret.js`, and does not import `navigate.js` at all. Requests fall through the router
and get a 404.

**Why nobody noticed.** `apps/web` uses a five-rung ladder: rung 1 is the live model call
and rungs 2 to 5 are a bundled cache and local matchers. The client never throws
(`apps/web/src/ai/client.ts` has a 2500ms timeout and swallows failures by design), so the
app silently degrades to rung 2 and looks fine. The feature works; it just never reaches
the model.

Check whether it is still true before building. `origin/main` added an Ask surface and
grew `server.ts` by about 100 lines, so a route may have appeared.

---

## What to build

- [ ] **Step 1: Confirm the bug still exists and read the router**

```bash
sed -n '100,180p' services/api/server.ts
```

Find the top-level path dispatch, the auth resolution, and how a handler's `{status, body}`
result is turned into a response. Copy that shape exactly.

- [ ] **Step 2: Decide the auth question deliberately, and write the reason in a comment**

These two surfaces are different from the case routes. They take a free-text string from a
reader and classify it against a closed set; they expose no case data and no compound data.
But they **do** spend model tokens, which makes an unauthenticated route a cost surface
that anyone on the network can drive.

The server binds `127.0.0.1` only, so "anyone on the network" is currently "anyone on this
machine". Reason it out from that and pick one, then write the reasoning into the code so
the next person does not have to re-derive it. Do not leave it implicit.

- [ ] **Step 3: Write the failing integration test**

The existing `services/api/test/handlers.test.ts` tests the handlers with a fake
`Complete`. What is missing is a test that a **request** reaches them. Add to
`services/api/test/server.test.ts`, following its existing request helper:

```ts
it("routes POST /api/interpret to the interpret handler", async () => {
  const res = await post("/api/interpret", { text: "the transporter assay overcalls here" });
  // Without credentials the handler answers 503 no_key rather than 404. That is the
  // assertion that distinguishes "mounted and has no model" from "not mounted".
  expect(res.status).not.toBe(404);
  expect([200, 503]).toContain(res.status);
});
```

The comment matters: asserting `not 404` alone would pass against a route that returns 500.

- [ ] **Step 4: Run and watch it fail with 404**

```bash
npx vitest run services/api/test/server.test.ts
```

- [ ] **Step 5: Mount both**

Import `handleNavigate` from `./navigate.js` and `handleInterpret` from `./interpret.js`,
and add the two cases to the router beside the existing top-level routes. Resolve the model
with `completeFromEnv(process.env, "interpret")` or the call kind those handlers expect;
read `resolveModel` in `interpret.ts` to get the kind right rather than guessing.

Handle the null-credentials case the way the rest of the server does: `completeFromEnv`
returns `null` when the provider has no credentials, and the correct answer is **503**, not
a crash and not a stub. The client is built to descend a rung on a non-200.

- [ ] **Step 6: Verify the static build is unaffected**

`apps/web` also ships as a single self-contained `index.html` opened over `file://`, where
the network is deliberately unreachable and `apps/web/e2e/static-file.spec.ts` asserts zero
subresource requests. The live path is gated twice in `apps/web/src/ai/client.ts`:

```ts
const liveEnabled = import.meta.env.VITE_ARBITER_LIVE === "1" && location.protocol !== "file:";
```

**Do not touch that gate.** Then prove you did not break it:

```bash
npm run e2e
```

Note the finding recorded in `HANDOVER.md` section 10.2: over `file://` a relative fetch is
refused **synchronously**, before any network event exists, so the zero-network guarantee
was once unfalsifiable and is now checked with a console-error listener. Do not weaken that
listener to make a test pass.

- [ ] **Step 7: Drive it end to end**

```bash
npm run dev
```

Open `http://localhost:5173/app/#/case`, use the "Challenge the reasoning" box in the table
panel, and confirm the rung reported on screen is **1** with source `live` rather than 4
with source `local`. `HANDOVER.md` section 10.3 records that the rung indicator prints the
rung actually reached, so it is a trustworthy readout.

- [ ] **Step 8: Commit**

```bash
git add services/api/server.ts services/api/test/server.test.ts
git commit -m "Mount interpret and navigate, which the web app has been calling into a 404

Both handlers were implemented and unit tested and neither was routed. The web
app POSTs to both paths and its five-rung ladder swallows the failure by design,
so the feature degraded silently to the bundled cache and looked like it worked.

Answers 503 when the provider has no credentials, because the client is built to
descend a rung on a non-200. The file:// static build is untouched: its live
gate stays, and the e2e zero-network guarantee still passes."
```

---

## Definition of done

- [ ] A request to each path returns 200 or 503, never 404.
- [ ] With credentials present, the Case tab reports rung 1 source live.
- [ ] `npm run e2e` passes, including the `file://` specs.

## Traps specific to this task

- **The client swallows failures by design.** You cannot verify this from the UI alone
  looking healthy. Check the rung indicator.
- **503 and not a stub.** A stub answer here would be indistinguishable from a real one to
  the ladder, which is the same class of error the adjudicator's `source` field exists to
  prevent.
- **Do not weaken the `file://` gate or the console-error listener.** They exist because
  the zero-network guarantee was once untestable and shipped a false claim.
