# Inventory: the measurement spine

`packages/engine`, `apps/harness`, `rules/`, `tools/`.

Written 2026-08-13 by direct file reading. Every line number below was opened and confirmed.
Nothing here proposes a change. Where a claim is an absence, the names searched are listed.

**Methodological note.** I did NOT execute `npm run harness` or `npm run metrics` during this
inventory (the sandbox refused the invocation, and running them would rewrite tracked
artifacts). Every hash in this document was recomputed independently with a standalone
Node script over the committed JSON files, so the hash claims are verified; the claim
"re-running reproduces the committed file byte for byte" is **not** verified and is flagged
where it matters.

---

## 1. The spine at a glance

```
data/raw/dilirank.xlsx
   |  data/prep/ingest_dilirank.py      (reads rules/ruleset-v1.0.json binarisation)
   v
data/out/compounds.json  { compoundId, name, smiles, inchikey, dilirankLabel, y }
   |  data/prep/make_splits.py          (STRATIFIED ON y, seed 20260726)
   v
data/out/splits.json     { seed, fractions, sizes, positiveRate, train[], calibration[], test[] }
   |  data/prep/qsar_stream.py          (fits on splits.train, y from compounds.json)
   |  data/prep/tox21_stream.py, exposure_margin.py, assemble_evidence.py
   v
data/out/evidence.json   { generatedAt, claims[1356], benchmarkCompoundIds, fixtureCompoundIds, ... }
   |
   |  npm run harness   ->  tsx apps/harness/src/main.ts
   |     loadInputs()  (apps/harness/src/load.ts:40)
   |        parses rules/ruleset-v1.0.json, gates on PRE_REGISTERED_HASH
   |        parses rules/exposure-policy-v1.0.json, gates on PRE_REGISTERED_EXPOSURE_POLICY_HASH
   |     reason(claims, ruleset, hash, assays) per test-split compound
   v
results/results.json          (267 rows, 692 KB, tracked in git)
results/verdict-manifest.json (267 rows, tracked, CI diffs it)
   |
   |  npm run metrics   ->  tsx apps/harness/src/run-metrics.ts
   |     reads results/results.json + loadInputs() AGAIN
   |     MetricsDocumentSchema.parse before write
   v
results/metrics.json          (tracked; the harness-to-app contract)
   |
   +-> apps/web/src/data/bundle.ts:18   import metrics from ".../results/metrics.json"  (build-time)
   +-> apps/landing/test/landing.test.tsx:177  readFileSync(".../results/metrics.json")
   +-> apps/harness/src/golden.ts:62    extractGolden()
          |  npm run golden:update -> tsx apps/harness/src/update-golden.ts
          v
       results/golden/metrics.golden.json  (tracked; compared by apps/harness/test/golden.test.ts:196)
```

Side branch, not wired into metrics.json at all:

```
data/out/tak994.json --> tools/build_probe_case.py --> data/probe-case.json
                            (reads rules/ruleset-v2.0.json for the rule list)
prompts/adjudicator-v1.0.json + data/probe-case.json
   |  npm run probe    -> tsx services/api/probe.ts
   v
results/probe-runs.json   <-- DOES NOT EXIST TODAY
   |  npm run probe:report -> tsx apps/harness/src/consistency-report.ts
   v
stdout only (reads rules/pass-marks-v1.0.json for the bars)

results/results.json + data/out/compounds.json + rules/ruleset-v1.0.json + rules/ruleset-v2.0.json
   |  python tools/rescore_v2.py   (NO npm script)
   v
stdout only.  results/rescore-v2.txt is a captured transcript, not a written artifact.
```

---

## 2. npm scripts that touch the spine

Source: `package.json` (root), `scripts` block.

| script | command | reads | writes |
|---|---|---|---|
| `npm run harness` | `tsx apps/harness/src/main.ts` | `rules/ruleset-v1.0.json`, `rules/exposure-policy-v1.0.json`, `data/out/evidence.json`, `data/out/splits.json`, `data/out/compounds.json`, `data/assays.json` | `results/results.json`, `results/verdict-manifest.json` |
| `npm run metrics` | `tsx apps/harness/src/run-metrics.ts` | `results/results.json`, everything `loadInputs()` reads, optionally `results/ablation.json` | `results/metrics.json` |
| `npm run golden:update` | `tsx apps/harness/src/update-golden.ts` | `results/metrics.json` | `results/golden/metrics.golden.json` |
| `npm run validate:evidence` | `tsx apps/harness/src/validate-evidence.ts` | same as `loadInputs()` | nothing (stdout) |
| `npm run coverage:report` | `tsx apps/harness/src/coverage-report.ts` | `results/results.json`, `loadInputs()` | nothing (stdout) |
| `npm run probe:case` | `python tools/build_probe_case.py` | `data/out/tak994.json`, `rules/ruleset-v2.0.json` | `data/probe-case.json` |
| `npm run probe` | `tsx services/api/probe.ts` | `prompts/adjudicator-v1.0.json`, `data/probe-case.json`, env | `results/probe-runs.json` |
| `npm run probe:report` | `tsx apps/harness/src/consistency-report.ts` | `results/probe-runs.json`, `rules/pass-marks-v1.0.json` | nothing (stdout) |
| `npm test` | `vitest run` | - | - |
| `npm run typecheck` | `tsc -b packages/engine apps/harness && tsc -p apps/web --noEmit && ...` | - | `apps/harness/dist/` (gitignored) |
| `npm run lint` | `eslint packages apps services --ext .ts,.tsx` | - | - |

**Scripts that do NOT exist** (checked against the `scripts` block by name):

- `npm run ablation` - referenced in the placeholder note `apps/harness/src/run-metrics.ts:30`
  ("run `npm run ablation` (Task 14, needs ANTHROPIC_API_KEY)"), and echoed verbatim into
  `results/metrics.json` at `metric2a_llmConsistency.note`. There is no such script and no
  runner entry file. `apps/harness/src/ablation/` contains only three library modules -
  `prompt.ts`, `aggregate.ts`, `resume.ts` - each with unit tests
  (`ablationPrompt.test.ts` 10 cases, `ablationAggregate.test.ts` 15, `ablationResume.test.ts` 13).
  **The metrics document currently instructs the reader to run a command that does not exist.**
- `npm run golden:check` - referenced in `docs/superpowers/plans/2026-07-26-...md:8386`. CI uses
  `npm test -- apps/harness/test/golden.test.ts` instead (`.github/workflows/ci.yml:23`).
- `npm run rescore` / any script for `tools/rescore_v2.py` or `tools/build_test_groups.py`.
  Both are invoked as bare `python tools/<file>.py`.

---

## 3. EXACTLY how `results/metrics.json` is produced

### 3.1 Stage 0: the label `y` and the split (Python, upstream of everything)

| file:line | what it does |
|---|---|
| `data/prep/dilirank_common.py:26` | `RULESET = ROOT / "rules" / "ruleset-v1.0.json"` - **hard-coded to v1.0** |
| `data/prep/dilirank_common.py:41-43` | `binarisation_policy()` returns `json.loads(RULESET.read_text())["dilirankBinarisation"]` |
| `data/prep/dilirank_common.py:46-68` | `norm_label()` strips every non-letter and lowercases, because the workbook's casing does not match the registered strings literally |
| `data/prep/ingest_dilirank.py:32-41` | builds `positive` / `negative` normalised sets from the policy, drops anything in neither |
| `data/prep/ingest_dilirank.py:59` | `df["y"] = df["labelNorm"].isin(positive).astype(int)` |
| `data/prep/make_splits.py:24` | `SEED = 20260726` |
| `data/prep/make_splits.py:41-54` | **stratified on `y`**: two buckets keyed by `c["y"]`, each permuted with `np.random.default_rng(SEED)`, sliced 50/20/30 |
| `data/prep/qsar_stream.py:114-127` | fits the QSAR model on `splits["train"]` using `by_id[i]["y"]` |

Committed state of `data/out/compounds.json`:

```
nCompounds 890,  y=1: 536,  y=0: 354
labels: vNo-DILI-concern 353, vLess-DILI-concern 330, vMost-DILI-concern 204,
        vMOST-DILI-concern 2, vNo-DILI-Concern 1
```

Committed state of `data/out/splits.json`: `seed 20260726`, sizes `train 445 / calibration 178 /
test 267`, `positiveRate {train 0.6022, calibration 0.6011, test 0.603}`.

**This is the single most consequential fact in this document.** `y` is a v1.0 quantity, and
the split is a function of `y`. Anything that regenerates `y` regenerates the split, which
regenerates the QSAR training set, which regenerates `evidence.json`, which regenerates every
verdict. See section 6.

### 3.2 Stage 1: `npm run harness` -> `apps/harness/src/main.ts`

`apps/harness/src/main.ts` is 85 lines with a bare `main()` call at line 84.

| line | code |
|---|---|
| `main.ts:6-12` | `export interface ResultRow { compoundId: string; y: number; conflicting: boolean; arbiter: Reasoning; baselines: Record<string, Prediction> }` |
| `main.ts:15` | `const { claimsByCompound, splits, truth, ruleset, hash, assays } = loadInputs();` |
| `main.ts:21` | `for (const compoundId of splits.test)` - **only the test split is scored** |
| `main.ts:23-24` | skips a compound with no truth label |
| `main.ts:26-29` | baselines: `majorityVote`, `weightedAverage`, plus `single:<stream>` for all six `ALL_STREAMS` |
| `main.ts:37` | `conflicting: detectConflict(claims).conflicting` - the pre-registered conflict-subset definition, a property of RAW claims, deliberately **not** `reason().contested` |
| `main.ts:38` | `arbiter: reason(claims, ruleset, hash, assays)` |
| `main.ts:43-52` | writes `results/results.json` with `{ rulesetVersion: ruleset.version, rulesetHash: hash, splitSeed: splits.seed, scoredSplit: "test", n, nConflicting, rows }` |
| `main.ts:57-64` | writes `results/verdict-manifest.json` with `{ rulesetHash: hash, rows: [{compoundId, verdict, belief}] }` |

Committed `results/results.json` header: `rulesetVersion "1.0"`, `rulesetHash "ed073a8a…"`,
`splitSeed 20260726`, `scoredSplit "test"`, `n 267`, `nConflicting 61`.

### 3.3 `loadInputs()` - the gate

`apps/harness/src/load.ts:40-89`.

