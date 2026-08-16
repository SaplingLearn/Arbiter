# ARBITER

**Reasoning through conflicting preclinical toxicity evidence - transparently, with the human experts still making the decision.**

Pfizer Digital & Technology Hackathon 2026 · Problem Statement 3, Computational Pre-Clinical Drug Development
Team BU 1 - Jack He, Andres Lopez, Jose Cruz-Lopez

---

## The problem

A preclinical safety lead deciding whether a compound advances is rarely short of predictions. They are short of a defensible way to reconcile the ones that disagree.

A QSAR model says the structure looks hepatotoxic. A cytotoxicity assay says the cells survived. A transporter assay says bile-salt export is inhibited. A rodent study says nothing happened. These are not four opinions of equal standing - some measure a mechanism, some only correlate with structure; some were run at clinically relevant exposure, some were not. Today that reconciliation happens in a scientist's head and in a meeting, and the reasoning that produced the answer is not recoverable six months later when a regulator, or a colleague, asks why.

## What ARBITER is

> We help preclinical safety leads reason through conflicting toxicity evidence so they can make consistent, defensible go or no-go decisions.

ARBITER takes the conflicting evidence for a compound and produces a **position** - advance, do not advance, or abstain - together with the argument that led there, the evidence that would change it, and a hash-chained audit log of who signed off.

**The differentiator:** everyone else builds tools to *predict* toxicity. ARBITER reasons through the conflicts *between* those predictions. It is not another predictor. It is the layer that adjudicates - and the human signs.

It is deliberately **an internal capability, not a product to sell.** Its value is avoided cost, more consistent decisions, and a stronger evidentiary position - not licensing revenue.

### What is actually new

Not Dempster–Shafer fusion in toxicology (precedented - Park, Ogunseitan & Lejano 2014), not structured evidence integration (OECD IATA is exactly that doctrine), not read-across with inspectable justification (OECD QSAR Toolbox). The claim is narrower and survives contact with someone who knows the literature:

- **The assembly does not exist as usable software a safety lead can operate and contest** - rules a scientist owns and edits live, a signed tamper-evident record, determinism enforced by the build.
- **The experiment planner is driven by argument structure, not generic assay informativeness.** It does not ask "which assay is usually informative?" It asks *"which rule is doing the defeating, and what evidence would overturn that specific rule?"*
- **The as-of-date prospective replay** as a validation design - testing the system on a historical case using only the evidence that existed at the decision point.

---

## How it works

Three pieces in one repo, and it matters which one is current. The engine is kept; the
deliberation app is the product; the seven-tab web app is its predecessor.

### 1. A pure reasoning engine (`packages/engine`)

Dempster–Shafer belief fusion plus defeasible argumentation over six **pre-registered** rules. No clock, no randomness, no I/O - lint forbids `Date`, `Math.random`, `node:*`, `fs`, `crypto`, dynamic imports and parent imports anywhere in `src`. Deterministic to a single hash across 1000 runs.

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

### 2. The deliberation client (`apps/deliberation`)

**This is where the work happens, and where new work goes.** Four case stages, in a
fixed order, because the order is the point:

| Stage | What it is for |
|---|---|
| **Evidence** | The compound in front of you: findings, documents, what is absent |
| **Your position** | Your call, written **before** you can see anyone else's |
| **Reveal & verdict** | Unreachable until everyone has answered. Then the split, the disagreement analysis, and the AI adjudication |
| **Record** | Sign-off and the hash-chained audit log |

Blind submission is enforced server-side by not returning the data, not by asking the
client to hide it - reading someone else's call before writing your own is the exact
failure the sequence exists to prevent. The decider is an AI adjudicator behind
`services/api`, disclosing a position on every rule; the engine measures it rather
than being it. See `docs/superpowers/specs/2026-08-09-arbiter-ai-redesign-design.md`.

A multi-user client for `services/api`, and the product surface. Its point is that **each reviewer answers privately before anyone sees anyone else's answer**, so a room produces independent readings rather than one confident one.

