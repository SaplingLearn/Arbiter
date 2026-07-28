# ARBITER — handover audit

**Written 2026-07-28. Branch `arbiter-round1` merged to `main`.**
Pfizer Digital & Technology Hackathon 2026, Round 1.
Team: Jack He, Andres Lopez, Jose Cruz-Lopez.

**Submission due 16 Aug 2026. Data freeze 2 Aug 2026 — five days out when this was written.**

This document is for whoever picks the repo up next. It says what exists, what the
result actually is, what is left, and which things you must not touch. Read §0 through
§3 before writing any code.

---

## 0. Sixty-second orientation

ARBITER takes conflicting preclinical toxicity evidence for a compound and produces a
defensible **decision** — advance, do not advance, or abstain — with the argument that
led there, the evidence that would change it, and a hash-chained audit log of who
signed off.

It is two things in one repo:

- **A pure reasoning engine** (`packages/engine`) — Dempster–Shafer belief fusion plus
  defeasible argumentation over six pre-registered rules R1–R6. No clock, no
  randomness, no I/O. Deterministic to a single hash across 1000 runs.
- **A five-tab web app** (`apps/web`) that runs that engine **in the browser** and
  ships as one self-contained `index.html`.

Plus `apps/harness` (the benchmark runner) and `data/prep` (Python ingestion).

### Run it

```bash
npm ci
npm run web:dev            # http://localhost:5173
```

Keys: `→`/`←` step the seven demo beats, `M` motion kill switch, `?` pre-flight panel,
`Esc` clear focus.

### Verify everything

```bash
npm run lint && npm run typecheck && npm test      # 269 tests, 32 files
npm run web:build && npm run e2e                   # 8 Playwright tests
npm run golden:update && git diff --exit-code results/   # must produce NO diff
```

All of the above were green at merge, and CI runs all of it on every push.

---

## 1. Three things you must not do

These are not style preferences. Each one protects a claim the submission makes.

### 1.1 Never edit `rules/ruleset-v1.0.json`

It is **pre-registered and hashed**:
`ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136`

The harness *refuses to run* if the computed hash differs. The whole methodological
claim is that no rule was tuned after seeing a result. If a rule looks wrong, **re-read
its registered statement first** — twice during development a rule looked broken and was
in fact correct. If it really is wrong, that is a deliberate **v1.1 re-registration**
with a new hash and a written reason, not an edit.

Editing `abstentionGapThreshold` to improve the headline is explicitly forbidden. It was
considered and rejected once already (§4).

### 1.2 The engine stays pure

No `Date`, `Math.random`, `node:*`, `fs`/`path`/`crypto`, dynamic `import`, or parent
imports anywhere in `packages/engine/src`. Lint enforces every one of these. A clock or
a random number in the engine breaks determinism, which is the reason the golden-file CI
can catch a moved number at all.

### 1.3 Language discipline

Non-negotiable, from master spec §1. These exact substitutions:

| write this | never this |
|---|---|
| review-ready evidence package | regulator-ready dossier |
| positions / sign-off / decision owner | voting / tally / majority |
| hash-chained audit log | blockchain |

Applies to code, comments, UI copy, commit messages, and anything a judge reads. The
first column is defensible; the second overclaims regulatory standing we do not have.

---

## 2. The result, stated honestly

**This is the most important section. Do not restate the headline as an accuracy.**

Measured on the test split only (train fitted the QSAR model, calibration set the
conformal threshold; scoring either would be leakage). 267 compounds scored, 61 in the
pre-registered conflict subset, positive rate 0.902.

| pipeline | balanced accuracy | coverage | n committed | confusion (tp/fp/tn/fn) | single-class |
|---|---|---|---|---|---|
| **ARBITER** | 0.750 | **6.6%** | **4** | 4/0/0/0 | **yes** |
| `single:transporter` | 0.750 | **6.6%** | **4** | 4/0/0/0 | yes |
| `majorityVote` | 0.750 | 4.9% | 3 | 3/0/0/0 | yes |
| `weightedAverage` | 0.547 | 100% | 61 | 51/5/1/4 | no |
| `single:qsar` | 0.500 | 98.4% | 60 | 54/6/0/0 | no |

### ARBITER does not beat the best baseline. It ties a single stream, exactly.

`single:transporter` matches it on every column. Say so. An earlier draft of the spec
omitted this and it was corrected as a flattering omission — do not let it creep back.

### Coverage is the finding

ARBITER abstains on **260 of 267 compounds (97.4%)**. Every abstention is the
belief–plausibility gap rule; **none** is applicability-domain and **none** is total
conflict. The median compound musters 0.060 of committed mass against a threshold
needing more than 0.5.

