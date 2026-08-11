# ARBITER Phase 2 - the web app

**Date:** 27 July 2026 · **Submission due:** 16 August 2026 · **Data freeze:** 2 August 2026

Companion to `2026-07-26-arbiter-design.md` (the master spec). This document decides what the master spec
left open for the application layer, and records three corrections that measurement forced. Where the master
spec is already specific - the token palette (§9), the five-tab split (§9), the consensus record model
(§7a), motion rules and accessibility (§9) - this document does not repeat it.

## 1. Scope

**In scope.** A React single-page application at `apps/web`: the shell, hash router, design tokens, data
loading, all five tabs, the guided tour, motion, and the static offline build.

**Out of scope, deferred to the Phase 3 spec.** The three AI surfaces (challenge interpreter, live ablation,
navigator) and the API service that backs them. Two of the three mount inside Case-tab regions that do not
exist yet, so their spec is written after this app runs.

The seam is infrastructure: everything here works with no server and no API key. Phase 3 adds a deployed
service, credentials, and fallback ladders - different risk, different failure modes.

## 2. The decision this app rests on: the engine runs in the browser

`@arbiter/engine` is bundled into the client and executed there. Verdicts are **computed**, not read from a
precomputed file.

**Why it is load-bearing.** Three promised features are impossible without it. The Ruleset tab's "edit a
strength → re-run → see the delta" needs live recomputation. So does the as-of control, and so does beat 6's
challenge → apply → re-run. With precomputed verdicts these become canned animations: a judge who moves a
slider gets nothing back, which is worse than not offering the slider.

**Why it is cheap.** The engine is pure TypeScript with one runtime dependency (`zod`), no clock, no I/O, no
`node:*` imports. The purity lint added in Task 7 has been enforcing exactly the property that makes this
possible, on every commit, for the whole project. It bundles as-is.

**Three consequences, all good.**

- `results/results.json` stops being the source of truth and becomes a **cross-check**. The app recomputes
  and can assert agreement with the committed harness output. That is a property worth showing a judge.
- The bundle shrinks. `results.json` (676KB) is almost entirely recomputable and is therefore **not
  bundled**; only its `rulesetHash` and per-compound verdict are, as a compact cross-check manifest.
- The static `file://` build is functionally complete on its own, which the master spec's deployment section
  already assumes.

**The cost, and the mitigation.** Running the full `reason()` - which includes the ~130-evaluation
counterfactual search and the planner - across 267 compounds on page load would be slow. So:

- The **Compounds tab uses `reasonVerdictOnly`**, which skips both. Cheap enough for the whole library.
- The **Case tab uses full `reason()`**, for one selected compound at a time.

This is exactly the split `reasonVerdictOnly` was introduced for in Task 8.

## 3. Data loading

**All data is imported as ES modules at build time. There is no runtime `fetch`.**

This is forced by the offline requirement: over `file://`, `fetch()` of a sibling JSON file is blocked as a
cross-origin request in Chrome and Edge. A served build could fetch and a static build could not, which
would mean two code paths and one of them untested. Importing JSON gives one path that works in both.

Bundled inputs, ~1.2MB raw:

| File | Purpose |
|---|---|
| `data/out/evidence.json` | every claim, the app's primary input |
| `data/out/compounds.json` | names, SMILES, DILIrank label, truth |
| `data/out/splits.json` | which compounds are the reportable test split |
| `data/out/tak994.json` | the fixture, its as-of milestones, `citationStatus` |
| `rules/ruleset-v1.0.json` | the pre-registered ruleset |
| `data/assays.json` | planner operator catalogue |
| `results/metrics.json` | the Validation tab's numbers |
| *(new)* `results/verdict-manifest.json` | compact `{compoundId, verdict, belief}` cross-check |

`verdict-manifest.json` does not exist yet. **Emitting it is the first task of this phase**: a dozen lines
added to `apps/harness/src/main.ts` writing `{rulesetHash, rows: [{compoundId, verdict, belief}]}`. It is
listed here rather than assumed because a plan that starts with the app would find the file missing.

**Everything is validated on load** through the engine's existing zod schemas, and a failure is an explicit
error screen naming the file - never a blank app or a silently empty library.

## 4. Module boundaries

```
apps/web/src/
  main.tsx                  mount, error boundary
  router.ts                 hash router; TabId union
  data/
    bundle.ts               the JSON imports, in one place
    load.ts                 validate + index into lookup maps
  engine/
    useCaseReasoning.ts     memoised full reason() for the selected compound
    useLibraryVerdicts.ts   memoised reasonVerdictOnly across the library
  state/
    store.ts                app state + actions (see §5)
  tabs/
    Compounds.tsx
    Case/
      index.tsx             three-region grid + spotlight
      CaseHeader.tsx        compound, verdict, as-of control
      EvidencePanel.tsx
      TracePanel.tsx
      BeliefTrack.tsx
      TablePanel.tsx        Phase 3 mounts the interpreter here
    Ruleset.tsx
    Validation.tsx
    Record.tsx
  tour/
    beats.ts                the seven beats, as data
    TourFooter.tsx
  ui/
    tokens.css              master spec §9 palette, one file
    primitives/             Dot, Rail, VerdictLabel, Hairline, ...
```