| Route | What it is for |
|---|---|
| `/dashboard` | Cases you own or sit on |
| `/library` | The case library |
| `/case/:id` | The case: roster, documents, findings, inventory |
| `/case/:id/position` | Your blind position - recorded before the reveal |
| `/case/:id/reveal` | Every position at once, and where the room split |
| `/case/:id/record` | The signed, hash-chained, tamper-checked audit log |
| `/ask` | Retrieval-backed Q&A over the case's uploaded documents |
| `/method` | What the system does and does not claim |

Plus `apps/landing` (the public entry page), `apps/harness` (benchmark runner, Node only), `services/api` (auth, documents, retrieval, adjudication), and `data/prep` (Python ingestion of DILIrank, splits, QSAR/Tox21 streams).

> The original single-user artifact, `apps/web` - a seven-tab app that ran the engine in the browser and shipped as one self-contained `index.html` - was **deleted on 2026-08-14**. The deliberation client supersedes it. Its history is in the git log.

---

## The result, stated honestly

> **SUPERSEDED 2026-08-09.** The table below was measured against a target that
> counted **aspirin, amoxicillin, atenolol and amlodipine as hepatotoxic** - 62% of
> its positive class was DILIrank's *Less*-concern grade. Under that definition a
> system correctly declining to flag amlodipine scores as wrong.
>
> Re-graded against a corrected target (`rules/ruleset-v2.0.json`), **ARBITER scores
> 0.500 with confusion `tp 2 / fp 5`** - five of its seven commitments are approved,
> widely prescribed drugs - **and no baseline clears 0.601.** The 0.750 below is
> sensitivity 1.0 averaged with a 0.5 *convention* for a specificity that was never
> measured, on n=4.
>
> **Do not quote the table below.** See **HANDOVER §13**, `tools/rescore_v2.py`, and
> `docs/superpowers/specs/2026-08-09-arbiter-ai-redesign-design.md`. It is kept
> unedited because it is what was believed on 2026-08-06.

**Read this before quoting any number. Do not restate the headline as an accuracy.**

Measured on the test split only - train fitted the QSAR model, calibration set the conformal threshold, and scoring either would be leakage. 267 compounds scored, 61 in the pre-registered conflict subset.

| pipeline | balanced accuracy | coverage | n committed | confusion (tp/fp/tn/fn) | single-class |
|---|---|---|---|---|---|
| **ARBITER** | 0.750 | **6.6%** | **4** | 4/0/0/0 | **yes** |
| `single:transporter` | 0.750 | **6.6%** | **4** | 4/0/0/0 | yes |
| `majorityVote` | 0.750 | 4.9% | 3 | 3/0/0/0 | yes |
| `weightedAverage` | 0.547 | 100% | 61 | 51/5/1/4 | no |
| `single:qsar` | 0.500 | 98.4% | 60 | 54/6/0/0 | no |

### ARBITER does not beat the best baseline. It ties a single stream, exactly.

`single:transporter` matches it on every column. **Say so** - an earlier draft omitted this and it was corrected as a flattering omission.

**And then say why, because the reason is measurable and better than the bare fact: both pipelines are scoring the same four compounds.** There are only 4 transporter claims in the entire scored split, and ARBITER's four commitments are exactly those four compounds - identical sets, not an approximate overlap. An exact tie between two pipelines evaluated on the same four compounds is close to expected, not a coincidence.

### Coverage is the finding

ARBITER abstains on **260 of 267 compounds (97.4%)**. Every abstention is the belief–plausibility gap rule; none is applicability-domain and none is total conflict. Three measured causes, not one:

| # | cause | measured |
|---|---|---|
| 1 | **No exposure-relevant evidence.** R3 discounts a negative result tested outside the clinically relevant range to 15% of stated confidence. | 118 claims |
| 2 | **QSAR measures no key event.** Structure correlation alone is discounted to 6%, or 1% where it carries least. | 107 claims |
| 3 | **The corpus is thin.** 140 of 267 compounds carry exactly one claim. | 52.4% single-claim |

Stream coverage on the scored split makes it concrete - qsar covers 267 compounds (100%), cytotox 127 (47.6%), transporter 4 (1.5%). That resolves into three groups: **140 compounds hold qsar only**, 123 hold cytotox+qsar, and 4 hold all three. **ARBITER adjudicates between sources, and 140 compounds have one.** The engine is being asked to do its job where its job does not exist.

