# ARBITER — handover audit

**Written 2026-07-28. Branch `arbiter-round1` merged to `main`.**
**Updated 2026-07-29 for Phase 3 (branch `phase3`, 14 tasks). The Phase 3 record is
§10 — read it with §3.3, which it corrects.**
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
npm run lint && npm run typecheck && npm test      # 513 tests, 52 files
npm run web:build && npm run e2e                   # 12 Playwright tests
npm run golden:update && git diff --exit-code results/   # must produce NO diff
```

All of the above were green at merge, and CI runs all of it on every push.

**Every command in this document was executed on 2026-07-28**, from the merge commit, and
every file path it names was checked to exist. Results at that point: lint clean, typecheck
clean, **275** vitest tests across 32 files, **8** Playwright tests, `golden:update` produces
no diff, and **32** Python tests pass across the four files in `data/prep/tests/`. The one
path deliberately unresolvable is `progress.md`, for the reason in §7.

**Re-run on 2026-07-29 from the end of branch `phase3`:** lint clean, typecheck clean,
**513** vitest tests across 52 files, **12** Playwright tests, `golden:update` still produces
no diff — Phase 3 moved no reported number. The Python side is untouched by Phase 3 and was
not re-run.

If a command here fails for you, it is drift since that date, not a typo — say so in this
file when you fix it.

**On Windows, `golden:update` will make the golden file look modified when it is not.**
The script writes LF, git's `autocrlf` rewrites to CRLF, and `git status` then reports
`M results/golden/metrics.golden.json` with an empty `git diff`. Confirm it is nothing
before you go hunting:

```bash
git show HEAD:results/golden/metrics.golden.json | sha256sum
sha256sum results/golden/metrics.golden.json    # identical => nothing moved
git checkout -- results/golden/metrics.golden.json   # clears the phantom
```

Called out because **"did one of my numbers move?" is the most alarming question in this
project**, `golden:update` exists precisely to answer it, and a false yes from a line
ending wastes exactly the time that guard was built to save. CI runs on Linux and never
sees this.

### The Python half, which npm does not touch

`data/prep/` is a separate toolchain and you need it for anything touching the data
layer — including the Cmax work, which is the most time-critical item on the list.

```bash
python -m venv .venv && . .venv/Scripts/activate     # or bin/activate outside Windows
pip install -r data/prep/requirements.txt            # pandas, rdkit, scikit-learn, ...
cd data/prep && python -m pytest                     # 4 test files
```

`data/prep/README.md` documents the pipeline order. Note `rdkit` is the heavy dependency
and the one most likely to fight a fresh environment.

**These Python tests do NOT run in CI.** See §3.5d — two of them guard the strongest
methodological claim in the project, so run them by hand after touching `data/prep/`.

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

**And now say WHY, because the reason is measurable and it is better than the bare fact:
both pipelines are scoring the same four compounds.** There are only 4 transporter claims
in the scored split, and ARBITER's four commitments on the conflict subset are exactly
those four compounds. An exact tie between two pipelines evaluated on an identical set of
four is close to expected. See the stream-coverage table below.

### Coverage is the finding

ARBITER abstains on **260 of 267 compounds (97.4%)**. Every abstention is the
belief–plausibility gap rule; **none** is applicability-domain and **none** is total
conflict. The median compound musters 0.060 of committed mass against a threshold
needing more than 0.5.

**Correction, measured 2026-08-05. This section said "the cause is measurable and
structural: no benchmark compound carries exposure-relevant evidence" — singular. That
cause is real, it is the one worth leading with, and it is not the whole cause.** R3's
exposure discount accounts for 118 of the 225 discounted claims. Two other factors do
comparable work, and naming only the first understates a stronger result than the one
it was reaching for.

The headline figure is `metric4_abstentionQuality.nStructurallyForced` in
`results/metrics.json`, emitted by the harness and golden-filed. `npm run coverage:report`
prints the working behind it. Re-run that rather than trusting this paragraph.

#### Three causes, not one

| # | cause | measured |
|---|---|---|
| 1 | **No exposure-relevant evidence.** R3 discounts a negative result tested outside the clinically relevant range to 15% of stated confidence. | 118 claims |
| 2 | **QSAR measures no key event.** Structure correlation alone is discounted to 6%, or to 1% where it carries least. | 107 claims |
| 3 | **The corpus is thin.** 140 of 267 compounds carry exactly **one** claim; 123 carry two; 4 carry three. There is usually no second stream to fuse. | 52.4% single-claim |

225 of 398 claims — **56.5%** — reach fusion discounted. A lone QSAR claim at 1% of its
stated confidence has a ceiling of 0.01 committed mass against a bar of 0.5.

#### The stream coverage, which is the concrete form of all three

This is the most legible explanation in the chain and it was not written down anywhere.
On the scored split (`sampleSizes.streamCoverage`, rendered on the Validation tab):

| stream | claims | compounds | of the split |
|---|---|---|---|
| qsar | 267 | 267 | **100%** |
| cytotox | 127 | 127 | 47.6% |
| transporter | 4 | 4 | **1.5%** |

Which resolves into exactly three groups:

| streams held | compounds |
|---|---|
| qsar only | **140** |
| cytotox + qsar | 123 |
| cytotox + qsar + transporter | **4** |

**ARBITER adjudicates between sources, and 140 compounds have one.** That single source is
always QSAR, which R2 discounts to 6% or 1% for measuring no key event. There is nothing to
adjudicate and nothing that could clear the bar. The engine is being asked to do its job on
compounds where its job does not exist.

#### The tie is the same four compounds, and that is worth saying first

`single:transporter` — the baseline §2 reports ARBITER as tying — draws on **4 claims in
the entire scored split.** It commits on 4 compounds because 4 is every compound it has.

Measured: **ARBITER's four committed compounds on the conflict subset are exactly the four
carrying a transporter claim.** Identical sets, not an approximate overlap. So on this
subset ARBITER commits *if and only if* transporter evidence exists — a transporter claim
is the only evidence in the corpus that survives discounting with enough mass to decide.

That reframes the tie. It is not a coincidence and not a coin flip: both pipelines are
scoring the same four compounds, so an exact tie is close to the expected outcome rather
than a surprising one. **Say this before a judge derives it**, because "you tie a single
stream" lands very differently from "we tie it because the evidence base gave both of us
the same four compounds, and we say so on the Validation tab."

It also sharpens §3.1. Cmax data addresses cause 1 and nothing else — it would not give
QSAR a key event, and it would not give 140 compounds a second stream.

#### 254 of the 260 declines could not have committed at any evidence values

This is the sharpest way to state the result, and it is stronger than what this section
used to claim. Sum the surviving weight of every live committed claim on a compound and
pretend each was stated at full confidence 1.0. For **254 of the 260 declines** that
generous ceiling still cannot reach the mass the threshold demands, so the gap rule fires
**before the engine reads a single evidence value**.

**Only 6 abstentions were evidence-dependent.** Everything else was settled by the shape
of the evidence base, not by what the numbers said. For those 254 the actionable reading
is that the assay class is the wrong instrument — more of the same evidence would not
change the answer — and that is a far more useful thing to tell a toxicologist than "the
gap was too wide".

The bound is deliberately an over-estimate twice over: real strengths are below 1, and
Dempster combination yields less than the sum for masses this small (two 0.15 claims
combine to 0.2775, not 0.30). That is what makes "could not have committed" a safe word
rather than a guess. `abstentionQuality` **throws** if a compound it called forced turns
out to have committed, so a broken bound fails the run instead of reporting a number.

**Correction, 2026-08-05, same day.** An earlier version of this section said **160 of
267 (59.9%)**, derived by a standalone script that recovered discount factors by regexing
the trace's rationale prose. It was wrong by 94 compounds: it credited every **ambiguous**
claim with full weight, and an ambiguous claim commits no mass at all — there are 100 of
them in the scored set. The number now comes from `relevanceDiscount`, the same engine
function that produced the mass, and the script has been deleted rather than fixed. Two
implementations of one number is how the two drift apart, and this pair drifted before it
was a week old.

#### The threshold is not the binding constraint

The obvious challenge is "so loosen the threshold". Measured, it does almost nothing
until it stops meaning anything:

| gap threshold | compounds committing |
|---|---|
| **0.50 (registered)** | 7 (2.6%) |
| 0.70 | 12 (4.5%) |
| 0.80 | 13 (4.9%) |
| 0.90 | 119 (44.6%) |

The 10th-percentile gap is already 0.865 — almost nothing sits between 0.5 and 0.85.
Compounds are either decisive or nowhere near, so there is no setting that trades a
little rigour for a lot of coverage. Reaching 44.6% means committing on evidence that is
90% unknown. **This curve is why `abstentionGapThreshold` must not be touched (§1.1): it
is not merely forbidden, it would not work.** The fix is data — see §3.1.

#### Why zero advances

The only `exposureRelevant: true` claim in the corpus is the TAK-994 murine study, which
is excluded from the benchmark by design. QSAR has no exposure axis; Tox21 qHTS
concentrations are not clinical. So R3 fires on **100% of safe claims and 0% of toxic
ones**, and the engine structurally *cannot* license "advance" on this evidence base. It
returned zero advances — all 7 commits are `do_not_advance`.

This is simultaneously the engine being correct about weak evidence — an HTS "inactive"
at an unknown multiple of clinical exposure genuinely licenses nothing — and a coverage
problem. Those are the same fact, not two competing readings.

#### Abstention is not conflict, and the app invites that confusion

The conflict subset (61) and the decline count (260) measure different predicates and
have no subset relationship. `detectConflict` flags a compound when two **different**
streams commit to opposite conclusions; declining is about evidence being too weak to
commit. Measured, they are close to independent:

| | abstain | commit | rate |
|---|---|---|---|
| conflicting (61) | 57 | 4 | 93.4% |
| non-conflicting (206) | 203 | 3 | 98.5% |

Non-conflicting compounds abstain *more* often. Max `conflictMass` across all 267 is
**0.121** against a total-conflict branch needing ≥ 1.0, so that branch has never fired
and cannot on this data.

Worth knowing because the app's own copy invites the wrong inference: the About tab's
"declines to commit on 260 of them" sits two clicks from beat 1's "61 of 267 have
streams in genuine conflict", with nothing saying they are unrelated. Also note 267 − 260
= **7** commits while the Validation tab shows **4** — the other 3 are non-conflicting
compounds, two denominators rather than an inconsistency. Both are live ways a judge can
be confused by numbers that are individually correct.

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

**The whole path, at a glance.** Items marked *needs a person* cannot be done by an agent.

| # | what | blocked by | § |
|---|---|---|---|
| 1 | **Cmax hunt** — before the 2 Aug freeze | *needs a person*; team-capacity call | 3.1 |
| 2 | **LLM ablation** — needs BUILDING, not just a key; see the correction | `ANTHROPIC_API_KEY` (~$20-40) **and** a spec | 3.2 |
| 2b | **Python tests into CI** — one guards the split-before-fitting claim | nothing | 3.5d |
| 3 | **Type the metrics contract** — small, do it before Phase 3 adds readers | nothing | 3.5c |
| 4 | **Phase 3 spec, then plan** — requirements already in master spec §7 | nothing | 3.3 |
| 5 | **Phase 3 build** — Surface 1, then 3, then 2 | item 4 | 3.3 |
| 6 | **Build and hand-check the ZIP** from a clean clone, on another machine | item 5 | 3.7 |
| 7 | **Deck on real numbers** — pulled from `metrics.json`, never retyped | item 5 | 3.7 |
| 8 | **Recorded walkthrough** — insurance against a live demo failing | item 5 | 3.7 |
| 9 | **Rehearse + the Teams-share read** | *needs a person* | 3.4, 3.7 |
| 10 | **Submit early** | items 6-9 | 3.7 |

Items 1-4 are independent of each other and can run in parallel. **The nearest deadline
is not 16 August** — it is the ambassador check-in, which expects the demo *and* the
business presentation, and whose date is not recorded in this repo. See §3.7.

If you are picking this up cold and want one instruction: **do item 3, then item 4.**
They are the two that are unblocked, well-defined, and entirely in your hands.

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

### 3.2 T14 — the LLM ablation is UNIMPLEMENTED, not merely unkeyed

**Correction to an earlier draft of this document, which said it was "blocked on
`ANTHROPIC_API_KEY`" and "needs no new design work". Both were wrong**, and believing
them would cost someone a day.

`results/metrics.json` tells you to run `npm run ablation`. **That script does not
exist.** Neither does any implementation:

```bash
$ npm run   # ablation is absent from the whole list
test lint typecheck harness validate:evidence metrics golden:update e2e web:dev web:build
$ find . -name '*ablation*' -not -path '*/node_modules/*'
# nothing
```

The only reference anywhere is in `apps/harness/src/run-metrics.ts`, which emits the
"not present" note into `metric2a_llmConsistency`. So the metric is a placeholder that
correctly reports its own absence — good behaviour, but it is *all* that exists.

**What actually has to be built**, and it needs design decisions, not just a key:

1. A runner that asks a model for a verdict on the same evidence, **25 runs per compound**
   across the conflict subset (spec §7, Surface 2) with the temperature disclosed.
2. The prompt, and a decision on how the evidence is serialised into it — this is a
   methodological choice a judge can attack, so it belongs in the spec before the code.
3. A consistency metric over those runs, plus how disagreement is summarised.
4. Caching, because 61 compounds × 25 runs is not something to re-run casually, and the
   result must be committed so a reviewer can re-derive the number.
5. Engine purity is not at risk — this lives entirely in `apps/harness`, which is
   allowed I/O — but **determinism is.** Everything else in `results/` is reproducible
   from a seed. A model's output is not, so the committed run data becomes the record and
   `golden:update` must not start churning on it.

`ANTHROPIC_API_KEY` (~$20–40) is necessary but nowhere near sufficient. Budget this as a
real task with a spec, not an afternoon.

Note the honest framing this metric is for: **"why not just ask a model"** — showing a
raw LLM giving inconsistent answers to identical evidence where ARBITER gives one. Until
it exists, that question has no measured answer, only an argument.

### 3.3 Phase 3 — the three AI surfaces

**STATUS, 2026-07-29: Surfaces 1 and 3 are BUILT on branch `phase3` (14 tasks). Surface 2
is specified and deliberately not built.** Everything below was written before that work and
is kept because its reasoning is still the reasoning; **§10 records what the build actually
found, including two claims in this section that turned out to be false.**

**Correction to an earlier draft of this document, which said "nothing is written".
That was wrong.** The three surfaces are specified in detail in **master spec §7** —
endpoints, payload shapes, fallback ladders, and thresholds. What does not exist is a
Phase 2-style *implementation plan*. Read §7 before writing a line.

The governing discipline, and the answer to "why use an LLM while benchmarking against
one": **models do language, never judgment.** Parsing a sentence and matching a question
to an anchor are language tasks. Deciding is not.

| surface | endpoint | returns | why it is safe |
|---|---|---|---|
| **1. Challenge interpreter** (live) | `POST /api/interpret` | a proposed rule change + `paraphrase` + `confidence` | **The change is displayed before it is applied.** A misinterpretation is visible and rejectable, never silent. Receives claim **ids and labels only**, never raw evidence values. |
| **2. Live ablation spot check** | — | one extra run appended | The headline is pre-computed at **25 runs per compound**, so the live run is a spot check, not the evidence. A concordant live run contradicts nothing. |
| **3. Navigator** | `POST /api/navigate` | `{ anchorIds: string[], noMatch: boolean }` — **ids only, never prose** | **Structurally unable to hallucinate.** The return type gives it nowhere to put an invented claim. The UI only spotlights text that already exists. |

Surface 1's fallback ladder is five rungs (live 2.5s timeout → exact cached match →
trigram Jaccard ≥ 0.55 → deterministic keyword mapping → a plain rule picker). **At
every rung the change runs through the same engine — only the route from English to rule
change differs.** The reasoning is never faked. Spec §11 requires each surface to be
exercised against network-off, HTTP 500, malformed JSON, timeout, and missing key.

Suggested order: **write the Phase 3 spec → plan → Surface 1 → Surface 3 → Surface 2**,
because Surface 1 is the only one where responsiveness is visible to a judge (spec §6)
and Surface 2 is the cheapest to cut.

**The cut order is already decided (spec §14), so nobody argues about it at 11pm on 14
August:**

> navigator (surface 3) → live ablation garnish → evidence-package export → motion
> Level 2 down to Level 1

**Never cut:** engine determinism tests, the argument trace, the belief–plausibility
track, the consensus record. *Those four are the product.*

Note Phase 3 needs the API service, which is the first thing in this project that is not
a static artifact. The static ZIP must keep working with every surface on cache — that
is asserted by `apps/web/e2e/static-file.spec.ts`. **Do not break that test to make a
surface work.**

**Correction, measured 2026-07-29.** The sentence that stood here — that the spec "fails if
the app makes any network request" — was **false over `file://`, which is the only protocol
that test uses.** Playwright's `request` and `requestfailed` channels never fired for a
refused `file:` fetch, so with the `liveEnabled` gate ablated so both AI ladders fired real
fetches on every panel open, **all five tests in that file stayed green.** The fetch is
refused by the Fetch API synchronously, before any network event exists to observe, and a
caught `TypeError` produces no `pageerror` either. The one trace is a console error:

```
Fetch API cannot load file:///api/interpret. URL scheme "file" is not supported.
```

The test now collects console errors and opens the pre-flight panel so both ladders actually
run; the fix was verified by re-ablating the gate and watching it fail. **The general lesson
is bigger than one test: over `file://` the network panel is not evidence.** See §10.2.

### 3.4 The Teams-share legibility check (needs a person)

Every type size was measured on the built artifact at 1920×1080 and recorded in Phase 2
spec §9a: body 14px, verdict 27px, both as intended. A real problem was found and fixed
— the *honesty caveats* were the smallest and lightest text in the app.

**But the actual read at the far end of a real Teams call has not been done, and a
machine cannot do it.** Screen-share compression degrades silently: everything above was
measured on a local display, which is precisely the condition under which this looks
fine and still fails.

**Owner: whoever runs the first rehearsal.** Record the date and any change in spec §9a.

### 3.5 Final whole-branch review — DONE, and it found a real defect

Ran after the merge. **It found a defect in a judge-facing headline number**, which is
the argument for having done it: `metrics.json` had a single field named `ci` carrying
the *raw*-accuracy Wilson interval, and the Validation tab printed it beside *balanced*
accuracy as "balanced accuracy 0.75 (95% CI 0.51-1.00)". The interval described a
different statistic than the number next to it. Three reported pipelines had intervals
that did not contain their own point estimate:

| pipeline | balanced accuracy | old interval | contains estimate? |
|---|---|---|---|
| `single:qsar` | 0.500 | [0.799, 0.953] | no |
| `single:cytotox` | 0.500 | [0.046, 0.198] | no |
| `weightedAverage` | 0.547 | [0.743, 0.920] | no |
| **ARBITER** | 0.750 | [0.510, 1.000] | was really raw accuracy 4/4 = 1.0 |

Fixed by splitting the field into `balancedAccuracyCi` and `rawAccuracyCi`, and
returning **null** for the former whenever a class is absent — including ARBITER's own
headline. A substituted 0.5 is not an estimate, so it has no sampling uncertainty, and
borrowing an interval to fill the gap puts a precision claim on a placeholder.

Verdicts did not move: `results/verdict-manifest.json` is byte-identical. Only the
reported intervals changed.

Note that TypeScript did **not** catch this, because the web app reads `metrics.json`
through a `Record<string, any>` cast. `npm run typecheck` stayed green while
`Validation.tsx` referenced a field that no longer existed. **The metrics contract
between the harness and the app is untyped — that is a live gap.** Worth closing with a
shared type or a runtime schema if you touch this area.

### 3.5a A flake that was a real state bug, and a misdiagnosis of mine

During Phase 2 Task 14 one test run failed and 12 subsequent runs did not reproduce it.
I attributed it to `expect.poll` not wrapping in `act()` and switched to `waitFor`. **That
diagnosis was wrong** and it only hid the symptom locally; CI failed on the same test
again during this review.

