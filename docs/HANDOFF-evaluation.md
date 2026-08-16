# Handoff — the evaluation work

Written 2026-08-16, mid-task, for whoever picks this up. PR #22.

**The one thing to know before you touch a number:** three times in this session a metric
looked broken and the *measurement* was the broken thing. Read §4 before you "fix" any
score.

---

## 1. Where it stands

The model works. `gcloud config get-value project` returns
`project-7f4f8910-63be-4b85-a67`, which is the project the provider-decision doc already
records, and ADC was already present. The only missing piece was `ARBITER_GCP_PROJECT`.
Every run below is live `gemini-3.5-flash` on Vertex.

```bash
export ARBITER_GCP_PROJECT=project-7f4f8910-63be-4b85-a67   # or put it in .env
```

### Verdict — five metrics, all measured

`npx tsx services/api/verdict-five-eval.ts` · fixture `data/verdict-five.json`

| Metric | Result | 95% CI |
|---|---|---|
| 1 Verdict is right | 8/8 | 68–100% |
| 2 Prose stays inside the evidence | 8/8 | 68–100% |
| 3 Names the deciding rule | 8/8 | 68–100% |
| 4 Names every gap | 8/8 | 68–100% |
| 5 Runs agree (consensus of 3) | 8/8 | 68–100% |

n=8. The interval is the honest width and should be quoted with the number.

### Ask — three measured, two in flight

| Metric | Result | State |
|---|---|---|
| 1 Finds the passage (hit@16) | 96.2% · n=53 | done, no model needed |
| 2 Gets the fact right | — | **IN FLIGHT, see §2** |
| 3 Points you to the page | 96.2% cited ≥1 correct page · n=53 | done |
| 4 Says when the document is silent | — | **IN FLIGHT, n now 16** |
| 5 Same answer however you ask | 90% of paraphrase groups · n=20 | done |

---

## 2. THE FIRST THING TO DO

`npx tsx services/api/ask-eval.ts` was killed at 28 of 69 items. Re-run it:

```bash
ARBITER_GCP_PROJECT=... npx tsx services/api/ask-eval.ts
```

~25 minutes; every answerable item now costs two calls (answer + judge). It produces the
two missing Ask numbers:

- **`judgedCorrectRate`** — new. The regex `mustContain` was saturated at 100% and is a
  keyword screen: 34 of 54 patterns are a single word, one used by twelve items fires on
  the word "liver", and "the findings were NOT reversible" passes `reversib`. Both are
  reported now; the judge is the real one.
- **`refusalRate` at n=16**, up from n=2.

Then regenerate the figures: `python tools/plot_evaluation.py`.

**`tools/plot_evaluation.py` reads `results/model-comparison/ask-eval-gemini-3.5-flash.json`,
not `results/ask-eval.json`** — whichever model ran last owns the latter, and a Pro run
once put 88.9% on a figure captioned as the headline. Copy the flash run into
model-comparison after any re-run.

---

## 3. What was built this session

| File | What |
|---|---|
| `services/api/consensus.ts` | Self-consistency on the verdict. Ties break toward the more cautious answer. Wired into the adjudicate route; `ARBITER_ADJUDICATION_RUNS` (default 3) |
| `services/api/extract.ts` | Proposes findings from a PDF. **Proposes, never commits** — see §5 |
| `services/api/verdict-five-eval.ts` | The five verdict metrics |
| `services/api/verdict-eval.ts` | Three-class accuracy, constructed cases |
| `services/api/verdict-real-eval.ts` | Real drugs vs FDA outcome — **see §6, do not report this** |
| `services/api/counterfactual-eval.ts` | Minimal pairs. flash 5/6, Pro 6/6, 0 stuck |
| `data/prep/gate_eval.py` | Upload gate: 0.976 accuracy, recall 1.000, 42 documents |
| `tools/plot_evaluation.py` | Four figures, from the JSON, never by hand |
| `docs/evaluation-dataset.md` | The corpus, and where its variety runs out |

---

## 4. Read this before "fixing" a low score

Three times a metric looked broken and the measurement was what was broken.

**Prose discipline read 62.5%.** I thought I had reproduced the failure the codebase
documents. All three flagged paragraphs were false positives — *"Although reversibility
was not assessed…"*, *"Without the projected human daily dose… we cannot scale the
findings"*. That is the model **naming the absence**, which is what the prompt requires.
A regex cannot separate that from "the injury is irreversible"; the difference is
negation, not vocabulary. Now a judge. **The jump to 100% is a measurement fix, not a
model improvement, and must be quoted that way.**

**Citation recall read 81.1%.** 45 of 53 items have two gold pages, and the harness says
gold names pages *sufficient* to answer, not all valid ones. Citing one of two scores 50%
while answering the question perfectly. The reviewer-relevant number is **96.2% cited at
least one correct page**.