**The cause is measurable and structural: no benchmark compound carries
exposure-relevant evidence.** The only `exposureRelevant: true` claim in the corpus is
the TAK-994 murine study, which is excluded from the benchmark by design. QSAR has no
exposure axis; Tox21 qHTS concentrations are not clinical. So R3 fires on **100% of safe
claims and 0% of toxic ones**, and the engine structurally *cannot* license "advance" on
this evidence base. It returned zero advances.

This is simultaneously the engine being correct about weak evidence — an HTS "inactive"
at an unknown multiple of clinical exposure genuinely licenses nothing — and a coverage
problem. Those are the same fact, not two competing readings.

`results/metrics.json` emits a `singleClass` flag plus explicit coverage and
single-class warnings so the figure cannot be quoted as an accuracy by accident. The
Validation tab renders the warning at raised weight for the same reason.

### The number that is unambiguously good

**Planner recommendation unchanged under ±50% perturbation of every expert-elicited
prior: 0.992** (2000 samples/compound, seed 20260726, 61 compounds). That holds because
the planner sorts on argument structure first and score second. This is the robustness
claim worth leading with.

Also: determinism 1.0, but note the caveat already in the metrics file — it is trivially
1.0 for a pure function. `meanHeldFractionOnCommitted` is the figure with information in
it, and the corpus mean is dominated by cases never close to deciding.

---

## 3. What is left, in the order I would do it

### 3.1 BLOCKING AND TIME-CRITICAL — the Cmax hunt (before 2 Aug)

This is the difference between "coverage is the finding" and a reportable headline.

**What is needed:** a clinical Cmax source for even a few hundred DILIrank compounds.
That stops R3 firing unconditionally and makes the headline reportable.

**Three options, and the owner must pick:**

| option | consequence |
|---|---|
| **(a) Report it as-is** | Fully defensible today. The spec already argues it well (§8). Costs nothing. |
| **(b) Find a Cmax source before 2 Aug** | Best outcome. Highest risk — it is a data-acquisition problem, not an engineering one. |
| **(c) Re-register R3 in a v1.1** | Legitimate but must be deliberate, documented, and hashed. Do NOT do this to improve a number. |

**What is forbidden:** tuning `abstentionGapThreshold`, or setting
`exposureRelevant: true` without an actual Cmax. Both were considered and rejected.

This competes for the same days as everything else and is a **team-capacity call, not an
engineering one.** It has not been started.

### 3.2 T14 — the LLM ablation (blocked on a key)

`results/metrics.json` currently carries:

```
metric2a_llmConsistency = { "note": "results/ablation.json not present -
  run `npm run ablation` (Task 14, needs ANTHROPIC_API_KEY)" }
```

**Blocked on `ANTHROPIC_API_KEY` from Jack (~$20–40 of spend).** This is the metric that
shows a raw LLM giving inconsistent answers to the same evidence where ARBITER gives one
— it is the "why not just ask a model" answer, and it is currently a hole in the metrics
file. Unblock it early; it needs no new design work.

### 3.3 Phase 3 — the three AI surfaces (not yet specified)

**The largest remaining unknown.** Deliberately deferred until the Phase 2 shell
existed; it now does. Needs a spec via brainstorming, then a plan, then execution. The
three surfaces plus the API service.

Nothing is written. Start with the spec, not with code.

### 3.4 The Teams-share legibility check (needs a person)

Every type size was measured on the built artifact at 1920×1080 and recorded in Phase 2
spec §9a: body 14px, verdict 27px, both as intended. A real problem was found and fixed
— the *honesty caveats* were the smallest and lightest text in the app.

**But the actual read at the far end of a real Teams call has not been done, and a
machine cannot do it.** Screen-share compression degrades silently: everything above was
measured on a local display, which is precisely the condition under which this looks
fine and still fails.

**Owner: whoever runs the first rehearsal.** Record the date and any change in spec §9a.

### 3.5 Final whole-branch review

Phase 2 closed with a per-task review loop, but the branch has never been reviewed
end-to-end as a whole. ~72 commits. Worth doing on the most capable model available
before submission.

---

## 4. Open questions deliberately left open

### 4.1 Should R1 discount, or only defeat?

Recorded in master spec §5 for a **v1.1 re-registration**, and deliberately not acted
on. R1 currently discounts `system: "rodent"` to 10%, so the TAK-994 murine study's
stated strength of 0.9 reaches fusion as 0.090. Whether a rule that already *defeats*
should also *discount* is a real methodological question. It was left alone because
changing it after seeing results is exactly what pre-registration exists to prevent.

If you change it: new version, new hash, written reason, and re-run everything.

### 4.2 Two known minor test weaknesses

Recorded rather than silently fixed:

- The "replaying the tour twice gives identical state" test is **tautological** — it
  compares a computation to itself.
