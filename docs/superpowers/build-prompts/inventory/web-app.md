# Inventory: apps/web, the 7-tab product app

Compiled 2026-08-13 by direct reading of every file cited. Every line number below was
opened and confirmed. Where something is claimed absent, the search terms used are listed.

---

## 0. Orientation facts a build prompt must restate

| Fact | Evidence |
|---|---|
| Vite + React 18, TypeScript ESM, hash-routed, 7 tabs | `apps/web/package.json` (deps: `@arbiter/engine`, `react`, `react-dom`, `zod` only), `apps/web/src/router.ts:7` |
| The engine runs IN THE BROWSER over build-time-bundled JSON | `apps/web/src/engine/useCaseReasoning.ts:18`, `apps/web/src/engine/useLibraryVerdicts.ts:34-35`, `apps/web/src/data/bundle.ts:12-19` |
| Builds to ONE self-contained `index.html`; zero subresources | `apps/web/vite.config.ts:19-90` (`inlineEverything` plugin), `:96` `base: "./"`, `:102` `assetsInlineLimit: 100_000_000`, `:105` `inlineDynamicImports: true` |
| The only module allowed to issue a request | `apps/web/src/ai/client.ts:1-6`, the single `fetch(` in the whole app at `client.ts:60` |
| Dev entry is the unified server on ONE origin | `tools/dev-all.mjs:34` runs apps/web on internal port 5273 with `--base /app/`; `apps/landing/vite.config.ts:36-38` proxies `/app`, `/deliberation`, `/api` |
| Playwright base URL is a PREVIEW build, not the dev server | `playwright.config.ts`: `testDir: "apps/web/e2e"`, `baseURL: http://localhost:4173`, webServer `npm run web:build && npm run -w @arbiter/web preview -- --port 4173` |
| Unit tests: 41 vitest files under `apps/web/test/` (plus `setup.ts`), 357 `it(`/`test(` declarations | `for f in apps/web/test/*; do grep -cE "^\s*(it\|test)\(" $f; done` |
| Entry point | `apps/web/index.html` (title `ARBITER`, `<div id="root">`), `apps/web/src/main.tsx:8-10` mounts `StrictMode > ErrorBoundary > App` |

`apps/web/dist/index.html` exists, built 2026-08-10 21:17, 1,183,916 bytes. It contains
`rulesetVersion:"1.0"` and `arbiter:{balancedAccuracy:.75,balancedAccuracyCi:null,...}`
and `declineRate:.9737827715355806` inline. **The currently built artifact renders the
retired 0.750 figure.** (verified: `grep -o "arbiter:{balancedAccuracy[^}]\{0,90\}" apps/web/dist/index.html`)

---

## 1. THE CRITICAL SECTION: every site in apps/web that reads `results/metrics.json`

### 1.1 The single import and the single parse

| Where | Line | What |
|---|---|---|
| `apps/web/src/data/bundle.ts` | `:18` | `import metrics from "../../../../results/metrics.json";` |
| `apps/web/src/data/bundle.ts` | `:21` | `export const RAW = { evidence, compounds, splits, fixture, assays, ruleset, metrics, manifest };` |
| `apps/web/src/data/load.ts` | `:97-101` | `MetricsDocumentSchema.safeParse(RAW.metrics)`; on failure throws `DataLoadError("results/metrics.json: invalid metric at <path>: <message>")` |
| `apps/web/src/data/load.ts` | `:18` | `metrics: MetricsDocument;` on the `LoadedData` interface |
| `apps/web/src/data/load.ts` | `:152` | `metrics: parsedMetrics.data` in the returned object |

There is exactly ONE import site. Every consumer reads `useAppState().data.metrics`.
Repo-wide check inside apps/web: `grep -rn "metrics" apps/web/src apps/web/e2e apps/web/test`
returns matches only in `data/bundle.ts`, `data/load.ts`, `tabs/About.tsx`,
`tabs/Validation.tsx`, `tour/beats.ts`, and five test files. **No e2e spec reads a metrics field.**

The schema that a regenerated/version-labelled file must satisfy is
`packages/engine/src/schema.ts:249-284` (`MetricsDocumentSchema`), whose three cross-field
refinements are:

1. `:260-265` `sampleSizes.conflictSubset === metric1_conflictSubsetAccuracy.n`
2. `:266-274` `metric4.nDeclined + metric4.nCommitted === sampleSizes.scored`
3. `:275-284` `metric4.nStructurallyForced <= metric4.nDeclined`

plus `MetricsSampleSizesSchema` refinements at `schema.ts:153-171`
(`streamCoverage[x].compounds <= claims` and `<= scored`), and
`StreamCoverageSchema.compounds` is `z.number().int().min(1)` (`schema.ts:144`) -
a stream with zero compounds is a load failure, not a quiet row.

`MetricsProvenanceSchema` (`schema.ts:130-137`) requires all six of
`rulesetVersion, rulesetHash, splitSeed, perturbationSeed, scoredSplit, note`,
all `.min(1)` where strings. `MetricsDocumentSchema` is NOT `.strict()`, so an ADDED
top-level key (e.g. a `supersededBy` or `targetDefinition` block) parses without error,
but the interface `MetricsDocument` (`packages/engine/src/types.ts:418-427`) and the
bidirectional drift guard `MetricsShapeMatchesInterface` (`schema.ts:308`, forced by the
value site at `schema.ts:314`) mean the TYPE side must be widened in lockstep or
`npm run typecheck` fails naming the property.

### 1.2 About.tsx - every metrics read, with the sentence it produces

File: `apps/web/src/tabs/About.tsx` (316 lines). Locals: `:20 const m = data.metrics`,
`:21 const acc = m.metric1_conflictSubsetAccuracy`, `:22 const arbiter = acc.arbiter`,
`:24 pct = x => (x*100).toFixed(1)%`, `:25-26 conf = c => "tp / fp / tn / fn"`,
`:32 const TIED = "single:transporter"`, `:33 const tied = acc.baselines[TIED]`.

| Line | Field path | Current value | User-visible output |
|---|---|---|---|
| `:77` | `metric5_plannerSensitivity.meanUnchangedFraction` | 0.9917704918032786 | Hero stat `0.992` in `.figure-n` |
| `:80` | `metric5_plannerSensitivity.samplesPerCompound` | 2000 | "(2000 samples per compound, seed …)" |
| `:81` | `metric5_plannerSensitivity.seed` | 20260726 | "… seed 20260726)" |
| `:86` | `metric4_abstentionQuality.declineRate` | 0.9737827715355806 | Hero stat `97.4%` |
| `:88` | `sampleSizes.scored` | 267 | "Of 267 scored compounds, ARBITER declines to commit on …" |
| `:89` | `metric4_abstentionQuality.nDeclined` | 260 | "… on 260 of them - not because they disagree, but because the evidence is too thin to weigh." |
| `:95` | `provenance.rulesetHash.slice(0,8)` | `ed073a8a` | Hero stat `ed073a8a…` under "The ruleset, pre-registered and hashed before the run." |
| `:157` | `arbiter.balancedAccuracy.toFixed(3)` | **0.750** | **"ARBITER and single:transporter return the same figure in every column: 0.750 balanced accuracy, 6.6% coverage, 4 compounds committed, and the identical confusion matrix. Not close to - the same."** (`data-testid="about-tie"`) |
| `:158` | `arbiter.coverage` via `pct` | 0.06557… | `6.6%` in the same sentence |
| `:158` | `arbiter.nCommitted` | 4 | `4 compounds committed` in the same sentence |
| `:171` | `acc.n` | 61 | Table caption "Conflict subset, n = 61, test split only" |
| `:182` | `acc.baselines["single:transporter"]` | present | Whole comparison table is gated on `tied` being truthy (`:169`); the table disappears rather than asserting a tie if the key is absent |
| `:185` | `p.balancedAccuracy.toFixed(3)` for ARBITER and `single:transporter` | 0.750 / 0.750 | Two table cells reading `0.750` |
| `:186` | `p.coverage` | 0.06557 both | `6.6%` twice |
| `:187` | `p.nCommitted` | 4 both | `4` twice |
| `:188` | `p.confusion` via `conf` | tp4 fp0 tn0 fn0 | `4 / 0 / 0 / 0` twice |
| `:198` | `arbiter.nCommitted` | 4 | "Both pipelines commit on 4 compounds carrying a single label, so half of that balanced accuracy is a substituted 0.5 rather than an estimate…" |
| `:200-201` | `arbiter.nCommitted` (again) | 4 | "…a comparison drawn over 4 compounds is not strong evidence in either direction." |
| `:215` | `metric4_abstentionQuality.nDeclined` | 260 | "All 260 abstentions are the belief-plausibility gap." (`data-testid="about-causes"`) |
| `:224` | `sampleSizes.scored` | 267 | "**<singleClaim> of 267** compounds carry a single claim" - `singleClaim` is DERIVED at `:44-46` from `data.testSplit` + `data.claimsByCompound`, NOT from metrics |
| `:231` | `metric4_abstentionQuality.nStructurallyForced` | 254 | "**254 of the 260 declines could not have committed at any evidence values.**" (`data-testid="about-forced"`, `data-anchor="about.structurallyForced"`) |
| `:232` | `metric4_abstentionQuality.nDeclined` | 260 | same sentence |
| `:240-241` | `nDeclined - nStructurallyForced` | 6 | "Only 6 declined on what the evidence actually said." |
| `:308` | `provenance.scoredSplit` | `"test"` | "Scored on the test split only: the model was fitted on train and the conformal threshold set on calibration, so scoring either would be leakage." |
| `:309` | `provenance.rulesetVersion` | `"1.0"` | **"Ruleset v1.0, split seed 20260726."** |
| `:309` | `provenance.splitSeed` | 20260726 | same sentence |

