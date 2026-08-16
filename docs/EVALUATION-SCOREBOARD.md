# The ten benchmarks — where they actually stand

Written 2026-08-16 on `feat/product-in-the-atmosphere` (PR #22), from the files committed
to this branch. Every number below was recomputed from raw items on this checkout, not
copied from a previous document. §5 says how to re-derive them without spending a penny.

**Read this before `docs/HANDOFF-evaluation.md`.** That handoff's §0 tells you to run
`npm run ask:eval` because it had never been run. It has been run. See §4.

---

## 1. Ask — all five measured

Source: `results/ask-eval.json` (69 items, 53 answerable + 16 unanswerable, 14 documents,
`gemini-3.5-flash`, 0 errors) and `results/retrieval-eval.json` (k=16). Intervals are
Wilson at 95%, computed with the same helper the harness uses (`wilson()` in
`services/api/verdict-eval.ts`).

| # | Metric | Result | n | 95% CI |
|---|---|---|---|---|
| 1 | Finds the passage (hit@16) | **96.2%** (51/53) | 53 | 87.2–99.0% |
| 2 | Gets the fact right (judge) | **71.7%** (38/53) | 53 | 58.4–82.0% |
| 3 | Points you to a correct page | **96.2%** (51/53) | 53 | 87.2–99.0% |
| 4 | Says when the document is silent | **100%** (16/16) | 16 | 80.6–100% |
| 5 | Same answer however you ask | **90.0%** (18/20) | 20 | 69.9–97.2% |

Metrics 2 and 4 are the two the handoff records as never run. They have been run. Metrics
1, 3 and 5 reproduce the handoff's figures exactly, including naming the same two
paraphrase failures — `turalio:liver-findings` (1 of 4 phrasings missed) and
`lumakras:liver` (1 of 2). That exact agreement is the reason to trust the rest of the file.

Also on record and unchanged: mean citation recall 82.1%, mean citation precision 39.5%,
answered rate 100%, `statedFactRate` 1.0 — the saturated regex screen. Keep the last one
as a deterministic floor and never quote it as correctness.

### 1.1 Metric 4 is 100%, and the interval has to travel with it

16 of 16 unanswerable items were refused. Jack's standing objection to bare 100% figures
applies exactly here: **"100% (16/16, 95% CI 80.6–100%)"** survives a question that "100%"
does not. The lower bound is 80.6%, and that is the honest claim.

The 16 items are worth defending out loud, because the metric is only as good as they are.
Each was verified rather than assumed: the term that would have to appear for the document
to answer the question was searched across the full extracted text, and only zero-hit
candidates were kept. Seven plausible-looking candidates were rejected that way — krazati
names sotorasib twelve times, and orgovyx and xpovio both do report two-year
carcinogenicity studies. An "unanswerable" item the document can actually answer inverts
the exact metric it exists to measure.

---

## 2. Metric 2 is 71.7%, and it decomposes cleanly

This is the one genuinely new number, and the one that will draw a question. It is not
uniform across question types, and the split is the useful part:

| Question topic | Judged correct | 95% CI |
|---|---|---|
| NOAEL | **94.7%** (18/19) | 75.4–99.1% |
| Nonclinical scope | 100% (2/2) | 34.2–100% |
| Liver findings | 75.0% (3/4) | 30.1–95.4% |
| Liver | **58.3%** (7/12) | 32.0–80.7% |
| Reversibility | **58.3%** (7/12) | 32.0–80.7% |
| Safety margins | 50.0% (1/2) | 9.5–90.5% |
| Clinical reversibility | 0% (0/2) | 0–65.8% |

The pattern is coherent rather than random. Ask is near-perfect when the answer is a
single stated scalar to be located and repeated — NOAEL, 18 of 19. It is markedly weaker
when the answer is a qualitative judgement that has to be synthesised across several
studies and then scoped correctly, which is exactly what reversibility and liver-findings
questions are.

That is a real property of the feature, and it is the honest way to present 71.7%:
**retrieval is not the weak point, synthesis is.** The rest of the file agrees. Retrieval
finds the passage 96.2% of the time and the answer cites a correct page 96.2% of the time,
while only 71.7% state the fact correctly. The gap between 96.2% and 71.7% is the
synthesis step, and nothing else.

The bottom three rows carry n=2 and n=4. They are worth showing as texture and are far too
thin to carry a claim on their own — note the interval on "clinical reversibility" runs to
65.8%.

### 2.1 One hypothesis tested and rejected

`judgeCorrect()` passes every gold quote to the judge in a single call, and its rubric
marks an answer incorrect if it "omits the fact the quote carries". Since §7 of the
handoff establishes that gold pages name what is *sufficient* to answer rather than every
valid source, a correct answer covering one of two quotes could be scored wrong — the same
measurement flaw that made citation recall read 81.1% when the reviewer-relevant number
was 96.2%.

**Tested, and it does not hold.** Items carrying one gold quote score 75.0% (6/8); items
carrying two score 71.1% (32/45). The intervals overlap almost entirely, and n=8 on the
one-quote side is far too thin to carry a claim in either direction. The multi-quote rubric
is not what is driving 71.7%. It should not be offered as an explanation, and the scoring
must not be changed on the strength of it.

This is recorded because §7's discipline cuts both ways. The first hypothesis about a low
score is that the metric is broken — and that hypothesis then has to be *tested* rather
than assumed. This one failed the test, and 71.7% stands as measured.

### 2.2 What would make metric 2 credible

Six items cited every gold page and were still judged incorrect: `nipo-margin-a`,
`tur-noael-b`, `lumakras-liver-a`, `inrebic-liver-b`, `orgovyx-reversible-a`,
`tazverik-liver-a`. Reading three by hand, at least two look like judge false negatives
rather than model errors — `orgovyx-reversible-a` states explicitly that the cessation of
menses in female monkeys was reversible, which is precisely the fact its gold quote carries.

That observation does not move the number, because a hand-read of three items is not a
measurement. It points at what the handoff §9 already calls the highest-value hour on the
project: **`judgeCorrect` is self-graded by the same model family that produced the
answer.** A human grading ~20 answers, so Cohen's κ can sit beside the 71.7%, is what turns
a suggestive number into a defensible one. The six items above are the right place to
start, because they are where the judge and the citation evidence already disagree.

---

## 3. Verdict — five metrics, results not recoverable on this machine

The handoff §3.1 records all five at 8/8 (n=8, consensus of 3, 95% CI 68–100%), measured
from `results/model-comparison/verdict-five-gemini-3.5-flash.json`.

**That file is not in this checkout, and it never was.** `.gitignore` line 54 ignores
`results/*` behind an explicit whitelist, and `model-comparison/` is not on it. Neither is
`results/figures/`. So the verdict result JSONs, the counterfactual results, the
determinism results and all four PNGs only ever existed on the machine that generated
them. The same applies to `results/library/*.pages.json` (0 of 14 present here) and
`data/raw/approval-packages/` (0 of 42 PDFs).

The Ask numbers survived only because `results/ask-eval.json` and
`results/retrieval-eval.json` are individually whitelisted on lines 77–78.

What *is* committed and intact: the fixture `data/verdict-five.json` (8 cases), and the
harnesses `verdict-five-eval.ts`, `consensus.ts` and `counterfactual-eval.ts` with its
fixture. The evaluation can be re-run in full. It just cannot be run *here*.

### 3.1 Why it cannot be run here

`services/api/gemini.ts` authenticates to Vertex with Application Default Credentials and
**no API key** — its header says so, and there is no key code path in the file. On this
machine:

- `ARBITER_GCP_PROJECT` — unset, and absent from `.env`
- Application Default Credentials — no file at the well-known location
- `GOOGLE_APPLICATION_CREDENTIALS` / `..._JSON` — both unset
- `gcloud` — not installed, so `gcloud auth application-default login` cannot be run
- `.venv/Scripts/python.exe` — absent, so the figures cannot be regenerated either

The `GEMINI_API_KEY` sitting in `.env` is read by nothing: grepping the whole tree returns
zero hits outside that file. It is a leftover, and it is misleading enough to be worth
deleting, because it invites exactly the hunt handoff §1.2 warns against.

With no credentials `completeFromEnv` returns null and the eval scripts exit 2 rather than
pretending. That is the correct behaviour, and it is why nothing here silently produced a
fake number.

### 3.2 The commands that unblock it

On a machine with `gcloud` installed:

```bash
gcloud auth application-default login
export ARBITER_GCP_PROJECT=project-7f4f8910-63be-4b85-a67
npx tsx services/api/verdict-five-eval.ts
npx tsx services/api/counterfactual-eval.ts
```

Both run against committed fixtures and need no PDFs and no extraction cache, so they work
on a fresh clone. `verdict-five-eval.ts` is 8 cases at consensus of 3 — by far the cheapest
outstanding run. Take `counterfactual-eval.ts` at the same time: handoff §11 is right that
it is the verdict result worth leading with, because it is the only one a system ignoring
the evidence cannot score well on.

Ask cannot be re-run without first restoring `results/library/*.pages.json`, and does not
need to be — its numbers are committed and reproduced above.

### 3.3 Commit the artifacts this time

The re-run should be followed by widening the `.gitignore` whitelist to cover
`results/model-comparison/*.json`. These files are small, they are the evidence behind
every number on a slide, and the current rule is why five measured metrics are sitting
in this document as a citation rather than a file. The PNGs can stay ignored — they are
regenerable from the JSON by `tools/plot_evaluation.py`, which the JSON is not.

---

## 3A. What the Ask benchmark is measured *on*

A separate question from "what do the metrics say", and the one that decides whether the
metrics mean anything: **are the documents spread across drugs that turned out toxic,
drugs that did not, and documents with incomplete information?**

The corpus was designed on exactly that axis — `data/library-sources.json` says so in its
own note, that a set of only hepatotoxic drugs "measures willingness to say danger and
nothing else". But as built, the toxic end was one document deep.

| Class | Before | Now |
|---|---:|---:|
| Toxic outcome (boxed hepatic warning or withdrawn) | 1 of 14 | **8 of 21** |
| Non-toxic outcome (approved, no liver warning) | 13 of 14 | 13 of 21 |
| Incomplete information — document level | 1 (slynd, a 505(b)(2)) | 2 |
| Incomplete information — question level | 16 unanswerable | **23 unanswerable** |

Seven FDA pharmacology reviews were added, chosen for their **outcome** rather than their
findings, fetched from `accessdata.fda.gov` by application number: **Iclusig** (ponatinib),
**Stivarga** (regorafenib), **Ocaliva** (obeticholic acid), **Jynarque** (tolvaptan),
**Aubagio** (teriflunomide), **Yondelis** (trabectedin) and **Kynamro** (mipomersen). Six
carry a boxed hepatic warning; **Kynamro and Ocaliva were withdrawn from the US market for
liver injury**. Four of the seven are non-oncology, and Kynamro is an antisense
oligonucleotide — a modality the corpus did not have.

That last pair matters more than the count. `docs/evaluation-dataset.md` §6 recorded, as
its sharpest limit, that the only two drugs with genuine negative outcomes — troglitazone
and tolcapone — **could not supply cases**, because the upload gate correctly refuses one
scanned document and one labelling supplement. The fix was not to weaken the gate but to
find withdrawn drugs whose reviews are readable. Kynamro and Ocaliva are.

Full detail, including what these documents let the fixture ask that it could not before,
is in `docs/evaluation-dataset.md` §8.

### 3A.1 Three kinds of "the document does not say", not one

Worth separating, because the corpus now tests all three and they demand different answers:

1. **The document cannot answer.** 23 unanswerable items, each verified by the zero-hit
   rule — the term that would have to appear was searched across the whole extracted text
   and only zero-hit candidates kept. Correct response: refuse. Two candidates were
   rejected during this extension (`juvenile` and `hERG` for ponatinib, both actually
   present).
2. **The document is the wrong kind of document.** slynd is a 505(b)(2) with no
   nonclinical studies; Yondelis is a 19-page concurrence memorandum over reviews conducted
   elsewhere.
3. **A study was deliberately not done, and the document says so and why.** Ponatinib:
   *"Carcinogenicity studies were not completed because of the short life-expectancy of
   CML and Ph+ ALL patients"*. This is **answerable**. Scoring it as a refusal would teach
   the opposite of the rule the product depends on: `not applicable` is not `missing`.

### 3A.2 Measured on the new documents, without a model

The retrieval half needs no credentials, so it was run here:

```bash
npx tsx tools/validate_fixture.ts --score ponatinib regorafenib obeticholic \
  tolvaptan teriflunomide mipomersen trabectedin
```

**hit@16 92.9% (26/28), recall@16 92.9%, MRR 0.567** — against 96.2% and MRR 0.529 on the
original fourteen. The new documents are slightly harder, which is the expected direction
for older, partly-scanned reviews and a reason to keep them.

**Both misses are the same paraphrase.** `pona-reversible-b` and `reg-reversible-b` are
each *"Did the … recover after dosing stopped?"*, and in both documents the sibling
phrasing retrieves correctly. One reproducible vocabulary gap in the retriever, found
independently on two documents — exactly what metric 5 exists to surface.

**The ask half of these items has not been run.** It needs a model and this checkout has no
credentials (§3.1). So the ten headline metrics in §1 and §3 are still measured on the
original corpus, and nothing above changes them. What has changed is that the corpus can
now support the toxic/non-toxic contrast the next run should be measured on.

---

## 4. Corrections to `docs/HANDOFF-evaluation.md`

That document is accurate and unusually careful. Two things in it are now stale in a way
that would cost the next person forty minutes and real money.

### 4.1 §0 and §5 — the task is done

§0 item 2 and the whole of §5 describe `npm run ask:eval` as the one outstanding
measurement. It was run and committed in `44754a6` — the same commit that wrote the
handoff, which is why the prose never caught up. Traced through git:

| Commit | items | unanswerable | judgedCorrectRate |
|---|---|---|---|
| `7a6b77f` | 55 | 2 | undefined |
| `d07e1b5` | 55 | 2 | undefined |
| `796a51a` | 55 | 2 | undefined |
| `44754a6` | **69** | **16** | **0.7170** |

The result passes the handoff's own §5.3 acceptance check exactly: 69, 16, a number, a
number, and `errors: 0`. Do not re-run it.

### 4.2 §4 — "what is on disk vs what is true" is inverted

§4 states that the committed `results/ask-eval.json` is the old run — 55 items,
`unanswerable: 2`, no `judged` field. True when the section was drafted, false by the time
the commit landed. Fixture and results are **in sync**, at 69 items and 16 unanswerable.

### 4.3 What still stands, unchanged

Everything else in that handoff holds and should be treated as current:

- **§7** — four cases where a bad-looking metric was a broken measurement. Still the most
  valuable section in either document, and §2.1 above is a fifth entry in the same ledger.
- **§8** — `verdict-real-eval.ts` must not be reported: ill-posed, survivorship bias, and
  FDA multidiscipline reviews leak the answer into the input. Three-class accuracy on
  `verdict-eval.json` must not be reported either, because one person wrote both the nine
  cases and the answer key.
- **§10** — the verdict is not deterministic at temperature 0, `consensus.ts` is the
  mitigation, and the `2/3-SPLIT` flag is still not surfaced in the UI. A borderline
  verdict presented as confident remains the worst failure this product can have, and the
  data to prevent it is already in the API payload.
- **§11** — lead with counterfactual sensitivity for the verdict, and with 96.2%
  cited-a-correct-page for Ask.

---

## 5. Re-deriving every number here

No credentials and no network required. All the inputs are committed.

```bash
node -e 'const a=require("./results/ask-eval.json");
console.log(a.items.length, a.unanswerable, a.judgedCorrectRate, a.refusalRate, a.errors)'
```

The per-topic decomposition in §2 joins `results/ask-eval.json` items to their `group` in
`data/retrieval-eval.json` by `id`, splits the group on `:` to get the topic, and counts
`judged === true` over items where `judged !== null`. Metric 5 counts fixture groups of
kind `answerable` holding more than one phrasing, and scores a group stable when every
phrasing in it retrieves a gold page. Metric 3 counts answerable items with
`citationRecall > 0` — cited *at least one* correct page, which is the reviewer-relevant
form of the question and the one §7 of the handoff argues for.

Wilson intervals use `wilson(successes, n, 1.96)` from `services/api/verdict-eval.ts`. Do
not hand-compute them and do not substitute a normal approximation: at 16/16 and 8/8 the
normal interval is degenerate, which is the whole reason the Wilson form is in the repo.

---

## 6. If you are presenting this

Eight of ten are measured, and the two that are not are *recoverable in one command on a
credentialled machine* rather than unmeasurable. Say it that way.

- **Never a bare 100%.** Metric 4 is "100% (16/16, 95% CI 80.6–100%)".
- **Say n out loud on every slide.** n=16 with an interval is more credible than n=16
  hidden.
- **Lead Ask with 96.2% cited a correct page**, then use the §2 decomposition to own 71.7%
  rather than bury it. "Near-perfect at locating a stated value, weaker at synthesising a
  qualitative judgement" is more honest and more interesting than any single percentage,
  and it tells a reviewer exactly where the product is and is not ready.
- **The strongest slide is still not a percentage.** Building this evaluation found three
  real defects the test suite missed: every PDF upload was silently refused, the document
  gate admitted the one document it was written to reject, and the verdict is a coin flip
  on borderline cases. This document adds a fourth of the same kind — the reported
  evaluation artifacts were never committed, and were one machine away from being lost.