The actual cause was in `Preflight.tsx`. `hashOk` compares the computed hash to the
registered one, but before Web Crypto resolves the hash is `null`, so `hashOk` was
`false` and `String(hashOk)` put `data-ok="false"` on the **first paint of every
render** — the panel reporting a FAILED pre-registration check, in red, before it had
run one. The test raced against that initial state.

Fixed in the component with an explicit `"pending"` state, not in the test. Verified by
reverting: `expected 'false' to be 'pending'`. Stable across 6 consecutive runs.

**The lesson worth carrying:** a flaky test is often a real state bug presenting badly.
"Retry until green" and "swap the waiting primitive" both make the symptom go away
without touching the defect.

### 3.5b The rest of the review

The engine came out clean. `fuse.ts` is correct Dempster combination (masses sum to 1
by construction; total conflict returns vacuous with K=1 rather than fabricating a
verdict). `abstain.ts` reads its threshold from the pre-registered ruleset and checks
total conflict, then applicability domain, then the gap, in that order. `soften` cannot
produce a negative mass because rule strengths are schema-bounded to [0,1]. The comments
in `index.ts` documenting why the R6 concordance boost was deleted are accurate.

The branch was merged to `main` before this review ran, at the owner's direction. That
turned out to matter: the fix above is a follow-up PR rather than part of the branch.

### 3.5c Type the harness-to-app metrics contract