| line | code | consequence |
|---|---|---|
| `load.ts:41` | `const ruleset = RulesetSchema.parse(read("rules/ruleset-v1.0.json")) as Ruleset;` | **the v1.0 path is a string literal in this function.** There is no parameter, no env var, no CLI flag. |
| `load.ts:42` | `read("data/out/evidence.json")` | |
| `load.ts:43` | `read("data/out/splits.json")` | |
| `load.ts:44` | `read("data/out/compounds.json").compounds as { compoundId, y }[]` | `y` is taken **as stored**, never recomputed from `dilirankLabel` |
| `load.ts:47` | `read("data/assays.json").assays` | 5 assays: `murine-cyp-induction`, `human-hepatocyte-spheroid`, `bsep-inhibition`, `mito-tox-panel`, `readacross-refinement` |
| `load.ts:49` | `const hash = rulesetHash(projectForHash(ruleset));` | |
| `load.ts:50-57` | `if (hash !== PRE_REGISTERED_HASH) throw` | **guard 1** |
| `load.ts:59-60` | reads `rules/exposure-policy-v1.0.json`, projects, hashes | |
| `load.ts:61-69` | `if (exposureHash !== PRE_REGISTERED_EXPOSURE_POLICY_HASH) throw` | **guard 2** |
| `load.ts:72-77` | every claim goes through `EvidenceClaimSchema.parse` - the cross-language check that Python emits what TypeScript accepts | |
| `load.ts:92-94` | `asOf(claims, date)` - exported, filters by `availableFrom`. Not called by `main.ts`. | |

### 3.4 Stage 2: `npm run metrics` -> `apps/harness/src/run-metrics.ts`

133 lines, bare `main()` at line 132.

| line | code |
|---|---|
| `run-metrics.ts:10-12` | `const ROBUSTNESS_SAMPLES = 2000; const SENSITIVITY_SAMPLES = 2000; const SEED = 20260726;` |
| `run-metrics.ts:15-17` | reads `results/results.json` (typed inline as `{ rulesetVersion, rulesetHash, splitSeed, rows }`) |
| `run-metrics.ts:18` | calls `loadInputs()` **again** - so both hash guards fire a second time |
| `run-metrics.ts:20` | `const conflictRows = rows.filter((r) => r.conflicting);` |
| `run-metrics.ts:23-27` | robustness and planner-sensitivity sampling over `conflictRows` only |
| `run-metrics.ts:30` | the LlmConsistency placeholder note (see section 2, "scripts that do not exist") |
| `run-metrics.ts:31-45` | if `results/ablation.json` exists, aggregates it into `metric2a` |
| `run-metrics.ts:47` | `const m1 = conflictSubsetAccuracy(rows);` |
| `run-metrics.ts:56` | `const metrics: MetricsDocument = {` - annotated, so a rename fails at the WRITER |
| **`run-metrics.ts:58`** | **`rulesetVersion: results.rulesetVersion,`** |
| **`run-metrics.ts:59`** | **`rulesetHash: results.rulesetHash,`** |
| `run-metrics.ts:60` | `splitSeed: results.splitSeed,` |
| `run-metrics.ts:61` | `perturbationSeed: SEED,` |
| `run-metrics.ts:62` | `scoredSplit: "test",` - a string literal, not read from `results.json` |
| `run-metrics.ts:63` | the provenance `note` string, hard-coded |
| `run-metrics.ts:99` | `MetricsDocumentSchema.parse(metrics);` - validated, and the **original** object is written, not the parse result |
| `run-metrics.ts:100` | `writeFileSync("results/metrics.json", JSON.stringify(metrics, null, 2));` |
| `run-metrics.ts:117-125` | prints a COVERAGE WARNING when `m1.arbiter.coverage < 0.25`. It fires today (0.0656). |
| `run-metrics.ts:126-129` | prints a SINGLE-CLASS WARNING when `m1.arbiter.singleClass`. It fires today. |

**Answer to "where do `provenance.rulesetVersion` and `provenance.rulesetHash` come from":**
they are copied verbatim from `results/results.json` at `run-metrics.ts:58-59`. They are NOT
recomputed in `run-metrics.ts` and NOT read from the ruleset file there. `results.json` in
turn got them from `main.ts:45-46` (`ruleset.version` and the hash `loadInputs()` computed and
gated). So the chain is:

```
rules/ruleset-v1.0.json.version  -> load.ts:41 (parse) -> main.ts:45 -> results.json.rulesetVersion -> run-metrics.ts:58 -> metrics.json.provenance.rulesetVersion
projectForHash(ruleset) -> load.ts:49 rulesetHash() -> gated at load.ts:50 -> main.ts:46 -> results.json.rulesetHash -> run-metrics.ts:59 -> metrics.json.provenance.rulesetHash
```

Nothing in `run-metrics.ts` independently checks that `results.json`'s hash still matches the
ruleset on disk. It re-runs `loadInputs()` (which gates the file on disk), but it never
compares that to `results.rulesetHash`. A stale `results.json` from a different ruleset would
be copied into `metrics.json` untouched.

### 3.5 The metric functions (`apps/harness/src/metrics.ts`)

| export | line | notes |
|---|---|---|
| `toBinary` (module-private) | `metrics.ts:20-21` | `do_not_advance -> 1`, `advance -> 0`, `abstain -> null` |
| `score` (module-private) | `metrics.ts:23-36` | returns `ScoredPipeline` |
| `conflictSubsetAccuracy(rows): ConflictSubsetAccuracy` | `metrics.ts:48` | filters `r.conflicting`, sorts baseline names |
| `calibration(rows): Calibration` | `metrics.ts:85` | width = `plausibility - belief` |
| `streamCoverage(rows, claimsByCompound): Record<string, StreamCoverage>` | `metrics.ts:134` | keys sorted for byte stability |
| `committedMassCeiling(row, claims, ruleset): number` | `metrics.ts:179` | uses `relevanceDiscount` from the engine, never the trace prose |
| `abstentionQuality(rows, claimsByCompound, ruleset): AbstentionQuality` | `metrics.ts:191` | `bar = 1 - ruleset.abstentionGapThreshold` at `:206`; **throws** at `:216` if any structurally-forced compound committed |
| `robustness(claims, ruleset, samples, seed)` | `metrics.ts:258` | jitters claim strength +/-10%, rule strength +/-25%, via `mulberry32` |
| `plannerSensitivity(claims, ruleset, assays, samples, seed)` | `metrics.ts:295` | perturbs every `priorToxic` by `uniform(0.5, 1.5)`, clamped to `[0.01, 0.99]` |

Statistics live in `apps/harness/src/stats.ts`: `wilson` (`:16`), `confusion` (`:26`),
`balancedAccuracy` (`:47`, substitutes 0.5 for an absent class), `singleClass` (`:62`),
`balancedAccuracyInterval` (`:87`, returns `null` when a class is absent), `mean` (`:96`).
PRNG in `apps/harness/src/prng.ts`: `mulberry32` (`:13`), `uniform` (`:25`), `jitter01` (`:30`).

### 3.6 The committed `results/metrics.json`

```json
"provenance": {
  "rulesetVersion": "1.0",
  "rulesetHash": "ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136",
  "splitSeed": 20260726, "perturbationSeed": 20260726, "scoredSplit": "test"
},
"sampleSizes": { "scored": 267, "conflictSubset": 61,
  "streamCoverage": { "cytotox": {claims 127, compounds 127},
                      "qsar": {claims 267, compounds 267},
                      "transporter": {claims 4, compounds 4} } },
"metric1_conflictSubsetAccuracy": { "n": 61, "positiveRate": 0.9016393442622951,
  "arbiter": { balancedAccuracy 0.75, balancedAccuracyCi null,
               rawAccuracyCi {0.5100999795960008, 1}, coverage 0.06557377049180328,
               nCommitted 4, confusion {tp 4, fp 0, tn 0, fn 0}, singleClass true } },
"metric2a_llmConsistency": { "note": "results/ablation.json not present - run `npm run ablation` ..." },
"metric2b_arbiterRobustness": { determinism 1, meanHeldFraction 1, worstHeldFraction 1,
               meanHeldFractionOnCommitted 1, nCommittedCompounds 4, samplesPerCompound 2000, seed 20260726 },
"metric3_calibration": { strictCoverage 0.5355805243445693, meanWidth 0.8995055583175798,
               meanWidthOnCorrect 0.09756239411334248, meanWidthOnIncorrect 0,
               widthDiscriminates false, widthDiscriminatesIsMeaningful false, nCorrect 7, nIncorrect 0 },
"metric4_abstentionQuality": { declineRate 0.9737827715355806, balancedAccuracyOnCommitted 0.75,
               ciOnCommitted {0.6456611570247934, 1}, singleClassOnCommitted true,
               nDeclined 260, nCommitted 7, nStructurallyForced 254 },
"metric5_plannerSensitivity": { nCompoundsWithRecommendation 61,
               meanUnchangedFraction 0.9917704918032786, samplesPerCompound 2000, seed 20260726 }
```

Baselines in `metric1`, all present in the committed file:
`majorityVote` (0.750, cov 0.049, n 3, tp3), `single:cytotox` (0.500, cov 1.0, n 61, tn6/fn55),
`single:invivo_nonrodent` (0.5, cov 0, n 0), `single:invivo_rodent` (0.5, cov 0, n 0),
`single:qsar` (0.500, cov 0.984, n 60, tp54/fp6), `single:toxicogenomics` (0.5, cov 0, n 0),
`single:transporter` (0.750, cov 0.0656, n 4, tp4), `weightedAverage` (0.546969696969697, cov 1.0, n 61).

---

## 4. What `apps/harness/src/preregistration.ts` enforces

107 lines, **no crypto import** - that is the whole reason the file exists. `hash.ts` re-exports
from it (`hash.ts:26-29`) so that `apps/web/src/data/rulesetHash.ts:2,21` can import the same
projection into the browser without pulling in `node:crypto`.

| export | line | definition |
|---|---|---|
| `canonicalJson(v: unknown): string` | `:17-22` | recursive; object keys sorted at every level with `(a < b ? -1 : 1)`; arrays preserved in order |
| `projectForHash(rs): Record<string, unknown>` | `:32-44` | returns exactly `{ rules, abstentionGapThreshold, dilirankBinarisation, precedenceOrder }`. Excludes `version`, `registeredAt`, `precedenceRationale`. |
| `PRE_REGISTERED_HASH` | `:53-54` | `"ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136"` |
| `PRE_REGISTERED_HASH_V2` | `:75-76` | `"984dc08dad55683c74bcdaae9b9da810829046669461d193a4687325be192227"` |
| `projectExposurePolicyForHash(p)` | `:86-96` | returns exactly `{ marginFactor, basis, appliesToStreams }` |
| `PRE_REGISTERED_EXPOSURE_POLICY_HASH` | `:106-107` | `"43f1d1e914feb10c4c9e7da35c45009d34686a34e84b46d9446ea8d5da1979ba"` |

`apps/harness/src/hash.ts:16-18`:
`rulesetHash(ruleset: unknown) => createHash("sha256").update(canonicalJson(ruleset)).digest("hex")`.
It hashes exactly what it is handed; projecting is the caller's job, documented at `hash.ts:4-15`.

### 4.1 Hashes recomputed independently (verified during this inventory)

| input | projection | digest | matches constant |
|---|---|---|---|
| `rules/ruleset-v1.0.json` | `projectForHash` | `ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136` | `PRE_REGISTERED_HASH` YES |
| `rules/ruleset-v2.0.json` | `projectForHash` | `984dc08dad55683c74bcdaae9b9da810829046669461d193a4687325be192227` | `PRE_REGISTERED_HASH_V2` YES |
| `rules/exposure-policy-v1.0.json` | `projectExposurePolicyForHash` | `43f1d1e914feb10c4c9e7da35c45009d34686a34e84b46d9446ea8d5da1979ba` | `PRE_REGISTERED_EXPOSURE_POLICY_HASH` YES |