Sharpest form of the result: for **254 of the 260 declines**, restating every live claim at full confidence 1.0 still cannot reach the mass the threshold demands. The gap rule fires *before the engine reads a single evidence value.*

### The number that is unambiguously good

**Planner recommendation unchanged under ±50% perturbation of every expert-elicited prior: 0.992** (2000 samples/compound, seed 20260726, 61 compounds). It holds because the planner sorts on argument structure first and score second. This is the robustness claim worth leading with.

### If you read only one thing

The result is **honest and defensible, but it is not a win over the baseline.** The temptation will be to fix that by moving a number - and `abstentionGapThreshold` is pre-registered precisely so it cannot be moved after an abstention rate has been seen. Measured, moving it from 0.50 to 0.80 buys six compounds. **What would fix this is data, not rules.**

Lead with the things that are actually true: a pre-registered hashed ruleset, a deterministic engine, golden-file CI that catches a moved number, a planner that survives ±50% prior perturbation 99.2% of the time, and an audit trail whose tamper-evidence has been tested rather than asserted.

---

## Three things you must not do

Not style preferences. Each protects a claim the submission makes.

1. **Never edit `rules/ruleset-v1.0.json`.** It is pre-registered and hashed. If a rule looks wrong, re-read its registered statement first - twice during development a rule looked broken and was in fact correct. A genuine error is a deliberate **v1.1 re-registration** with a new hash and a written reason, not an edit.
2. **The engine stays pure.** No clock, no randomness, no I/O in `packages/engine/src`. Lint enforces every case. A clock or a random number breaks determinism, which is what lets golden-file CI catch a moved number at all.
3. **Language discipline** - in code, comments, UI copy, commit messages, and anything a judge reads:

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
npm run dev                # http://localhost:5173
```

One command, one origin. The landing page is at `/`, the product at `/deliberation/`, the API at `/api`. `ARBITER_PORT=4173 npm run dev` moves the whole group if something already holds 5173.

That is the whole setup. `ARBITER_DEMO_SEED=1` is set in the tracked `.env.defaults`, so the first boot creates the five demonstration accounts and opens the four usable library cases for them. You get the same product everybody else on the repository gets, with something in it.

The demo team is five accounts whose shared password is printed in `services/api/seed-demo.ts`, because the fixture is the secrecy, not the check. `npm run seed:demo` does the accounts alone if you would rather be explicit. Both paths are guarded on an EMPTY store - accounts into an empty account store, cases into an empty case store - so neither can appear beside real data and neither resurrects something you deleted on purpose. The banner prints what it created, so a forgotten demo team is visible rather than silent.

**The case content was always in git** - `data/cases/*.json`, `data/out/tak994.json`, `data/probe-case.json`. What a fresh clone lacked was any case *open*: the store starts empty and cases are created by clicking through the library picker, so a developer who pulled the repository and ran it saw an empty product and reasonably concluded the data had not been shared. It had; nothing had opened it. The seed closes that and only that - it adds no evidence and invents no case, and it will not open the two refused documents, because a refusal you can route around is decorative.

### Configuration

Three files are read, in order, and they layer **by name** rather than by file:

| file | tracked? | what belongs in it |
|---|---|---|
| `.env` | no | your own credentials and overrides |
| `.env.share` | no | a configuration handed to you, working where it lands - no rename step to forget |
| `.env.defaults` | **yes** | what the team has agreed on and that is not secret: which models, and the boot seed |

Each file sets only the names still unset, so a `.env` holding nothing but your own API key overrides that one name and inherits the shared models. Whole-file precedence would have silently dropped them, and two developers getting different answers from what they both believe is one configuration is exactly what the tracked file exists to prevent. A blank value (`ARBITER_MODEL=`) counts as unset and falls through to the code default. The real environment - a shell export, a CI secret - still beats all three. The banner lists every file it read.

**No credential is in `.env.defaults` and none may be added.** This repository is public: a key committed there is world-readable, is harvested by scanners within minutes, and survives deletion in the history and in every clone taken meanwhile. To use live AI, put a key in `.env` or `.env.share`; see section 4 of `.env.defaults` for the three ways.

### It runs with no credentials, and says so

There is nothing to obtain and nothing to paste. `cp .env.example .env` if you want to
configure anything; an empty file, or no file, is a valid configuration.

| | Without credentials |
|---|---|
| Cases, positions, blind reveal, unanimity, audit, the hash-chained record | Work. Pure code, no model. |
| Adjudication | Runs against a stub. Every response carries `source: "stub"`, so it can never be read as a model's answer. |
| Ask & summary | `503 {"error":"no_key"}`. The only surfaces that genuinely need a model. |

The startup banner names which of the two you are in.

**For live AI, pick one provider.** It is inferred from the model name, so there is no
second switch to disagree with it:

```bash
ANTHROPIC_API_KEY=sk-ant-...  ARBITER_MODEL=claude-sonnet-5   # a key, and nothing else
ARBITER_GCP_PROJECT=your-project                              # Gemini on ADC
GEMINI_API_KEY=AQ....                                         # Gemini on a key
```

**On Gemini, choose by who is running it.** Application Default Credentials
(`gcloud auth application-default login` against your own project) authenticate a
*person*, so nothing secret belongs in `.env` - and equally, nothing can be handed to a
teammate. `GEMINI_API_KEY` is the shareable form: one line, sufficient on its own, and
still a cloud credential that bills the project it belongs to.

A key also picks a **host**, and the two are not interchangeable:
`ARBITER_GEMINI_HOST=vertex` (the default, `aiplatform.googleapis.com`, the catalogue
every committed number was measured on) or `=developer`
(`generativelanguage.googleapis.com`, no project setup, a different and smaller
catalogue - `gemini-2.5-flash-lite` is a 404 there). The startup banner prints which one
is in use, so a misconfiguration cannot hide behind the word "Vertex".

One key shared across a team is one budget shared across a team. See
`ARBITER_MODEL_BUDGET` below.

### Deploying it

The code is deployable; the hosting decision is not made here.

- **`ARBITER_HOST=0.0.0.0`** to accept outside traffic. It is loopback otherwise, because
  this process terminates no TLS - set it only behind a proxy that does. The banner warns
  when it is not loopback.
- **`ARBITER_MODEL_BUDGET`** (default 30 per account per 10 minutes, 6x that per source)
  caps the four endpoints that cost money. This is what makes them safe to expose: without
  it, a public deployment is an open proxy to whoever's model quota it holds.
- **On Google Cloud, attach a service account** rather than shipping a key. The auth
  library finds it as ADC, so no key material exists on disk, in git, or in an env var.
  Off Google Cloud, `GOOGLE_APPLICATION_CREDENTIALS_JSON` takes the JSON as a secret.
- **State is local files** - `results/deliberation-log.jsonl` (the record itself),
  `results/documents/`, and the account store. On an ephemeral container all three are
  wiped on redeploy. Fine for a demo; if the record must persist, it needs a volume, and
  that is the largest single piece of work in deploying this.

### Verify everything

```bash
npm run lint && npm run typecheck && npm test
npm run landing:build && npm run deliberate:build && npm run e2e
npm run golden:update && git diff --exit-code results/   # must produce NO diff
```

CI runs all of it on every push. The whole block was executed on 2026-08-14, after `apps/web` was deleted:

| | |
|---|---|
| Lint / typecheck / both builds | clean |
| Vitest | **716 tests across 48 files** - was 1077 across 89 before the deletion |
| Playwright | **5 tests** - the one-origin arrangement, incl. the no-WebGL guard |
| Pytest (`data/prep`) | **32 tests across 4 files** - run separately, see below |
| `golden:update` | **no diff - no reported number has moved** |
| Ruleset hash | `ed073a8a…` matches pre-registration |

**On Windows, `golden:update` will make the golden file look modified when it is not** - the script writes LF, git's `autocrlf` rewrites to CRLF, and `git status` reports a modification with an empty `git diff`. Confirm it is nothing before hunting:

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

**These tests do not run in CI**, so that figure is a hand measurement, not a guarded one. `test_qsar_leakage.py` protects the strongest methodological claim in the project - that the split was fixed before any model was fitted, which is the condition under which every reported number is valid at all. A leak reintroduced into `data/prep/` today would be caught by nothing automatic. **Run this suite by hand after any change under `data/prep/`.**

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

apps/deliberation/        THE PRODUCT. Four stages, real backend, AI decider.
  src/Layout.tsx          Steps() - the four stages. The order IS the product.
  src/router.ts           Route union; reveal is gated on the server, not here.
  src/screens.tsx         Position, reveal, verdict, audit - the working screens
  src/pages.tsx           Auth, dashboard, case creation, method

services/api/             The backend. Accounts, cases, adjudication. Node only.
  server.ts               Routes. /api/auth/* is the only unauthenticated surface.
  adjudicate.ts           ADJUDICATOR_PROMPT_PATH - the in-force prompt version
  deliberation.ts         Blind submission + unanimity. Read the contracts.
  gemini.ts               Vertex AI. Falls back to a labelled stub without creds.

apps/landing/             The public entry page, and the one-origin front door.
  vite.config.ts          server.proxy mounts /deliberation and /api behind it
  src/overture/           The six-chapter WebGL overture. One canvas, six scenes.
  src/overture/registry.ts  The chapters. Same list the rail renders from.
  src/shell/              HUD chrome: rail, preloader, menu, cursor, controls.

packages/design/          The design system both frontends dress in.

apps/atmosphere/          Scene R&D. Standalone, not wired into the product.
  src/core/palette.ts     ALL colour. Deep goes violet, emissive goes cyan.
  src/core/Atmosphere.ts  Renderer, render targets, the tear between scenes.

tools/dev-all.mjs         `npm run dev`: every surface behind one port
e2e/                      Playwright. Drives the unified server, not one app.

data/prep/*.py            DILIrank ingestion, splits, QSAR/Tox21 streams
rules/ruleset-v1.0.json   PRE-REGISTERED AND HASHED. Do not edit.
results/                  metrics.json, golden/, verdict-manifest.json (golden-filed)
docs/superpowers/         Specs and task-by-task plans. The 2026-08-09 AI redesign
                          spec is IN FORCE; every earlier doc carries a banner
                          saying what superseded it. The plans are all
                          already executed - history, not a queue.
```

---

## Where to read next

**[`HANDOVER.md`](HANDOVER.md) is the authority** - what exists, what the result actually is, what is left, and what you must not touch. Start at §0 and read through §3. §9 is the one-paragraph version. §10 and §11 carry the phase-3 and multi-case records that would otherwise have died in a gitignored ledger.

Then, in order:

1. `docs/superpowers/specs/2026-07-26-arbiter-design.md` - the master spec. **§8 is the honest results section; read it before quoting any number.**
2. `docs/superpowers/specs/2026-07-27-arbiter-phase2-web-app-design.md` - the web app, including §9/§9a on the static build and legibility.
3. `docs/superpowers/plans/` - task-by-task plans, each recording what was measured and what went wrong.

Note that `.superpowers/` is gitignored, so the SDD ledger and per-task review reports did not reach you. If a commit message refers to "the ledger" or "task-N-report.md", that is why you cannot open it. Nothing load-bearing was lost - the conclusions were copied into HANDOVER §10 and §11 - but if a decision's rationale trail stops, it stopped there.

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
| Engine | Complete; deterministic; ruleset hash `ed073a8a…` unchanged. **Kept as the instrument, no longer the decider** (redesign §2) |
| Deliberation app | **The product.** Four stages, real accounts, blind submission, AI adjudication behind `services/api` |
| Web app (`apps/web`) | Predecessor. Seven tabs, eight demo beats, two hero cases; ships as one self-contained `index.html`. Kept working, closed to new surface |
| Phases | 1 complete · 2 complete · 3 built except Surface 2 (specified, deliberately not built) · multi-case complete |
| Intake | Custom compounds - validation, advisor, and form built; CSV upload and AI extraction not (HANDOVER §12) |
| Ablation | Aggregation, prompt and resume built and tested; no live run - needs a key and a provider decision |
| Verified | 2026-08-06 - lint, typecheck, build, 623 vitest, 12 Playwright, 32 pytest, golden all green (HANDOVER §8.3) |
| Open | LLM ablation specified but unimplemented; hero case 3 specified but not built; Cmax data is the constraint on the headline |

Submission due 16 August 2026.
