# The ten benchmarks — measured

All ten are measured. Run 2026-08-16 on `gemini-3.5-flash` via Vertex AI with
Application Default Credentials, over a corpus of **31 regulatory review documents** and a
**137-item** question fixture (104 answerable, 33 unanswerable). Every figure below is read from JSON a harness wrote; none is
transcribed. `tools/plot_benchmarks.py` draws the figures from the same files.

**Figures:** `results/figures/benchmarks-ten.png`, `benchmarks-ask-topics.png`,
`benchmarks-coverage.png`, `benchmarks-structure.png`.

---

## 1. The ten

Intervals are 95% Wilson score intervals. Not the normal approximation: it returns a
**zero-width** interval at p = 1.0, which would claim a rate measured on 16 cases is known
perfectly (Wilson 1927; Brown, Cai & DasGupta 2001, *Statistical Science* 16(2)).

**Every number below is recomputed from the committed JSON by
`node tools/verify_scoreboard.mjs`, which also cross-checks that the Ask and retrieval
results come from the same fixture.** Nothing here is transcribed.

### Ask — 31 documents, 137 questions

| # | Benchmark | Result | n | 95% CI |
|---|---|---|---|---|
| 1 | Finds the passage (hit@16) | **95.2%** | 99/104 | 89.2–97.9% |
| 2 | Gets the fact right (judged) | **84.6%** | 88/104 | 76.5–90.3% |
| 3 | Points to a correct page | **94.2%** | 98/104 | 88.0–97.3% |
| 4 | Says when it cannot answer | **93.9%** | 31/33 | 80.4–98.3% |
| 5 | Same answer however you ask | **87.5%** | 35/40 | 73.9–94.5% |

0 errors. Mean citation recall 88.5%, precision 39.9%, MRR 0.548.

### Verdict — 16 constructed cases, consensus of 3

| # | Benchmark | Result | n | 95% CI |
|---|---|---|---|---|
| 1 | Verdict is right | **87.5%** | 14/16 | 64.0–96.5% |
| 2 | Prose stays inside the evidence | **91.7%** | 11/12 | 64.6–98.5% |
| 3 | Names the deciding rule | **92.9%** | 13/14 | 68.5–98.7% |
| 4 | Runs agree (consensus of 3) | **87.5%** | 14/16 | 64.0–96.5% |
| 5 | Tracks a changed fact | **83.3%** | 5/6 | 43.6–97.0% |

**0 stuck, 0 base-only** on the counterfactual pairs.

**No benchmark is 100%.** The range is 83.3% to 95.2%. That was not achieved by re-running
anything — every figure is from a single run. The Ask metrics came off 100% when the
corpus grew from 14 documents to 31, and the verdict metrics when the fixture grew from 8
cases to 16 with cases built to be failable.

### Two things to say out loud

**Verdict 2 and 3 are scored over 12 and 14, not 16.** Four cases declare no absent field
for the prose to over-claim, and two key no deciding rule, so those cases cannot fail
those metrics. Counting them would inflate the **denominator**, which misleads more than
inflating the rate: it claims a sample that was never taken.

**Gap recall was the old fifth verdict metric and is deliberately gone.** It could not
fail. §5 sets out why, and counterfactual sensitivity — which no system ignoring the
evidence can score well on — takes the slot.

---

## 2. What explains metric 2

84.6% is not uniform, and the decomposition is more useful than the headline.

| Topic | Judged correct |
|---|---|
| Target organs of toxicity | 100% (8/8) |
| NOAEL not established | 100% (3/3) |
| NOAEL disputed by the reviewer | 100% (2/2) |
| NOAEL for liver toxicity | 100% (2/2) |
| Stated absent study | 100% (2/2) |
| Clinical liver findings | 100% (2/2) |
| Nonclinical scope · ocular · general findings | 100% (5/5) |
| NOAEL | **94%** (32/34) |
| Reversibility | **75%** (15/20) |
| Liver findings | 75% (3/4) |
| Liver | **65%** (11/17) |
| Safety margins | 50% (1/2) |
| Clinical reversibility | 0% (0/2) |

Retrieval reaches a gold page 95.2% of the time and the answer cites a correct page 94.2%
of the time, while only 84.6% state the fact correctly. **The gap is the synthesis step,
not the search** — and §6 makes that quantitative rather than rhetorical.

Ask is near-solved wherever the answer is a value or a list to be located and repeated:
NOAEL 32 of 34, target organs 8 of 8, and 100% on every question about a study that was
*not done*. It is weaker where the answer is a qualitative judgement synthesised across
several studies and then scoped correctly — liver 11 of 17, reversibility 15 of 20. Those
two topics carry **11 of the 17 failures**.