Also verified: `RulesetSchema.parse()` (a non-strict `z.object`, `schema.ts:46-64`) **strips**
v2.0's extra keys `supersedes`, `reregistrationReason`, `binarisationRationale`, `scopeNote`
and leaves the projected surface unchanged, so hashing the parsed object and hashing the raw
object give the same digest for both rulesets. Parsing `rules/ruleset-v2.0.json` through
`RulesetSchema` succeeds today; parsed keys are
`version, registeredAt, abstentionGapThreshold, dilirankBinarisation, rules, precedenceOrder, precedenceRationale`.

### 4.2 `PRE_REGISTERED_HASH_V2` has exactly one occurrence in the whole repository

Search: `grep -rn "PRE_REGISTERED_HASH_V2" --exclude-dir={node_modules,dist,.git} .`
returns one line - its own declaration at `apps/harness/src/preregistration.ts:75`.
**Nothing imports it. Nothing gates on it. It is a documented constant with no consumer.**
(`apps/harness/dist/preregistration.d.ts:58` also carries it, but `dist/` is gitignored build
output.)

### 4.3 No TypeScript file reads `rules/ruleset-v2.0.json`

Search: `grep -rn "ruleset-v2.0" --exclude-dir={node_modules,.git} .` The only code hits are
`tools/rescore_v2.py:151`, `tools/build_test_groups.py:39`, `tools/build_probe_case.py:26`.
Everything else is prose (`README.md:84`, `HANDOVER.md:1566,1613`, plan docs).
`apps/web/src/data/bundle.ts:17` imports `rules/ruleset-v1.0.json`.

### 4.4 The two registered rulesets, diffed

Both parse against `RulesetSchema`. Their projected surfaces differ in exactly one field.

| field | v1.0 | v2.0 |
|---|---|---|
| `version` | `"1.0"` | `"2.0"` (not in the hashed surface) |
| `registeredAt` | `2026-07-26` | `2026-08-09` (not in the hashed surface) |
| `abstentionGapThreshold` | `0.5` | `0.5` (identical) |
| `precedenceOrder` | `["R3","R1","R2","R5"]` | identical |
| `rules` | R1 0.9, R2 0.85, R3 0.85, R4 0.5, R5 0.6, R6 0.4, all enabled | **byte-identical** |
| `dilirankBinarisation.positive` | `["vMost-DILI-Concern","vLess-DILI-Concern"]` | `["vMost-DILI-Concern"]` |
| `dilirankBinarisation.negative` | `["vNo-DILI-Concern"]` | `["vNo-DILI-Concern","vLess-DILI-Concern"]` |
| `dilirankBinarisation.excluded` | `["Ambiguous-DILI-concern"]` | identical |
| extra keys | `precedenceRationale` | `supersedes`, `reregistrationReason`, `binarisationRationale`, `scopeNote`, `precedenceRationale` |

`rules/ruleset-v2.0.json`'s `scopeNote` says explicitly that the expanded severity checklist
(dose magnitude, injury pattern, reversibility, expected frequency, reactive-metabolite
formation, latency, dechallenge) is **deliberately not registered**, "because nothing
implements those rules yet".

---

## 5. `tools/rescore_v2.py` - what it does, what it does not, what it writes

217 lines. Read in full.

### 5.1 What it does

- **Re-grades, does not re-run.** Module docstring lines 1-26 state this and give the reason:
  the verdicts in `results/results.json` are a function of the evidence and R1-R6, and v2.0
  changes neither, so re-running would produce byte-identical verdicts.
- Reads four files at `:148-151`: `results/results.json`, `data/out/compounds.json`,
  `rules/ruleset-v1.0.json` (`dilirankBinarisation` only), `rules/ruleset-v2.0.json`
  (`dilirankBinarisation` only).
- Re-derives `y` per compound from `compounds.json`'s `dilirankLabel` via `relabel()` (`:112-119`)
  and `norm()` (`:108-109`, `s.strip().lower()`). **It does not use the stored `y` field at all.**
- Transcribes the harness statistics rather than importing them: `wilson` (`:38`),
  `confusion` (`:49`), `balanced_accuracy` (`:63`, reproducing the 0.5 substitution
  deliberately), `single_class` (`:73`), `balanced_accuracy_interval` (`:78`),
  `to_binary` (`:87`), `score` (`:92`).
- Prints, for each of v1.0 and v2.0, two subsets: `CONFLICT SUBSET (the headline)` (rows where
  `r["conflicting"]`) and `FULL SCORED SPLIT` (all rows). ARBITER first, then every baseline
  with `nCommitted > 0` (`:174-192`).
- **Drift guard at `:194-212`:** recomputes the v1.0 conflict-subset ARBITER score and asserts
  `balancedAccuracy`, `confusion` and `nCommitted` match `results/metrics.json`'s
  `metric1_conflictSubsetAccuracy.arbiter`. Prints PASS/FAIL and `raise SystemExit(1)` on FAIL.
  The captured transcript shows it passing.
- Discloses at `:19-25` that the QSAR stream was fitted under v1.0, so the v2.0 figures are a
  **lower bound**, and that refitting is deliberately not done because it would stop this being
  a single-variable measurement.

### 5.2 What it writes

**Nothing.** There is no `write_text`, no `open(..., "w")`, no `json.dump` to a file anywhere in
the script. Every output is `print()` to stdout. `results/rescore-v2.txt` (188 lines, tracked in
git, whitelisted at `.gitignore:63`) is a **captured transcript** of one run, not an artifact the
script produces. Re-running the script does not update it.

### 5.3 What it does NOT cover

| the harness produces | rescore_v2.py produces |
|---|---|
| `provenance` block (version, hash, seeds, scoredSplit, note) | nothing |
| `sampleSizes.streamCoverage` | nothing |
| `metric2a_llmConsistency` | nothing |
| `metric2b_arbiterRobustness` (2000-sample perturbation) | nothing |
| `metric3_calibration` (belief/plausibility widths) | nothing |
| `metric4_abstentionQuality` including `nStructurallyForced` (the 254 figure) | nothing |
| `metric5_plannerSensitivity` | nothing |
| a machine-readable document validated by `MetricsDocumentSchema` | free-form text |
| `single:*` baselines with `nCommitted == 0` | **suppressed** at `:190-191` (`if b["nCommitted"] == 0: continue`) |

It also does not emit `positiveRate`, `n`, `coverage` etc. in any parseable form - they are
embedded in printf-formatted report lines (`report()`, `:134-144`).

So: `rescore_v2.py` covers exactly `metric1_conflictSubsetAccuracy` (plus the same statistic on
the full split, which the harness does not compute), for both targets, as text. It covers
**one of the eight top-level keys** of `MetricsDocument`, and not in a machine-readable shape.

### 5.4 The v2.0 numbers it printed (from `results/rescore-v2.txt`)

Conflict subset, n=61, positives 29.5% under v2.0:

| pipeline | committed | coverage | confusion | balanced acc | single-class |
|---|---|---|---|---|---|
| ARBITER | 4 | 6.6% | tp1/fp3/tn0/fn0 | 0.500 (CI 0.10-0.78) | no |
| majorityVote | 3 | 4.9% | tp0/fp3/tn0/fn0 | 0.250 | yes |
| single:cytotox | 61 | 100% | tp0/fp0/tn43/fn18 | 0.500 | no |
| single:qsar | 60 | 98.4% | tp17/fp43/tn0/fn0 | 0.500 | no |
| single:transporter | 4 | 6.6% | tp1/fp3/tn0/fn0 | 0.500 | no |
| weightedAverage | 61 | 100% | tp17/fp39/tn4/fn1 | 0.519 | no |

Full scored split, n=267, positives 21.7% under v2.0:

| pipeline | committed | coverage | confusion | balanced acc |
|---|---|---|---|---|
| ARBITER | 7 | 2.6% | tp2/fp5/tn0/fn0 | 0.500 |
| majorityVote | 159 | 59.6% | tp13/fp59/tn68/fn19 | 0.471 |
| single:cytotox | 127 | 47.6% | tp3/fp6/tn84/fn34 | 0.507 |
| single:qsar | 167 | 62.5% | tp29/fp95/tn40/fn3 | 0.601 |
| single:transporter | 4 | 1.5% | tp1/fp3/tn0/fn0 | 0.500 |
| weightedAverage | 217 | 81.3% | tp30/fp95/tn72/fn20 | 0.516 |

Note the shipped headline (`metrics.json` `metric1`) is the **conflict subset**, so the
apples-to-apples v2.0 replacement for `0.750 / tp4/fp0/tn0/fn0` is `0.500 / tp1/fp3/tn0/fn0`
(conflict subset), not the `tp2/fp5` figure, which is the FULL split. HANDOVER 13.2's table is
labelled "full scored split" and reports `tp 4/0/0/0` for v1.0 there, which is the conflict
subset's confusion - the HANDOVER table's v1.0 row and v2.0 row come from different subsets.
The transcript is the authority: full-split v1.0 ARBITER is `tp7/fp0/tn0/fn0` (`rescore-v2.txt:53`).

---

## 6. What it would take to regenerate `metrics.json` under `rules/ruleset-v2.0.json`

There are two genuinely different meanings of "regenerate", and they cost different orders of
magnitude. A build prompt must pick one explicitly.

### Interpretation A: RE-GRADE (same verdicts, v2.0 scorecard)

This is what `rescore_v2.py` already does in text, and what HANDOVER 13.2 argues is the correct
single-variable measurement. The engine is not re-run; `results/results.json` is reused as-is.

**Files that would have to change:**

| file | change |
|---|---|
| `apps/harness/src/load.ts:41` | the `"rules/ruleset-v1.0.json"` string literal is not parameterised. Either a new loader is added or this line gains a parameter/env switch. |
| `apps/harness/src/load.ts:49-57` | the guard compares against `PRE_REGISTERED_HASH` (v1.0) unconditionally. Under v2.0 the computed hash is `984dc08d…` and this **throws**. |
| `apps/harness/src/run-metrics.ts:58-59` | provenance is copied from `results.json`, which says `"1.0"` / `ed073a8a…`. Under a v2.0 grade these must say `"2.0"` / `984dc08d…`, which means either `results.json` changes or `run-metrics.ts` stops copying. |
| `apps/harness/src/metrics.ts` | every metric takes `y` from `ResultRow.y`, which was written under v1.0. A re-grade needs a relabelling step (`compounds.json.dilirankLabel` -> v2.0 policy), which exists **only in Python** today (`rescore_v2.py:108-119`). There is no TypeScript `relabel`. |
| output path | writing `results/metrics.json` in place would destroy the v1.0 record; `.gitignore:53-58` whitelists only `results/metrics.json`, `results/results.json`, `results/verdict-manifest.json`, `results/golden/metrics.golden.json`, `results/rescore-v2.txt`, `results/probe-runs.json`. A new filename needs a new `.gitignore` negation. |