Hardcoded interpretive prose on About that is NOT read from the file and therefore
does not move when the file does (these are the sentences a metrics-version task must
re-read by hand):

- `:154` heading `<h2 className="title">It does not beat the best baseline. It ties one, exactly.</h2>`
- `:156` "On the pre-registered conflict subset, ARBITER and `single:transporter` return the same figure in every column"
- `:160` "Not close to - the same."
- `:162-166` "Fusing five streams under six rules bought no accuracy over reading the transporter assay alone on this benchmark."
- `:197-204` the whole "Two things make even the tie weaker than it looks" paragraph, including "so half of that balanced accuracy is a substituted 0.5" and "there is no honest interval to attach to it"
- `:213` heading "Three causes, and none of them is disagreement."
- `:216-227` "None is an applicability-domain refusal and none is total conflict"; "R3 fires on 100% of safe claims and 0% of toxic ones"
- `:244-248` `.caveat` "This is the engine being correct about weak evidence … and it is a coverage problem."
- `:249-256` "What would move the number is evidence with an exposure axis … Widening the abstention threshold to buy coverage was considered once and rejected"
- `:53` label "Preclinical toxicity · evidence under conflict", `:54` display headline
- `:70` "TAK-994 - where every baseline says advance"
- `:110-144` the four "How it works" cards (Dempster-Shafer, R1-R6, abstention, pre-registration)
- `:271-292` the keyboard `<dl className="keys">` (→ ← / ? / M / Esc)
- `:296-301` "Where to start" TAK-994 paragraph

Language-discipline guard already in place: `apps/web/test/about.test.tsx:85-95` renders
About and asserts the text contains none of `blockchain, dossier, regulator-ready,
majority, tally, voting`.

### 1.3 Validation.tsx - every metrics read, with the sentence it produces

File: `apps/web/src/tabs/Validation.tsx` (198 lines). Locals: `:16 m`, `:17 acc`,
`:18 arbiter`, `:19-21 baselines = Object.entries(acc.baselines).filter(nCommitted>0).sort(desc balancedAccuracy)`,
`:25-26 streams = Object.entries(m.sampleSizes.streamCoverage).sort(desc compounds)`,
`:27 thinnest = streams[last]`, `:38-41 ablation / ablationNote / ablationTooltip`.

| Line | Field path | Current value | User-visible output |
|---|---|---|---|
| `:52` | `provenance.rulesetHash.slice(0,8)` | `ed073a8a` | "ruleset `ed073a8a…` · split seed 20260726 · perturbation seed 20260726 · scored on the test split" (`data-testid="provenance"`, `data-anchor="validation.provenance"`) |
| `:53` | `provenance.splitSeed` | 20260726 | same line |
| `:53` | `provenance.perturbationSeed` | 20260726 | same line |
| `:54` | `provenance.scoredSplit` | `"test"` | same line |
| `:65` | `acc.n` | 61 | "Conflict subset n = **61**." (`data-testid="headline"`) |
| `:66` | `arbiter.coverage` | 0.06557 | "ARBITER coverage **6.6%**" |
| `:66` | `arbiter.nCommitted` | 4 | "(4 committed)." |
| `:67` | `arbiter.balancedAccuracy.toFixed(2)` | **0.75** | **"balanced accuracy 0.75"** |
| `:68-70` | `arbiter.balancedAccuracyCi` | `null` | Because it is null, renders "(no confidence interval: one class is absent from the committed set, so half of this figure is a substituted 0.5 rather than an estimate)." If it were non-null it would render "(95% CI lo–hi)" from `.lo`/`.hi` |
| `:78` | `arbiter.singleClass` | `true` | Gates the whole single-class warning block |
| `:79-84` | (gated) | - | "**Single-class:** ARBITER committed on only one label, so this balanced accuracy is half a substituted 0.5. It must not be quoted as an accuracy. Coverage is the finding, and it is about how thin the evidence is rather than about the streams disagreeing - see the stream table below, and About for the three causes." (`data-testid="single-class-warning"`, `data-anchor="validation.singleClassWarning"`, listed in `CONDITIONAL_ANCHORS`) |
| `:105-113` | `acc.baselines` (filtered `nCommitted > 0`, sorted by balanced accuracy desc) | 5 surviving rows today: `majorityVote` n=3 ba 0.75 (single-class), `single:transporter` n=4 ba 0.75 (single-class), `weightedAverage` n=61 ba 0.55, `single:cytotox` n=61 ba 0.50, `single:qsar` n=60 ba 0.50. Dropped because `nCommitted === 0`: `single:invivo_rodent`, `single:invivo_nonrodent`, `single:toxicogenomics` | Baselines table: name, `b.nCommitted`, `(b.coverage*100).toFixed(1)%`, `b.balancedAccuracy.toFixed(2)`, and `b.singleClass ? <span class="chip chip-warn">single-class</span> : null` |
| `:124` | `sampleSizes.scored` | 267 | Caption "Evidence streams on the scored split, n = 267" |
| `:134-140` | `sampleSizes.streamCoverage[name].claims` and `.compounds` | cytotox 127/127, qsar 267/267, transporter 4/4 | Stream rows |
| `:139` | `c.compounds / m.sampleSizes.scored` | - | "Of the split" column: 47.6% / 100.0% / 1.5% |
| `:151-153` | `thinnest[0]`, `thinnest[1].compounds`, `m.sampleSizes.scored` | `transporter`, 4, 267 | "A single-stream baseline is scored over exactly the compounds that stream reaches, not over the split. **transporter** supplies evidence on **4** of 267 compounds, so single:transporter commits on 4 because 4 is every compound it has. Read the n committed column before the accuracy beside it." (`data-testid="coverage-caveat"`) |
| `:165` | `metric5_plannerSensitivity.meanUnchangedFraction.toFixed(3)` | 0.992 | "Planner recommendation unchanged under ±50% perturbation of every expert-elicited prior: **0.992**." |
| `:170` | `metric2b_arbiterRobustness.meanHeldFractionOnCommitted.toFixed(3)` | 1.000 | "Robustness on committed compounds: 1.000 · determinism verified by a 1000-run single-hash test." |
| `:174` | `JSON.stringify(m.metric2a_llmConsistency)` | `{"note":"results/ablation.json not present - run \`npm run ablation\` (Task 14, needs ANTHROPIC_API_KEY)"}` | The RAW JSON is printed on screen inside `<span class="mono">` (`data-testid="llm-ablation"`) |
| `:39-41, :190` | `metric2a_llmConsistency.note` (narrowed by `"note" in ablation`) | as above | `title=` tooltip of the permanently disabled Surface-2 button |

Hardcoded interpretive prose on Validation:

- `:49` `<h2 className="display">Validation</h2>`, `:48` label "Measured"
- `:70` the whole "no confidence interval: … substituted 0.5 rather than an estimate" clause (a string literal in the ternary's false branch)
- `:80-83` the entire single-class warning body
- `:93` `<h3>Baselines</h3>`, `:122` `<h3>What each pipeline had to work with</h3>`, `:162` `<h3>What is reportable</h3>`
- `:150-154` the coverage caveat's framing sentences around the interpolated numbers
- `:41` the fallback tooltip string "The live spot check is specified but not built (Phase 3 spec §6) - the button stays disabled."
- `:192` the button label "Append one live consistency run"

### 1.4 tour/beats.ts - the third metrics reader

`apps/web/src/tour/beats.ts:74` `const n = data.metrics.sampleSizes;`
`:81-82` produce beat 0's line: `` `${n.conflictSubset} of ${n.scored} scored compounds have streams in genuine conflict. This case is one of them.` `` → **"61 of 267 scored compounds have streams in genuine conflict. This case is one of them."**
That line is rendered by `TourFooter.tsx:57` (`<div className="small muted">{b.line}</div>`).
No other beat reads metrics.

### 1.5 Metrics fields that NO apps/web code reads

Verified by enumerating the document (`python3` walk of `results/metrics.json`) against the
reads above:

- `provenance.note`
- `metric1_conflictSubsetAccuracy.positiveRate`
- `…arbiter.rawAccuracyCi` and every baseline's `rawAccuracyCi`
- `metric2b_arbiterRobustness`: `determinism`, `determinismNote`, `meanHeldFraction`, `worstHeldFraction`, `nCommittedCompounds`, `heldFractionCaveat`, `samplesPerCompound`, `seed` (only `meanHeldFractionOnCommitted` is read)
- `metric3_calibration`: **the entire block is unread by apps/web** (`strictCoverage`, `meanWidth`, `meanWidthOnCorrect`, `meanWidthOnIncorrect`, `widthDiscriminates`, `widthDiscriminatesIsMeaningful`, `nCorrect`, `nIncorrect`)
- `metric4_abstentionQuality`: `balancedAccuracyOnCommitted`, `ciOnCommitted`, `singleClassOnCommitted`, `nCommitted`, `structurallyForcedNote`
- `metric5_plannerSensitivity`: `nCompoundsWithRecommendation`, `perturbation`

### 1.6 Version/hash literals hardcoded in apps/web (they do NOT come from metrics.json)

| Site | Literal | Note |
|---|---|---|
| `apps/web/src/tabs/Ruleset.tsx:5` | `const REGISTERED_HASH = "ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136";` | Rendered truncated at `:52`; a second copy of the v1.0 hash inside the app |
| `apps/web/src/data/bundle.ts:17` | `import ruleset from "../../../../rules/ruleset-v1.0.json";` | The app bundles v1.0 ONLY. `rules/ruleset-v2.0.json` is not imported anywhere in apps/web |
| `apps/web/src/data/load.ts:70` | error message string `rules/ruleset-v1.0.json: …` | |
| `apps/web/src/data/rulesetHash.ts:21` | re-exports `PRE_REGISTERED_HASH` from `apps/harness/src/preregistration.ts:53-54` (the v1.0 hash) | `PRE_REGISTERED_HASH_V2` exists at `preregistration.ts:75-76` = `984dc08dad55683c74bcdaae9b9da810829046669461d193a4687325be192227` and is imported by NOTHING in apps/web |
| `results/verdict-manifest.json` | carries its own `"rulesetHash": "ed073a8a…"` | `load.ts:88-91` reads only `RAW.manifest.rows`; the manifest's own hash field is never checked against anything in the app |

### 1.7 Tests that will fail (or silently keep passing) if metrics.json changes

| Test | Line | Behaviour under a v2.0 metrics file |
|---|---|---|
| `apps/web/test/validation.test.tsx:74` | `expect(getByTestId("provenance").textContent).toMatch(/ed073a8a/)` | **HARD FAIL** if `provenance.rulesetHash` changes |
| `apps/web/test/validation.test.tsx:61-62` | `expect(acc.arbiter.singleClass).toBe(true)` and `balancedAccuracyCi` is null | **HARD FAIL** under v2.0 (`tp2/fp5/tn0/fn0` is two-class) |
| `apps/web/test/validation.test.tsx:66-69` | headline must match `/no confidence interval/i` and `/substituted 0\.5/` | Fails once `singleClass` is false, because the ternary at `Validation.tsx:68-70` flips |
| `apps/web/test/validation.test.tsx:80` | planner stability `/0\.99/` | Fails if metric5 is regenerated with a different figure |
| `apps/web/test/validation.test.tsx:85` | llm ablation `/not present\|ANTHROPIC_API_KEY/i` | Fails if the placeholder note is rewritten |
| `apps/web/test/validation.test.tsx:11-36` | stream coverage and thinnest-stream derivation | Derived from the document, so it follows a regeneration |
| `apps/web/test/about.test.tsx:24-26` | tie sentence must contain `acc.balancedAccuracy.toFixed(3)` and the coverage % | Derived: it follows the file, so a v2.0 number passes **and the prose "It does not beat the best baseline. It ties one, exactly." is not asserted against the numbers at all** (only `/does not beat the best baseline/i` at `:27`) |
| `apps/web/test/about.test.tsx:32-33,67-70` | decline rate, `nStructurallyForced of nDeclined`, remainder | Derived, follows the file |
| `apps/web/test/about.test.tsx:39-42` | causes paragraph must contain `exposureRelevant`, `measures no key event`, `single claim` | Pins the hardcoded prose |
| `apps/web/test/surface2.test.tsx:38-45` | tooltip must equal `metric2a_llmConsistency.note` and note must match `/ablation\.json not present/` | **HARD FAIL** if the placeholder note text changes |
| `apps/web/test/surface2.test.tsx:92-107` | baselines table rows derived from `acc.baselines` filtered `nCommitted>0`; asserts `expected.length > 1` | Follows the file as long as at least two baselines commit |
| `apps/web/test/beats.test.tsx:69-73` | `arbiter.coverage < 0.25` and `meanUnchangedFraction > 0.9` | Tolerant thresholds; survives v2.0 coverage |
| `apps/web/test/beats.test.tsx:83-101` | builds beats from a synthetic metrics doc (`scored: 999, conflictSubset: 42`) and asserts `"42 of 999"` | Derived, follows the file |
| `apps/web/test/dataLoadFailure.test.tsx:24-56` | mocks `RAW.metrics` with `sampleSizes.scored = "two hundred and sixty-seven"` and asserts the boundary prints `/results\/metrics\.json/` | Independent of content |
| `apps/web/test/ruleset.test.tsx:19` | `getByTestId("ruleset-hash")` matches `/ed073a8a/` | Pins the hardcoded `REGISTERED_HASH` in `Ruleset.tsx:5` |
| `apps/web/test/preflight.test.tsx:53` | pre-flight line contains `ed073a8a` | Pins `PRE_REGISTERED_HASH` |
| `apps/web/test/chain.test.ts:166,209,220` | fixture positions carrying the v1.0 hash | Fixture data only |

No Playwright spec asserts a metrics number. `static-file.spec.ts:114-117` asserts only the
FONT SIZE (>= 15px) and WEIGHT (>= 600) of `single-class-warning`, so if that block stops
rendering (because `arbiter.singleClass` becomes false) the e2e test fails on a missing
element, not on a number.

---

## 2. Per-tab inventory

Shell: `apps/web/src/App.tsx`. `TAB_IDS` at `router.ts:7` =
`["about","compounds","case","ruleset","validation","record","intake"]`.
`TAB_LABEL` (total `Record<TabId,string>`) at `App.tsx:49-57`.
Routing: `parseHash` (`router.ts:31-35`) - empty fragment → `about`, unknown fragment → `case`.
Body switch at `App.tsx:152-158`. `<Guide tab={tab} />` mounts above every tab (`App.tsx:151`).

Shell-level controls (present on every tab):

| Control | Site | Behaviour |
|---|---|---|
| Skip link | `App.tsx:92-95` | `preventDefault`, focuses `#main` by hand so the fragment never reaches the router |
| Brand link | `App.tsx:105-108` | `href = landingHref() ?? "#/about"`; `links.ts:21-28` returns null over `file:` |
| 7 nav links | `App.tsx:109-117` | `href={#/${t}}` with `aria-current="page"` on the active one |
| "← Landing" | `App.tsx:127-129` | rendered only when `landing !== null` |
| Nav hint text | `App.tsx:130` | "←/→ beats · M motion" |
| `?` key | `App.tsx:73-80` | toggles `<Preflight/>`; suppressed by `isTypingTarget` |
| `/` key | `ai/NavigatorBar.tsx:53-62` | focuses the navigator input, `preventDefault` so the slash is not typed |
| `→ ← M` keys | `tour/TourFooter.tsx:29-42` | next/prev beat, toggle motion; `Escape` clears focus and is exempt from the typing guard (`:33`) |

### 2.1 About - `apps/web/src/tabs/About.tsx`

Renders: hero (label, display headline, lede, "Open the worked case" button `href="#/case"`),
three `.figure` stat blocks (planner 0.992 / decline 97.4% / ruleset hash), "How it works,
in three moves" 4-card grid, the tie section with the two-row comparison table, the
"Why it abstains so much" section (3 paragraphs + caveat), and "Using the demo"
(keyboard `<dl>` + "Where to start").

Metrics fields: see §1.2. Test ids: `about-tie` (`:155`), `about-causes` (`:214`),
`about-forced` (`:229`). Only anchor: `data-anchor="about.structurallyForced"` at `:229` -
**this anchor is NOT in the `ANCHORS` registry** (`ai/anchors.ts:55-104` has no `about.*`
entry and no `about` tab entry at all), so the navigator can never reach it and
`anchors.test.tsx` never sees it. That is a live inconsistency worth knowing.

Interactive controls: `:69` `<a className="btn btn-primary" href="#/case">Open the worked case</a>`;
`:303` `<a className="btn btn-primary" href="#/case">Open the case</a>`;
`:304` `<a className="btn" href="#/validation">See the numbers</a>`. No buttons, no inputs.

### 2.2 Compounds - `apps/web/src/tabs/Compounds.tsx` (77 lines)

Renders the 267-row scored library. Data: `useLibraryVerdicts()` (no override) at `:15`,
`data.testSplit` at `:17`.

- `:18` `conflicting = ids.filter(rows.get(id)?.conflicting).length`
- `:19` `declined = ids.filter(rows.get(id)?.verdict === "abstain").length`
- `:28-31` `data-testid="conflict-rate"`, `data-anchor="compounds.conflictRate"`: "**61 of 267** scored compounds have streams in genuine conflict (22.8%)." (numbers computed live, not from metrics)
- `:34-38` `data-testid="decline-note"`, `data-anchor="compounds.declineNote"`, class `.caveat`: "ARBITER declines on 260 of 267 - which is not the same set as the conflicting ones, and not caused by them. See About for why: the evidence is too thin to weigh, not contradictory."
- `:43` table with `data-anchor="compounds.table"`, columns Compound / Streams / Verdict / DILIrank
- `:57` each row `data-testid="compound-row"`
- `:65-67` conflict cell: word first (`in conflict` / `agree`), colour class second

Interactive controls: one per row - `:59-62` `<button className="cell-link">` dispatching
`selectCompound` then `window.location.hash = "#/case"`. **Reads NO metrics fields.**

### 2.3 Case - `apps/web/src/tabs/Case/`

`index.tsx` (35 lines): `<CaseHeader/>` then a `.case-grid` with `data-focus={focus ?? ""}`
holding the three regions. `collapsed(r)` at `:16` is true when another region holds focus;
a collapsed panel returns a rail button and **unmounts its content** (`EvidencePanel.tsx:24-32`,
`TracePanel.tsx:10-16`, `TablePanel.tsx:267-273`).

**CaseHeader.tsx** (77 lines):
- `:19` hero lookup, `:20` `workingClaims(state, selectedCompoundId)`, `:21` `visibleClaims(all, asOf)`, `:22` `hidden`
- `:35-40` masthead: display name, subtitle (`hero?.subtitle ?? compound?.dilirankLabel ?? "DILIrank class not recorded"`), conditional `split-disclosure` caveat
- `:44` `<span data-anchor="case.verdict"><VerdictLabel verdict={r.verdict} /></span>` - **the verdict renders the instant the tab mounts; there is no commit-before-reveal gate anywhere in apps/web**
- `:49-58` `data-testid="belief-range"`, `data-anchor="case.beliefRange"`: two `<dl className="kv">` giving "Belief – plausibility 0.090 – 1.000" and "Gap 0.910"
- `:60-74` as-of control (`data-anchor="case.asOf"`): "All evidence" button (`:62-63`) plus one button per `hero.asOfMilestones` entry (`:64-70`), each `aria-pressed`; then `data-testid="hidden-count"` (`:71-73`) reading "nothing hidden" or "N of M claims hidden by this date"

**EvidencePanel.tsx** (75 lines):
- `:14` `citationStatus`, `:15` visible working claims, `:16` `stepFor`, `:22` `modified(id)`
- `:26-30` collapsed rail: a row of `<Dot>` per claim
- `:41-43` conditional `data-testid="citation-status"`, `data-anchor="evidence.citationStatus"`, `.caveat`: "Literature fixture · citations UNVERIFIED"
- `:50-69` per claim `<li data-testid="evidence-row" data-anchor={evidenceClaim(c.id)}>`: `<Dot>`, stream name, `system · strength 0.NN`, conditional `claim-modified-badge` chip ("MODIFIED - not the registered claim"), `data-testid="provenance"` line (`KIND · source`), and the trace step's `rationale` prose.
- **No applicability-domain badge.** `inApplicabilityDomain` never appears in this file (grep over `apps/web/src` for `inApplicabilityDomain|applicability|domain` returns only Intake, store's `FIELD_SET`, `evidenceDigest`, `interpret`/anchors labels and comments). The only way an R4 downweight becomes visible is if `step.rationale` at `:68` happens to mention it.
- Interactive control: only the collapsed rail button (`:26`).

**TracePanel.tsx** (64 lines):
- `:7` `claimSteps` (non-verdict), `:8` `verdictStep`
- `:21` `<BeliefTrack belief plausibility/>`
- `:23-28` `data-anchor="trace.mass"`, class `.case-mass`: "mass toxic 0.090 · safe 0.000 · uncommitted 0.910" and `{r.contested && " · contested"}` - **`r.conflictMass` is not rendered; only the derived boolean `contested` reaches the screen** (engine: `packages/engine/src/index.ts:185` derives `contested`, `:197` puts `conflictMass` on the result, `packages/engine/src/types.ts:186-187` declares it)
- `:31-39` `<li data-testid="trace-step" data-anchor={traceStep(s.claimId)}>`: claim id (mono), status, conditional `<span className="chip chip-fired">{s.byRule}</span>`, rationale
- `:43` `data-testid="verdict-reason"`, `data-anchor="trace.verdictReason"`
- `:46-54` conditional counterfactual (`data-testid="counterfactual"`, `data-anchor="trace.counterfactual"`): "`claimId → to` gives **verdict**."
- `:56-61` conditional next experiment (`data-testid="next-experiment"`, `data-anchor="trace.nextExperiment"`)
- Interactive control: only the collapsed rail button (`:12`).

**BeliefTrack.tsx** (32 lines): `data-anchor="trace.beliefTrack"` (`:17`),
`data-testid="belief-lo"`/`"belief-hi"` (`:19-20`), and `data-testid="belief-fill"`
with inline `left`/`width` percentages (`:24-28`). The `transition` lives in `case.css`
so `motion.css` can kill it - asserted by `demo.spec.ts:17-41`.

**TablePanel.tsx** (451 lines) - Surface 1's mount:
- Exported helpers: `claimLabel(id)` (`:34-37`, prefix-slice at the FIRST colon),
  `loadedKeyEvents(data)` (`:139-147`).
- Module-private: `show` (`:40`), `MIN_VISIBLE = 5e-4` (`:49`), `moved` (`:51-55`),
  `noMoveReason` (`:65-102`, three computed branches), `dispatchable` (`:112-121`),
  `validAgainstEvidence` (`:161-172`), `actionKind` (`:175-177`), `deltaText` (`:180-189`).
- State: `challenge`, `resolution`, `armed`, `applied`, `baseline` (`:235`), `result` (`:252`), `capture` (`:253`); the post-apply capture effect at `:261-265`.
- Interactive controls:
  1. `:354-357` `<textarea data-testid="challenge-input" rows={3}>`
  2. `:358-360` `<button data-testid="challenge-submit">Interpret</button>` → `submit()` at `:275-290`, which builds `InterpretInput` carrying **claim IDS AND LABELS ONLY** (`:278-282`) and calls `interpret(input)`
  3. `:384-386` `<input type="checkbox" data-testid="proposal-arm">` shown only when `p.confidence === "low"`
  4. `:391-393` `<button data-testid="proposal-apply" data-armed disabled={!armed}>Apply</button>` → `apply(p)` at `:313-335`
  5. `:395-397` `<button data-testid="proposal-reject">Reject</button>`
  6. `:406-410` rule-picker buttons `data-testid={pick-${r.id}}` (rung 5), one per rule → `pick(id)` at `:293-306`
- Read-only outputs: `:364-366` `data-testid="proposal-rung"` with `data-rung`/`data-source`;
  `:370` `data-testid="proposal"` with `data-action-kind`/`data-confidence`;
  `:371-374` `proposal-paraphrase`; `:378-380` `proposal-delta` (old→new resolved locally);
  `:416-448` `data-testid="applied-delta"` with `data-moved`, and `delta-belief`,
  `delta-plausibility`, `delta-gap`, `delta-verdict`, `delta-why`.
- **Reads NO metrics fields.**

### 2.4 Ruleset - `apps/web/src/tabs/Ruleset.tsx` (139 lines)

- `:5` `REGISTERED_HASH` literal (v1.0)
- `:41` `modified = isEdited(ruleset, data.ruleset)` (JSON value compare, `store.tsx:275-277`)
- `:50-61` `data-testid="ruleset-hash"`, `data-anchor="ruleset.hash"`: "v1.0 · registered <date> · `ed073a8a…`" plus the conditional `data-testid="modified-badge"` / `data-anchor="ruleset.modifiedBadge"` chip "MODIFIED - not the registered ruleset"
- `:63-67` `data-testid="live-belief"`, `data-anchor="ruleset.liveBelief"`: "Live on the selected case: belief 0.090, verdict abstain"
- `:76-94` precedence block (`data-anchor="ruleset.precedenceOrder"`), `data-testid="precedence-order"`, `precedence-entry` per id, `precedence-rationale`
- `:96-106` abstention threshold block (`data-anchor="ruleset.abstentionThreshold"`), `abstention-threshold`, `abstention-threshold-value`, `abstention-threshold-provenance`
- `:110-136` six rule cards `data-testid="rule-card"`, `data-anchor={ruleAnchor(rule.id)}`, each showing id, name, statement, `framework.name (framework.date) - note`

Interactive controls: `:68-70` "Reset to registered" button; per rule `:123-127`
`<input type="range" data-testid={strength-${rule.id}} min=0 max=1 step=0.05>` and
`:130-131` an "Enabled" checkbox. **Reads NO metrics fields.**

### 2.5 Validation - `apps/web/src/tabs/Validation.tsx`

See §1.3 for every field and sentence. Interactive controls: exactly one,
`:185-193` `<button data-testid="live-ablation-run" disabled title={ablationTooltip}>Append one live consistency run</button>`.
The handover requires it stay disabled; `surface2.test.tsx:48-70` asserts it stays disabled
even when the ablation document is present.

### 2.6 Record - `apps/web/src/tabs/Record.tsx` (134 lines)

- `:8` `GENESIS = "0".repeat(64)`
- `:30` `workingClaims(state, selectedCompoundId)`
- `:32-62` `sign()`: `evidenceSnapshot(visibleClaims(all, asOf), r)` → `sha256Hex` (`:33`),
  `browserRulesetHash(ruleset)` of the WORKING ruleset (`:39`), `recordHash(last)` or GENESIS (`:41`),
  then `dispatch({type:"addPosition", position:{...}})` with `signedAt: new Date().toISOString()` (`:53`)
- `:70-73` `data-anchor="record.chainExplainer"`: "Positions are recorded against the exact evidence and verdict on screen. The log is a hash-chained audit log: each entry carries the hash of the one before it, so tampering is detectable."
- `:76-98` `<fieldset data-anchor="record.signForm">` with the four controls
- `:100-128` `<ol className="position-list">`, each `<li data-testid="position-row" data-anchor={recordPosition(i)}>` showing displayName, position, rationale, compound label (hero name → corpus name → raw id), `snapshot <12 hex>…`, `prev <12 hex>…`, `as of <date|all evidence>`, signatureMethod
- `:131` `.caveat` "ARBITER holds no position. The named decision owner signs."

Interactive controls: `:80` Reviewer text input (default "Jack He"), `:84-89` Position
`<select>` with options `agree|dissent|abstain`, `:92` Rationale text input,
`:96` `<button className="btn btn-primary">Sign</button>`.
**Reads NO metrics fields.** No reason is REQUIRED for a dissent here - `rationale` is
optional and stored as `rationale || null` (`:47`).

### 2.7 Intake - `apps/web/src/tabs/Intake.tsx` (342 lines)

Constants `:7-9` `STREAMS`, `ASSERTIONS`, `SYSTEMS`. `Draft` interface `:12-24`, `EMPTY` `:26-30`,
`tristate` `:32-34`, `nextClaimId` `:42-49`, `toClaim` `:51-76`.
State `:91-98`. `idError` memo `:102-111` (rejects a colon and any id already in
`data.compounds` or `data.heroCases`). `reach` memo `:113-116` calling
`assessReachability(claims, state.ruleset)` (`intake/advisor.ts:89-104`).

Interactive controls, in DOM order:

| Control | Line | testid |
|---|---|---|
| Compound id text input | `:170-175` | `intake-compound-id` |
| Stream select (6 options) | `:188-191` | `intake-stream` |
| Assertion select (toxic/safe/ambiguous) | `:194-197` | `intake-assertion` |
| Strength number input (0..1 step .05) | `:200-201` | `intake-strength` |
| System select (human/rodent/nonrodent/in_silico) | `:204-207` | `intake-system` |
| Key event text input | `:213-214` | `intake-key-event` |
| Exposure select (unstated/yes/no) | `:217-220` | `intake-exposure` |
| **In applicability domain select (not applicable/yes/no)** | `:223-226` | `intake-domain` |
| Klimisch select ("" /1/2/3/4) | `:229-234` | `intake-klimisch` |
| Available-from text input | `:240-241` | `intake-available-from` |
| Provenance kind select (literature/database) | `:244-247` | `intake-prov-kind` |
| Provenance source text input | `:250-251` | `intake-prov-source` |
| Clinical Cmax text input | `:260-262` | `intake-cmax` |
| Cmax citation text input | `:265-266` | `intake-cmax-source` |
| "Add study" button | `:271-273` | `intake-add-claim` |
| Per-row "Remove" button | `:299-303` | (none) |
| "Create compound and open it" button (disabled unless claims exist, id non-empty, no id error) | `:329-335` | `intake-create` |
| "Open <id> on the Case tab" link (after create) | `:337` | `intake-open-case` |

Read-only outputs: `intake-id-error` (`:176`), `intake-errors` list (`:277-280`),
`intake-claims` table (`:286-307`), and the advisor panel `intake-advisor` /
`intake-advisor-sentence` with a `dl` of ceiling / needs / verdict (`:315-325`).
**Reads NO metrics fields.** `apps/web/src/tabs/Intake.tsx:222-227` is the ONLY place
`inApplicabilityDomain` is a user-facing control anywhere in the app.

---

## 3. The anchor registry and the tour system

### 3.1 `apps/web/src/ai/anchors.ts` (185 lines)

- `Anchor` interface `:24-28`: `{ label: string; tab: TabId; region: Region | null }`
- `CONDITIONAL_ANCHORS` `:42-48`: `trace.counterfactual`, `trace.nextExperiment`,
  `validation.singleClassWarning`, `evidence.citationStatus`, `ruleset.modifiedBadge`
- `ANCHORS` `:55-104`, `as const satisfies Record<string, Anchor>`. 33 static entries:
  - case (region null): `case.verdict`, `case.beliefRange`, `case.hiddenCount`, `case.asOf` (`:57-60`)
  - case region `trace`: `trace.beliefTrack`, `trace.mass`, `trace.verdictReason`, `trace.counterfactual`, `trace.nextExperiment` (`:63-67`)
  - case region `evidence`: `evidence.citationStatus` (`:70`)
  - ruleset: `ruleset.hash`, `ruleset.modifiedBadge`, `ruleset.liveBelief`, `ruleset.precedenceOrder`, `ruleset.abstentionThreshold`, `rule.R1`..`rule.R6` (`:73-83`)
  - record: `record.chainExplainer`, `record.signForm` (`:86-87`)
  - validation: `validation.provenance`, `validation.headline`, `validation.singleClassWarning`, `validation.baselines`, `validation.streamCoverage`, `validation.coverageCaveat`, `validation.plannerStability`, `validation.robustness`, `validation.llmAblation` (`:90-98`)
  - compounds: `compounds.conflictRate`, `compounds.declineNote`, `compounds.table` (`:101-103`)
  - **no `about.*` entry, and `about` is not a tab any anchor names**, although `About.tsx:229` emits `data-anchor="about.structurallyForced"` and `Case/index.tsx`'s table region emits no anchor at all
- Dynamic families `:114-116` and `:128-132`: `trace.step:`, `evidence.claim:`, `record.position:`
- `parseAnchor` `:150-163` - PREFIX-SLICE, never `split(":")`; a bare prefix returns null
- `isKnownAnchor` `:166-168`; constructors `traceStep` `:170`, `evidenceClaim` `:174`, `ruleAnchor` `:178`, `recordPosition` `:182`

Invariants enforced by `apps/web/test/anchors.test.tsx`: unique non-empty labels (`:38-44`);
the exact set of region-bearing anchors (`:46-61`); every unconditional anchor present
EXACTLY ONCE on its own tab (`:110-121`); conditional anchors mount when satisfied
(`:123-133`); `ruleset.modifiedBadge` absent until a slider moves (`:135-144`).
**Adding a new rendered anchor without registering it, or registering one without
rendering it, fails `anchors.test.tsx`.**

### 3.2 `apps/web/src/ai/useAnchorScroll.ts` (106 lines)

`SPOTLIGHT_HOLD_MS = 1500` (`:8`). Deferred resolve: `:39` clears when pending is null,
`:46` drops an unknown id, `:50` waits for `hashchange` to land, `:58-61` un-collapses the
region first, `:65` `document.querySelector('[data-anchor="…"]')`, `:71-74` refuses to point
at a missing or empty element, `:82-84` flips stale spotlights to `"off"`, `:91-93`
`scrollIntoView({behavior: motion && !reduced ? "smooth":"auto", block:"center"})` and sets
`data-anchor-spotlight="on"`, `:96-104` flips to `"off"` after the hold and clears pending.

### 3.3 Tour - `apps/web/src/tour/beats.ts` + `TourFooter.tsx`

`Beat` interface `beats.ts:6-55`: `{ n, title, tab, compoundId, focus, actions: Action[], line }`.
`buildBeats(data)` `:68-130` reads `tak = data.heroCases.get("TAK-994")` (`:69`),
`preFih`/`postMurine` from `asOfMilestones` (`:70-71`), `cyclo` (`:72`), `n = data.metrics.sampleSizes` (`:74`).

| Beat | Line | tab | compound | focus | actions |
|---|---|---|---|---|---|
| 0 "The desk, before first-in-human" | `:77-83` | compounds | TAK-994 | null | `setAsOf preFih` |
| 1 "What happens today" | `:84-89` | case | TAK-994 | evidence | `setAsOf preFih` |
| 2 "ARBITER's argument" | `:90-95` | case | TAK-994 | trace | `setAsOf preFih` |
| 3 "The honest gap, and what would flip it" | `:96-101` | case | TAK-994 | trace | `setAsOf preFih` |
| 4 "The experiment it asks for" | `:102-107` | case | TAK-994 | trace | `setAsOf postMurine` |
| 5 "The table" | `:108-113` | record | TAK-994 | null | `setAsOf postMurine` |
| 6 "When it does commit" | `:114-119` | case | Cyclosporine | trace | `setAsOf null` |
| 7 "What the numbers say" | `:120-128` | validation | TAK-994 | null | `setAsOf null` |

Beat 1's line is the one containing the word "Majority vote" - `beats.ts:88`:
"Majority vote, weighted average and every single source all say advance." (This is the
name of a baseline pipeline, not a decision procedure, but it is the only occurrence of
the word "majority" in rendered app copy, and `about.test.tsx:92` bans that word only on
the About tab.)

`TourFooter.tsx`: `go(n)` `:16-27` clamps, dispatches `setTourBeat`, dispatches
`selectCompound` when the beat's compound differs (`:22-24`), replays the beat's actions,
then assigns `window.location.hash`. Key handler `:29-42`. Footer render `:45-63`:
two `.btn-ghost` buttons ("Previous beat"/"Next beat" aria-labels), a `<Character>` face
from `faceForBeat(b.n)` (`ui/Character.tsx:44-47`), `"Beat {n+1} of 8 · {title}"` in ONE
element (frozen by e2e), the beat line, and "motion on/off (M)".

### 3.4 `apps/web/src/ui/Guide.tsx` (62 lines)

Total `Record<TabId, {face, line}>` at `:20-49`; renders `<aside className="guide"
data-testid={guide-${tab}}>` with an aria-hidden `<Character>` and the line. One sentence
per tab, all seven present.

---

## 4. The five-rung AI ladder (`apps/web/src/ai/`)

### 4.1 The walker

`resolve.ts:30-45`. `Source = "live"|"cache"|"local"|"none"` (`:16`),
`Resolution<T> = {value, rung, source}` (`:18-23`), `Rung<I,T> = {source, run}` (`:25-28`).
Walks in order, first non-null wins, returns `{value:null, rung: rungs.length, source:"none"}`
when exhausted (`:44`). Deliberately NOT wrapped in try/catch (`:33-38`).

### 4.2 Where rung 1 posts, and the two gates

| Surface | Rung-1 declaration | POST path |
|---|---|---|
| Surface 1, challenge interpreter | `ai/interpret.ts:322-329` | **`postJson<Proposal>("/api/interpret", input, …)` at `interpret.ts:325`** |
| Surface 3, navigator | `ai/navigate.ts:155-167` | **`postJson<NavResult>("/api/navigate", input, …)` at `navigate.ts:158`** |

Both go through `ai/client.ts`:
- `LIVE_TIMEOUT_MS = 2500` (`client.ts:9`)
- `liveEnabled = import.meta.env.VITE_ARBITER_LIVE === "1" && location.protocol !== "file:"` (`client.ts:31-32`)
- `postJson` `client.ts:48-73`: returns null immediately when `!liveEnabled` (`:53`), aborts at 2.5s (`:57-58`), the ONLY `fetch(` in apps/web (`:60`), returns null on `!res.ok` (`:66`) and on any throw (`:68`)

**`VITE_ARBITER_LIVE` is set nowhere in the repository.** Searched: the string itself across
`apps`, `tools`, `docs`, `services` - hits are only `apps/web/src/ai/client.ts:32`,
`apps/web/src/vite-env.d.ts:11`, three test files that `vi.stubEnv` it, and spec/plan
documents. `apps/web/.env.development` contains only a comment block about
`VITE_LANDING_URL`. `tools/dev-all.mjs` passes no env to any child (`grep -n "env" tools/dev-all.mjs`
returns nothing). So today rung 1 is skipped BEFORE the request is built, in dev as well as
in the ZIP - the missing `/api/interpret` and `/api/navigate` routes on `services/api/server.ts`
(confirmed: `grep -n "interpret\|navigate" services/api/server.ts` returns only the
`import { completeFromEnv } from "./interpret.js";` at `server.ts:10`) are the SECOND
reason live never happens, not the first.

### 4.3 Surface 1 rungs - `ai/interpret.ts` (377 lines)

| Rung | Line | Source | Behaviour |
|---|---|---|---|
| 1 | `:336` (`liveRung` `:322-329`) | live | POST `/api/interpret`, `ProposalSchema.safeParse` on the body |
| 2 | `:337-341` | cache | exact match on `normalize(challenge)` against `ENTRIES` |
| 3 | `:342-358` | cache | trigram Jaccard >= `FUZZY_THRESHOLD` (0.55) over the same entries, highest wins |
| 4 | `:359-363` | local | `keywordProposal` (`:269-307`), ALWAYS `confidence:"low"`, never proposes `reclassify_field` |
| 5 | `:364-371` | none | returns null so `resolve` reports `{value:null, rung:5, source:"none"}` → the UI shows the rule picker |

Supporting: `Proposal` `:48-56`, `InterpretInput` `:58-62`, `ProposalSchema` `:93-161`
(`.strict()` at `:113` plus five cross-field refinements), `FIELDS` `:65-67` with the
bidirectional drift guard `FIELDS_MATCH_PRODUCES` `:76-80`, `normalize` `:169-171`,
`ENTRIES` parsed from `cache/interpretations.json` `:180-191` (bad entries dropped, not thrown),
`onGrid` (0.05 step) `:199-202`, `RULE_NAMES` `:211-218`, `tokenPattern` word-boundary matcher
`:226-230`, `KEYWORD_TOKENS` `:233-240`, `DISABLE_PATTERNS` `:244-247`, `RAISE_PATTERNS` `:249-252`.

### 4.4 Surface 3 rungs - `ai/navigate.ts` (232 lines)

`NavResult {anchorIds, noMatch}` `:19-22`; `NavigateInput {question, anchors}` `:24-32`;
`NavResultSchema` `.strict()` `:42-45`; `MAX_ANCHORS = 3` `:48`; caches at `:55-62`
(`cache/anchor-map.json` + `cache/suggested-questions.json`); `SUGGESTED_QUESTIONS` `:64`;
`sanitizeNavResult` `:78-88`; `anchorMeta` `:113-119` with `INSTANCE_LABEL` `:101-105`;
`STOPWORDS` `:125-131`; `tokens` `:133-135`.
Rungs: live `:155-167`, exact `:170-177`, fuzzy `:180-196`, keyword `:199-219`,
suggest `:222-225` (always answers `{anchorIds:[], noMatch:true}`), assembled `:227`.

`NavigatorBar.tsx` (146 lines) is the mount: `matchAnchors` memo `:40-43` folds each rule's
registered `statement` into its `rule.RN` label; `ask` `:45-51`; `/` focus handler `:53-62`;
`pick(id)` `:74-80` dispatches `setFocus` (when the anchor has a region), then
`setPendingAnchor`, then assigns the hash. Controls: `nav-input` (`:98-112`, Backspace on an
empty box clears the result), the results strip `nav-result` / `nav-anchor` (`:120-129`), and
the `nav-nomatch` strip with `nav-suggestion` buttons (`:131-143`). `nav-rung` (`:114-116`)
prints "rung N · source".

### 4.5 Pre-flight panel - `apps/web/src/ui/Preflight.tsx` (324 lines)

Probes: `PROBE_CHALLENGE = "The rat study should not carry this much weight"` (`:90`) and
`PROBE_QUESTION = "Which rule discounted the murine study?"` (`:91`); both ladders are RUN
when the panel opens (`:146-160`). Eight `<Check>` rows, each with `data-testid` and `data-ok`:

| testid | Line | What it computes |
|---|---|---|
| `check-ruleset` | `:226-238` | `browserRulesetHash(data.ruleset) === PRE_REGISTERED_HASH` |
| `check-manifest` | `:240-248` | live `reasonVerdictOnly` verdicts vs `results/verdict-manifest.json` rows across all 267 |
| `check-errors` | `:250-258` | how many compounds threw during recomputation |
| `check-edits` | `:262-272` | registered vs working ruleset digest |
| `check-evidence-edits` | `:279-289` | `browserEvidenceDigest` registered vs working |
| `check-evidence` | `:291-298` | counts of compounds, split size, fixtures, citation statuses |
| `check-surface-1` | `:300-306` | reports the rung/source Surface 1 actually reached, via `surfaceLine` `:199-213` |
| `check-surface-3` | `:308-314` | same for Surface 3 |
| `check-bundle` | `:316-319` | static informational line |

**Nothing in the pre-flight panel reads metrics.json.**

---

## 5. `apps/web/src/state/store.tsx` (405 lines) - the exact shape

```ts
interface AppState {                       // :89-123
  data: LoadedData;                        // :90
  ruleset: Ruleset;                        // :91  editable working copy
  evidenceEdits: Record<string, EvidenceEdit>;  // :94
  asOf: string | null;                     // :95
  selectedCompoundId: string;              // :96
  tour: { beat: number; tab: TabId; focus: Region | null };  // :97
  positions: ReviewerPosition[];           // :98
  motion: boolean;                         // :99
  pendingAnchor: string | null;            // :106
  customCompounds: Record<string, EvidenceClaim[]>;  // :122
}
```

- `Region = "evidence" | "trace" | "table"` (`:10`)
- `ReviewerPosition` (`:13-42`): `reviewerId, displayName, role, compoundId, position:"agree"|"dissent"|"abstain", rationale: string|null, signedAt, rulesetHash, evidenceSnapshotHash, asOfDate: string|null, signatureMethod:"demo-persona"|"sso", prevRecordHash`
- `ReclassifiableField = keyof AssayOperator["produces"]` (`:66`); `FIELD_SET` (`:76-83`) =
  `system, stream, measuresKeyEvent, exposureRelevant, inApplicabilityDomain, klimisch`;
  `RECLASSIFIABLE_FIELDS` (`:84`)
- `EvidenceEdit = Partial<Pick<EvidenceClaim, ReclassifiableField>>` (`:87`)
- `Action` union (`:125-138`): `selectCompound, setAsOf, setRuleStrength, setRuleEnabled,
  resetRuleset, reclassifyClaim, resetEvidence, setTourBeat, setFocus, addPosition,
  toggleMotion, setPendingAnchor, addCustomCompound`
- `initialState` (`:140-156`): `selectedCompoundId: BOOT_CASE` ("TAK-994"),
  `tour {beat:0, tab:"case", focus:null}`, `motion: true`
- Selectors: `visibleClaims` (`:159-161`), module-private `registeredClaims` (`:188-192`),
  `findClaim` (`:203-207`, first-colon prefix slice), `resolveClaims` (`:237-240`, bundled
  beats custom), **`workingClaims` (`:242-252`) is the only exported way to reach a
  compound's claims**, `isEdited` (`:275-277`, JSON value compare)
- Reducer (`:283-369`): `setRuleStrength` rejects out-of-range (`:290`); `reclassifyClaim`
  parses the WHOLE merged claim through `EvidenceClaimSchema` and refuses the transition on
  failure (`:321`), prunes fields back to registered values (`:328-335`); `addCustomCompound`
  refuses empty id, corpus collisions, empty claim arrays, and mismatched `compoundId` (`:353-367`)
- Context: `StoreProvider` (`:374-392`) accepts `data`, optional `initialEvidenceEdits`, optional
  whole `initialState` seed; `useAppState` (`:394-398`), `useDispatch` (`:400-404`)

Polarity rule stated at `:209-227`: for the RULESET the working copy is the default and
registered is the opt-in; for EVIDENCE registered is the default and working is the opt-in
(calling `workingClaims` is that opt-in). `useLibraryVerdicts` reads
`data.claimsByCompound` directly and that is deliberate.

---

## 6. Data loading (`src/data/bundle.ts`, `src/data/load.ts`)

### 6.1 Artifacts bundled at build time (all ES-module imports, never fetched)

| Line | Import | Real path | Size |
|---|---|---|---|
| `bundle.ts:12` | `evidence` | `data/out/evidence.json` | 822,928 B |
| `bundle.ts:13` | `compounds` | `data/out/compounds.json` | 269,857 B |
| `bundle.ts:14` | `splits` | `data/out/splits.json` | 31,574 B |
| `bundle.ts:15` | `fixture` | `data/out/tak994.json` | 4,462 B |
| `bundle.ts:16` | `assays` | `data/assays.json` | 3,026 B |
| `bundle.ts:17` | `ruleset` | `rules/ruleset-v1.0.json` | - |
| `bundle.ts:18` | `metrics` | `results/metrics.json` | 6,596 B |
| `bundle.ts:19` | `manifest` | `results/verdict-manifest.json` | 30,747 B (267 rows) |

`bundle.ts:9-10` records that `results/results.json` is deliberately EXCLUDED (676KB,
recomputable); `verdict-manifest.json` carries the cross-check instead.

### 6.2 `load.ts` (156 lines)

- `CompoundRow` `:8-10`; `LoadedData` `:12-23` = `{claimsByCompound, compounds, testSplit, ruleset, assays, metrics, heroCases, manifest}`
- `DataLoadError` `:25`
- `assertExposureBacked` `:46-57` - a FIXTURE case may not set `exposureRelevant: true` on a `safe` claim without a cited Cmax (HANDOVER §3.1)
- `loadData()` `:65-156`: ruleset parse `:67-71`; every claim through `EvidenceClaimSchema` `:74-83`; compounds indexed `:85-86`; manifest rows indexed `:88-91` (**only `rows`; the manifest's own `rulesetHash` field is ignored**); metrics parse `:97-101`; fixture claims `:103-110`; hero case 1 TAK-994 `:112-123`; hero case 2 Cyclosporine from the corpus `:128-142` (throws if the compound is missing); `assertExposureBacked` over all heroes `:144`
- `App.tsx:36-40` memoises `loadDataOnce()` and calls it INSIDE render so `ErrorBoundary` can catch the throw

Related: `data/heroCases.ts` (`BOOT_CASE = "TAK-994"` `:54`, `CYCLOSPORINE = "PMATZTZNYRCHOR-CGLBZJNRSA-N"` `:72`, and the docstring at `:57-71` recording that Cyclosporine is "the only rendered case where Dempster-Shafer conflict is non-zero", conflict mass 0.122);
`data/rulesetHash.ts` (`browserRulesetHash` `:17-19`, re-export of `PRE_REGISTERED_HASH` `:21`);
`data/evidenceDigest.ts` (`projectClaimsForDigest` `:36-52` - 11 engine-read fields, provenance excluded; `browserEvidenceDigest` `:54-56`).

Both `rulesetHash.ts:2` and `evidenceDigest.ts:2` import `canonicalJson`/`projectForHash`
from `../../../harness/src/preregistration.js`. That file has **no imports at all**
(`grep -n "^import" apps/harness/src/preregistration.ts` returns nothing), which is why the
browser can use it despite `types.ts:205` saying "the web app cannot import from the harness".

---

## 7. e2e specs (`apps/web/e2e/`, 3 files, 8 tests)

### `static-file.spec.ts` (177 lines, 5 tests) - runs against `file://apps/web/dist/index.html` (`:11`)

1. `:13-43` "the built artifact works opened from the filesystem, with no server": `verdict` contains /abstain/i, body contains "TAK-994", nav background is not transparent, and `failures` (pageerror + console error + requestfailed) is empty
2. `:45-70` "all eight beats walk on the keyboard alone": reads `/Beat \d of 8/`, asserts beat 7 (index) shows `do not advance` (the Cyclosporine switch), 8 distinct beat strings, ends at `#/validation`
3. `:72-101` "Web Crypto works over file://": signs twice on `#/record`, asserts `snapshot [0-9a-f]{12}…` and that the second entry does not chain to zeros, then `?` and `check-ruleset` / `check-manifest` both `data-ok="true"`
4. `:103-123` "the honesty caveats are not the least legible text on screen": **`single-class-warning` must be >= 15px and >= 600 weight; `citation-status` >= 14px and >= 600**
5. `:125-177` "the artifact requests nothing over the network": opens `#/validation` expecting `single-class-warning` visible, then `#/case` + `?`, and asserts `check-surface-1`/`check-surface-3` are neither `pending` nor `live`, with zero non-`file://` requests and zero console errors

### `ai-static.spec.ts` (89 lines, 2 tests) - also `file://`

1. `:21-75` pre-flight opened with REAL resolvers attempts no request; deliberately does NOT pin a rung
2. `:77-89` `check-evidence-edits` is `data-ok="true"` over `file://` (Web Crypto for the evidence digest)

### `demo.spec.ts` (110 lines, 5 tests) - runs against the preview server at `localhost:4173`

1. `:3-15` keyboard walk forward to `#/validation` (asserts `single-class-warning` visible) and back to `#/compounds`
2. `:17-41` M kills motion: `belief-fill` transitionDuration `0.9s, 0.9s` → `1e-05s`
3. `:43-65` `.evidence-row` and `.trace-step` keep `0.18s`, not the spotlight's 600ms
4. `:67-98` navigator question "You use an LLM as your baseline and in the product. Which is it?" → clicks `nav-anchor` → `validation.llmAblation` spotlights on then off, 0.6s both ways
5. `:100-110` R1 slider changes `live-belief` and shows `modified-badge`

Testids frozen by e2e and therefore un-renameable: `verdict`, `belief-fill`,
`citation-status`, `single-class-warning`, `live-belief`, `strength-R1`, `modified-badge`,
`position-row`, `check-ruleset`, `check-manifest`, `check-surface-1`, `check-surface-3`,
`check-evidence-edits`, `nav-input`, `nav-anchor`, plus the anchor
`validation.llmAblation`. `anchors.test.tsx:163-178` re-asserts most of that list.

---

## 8. Absence claims, with the terms searched

| Claim | Terms searched (case-insensitive, over `apps/web/src`, `apps/web/test`, `apps/web/e2e`) | Result |
|---|---|---|
| `conflictMass` is rendered by nothing in apps/web | `conflictmass`, `conflict_mass`, `conflict mass` | Only `test/heroCases.test.ts:87,89,90` (assertions on the engine value) and a prose mention in `data/heroCases.ts:63`. **Zero occurrences under `apps/web/src` outside that comment.** The screen shows only `r.contested` (`Case/TracePanel.tsx:27`) |
| No inter-rater agreement statistic | `kappa`, `cohen`, `krippendorff`, `fleiss`, `icc`, `inter.?rater`, `agreementRate`, `agreementStat` | One hit: `test/surface2.test.tsx:60` `meanAgreementRate: 0.91` inside a synthetic LLM-ablation object. Nothing rendered |
| No applicability-domain badge on evidence rows | `inApplicabilityDomain`, `applicability`, `domain` | `Intake.tsx:19,28,64,182,222-227`; `store.tsx:81`; `evidenceDigest.ts:48`; `interpret.ts:66,86,215,237`; `anchors.ts:81`; `About.tsx:216` prose; `TablePanel.tsx:81` comment; `record/chain.ts:15` comment. **`Case/EvidencePanel.tsx` contains none of these strings** |
| No commit-before-reveal in apps/web | `blind`, `reveal`, `commitBefore`, `prediction.?first`, `hidden verdict` | Only colour-blindness comments (`VerdictLabel.tsx:12`, `Preflight.tsx:42`). `CaseHeader.tsx:44` renders `<VerdictLabel>` unconditionally on mount |
| apps/web knows nothing about the deliberation app or its disagreement report | `deliberation`, `disagreementReport`, `camp`, `unanimity` | Zero hits under `apps/web/src` |
| No severity vocabulary | `severity`, `less-dili`, `vLess`, `concern` | Zero hits under `apps/web/src` |
| Only two API paths are ever posted to | `/api/`, `fetch(` | `client.ts:60` is the only `fetch`; the only paths are `"/api/interpret"` (`interpret.ts:325`) and `"/api/navigate"` (`navigate.ts:158`) |
| No `ruleset-v2.0.json` anywhere in the app | `ruleset-v2`, `v2.0`, `PRE_REGISTERED_HASH_V2`, `984dc08` | Zero hits under `apps/web` |
| No runtime data fetch of any bundled artifact | `fetch(`, `XMLHttpRequest`, `import(` | Only `client.ts:60` |

---

## 9. Things a build prompt will trip over

1. **Adding any `data-anchor` requires a matching `ANCHORS` entry** or
   `anchors.test.tsx:112-120` fails ("every unconditional anchor is present exactly once"),
   and an anchor that can be absent must also be added to `CONDITIONAL_ANCHORS`
   (`anchors.ts:42-48`). Conversely `About.tsx:229` already violates the spirit of this by
   emitting an unregistered `about.structurallyForced`, and no test catches it because
   About is not in the `TABS` map of `anchors.test.tsx:19-25`.
2. **Every `<button>` must have an accessible name** - `a11y.test.tsx:6-12` renders the whole
   `<App/>` and iterates `getAllByRole("button")`.
3. **A caveat's font size is asserted in e2e.** `single-class-warning` must stay >= 15px/600
   and `citation-status` >= 14px/600 (`static-file.spec.ts:108-123`). Both come from
   `.caveat`/`.caveat-warn` in `apps/web/src/ui/app.css`.
4. **Collapsed Case regions unmount.** Anything added to a Case panel is absent from the DOM
   while another region holds focus, which is why `Anchor.region` exists.
5. **The verdict cannot be gated behind an interaction without breaking three e2e tests**
   (`static-file.spec.ts:27,62,163`, `ai-static.spec.ts:46,86`, `demo.spec.ts:5`) which all
   wait on `getByTestId("verdict")` immediately after `goto`.
6. **Nothing may be fetched at runtime.** `static-file.spec.ts:125-177` and
   `ai-static.spec.ts:21-75` fail on any non-`file://` request AND on any console error.
7. **The metrics document is parsed before render.** Any hand-edited `results/metrics.json`
   that violates one of the five refinements listed in §1.1 blanks the app into the
   `ErrorBoundary` with `results/metrics.json: invalid metric at <path>` (`load.ts:100`) -
   which `dataLoadFailure.test.tsx` already exercises.
8. **`MetricsDocument` in `packages/engine/src/types.ts:418-427` must move in lockstep with
   `MetricsDocumentSchema`** because of the mutual-assignability guard at `schema.ts:308`
   forced by the value site at `schema.ts:314`.
9. **`apps/web/dist/index.html` is a committed build artifact.** It is stale by design
   between builds; anything published today still carries the v1.0 metrics until
   `npm run web:build` is re-run.