Its own item because it is a live footgun rather than a note. `apps/web` reads
`results/metrics.json` through a `Record<string, any>` cast, so **`npm run typecheck`
cannot see a renamed or removed metric.** It stayed green while `Validation.tsx`
referenced a field that no longer existed; the failure would have been a blank Validation
tab in front of a judge.

Close it with a shared type or a runtime schema. `zod` is already a dependency and
already validates claims and the ruleset in `apps/web/src/data/load.ts` — the same
pattern applied to `metrics.json` would make a drifted field fail at load with a message
naming itself, which is how every other bundled artifact in this app already behaves.

Small, contained, and worth doing before Phase 3 adds more surfaces reading more fields.

### 3.5d The Python tests are not in CI, and two of them guard the headline claim

`data/prep/tests/` holds four test files and 32 tests. **None of them runs in CI** — the workflow
never invokes `pytest` or installs Python at all. Two of the four are not incidental:

| test | what it protects |
|---|---|
| `test_splits.py` | the three-way split |
| `test_qsar_leakage.py` | **that the QSAR model was fitted on train only** |
| `test_evidence_assembly.py` | stream assembly into `evidence.json` |
| `test_tak994_asof.py` | the fixture's as-of milestones |

`test_qsar_leakage.py` guards **the strongest methodological claim in the project** —
that the split was fixed before any model was fitted, which is the condition under which
every reported number is valid at all (master spec §8). A leak reintroduced into
`data/prep/` today would be caught by nothing automatic.

**Fix:** add Python to the CI job and run `pytest`. It is a handful of lines and needs
`rdkit`, which is the slow install — cache `~/.cache/pip` the same way the Playwright
browser is cached, and check the cache actually hits (§3.6 for why that phrasing).

Until then: **run `cd data/prep && python -m pytest` by hand after any change under
`data/prep/`.** That instruction is easy to forget, which is the argument for doing the
CI work rather than relying on it.

### 3.6 CI has one step that can stall for ten minutes, unpredictably

`npx playwright install --with-deps chromium`, added in Phase 2 Task 13, apt-installs
system libraries. Measured on two runs of the **identical command, both cache misses**:

| run | duration |
|---|---|
| `30404690149` | **10m35s** |
| `30405621001` | **25s** |

So the ten minutes was **transient** - a slow apt mirror or a degraded runner - not the
step's steady-state cost. An earlier draft of this document claimed the step "costs
12m24s"; that was one observation generalised into a property, and it was wrong.

**Cache verified hitting** on run `30407611266`: `install --with-deps` was skipped and
`install-deps` took 18s, so the whole Playwright cost is now ~21s.

`~/.cache/ms-playwright` is now cached anyway, keyed on `package-lock.json`. Stated
honestly, that is **cheap insurance against the stall recurring**, worth ~25s on the
happy path - not a ten-minute win. `install-deps` still runs on a cache hit, because the
browser binary is cached but the OS libraries are not, and omitting them fails on a
fresh runner image as what presents as a flaky test.

If CI stalls on this step again, suspect the mirror rather than the config. **Verify the
cache is actually hitting** - a mis-keyed cache silently degrades to the slow path and
looks identical to working.

---

### 3.7 Getting it submitted — the part no code covers

**This was missing from the first draft of this document entirely.** Everything above is
engineering; none of it is the deliverable until it is packaged, rehearsed and sent.

**A nearer deadline than 16 August:** the next **ambassador check-in expects the demo
AND the business presentation** (spec §14). Whatever exists then is what gets feedback.
A thin end-to-end slice beats a polished fragment. **The date is not recorded anywhere in
this repo — find it and write it here.** Roughly 22 teams are in this round; the mentor
guessed about half advance but was explicit that he did not know, so treat it as unknown.

Spec §14's own schedule for the end:

| window | work |
|---|---|
| Aug 10 – Aug 14 | three AI surfaces with fallback ladders, export, spotlight, tour, motion, Playwright walk, Teams-share test, static build |
| Aug 15 – Aug 16 | **deck on real numbers, recorded walkthrough, rehearse to 14:00, submit early** |

In dependency order:

1. **Build and check the ZIP, from a clean clone.** `npm ci && npm run web:build`, then
   zip `apps/web/dist/`. Open `index.html` **from the filesystem, on a machine that is not
   yours**, with no server. §6.1 is why: this exact artifact rendered a blank page once,
   and the failure is invisible over `http://localhost`. `npm run e2e` guards it, but
   verify the actual ZIP a judge receives at least once by hand.
2. **The deck on real numbers.** Pull them from `results/metrics.json`, never retype
   them. §2 of this document is the honest framing, including that ARBITER ties
   `single:transporter` exactly. If the deck's numbers and `metrics.json` disagree, the
   deck is wrong.
3. **The recorded walkthrough.** Insurance against a live demo failing. `→` drives all
   seven beats, so it needs no mouse and no hidden knowledge — any of the three of you
   can present it.
4. **Rehearse, and do the Teams-share read (§3.4) during the first rehearsal.** That
   check is still outstanding and needs a person on a real call.
5. **Submit early.** Spec §14 says so explicitly. Do not spend the buffer on polish.

**Q&A preparation is a work item, not a hope.** Master spec §13 already contains
prepared answers to the hardest questions — the fudge-factor challenge, "is R6 really a
rule", "why use an LLM while benchmarking one". Read them; they are better than what
anyone will improvise. The two answers most likely to be needed:

- **"Your system abstains on 97% of cases."** Correct, and it is the finding, not a
  defect. **Lead with the strongest form: 254 of the 260 declines could not have committed
  at any evidence values — only 6 were evidence-dependent — so the abstention is
  arithmetic rather than judgment.** Three causes: no exposure-relevant evidence, QSAR
  measuring no key event, and 52% of compounds carrying a single claim. If pressed on
  "just loosen the threshold": 0.50 → 0.80 buys six compounds, and 44.6% coverage needs a
  threshold of 0.90, which is committing on 90%-unknown evidence. The figure is
  `nStructurallyForced` in `metrics.json`; `npm run coverage:report` shows the working.
- **"You didn't beat the baseline."** Also correct. It ties `single:transporter` exactly.
  Say it before a judge finds it — **and say why**: there are 4 transporter claims in the
  whole scored split, and ARBITER's four commitments on the conflict subset are exactly
  those four compounds. Both pipelines are scoring an identical set of four, so the exact
  tie is close to expected rather than surprising. The Validation tab renders the
  stream-coverage table this comes from.

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
zero under every possible implementation, and a vacuous assertion is worse than an absent
one.

**The second half of that reasoning no longer holds.** This section used to say there was
"no honest way to force a throw from outside the component". There is one, and it is now
in use: `apps/web/test/store.test.ts` builds a claim whose `assertion` is a throwing getter
and hands it to the engine, which produced `Error: engine exploded` through
`reasonVerdictOnly`. That test exists because the containment it guards — one bad compound
must not blank the 267-row library table — was itself untested, and replacing the `catch`
with `throw e` left the whole suite green.

The same technique would work for `Preflight`. The gap is now a gap because nobody has
closed it, not because it cannot be closed honestly. **Closing it is a small, well-defined
task** — the first half of the reasoning above still stands, so the test must force the
throw rather than assert a zero.

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
  src/coverage-report.ts  The working behind §2 (npm run coverage:report)

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

### What you will look for and not find

`.superpowers/` is **gitignored**, so none of it reached you: the SDD ledger
(`progress.md`), the per-task briefs, and the per-task review reports that Phases 2 and 3
were built and reviewed through. If a commit message or a plan refers to "the ledger" or
"task-N-report.md", that is why you cannot open it.

**Phase 3's ledger conclusions were copied into §10 of this document** rather than left to
die on one machine — which is what the paragraph below asks for, and which the Phase 3
branch had not done until the final review caught it.

Nothing load-bearing was lost, because the findings were deliberately written into
tracked files as each task closed — the plans under `docs/superpowers/plans/` record what
was measured and what went wrong per task, and this document carries the rest. But if you
are hunting for a decision's rationale and the trail stops, it stopped there. Ask Jack.

**If you run tasks the same way, either commit your ledger or copy its conclusions into a
tracked file as you go.** A recovery map that only exists on one machine is not a
recovery map — which is the same argument that keeps `data/out/` and `results/` in git.

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
| Tests | 275 vitest across 32 files; 8 Playwright |
| Lint / typecheck / build | clean |
| `golden:update` | produces no diff — the reported numbers have not moved |
| CI | green, and now runs `web:build` + `playwright install` + `e2e` on every push |
| Bundle | 1,081 kB raw / 178 kB gzipped, one self-contained file |
| Ruleset hash | `ed073a8a…` matches pre-registration |
| Phase | 1 complete, 2 complete (all 14 tasks), 3 not started |

### 8.1 State at the end of branch `phase3` (2026-07-29)

| | |
|---|---|
| Tests | 513 vitest across 52 files; 12 Playwright |
| Lint / typecheck / build | clean |
| `golden:update` | produces no diff — Phase 3 moved no reported number |
| Bundle | 1,144 kB raw / 199 kB gzipped, still one self-contained file |
| Ruleset hash | `ed073a8a…` unchanged; `rules/ruleset-v1.0.json` untouched |
| Phase | 1 complete, 2 complete, 3 built except Surface 2 (specified, deliberately not built) |

One untracked file left deliberately:
`documents/Drug Induced Liver Injury Rank (DILIrank 2.0) Dataset FDA.xlsx`. Committing a
data file is an owner's call, not mine.

---

## 9. If you read only one thing

The result is **honest and defensible, but it is not a win over the baseline.** ARBITER
ties `single:transporter` exactly, and abstains on 97.4% of compounds because the
evidence base is too thin and too heavily discounted to license a decision — for 254 of
those 260 declines, provably so at any evidence values (§2).

The temptation will be to fix that by moving a number. `abstentionGapThreshold` is
pre-registered precisely so that it cannot be moved after an abstention rate has been
seen — and, measured, moving it from 0.50 to 0.80 buys six compounds. **What would fix
it is data, not rules.**

The strongest things to lead with are the ones that are actually true: a pre-registered
hashed ruleset, a deterministic engine, golden-file CI that catches a moved number, a
planner whose recommendation survives ±50% prior perturbation 99.2% of the time, and an
audit trail whose tamper-evidence has been tested rather than asserted.

---

## 10. Phase 3 — the record, copied out of the gitignored ledger

**Why this section exists.** §7 warns in writing that `.superpowers/` is gitignored and
that a recovery map living on one machine is not a recovery map. Phase 3 then ran fourteen
tasks through that ledger and **touched neither this document nor `docs/` in 5,894 lines of
diff** — so a plan defect, two adjudications and thirteen deferred findings existed on
exactly one laptop. The final whole-branch review caught it. What follows is the ledger's
*conclusions*, in a tracked file. If you are running tasks the same way, do this as you go.

### 10.1 What shipped