**Hash guards that would trip:**

1. `apps/harness/src/load.ts:50` - `hash !== PRE_REGISTERED_HASH`. Throws before anything else
   runs, in **both** `npm run harness` and `npm run metrics` (both call `loadInputs()`), and in
   `npm run validate:evidence` and `npm run coverage:report`.
2. `apps/harness/test/hash.test.ts:47,50` - pins `projectForHash(rules/ruleset-v1.0.json)` to
   `ed073a8a…` and to `PRE_REGISTERED_HASH`. It imports the v1.0 file directly, so it does not
   trip unless v1.0 itself is edited. **It does not currently pin v2.0 to anything.**
3. `apps/harness/src/load.ts:61` - the exposure-policy guard. Unaffected by a ruleset change.
4. `apps/web/src/ui/Preflight.tsx:162` - `hashOk = hash === PRE_REGISTERED_HASH`, computed in the
   browser over the bundled `rules/ruleset-v1.0.json`. Unaffected unless the bundle switches.
5. `apps/web/test/validation.test.tsx:74` - asserts the rendered provenance line matches
   `/ed073a8a/`. The rendered value comes from `metrics.json.provenance.rulesetHash`
   (`apps/web/src/tabs/Validation.tsx:52`). **This test fails the moment `metrics.json` carries
   the v2.0 hash.**
6. `apps/web/test/preflight.test.tsx:53` and `apps/web/test/ruleset.test.tsx:19` also assert
   `ed073a8a`, but those read the bundled ruleset, not metrics.json.

**Would the golden files move? YES, and by a lot.**

`results/golden/metrics.golden.json` pins, among others:

- `rulesetHash: "ed073a8a…"` -> would become `984dc08d…`
- `arbiterBalancedAccuracy: 0.75` -> `0.5`
- `arbiterBalancedAccuracyCi: null` -> a real interval (v2.0 conflict subset is not single-class)
- every `baselines.*.balancedAccuracy` and `balancedAccuracyCi`
- `balancedAccuracyOnCommitted: 0.75`
- `strictCoverage`, `meanWidthOnCorrect`, `meanWidthOnIncorrect`, `widthDiscriminates`
  (all functions of which committed rows are "correct", which the target defines)
- `nStructurallyForced: 254` **would NOT move** - it is a function of evidence, discounts and
  the gap threshold, none of which v2.0 touches.
- `nScored: 267`, `nConflictSubset: 61`, `splitSeed`, `perturbationSeed`, `meanHeldFraction`,
  `worstHeldFraction`, `declineRate`, `streamCoverage`, `plannerMeanUnchangedFraction`
  **would NOT move** - none of them reads `y`.

The mechanism: `apps/harness/test/golden.test.ts:196-205` compares `extractGolden(metrics.json)`
to the committed golden file with `expect(current).toEqual(golden)`. Overwriting `metrics.json`
without running `npm run golden:update` fails that test, and CI runs it at
`.github/workflows/ci.yml:23`.

**A schema landmine.** `ScoredPipelineSchema` (`packages/engine/src/schema.ts:93-128`) enforces
three cross-field invariants: confusion sums to `nCommitted` (`:108`), `singleClass` agrees with
the confusion counts (`:114`), and `balancedAccuracyCi === null` **exactly when**
`singleClass === true` (`:121`). Under v2.0 the ARBITER conflict-subset row becomes
`tp1/fp3/tn0/fn0`, i.e. `tn + fp = 3 != 0` and `tp + fn = 1 != 0`, so `singleClass` flips to
`false` and `balancedAccuracyCi` **must** become non-null. Any hand-edit of `metrics.json` that
changes the accuracy without changing these three fields together is rejected at
`run-metrics.ts:99`, at `golden.ts:68`, and at `apps/web/src/data/load.ts:97` - the app would
throw `DataLoadError` on boot rather than render.

`MetricsDocumentSchema` (`schema.ts:249-284`) adds three document-level invariants:
`sampleSizes.conflictSubset === metric1.n` (`:260`), `nDeclined + nCommitted === scored`
(`:266`), `nStructurallyForced <= nDeclined` (`:275`).

**Other downstream breakage:**

| consumer | line | what breaks |
|---|---|---|
| `apps/web/src/data/bundle.ts:18` | build-time import | picks up whatever the file says; no version awareness |
| `apps/web/src/tabs/About.tsx:95` | renders `m.provenance.rulesetHash.slice(0,8)` | shows `984dc08d…` |
| `apps/web/src/tabs/About.tsx:309` | renders `Ruleset v{m.provenance.rulesetVersion}` | **automatically becomes "v2.0"** - this is the one place version labelling already flows through |
| `apps/web/src/tabs/Validation.tsx:52-54` | provenance line | shows the v2.0 hash |
| `apps/web/src/tabs/Validation.tsx:58` | prose that quotes the retired `0.75` string verbatim | stale copy |
| `apps/landing/src/sections/Metrics.tsx:27` | `to: 0.75` **hard-coded** | stale |
| `apps/landing/src/sections/Metrics.tsx:20,24,37,44` | `97.4`, "260 of 267 declined; 254", `to: 7`, `0.992` hard-coded | 97.4 / 260 / 254 / 0.992 / 7 all survive a v2.0 re-grade unchanged |
| `apps/landing/src/sections/Result.tsx:19-22` | the whole comparison table hard-coded as strings `"0.750" / "6.6%" / "4"` etc. | stale |
| `apps/landing/test/landing.test.tsx:168-188` | reads `metrics.json` off disk and asserts `declineRate`, `nCommitted/scored`, `plannerMeanUnchangedFraction` and `metric1.arbiter.balancedAccuracy` all render | **fails**: it would look for `"0.500"` on the page and find only the hard-coded `"0.750"` |
| `apps/web/test/validation.test.tsx:60-70` | asserts `acc.arbiter.singleClass === true` and `balancedAccuracyCi === null`, and that the headline text says "substituted 0.5" and does not match `/95% CI 0\.51/` | **fails** under v2.0, where singleClass is false |
| `tools/rescore_v2.py:194-212` | the drift guard reads `results/metrics.json` and compares against the **v1.0** re-grade | **fails and exits 1** if `metrics.json` is replaced with v2.0 numbers |

That last one is the sharpest trap: the artifact that proves v1.0 was wrong is anchored to
v1.0's own numbers still being on disk.

### Interpretation B: RE-RUN the whole pipeline under v2.0

This is the expensive reading, and it is **not** what HANDOVER 13.2 or the playbook asks for.
It cascades because `y` is an ingest-time quantity and the split is stratified on `y`:

1. `data/prep/dilirank_common.py:26` points `RULESET` at v1.0 -> would have to change.
2. `data/prep/ingest_dilirank.py:59` recomputes `y` -> `data/out/compounds.json` changes
   (536 positives becomes ~206).
3. `data/prep/make_splits.py:41-54` buckets by `y` -> `data/out/splits.json` **membership
   changes**. The test split would no longer be the same 267 compounds.
4. `data/prep/qsar_stream.py:114-127` fits on the new train split -> every QSAR claim changes
   -> `data/out/evidence.json` changes -> `results/results.json` changes -> every verdict,
   every conflict-subset membership, `nStructurallyForced`, the golden file, and
   `results/verdict-manifest.json` (which CI diffs at `.github/workflows/ci.yml:24`) all move.
5. The comparison to v1.0 becomes confounded: rule change none, but target, split and model all
   moved together. `rules/ruleset-v2.0.json`'s own `scopeNote` and `rescore_v2.py:19-25` both
   say this is why it was not done.

Also note `data/raw/dilirank.xlsx` is required for step 2 and `data/raw/` is not in the file
listing under `data/` I enumerated (`data/` contains `assays.json`, `cases`, `out`, `prep`,
`probe-case-coverage.json`, `probe-case.json`, `raw`, `test-groups.json`); `data/raw` exists as a
directory but its contents were not inspected. `data/prep/dilirank_common.py:73-74` raises
`SystemExit` if `data/raw/dilirank.xlsx` is missing, and the pipeline also needs live PubChem
access unless every name is in `data/out/smiles-cache.json`.

### 6.1 The cheapest correct move, stated as facts rather than a recommendation

Everything needed for a **version-label-only** fix already exists and no hash guard trips:

- `metrics.json.provenance.rulesetVersion` already renders as "Ruleset v{...}" at
  `apps/web/src/tabs/About.tsx:309`.
- `MetricsProvenanceSchema` (`schema.ts:130-137`) types `rulesetVersion` as `z.string().min(1)`
  and `note` as `z.string().min(1)` - both accept any content, so a longer, correcting `note`
  is schema-legal.
- `MetricsProvenance` has **no** field for "superseded", "invalidatedBy", "target" or similar.
  Searched: `supersed`, `invalid`, `retired`, `deprecat` across `packages/engine/src/types.ts`
  and `schema.ts` - zero hits in the metrics section. Adding one is a change to
  `types.ts`, `schema.ts` (both halves, or the `MutuallyAssignable` drift guard at
  `schema.ts:303-319` fails), and every writer.
- `extractGolden` (`golden.ts:88-120`) does **not** project `rulesetVersion` or the provenance
  `note`, so changing either does not move the golden file.

---

## 7. The engine's public API (`packages/engine/src/index.ts`)

Package: `@arbiter/engine`, `packages/engine/package.json` -> `"main": "./src/index.ts"`,
`"exports": { ".": "./src/index.ts" }`, single dependency `zod ^3.25.76`. **No build step**;
consumers import raw TypeScript.

### 7.1 Re-exports (`index.ts:10-21`)

```ts
export * from "./types.js";
export { EvidenceClaimSchema, EvidenceFileSchema, MetricsDocumentSchema, RulesetSchema } from "./schema.js";
export { VACUOUS, claimToMass, combine, fuse } from "./fuse.js";
export type { Mass } from "./fuse.js";
export { concordanceBoost, conflictsWith, defeats, downweightFactor, relevanceDiscount } from "./rules.js";
export type { Discount } from "./rules.js";
export { argue } from "./argue.js";
export { detectConflict } from "./conflict.js";
export { shouldAbstain } from "./abstain.js";
export { findCounterfactual } from "./counterfactual.js";
export { pivotalRules, planNextExperiment, resolvesRule } from "./plan.js";
export type { AssayOperator } from "./plan.js";
```

Note `precedenceRank` (`rules.ts:114`) is exported from `rules.ts` but **not** re-exported by
`index.ts`; the other `schema.ts` exports (`ProvenanceSchema`, `RuleSchema`, `IntervalSchema`,
`ScoredPipelineSchema`, `MetricsProvenanceSchema`, `StreamCoverageSchema`,
`MetricsSampleSizesSchema`, `ConflictSubsetAccuracySchema`, `LlmConsistency*Schema`,
`ArbiterRobustnessSchema`, `CalibrationSchema`, `AbstentionQualitySchema`,
`PlannerSensitivitySchema`, `SCHEMAS_MATCH_TYPES`) are also not re-exported by `index.ts`.

