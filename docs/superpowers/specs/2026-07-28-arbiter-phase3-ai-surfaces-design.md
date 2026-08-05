# ARBITER Phase 3 — the three AI surfaces

**Date:** 28 July 2026 · **Submission due:** 16 August 2026 · **Data freeze:** 2 August 2026

Companion to `2026-07-26-arbiter-design.md` (the master spec) and `2026-07-27-arbiter-phase2-web-app-design.md`.
This document decides what the master spec left open for the AI layer, and records six corrections that
reading the code forced. Where the master spec is already specific — the surfaces' purpose (§7), the
failure-mode test list (§11), the cut order (§14) — this document does not repeat it.

The master spec's governing discipline for this phase is quoted here because everything below follows from it:

> Models are used for **language** tasks — parsing a sentence, matching a question to an anchor — and never
> for **judgment**.

## 1. Scope

**In scope.** A shared fallback-ladder module in `apps/web/src/ai/`; the challenge interpreter (Surface 1)
and the navigator (Surface 3), both complete; an anchor registry; an evidence working copy; the two thin
endpoints in `services/api/`; the pre-flight panel rewrite; the authored cache artifacts; and one small
addition to the Ruleset tab (§8.1) without which the navigator returns `noMatch` on two of the likeliest
judge questions.

**Specified but not built.** Surface 2, the live ablation spot check. It appends one run to a table produced
by a pre-computed 25-runs-per-compound ablation which **does not exist** — `npm run ablation` is absent from
the repo, and building it is its own task with its own design decisions (HANDOVER §3.2). Its shape is fixed
here so that it can be built without reopening this document, and so that cutting it costs nothing. §14 of
the master spec already names it the second thing to cut.

**Out of scope.** The harness ablation itself. Any change to `rules/ruleset-v1.0.json`.

## 2. The decision this phase rests on: cache-first, with live as an optional top rung

Nobody is committed to deploying the Railway service with a working key before 16 August. Rather than treat
that as a risk to be managed, this phase treats it as a **build order**: every surface is complete without a
network, and the live call is a strictly optional rung on top.

This costs almost nothing, because the static build forces the same switch anyway. `apps/web/e2e/static-file.spec.ts`
asserts the app must not *attempt* the call, not merely survive its failure: a build that tries and fails still
fails the test.

**Correction, measured.** This paragraph used to say that `page.on("request")` and `requestfailed` were what
enforced that. Over `file://` they enforce nothing. A relative `/api/interpret` resolves to
`file:///api/interpret`, and the Fetch API refuses the `file:` scheme synchronously, before any CDP network
event exists to observe — with the gate ablated so both ladders fire real fetches, neither channel fired and
every test in the file stayed green. The only trace is a console error: *"Fetch API cannot load
file:///api/interpret. URL scheme "file" is not supported."* **A console-error listener is what makes the
zero-network claim falsifiable on the artifact a judge opens**, and the `request`/`requestfailed` listeners are
belt-and-braces for a regression on a served build. This is a property of the project's central methodology,
not of one test: a caught `TypeError` produces no `pageerror` either.

**Two independent gates, computed once in `client.ts`:**

```ts
const liveEnabled = import.meta.env.VITE_ARBITER_LIVE === "1" && location.protocol !== "file:";
```

The build flag means the submitted ZIP is compiled with live off entirely. The protocol check means a ZIP
built from the wrong config still cannot fire a request. The redundancy is deliberate and is the direct
lesson of master spec §6.1 / HANDOVER §6.1, where `base: './'` was necessary and nowhere near sufficient and
every test passing over `http://localhost` hid the failure completely. Both gates are tested in both
directions.

**Consequence for the demo:** the static ZIP loses only the live interpreter path, and a judge cannot tell.
That is already the master spec's claim (§4 Deployment); this phase makes it true by construction rather
than by hope.

## 3. The shared ladder

One generic walker, and each surface declares its rungs as data. The rung that answered is a **value**, not
a comment:

```ts
export type Source = "live" | "cache" | "local" | "none";
export interface Resolution<T> { value: T | null; rung: number; source: Source }

export async function resolve<I, T>(rungs: Rung<I, T>[], input: I): Promise<Resolution<T>>;
```

