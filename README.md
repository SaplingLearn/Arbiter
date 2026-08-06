# ARBITER

**Reasoning through conflicting preclinical toxicity evidence — transparently, with the human experts still making the decision.**

Pfizer Digital & Technology Hackathon 2026 · Problem Statement 3, Computational Pre-Clinical Drug Development
Team BU 1 — Jack He, Andres Lopez, Jose Cruz-Lopez

---

## The problem

A preclinical safety lead deciding whether a compound advances is rarely short of predictions. They are short of a defensible way to reconcile the ones that disagree.

A QSAR model says the structure looks hepatotoxic. A cytotoxicity assay says the cells survived. A transporter assay says bile-salt export is inhibited. A rodent study says nothing happened. These are not four opinions of equal standing — some measure a mechanism, some only correlate with structure; some were run at clinically relevant exposure, some were not. Today that reconciliation happens in a scientist's head and in a meeting, and the reasoning that produced the answer is not recoverable six months later when a regulator, or a colleague, asks why.

## What ARBITER is

> We help preclinical safety leads reason through conflicting toxicity evidence so they can make consistent, defensible go or no-go decisions.

ARBITER takes the conflicting evidence for a compound and produces a **position** — advance, do not advance, or abstain — together with the argument that led there, the evidence that would change it, and a hash-chained audit log of who signed off.

**The differentiator:** everyone else builds tools to *predict* toxicity. ARBITER reasons through the conflicts *between* those predictions. It is not another predictor. It is the layer that adjudicates — and the human signs.

It is deliberately **an internal capability, not a product to sell.** Its value is avoided cost, more consistent decisions, and a stronger evidentiary position — not licensing revenue.

### What is actually new

Not Dempster–Shafer fusion in toxicology (precedented — Park, Ogunseitan & Lejano 2014), not structured evidence integration (OECD IATA is exactly that doctrine), not read-across with inspectable justification (OECD QSAR Toolbox). The claim is narrower and survives contact with someone who knows the literature:

- **The assembly does not exist as usable software a safety lead can operate and contest** — rules a scientist owns and edits live, a signed tamper-evident record, determinism enforced by the build.
- **The experiment planner is driven by argument structure, not generic assay informativeness.** It does not ask "which assay is usually informative?" It asks *"which rule is doing the defeating, and what evidence would overturn that specific rule?"*
- **The as-of-date prospective replay** as a validation design — testing the system on a historical case using only the evidence that existed at the decision point.

---

## How it works

Two pieces in one repo.

### 1. A pure reasoning engine (`packages/engine`)

Dempster–Shafer belief fusion plus defeasible argumentation over six **pre-registered** rules. No clock, no randomness, no I/O — lint forbids `Date`, `Math.random`, `node:*`, `fs`, `crypto`, dynamic imports and parent imports anywhere in `src`. Deterministic to a single hash across 1000 runs.

| Rule | Name | Statement |
|---|---|---|
| **R1** | Human relevance | Human-cell evidence defeats animal in vivo evidence when the question is human hepatotoxicity. |
| **R2** | Mechanistic proximity | Evidence that directly measures an AOP key event defeats evidence that only correlates with chemical structure. |
| **R3** | Exposure relevance | A positive finding at clinically relevant exposure defeats a negative finding whose exposure margin is unstated or untested at that range. |
| **R4** | Applicability domain | Evidence from a model operating outside its applicability domain is admitted with reduced weight, or excluded. |
| **R5** | Study reliability | Higher-reliability studies defeat lower-reliability ones at equal mechanistic relevance. |
| **R6** | Concordance | Independent sources agreeing raises confidence more than one source agreeing with itself. |

Each rule works twice: as a **defeat rule** in the argumentation graph, and as an **evidence-quality discount** on the mass that reaches fusion. R2 cites the specific AOP key event it relies on, so mechanistic provenance sits on the rule rather than in a competing graph view.

The ruleset lives in `rules/ruleset-v1.0.json` and is hashed to `ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136`. **The harness refuses to run if the computed hash differs.** That is the whole methodological claim: no rule was tuned after seeing a result.