The bottom rows carry n=2 to n=4 and are texture, not claims.

---

## 3. What the benchmark is measured on

31 documents, 137 questions. `benchmarks-coverage.png` draws both panels.

**Toxicity outcome of the drug, as a ladder with every rung populated:**

| Rung | Documents |
|---|---|
| No warning | 13 |
| Warning, not boxed | 8 |
| Boxed warning, non-hepatic | 3 |
| Boxed hepatic warning | 5 |
| **Withdrawn from the market for liver injury** | **2** |

**18 of 31 documents have a toxic outcome, up from 1 of 14** when this work started. A
corpus of only approvals measures willingness to say "fine"; a corpus of only hepatotoxic
drugs measures willingness to say "danger". This one has both, so neither reflex scores
well.

The three non-hepatic boxed warnings matter beyond the count: Tibsovo, Idhifa and Xospata
are boxed for **differentiation syndrome**, a mechanism with nothing to do with the liver,
so "toxic outcome" is not a synonym for "hepatic" in this set. Alpelisib adds severe
hyperglycaemia and Stevens-Johnson, zanubrutinib haemorrhage, erdafitinib ocular toxicity.

**The axis that makes this a test of Arbiter rather than of pharmacology** is whether the
nonclinical package predicts the outcome at all. Iclusig carries a boxed hepatotoxicity
warning clinically, yet its nonclinical package reports transaminase rises with *no
microscopic correlate* that *reversed during recovery*. Yondelis reports liver necrosis
that *"persisted through the recovery period in many studies"*. Same question, opposite
answers, both verbatim — so the corpus tests whether Ask reports what the document says
rather than what the drug is famous for.

Other variation: four of the seven `PharmR`-era additions are non-oncology; mipomersen is
an antisense oligonucleotide and nipocalimab a monoclonal antibody; era and format span
2012–2018 `PharmR` and 2019+ multidiscipline; machine-readability runs 52% to 100% of
pages carrying text; two regulators.

**Availability of the information.** 102 answerable · 33 the document cannot answer · 2
where a study was *not done and the document says why*. The third class is scored
**answerable**: *not applicable* is not *missing*, and scoring ponatinib's
"Carcinogenicity studies were not completed because of the short life-expectancy of CML
and Ph+ ALL patients" as a refusal would teach the opposite of the rule the product
depends on.

Six of the ten newest documents never mention NOAEL — oncology programmes often
characterise a highest non-severely-toxic dose instead. That is not a gap in the corpus but
six free unanswerable items whose absence is a property of the document rather than of the
question. All 33 unanswerable items are backed by a zero-hit search over the full extracted
text; four candidates have been rejected that way across the two extensions, including
`juvenile` and `hERG` for ponatinib, both actually present.

---

## 4. The failures, named

A scoreboard that lists only rates is not auditable.

**Metric 4, the one refusal failure — `reg-abuse-unanswerable`.** "Was abuse or dependence
potential assessed nonclinically?" against the Stivarga review. `abuse liability` returns
zero hits in that document, so the correct answer is to decline; the model answered.

That single item is also a warning about how to read the result file. `items[].answerable`
records whether the model **produced an answer**, not what the item is — `ask-eval.ts` line
186 sets `refused: kind === "unanswerable" ? !answerable : null`. Filtering on `answerable`
instead of `kind` moves this failure out of the refusal denominator and into the answerable
one, reporting a bare 100% that is not true. **Key off `kind`.**

**Metrics 1 and 5, the five retrieval misses.** `tur-liver-b` and `lumakras-liver-b` are
both *"does this drug damage the liver?"*. `pona-reversible-b` and `reg-reversible-b` are
both *"Did the … recover after dosing stopped?"*. So four of the five misses are **two
phrasings**, each failing on two independent documents while their sibling phrasings
retrieve correctly — two reproducible vocabulary gaps in the retriever, not four unrelated
failures, which is exactly what metric 5 exists to surface. The fifth, `gil-target-b`
("Which organs did toxicology identify as affected?"), is a third instance of the same
shape.

**Metric 2, the 17 judged wrong.** `liver` 6, `reversibility` 5, `clinical-reversibility`
2, `noael` 2, `liver-findings` 1, `margins` 1. Eleven of seventeen are the two synthesis
topics.

---

## 5. What would make this stronger, and what I refused to do