`resolve` walks rungs in order and stops at the first hit. A rung returns `null` to pass.

This is the whole reason §11's fifteen-cell matrix is cheap: the conditions differ only at the transport
boundary, and above it every failure is the same event. It is also what lets the pre-flight panel report the
truth (§10) and what gives the tests something to assert on other than "an answer appeared" (§12).

**The invariant that makes it work: rung 1 either succeeds or is skipped. It never errors upward.** Timeout,
network-off, HTTP 500, malformed JSON, missing key, and a well-formed response of the wrong shape are all one
thing to the caller — a rung-1 miss.

## 4. Module boundaries

```
apps/web/src/ai/
  client.ts        the ONLY module permitted to issue a request; owns liveEnabled and the 2.5s abort
  resolve.ts       the generic ladder walker
  interpret.ts     Surface 1's five rungs
  navigate.ts      Surface 3's five rungs
  anchors.ts       the typed ANCHORS registry
  trigram.ts       character-trigram Jaccard, shared by both fuzzy rungs
  cache/
    interpretations.json      the authored challenges
    anchor-map.json           cached question -> anchorIds
    suggested-questions.json  the four no-match fallbacks

services/api/
  interpret.ts     POST /api/interpret
  navigate.ts      POST /api/navigate
```

`apps/web` never imports from `services/api`. The cache artifacts are imported as ES modules at build time,
exactly as `apps/web/src/data/bundle.ts` already imports evidence, results and metrics — there is no runtime
`fetch` of a sibling JSON file, for the reason the Phase 2 spec §3 gives.

**This phase is the first legitimate relaxation of the Phase 2 plan's "No runtime `fetch` in `apps/web`"
invariant.** It is relaxed only inside `client.ts`, only when `liveEnabled`, and the plan must say so
explicitly rather than let it erode quietly.

## 5. Surface 1 — the challenge interpreter

**Endpoint:** `POST /api/interpret`. **Mounts in** `apps/web/src/tabs/Case/TablePanel.tsx`, which already
carries a docstring reserving it.

**Request:** the challenge text, the ruleset as `(id, enabled, strength)`, and claim **ids and labels only** —
never raw evidence values.

**Response:**

```ts
{ targetRule: RuleId | null, targetClaimId: string | null,
  action: 'disable' | 'lower_strength' | 'raise_strength' | 'reclassify_field',
  field?: string, newValue?: unknown, paraphrase: string, confidence: 'high' | 'low' }
```

### 5.1 The fallback ladder — five rungs, as registered

| rung | mechanism | source |
|---|---|---|
| 1 | live call, **2.5s** timeout | `live` |
| 2 | exact match on challenge text against the authored cache | `cache` |
| 3 | character-trigram Jaccard over **that same cached set**, accepted at **≥ 0.55** | `cache` |
| 4 | deterministic keyword mapping (`rat`, `margin`, `domain`, rule names, stream names) | `local` |
| 5 | rule picker — *"Which rule do you want to contest?"* | `none` |

Every value here was verified against master spec §7 and none has drifted. **At every rung the resulting
change runs through the same engine — only the route from English to rule change differs. The reasoning is
never faked.**

### 5.2 The change is displayed before it is applied

Non-negotiable, and it is what makes the surface safe: a misinterpretation is visible and rejectable, never
silent.

**`confidence: 'low'` never arrives pre-armed.** The Apply control is unselected and the paraphrase is shown
at raised weight. `action: 'disable'` renders visually distinct from the strength actions regardless of
confidence, because two of the authored challenges sit one bad trigram match apart and one of them flips the
position on the hero case.

### 5.3 What may be reclassified, and what may not

The legal `field` set is **derived, not invented**. It is exactly `keyof AssayOperator["produces"]`
(`packages/engine/src/plan.ts:13-16`) — the fields the value-of-information planner must declare to
synthesise a hypothetical claim, arrived at independently for that purpose:

| `field` | `newValue` domain | rule |
|---|---|---|
| `system` | `human \| rodent \| nonrodent \| in_silico` | R1, and R2 via `isStructuralOnly` |
| `stream` | the six stream members | R6, and R2 across the `qsar` boundary |
| `measuresKeyEvent` | key-event ids **present in the loaded evidence**, or `null` | R2, and R5's equality gate |
| `exposureRelevant` | `true \| false \| null` | R3 |
| `inApplicabilityDomain` | `true \| false \| null` | R4 |
| `klimisch` | `1 \| 2 \| 3 \| 4 \| null` | R5 |

Type it as `keyof AssayOperator["produces"]` so that adding a rule-consumed field widens both at once.
`measuresKeyEvent` is a bare `z.string().nullable()` with no pattern, and `rules.ts` compares it only for
equality after normalisation — so an invented id silently breaks R5's "equal mechanistic relevance" gate
rather than erroring. Constrain the proposal surface to ids present in the loaded evidence.

**The following are excluded by construction** — none is a member of `AssayOperator["produces"]`, so typing
the field set as `keyof AssayOperator["produces"]` excludes them without a separate deny-list to maintain.
The reasons are recorded because they belong in the Q&A, not because they are separately enforced:

- **`assertion`** — changing it is not testing the reasoning, it is choosing the answer; `claimToMass` reads
  it directly. The system already answers this question honestly and read-only: `findCounterfactual`
  exhaustively reports the *minimal* set of assertion flips that would change the verdict without applying
  any of them. A user asking "what if the cytotox read were toxic?" is shown the counterfactual.
- **`strength`** — no rule mediates it; it multiplies straight into mass. A per-claim strength dial
  reintroduces at the evidence layer exactly the unregistered knob §12b's fudge-factor answer says does not
  exist.
- **`compoundId`** — defeats the guard at `rules.ts:32` and lets a claim on one compound delete a live
  argument from another's verdict, with a trace that reads perfectly plausible.
- **`id`** — identity for the attack graph, the self-attack guard, the counterfactual key and the
  discount-note map.
- **`availableFrom`** — that is the as-of control's job and it is the hindsight defence. An interpreter that
  can edit it can retroactively make the 2023 murine study visible to the 2021 pass.
- **`provenance`** — not read by the engine, so it cannot affect reasoning; changing it is citation
  falsification with zero analytical benefit.

This exclusion list is what keeps §12b's "no separate knob" answer literally true. The defensible framing,
which belongs in the deck: **a toxicologist contests what the evidence *is*, and the pre-registered rules —
unchanged — recompute what it licenses.**

### 5.4 A proposal is validated before it is displayed

Every `reclassify_field` proposal is run through `EvidenceClaimSchema.safeParse` **on arrival**, not on
apply. `packages/engine/src/schema.ts:26-35` carries a cross-field constraint whose own message states the
stakes: leaving `measuresKeyEvent` non-null on an `in_silico` or `qsar` claim "lets it escape R2's
structural-correlation discount and be weighted like human clinical evidence." The precedent is in the
engine — `plan.ts:174-180` validates every synthetic claim it builds and **throws** rather than reason over
an unvalidated one.

An invalid proposal is a rung miss, not an error: descend, and record the reason. The user never sees a
broken proposal.

### 5.5 The delta — new work, and it must report more than the verdict

The Phase 2 spec claims editing "shows the verdict and belief delta". **It does not.** `Ruleset.tsx:38-41`
renders only current values; the only before/after cue is a CSS transition that animates the change without
stating it.

Apply and re-run are complete and need no work: `useCaseReasoning` is memoised on
`[data, ruleset, asOf, selectedCompoundId]` and a full `reason()` costs 1.46 ms.

**The baseline is the state at the moment Apply is pressed, snapshot there — not the registered baseline.**
An earlier version of this section specified `reason(claims, data.ruleset)` against `reason(workingClaims, ruleset)`,
borrowing the trick `Preflight.tsx` uses for the manifest check. That comparison answers a different question
from the one the panel asks. It measures *registered → now*, so it attributes every edit made since load to
whichever proposal happened to be applied last. Measured on the demo path, where the R1 slider is already
dragged by the time beat 6 applies a challenge:

| sequence | what the registered comparison reported | the truth |
|---|---|---|
| drag R1 to 0.45, then apply the R5 challenge | "Applied — the position moved", belief 0.090 → 0.495, `delta-why` suppressed | R5 is inert on TAK-994; all of it came from the slider |
| apply the R1 challenge, then the cytotox reclassify | "the position moved", belief 0.090 → **0.000** | reads as though cytotox zeroed a belief R1 had raised |

The correction is to snapshot the pre-apply `Reasoning` inside the apply handler and compare against that.
The reason it matters is the reason the panel exists at all: **a confirm-before-apply surface whose delta
credits the interpreter with a reviewer's own edits is not showing the interpretation, it is flattering it**,
and the "did not move, and here is why" state — the one that keeps a judge from reading an inert rule as a
broken app — is exactly the state the wrong baseline suppresses. This section's real requirement is unchanged:
report **belief, plausibility and the gap, not the verdict label alone.**

**Both ends are snapshot, not just the baseline.** Freezing only the "before" side fixed one direction and
opened the other: with the "after" side read live, any change made *after* Apply is credited to the applied
proposal. Measured, at as-of `2021-06-01`, applying the inert R5 challenge and then pressing the
`2023-01-01` as-of button once:

| | `data-moved` | belief | `delta-why` |
|---|---|---|---|
| immediately after Apply | `false` | 0.000 → 0.000 | shown, naming `TAK-994:qsar` |
| after one as-of press | `true` | 0.000 → **0.090** | **suppressed** |

The murine study becoming visible is not something the interpreter did. That is one keystroke away on the
demo path — beats 3 and 4 are both the Case tab, the panel is collapsed by a prop rather than unmounted, and
beat 4 dispatches `setAsOf`. So the applied delta reports the interval between the instant before the
proposal and the instant after it, **and then stops listening.** The "after" snapshot cannot be taken inside
the apply handler, because the dispatch beside it has not re-rendered yet — which is precisely why that same
read is the correct one for the baseline.

**It must report belief, plausibility and the gap, not the verdict label alone.** On TAK-994 the label does
not move between passes (belief 0.000 → 0.090, gap holding at 0.910), so a verdict-only delta reads as
"nothing happened" on the hero case.

**Four of the six rules cannot move the number on TAK-994**, measured: R6's concordance boost is diagnostic
only and is never applied to a mass, and R2/R4/R5 fire only on `TAK-994:qsar`, which carries `strength: 0.0`
and `assertion: "ambiguous"` and therefore commits no mass. Only R1 and R3 move the belief range —
**and R3 only by being disabled.**

That last point was measured while drafting the plan and is sharper than it first looks. On this
fixture R3 acts as a *defeat* rule: the murine claim R3-defeats all four safe claims, and defeat
ignores `strength` entirely. HANDOVER §5.4 records a plan-supplied test that failed for exactly this
reason. So `lower_strength` on R3 is **inert** while `disable` on R3 flips the position to advance —
the two authored R3 challenges differ by the entire verdict, and they sit close together in trigram
space. That is the measured justification for §5.2's rule that `disable` renders visually distinct
and that low-confidence matches never arrive pre-armed, and it means the "did not move" panel must
compute its explanation rather than print one canned string.

That is not a defect and it is not hidden. The confirm-and-apply panel treats **"applied — the position did
not move, and here is why"** as a first-class state, not an edge case that looks broken in front of a judge.
Beat 6 uses a challenge that does move it: lowered R1, `exposureRelevant → true` on the in-vitro panel, or
R3 disabled.

## 6. Surface 2 — the live ablation spot check (specified, not built)

The headline is pre-computed at **25 runs per compound** across the conflict subset with the temperature
disclosed; the live button appends **one** further run.

> **Correction, 2026-08-05.** "With the temperature disclosed" is unexecutable — `temperature`, `top_p`
> and `top_k` are removed on every current Claude model and return a 400. There is no sampling knob to
> set and none to disclose. See `2026-08-05-arbiter-llm-ablation-design.md` §2.1, which supersedes this
> clause and the identical one in master spec §12. Nothing else in this section changes: the live run is
> still a spot check on a pre-computed n, and the button is still gated on that ablation existing. This is safe where five live runs would not have
been: the claim is already established by the pre-computed n, so the live run is a spot check rather than the
evidence, and a concordant live run contradicts nothing.