### 2. A six-tab web app (`apps/web`)

Runs that same engine **in the browser** and ships as one self-contained `index.html` that works over `file://`.

| Tab | What it is for |
|---|---|
| **Case** | The compound in front of you: evidence, the argument trace, the belief track, the position |
| **Compounds** | The library — every scored compound and its claims |
| **Ruleset** | The six rules, their registered statements, and live editing |
| **Validation** | The benchmark, the baselines, and the honesty warnings |
| **Record** | Positions, sign-off, and the hash-chained audit log |
| **About** | Framing, scope, and what the numbers do and do not say |

An **eight-beat guided demo** (`→`/`←` to step) walks two hero cases: **TAK-994**, where the engine abstains and says exactly what evidence would change that, and **Cyclosporine**, where it commits to *do not advance* with non-zero Dempster–Shafer conflict mass, driven by a `transporter:toxic` claim — cyclosporine's real hepatotoxicity is BSEP-mediated, so the engine is right for the right reason.

Plus `apps/harness` (benchmark runner, Node only), `services/api` (rung-1 AI surface handlers), and `data/prep` (Python ingestion of DILIrank, splits, QSAR/Tox21 streams).

---

## The result, stated honestly

**Read this before quoting any number. Do not restate the headline as an accuracy.**

Measured on the test split only — train fitted the QSAR model, calibration set the conformal threshold, and scoring either would be leakage. 267 compounds scored, 61 in the pre-registered conflict subset.

| pipeline | balanced accuracy | coverage | n committed | confusion (tp/fp/tn/fn) | single-class |
|---|---|---|---|---|---|
| **ARBITER** | 0.750 | **6.6%** | **4** | 4/0/0/0 | **yes** |
| `single:transporter` | 0.750 | **6.6%** | **4** | 4/0/0/0 | yes |
| `majorityVote` | 0.750 | 4.9% | 3 | 3/0/0/0 | yes |
| `weightedAverage` | 0.547 | 100% | 61 | 51/5/1/4 | no |
| `single:qsar` | 0.500 | 98.4% | 60 | 54/6/0/0 | no |

### ARBITER does not beat the best baseline. It ties a single stream, exactly.

`single:transporter` matches it on every column. **Say so** — an earlier draft omitted this and it was corrected as a flattering omission.

**And then say why, because the reason is measurable and better than the bare fact: both pipelines are scoring the same four compounds.** There are only 4 transporter claims in the entire scored split, and ARBITER's four commitments are exactly those four compounds — identical sets, not an approximate overlap. An exact tie between two pipelines evaluated on the same four compounds is close to expected, not a coincidence.

### Coverage is the finding

ARBITER abstains on **260 of 267 compounds (97.4%)**. Every abstention is the belief–plausibility gap rule; none is applicability-domain and none is total conflict. Three measured causes, not one:

| # | cause | measured |
|---|---|---|
| 1 | **No exposure-relevant evidence.** R3 discounts a negative result tested outside the clinically relevant range to 15% of stated confidence. | 118 claims |
| 2 | **QSAR measures no key event.** Structure correlation alone is discounted to 6%, or 1% where it carries least. | 107 claims |
| 3 | **The corpus is thin.** 140 of 267 compounds carry exactly one claim. | 52.4% single-claim |

Stream coverage on the scored split makes it concrete — qsar covers 267 compounds (100%), cytotox 127 (47.6%), transporter 4 (1.5%). That resolves into three groups: **140 compounds hold qsar only**, 123 hold cytotox+qsar, and 4 hold all three. **ARBITER adjudicates between sources, and 140 compounds have one.** The engine is being asked to do its job where its job does not exist.

Sharpest form of the result: for **254 of the 260 declines**, restating every live claim at full confidence 1.0 still cannot reach the mass the threshold demands. The gap rule fires *before the engine reads a single evidence value.*

### The number that is unambiguously good

**Planner recommendation unchanged under ±50% perturbation of every expert-elicited prior: 0.992** (2000 samples/compound, seed 20260726, 61 compounds). It holds because the planner sorts on argument structure first and score second. This is the robustness claim worth leading with.