### 7.2 Exact signatures

```ts
// packages/engine/src/index.ts:44
export function reason(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  rulesetHash = "",
  assays: AssayOperator[] = [],
): Reasoning

// packages/engine/src/index.ts:63
export function reasonVerdictOnly(claims: EvidenceClaim[], ruleset: Ruleset): Reasoning

// packages/engine/src/fuse.ts:19
export function claimToMass(assertion: Assertion, strength: number): Mass
// packages/engine/src/fuse.ts:33
export function combine(a: Mass, b: Mass): { mass: Mass; conflict: number }
// packages/engine/src/fuse.ts:60
export function fuse(masses: Mass[]): { belief: number; plausibility: number; conflictMass: number; mass: Mass }
// packages/engine/src/fuse.ts:17
export const VACUOUS: Mass = { toxic: 0, safe: 0, uncommitted: 1 };

// packages/engine/src/conflict.ts:18
export function detectConflict(claims: EvidenceClaim[]): { conflicting: boolean; opposedStreams: string[] }

// packages/engine/src/argue.ts:31
export function argue(claims: EvidenceClaim[], ruleset: Ruleset): Argumentation
//   Argumentation (argue.ts:11-15) = { statuses: Map<string, ClaimStatus>; attacks: Attack[]; trace: TraceStep[] }
//   Attack (argue.ts:4-9)          = { attackerId: string; targetId: string; byRule: RuleId; rationale: string }

// packages/engine/src/abstain.ts:13
export function shouldAbstain(input: {
  belief: number;
  plausibility: number;
  conflictMass: number;
  statuses: Map<string, ClaimStatus>;
  claims: EvidenceClaim[];
  ruleset: Ruleset;
}): { abstain: boolean; reason: string | null }

// packages/engine/src/counterfactual.ts:36
export function findCounterfactual(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  currentVerdict: Verdict,
  reasonFn: (claims: EvidenceClaim[], ruleset: Ruleset) => Reasoning,
): Counterfactual | null

// packages/engine/src/plan.ts:55
export function pivotalRules(claims: EvidenceClaim[], ruleset: Ruleset, reasonFn: ReasonFn): RuleId[]
// packages/engine/src/plan.ts:78
export function resolvesRule(id: RuleId, assay: AssayOperator): boolean
// packages/engine/src/plan.ts:131
export function planNextExperiment(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  assays: AssayOperator[],
  reasonFn: ReasonFn,
): NextExperiment | null
//   ReasonFn (plan.ts:29) = (claims: EvidenceClaim[], ruleset: Ruleset) => Reasoning

// packages/engine/src/rules.ts:31
export function conflictsWith(a: EvidenceClaim, b: EvidenceClaim): boolean
// packages/engine/src/rules.ts:114   (NOT re-exported by index.ts)
export function precedenceRank(id: RuleId, ruleset: Ruleset): number
// packages/engine/src/rules.ts:137
export function defeats(
  attacker: EvidenceClaim,
  target: EvidenceClaim,
  ruleset: Ruleset,
): { byRule: RuleId; rationale: string } | null
// packages/engine/src/rules.ts:175
export function downweightFactor(
  claim: EvidenceClaim,
  ruleset: Ruleset,
): { factor: number; byRule: RuleId; rationale: string } | null
// packages/engine/src/rules.ts:216
export function relevanceDiscount(claim: EvidenceClaim, ruleset: Ruleset): Discount
//   Discount (rules.ts:189-194) = { factor: number; reasons: { byRule: RuleId; rationale: string }[] }
// packages/engine/src/rules.ts:306
export function concordanceBoost(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
): { supports: Assertion | null; boost: number }
//   DIAGNOSTIC ONLY - index.ts:136-151 documents why no boost is applied to the verdict.
```

### 7.3 What `reason()` actually does (`index.ts:73-203`)

1. `argue(claims, ruleset)` -> `{ statuses, trace }` (`:80`).
2. Per claim (`:86-123`): `defeated` -> skipped from fusion but kept in the trace (`:90`);
   `undecided` -> pushes `{ ...VACUOUS }` (`:95`); `ambiguous` -> `claimToMass` returns VACUOUS
   (`:103`); otherwise `soften(claimToMass(...), relevanceDiscount(...).factor)` (`:113-114`),
   with a discount note appended to the existing trace step (`:117-121`).
3. `soften` (`:30-34`): moves discounted mass to `uncommitted`, never to the opposing side.
4. `fuse(masses)` (`:133`).
5. `belief = mass.toxic` (`:154`), `plausibility = mass.toxic + mass.uncommitted` (`:155`).
6. `shouldAbstain({...})` (`:157`).
7. Verdict (`:159-170`): abstain if `abst.abstain`; else `toxic > safe` -> `do_not_advance`;
   `safe > toxic` -> `advance`; exact tie -> abstain with its own reason string.
8. `contested = detectConflict(undefeated).conflicting || fused.conflictMass > 0` (`:184-185`),
   where `undefeated` excludes only `defeated` claims (so `undecided` counts as surviving).
   Explicitly **not** the pre-registered conflict-subset definition (`:180-183`).
9. A synthetic trace step `{ claimId: "__verdict__", status: "undecided", kind: "verdict", rationale }`
   is appended when there is a verdict reason (`:187-189`).
10. `counterfactual` only when `withExtras` (`:199`); `nextExperiment` only when `withExtras &&
    assays.length > 0` (`:200`).

### 7.4 Purity enforcement

`.eslintrc.json:45-72`, override on `packages/engine/src/**/*.ts`:

- `no-restricted-globals`: `Date`, `performance`, `process`, `crypto`, `globalThis`
- `no-restricted-properties`: `Math.random`
- `no-restricted-imports` patterns: `../*`, `node:*`, `fs`, `path`, `crypto`
- `no-restricted-syntax`: `ImportExpression` (dynamic `import()`)

`Math` itself is allowed - `fuse.ts:20`, `rules.ts:228`, `metrics.ts:311` all use `Math.min`/
`Math.max`/`Math.sqrt`. Only `Math.random` is banned.

Determinism test: `packages/engine/test/determinism.test.ts:18-25` - 1000 calls to
`reason(CLAIMS, RS, "h")`, SHA-256 of the JSON each time, `expect(hashes.size).toBe(1)`.
A second case at `:27-40` freezes the inputs and asserts no mutation.

---

## 8. `conflictMass`: how `fuse.ts` computes it

`packages/engine/src/fuse.ts`.

```ts
// fuse.ts:33-47
export function combine(a: Mass, b: Mass): { mass: Mass; conflict: number } {
  const toxic = a.toxic * b.toxic + a.toxic * b.uncommitted + a.uncommitted * b.toxic;
  const safe  = a.safe  * b.safe  + a.safe  * b.uncommitted + a.uncommitted * b.safe;
  const uncommitted = a.uncommitted * b.uncommitted;
  const conflict = a.toxic * b.safe + a.safe * b.toxic;          // K at this step

  const norm = 1 - conflict;
  if (norm <= Number.EPSILON) {
    return { mass: { ...VACUOUS }, conflict: 1 };                 // total conflict
  }
  return { mass: { toxic: toxic / norm, safe: safe / norm, uncommitted: uncommitted / norm }, conflict };
}

// fuse.ts:60-69
export function fuse(masses: Mass[]) {
  let acc: Mass = { ...VACUOUS };
  let survival = 1;                                               // prod(1 - K_i)
  for (const m of masses) {
    const { mass, conflict } = combine(acc, m);
    acc = mass;
    survival *= 1 - conflict;
  }
  return { belief: acc.toxic, plausibility: acc.toxic + acc.uncommitted, conflictMass: 1 - survival, mass: acc };
}
```

So `conflictMass = 1 - prod_i (1 - K_i)` - the cumulative conflict removed across all
combination steps, documented at `fuse.ts:49-59` as "strictly >= max(K_i) and equals max only
when at most one step has nonzero conflict". `combine` folds left starting from `VACUOUS`, so
the order of `masses` affects intermediate `K_i` values in principle; Dempster's rule is
commutative and associative on the fused mass, and the fold produces one `K` per step.

`conflictMass` reaches the caller at `index.ts:197` (`conflictMass: fused.conflictMass`) and is
also passed into `shouldAbstain` at `index.ts:157`. `abstain.ts:23-25` abstains outright when
`conflictMass >= 1 - 1e-9` with the reason "Total conflict between sources; no conclusion
survives combination."

### 8.1 The corpus values (measured from `results/results.json` during this inventory)

`conflictMass > 0` on exactly **4 of 267** rows, all at the same value `0.1215`:

| compound | compoundId | conflictMass | verdict | contested | in conflict subset |
|---|---|---|---|---|---|
| Cyclosporine | `PMATZTZNYRCHOR-CGLBZJNRSA-N` | 0.1215 | do_not_advance | true | true |
| Mifepristone | `VKHAHZOOUSRJNA-GCNJZUOMSA-N` | 0.1215 | do_not_advance | true | true |
| Irbesartan | `YOSHYTLCDANDAN-UHFFFAOYSA-N` | 0.1215 | do_not_advance | true | true |
| Glyburide | `ZNNLBTZKUZBEKO-UHFFFAOYSA-N` | 0.1215 | do_not_advance | true | true |

`contested === true` on exactly those same 4 rows and no others. So across the scored corpus
`contested` and `conflictMass > 0` coincide perfectly - `contested` carries no information the
number does not, and the number carries magnitude the boolean throws away.

**This refines the audit's statement that Cyclosporine is the only case with a non-zero value.**
Cyclosporine is the only *hero case* with one; three more appear in the 267-row library.
The TAK-994 fixture (`data/out/tak994.json`) recomputes to
`verdict abstain, contested false, belief 0.09, plausibility 1, conflictMass 0` (verified by
running `reason()` over the committed fixture during this inventory).

### 8.2 Only Dempster's rule exists

Searched, unfiltered, across the repo excluding `node_modules`/`.git`/`dist`:
`yager|pcr5|pcr6|dubois|prade|murphy|smets|proportional conflict`. Every hit is inside
`docs/superpowers/plans/2026-08-13-arbiter-research-convergence.md` (a plan document, not code).
No `.ts` file contains any of these names. `fuse.ts` is 69 lines and contains exactly one
combination rule.

---

## 9. The `Reasoning` type (`packages/engine/src/types.ts:164-192`)

```ts
export interface Reasoning {
  verdict: Verdict;                    // "advance" | "do_not_advance" | "abstain"   (types.ts:15)
  contested: boolean;                  // types.ts:172. Opposed assertions both survive OR conflictMass > 0.
                                       //   `undecided` counts as surviving. NOT the pre-registered subset.
  belief: number;                      // = mass.toxic
  plausibility: number;                // = mass.toxic + mass.uncommitted
  mass: { toxic: number; safe: number; uncommitted: number };  // types.ts:185, INLINE on purpose:
                                       //   types.ts must not import from fuse.ts (leaf-module rule, :181-184)
  conflictMass: number;                // types.ts:187 "Dempster conflict mass. Surfaced, never normalised away."
  trace: TraceStep[];                  // types.ts:188
  counterfactual: Counterfactual | null;
  nextExperiment: NextExperiment | null;
  rulesetHash: string;                 // whatever the caller passed to reason(); "" from reasonVerdictOnly
}
```