Surfaces 1 (challenge interpreter) and 3 (navigator), both complete, both resolving through
one shared five-rung fallback ladder (`apps/web/src/ai/resolve.ts`) that returns
`{ value, rung, source }` — so "which rung answered" is a **value** the tests assert on and
the pre-flight panel displays, not a comment. Plus an anchor registry with a `data-anchor`
namespace, an evidence working copy (`evidenceEdits`), a spotlight, the precedence/threshold
block on the Ruleset tab, and two thin handlers in `services/api/`.

**Surface 2 is specified and deliberately not built** (Phase 3 spec §6). It appends one run
to a pre-computed 25-runs-per-compound ablation that does not exist (§3.2). The Validation
tab renders the placeholder `metric2a_llmConsistency` already carries, and the button stays
disabled **even if that metric one day carries real numbers** — a specified-but-not-built
surface must not enable itself the day the harness lands under it.

### 10.2 Over `file://`, the network panel is not evidence

**The most transferable finding of the phase, and it is about the project's central
methodology rather than about one test.**

Reproduced independently twice, in a real browser: a `fetch()` of a relative path from a
`file://` document is refused by the Fetch API **synchronously**, before any CDP network
event exists to observe. No `request`. No `requestfailed`. No `pageerror`, because the
rejection is caught. The sole trace is a console error:

```
Fetch API cannot load file:///api/interpret. URL scheme "file" is not supported.
```

Consequence, measured by ablating `client.ts`'s `liveEnabled` gate to `true` so both ladders
fired real fetches on every panel open: **all five tests in `static-file.spec.ts` stayed
green.** The guarantee that the submitted ZIP never reaches for the network could not fail.

Fixed by giving that test a console-error listener and making it open the pre-flight panel,
so both ladders run with their real resolvers; verified by re-ablating and watching it fail
with both console lines. `request`/`requestfailed` are kept, re-labelled as belt-and-braces
for a regression on a **served** build. `ai-static.spec.ts` had this right first and says so.

Spec §2 and the Phase 3 plan both asserted the opposite of what is measurable. Both are
corrected in place.

### 10.3 The pre-flight probes are deliberately unpinned, and the panel must not pretend otherwise

`Preflight.tsx` runs both ladders when it opens and reports the rung each reached. Its two
probe strings are **not** asserted to hit any particular rung: if the authored cache drifts
away from them, the panel is meant to report a lower rung and say so. That is the correct
behaviour for a panel whose stated rule is that every line is a check computed now.

Measured: today's `PROBE_CHALLENGE` and `PROBE_QUESTION` appear verbatim in neither cache
artifact, so **both surfaces resolve at rung 4, source `local`** — not `cache`. Two written
claims were therefore false and shipped: the component's own header comment ("reads `cache`
for every surface") and the plan's "Done when" bullet ("reports every surface on cache").

The renderer was worse than the comments. `surfaceLine` had two branches — `live`, and
everything else printed as *"answered from the bundled cache (rung N, source S)"* — so the
built artifact showed:

```
Challenge interpreter: answered from the bundled cache (rung 4, source local),
so losing the connection changes nothing.
```

A sentence contradicting itself inside its own parentheses, and on an exhausted ladder it
claimed a cache answer for a rung-5 `noMatch` — exactly what `resolve.ts` refuses to do
("nothing answered, so nothing may be reported as having answered").

**Fixed by reporting the rung actually reached, one branch per `Source`, not by pinning the
probes.** Pinning them would make one sentence accidentally true today and leave the
renderer free to lie the moment the cache drifts. This is the §5.4 defect — a caption that
reads identically whether or not it is true — recurring in the same component it had already
been rewritten out of once. **Expect it to try again.**

### 10.4 `services/api` has no HTTP server, so rung 1 has never run against a real model

`services/api/` contains two exported handler functions, `handleInterpret` and
`handleNavigate`, plus `completeFromEnv`. It contains **no server**: no `listen`, no route
mounting, no start script, and `package.json` declares no `scripts` block at all. Nothing
deploys it.

So the live rung is exercised by exactly two things, and neither involves a model: the
handler tests, which inject a fake `Complete`, and `apps/web/test/rung1.test.ts`, which stubs
`fetch`. **The path from a real browser through a real HTTP server to a real model has never
executed.** That is the residual risk spec §15 names — "a Railway deploy landing late is the
first real test of code written weeks earlier" — stated as a fact rather than a risk.

It is survivable by design: rung 1 is one optional rung, the demo path does not depend on
it, and the submitted ZIP compiles it out entirely. Do not let that make it invisible.

### 10.5 The plan's own test was unsatisfiable (Task 5)

The Task 5 brief's Step 3 test clicked the Apply button **without arming it**, while its own
sibling test required that button to be natively disabled when unarmed and its own Step 5
reference implementation used `disabled={!armed}`. The brief's reference implementation would
have failed the brief's own test: unsatisfiable by **any** implementation honouring "a
low-confidence reading never arrives pre-armed". Fixed by arming the checkbox before the
click, exactly as a reviewer confirming a guess would. Every downstream assertion unchanged.

This is §5.2 and §5.4 again — the plan is not the authority, measurement is — and it is the
third recorded instance of a plan-supplied test that a correct implementation would fail.

### 10.6 Two adjudications about reports that cited things that did not exist

Recorded because the *handling* is the reusable part, not the incidents.