### If you read only one thing

The result is **honest and defensible, but it is not a win over the baseline.** The temptation will be to fix that by moving a number — and `abstentionGapThreshold` is pre-registered precisely so it cannot be moved after an abstention rate has been seen. Measured, moving it from 0.50 to 0.80 buys six compounds. **What would fix this is data, not rules.**

Lead with the things that are actually true: a pre-registered hashed ruleset, a deterministic engine, golden-file CI that catches a moved number, a planner that survives ±50% prior perturbation 99.2% of the time, and an audit trail whose tamper-evidence has been tested rather than asserted.

---

## Three things you must not do

Not style preferences. Each protects a claim the submission makes.

1. **Never edit `rules/ruleset-v1.0.json`.** It is pre-registered and hashed. If a rule looks wrong, re-read its registered statement first — twice during development a rule looked broken and was in fact correct. A genuine error is a deliberate **v1.1 re-registration** with a new hash and a written reason, not an edit.
2. **The engine stays pure.** No clock, no randomness, no I/O in `packages/engine/src`. Lint enforces every case. A clock or a random number breaks determinism, which is what lets golden-file CI catch a moved number at all.
3. **Language discipline** — in code, comments, UI copy, commit messages, and anything a judge reads:

| Write this | Never this |
|---|---|
| review-ready evidence package | regulator-ready dossier |
| consistent, defensible | fast |
| ARBITER's position | ARBITER's decision |
| the committee decides | the system decides |
| positions / sign-off / decision owner | voting / tally / majority |
| hash-chained audit log | blockchain |

The left column is defensible; the right overclaims regulatory standing we do not have.

---

## Run it

```bash
npm ci
npm run web:dev            # http://localhost:5173
```

Keys: `→`/`←` step the eight demo beats, `M` motion kill switch, `?` pre-flight panel, `Esc` clear focus.

### Verify everything

```bash
npm run lint && npm run typecheck && npm test
npm run web:build && npm run e2e
npm run golden:update && git diff --exit-code results/   # must produce NO diff
```

CI runs all of it on every push. The whole block was executed on 2026-08-06 from `cde62f5`:

| | |
|---|---|
| Lint / typecheck / `web:build` | clean |
| Vitest | **552 tests across 55 files** |
| Playwright | **12 tests** |
| Pytest (`data/prep`) | **32 tests across 4 files** — run separately, see below |
| `golden:update` | **no diff — no reported number has moved** |
| Bundle | **1,152 kB raw / 199 kB gzipped**, one self-contained file |
| Ruleset hash | `ed073a8a…` matches pre-registration |

**On Windows, `golden:update` will make the golden file look modified when it is not** — the script writes LF, git's `autocrlf` rewrites to CRLF, and `git status` reports a modification with an empty `git diff`. Confirm it is nothing before hunting:

```bash
git show HEAD:results/golden/metrics.golden.json | sha256sum
sha256sum results/golden/metrics.golden.json    # identical => nothing moved
git checkout -- results/golden/metrics.golden.json
```

Called out because *"did one of my numbers move?"* is the most alarming question in this project, `golden:update` exists to answer it, and a false yes from a line ending wastes exactly the time that guard was built to save. CI runs on Linux and never sees this.

### The Python half, which npm does not touch

Needed for anything touching the data layer.

```bash
python -m venv .venv && . .venv/Scripts/activate     # or bin/activate outside Windows
pip install -r data/prep/requirements.txt
cd data/prep && python -m pytest
```

32 tests across 4 files, passing as of 2026-08-06 on Python 3.12.4 from a fresh venv with the pinned `requirements.txt`. `data/prep/README.md` documents the pipeline order. `rdkit` is the heavy dependency and the one most likely to fight a fresh environment, though it installed clean here.