Each unit answers the three questions cleanly: `data/load.ts` turns raw JSON into validated lookup maps and
depends on nothing but the schemas; `engine/*` derives reasoning from state and depends only on the engine;
tabs render and dispatch, and never compute a verdict themselves.

Data flows one direction: **bundle → load → store → derive → render**. No tab writes to `data`.

## 5. State model

```ts
type TabId  = 'compounds' | 'case' | 'ruleset' | 'validation' | 'record';
type Region = 'evidence' | 'trace' | 'table';

interface AppState {
  data: LoadedData;                    // immutable after load
  ruleset: Ruleset;                    // editable working copy, resettable
  asOf: string | null;                 // ISO date; null = all evidence visible
  selectedCompoundId: string;
  tour: { beat: number; tab: TabId; focus: Region | null };  // beat 0..6, seven beats
  positions: ReviewerPosition[];       // master spec §7a shape
  motion: boolean;
}
```

**No state-management dependency.** React `useReducer` behind one context provider. The state above is small,
entirely synchronous, and derived values come from memoised engine calls rather than from stored copies -
a store library would add a dependency and an indirection for no benefit. This matches the discipline that
kept the engine at one runtime dependency.

**The tour holds no data, and this is enforced by construction.** The master spec requires that guided and
free-navigation modes cannot disagree. But beats 5 and 6 *do* change data - beat 5 moves the as-of date,
beat 6 applies a rule edit. The resolution: a beat definition carries an optional list of **the same actions
a user could dispatch manually** (`setAsOf`, `setRuleStrength`). The tour never holds its own copy of a
verdict or a ruleset; it drives the identical code path a human would. Advancing a beat and clicking the
control by hand are the same operation, so the two modes cannot diverge.

**Ruleset edits never touch `ruleset-v1.0.json`.** The working copy is in memory, the header shows the
pre-registered hash alongside a "modified" badge the moment it diverges, and a reset restores the registered
values. An edited ruleset must never be presentable as the registered one.

## 6. The five tabs - deltas from the master spec only

### Compounds - tag by conflict, not by verdict

The master spec tags each compound agree / conflict / abstain. Measured, 260 of 267 abstain, so a
verdict-tagged library is a flat grey wall that tells a worse story than the truth.

**Primary axis is conflict status** - 61 of 267, 22.8% - which is the number that proves the hero case was
not cherry-picked, and which is healthy. Verdict is a secondary column. The header states both: *"61 of 267
compounds have streams in genuine conflict. ARBITER declines on 260 - see Validation for why."*

### Case - unchanged in structure, with a corrected beat 5

Three regions, spotlight via `grid-template-columns`, as-of control in the case header, exactly as the master
spec specifies. The corrections are in what it displays, not how:

- **The belief track is the hero visual.** Pass 2 moves belief 0.000 → 0.090 with the range staying open; the
  verdict label does not change. The animation the master spec wanted - the gap spreading outward from
  centre - is now carrying the beat rather than decorating it.
- **The evidence panel states how many claims the current as-of date hides**, so the two-pass replay is
  legible rather than mysterious.
- **The planner names a human BSEP assay, not the murine study.** Beat 5's script is corrected in the master
  spec; the UI simply renders `nextExperiment`.

### Ruleset - the tab that needs the browser engine

R1–R6 with statement, framework citation, and an editable strength slider. Editing recomputes the current
case live and shows the verdict and belief delta. Disabled rules are togglable. The registered hash and a
"modified" badge sit in the header.

This is where "expert-governed, not algorithm-invented" becomes touchable, and it is the tab that would be
theatre if verdicts were precomputed.

### Validation - coverage before accuracy

The master spec orders this tab by metric. Measurement reorders it: **n and coverage are shown before any
accuracy figure**, and `singleClass` is rendered as a visible warning rather than being a field in a JSON
file nobody opens.

The tab must be able to state, in its own words, that ARBITER commits on 4 of 61 conflict-subset compounds
and the best baseline on 3 - and that the number that *is* reportable is the planner's 0.992 stability under
±50% prior perturbation. `metrics.json` already emits every field this needs, including the warnings.

### Record - as specified

The consensus record model in master spec §7a is implemented as written, including `evidenceSnapshotHash`,
`prevRecordHash`, and `signatureMethod: 'demo-persona'`. The hash-chained audit log is described as exactly
that and **never as a blockchain**.

## 7. Error handling and degradation

The demo must survive every failure that does not involve the machine being off.