**Its §11 row is not a ladder rung.** Under every one of the five conditions the behaviour is identical and
is the master spec's own wording: *the button disables with a tooltip and the table is untouched.*

**Gated on** the harness ablation existing. Until then the Validation tab renders the placeholder that
`metric2a_llmConsistency` already carries, which correctly reports its own absence.

## 7. Surface 3 — the navigator

**Endpoint:** `POST /api/navigate`. **Request:** the question plus available anchors. **Response:**

```ts
{ anchorIds: string[], noMatch: boolean }   // ids only — no prose, ever
```

It cannot invent a claim because the return type gives it nowhere to put one. The UI scrolls to, spotlights
and surfaces text that **already exists** at those anchors.

### 7.1 The ladder is made symmetric with Surface 1 — a deliberate departure

Master spec §7 gives the navigator three rungs, no timeout and no similarity threshold, and never says why it
skips the fuzzy step Surface 1 has. Since the walker is shared, the extra rung costs almost nothing, and an
asymmetric threshold is something that has to be explained rather than defended.

| rung | mechanism | source |
|---|---|---|
| 1 | live call, 2.5s timeout | `live` |
| 2 | exact match against the cached question→anchor map | `cache` |
| 3 | trigram Jaccard ≥ 0.55 over the cached questions | `cache` |
| 4 | keyword match over anchor labels and rule statements | `local` |
| 5 | the four suggested questions | `none` |

Recorded as a departure so it does not read as an oversight.

### 7.2 A bad response is not a hallucinated claim, but it is still bad

- **An id not in the registry** is filtered. If none survive, the result is `noMatch`.
- **An id in the registry whose element is not currently mounted** is a distinct case. The conditional
  anchors — `trace.counterfactual`, `trace.nextExperiment`, `validation.singleClassWarning`,
  `evidence.citationStatus`, `ruleset.modifiedBadge` — legitimately do not exist at all times. Switch tab,
  un-collapse the region, then re-check; only then drop it.
- **Never point at nothing.** "The UI surfaces text that already exists" is the entire non-hallucination
  guarantee, and an anchor resolving to an empty element falsifies it as surely as invented prose would.

### 7.3 Mount point and keyboard

A slim persistent bar in `AppShell`, between the tab nav and the tab body, collapsing to one line when idle.
It is global by construction, which is what the surface needs, and a keyboard shortcut focuses it.

Two existing behaviours constrain this and both were measured:

- Building the box as a real `<input>` gets correctness for free: `apps/web/src/ui/isTypingTarget.ts` already
  returns `true` for `INPUT`, so the global `←`/`→`/`M`/`?` handlers suppress themselves. Typing "murine"
  will not kill the demo's motion. Do **not** build it from a `contenteditable` div.
- **`Escape` is deliberately exempt from that guard** and already dispatches `setFocus: null`. So `Escape`
  inside the question box would also clear the Case region focus. The navigator dismisses on a different key,
  and the collision is recorded here rather than discovered during a rehearsal.

## 8. The anchor registry

No DOM `id` exists anywhere in `apps/web/src` today, and nothing scrolls or highlights. This is new surface.

**A new `data-anchor` attribute, not a reuse of `data-testid`.** Five testids are non-unique by construction
(`evidence-row`, `trace-step`, `compound-row`, `rule-card`, `position-row`) — precisely the families that need
per-instance anchors. `provenance` is two different things in two different tabs. Ten are frozen by Playwright
specs and cannot be reshaped. They coexist on the same element.

```ts
interface Anchor { label: string; tab: TabId; region: Region | null }
export const ANCHORS = { ... } as const;
```

`region` is load-bearing: collapsed Case regions **unmount their content**, so while the tour sits on beat 2
no `evidence-row` exists in the DOM at all. The navigator dispatches `setFocus` before scrolling.