Supporting shapes:

```ts
// types.ts:115
export type ClaimStatus = "admitted" | "defeated" | "downweighted" | "undecided";

// types.ts:117-132
export interface TraceStep {
  claimId: string;
  status: ClaimStatus;
  byRule?: RuleId;          // the rule that produced this status
  defeatedBy?: string;      // the claim that defeated this one
  kind?: "verdict";         // set ONLY on the synthetic verdict step; filter on this, not on claimId
  rationale: string;        // human-readable, rendered directly in the UI
}

// types.ts:134-152
export interface Counterfactual {
  flips: { claimId: string; to: Assertion }[];   // sorted by claimId; every entry a genuine change
  newVerdict: Verdict;
}

// types.ts:154-162
export interface NextExperiment {
  assay: string;
  resolvesRule: RuleId | null;
  expectedGapReduction: number;
  cost: number;
  score: number;
  rationale: string;
}

// types.ts:38-59
export interface EvidenceClaim {
  id: string; compoundId: string;
  stream: Stream;                       // qsar|cytotox|toxicogenomics|transporter|invivo_rodent|invivo_nonrodent
  assertion: Assertion;                 // toxic|safe|ambiguous
  strength: number;                     // 0..1
  system: BiologicalSystem;             // human|rodent|nonrodent|in_silico          -> R1
  measuresKeyEvent: string | null;      // null = structural correlation only        -> R2
  exposureRelevant: boolean | null;     // null = margin never established           -> R3
  inApplicabilityDomain: boolean | null;// null = not assessable                     -> R4
  klimisch: 1 | 2 | 3 | 4 | null;                                                 // -> R5
  availableFrom: string;                // ENGINE NEVER READS THIS - callers filter
  provenance: Provenance;               // { kind: "database"|"literature"; source; retrieved; url? }
}
```

`Ruleset` is `types.ts:96-113`: `{ version, registeredAt, abstentionGapThreshold,
dilirankBinarisation: { positive[], negative[], excluded[] }, rules: Rule[],
precedenceOrder: DefeatRuleId[], precedenceRationale }`. `Rule` is `types.ts:81-94`.

`types.ts` also carries the whole of the metrics document contract (`:194-427`) - see section 3.
The comment at `:206-209` explains why: the web app cannot import from the harness (the harness
reads `node:fs`), and `@arbiter/engine` is the web app's only package dependency.

`packages/engine/src/schema.ts:303-319` asserts at compile time that the zod schemas and the
hand-written interfaces are **mutually** assignable, via
`type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never`
and a value site `SCHEMAS_MATCH_TYPES: [ClaimShapeMatchesInterface, RulesetShapeMatchesInterface,
EvidenceFileShapeMatchesInterface, MetricsShapeMatchesInterface] = [true, true, true, true]`.
Adding a field to `types.ts` without adding it to `schema.ts` (or vice versa) fails
`npm run typecheck` with the offending property named.

---

## 10. The golden system (`apps/harness/src/golden.ts`)

### 10.1 `GoldenNumbers` - exactly what is projected

`golden.ts:12-48`. Every field, in declaration order:

| field | source in `metrics.json` | golden.ts line |
|---|---|---|
| `rulesetHash: string` | `provenance.rulesetHash` | `:89` |
| `splitSeed: number` | `provenance.splitSeed` | `:90` |
| `perturbationSeed: number` | `provenance.perturbationSeed` | `:91` |
| `nScored: number` | `sampleSizes.scored` | `:92` |
| `nConflictSubset: number` | `sampleSizes.conflictSubset` | `:93` |
| `arbiterBalancedAccuracy: number` | `metric1.arbiter.balancedAccuracy` | `:94` |
| `arbiterCoverage: number` | `metric1.arbiter.coverage` | `:95` |
| `arbiterNCommitted: number` | `metric1.arbiter.nCommitted` | `:96` |
| `arbiterBalancedAccuracyCi: Interval \| null` | `metric1.arbiter.balancedAccuracyCi` | `:97-99` |
| `arbiterRawAccuracyCi: Interval` | `metric1.arbiter.rawAccuracyCi` | `:100` |
| `baselines: Record<string, GoldenPipeline>` | `metric1.baselines`, re-sorted by code unit at `:75` | `:101` |
| `meanHeldFraction: number` | `metric2b.meanHeldFraction` | `:102` |
| `worstHeldFraction: number` | `metric2b.worstHeldFraction` | `:103` |
| `strictCoverage: number` | `metric3.strictCoverage` | `:104` |
| `meanWidth: number` | `metric3.meanWidth` | `:105` |
| `meanWidthOnCorrect: number` | `metric3.meanWidthOnCorrect` | `:106` |
| `meanWidthOnIncorrect: number` | `metric3.meanWidthOnIncorrect` | `:107` |
| `widthDiscriminates: boolean` | `metric3.widthDiscriminates` | `:108` |
| `declineRate: number` | `metric4.declineRate` | `:109` |
| `balancedAccuracyOnCommitted: number` | `metric4.balancedAccuracyOnCommitted` | `:110` |
| `nStructurallyForced: number` | `metric4.nStructurallyForced` | `:111` |
| `streamCoverage: Record<string, {claims, compounds}>` | `sampleSizes.streamCoverage`, keys re-sorted at `:115-118` | `:115` |
| `plannerMeanUnchangedFraction: number` | `metric5.meanUnchangedFraction` | `:119` |

`GoldenPipeline` (`golden.ts:3-10`) = `{ balancedAccuracy, coverage, nCommitted,
balancedAccuracyCi: Interval | null, rawAccuracyCi: Interval }` - note it drops `confusion` and
`singleClass`, which the full document carries.

**Deliberately NOT projected:** `provenance.rulesetVersion`, `provenance.scoredSplit`,
`provenance.note`, all prose fields (`determinismNote`, `heldFractionCaveat`, `perturbation`,
`structurallyForcedNote`), `metric2a_llmConsistency` in its entirety,
`metric2b.meanHeldFractionOnCommitted`, `metric2b.nCommittedCompounds`,
`metric2b.samplesPerCompound`, `metric2b.seed`, `metric3.widthDiscriminatesIsMeaningful`,
`metric3.nCorrect`, `metric3.nIncorrect`, `metric1.n`, `metric1.positiveRate`,
`metric1.arbiter.confusion`, `metric1.arbiter.singleClass`, `metric4.ciOnCommitted`,
`metric4.singleClassOnCommitted`, `metric4.nDeclined`, `metric4.nCommitted`,
`metric5.nCompoundsWithRecommendation`, `metric5.samplesPerCompound`, `metric5.seed`.

The rationale is at `golden.ts:50-61`: golden-filing the whole document would churn on wording
changes, and "a golden file that cries wolf gets ignored".

`extractGolden` **parses**, it does not cast: `golden.ts:68` `const m = MetricsDocumentSchema.parse(raw);`
with the reason spelled out at `:63-67` - a renamed field read through `Record<string, any>`
arrives as `undefined`, is written into the golden file, and compares equal to itself forever.

### 10.2 The guard

`apps/harness/test/golden.test.ts`:

- `:29-114` a **complete, typed** `MetricsDocument` fixture (the comment at `:9-28` explains it
  was previously a mini-fixture that could not occur).
- `:123-148` four cases about what `extractGolden` keeps and drops.
- `:150-193` five cases proving the parse rejects drift: a renamed field (`:151`), a number
  arriving as a string (`:164`), a reversed interval (`:171`), a CI attached to a single-class
  accuracy (`:178`), a `singleClass` flag contradicting the counts (`:187`).
- `:195-206` **the live guard**: `expect(existsSync(CURRENT)).toBe(true)`, skip if the golden
  file is absent, else `expect(extractGolden(JSON.parse(readFileSync(CURRENT))))` `.toEqual(golden)`.

`apps/harness/src/update-golden.ts:10-13` is the only writer:

```ts
const golden = extractGolden(JSON.parse(readFileSync("results/metrics.json", "utf8")));
mkdirSync("results/golden", { recursive: true });
writeFileSync("results/golden/metrics.golden.json", JSON.stringify(golden, null, 2));
console.log("Updated results/golden/metrics.golden.json - commit the diff with a reason.");
```

Its header (`:4-9`) says: "Only run this when a number moved ON PURPOSE. The resulting diff is
the record of what changed and belongs in its own commit with a reason."

---

## 11. Baselines (`apps/harness/src/baselines.ts`)

74 lines. `Prediction` (`:3-7`) = `{ verdict: Verdict; score: number }`, where score is a
toxicity leaning in [0,1] and 0.5 means undecided. `const ABSTAIN: Prediction = { verdict: "abstain", score: 0.5 }` (`:9`).

| function | line | behaviour |
|---|---|---|
| `majorityVote(claims): Prediction` | `:19` | counts `toxic` vs `safe` assertions. Abstains on empty, on all-ambiguous, and on an exact tie. `score = toxic / (toxic + safe)`. Deliberately has nowhere to put "I do not know" - an ambiguous claim simply is not a toxic vote, so silence leans safe (`:11-18`). |
| `weightedAverage(claims): Prediction` | `:39` | abstains if no claim is non-ambiguous (`:45-46`). Denominator sums `max(strength, 0.0001)` over **all** claims including ambiguous ones (`:48`); numerator sums only `toxic` ones (`:49`). Abstains if `|score - 0.5| < 1e-12`. So an ambiguous claim is a zero-strength safe vote (`:36-37`). |
| `bestSingleSource(claims, stream): Prediction` | `:63` | takes the strongest non-ambiguous claim on that stream; toxic -> `do_not_advance` with `score = strength`, safe -> `advance` with `score = 1 - strength`. Abstains where the stream is silent. |
| `ALL_STREAMS: Stream[]` | `:72-74` | `["qsar","cytotox","toxicogenomics","transporter","invivo_rodent","invivo_nonrodent"]` |

`main.ts:26-29` builds the record: `majorityVote`, `weightedAverage`, and `single:${s}` for
every `s` in `ALL_STREAMS` - eight baselines per row, all eight present in the committed
`results.json`.

Tests: `apps/harness/test/baselines.test.ts`, 14 cases.

---

## 12. CI (`.github/workflows/ci.yml`)

43 lines. One job, `verify`, on `[push, pull_request]`, `ubuntu-latest`, Node 20 with npm cache.