| Failure | Behaviour |
|---|---|
| A bundled JSON file fails schema validation | Explicit error screen naming the file and the failing path. Never a blank app. |
| `reason()` throws on one compound | Caught per-compound; that row renders as an error; the rest of the library and the app stay usable. |
| A ruleset edit produces an invalid ruleset | Rejected at the input with a message. State never becomes invalid. |
| `verdict-manifest.json` disagrees with a live recomputation | A visible, non-fatal banner. This is a real finding, not something to swallow. |
| Opened over `file://` | Identical behaviour. No fetch, no server, no cold start. |

## 8. Testing

Vitest, already the repo's runner, with `@testing-library/react` and `jsdom` for anything that renders. No
second test framework.

- **Unit** - router, store actions, `data/load.ts` validation, each `ui/primitive`.
- **Component** - every tab renders from a fixture without touching the real bundle.
- **The seven-beat integration test.** This is the important one. A test drives the tour from beat 0 to beat
  6 and asserts, at each beat, the verdict, the belief, and the planner recommendation that the master spec
  claims. **Beat 5 was wrong in the spec for a week and nothing caught it.** This test is what makes that
  class of failure impossible to ship again, and it must fail loudly if the engine, the fixture, or the
  script drift apart.
- **Playwright walk** - the full demo path end to end, headless, in CI.
- **Accessibility** - contrast ≥4.5:1, keyboard-only traversal of every interactive element, visible focus
  rings, `prefers-reduced-motion` honoured.
- **Teams-share legibility** - verified on a real share before 16 August, per the master spec. Not
  automatable; a scheduled task, not a test.

## 9. Build

Vite + React + TypeScript, sharing the repo's existing `tsconfig.base.json` and eslint config. Two outputs
from one codebase:

1. **Served** - Railway, alongside the Phase 3 API.
2. **Static** - `index.html` openable directly, submitted as a ZIP. Requires `base: './'`, the
   build-time JSON imports above, and **a single self-contained file with no subresources**.

   `base: './'` alone is not sufficient, and the gap is not visible from a dev server. Vite tags its emitted
   `<script>` and `<link>` with `crossorigin`, which makes Chrome treat them as CORS requests; a page opened
   from the filesystem has origin `null`, and `file://` is not a scheme CORS can satisfy. Both the bundle and
   the stylesheet failed with `ERR_FAILED` and the page rendered **completely blank** - measured, not
   predicted. The `inlineEverything` plugin in `apps/web/vite.config.ts` folds the chunk and the stylesheet
   into `index.html`, and fails the build if any asset survives uninlined. The regression guard is
   `apps/web/e2e/static-file.spec.ts`, which opens `dist/index.html` over `file://`; with the plugin disabled
   it fails while every `http://localhost` test still passes, which is exactly why the served build cannot be
   the only thing tested.

The engine is consumed as the existing `@arbiter/engine` workspace package. No duplication of rule logic in
the app, ever - if the app needs a rule behaviour, it calls the engine.

### 9a. Legibility

Type sizes measured on the built artifact at 1920×1080, 2026-07-28, per tab:

| what | measured | intended |
|---|---|---|
| body | 14px | 14px ✓ |
| verdict | 27px | 24–27px ✓ |
| tab heading | 21–22px | - |
| smallest text with content | 13px | - |

The finding was not a size but a **priority inversion**: the smallest and lightest text in the app was
carrying the honesty caveats - `citations UNVERIFIED` at 13px, and the single-class warning at 14px/400, the
same weight as body copy. The single-class warning is the one line that must not be missed, because the
balanced accuracy beside it is half a substituted 0.5. Raised to 15px/600 and 14px/600 respectively, and
guarded by a `file://` e2e assertion on the computed style so they cannot drift back to caption size.

**Outstanding, and it needs a person:** the actual Teams-share read at the far end of a real call. Screen-share
compression degrades silently - everything above was measured on a local display, which is precisely the
condition under which this looks fine and still fails. Owner: whoever runs the first rehearsal. Record the
date and any change here.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Bundle size hurts first paint over a Teams share | **Measured 2026-07-28: `dist/index.html` is 1,077 kB raw, 177 kB gzipped - one file, zero subresources.** Comfortably inside the 3MB raw budget, so the planned trim of `metrics.json` prose and unused `compounds.json` SMILES is not needed. `results.json` deliberately excluded. Re-measure if a Cmax source lands. |
| Full `reason()` too slow for interactive slider dragging | Only the selected compound runs full `reason()`; debounce slider input; measure early, and fall back to `reasonVerdictOnly` during drag with a full run on release |
| Five tabs is a lot of surface for the time available | Build in beat order - shell + Case first, so a runnable demo exists from day one rather than five half-tabs at Aug 14 |
| A Cmax source lands before 2 August and changes every number | Nothing in this app hard-codes a metric; Validation renders `metrics.json`. Re-running the harness updates the app with no code change. |

## 11. Explicitly not decided here

- **Phase 3.** Its own spec, after the shell exists.
- **Whether to chase a clinical Cmax source before 2 August.** It is the difference between "coverage is the
  finding" and a reportable headline, and it competes for the same days as this app. A team-capacity call.
- **The R1 discount question.** Recorded in master spec §5 as a v1.1 re-registration question; not acted on.