- BEAT 5's belief-movement assertion checks transition *shape* rather than pinning the
  POST_MURINE claim.

Neither is load-bearing. Both are honest to fix if you are in there.

### 4.3 `check-errors` in the pre-flight panel is untested

Deliberately. Asserting `errored.length === 0` on this fixture asserts a value that is
zero under every possible implementation, and there is no honest way to force a throw
from outside the component. A vacuous assertion is worse than an absent one.

---

## 5. How the work is done here

These process rules caught real defects repeatedly. They are not ceremony.

### 5.1 Scrutinise every new test for whether it CAN FAIL

Watch a test fail before you trust it. Three patterns that recur and are always wrong:

- `expect(x).toContain(anyOf(all possible values))`
- asserting a value that is exactly `0` under any implementation
- a range check hiding under a guarantee-shaped name

A live example from this work: the Phase 2 plan's pre-flight test asserted
`textContent` matched `/registered/i`. **That passes on both branches** — the failure
message also contains the word "registered". It was a caption with a test around it. The
fix was to assert on a `data-ok` attribute and test both directions.

### 5.2 Reviews judge behaviour, not conformance

"It matches the plan" is **not** a pass. The plan has been wrong more than once — see
§5.4.

### 5.3 Every fix goes in BOTH the source file and the plan's code block

Sync by **splicing from the verified source and diffing to prove equality.** Do not
hand-retype. `python tools/sync_plan.py` checks the Phase 1 plan and reports
`DRIFT-FREE`; the Phase 2 plan's blocks were spliced and proven byte-identical by
extracting them back out and diffing.

### 5.4 The plan is not the authority; measurement is

Documented cases where a correct implementation would have failed a plan-supplied test,
or the plan's own design was wrong:

- A test targeted R3's strength on the TAK-994 fixture. R3's strength has **zero** effect
  there — the murine claim R3-*defeats* the four safe claims, and defeat ignores
  `strength`. Swapped to R1 (belief 0.090 → 0.855).
- The plan's pre-flight panel printed a hardcoded hash beside "as registered", which
  reads identically on a ruleset that had silently drifted. Rewritten to recompute and
  compare.
- `base: './'` was assumed sufficient for the static build. It was not — see §6.1.

### 5.5 Commit AND push after every task. Not batched.

### 5.6 If an agent dies mid-task, assess the uncommitted work before discarding it

Happened three times (API limits). Once, the abandoned work contained the key insight
about the `file://` failure *and* a change that silently dropped the entire stylesheet.
Both mattered. Reverting blindly would have lost the first; trusting blindly would have
shipped the second.

---

## 6. Defects found and fixed — so they are not reintroduced

Each was demonstrated failing before the fix and passing after.

### 6.1 The submitted ZIP rendered a blank page

**The most serious defect found in the project.** The artifact is a ZIP whose
`index.html` a judge double-clicks. Opening the built file from the filesystem produced
a **completely blank page** — `#root` innerHTML length 0.

Vite tags its emitted `<script>` and `<link>` with `crossorigin`. A page opened from the
filesystem has origin `null`, and `file://` is not a scheme CORS can satisfy, so both
the bundle and the stylesheet failed with `ERR_FAILED`. `base: './'` was necessary and
nowhere near sufficient.

**Every test ran over `http://localhost`, where this failure mode does not exist.** It
would have surfaced after submission.

Fixed by the `inlineEverything` plugin in `apps/web/vite.config.ts`: one self-contained
`index.html`, zero subresources, and the build **fails** if any asset survives
uninlined. Three sub-bugs found by measurement on the way, all documented in the plugin's
comments — read them before touching it:

1. An earlier `format: "iife"` attempt did not change the tag **and silently dropped the
   entire stylesheet.**
2. `String.replace` with a replacement *string* spliced the original tag back into the
   minified code via `$&` — minified JS is full of `$`. Must be a replacer *function*.
3. Dropping `type="module"` runs the inline script in `<head>` before `<body>` exists →
   React error #299 on a null container. Inline module scripts issue no request, so
   there is nothing for CORS to block.

**The guard: `apps/web/e2e/static-file.spec.ts`** opens `dist/index.html` over `file://`
and asserts the verdict renders, the stylesheet applied, Web Crypto works, all seven
beats walk, and nothing is requested over the network. With the plugin disabled it fails
while every localhost test still passes. **That asymmetry is the point — do not delete
this spec.**

### 6.2 Global keys stole keystrokes from form fields

The tour keys are bound on `window`, so every keystroke reached them. Arrow keys nudging
a focused ruleset slider also jumped the beat and switched tabs; typing "murine" or
"malformed" into the Rationale field silently killed the demo's motion. Fixed with the
shared `isTypingTarget` guard. `Escape` is exempt on purpose.

### 6.3 The entire web UI was unlinted