**Gap recall was the fifth verdict metric and was removed, not merely excluded.** It could
not fail, for three reasons that compound. The prompt hands the model the answer — the
template renders `{{absent}}` as "<field> - blocks: <what it blocks>", so both the gap
names and their justifications are supplied before it reasons. `missing.field` is then
enum-constrained to exactly that list, so an invented gap has nowhere to go. And a
*dropped* gap raises `absence_not_addressed` in `verifyAdjudication`, which returns 502 —
so the case scores zero on **every** metric rather than on this one. There is no path
where an adjudication is scored and gap recall alone is false.

It is a real guarantee about the schema and the validator, and the run still reports how
many gaps were named and dropped. As a percentage beside four measurements it read as a
fifth success and flattered them. Gap **detection** is a real capability and is measured —
by Ask metric 4, where 33 unanswerable items are backed by a zero-hit search over the
whole document and nothing is supplied in advance.

**The verdict fixture went from 8 cases to 16, and the new eight were built to fail.**
They are set against the surface reading: clean animal data at 30x that must lose to one
human finding at clinical exposure; irreversible damage that must still advance at 80x; a
finding near clinical exposure defused only by reversibility. They are keyable because
`adjudicate.ts` puts each rule's *strength* in the prompt (R1 0.9, R2 0.8, R3 0.7), so a
conflict resolved by the stronger rule follows from the input rather than from opinion.

**Two of the four verdict failures rest on keys I authored.**
`hard-r3-defuses-near-clinical` expects `advance` for a finding at 1.3x that fully
reversed; the model abstained. `hard-conflicting-human-systems` expects `cannot_conclude`
where two human systems disagree; the model said `do_not_advance`. Both returned 2/3
agreement, so the model was not confident either. **Conceding both would return metric 1
to 16/16**, and that dependency travels with the number. An hour from someone with tox
background reviewing the keys is what settles it, and it remains the highest-value hour
available on this project.

By contrast **metric 4 (runs agree) depends on no key at all** — the correct behaviour is
self-evidently consistency — which makes it the most trustworthy of the five.

**I did not loop until the numbers looked good.** Every figure is from a single run. The
Ask metrics came off 100% because the corpus doubled; the verdict metrics because the
fixture did and the new cases were built to be failable. Re-running until a figure lands
in a target band makes it a property of how many times it was rolled.

**`judgeCorrect` is self-graded.** The same model family answers and grades. The credible
version has a human grade ~20 answers so Cohen's κ can sit beside the 84.6%.

**`statedFactRate` reads 98.1% and should not be quoted.** It is a regex screen; 34 of 54
patterns are a single word and an answer stating the opposite passes. It moved off exactly
100% for the first time when the corpus doubled, which is the clearest evidence that its
old 100% was a property of the fixture.

**The retrieval change on this branch is not measured by any of the ten.** `8d66975` widened
the extraction query from the checklist `field` alone to `field + searchTerms`, and added
those terms to `rules/evidence-checklist-v1.0.json`. It is a real change to product
behaviour, and none of the ten benchmarks touch it: `retrieval-eval.ts` searches with the
**fixture question** at k=16, while `extract.ts` is the only caller that uses `searchTerms`,
at `perItem=6`. So metric 1's 95.2% neither validates the change nor is affected by it.
The change also ships with no test. Its justifying comment says a stray term "costs a
discarded proposal, never a wrong finding" — true about precision, and silent about the
other direction: with only six slots, an added term can displace the correct passage out
of the top six, and a displaced passage is reported as a **gap the document does not have**,
which is the failure the change was made to remove.

**The end-to-end file is a *before* measurement, and is not one of the ten.**
`results/model-comparison/verdict-endtoend-gemini-3.5-flash.json` was written at `b5ead3a`
(19:38), an hour before the retrieval change at `8d66975` (20:39), and was never
regenerated — so it records the behaviour that change was meant to fix, not its effect.
Read it with two things in mind: `sensitivity` is `k=0, n=0`, meaning **no hepatotoxic case
was ever scored**, and `verdict-endtoend-eval.ts:179` sets `flagged = verdict ===
"do_not_advance"`, so `cannot_conclude` counts as a correct negative. Both scored rows
abstained. A system that abstains on everything scores 2/2 specificity here. No number in
§1 comes from this file, and §8 does not list it, but it is committed and it invites being
read as a result.

**One cross-check in `verify_scoreboard.mjs` did not run.** `verdict-five-eval.ts` writes
`scoredMetrics` and `guaranteedNotMeasured` as of `cef9ac3` (19:22); the committed
`verdict-five-*.json` was last written at `b1e505e` (19:14) and has neither. The gap-recall
guard keys off `scoredMetrics`, so against that file it silently no-ops while the tool
prints "OK - no drift found". The guard now reports this as a stale-provenance warning
rather than passing in silence. Every headline in §1 still recomputes from the raw rows —
that was checked item by item — but the file is older than the harness that describes it,
and it still carries `score.gaps` from before gap recall was reclassified.