| step | line | gate |
|---|---|---|
| `npm ci` | `:13` | |
| `npm run lint` | `:14` | eslint over `packages apps services`, including the engine-purity override |
| `npm run typecheck` | `:15` | `tsc -b packages/engine apps/harness` then `--noEmit` on web, deliberation, landing, services/api. This is where `SCHEMAS_MATCH_TYPES` fires. |
| `npm test` | `:16` | full vitest run |
| `npm run validate:evidence` | `:20` | `loadInputs()` (both hash guards) + fixture-leak check (`validate-evidence.ts:15-21`) |
| `npm run harness` | `:21` | **rewrites** `results/results.json` and `results/verdict-manifest.json` in the runner |
| `npm run metrics` | `:22` | **rewrites** `results/metrics.json` in the runner |
| `npm test -- apps/harness/test/golden.test.ts` | `:23` | the golden comparison, now against the freshly-written `metrics.json` |
| `git diff --exit-code results/verdict-manifest.json` | `:24` | byte-for-byte reproduction of the manifest |
| `npm run web:build` | `:25` | |
| playwright cache + install | `:30-41` | |
| `npm run e2e` | `:42` | 3 Playwright specs, `apps/web` only |

**Two gaps worth naming:**

1. There is **no** `git diff --exit-code results/metrics.json` and **no**
   `git diff --exit-code results/results.json`. Only the verdict manifest is byte-diffed. A
   change to a prose field in `metrics.json`, or to any of the ~25 numeric fields
   `extractGolden` does not project, passes CI silently.
2. The comment at `:17-19` claims "if these drift, a reported figure moved and the diff has to
   be explained", but the enforcement is the golden test plus the manifest diff, not a diff of
   the metrics file itself.

CI never runs `npm run probe`, `npm run probe:report`, `npm run coverage:report`,
`npm run golden:update`, or any Python.

---

## 13. The probe pipeline (Gate 0)

### 13.1 Collection: `services/api/probe.ts` (155 lines)

| symbol | line | detail |
|---|---|---|
| `ProbeRun` | `:25-31` | `{ index, ok, adjudication: unknown, verificationFailures: {kind, detail}[], error? }` |
| `ProbeOutput` | `:33-43` | `{ probeVersion: 1, source: "live"\|"stub", model: string\|null, promptVersion, promptHash, compoundLabel, requestedRuns, runs }` |
| `promptHash(prompt)` | `:45-49` | `sha256(JSON.stringify({ system, userTemplate }))`. Computed independently during this inventory over `prompts/adjudicator-v1.0.json`: **`42f548ea1df383145d2ba51a078d3a04d7e83ea61085f41c721ba328ffc29436`** |
| `stubComplete(req)` | `:60-81` | returns a schema-valid adjudication, `verdict: "cannot_conclude"`, every rule `does_not_apply`, reasoning literally "STUB - no model was called." **Deliberately perfectly stable** (`:51-59`), so a stub probe reports flip rate exactly 0. |
| `runProbe(req, prompt, runs, complete)` | `:83-122` | loops `runs` times; each result goes through `verifyAdjudication` (`:99`); **a verification failure is recorded, never retried** (`:100-102`); exceptions become `{ ok: false, error }`. |
| `main()` | `:124-149` | env: `PROBE_RUNS` default `"20"` (`:125`), `PROBE_CASE` default `data/probe-case.json` (`:126`), `PROBE_OUT` default `results/probe-runs.json` (`:127`). Reads `prompts/adjudicator-v1.0.json` (`:129`). `completeFromEnv()` (`:131`). Writes the output (`:140`). |
| direct-exec guard | `:152-154` | only runs `main()` when `process.argv[1]` ends in `probe.js`/`probe.ts` |

`completeFromEnv` lives at `services/api/interpret.ts:182-...`: returns `null` when
`ANTHROPIC_API_KEY` is unset or empty (`:183-184`); otherwise builds an `Anthropic` client with
model `env["ARBITER_MODEL"] ?? "claude-opus-5"` (`:190`), `max_tokens: 1024` (`:198`),
`thinking: { type: "disabled" }` (`:207`). `Complete` is
`(system: string, user: string, schema: Record<string, unknown>) => Promise<unknown>`
(`interpret.ts:30-34`).

`prompts/adjudicator-v1.0.json`: keys `version, registeredAt, purpose, registrationNote, system,
userTemplate, decoding`; `version "1.0"`; 34 system lines; 13 userTemplate lines.

`data/probe-case.json`: keys `_note, _generatedBy, compoundLabel, context, rules, findings,
absent`; `compoundLabel "TAK-994 (Narcolepsy type 1)"`; 6 findings, 6 rules, 2 absences.
Generated by `tools/build_probe_case.py`, which reads `data/out/tak994.json` and
`rules/ruleset-v2.0.json` (`build_probe_case.py:25-26`).

### 13.2 Analysis: `apps/harness/src/consistency-report.ts` (68 lines) and `consistency.ts` (142 lines)

`consistency-report.ts`:

| line | detail |
|---|---|
| `:14-21` | local `ProbeFile` interface: `{ source, model, promptVersion, promptHash, compoundLabel, runs: {ok, adjudication, error?}[] }` |
| `:24` | `const path = process.env["PROBE_OUT"] ?? "results/probe-runs.json";` |
| `:26` | reads `rules/pass-marks-v1.0.json` |
| `:27` | `const maxFlip = passMarks.consistency.maxFlipRate as number;` |
| `:28` | `const minRule = passMarks.ruleStability.minAgreement as number;` |
| `:34` | only `r.ok` runs enter the report - unverified runs are counted separately (`:41-46`), because "making things up and changing its mind are different failures" |
| `:50-57` | rule-stability FAIL block when the worst rule is below `minRule` |
| `:59-64` | when `file.source === "stub"`: "THIS IS A STUB RUN AND IS NOT A RESULT." |

`consistency.ts`:

```ts
// :23-27
export interface AdjudicationSubset {
  mechanism: { present: boolean };
  consequence: { verdict: string; citedFindingIds: string[] };
  ruleDisclosure: { ruleId: string; position: string }[];
}
// :29-34
export interface RuleStability { ruleId: string; agreement: number; positions: Record<string, number> }
// :36-58
export interface ConsistencyReport {
  runs: number; verdictAgreement: number; flipRate: number; modalVerdict: string | null;
  verdicts: Record<string, number>; mechanismAgreement: number;
  ruleStability: RuleStability[]; citationAgreement: number;
}
// :73
export function consistencyReport(runs: AdjudicationSubset[]): ConsistencyReport
// :116
export function formatConsistencyReport(r: ConsistencyReport, passMark: number): string[]
```

`flipRate = 1 - modalVerdictCount / n` (`:107`). `n === 0` returns
`{ runs 0, verdictAgreement 0, flipRate 1, ... }` (`:75-80`). Citation sets are compared as
sorted joins so ordering is not counted as a flip (`:88-91`). A run that omits a rule entirely
counts as position `"(absent)"` rather than being skipped (`:96-99`). `ruleStability` is sorted
worst-first (`:102`). Ties in `modal()` break on the lexically first key (`:66-71`).
The shape is **structural, not imported**: `consistency.ts:15-21` explains that
`services/api` is not in the harness's build graph.

Tests: `apps/harness/test/consistency.test.ts`, 10 cases.

### 13.3 `rules/pass-marks-v1.0.json`

50 lines. `version "1.0"`, `registeredAt "2026-08-06"`. `registrationNote` states it was
"COMMITTED BEFORE ANY AI RESULT EXISTED. No model has been called at the time this file is
written - there is no API key configured in this repository."

| key | value | read by |
|---|---|---|
| `consistency.maxFlipRate` | `0.10` | `consistency-report.ts:27` |
| `consistency.runsPerCase` | `20` | nothing reads it; `probe.ts:125` defaults `PROBE_RUNS` to `"20"` independently |
| `ruleStability.minAgreement` | `0.80` | `consistency-report.ts:28` |
| `extraction.maxHallucinationRate` | `0.0` | **nothing reads it** |
| `extraction.minRecall` | `0.85` | **nothing reads it** |
| `groups.group1_documentedLiverSignal.maxMissed` | `0.20` | **nothing reads it** |
| `groups.group2_realMechanismFineInPractice.maxFalseAlarm` | `0.20` | **nothing reads it** |
| `groups.group3_genuinelyClean.maxFalseAlarm` | `0.10` | **nothing reads it** |
| `reportingRules` | 4 strings, incl. "No accuracy figure is quoted without its denominator and its class balance. That omission is what produced the 0.750 headline." | prose |
| `iterationBudget.maxPromptRevisions` | `5` | **nothing reads it** |

Verified by grep for `pass-marks` across the repo: the only reader is
`apps/harness/src/consistency-report.ts:26`.

### 13.4 Gate 0 has never been run

- `results/probe-runs.json` **does not exist** (`ls` returns "No such file or directory").
- `.gitignore:59-65` whitelists it with an explicit note: "A LIVE run belongs in git. A STUB run
  does not... Check `"source": "live"` before adding it."
- `git ls-files results` returns exactly: `results/golden/metrics.golden.json`,
  `results/metrics.json`, `results/rescore-v2.txt`, `results/results.json`,
  `results/verdict-manifest.json`. No probe file has ever been committed.
- With no key, `probe.ts:133-136` prints "No ANTHROPIC_API_KEY. Running against the STUB - this
  exercises the path and produces NO result."

---

## 14. Absence claims, with the names searched

Every search below was run over the repository excluding `node_modules`, `.git` and `dist`.

| claim | names searched | result |
|---|---|---|
| Only Dempster's rule of combination exists | `yager`, `pcr5`, `pcr6`, `dubois`, `prade`, `murphy`, `smets`, `proportional conflict` | zero hits in any `.ts`/`.tsx`/`.py`/`.json`; all hits are in one plan markdown |
| No inter-rater agreement statistic | `kappa`, `cohen`, `krippendorff`, `fleiss`, `icc`, `inter.?rater`, `inter.?annotator` | zero hits in code; all hits in one plan markdown |
| No script regenerates metrics under v2.0 | `rescore`, `metrics-v2`, `metricsV2`, `run-metrics-v2`, `metrics.v2`, `regrade`, `re-grade` | only `tools/rescore_v2.py`, `.gitignore:60-63`, README/HANDOVER prose, and a comment at `services/api/canonical.ts:14` |
| `PRE_REGISTERED_HASH_V2` has no consumer | `PRE_REGISTERED_HASH_V2` | one hit: its own declaration at `preregistration.ts:75` |
| No TypeScript reads ruleset v2.0 | `ruleset-v2.0`, `ruleset-v2`, `rulesetV2` | only three Python files, plus prose |
| No `npm run ablation` | inspected the full `scripts` block of `package.json`; grepped `ablation` in `package.json` | zero matches in `package.json` |
| No `golden:check` script | inspected the full `scripts` block | absent; CI uses `npm test -- apps/harness/test/golden.test.ts` |
| `results/ablation.json` absent | `ls`, plus `git ls-files results` | absent, never committed |
| `results/probe-runs.json` absent | `ls`, plus `git ls-files results` | absent, never committed |
| `results/documents/` | `ls -la` | exists, **empty** |
| No "superseded"/"retired" field on the metrics provenance | `supersed`, `invalid`, `retired`, `deprecat` in `types.ts` and `schema.ts` | zero hits in the metrics section; `MetricsProvenance` is exactly `{rulesetVersion, rulesetHash, splitSeed, perturbationSeed, scoredSplit, note}` |