**Tab switching reuses the existing mechanism** — `window.location.hash = "#/" + tab`, which is what the tour
and the Compounds row click already do. Note `state.tour.tab` is written but read by no renderer; it is not
the switch. Because `hashchange` fires asynchronously, the target is not mounted on the next statement: a
`pendingAnchor` in state plus an effect that fires once the tab matches, then clears it. **That deferred
resolve is the only genuinely new machinery Surface 3 needs.**

**Typing honesty.** `rule.${RuleId}` is fully typecheckable because `RuleId` is a declared literal union.
Every other dynamic family derives from JSON imported through `resolveJsonModule`, which widens to `string` —
so a template-literal type catches a malformed prefix but **not** a nonexistent claim id. Closed with
constructor functions (`anchors.traceStep(claimId)`) so a prefix is never hand-typed, plus the DOM test in §12.

Claim ids contain `:` (`TAK-994:invivo_rodent`) and baseline names do too (`single:qsar`). **Parse by
prefix-slice, never `split(":")`.**

### 8.1 Three ruleset fields have no anchor because they have no UI

`precedenceOrder`, `precedenceRationale` and `abstentionGapThreshold` exist in the registered ruleset and in
the types but are **rendered nowhere**. So "why does R3 outrank R1?" and "why is the threshold 0.5?" — two of
the likeliest judge questions, both with prepared §12b answers — would return `noMatch` on the strongest
material in the project.

A short block on the Ruleset tab renders the precedence order with its registered rationale and the
abstention threshold with its value. Small, and it makes the pre-registration visible rather than merely
claimed.

### 8.2 The spotlight must honour the motion kill switch, and CSS cannot do it alone

`apps/web/src/ui/motion.css` overrides only `animation-duration` and `transition-duration`. `scrollIntoView({behavior})`
is a JS argument that CSS cannot reach, and neither can the `prefers-reduced-motion` block in `tokens.css`.
A naive spotlight therefore keeps gliding after `M` is pressed — the first thing a judge would notice.

The highlight itself is a CSS transition on a `[data-anchor-spotlight]` attribute, so `motion.css` kills it
for free and it stays measurable the same way the existing Playwright motion test measures
`transitionDuration`. **The scroll branches in JS on both signals:**

```ts
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
el.scrollIntoView({ behavior: motion && !reduced ? "smooth" : "auto", block: "center" });
```

Spotlight duration ≤ 1.5s. It should visually rhyme with the existing region-focus grid transition rather
than introduce a second idiom.

## 9. The evidence working copy

Overrides, not a second claim array: `evidenceEdits: Map<claimId, Partial<Pick<EvidenceClaim, ...>>>`, with
`data.claimsByCompound` and `data.fixture.claims` immutable exactly as `data.ruleset` is. Reset mirrors
`resetRuleset`.

**One refactor comes first.** "Get the claims for the selected compound" is duplicated four times —
`useCaseReasoning.ts:13`, `CaseHeader.tsx:15`, `EvidencePanel.tsx:9`, `Record.tsx:16`. Wired into three of the
four, an evidence working copy produces a verdict computed from evidence the panel beside it is not showing.
One `workingClaims(state, compoundId)` selector beside the existing `visibleClaims`, routed through by all
four, before anything else in this section lands.

### 9.1 The two working copies run at opposite polarity

The ruleset working copy already feeds the 267-row library table — `Compounds.tsx:15` calls
`useLibraryVerdicts()` with no override, deliberately, and `Preflight.tsx:20` passes the registered ruleset
explicitly when it needs a pristine baseline.

**An evidence working copy must not reach that table.** Evidence edits are per-claim on one compound, and a
corpus statistic recomputed over edited evidence is a number computed after seeing a result. So: for the
ruleset, working is the default and registered is the opt-in; **for evidence, registered is the default and
working is the opt-in.**

The conflict column is safe by construction — `detectConflict` runs on raw claims, which is the
pre-registered subset definition and is fixed as a property of the raw claims so it cannot move when rule
behaviour changes. Keep it on `data.claimsByCompound`.