- **Task 7.** The task report claimed the brief "explicitly lists `parseAnchor` as an import
  target". It does not — `parseAnchor` appears nowhere in that brief. **The citation was
  fabricated.** The engineering decision it defended was independently sound, so the ruling
  was *no code change*: the defect was in a gitignored scratch report, not in shipped code.
  Its real risk was that it undermined the report's **other** unverifiable self-audits — so
  the controller verified the load-bearing one directly instead of trusting it, by corrupting
  `anchor-map.json` to name a nonexistent anchor and re-running. Five tests failed, a
  **stronger** guard than the report had claimed.
- **Task 10.** The report claimed "the e2e run confirms this" for the zero-network guarantee,
  citing a test that never opens the pre-flight panel. The guarantee was real; the citation
  was overstated. That overstatement is the same gap §10.2 later measured.

**The pattern: an unverifiable claim in a report is not a small thing even when the code is
right, because it spends credibility the report's other claims are drawing on.** Verify the
load-bearing one directly.

### 10.7 The final whole-branch review — eight findings, all fixed

Ran on 2026-07-29 against all fourteen commits at once. Every one of these was invisible to
per-task review by construction: each needed either two tasks' output side by side, or a file
that was off-limits while the tasks ran, or a deliberate ablation to expose.

| # | finding | fix |
|---|---|---|
| C1 | The pre-flight honesty panel shipped a self-contradicting sentence (§10.3) | One branch per `Source`; header claim retired |
| C2 | The applied delta measured *registered → now*, so it credited the interpreter with the reviewer's own earlier edits | Snapshot the pre-apply reasoning at apply time; **spec §5.5 corrected** |
| I1 | The zero-network guarantee could not fail (§10.2) | Console-error listener; panel opened; verified by ablation |
| I2 | `useLibraryVerdicts` error containment was untested — the test reimplemented the guarantee inline and asserted `typeof … === "function"` | Real hook test with a claim that throws when read; verified by replacing the `catch` with `throw e` |
| I3 | "leaves the baselines table untouched" was a self-comparison with no action between the two reads | Content derived from `metrics.json`, asserted across a real press; verified by blanking the table |
| I4 | Navigator rung 1 bypassed `sanitizeNavResult`, so an all-stale live response stopped the ladder at rung 1 with an empty result strip labelled "rung 1 · live" — and dropped the dedupe and the 3-anchor cap | Route rung 1 through the same sanitiser every other rung uses |
| I6 | Spec §5.3's `measuresKeyEvent` constraint was unimplemented | Legal ids derived from the loaded evidence; an invented id is a rung miss |
| I7 | The entire finding record was gitignored | This section |

**C2 is the one to understand, because the spec was at fault rather than the implementer.**
Spec §5.5 specified the delta as *registered baseline* against *now*. Measured: drag the R1
slider to 0.45 (which the demo does), then apply the R5 challenge, and the panel reported
"Applied — the position moved", belief 0.090 → 0.495, and **suppressed** the explanation —
when R5 is inert on TAK-994 and every unit of that movement came from the slider. Applied the
other way round, an R1 challenge followed by the cytotox reclassify reported belief
0.090 → 0.000, reading as though cytotox had zeroed it. Every existing test applied exactly
one proposal from a clean store, where the two intervals coincide, which is why it survived.

**Three of the eight (I1, I2, I3) were tests that could not fail.** That is §5.1's list
recurring, and the countermeasure is the one §5.1 already gives: for each of those, the fix
was verified by **injecting the defect it guards against** and watching it fail. Do that.

### 10.8 Deferred findings — real, minor, and still open

None is load-bearing. All are honest to fix if you are in the file.

1. `anchors.ts`'s docstring claims `compound-row` needs a per-instance anchor; no such
   constructor exists (only the collective `compounds.table`). Inherited from the brief.
2. `ReclassifiableField` is declared **twice**, in `ai/interpret.ts` and `state/store.tsx`.
   Both derive from `keyof AssayOperator["produces"]` so there is no type risk, but it
   duplicates a single-source-of-truth concept with no import between the modules.
   `interpret.ts` should import it from the store.
3. `interpret.ts`'s drift-guard comment cites `schema.ts:87-102` for the mutually-assignable
   idiom; the real idiom is at `schema.ts:262-267`. Every other citation in that file checked
   out.
4. `store.test.ts`'s `@ts-expect-error` block ends in a runtime `toHaveLength(4)` that is
   vacuous — the real gate is `npm run typecheck`, not `npm test`. Brief-specified pattern,
   documented rather than silently changed.
5. `navigate.test.ts`'s `NavResultSchema` test is **named** for the prose-rejection case but
   carries no extra-key assertion. Pre-existing; `rung1.test.ts` covers the behaviour.
6. `trigram.test.ts`'s empty-challenge test title claims "every cached entry" and exercises
   two cases.
7. The `NavigatorBar` placeholder does not hint the Backspace-to-dismiss gesture.
8. `submit()` calls `setApplied(null)` beyond the brief's reference implementation — sensible
   (it clears a stale applied panel on resubmit), untested either way.
9. Task 3's polarity experiment (rewiring `useLibraryVerdicts` and observing
   `expected advance to be abstain`) was reverted, so it leaves no artifact: credible but
   unverifiable from the diff.
10. Task 1's report gave per-file line counts that were asserted rather than measured and are
    all wrong. Its meaningful counts (31 tests) are correct.

Two more were promoted to findings and fixed above (§10.2, §10.3).

**One thing worth knowing before you "verify" a hash:** the `ed073a8a…` constant is a
**canonical-JSON** digest computed by `apps/harness/src/preregistration.ts`, not a raw-byte
`sha256sum` of the file. Running `sha256sum rules/ruleset-v1.0.json` produces a different
number and does not mean the ruleset has drifted.