**These tests do not run in CI**, so that figure is a hand measurement, not a guarded one. `test_qsar_leakage.py` protects the strongest methodological claim in the project — that the split was fixed before any model was fitted, which is the condition under which every reported number is valid at all. A leak reintroduced into `data/prep/` today would be caught by nothing automatic. **Run this suite by hand after any change under `data/prep/`.**

---

## Repo map

```
packages/engine/          Pure reasoning engine. Lint-enforced purity.
  src/index.ts            reason(), reasonVerdictOnly(), reasonCore()
  src/rules.ts            R1-R6, as defeat rules and evidence-quality discounts
  src/fuse.ts             Dempster-Shafer belief/plausibility/conflict mass
  src/argue.ts            Defeasible argumentation, grounded semantics, reinstatement
  src/counterfactual.ts   Exhaustive minimal-flip search
  src/plan.ts             Value-of-information planner (the 0.992 robustness number)

apps/harness/             Benchmark runner. Node only.
  src/preregistration.ts  THE pre-registration surface + canonicalisation. One copy.
  src/main.ts             Scores the test split, writes results/
  src/metrics.ts          The five metrics, with their honesty caveats in comments
  src/coverage-report.ts  The working behind the coverage finding

apps/web/                 Six-tab app. Engine runs in the BROWSER.
  src/data/heroCases.ts   TAK-994 and Cyclosporine, keyed by compoundId
  src/tour/beats.ts       The eight demo beats
  vite.config.ts          inlineEverything - read HANDOVER §6.1 before touching
  e2e/static-file.spec.ts The file:// guard. Do not delete.
  src/ui/Preflight.tsx    The ? panel: real checks, not captions

data/prep/*.py            DILIrank ingestion, splits, QSAR/Tox21 streams
rules/ruleset-v1.0.json   PRE-REGISTERED AND HASHED. Do not edit.
results/                  metrics.json, golden/, verdict-manifest.json (golden-filed)
docs/superpowers/         Specs and task-by-task plans
```

---

## Where to read next

**[`HANDOVER.md`](HANDOVER.md) is the authority** — what exists, what the result actually is, what is left, and what you must not touch. Start at §0 and read through §3. §9 is the one-paragraph version. §10 and §11 carry the phase-3 and multi-case records that would otherwise have died in a gitignored ledger.

Then, in order:

1. `docs/superpowers/specs/2026-07-26-arbiter-design.md` — the master spec. **§8 is the honest results section; read it before quoting any number.**
2. `docs/superpowers/specs/2026-07-27-arbiter-phase2-web-app-design.md` — the web app, including §9/§9a on the static build and legibility.
3. `docs/superpowers/plans/` — task-by-task plans, each recording what was measured and what went wrong.

Note that `.superpowers/` is gitignored, so the SDD ledger and per-task review reports did not reach you. If a commit message refers to "the ledger" or "task-N-report.md", that is why you cannot open it. Nothing load-bearing was lost — the conclusions were copied into HANDOVER §10 and §11 — but if a decision's rationale trail stops, it stopped there.

## How the work is done here

- **Scrutinise every new test for whether it CAN FAIL.** A test that passes against a broken implementation is worse than no test.
- **Reviews judge behaviour, not conformance to the plan.** The plan is not the authority; measurement is.
- **Every fix goes in both the source file and the plan's code block**, so the plan stays a true record.
- **Commit and push after every task. Not batched.**
- **Record what measured false**, not just what shipped. An unverified claim spends credibility even when the surrounding work is sound.

## Status

| | |
|---|---|
| Endpoint | Hepatotoxicity (DILI) only |
| Engine | Complete; deterministic; ruleset hash `ed073a8a…` unchanged |
| Web app | Six tabs, eight demo beats, two hero cases; ships as one self-contained `index.html` |
| Phases | 1 complete · 2 complete · 3 built except Surface 2 (specified, deliberately not built) · multi-case complete |
| Verified | 2026-08-06 — lint, typecheck, build, 552 vitest, 12 Playwright, 32 pytest, golden all green (HANDOVER §8.2) |
| Open | LLM ablation specified but unimplemented; hero case 3 specified but not built; Cmax data is the constraint on the headline |

Submission due 16 August 2026.