The Validation tab is structurally immune: it reads `data.metrics` and never calls the engine. **Nothing
derived from either working copy may reach a metrics-shaped surface.**

### 9.2 Visibility

A `check-evidence-edits` line in the pre-flight panel beside `check-edits`, worded the same way, and a
per-claim badge in `EvidencePanel` mirroring the Ruleset tab's `MODIFIED` treatment.

One honesty constraint: the ruleset line can say "the ruleset on screen is the registered one" *because*
`check-ruleset` proved it by recomputing the digest. **There is no analogous digest over evidence** —
`data/out/evidence.json` is bundled and schema-validated but never hashed. For the evidence line to be a
check rather than a caption, which is the pre-flight panel's whole stated rule, a registered evidence digest
is computed the same way `browserRulesetHash` is, reusing `canonicalJson`.

### 9.3 A predicate to settle first

`Preflight.tsx:40` tests "edited" by reference (`ruleset !== data.ruleset`); `Ruleset.tsx:25` tests it by deep
compare. Drag a slider and drag it back: the MODIFIED badge clears while the pre-flight panel still warns of
live edits. It errs safe, so it is a wart rather than a hole — but a second working copy needs the same
question answered, so pick one predicate before adding one.

## 10. The API service and the pre-flight rewrite

Two thin handlers on the same Railway service as the static app, therefore same-origin, therefore no CORS.
**The key lives server-side and never enters the browser bundle.** With no key configured the endpoint
returns `503 {"error":"no_key"}`, which the client treats exactly like a timeout by the §3 invariant.

**The pre-flight panel currently ships a line that this phase makes false.** `check-network` reads *"All data
is bundled into this page. No network call is made at any point, so losing the connection mid-demo changes
nothing."* True today; false on a served build with a live surface. Master spec §9 requires the panel to list
"which live paths are healthy and which are on cache", and the component's own docstring insists every line
is a check computed now, not a caption.

It is replaced by per-surface rung reporting driven by the same `source` value the resolvers already return.
On the static build every surface reports `cache`, which is both honest and reassuring — it is the state the
ZIP is supposed to be in.

## 11. Error handling and degradation

The five §11 conditions and how each is produced:

| condition | produced by | result |
|---|---|---|
| network-off | `liveEnabled` false, or `fetch` rejects | rung-1 miss |
| HTTP 500 | non-2xx status | rung-1 miss |
| malformed JSON | body parse throws | rung-1 miss |
| timeout | 2.5s `AbortController` | rung-1 miss |
| missing key | `503 {"error":"no_key"}` | rung-1 miss |

**The response is schema-validated, not merely parsed.** Malformed JSON fails loudly; a 200 carrying
well-formed JSON of the wrong shape does not, and that is the case that would otherwise reach the confirm
panel. A schema failure is a rung-1 miss like the rest.

Three failures deliberately do not collapse into that, and are handled where they occur: a proposal that
parses but is schema-invalid (§5.4), an anchor id absent from the registry, and an anchor declared but not
currently mounted (§7.2).

Engine errors are already contained per row by `useLibraryVerdicts` and counted by the pre-flight panel's
`check-errors`; this phase adds nothing there.

## 12. Testing

Master spec §11 requires each surface exercised against all five conditions, asserting the UI still renders
and degrades to the **correct rung**. The §3 invariant collapses fifteen bespoke tests into:

- one thorough test of the walker — a missing rung descends, a hitting rung stops, `rung` and `source` are
  correct;
- five transport tests, one per condition, each proving it produces a rung-1 miss;
- three per-surface tests asserting the right rung answers under a forced rung-1 miss;
- Surface 2's single row: disabled button, tooltip, table untouched.

Plus two cheap content tests worth more than they cost: every cached challenge references a real rule id and,
for reclassify entries, a schema-legal field and value — which stops the authored cache drifting from the
ruleset; and every declared static anchor resolves in the DOM when its tab is active, which catches a
registry entry whose element was renamed.

**Three traps, written down because HANDOVER §5.1 exists precisely because they recur:**