**Paraphrase stability reads 33.7%.** It is set-overlap of 16 retrieved pages and *falls*
as k rises (38.5% at k=8, 32.7% at k=32), so it is partly an artefact of k. **90% of
paraphrase groups have every phrasing find the answer.** Quote that, with k stated.

And two of my own fixture labels were wrong while the model was right — both corrected
in place with reasons on the case. Check the label before blaming the model.

---

## 5. What is NOT done

**`extract.ts` has no route and no UI.** It works — scored against the human
transcriptions in `data/cases/`: nipocalimab 5/5 checklist items, turalio 5/8 (one token
truncation, one quote rejected by the verbatim guard, which is the guard doing its job).
It needs `POST /api/cases/:id/propose-findings` and an accept/edit/discard panel in
`FindingsEditor`. **It must stay propose-only** — the record attributes findings to a
named person, and a finding that appeared because a model read a page has nobody behind
it.

**Ask 2 and 4 have no committed numbers.** See §2.

**`judgeCorrect` is self-grading.** Same model family answers and grades. The question is
narrow, but the credible version needs a human grading ~20 answers so Cohen's κ can sit
beside it. That is the single highest-value hour anyone can spend on this.

---

## 6. Two evaluations that should NOT be reported

**`verdict-real-eval.ts` — the task is ill-posed.** It asks a *nonclinical* adjudicator to
predict a *clinical* labelling outcome. Lumakras's hepatotoxicity warning came from
patients' ALT elevations, not from the nonclinical package. Sensitivity read 16.7% and
measures nothing about the product. Two further reasons it cannot be salvaged as-is:

- **Survivorship bias.** These are approval packages, so 13 of 14 drugs cleared the bar.
  An always-advance classifier scores 13/14.
- **FDA multidiscipline reviews leak the answer.** Already documented in
  `data/cases/turalio-pexidartinib.json`: the *nonclinical* chapter says *"The liver is a
  major target organ clinically, with frequent elevations in transaminases."* That is the
  answer key inside the input. **EMA EPARs do not leak** — their non-clinical section is
  written before and separately from the clinical one, which is why the nipocalimab case
  carries no such warning. **If you want a real blind prediction test, source EMA EPARs.**

**Verdict three-class accuracy on `data/verdict-eval.json` (27/27).** I wrote the cases
*and* the answer key. Get the nine cases reviewed by someone with tox background — an
hour's read — and the number becomes defensible. Until then, lead with the counterfactual
result instead: it cannot be gamed by a system that never reads the findings.

---

## 7. Things already tried that did NOT pay

Do not redo these.

- **k=24 retrieval.** Retrieval hit rose 96.2% → 98.1%, end-to-end citation recall
  unchanged at 81.1%, plus one truncation error. Retrieval is not the binding constraint.
  Reverted; the trade curve is in the git history.
- **A `c_injury` vocabulary concept.** 16 terms for +1.6pp of set-overlap and zero
  failures fixed. The vocabulary file's own rule is that an entry must pay. Reverted.
- **Prompt v1.3.** Added a rule forbidding the prose from characterising an absent
  dimension. Under the corrected detector v1.2 scores 8/8 too, so it fixed a failure that
  was never happening. Deleted rather than shipped.
- **Embeddings.** Tested and rejected with measurements on 2026-08-13; the note at the top
  of `retrieval.ts` is thorough. Read it before revisiting.

---

## 8. The open defect

**The verdict is not deterministic at temperature 0.** Turalio returned `do_not_advance`
three times and `cannot_conclude` three times across six single calls — a coin. A fixed
`thinkingBudget` of 4096 flips exactly as -1 does, so there is no configuration fix.

`consensus.ts` is the mitigation and it works: five consensus decisions of three runs
each returned the same answer 5/5, and reported `2/3-SPLIT` on four of them, so the
reader is told when it was close. **The split flag is not yet surfaced in the UI.** It
travels in the API response as `consensus` on the adjudicate route.

---

## 9. Presentation guidance

The ask was ten slide metrics in the high 80s / low 90s. Some cannot honestly get there
and some are already at 100% for the wrong reasons — that tension is unresolved and the
person presenting should decide it, not the harness.

- **Do not put a bare 100% on a slide.** Always with n and the interval: "100% (8 cases,
  95% CI 68–100%)" survives a question that "100%" does not.
- **Lead with counterfactual sensitivity for the verdict.** It is the only verdict metric
  that cannot be scored well by a system that ignores the evidence.
- **Lead with 96.2% cited-a-correct-page for Ask**, not the keyword score.
- **The strongest slide is not a percentage.** Building this evaluation found three real
  defects the app's own tests missed: every PDF upload was silently refused (PyMuPDF
  printing to stdout), the document gate admitted the one document it was written to
  reject, and the verdict is a coin flip on borderline cases. That is much harder to
  dismiss than any number.