`npm run lint` passed `--ext .ts`, so no `.tsx` file was ever checked. Now
`--ext .ts,.tsx` with a browser env override.

### 6.4 Earlier defects worth knowing about

- `prevRecordHash` chained only `evidenceSnapshotHash`, so tampering with a past
  reviewer's identity or position was undetectable — this falsified the tamper-evidence
  claim outright. Now chains the full record.
- The web app's hash projection omitted `precedenceOrder`, so every results row would
  have carried a non-registered hash. There is now **one** definition of the
  pre-registration surface (`apps/harness/src/preregistration.ts`) with two digest
  implementations, node and browser.
- `git add data/out/...` added nothing (gitignored), which would have made the
  split-before-fitting validity claim unverifiable. The pattern must be `data/out/*`,
  not `data/out/` — git cannot re-include a file under an excluded directory.
- PubChem renamed its SMILES property; Tox21's `assay/name/.../aids/JSON` endpoint does
  not exist. Both silently produced **empty** streams, which would have emptied the
  headline metric. Both rebuilt.
- A conformal empty-set rule was unreachable for `qhat ≥ 0.5`, so R4 could never fire.
  Replaced with Tanimoto nearest-neighbour applicability domain.

The pattern across all of these: **a silent empty result looks exactly like a working
pipeline.** Assert on counts.

---

## 7. Repo map

```
packages/engine/          Pure reasoning engine. Lint-enforced purity.
  src/index.ts            reason(), reasonVerdictOnly(), reasonCore()
  src/rules.ts            R1-R6, as both defeat rules and evidence-quality discounts
  src/fuse.ts             Dempster-Shafer belief/plausibility/conflict mass
  src/argue.ts            Defeasible argumentation, grounded semantics, reinstatement
  src/counterfactual.ts   Exhaustive minimal-flip search
  src/plan.ts             Value-of-information planner (the 0.992 robustness number)

apps/harness/             Benchmark runner. Node only.
  src/preregistration.ts  THE pre-registration surface + canonicalisation. One copy.
  src/main.ts             Scores the test split, writes results/
  src/metrics.ts          The five metrics, with their honesty caveats in comments

apps/web/                 Five-tab app. Engine runs in the BROWSER.
  vite.config.ts          inlineEverything - read §6.1 before touching
  e2e/static-file.spec.ts The file:// guard. Do not delete.
  src/ui/Preflight.tsx    The ? panel: real checks, not captions

data/prep/*.py            DILIrank ingestion, splits, QSAR/Tox21 streams
rules/ruleset-v1.0.json   PRE-REGISTERED AND HASHED. Do not edit.
results/                  metrics.json, golden/, verdict-manifest.json (golden-filed)
docs/superpowers/specs/   2026-07-26-arbiter-design.md is the master spec
docs/superpowers/plans/   Task-by-task plans with every code block synced to source
```

### Read in this order

1. `docs/superpowers/specs/2026-07-26-arbiter-design.md` — the master spec. **§8 is the
   honest results section; read it before quoting any number.**
2. `docs/superpowers/specs/2026-07-27-arbiter-phase2-web-app-design.md` — the web app,
   including §9/§9a on the static build and legibility.
3. `docs/superpowers/plans/2026-07-27-arbiter-phase2-web-app.md` — 14 tasks, all closed,
   each recording what was measured and what went wrong.

---

## 8. State at merge

| | |
|---|---|
| Tests | 269 vitest across 32 files; 8 Playwright |
| Lint / typecheck / build | clean |
| `golden:update` | produces no diff — the reported numbers have not moved |
| CI | green, and now runs `web:build` + `playwright install` + `e2e` on every push |
| Bundle | 1,081 kB raw / 178 kB gzipped, one self-contained file |
| Ruleset hash | `ed073a8a…` matches pre-registration |
| Phase | 1 complete, 2 complete (all 14 tasks), 3 not started |

One untracked file left deliberately:
`documents/Drug Induced Liver Injury Rank (DILIrank 2.0) Dataset FDA.xlsx`. Committing a
data file is an owner's call, not mine.

---

## 9. If you read only one thing

The result is **honest and defensible, but it is not a win over the baseline.** ARBITER
ties `single:transporter` exactly, and abstains on 97.4% of compounds because no
benchmark compound carries exposure-relevant evidence.

The temptation will be to fix that by moving a number. `abstentionGapThreshold` is
pre-registered precisely so that it cannot be moved after an abstention rate has been
seen. **What would fix it is data, not rules.**

The strongest things to lead with are the ones that are actually true: a pre-registered
hashed ruleset, a deterministic engine, golden-file CI that catches a moved number, a
planner whose recommendation survives ±50% prior perturbation 99.2% of the time, and an
audit trail whose tamper-evidence has been tested rather than asserted.