---

## 6. How many independent things do these ten actually measure?

`benchmarks-structure.png`, from `tools/plot_structure.py`. Ten bars invite the reading
that ten distinct properties were verified. That is a claim about the **rank** of the
evaluation, and it is checkable.

Build the design matrix X (104 x 5): one row per answerable item, columns being the
per-item signals the harness records — retrieval reached a gold page, the judge called it
correct, the answer cited a gold page, the regex screen fired, citation precision. Centre,
standardise, and take the singular values. Variance shares are the squared singular values;
effective rank is the participation ratio (sum lambda)^2 / sum lambda^2, which asks how
many directions carry real weight without an arbitrary variance cut-off.

| | value |
|---|---|
| Variance by direction | 44.2% · 21.8% · 19.0% · 14.1% · 0.8% |
| **Effective rank** | **3.34 of 5** |
| retrieval ↔ answer cited a gold page | **r = 0.908** |
| judge correct ↔ retrieval | **r = 0.153** |
| regex screen ↔ retrieval | r = −0.031 |

Two things fall out, and both are worth saying on a slide.

**Metrics 1 and 3 are largely the same measurement.** At r = 0.908 they are close to
redundant: the model very rarely fails to cite a gold page that retrieval surfaced, so
metric 3 is mostly reporting the retriever's success rather than the answer's. On the
previous, smaller corpus they were perfectly collinear at r = 1.000 — the extra documents
broke the tie, which is itself a demonstration of why n matters.

**Metric 2 is nearly independent of retrieval, at r = 0.153.** Whether the right page was
found barely predicts whether the fact came out right. That is the quantitative form of the
claim in §2: the gap is synthesis, not search. It also means metric 2 is the metric
carrying the most information that the others do not.

So the ten-bar scoreboard measures roughly **three** independent properties — can it find
the evidence, can it reason correctly over it, and a weaker third around citation
precision. Present it that way and the numbers get harder to dismiss, not easier.

---

## 7. If you are presenting this

- **Nothing is 100%.** The ten run from 83.3% to 95.2%, each with n and a Wilson interval.
- **Say n on every slide.** 14/16 and 99/104 are both "high" and only one is well-powered:
  lower bounds of 64% and 89%.
- **Lead Ask with 95.2% finds the passage and 94.2% cites a correct page**, then own 84.6%
  with the §2 decomposition rather than burying it: near-solved at locating a stated value,
  weaker at synthesising a qualitative judgement across studies.
- **Lead Verdict with metric 5, "tracks a changed fact", 83.3% with 0 stuck.** It is the
  only verdict result a system ignoring the evidence cannot score well on. Its interval is
  wide because n=6 — if pressed on the number, answer with "0 stuck", which is qualitative
  and does not depend on n.
- **Verdict 2 and 3 have denominators of 12 and 14, not 16**, because four cases cannot
  fail the prose check and two key no deciding rule. Say so before someone asks.
- **The strongest slide is not a percentage.** This evaluation found five real defects the
  test suite missed: every PDF upload silently refused; the document gate admitting the one
  document it was written to reject; the verdict being a coin flip on borderline cases;
  `ask-eval.ts` never calling `loadEnv()` so it could not read `.env` at all; and a metric
  that could not fail being reported as a success for months.

---

## 8. Reproducing all of it

```bash
python data/prep/fetch_reviews.py            # 21 documents from FDA and EMA, ~230 MB
npx tsx tools/warm_library_cache.ts          # extraction caches
npx tsx tools/validate_fixture.ts --score    # quotes verbatim + retrieval, NO model needed
npm run retrieval:eval                       # metrics 1 and 5, no model
npm run ask:eval                             # metrics 2, 3, 4  (~185 calls, ~50 min)
npx tsx services/api/verdict-five-eval.ts    # the verdict five
npx tsx services/api/counterfactual-eval.ts  # counterfactual sensitivity
python tools/plot_benchmarks.py              # the three figures
```

Credentials are ADC plus `ARBITER_GCP_PROJECT`; there is no API key for this path and the
handoff §1.2 explains why. The project used was `project-7f4f8910-63be-4b85-a67`, the only
one of the account's three with `aiplatform.googleapis.com` enabled.

The retrieval half needs **no credentials at all**, and it reproduces exactly: scoring only
the original 14 documents returns hit@16 96.2%, recall 91.5%, MRR 0.529 and stability
33.7% — every figure the previous run committed, to the decimal, from a corpus downloaded
from nothing.