1. Asserting "the ladder produced an answer" **passes on every rung** and is worthless. Assert on `rung`.
2. Asserting `noMatch` for an empty anchor list asserts a value that is `0` under every implementation.
   Assert the specific ids that were filtered out.
3. The `file://` test must assert on **attempted** requests, not failed ones. `static-file.spec.ts` already
   does exactly this and is the model.

**`apps/web/e2e/static-file.spec.ts` is not modified.** It must still pass unchanged with all surfaces on
cache. Master spec §11 also explicitly excludes LLM content quality from testing — only schema validity and
failure behaviour are testable, and pretending otherwise would be dishonest.

## 13. The cache artifacts

Authored from §12b's prepared Q&A, the seven demo beats and the six registered rules, then reviewed by a team
member for domain plausibility. Thirteen challenges cover all six rules; four are marked `confidence: "low"`
because they object to the discount *mechanism* rather than a named rule and a reasonable interpreter could
land them on R1, R3 or all six.

**The challenge cache is for proposed *changes*; the navigator map is for *questions*.** "Did you tune the
rules to fit DILIrank?" is not a change request, and an entry for it would have to invent a rule edit to
justify its own existence — exactly what confirm-before-apply exists to prevent. It belongs in the anchor map.

Three entries need a toxicologist rather than an engineer, and are flagged in place: treating a >100×
in-vitro margin as `exposureRelevant`, clearing a Klimisch score on a QSAR claim as a category error, and
whether the ICH M3 two-species phrasing is how a reviewer actually opens that objection. The last matters
more than it looks, because these strings are what live input is matched against at rungs 2 and 3.

## 14. Corrections this document records

1. **Master spec §7's navigator ladder is extended** from three rungs to five (§7.1), deliberately.
2. **HANDOVER §3.3 cites "spec §6" for responsiveness.** That content is in **§4 Deployment**; §6 is the data
   layer.
3. **HANDOVER §3.3 cites "§13" for the prepared Q&A.** It is **§12b**; §13 is Pfizer values.
4. **`types.ts:36-37` says every claim field is consumed by exactly one rule.** Three feed two rules each:
   `stream` → R6 and R2, `system` → R1 and R2, `measuresKeyEvent` → R2 and R5. Reclassifying one field can
   move two rules at once, which the confirm panel must be able to describe.
5. **The Phase 2 spec claims editing shows a verdict and belief delta.** No delta is computed or rendered
   anywhere (§5.5).
6. **The pre-flight `check-network` line becomes false** on a served build (§10).

## 15. Risks

- **The live path is never exercised in anger.** Mitigated by design — it is one rung, and the demo path does
  not depend on it. The residual risk is that a Railway deploy landing late is the first real test of code
  written weeks earlier.
- **The authored cache is the product.** If the phrasing is unrepresentative, rung 3 misses and the surface
  degrades to keyword matching in front of a judge. Mitigated by drawing the strings from §12b, and by the
  domain review.
- **The evidence working copy touches the integrity story.** Mitigated by §5.3's exclusion list, §9.1's
  polarity rule, and the widened evidence snapshot in the hash-chained audit log.
- **Scope.** Three surfaces, an anchor registry, an evidence working copy and a service is a lot for the
  window §14 allots. The cut order is already decided and is not reopened here.

## 16. Explicitly not decided here

- The harness ablation — prompt, evidence serialisation, consistency metric, caching, and how committed run
  data stays out of `golden:update`'s way. Its own task, its own spec.
- The provider, model and temperature for Surfaces 1 and 3. Master spec §11 refuses to test content quality,
  so these are unguarded by tests; they are a deployment decision recorded at deploy time, and §8 already
  requires the ablation's temperature to be reported.
- Whether the navigator may change the selected compound. It requires `selectCompound`, which is a data
  action rather than a presentational one. The pattern to follow is the tour's: the navigator dispatches
  `setFocus` itself, and any compound change goes through the existing action, visibly, exactly as a user
  would.
- `Reasoning.rulesetHash` is passed as `""` by `useCaseReasoning.ts:16`, so the engine's result object carries
  an empty hash in the browser. Nothing reads it and no claim is falsified, but it is the third `*Hash` field
  in this area that does not hold a hash.
