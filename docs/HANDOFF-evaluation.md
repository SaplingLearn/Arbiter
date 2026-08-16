# Handoff — the evaluation work

Written 2026-08-16, mid-task, on branch `feat/product-in-the-atmosphere` (PR #22).
Everything in this document was verified against the repository on the day it was
written, not recalled. Where a number appears, the file it came from is named.

> **SUPERSEDED IN PART — read `docs/EVALUATION-SCOREBOARD.md` first.** §5's task, the
> `ask:eval` re-run, was completed and committed in `44754a6`, the same commit that wrote
> this document, so the prose below never caught up. `results/ask-eval.json` is the new
> 69-item run: `judgedCorrectRate` 71.7%, `refusalRate` 100% at n=16. **Do not re-run it** —
> it costs forty minutes and real money to reproduce a number already on disk. §0 item 2,
> §4 and §5 are stale in that one respect. Everything else in this document stands, and §7
> and §8 remain required reading.

**Read §0, then §1, then §5. Everything else is reference for when you need it.**

**The one thing to know before you touch a number:** four times in this session a metric
looked broken and the *measurement* was the broken thing. §7 is not optional reading.

### Before anything else — the deadline

`HANDOVER.md` records the submission as due **16 Aug 2026**, which is the day this was
written. Confirm with Jack what is actually still open before starting anything with a
long runway. §0 is ordered so it can be stopped after any single step, and the only item
that must happen is §5, which is one command and about forty minutes.

If the deadline has passed by the time you read this, the ordering still holds — §5 is
still the outstanding measurement — but §8's EMA EPAR work becomes worth doing properly
rather than being out of reach.

### Sibling handoff

`docs/HANDOFF-reading-and-atmosphere.md` was written the same day from a different
session on this same branch. **That one owns the reading surface, the SECTION scene, the
unbuilt launcher, and the dev-server preflight; this one owns the numbers.** Read both if
you are picking up the branch cold — and note its first instruction, which is that **PR
#24 is open against this branch and should be merged before other work on it.** Without
it, opening a document in Read & mark fails on any checkout whose `node_modules`
predates the last dependency addition.

`HANDOVER.md` is the historical audit of the whole repo and indexes every branch handoff.

---

## 0. TL;DR — what to do, in order

~~1. **§1** — set `ARBITER_GCP_PROJECT`. Nothing works without it. One line.~~
~~2. **§5** — run `npm run ask:eval`. This is the only outstanding measurement. ~40 min.~~
~~3. **§5.4** — copy the result into `results/model-comparison/`, regenerate figures.~~

**Steps 2 and 3 are done** — see the banner above and
`docs/EVALUATION-SCOREBOARD.md`. All five Ask metrics now have committed numbers. What
replaces them:

1. **§1** — set `ARBITER_GCP_PROJECT` and authenticate. Still the precondition for any
   live run. One line, plus `gcloud auth application-default login`.
2. **Re-run the verdict five.** `npx tsx services/api/verdict-five-eval.ts`, then
   `counterfactual-eval.ts`. Their result files live under `results/model-comparison/`,
   which is gitignored, so they were never committed and are absent from a fresh clone.
   Both run against committed fixtures — no PDFs, no extraction cache, and cheap.
3. **Commit the result JSON this time**, by widening the `.gitignore` whitelist to cover
   `results/model-comparison/*.json`. Scoreboard §3.3.
4. **§11** — decide what goes on the slides. That decision is Jack's, not yours; §11
   gives him what he needs to make it.

If you do nothing else, do 1–3. Step 2 is now the entire reason this document exists.

**Do not start by refactoring, re-tuning retrieval, or improving a score.** The scores
are mostly fine. The gap is that two of them have never been measured.

---

## 1. Environment — exact, verified working

### 1.1 The one variable you need

```bash
export ARBITER_GCP_PROJECT=project-7f4f8910-63be-4b85-a67
```

Or put it in `.env` at the repo root (gitignored; `.env.example` is the tracked template).

That value came from `gcloud config get-value project` on this machine and matches the
project the provider-decision doc already records. Application Default Credentials were
already present — `gcloud auth application-default login` had been run previously. If
auth has since expired, that command is the fix.

### 1.2 There is no Vertex API key, and this is by design

Jack asked for "the key" and there isn't one. Vertex authenticates with ADC, not a key
string. `.env.example` §2b explains this to end users. If you find yourself hunting for
`VERTEX_API_KEY`, stop — the correct answer is `gcloud auth application-default login`
plus a project id.

### 1.3 Environment variables that actually exist

Verified by grepping `ARBITER_[A-Z_]*` across `services`, `apps`, `packages`, `tools`:

| Variable | Default | Notes |
|---|---|---|
| `ARBITER_GCP_PROJECT` | — | **required for any live run** |
| `ARBITER_MODEL` | `gemini-3.5-flash` | provider inferred from the name: `gemini-*` → Vertex, else Anthropic |
| `ARBITER_ADJUDICATION_MODEL` | falls back to `ARBITER_MODEL` | |
| `ARBITER_ASK_MODEL` | falls back to `ARBITER_MODEL` | |
| `ARBITER_ADJUDICATION_RUNS` | 3 | consensus runs, capped at 9 in `runsFrom()` |
| `ARBITER_ASK_K` | 16 | passages retrieved per Ask |
| `ARBITER_MODEL_BUDGET` | 30 | model calls per account per 10 min — **the spend cap** |
| `ARBITER_HOST` | `127.0.0.1` | |

**`ARBITER_ADJUDICATION_RUNS` is missing from `.env.example`.** It was added with
`consensus.ts` and the template was never updated. Small, worth fixing.

### 1.4 Use flash for everything

Jack's instruction, verbatim: *"use 3.5 flash for all tests"*. Every committed number is
`gemini-3.5-flash`. Pro runs exist in `results/model-comparison/` for comparison only.
Do not silently switch models — see §5.4 for how that already went wrong once.

### 1.5 Python

`.venv/Scripts/python.exe` at the repo root. Verified to have `pymupdf`, `matplotlib`,
`pandas`. Deps are in `data/prep/requirements.txt`. On Windows, invoke it by that path;
bare `python` may resolve elsewhere. The `PYTHON` env var overrides what the API server
shells out to for PDF work.

### 1.6 Spend

Live evaluation runs cost real money on Jack's GCP project. A full `ask:eval` is roughly
122 model calls (53 answerable × 2 for answer+judge, plus 16 refusal items). Flash is
cheap, but do not loop these runs casually, and never run Pro across the whole fixture
"to compare" without asking.

---

## 2. The corpus — where it is, and what is not in git

This trips people up immediately, so it is near the top.

### 2.1 The PDFs are NOT committed

`data/raw/approval-packages/` is gitignored (~21MB and growing). On this machine it
holds **42 PDFs**. A fresh clone will have an empty directory and every eval will fail
with file-not-found.

The 42 break down as: 14 base regulatory reviews, each with a `-clinical-only` and a
`-nonclinical-only` derivative built by `data/prep/split_review.py` (that is 42 minus the
handful of one-off gate fixtures — `tolcapone-20697-medical-review-p1.pdf`,
`troglitazone-020720-approval.pdf`, `modern-fda-multidiscipline-211367.pdf`).

`data/raw/approval-packages/gate-manifest.json` records every file with an
`expect: accept|refuse` and a `why`. That manifest is what `gate_eval.py` scores against.

### 2.2 The extraction cache IS what the evals read

`results/library/*.pages.json` — **14 documents**, also gitignored:

```
exkivity  inrebic  krazati  lumakras  nipocalimab  nubeqa  orgovyx
qinlock   retevmo  slynd    tazverik  trikafta     turalio  xpovio
```

These 14 are exactly the documents the retrieval and ask fixtures address. `ask-eval` and
`retrieval-eval` read the cache, not the PDFs, so **if the cache is present you can run
the evals without the PDFs**. Check first:

```bash
ls results/library/*.pages.json | wc -l   # want 14
```

If that returns 14, skip to §5. If it returns 0, you need the PDFs back (§2.3).

### 2.3 If you have to rebuild the corpus

Every PDF is public and retrievable from `accessdata.fda.gov` or `ema.europa.eu`. The
FDA ones are addressable by application number, which is in each filename:
`turalio-211810-multidiscipline.pdf` → NDA 211810. Re-extract with
`data/prep/extract_pdf_text.py`, re-split with `data/prep/split_review.py` (it refuses
anything it cannot cleanly split, which is a feature).

`data/cases/` holds three human-transcribed cases and IS committed:
`nipocalimab-imaavy.json`, `slynd-drospirenone.json`, `turalio-pexidartinib.json`. These
are the ground truth for `extract.ts` scoring.

### 2.4 The copy Jack has

`C:\Users\Jack\Downloads\arbiter-test-pdfs\` — `should-be-accepted/`,
`should-be-refused/`, a `README.md`, and a copy of the gate manifest. Built so he could
test uploads by hand. If you change what the gate accepts, that folder is now stale and
should be regenerated.

---

## 3. Every measured number, and where it came from

Everything below is on disk right now and re-derivable. Nothing here is estimated.

### 3.1 Verdict — five metrics, all measured

`npx tsx services/api/verdict-five-eval.ts` · fixture `data/verdict-five.json` ·
result `results/model-comparison/verdict-five-gemini-3.5-flash.json`

| # | Metric | Result | 95% CI (Wilson) |
|---|---|---|---|
| 1 | Verdict is right | 8/8 | 68–100% |
| 2 | Prose stays inside the evidence | 8/8 | 68–100% |
| 3 | Names the deciding rule | 8/8 | 68–100% |
| 4 | Names every gap | 8/8 | 68–100% |
| 5 | Runs agree (consensus of 3, unanimous) | 8/8 | 68–100% |

n=8, consensus of 3. **The interval is the honest width and must travel with the number.**
Why these five and not others: the reasoning is a 35-line comment at the top of
`verdict-five-eval.ts`. Short version — most failure modes are already impossible because
the response schema is *built from the request*, so `citedFindingIds` can only name
findings that were sent and `missing` can only name genuinely-absent fields. These five
are what is left unguarded.

### 3.2 Verdict — supporting evidence

| Evaluation | Result | File |
|---|---|---|
| Counterfactual minimal pairs (flash) | 5/6 passed, 0 stuck | `counterfactual-gemini-3.5-flash.json` |
| Counterfactual minimal pairs (Pro) | 6/6 passed, 0 stuck | `counterfactual-gemini-3.1-pro-preview.json` |
| Determinism under consensus | 13/14 stable, 1 flipped | `verdict-determinism-gemini-3.5-flash.json` |
| Three-class accuracy | 27/27 (9 cases × 3 team framings) | `verdict-eval-gemini-3.5-flash.json` — **but see §8** |

"0 stuck" is the important half of the counterfactual result: the model changed its
answer when the evidence changed, rather than anchoring. That is the one verdict metric
a system that ignores the evidence cannot fake.

### 3.3 Ask — three measured, two never run

`results/retrieval-eval.json`, k=16, 53 answerable + 16 unanswerable = 69 items across
14 documents.

| # | Metric | Result | State |
|---|---|---|---|
| 1 | Finds the passage (hit@16) | **96.2%** · n=53 | done — pure retrieval, no model |
| 2 | Gets the fact right | **71.7%** (38/53), CI 58.4–82.0% | done — see scoreboard §2 |
| 3 | Points you to a correct page | **96.2%** cited ≥1 gold page · n=53 | done |
| 4 | Says when the document is silent | **100%** (16/16), CI 80.6–100% | done — never quote bare |
| 5 | Same answer however you ask | **90.0%** (18/20 groups) | done |

Also on file: mean recall 91.5%, MRR 0.529, mean set-overlap stability 33.7%.

Metric 5 verified for this document: of 29 question groups, 20 have more than one
phrasing; in 18 of those 20, every phrasing retrieves the answer. The two failures are
`turalio:liver-findings` (1 of 4 phrasings missed) and `lumakras:liver` (1 of 2).

### 3.4 Upload gate

`.venv/Scripts/python.exe data/prep/gate_eval.py` — accuracy 0.976, recall 1.000, over 42
documents. Recall 1.000 matters more than accuracy here: the gate never refuses a
document it should have accepted, and a false refusal is the failure a user actually
feels.

---

## 4. What is on disk vs what is true — ⚠ NO LONGER ACCURATE

> This section describes the state before `44754a6`. `results/ask-eval.json` is now the
> 69-item, 16-unanswerable run with a `judged` field on every answerable item. Fixture and
> results are in sync. The paragraph below is kept for the record of what was fixed.


**The committed `results/ask-eval.json` and both `model-comparison/ask-eval-*.json` are
from the OLD run.** Verified: 55 items, `unanswerable: 2`, no `judged` field at all,
`statedFactRate: 1`, `refusalRate: 1`.

So:

- The four PNGs in `results/figures/` were drawn from the pre-judge, n=2 data.
- Any 100% refusal figure you see is **2 out of 2**, which is not a measurement.
- `statedFactRate: 1` is the saturated regex screen described in §5.2.

The fixture (`data/retrieval-eval.json`) has already been updated to 69 items with 16
unanswerable. Fixture and results are out of sync until you run §5. That is the whole job.

---

## 5. ~~THE TASK~~ — DONE. Kept as the record of how the run was specified

> Completed in `44754a6`. The run produced exactly what §5.3 asks for: 69 items, 16
> unanswerable, `judgedCorrectRate` 0.7170, `refusalRate` 1.0, `errors: 0`. **Do not run
> this again** — it is ~40 minutes and ~122 billed model calls to reproduce a committed
> number. The reasoning in §5.2 about why the judge exists is still worth reading, and the
> §5.4 trap about `plot_evaluation.py` reading from `model-comparison/` still applies to
> the verdict re-run.


### 5.1 The command

```bash
export ARBITER_GCP_PROJECT=project-7f4f8910-63be-4b85-a67
npm run ask:eval          # == npx tsx services/api/ask-eval.ts
```

The previous run was killed at 28 of 69 items on purpose (Jack said stop), so nothing was
written. Budget ~40 minutes; every answerable item now costs two model calls, answer then
judge. It writes `results/ask-eval.json`.

**Do not run this with `ARBITER_MODEL` set to anything but flash.**

### 5.2 What it will produce that did not exist before

**`judgedCorrectRate` + `judgedCorrectInterval`.** New this session. The old
`statedFactRate` is a regex screen over `mustContain` patterns and it sat at exactly 100%
for both flash and Pro — which is the tell. Reading the fixture: 34 of 54 patterns are a
single word; one pattern shared by twelve items fires on the bare word "liver"; and an
answer stating the opposite passes, because *"the findings were NOT reversible"* matches
`reversib` and *"no exposure margin was established"* matches `margin`. It was measuring
vocabulary, not correctness.

Both are reported. Keep both: the regex is a free deterministic floor, the judge is the
measurement.

**`refusalRate` at n=16**, up from n=2. Every one of the 14 added unanswerable items was
**verified, not assumed**: for each candidate, the term that would have to appear for the
document to answer it was searched across the entire extracted text, and only zero-hit
candidates were kept. Seven candidates were rejected this way, including ones that looked
obviously safe — krazati names sotorasib twelve times, so "how does this compare to
sotorasib" is answerable; orgovyx and xpovio both do report a 2-year carcinogenicity
study. An "unanswerable" item the document can actually answer inverts the exact metric
it exists to measure.

### 5.3 How to know it worked

```bash
node -e 'const a=require("./results/ask-eval.json");
console.log(a.items.length, a.unanswerable, a.judgedCorrectRate, a.refusalRate, a.errors)'
```

Want: `69`, `16`, a number (not `undefined`), a number, and `errors: 0`.

- `judgedCorrectRate === undefined` → you ran a stale build or the judge threw silently.
- `errors > 0` → check for quota/auth first; `completeFromEnv` returns null with no
  credentials and the script exits 2 rather than pretending.
- `judgedCorrectRate === 1` exactly → suspicious. Read a few `items[].judged` payloads
  before believing it, and see §7 before "fixing" anything.

### 5.4 Then, and this bit has bitten before

```bash
cp results/ask-eval.json results/model-comparison/ask-eval-gemini-3.5-flash.json
.venv/Scripts/python.exe tools/plot_evaluation.py
```

**`tools/plot_evaluation.py` line 74 reads
`results/model-comparison/ask-eval-gemini-3.5-flash.json`, not `results/ask-eval.json`.**
Same for verdict on line 78. Whichever model ran last owns the top-level file, and a Pro
run once put 88.9% onto a figure captioned as the flash headline. Always copy into
`model-comparison/` with the model in the filename, then plot.

Figures land in `results/figures/`: `evaluation-headline.png`,
`evaluation-model-comparison.png`, `evaluation-upload-gate.png`,
`evaluation-verdict-confusion.png`.

### 5.5 Then commit

Per Jack's standing preference (§12): commit **and push** — pushing is not a separate
later step. The branch is `feat/product-in-the-atmosphere` and pushing updates PR #22.

---

## 6. What was built this session

| File | What it does |
|---|---|
| `services/api/consensus.ts` | Self-consistency on the verdict. `adjudicateConsensus`, `pickMajority`. Ties break toward the more cautious answer (`cannot_conclude` > `do_not_advance` > `advance`). Wired into the adjudicate route. `runsFrom(env)` caps at 9. |
| `services/api/extract.ts` | Proposes findings from a PDF. **Proposes, never commits** — see §9. |
| `services/api/verdict-five-eval.ts` | The five verdict metrics (§3.1). |
| `services/api/verdict-eval.ts` | Three-class accuracy + the `wilson()` helper everything else imports. |
| `services/api/verdict-real-eval.ts` | Real drugs vs FDA outcome — **§8, do not report this**. |
| `services/api/counterfactual-eval.ts` | Minimal pairs. |
| `services/api/ask-eval.ts` | Extended with `judged`, `judgeCorrect()`, `judgedCorrectRate`. |
| `services/api/env.ts` | `.env` loader. **Called from entry points only, never at import** — otherwise importing a module during tests would make live billed calls. |
| `services/api/spend.ts` | `ModelBudget`, fixed-window. `budgetFrom(env)` falls back on malformed values, because a `NaN` limit silently disables the cap. |
| `data/prep/gate_eval.py` | Upload gate scoring; builds the clinical-only / nonclinical-only derivatives and reports a confusion matrix. |
| `data/verdict-five.json` | The 8-case adjudicator fixture. |
| `tools/plot_evaluation.py` | Four figures, from JSON, never by hand. |
| `docs/evaluation-dataset.md` | The corpus and where its variety runs out. Read this before claiming coverage. |

Also this session, on the product rather than the evaluation: the case-interior 3D scene
(`packages/atmosphere/src/scenes/interior.ts`), the archive→interior transition with a
pending-transition queue, and the refusal-route tab bug in `apps/deliberation/src/App.tsx`.

---

## 7. Read this before "fixing" a low score

Four times a metric looked broken and the measurement was what was broken. This is the
most valuable section in the document.

**Prose discipline read 62.5%.** I believed I had reproduced a failure the codebase
documents. All three flagged paragraphs were false positives — *"Although reversibility
was not assessed…"*, *"Without the projected human daily dose… we cannot scale the
findings"*, *"leaving the injury pattern unassessed"*. That is the model **naming the
absence**, which is precisely what the prompt requires. A regex cannot separate that from
"the injury is irreversible", because the difference is negation and scope, not
vocabulary. Replaced with a narrow judge. **The jump to 100% is a measurement fix, not a
model improvement, and must be described that way whenever it is quoted.**

**Citation recall read 81.1%.** 45 of 53 items carry two gold pages, and the harness's own
definition is that gold names pages *sufficient* to answer, not every valid one. Citing
one of two scores 50% while answering perfectly. The reviewer-relevant number is
**96.2% cited at least one correct page**.

**Paraphrase stability reads 33.7%.** It is set-overlap of 16 retrieved pages, and it
*falls* as k rises — 38.5% at k=8, 32.7% at k=32 — so a large part of it is an artefact of
k. The meaningful statement is **90% of multi-phrasing groups have every phrasing find the
answer** (§3.3). Quote that, with k stated.

**Two of my own fixture labels were wrong while the model was right.**
`gap-reversibility-unknown` and `conflict-unresolvable`, both corrected in place with the
reasoning recorded on the case. Check the label before blaming the model.

The general rule: when a score is bad, the first hypothesis is that the metric is wrong,
not that the model is. Read the actual failing outputs before changing anything.

---

## 8. Two evaluations that must NOT be reported

**`verdict-real-eval.ts` — the task is ill-posed.** It asks a *nonclinical* adjudicator to
predict a *clinical* labelling outcome. Lumakras's hepatotoxicity warning came from
patients' ALT elevations, not from the nonclinical package. Sensitivity read 16.7% and it
measures nothing about the product. Two further reasons it cannot be salvaged as written:

- **Survivorship bias.** These are approval packages, so 13 of 14 drugs cleared the bar.
  An always-advance classifier scores 13/14 and learns nothing.
- **FDA multidiscipline reviews leak the answer.** Documented in
  `data/cases/turalio-pexidartinib.json`: the *nonclinical* chapter says *"The liver is a
  major target organ clinically, with frequent elevations in transaminases."* That is the
  answer key sitting inside the input. **EMA EPARs do not leak** — their non-clinical
  section is written before and separately from the clinical one, which is why the
  nipocalimab case carries no such warning.

  **If you want a genuine blind prediction test, source EMA EPARs.** That is the single
  clearest path to a defensible headline number, and it is real work: find EPARs for
  drugs with known post-approval hepatotoxicity outcomes, split off the non-clinical
  section, and predict forward.

**Three-class accuracy on `data/verdict-eval.json` (27/27).** I wrote the nine cases *and*
the answer key. That is not evidence. An hour of review by someone with tox background
makes it defensible. Until then lead with the counterfactual result instead — it cannot
be gamed by a system that never reads the findings.

---

## 9. What is NOT done

**`extract.ts` has no route and no UI.** It works: scored against the human transcriptions
in `data/cases/`, nipocalimab 5/5 checklist items, turalio 5/8 (one token truncation, one
quote rejected by the verbatim guard — the guard doing its job). It needs
`POST /api/cases/:id/propose-findings` and an accept/edit/discard panel in
`FindingsEditor`. **It must stay propose-only.** The record attributes every finding to a
named person, and a finding that appeared because a model read a page has nobody behind
it.

~~**Ask metrics 2 and 4 have no committed numbers.**~~ Both are now committed — 71.7% and
100% respectively. **What is missing instead is the verdict five**: their result JSONs live
under the gitignored `results/model-comparison/` and were never committed, so they are
absent from every clone but the one that produced them. Scoreboard §3.

**`judgeCorrect` is self-grading.** The same model family answers and grades. The question
is nearly mechanical, but the credible version needs a human grading ~20 answers so
Cohen's κ can sit beside it. **That is the single highest-value hour anyone can spend on
this project**, and it is a task for Jack or a colleague, not for you.

**The consensus split flag is not surfaced in the UI.** §10.

**`.env.example` is missing `ARBITER_ADJUDICATION_RUNS`.** §1.3.

---

## 10. The one open defect

**The verdict is not deterministic at temperature 0.** Turalio returned `do_not_advance`
three times and `cannot_conclude` three times across six single calls — a coin flip. A
fixed `thinkingBudget` of 4096 flips exactly as `-1` does, so there is no configuration
fix; this is sampling nondeterminism in the service, not something the caller controls.

`consensus.ts` is the mitigation and it works: five consensus decisions of three runs each
returned the same answer 5/5, and reported `2/3-SPLIT` on four of them, so a reader is
told when it was close.

**The split flag is not yet shown in the UI.** It travels in the API response as
`consensus` on the adjudicate route. Surfacing it is a small, high-value piece of work: a
borderline verdict presented as confident is the worst failure this product can have, and
the data to prevent it is already in the payload.

---

## 11. Presentation guidance

The ask was ten slide metrics in the high 80s / low 90s. Two things are true at once:
some of them cannot honestly reach that, and three of them are at 100% for reasons that
will not survive a question. Jack's own words: *"the numbers shouldn't be 100%, that's not
reputable."* He is right, and this tension is deliberately left unresolved — **the person
presenting decides it, not the harness.**

What to advise:

- **Never put a bare 100% on a slide.** *"100% (8 cases, 95% CI 68–100%)"* survives a
  question that *"100%"* does not. The Wilson interval is already computed for every
  verdict metric.
- **Lead with counterfactual sensitivity for the verdict.** It is the only verdict metric
  that cannot be scored well by a system ignoring the evidence.
- **Lead with 96.2% cited-a-correct-page for Ask**, not the keyword score.
- **Say n out loud on every slide.** n=8 with an interval is more credible than n=8
  hidden.
- **The strongest slide is not a percentage.** Building this evaluation found three real
  defects the app's own test suite missed: every PDF upload was silently refused (PyMuPDF
  printing a banner to stdout and corrupting the JSON parse), the document gate admitted
  the one document it was written to reject, and the verdict is a coin flip on borderline
  cases. *"Our evaluation found three bugs our tests didn't"* is much harder to dismiss
  than any number, and it is the honest version of what this work produced.

---

## 12. How Jack wants to be worked with

From memory and from this session. These are not suggestions.

- **Commit AND push every task.** Pushing is part of finishing, not a later step.
- **No fallbacks — go all in.** One committed recommendation, not a hedged design with
  safe plays alongside it.
- **Do not outsource ops decisions.** Make the code deployable and prove it runs; do not
  hand back an infrastructure questionnaire. His correction verbatim: *"are you asking me
  to deploy it? lets just set up the code so i can deploy it but make sure the api works
  first."*
- **Do not read a description and guess.** *"dont just read the description of things to
  guess"* — said when I inferred what an evaluation measured from its name instead of
  reading it. Read the code.
- **He will not accept implausible numbers**, and he is right to. He pushed back on 100%
  twice and both times there was a real problem underneath.

---

## 13. Repo conventions

- **Commit messages are prose, not bullet lists.** Look at `git log`. They explain *why*
  and record what was tried and rejected. Match that register.
- **Verification before any commit:** `npm run typecheck && npm run lint && npm test`.
  Last green state: typecheck clean, lint clean, **821 tests across 58 files**.
- **CI (`.github/workflows/ci.yml`) runs more than those three.** It also runs
  `validate:evidence`, `harness`, `metrics`, the golden test, a
  `git diff --exit-code results/verdict-manifest.json`, both production builds, and
  Playwright e2e. The manifest diff is the one that catches you: **if a reported figure
  moves, CI fails until the manifest is committed and the move is explained.** That is
  deliberate. CI also installs `pymupdf==1.28.2`, because Python is part of the upload
  path and not a data-prep convenience.
- **This branch has two active sessions.** Another one is working the reading surface and
  the scene. `git fetch` and rebase before you push — the last push here was rejected for
  exactly this reason. Your files and theirs have not collided so far, but `HANDOVER.md`
  is shared.
- **`vitest.config.ts` excludes `.claude/worktrees/**`.** Without that, 15 phantom
  failures appear from a stale worktree. Do not remove it.
- **Scripts you will want:** `npm run ask:eval`, `npm run retrieval:eval`,
  `npm run verdict:eval`, `npm run report`, `npm run api`, `npm run dev`,
  `npm run probe`, `npm run metrics`.
- **Branch:** `feat/product-in-the-atmosphere` → `main`, PR #22 "Put the product inside
  the atmosphere". Remote is `github.com:SaplingLearn/Arbiter.git`.

---

## 14. Traps that cost time this session

Each of these was discovered the slow way.

- **Vertex rejects `type: ["string","null"]`.** Use `anyOf`. It also **rejects integer
  `enum`** — use a string enum and parse back. This is why page numbers in `extract.ts`
  are string-typed.
- **PyMuPDF prints a banner to stdout**, which corrupted every JSON parse and silently
  refused every upload. Fixed with `import pymupdf as fitz` plus a `lastJsonObject`
  scraper at all three parse sites. If PDF handling breaks mysteriously, check stdout
  first.
- **Editing TypeScript through Python heredocs corrupts `\n`** into literal newlines.
  Repeatedly. **Use the Edit tool** for TS/TSX — it is the only thing that worked
  reliably.
- **Backticks inside GLSL template literals terminate the string.** Bit me twice in
  shader comments.
- **Do not call `loadEnv()` at module import.** Importing a module during a test run would
  then make live billed calls. Entry points only.
- **Errored cases counted as correct negatives** once, producing a spurious 100%
  specificity. Exclude errors from the denominator, don't score them.
- **A structural chapter rule in the upload gate refused all 13 standalone tox reviews**,
  dropping recall from 1.000 to 0.519. It was caught only because the gate was tested on a
  *new document shape*. Fixed with a density rescue. Lesson: test the gate on shapes it
  was not tuned on, every time you touch it.

---

## 15. Things already tried that did NOT pay

Do not redo these.

- **k=24 retrieval.** Retrieval hit rose 96.2% → 98.1%, but end-to-end citation recall was
  unchanged at 81.1% and it added a truncation error. Retrieval is not the binding
  constraint. Reverted; the trade curve is in git history.
- **A `c_injury` vocabulary concept.** 16 terms for +1.6pp of set-overlap and zero actual
  failures fixed. The vocabulary file's own rule is that an entry must pay its way.
  Reverted.
- **Prompt v1.3.** Added a rule forbidding the prose from characterising an absent
  dimension. Under the *corrected* judge, v1.2 already scores 8/8 — so v1.3 fixed a
  failure that was never happening. Deleted rather than shipped. (Note: an earlier prompt
  bump, v1.2, genuinely changed the answer and not merely the label. v1.3 did not.)
- **Embeddings for retrieval.** Tested and rejected with measurements on 2026-08-13. The
  note at the top of `services/api/retrieval.ts` is thorough. Read it before revisiting.