---

## 15. Test inventory for this cluster

`vitest.config.ts` puts `apps/web`, `apps/deliberation`, `apps/landing` on jsdom and leaves
everything else on node, with the comment (`:6-8`) that "jsdom would mask a purity violation by
providing browser globals the engine is forbidden to use". `apps/web/e2e/**` is excluded
(Playwright).

| file | `it(` count | what it pins |
|---|---|---|
| `packages/engine/test/rules.test.ts` | 39 | R1-R6 defeat + discount behaviour; imports `rules/ruleset-v1.0.json` directly |
| `packages/engine/test/schema.test.ts` | 26 | zod schemas incl. a `MetricsDocument`-shaped fixture at `:112+` |
| `packages/engine/test/plan.test.ts` | 19 | `pivotalRules`, `planNextExperiment` |
| `packages/engine/test/reason.test.ts` | 16 | end-to-end `reason()` |
| `packages/engine/test/argue.test.ts` | 11 | grounded semantics, reinstatement |
| `packages/engine/test/fuse.test.ts` | 11 | `claimToMass`, `combine`, `fuse` |
| `packages/engine/test/counterfactual.test.ts` | 10 | exhaustive flip search |
| `packages/engine/test/abstain.test.ts` | 9 | `shouldAbstain` |
| `packages/engine/test/conflict.test.ts` | 6 | `detectConflict` |
| `packages/engine/test/determinism.test.ts` | 2 | 1000-run single hash; no input mutation |
| `apps/harness/test/metrics.test.ts` | 22 | all metric functions, over **synthetic** rows, not `results.json` |
| `apps/harness/test/stats.test.ts` | 17 | wilson, balanced accuracy, single-class |
| `apps/harness/test/ablationAggregate.test.ts` | 15 | (two cases at `:158,:171` read the real `results/metrics.json`) |
| `apps/harness/test/baselines.test.ts` | 14 | |
| `apps/harness/test/ablationResume.test.ts` | 13 | |
| `apps/harness/test/ablationPrompt.test.ts` | 10 | |
| `apps/harness/test/consistency.test.ts` | 10 | |
| `apps/harness/test/golden.test.ts` | 10 | incl. the live golden comparison at `:196` |
| `apps/harness/test/prng.test.ts` | 8 | |
| `apps/harness/test/hash.test.ts` | 4 | pins `ed073a8a…` twice (`:47`, `:50`) |
| `apps/harness/test/exposurePolicy.test.ts` | 4 | pins the exposure hash and its negatives |
| `apps/harness/test/validateEvidence.test.ts` | 3 | |

Engine total 149 cases across 10 files; harness total 130 across 12 files.

---

## 16. Line-number index for the files a build prompt is most likely to cite

| file | key lines |
|---|---|
| `packages/engine/src/index.ts` | 10-21 re-exports · 30 `soften` · 44 `reason` · 63 `reasonVerdictOnly` · 71 `bare` · 73 `reasonCore` · 133 `fuse` · 154-155 belief/plausibility · 157 `shouldAbstain` · 159-170 verdict · 184-185 `contested` · 191-202 return · **197 `conflictMass`** |
| `packages/engine/src/fuse.ts` | 10-14 `Mass` · 17 `VACUOUS` · 19 `claimToMass` · 33-47 `combine` · 37 K · 39-45 total-conflict guard · 60-69 `fuse` · 62 `survival` · 68 return |
| `packages/engine/src/types.ts` | 15 `Verdict` · 38-59 `EvidenceClaim` · 96-113 `Ruleset` · 115 `ClaimStatus` · 117-132 `TraceStep` · 134-152 `Counterfactual` · 154-162 `NextExperiment` · **164-192 `Reasoning`** · 185 `mass` · 187 `conflictMass` · 213-427 the metrics document types |
| `packages/engine/src/schema.ts` | 11-35 `EvidenceClaimSchema` · 46-64 `RulesetSchema` · 93-128 `ScoredPipelineSchema` (three refines at 108/114/121) · 130-137 `MetricsProvenanceSchema` · 249-284 `MetricsDocumentSchema` (three refines at 260/266/275) · 303-319 the drift guards |
| `packages/engine/src/rules.ts` | 31 `conflictsWith` · 114 `precedenceRank` · 137 `defeats` · 175 `downweightFactor` · 189-194 `Discount` · 216 `relevanceDiscount` · 306 `concordanceBoost` |
| `apps/harness/src/load.ts` | 10-18 `ExposurePolicy` · 20-29 `Inputs` · 40 `loadInputs` · **41 the v1.0 path literal** · 49 hash · 50-57 guard 1 · 61-69 guard 2 · 72-77 claim parse · 92 `asOf` |
| `apps/harness/src/main.ts` | 6-12 `ResultRow` · 15 `loadInputs` · 21 test-split loop · 26-29 baselines · 37 `conflicting` · 38 `reason` · 44-52 write `results.json` · 57-64 write `verdict-manifest.json` |
| `apps/harness/src/run-metrics.ts` | 10-12 constants · 15 read `results.json` · 18 `loadInputs` · 30 the missing-ablation note · 47 `m1` · 56 the annotated document · **58-59 provenance version+hash** · 99 schema parse · 100 write · 117-129 warnings |
| `apps/harness/src/metrics.ts` | 20 `toBinary` · 23 `score` · 48 `conflictSubsetAccuracy` · 85 `calibration` · 134 `streamCoverage` · 179 `committedMassCeiling` · 191 `abstentionQuality` · 206 `bar` · 216 the throw · 258 `robustness` · 295 `plannerSensitivity` |
| `apps/harness/src/preregistration.ts` | 17 `canonicalJson` · 32-44 `projectForHash` · 53-54 v1 hash · 75-76 v2 hash · 86-96 exposure projection · 106-107 exposure hash |
| `apps/harness/src/hash.ts` | 16-18 `rulesetHash` · 26-29 re-exports |
| `apps/harness/src/golden.ts` | 3-10 `GoldenPipeline` · 12-48 `GoldenNumbers` · 62 `extractGolden` · 68 the parse · 75 baseline sort · 88-120 the projection |
| `apps/harness/src/update-golden.ts` | 10-13 |
| `apps/harness/src/baselines.ts` | 3-7 `Prediction` · 9 `ABSTAIN` · 19 `majorityVote` · 39 `weightedAverage` · 63 `bestSingleSource` · 72-74 `ALL_STREAMS` |
| `apps/harness/src/stats.ts` | 16 `wilson` · 26 `confusion` · 47 `balancedAccuracy` · 62 `singleClass` · 87 `balancedAccuracyInterval` · 96 `mean` |
| `apps/harness/src/prng.ts` | 13 `mulberry32` · 25 `uniform` · 30 `jitter01` |
| `apps/harness/src/consistency.ts` | 23-27 `AdjudicationSubset` · 36-58 `ConsistencyReport` · 73 `consistencyReport` · 107 flipRate · 116 `formatConsistencyReport` |
| `apps/harness/src/consistency-report.ts` | 24 `PROBE_OUT` · 26-28 pass marks · 34 `usable` · 50-57 rule-stability fail · 59-64 stub warning |
| `apps/harness/src/coverage-report.ts` | 25 imports `committedMassCeiling` · 34 `bar` · 42-50 the curve · 74-86 the two kinds of abstention |
| `apps/harness/src/validate-evidence.ts` | 15-18 `findLeakedFixtures` · 20-21 the throw |
| `services/api/probe.ts` | 25-43 output types · 45 `promptHash` · 60 `stubComplete` · 83 `runProbe` · 99-103 verify-not-retry · 124-149 `main` · 152-154 direct-exec guard |
| `tools/rescore_v2.py` | 1-26 docstring · 38 `wilson` · 63 `balanced_accuracy` · 87 `to_binary` · 92 `score` · 112 `relabel` · 147 `main` · 148-151 the four reads · 160 target loop · 174-192 subset loop · 194-212 drift guard |
| `tools/build_probe_case.py` | 25-26 reads fixture + v2.0 ruleset · 65-90 derived absences · 118-119 writes `data/probe-case.json` |
| `tools/build_test_groups.py` | 37-40 reads results/compounds/v2.0 · 45 `committed` · 58 the agreed/overcalled split · 134-135 writes `data/test-groups.json` |
| `.github/workflows/ci.yml` | 14-16 lint/typecheck/test · 20-24 the numeric gates · 42 e2e |
| `.eslintrc.json` | 45-72 the engine-purity override |
| `.gitignore` | 53-65 the `results/` whitelist |

---

## 17. Derived artifacts in `data/` produced by `tools/`

`data/test-groups.json` (from `tools/build_test_groups.py`), regenerated from
`results/results.json` under the v2.0 target:

- `group2_realMechanismFineInPractice` - **5 compounds**, all `vLess-DILI-concern`, all
  `do_not_advance`: Prochlorperazine maleate (belief 0.9, not in conflict subset),
  Thioridazine hydrochloride (0.9054, not in subset), Mifepristone (0.8862, in subset),
  Irbesartan (0.8862, in subset), Glyburide (0.8862, in subset).
- `group2a_engineWasRight` - **2 compounds**, both `vMost-DILI-concern`: Sorafenib tosylate
  (0.9055, not in subset), Cyclosporine (0.8862, in subset).
- `group1_documentedLiverSignal` and `group3_genuinelyClean` - both
  `"status": "SPECIFIED, NOT POPULATED"`, `"compounds": []`.

Cross-check: the three conflict-subset members of group 2 plus Cyclosporine are exactly the four
rows carrying `conflictMass 0.1215`. The seven commitments across the split are exactly
`5 + 2`, matching `metrics.json` `metric4.nCommitted: 7`, and the four in the conflict subset
match `metric1.arbiter.nCommitted: 4`.

`data/probe-case-coverage.json` - a hand-declared map from `TAK-994:<stream>` to checklist
question ids (`M5`, `M1`, `M2`, `M6`, ...), `checklistVersion "1.0"`, deliberately kept separate
from `data/probe-case.json` so that the pre-registered probe input cannot gain fields between
the pass marks being committed and the first live run.

`data/assays.json` - 5 assays consumed by the planner: `murine-cyp-induction` (cost 40,
priorToxic 0.35, resultStrength 0.85), `human-hepatocyte-spheroid`, `bsep-inhibition`,
`mito-tox-panel`, `readacross-refinement`.

`data/out/evidence.json` header: `generatedAt "2026-07-27"`, 1356 claims, 890
`benchmarkCompoundIds`, 267 `testSplitCompoundIds`, 1 `fixtureCompoundIds`,
`streamCounts { cytotox 447, qsar 891, transporter 15, invivo_nonrodent 1, invivo_rodent 1,
toxicogenomics 1 }`, `compoundsWithAtLeastTwoCommittedStreams 344`.
Note the discrepancy a build prompt must not trip over: those stream counts are over the whole
890-compound benchmark, while `metrics.json`'s `streamCoverage` (cytotox 127, qsar 267,
transporter 4) is restricted to the 267-compound **test split** by `metrics.ts:130-133`.
