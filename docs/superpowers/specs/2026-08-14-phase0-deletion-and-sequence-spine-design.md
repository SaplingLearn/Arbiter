# ARBITER — Phase 0: deletion, and the sequence spine

**Status: design, recorded 2026-08-14. First of three specs for the redesign.**
Spec 2 covers the LLM extraction/confirmation pipeline (Phase 1). Spec 3 covers the
stages themselves (Phases 3–9). This one covers Phase 0 only, plus the architecture
decision Phases 3–9 all rest on, which has to be recorded before any stage is built.

---

## 0. Thesis, and what it retires

ARBITER is the reasoning layer between conflicting preclinical toxicity signals and
an accountable decision. It is not a predictor. The accuracy headline is retired:
0.500 on the corrected target, `results/rescore-v2.json`, and no pipeline tested
clears 0.601.

Subsystem B is the product spine; A's deterministic engine is the reasoning core
inside it. The seven-tab shell becomes **four tabs**, two of which host a
**six-stage sequence**.

---

## 1. The baseline this plan is measured against

Recorded 2026-08-14, before any change:

| gate | result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm test` | 1123 tests, 93 files, all passing |
| `npm run web:build` | ok, `dist/index.html` 1,196 kB |
| `npm run e2e` | 12 passing |
| `npm run golden:update && git diff --exit-code results/` | no diff |

`apps/web` holds 389 of those 1123 tests. Every commit in this spec restores all six
gates before the next one starts.

---

## 2. The architecture, decided before any stage

This section is load-bearing and is the reason the spec exists now rather than with
Phase 3. Retrofitting shared-element motion onto unmounting routes means rebuilding
all six stages.

### 2.1 One mounted tree, one index

The six stages are **not** routes. `<Sequence stage={n}>` mounts every stage's
content once and never unmounts it. `parseHash` resolves a stage index into that
tree's prop. A stage change is a prop change, never a remount.

The four source nodes in stage 1 must *become* the four weighted bars in stage 2 and
*merge* into stage 3's three segments. A node that must survive stage 1 cannot be
owned by stage 1.

### 2.2 Shared elements live in fields, not in stages

Three field components own the persistent nodes and span their ranges:

| field | spans | one node per | keyed by |
|---|---|---|---|
| `SourceField` | stages 1–3 | evidence claim | `claim.id` |
| `SeatField` | stages 4–5 | participant | participant id |
| `QuestionField` | stages 5–6 | checklist item | `M1..M6`, `C1..C6` |

Each field receives the stage index and returns **layout only**. Stage-local chrome —
headings, narration, controls — lives in `StageLayer` components. A field never
unmounts; a layer never moves a shared node.

### 2.3 Layout is data

Each field holds one table, `(nodeId, stage) → {x, y, w, h, opacity}`, applied to the
persistent node as CSS custom properties. Changing the stage changes numbers.

This is what gives every stage a **static end state for free**. A stage rendered cold
at its own index reads the same table and lands in the same place, with no transition
having run. There is no second code path for the cold case, so the cold case cannot
drift from the animated one. Every stage is tested cold at its own index, not only as
the destination of a transition.

### 2.4 Motion

CSS transitions on `transform` and `opacity` only. No JS animation.

This is not a preference. `motion.css` drops `[data-motion="off"] *` to
`transition-duration: 0.01ms !important`, and `tokens.css:144-147` does the same
under `prefers-reduced-motion: reduce`. Both already exist and are already tested.
A JS animation would silently escape both, and the argument is carried by motion, so
it must survive motion's absence.

### 2.5 Inertness, written once

`<StageLayer active>` sets `inert`, `aria-hidden`, and `data-stage-active`. One test
helper, `withinStage(index)`, scopes every query to `[data-stage-active="true"]`.

Every test that asserts on visible text goes through that helper. The rule has no
exceptions, because the failure it prevents is a test passing by reading text nobody
can see.

Two implementation notes. React 18.3 has no first-class `inert` prop, so it is
applied as a literal attribute. jsdom sets the attribute but does not implement
focus-blocking, so "not focusable" is a Playwright assertion and cannot be a vitest
one.

### 2.6 The one exception: the commit gate

`CommitGate.tsx` guarantees **DOM absence**, not hiding.
`commitGate.test.tsx:96-106` asserts `verdict-reason`, `belief-fill`,
`[data-anchor="trace.mass"]` and `[data-anchor="trace.beliefTrack"]` are all `null`
before the reader records a call, and the gate's own copy says "Only the conclusion
is held back".

Stage 3 *is* the conclusion. Always-mounting it would put the verdict in the DOM from
first paint and degrade the gate to a rendering convention — the exact failure
`deliberation.ts:270` refuses on the blind-position path: *"a rendering convention is
one forgotten conditional away from being nothing at all."*

**Therefore:** stage 3's verdict sentence, threshold marker and mass numbers mount on
commit. `SourceField`'s bars are shared and stay mounted, so the 2→3 transition is
unaffected — the bars are what move, the conclusion is what arrives. The leak
assertions keep asserting absence and stay real.

---

## 3. The four tabs

| tab | holds |
|---|---|
| **Case** | stages 1–3: the conflict → the weighing → the position |
| **Room** | stages 4–6: the room → the gap → the record |
| **Ruleset** | the six registered rules, strengths, precedence, pre-registration hash |
| **Validation** | the corpus numbers, absorbing About and Compounds |

The cut between Case and Room is forced: `SeatField` spans 4–5 and `QuestionField`
spans 5–6, so 4–6 is one connected chain group and cannot be split. `SourceField`
spans 1–3 likewise.

Within a tab, navigation is **forward and back only**. There is no jump-to-stage
affordance. Deep links still resolve, for testing and for resuming.

Ruleset stays whole rather than folding into the drawer because the
divergence-from-`PRE_REGISTERED_HASH` disclosure needs a home that is not only a
governance surface.

---

## 4. Routing

`TAB_IDS` becomes two things:

- `TABS`, the four-tab tuple
- `STAGES`, an ordered tuple of the six stages, each declaring which tab owns it

`parseHash` resolves a `{tab, stage}` pair. Navigation exposes `next`/`prev` within
the owning tab, and tab selection across tabs.

**S-6 applies:** `router.test.ts` currently pins route names as hardcoded string
literals (`"#/validation/"`, `"#/record?x=1"`, `"#/about/"`). Those become exported
constants so a rename moves both ends at once.

---

## 5. The six stages as data

`buildBeats(data)` becomes `buildStages(data)`. `Beat.tab` and `Beat.focus` both die;
`Stage` gains an index and an owning tab.

`Beat.tab` dies free — `useAnchorScroll.ts:17` already records that `state.tour.tab`
is "written by `setTourBeat` and read by no renderer". `Beat.focus`'s only consumer
is `Case/index.tsx:11-17`, which collapses the three case regions; it dies with the
tab shell, and `Region` goes with it.

| stage | tab | subject |
|---|---|---|
| 1 the conflict | Case | TAK-994 at `postMurineStudy` |
| 2 the weighing | Case | each source discounted, by a named rule |
| 3 the position | Case | three-segment mass bar and the threshold |
| 4 the room | Room | blind positions, then reveal |
| 5 the gap | Room | twelve questions, two rows of six |
| 6 the record | Room | signed, hash-chained, tamper-checked |

**Stage 1 shows all six of TAK-994's claims at `postMurineStudy` (2023-01-01).**
Measured from `data/out/tak994.json`: four `safe` (`invivo_rodent`,
`invivo_nonrodent`, `cytotox`, `transporter`), one `ambiguous` (`qsar`, strength 0.0),
one `toxic` (`toxicogenomics-murine`, `exposureRelevant: true`).

Six, not four. This is the only as-of state in which TAK-994 genuinely disagrees with
itself — at `preFirstInHuman` only five claims are visible and none of them conflict.
Showing four would give the round number at the cost of a stage-3 mass bar that is
not derivable from the cards in stage 1, because `reason()` fuses all six. The
narration carries the shape instead: four say advance, one says stop, one resolves
neither way.

### 5.1 What each stage contains after Phase 0

Phase 0 lands the spine, not the stages. So:

**Stages 1–3 render the surviving Case tab content, remapped onto the stage index.**
The three regions `Case/index.tsx` collapses today — evidence, trace, header — become
the initial contents of stages 1, 2 and 3 respectively, mounted in the always-mounted
tree instead of collapsed by `tour.focus`. Nothing is lost and nothing regresses: the
same panels render, driven by a stage index rather than a focus region. Phases 3, 4
and 5 then replace each one in place, which is what makes each of those phases
revertible in a single commit.

**Stages 4–6 have no content in `apps/web` until Phases 6 and 7 build them.** They are
present in `buildStages` with their narration and marked `built: false`; `next`/`prev`
skip them; the indicator reads "Stage n of 3 (6 planned)" and grows as each phase
flips a flag.

This is stated on screen rather than hidden. A tour that walks into an empty stage is
worse than one that says how far it currently goes.

---

## 6. The deletion series

Nine commits. Each restores all six gates before the next begins.

### C1 — landing reads the re-grade instead of retyping it

`Result.tsx:25-28` hardcodes the v1.0 baselines table as string literals and
`Metrics.tsx:37` hardcodes "0.500 … 0.601" in a note. Both read from
`results/rescore-v2.json` instead.

`apps/landing` has no `@arbiter/engine` dependency and no bundle module, and
`apps/web/src/data/rescore.ts` lives in an app landing cannot import from. The
`RescoreDocument` types and the `populationAt` / `pipelineAt` / `bestPipeline`
accessors move into `@arbiter/engine`, which already hosts `MetricsDocument` as an
inert type declaration for exactly this reason, and landing takes the dependency.

**As a subpath export, `@arbiter/engine/rescore`, not through the root barrel.**
`index.ts` re-exports `schema.ts`, which imports zod; importing the root would pull
zod into the landing bundle for the sake of three accessor functions. The subpath
keeps landing's dependency to the module it actually reads. Landing also gains the
`{ "path": "../../packages/engine" }` project reference `apps/web/tsconfig.json`
already carries.

Every figure needed is present: v2.0 / `fullSplit` gives ARBITER 0.500 and
`bestPipeline` gives `single:qsar` at 0.601. `bestPipeline` is derived rather than
named, so the "nothing clears 0.601" sentence cannot outlive a re-grade that moves it.

Independent of every other commit.

### C2 — relocate the crypto floor

`src/record/chain.ts` is not the Record tab. `data/rulesetHash.ts:3` and
`data/evidenceDigest.ts:3` both import `sha256Hex` from it, and both feed the
`PRE_REGISTERED_HASH` comparison, which is a standing constraint rather than a
Record-tab feature.

`sha256Hex` and `canonicalRecord` move to `src/crypto/digest.ts`. `evidenceSnapshot`'s
whole-object discipline — *the claim is included whole, exclusions none, and a new
exclusion must answer what makes that field something a reviewer did not endorse* —
carries across to B's chain as a shared, tested rule **before** C7 deletes A's copy.

Prerequisite for C7.

### C3 — relocate the anchor registry

`src/ai/anchors.ts` is not an AI surface. Four surviving components import from it:
`Ruleset.tsx:3` (`ruleAnchor`), `Case/TracePanel.tsx:4` (`traceStep`),
`Case/EvidencePanel.tsx:4` (`evidenceClaim`), `Record.tsx:5` (`recordPosition`).

It moves to `src/anchors.ts` unchanged. The 18-test DOM sweep in `anchors.test.tsx`
moves with it and keeps catching renames. The registry is retired in Phase 8, when
the tab dimension it encodes stops existing.

Prerequisite for C4.

### C4 — delete the navigator and the challenge interpreter

Deletes `apps/web/src/ai/**` (now minus `anchors.ts`): `navigate.ts`,
`NavigatorBar.tsx`, `interpret.ts`, `resolve.ts`, `trigram.ts`, `client.ts`,
`useAnchorScroll.ts`, `spotlight.css`, and `cache/`.

**120 tests go with them in this commit**, measured: `client` 14, `interpret` 14,
`interpretCache` 7, `navigate` 16, `navigatorBar` 9, `resolve` 7, `trigram` 10,
`failureMatrix` 15, `rung1` 8, `tablePanel` 20. `anchorScroll.test.tsx` (8) goes with
`useAnchorScroll`.

Three call sites are edited in the same commit:

- `App.tsx:13-14` drops `NavigatorBar` and `useAnchorScroll`
- `Preflight.tsx:6-9,146-160,300-314` drops the two `check-surface-*` lines, the
  probe effect, `PROBE_CHALLENGE`/`PROBE_QUESTION`, the `Reported` type and the
  `surfaceLine` renderer. The remaining **seven** checks — `check-ruleset`,
  `check-manifest`, `check-errors`, `check-edits`, `check-evidence-edits`,
  `check-evidence`, `check-bundle` — are untouched. `preflight.test.tsx` (19 tests)
  is edited here too: it mocks `../src/ai/interpret.js` and `../src/ai/navigate.js`
  at lines 8-9 and 23, so it does not survive the deletion unedited
- `Case/TablePanel.tsx:13-14` drops `interpret` and `Resolution`, **keeping** the
  table and the manual reclassify path, which is the direct ancestor of Phase 1b's
  accept/edit/reject UI

**`e2e/ai-static.spec.ts` is rewritten in this same commit.** Measured, not assumed: a
throwaway Playwright probe confirms `expect(locator).not.toHaveAttribute(...)` against
an element that does not exist **fails by timeout** — it does not pass. So deleting
the surfaces turns test 1 red, loudly. The vacuum arrives one step later: the obvious
repair is deleting the two failing assertions, and what remains is
`expect(attempted).toEqual([])` on a page with no network code at all, under a file
header describing resolvers that no longer exist.

Test 1 is therefore rewritten to assert the zero-network guarantee against what
actually remains, or deleted with its reason recorded — not silently reduced. Test 2
(`check-evidence-edits`, Web Crypto over `file://`) is genuinely load-bearing, is not
an AI surface, and survives unchanged.

### C5 — split the provider layer out, then delete the handlers

`services/api/interpret.ts` is two modules under one name, and the Gemini integration
is the half that must survive. Lines 1–190 are the Surface-1 handler. Lines 191–416
are the provider layer: `CallShape`, the five `SHAPE_*` constants, `CallKind`,
`resolveModel`, `providerFor`, `buildComplete`, `completeFromEnv`, and
`DEFAULT_ADJUDICATION_MODEL = "gemini-3.5-flash"`.

Nine modules import from it — `navigate.ts`, `ask.ts`, `summarise.ts`, `gemini.ts`,
`deliberation-demo.ts`, `probe.ts`, `adjudicate.ts`, `server.ts`, `ask-eval.ts`.
Deleting the file wholesale would delete the Vertex plumbing Phase 1 is built on.

So: the provider layer moves to `services/api/provider.ts`; `handleInterpret` and
`InterpretRequest` are deleted; `navigate.ts` and `fixture-propose.ts` are deleted
with their tests; `server.ts` loses the three routes.

### C6 — delete intake

`src/intake/**`, `tabs/Intake.tsx`, and `customCompounds` from the store — the state
field, the `addCustomCompound` action, the reducer case, and the `resolveClaims`
fallback at `store.tsx:258`. 33 tests go (`intake` 18, `intakeTab` 15).

`applicabilityDomain.test.tsx:67` seeds a `null`-domain claim *through*
`customCompounds` and needs a new seeding path in this same commit. It is testing R4's
`null`-is-benign asymmetry, which is a real engine property and must not be lost with
the surface that happened to reach it.

### C7 — delete the Record tab

`tabs/Record.tsx` and `src/record/`, with `record.test.tsx` (3) and `chain.test.ts`
(13). `ReviewerPosition` and `positions` leave the store. B's chain supersedes it, and
C2 has already carried the whole-object discipline across.

`anchors.test.tsx` and `keyboard.test.tsx` both mount `RecordTab` and are edited here.

### C8 — the two remaining removals

`Validation.tsx:194-204`, the disabled Surface-2 button, and `Validation.tsx:184`, the
`JSON.stringify(m.metric2a_llmConsistency)` line. `data/prep/spike_conflict_count.py`.

The Surface-2 button was disabled under six conditions and is now unreachable under a
seventh: the interpreter it belonged to is gone.

### C9 — the sequence spine

`STAGES` and `TABS`; `buildStages`; the always-mounted `<Sequence>` shell with its six
`StageLayer`s and the three fields; the `withinStage` helper; the four-tab nav
replacing the seven-tab one; `next`/`prev`.

**About and Compounds fold into Validation here.** The four-tab structure has no seat
for either, and both are corpus-level rather than case-level: `About.tsx` explains the
method and names the three causes of the decline rate, `Compounds.tsx` renders the
267-row library with `compounds.conflictRate` and `compounds.declineNote`. They become
sections of the Validation tab, which already carries the stream-coverage table and
the single-class warning they refer to. `about.test.tsx` and `compounds.test.tsx` are
rewritten to mount them in their new home, not deleted — the honesty assertions in
both are the point of the tab.

Rewritten in this commit, not deleted:

- `beats.test.tsx:26` — "exactly eight, indexed 0..7" becomes six
- `beats.test.tsx:125` — "contrast beat before validation beat" is restated against
  stages
- `e2e/demo.spec.ts:27-33` — 7×ArrowRight ending on `#/validation` becomes the
  built-stage walk
- `e2e/static-file.spec.ts:60-81` — the `Beat \d of 8` regex and
  `new Set(seen).size === 8` become six

`Case/index.tsx`'s region collapsing and `tour.focus` go here, with `Region`.

---

## 7. What Phase 0 does not do

- No stage content. Stage 3 is built in Phase 3, stage 2 in Phase 4, stage 1 in
  Phase 5, stages 4–5 in Phase 6, stage 6 in Phase 7.
- No drawer. The "what we can't claim" drawer is Phase 8.
- No dense "show everything" view. Phase 9.
- **No probe re-run.** Measured: this environment has no `ARBITER_GCP_PROJECT`, no
  `GOOGLE_CLOUD_PROJECT`, no ADC file and no `ANTHROPIC_API_KEY`. `npm run probe`
  would fall to `stubComplete` and overwrite the committed 20-run **live**
  `gemini-3.5-flash` measurement in `results/probe-runs.json` with a run the report
  itself calls "NOT A RESULT". Today's `STALE PROBE` output is the honest state. Spec
  2 fixes `consistency-report.ts:87`'s "Set ANTHROPIC_API_KEY", wires the live
  adjudicator, and adds a guard so a stub can never overwrite a live run.
- `apps/harness/src/ablation/**` is parked, not deleted.
- `apps/landing` is not deleted. Only C1 touches it.

Phase 8 shrinks as a result of C9: the shell it was going to build already exists, so
it reduces to the drawer, the progress indicator and polish.

---

## 8. Standing constraints

These bind every commit in every phase, not only Phase 0.

1. `rules/ruleset-v1.0.json` is pre-registered and hashed. **Never written.** Strength
   edits go to a session overlay. Any divergence from `PRE_REGISTERED_HASH` is visible
   beside the call, not only on a governance surface.
2. The README language-discipline table binds UI copy: *position* not decision,
   *hash-chained audit log* not blockchain, *review-ready evidence package* not
   regulator-ready dossier, *the committee decides* not the system decides,
   *positions / sign-off / decision owner* not voting / tally / majority.
3. Any number rendered to a user carries its population — "n = 61, conflict subset" —
   never bare. The conflict subset is n=61; the full scored split is n=267.
4. Deleting a component deletes its test file in the same commit. `tsc` does not
   report unreferenced files and the eslint config has no unused-module rule
   (`@typescript-eslint/no-unused-vars` catches identifiers, not modules), so an
   orphaned component passes its own tests forever.
5. Before each deletion, confirm no test passes vacuously afterward.
