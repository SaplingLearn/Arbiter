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
**zero-width** interval at p = 1.0, which would claim a rate measured on 8 cases is known
perfectly (Wilson 1927; Brown, Cai & DasGupta 2001, *Statistical Science* 16(2)).

### Ask — `results/model-comparison/ask-eval-gemini-3.5-flash.json`

| # | Metric | Result | n | 95% CI |
|---|---|---|---|---|
| 1 | Finds the passage (hit@16) | **95.2%** (99/104) | 104 | 89.2–97.9% |
| 2 | Gets the fact right (judged) | **83.7%** (87/104) | 104 | 75.4–89.5% |
| 3 | Points to a correct page | **94.2%** (98/104) | 104 | 88.0–97.3% |
| 4 | Says when it cannot answer | **97.0%** (32/33) | 33 | 84.7–99.5% |
| 5 | Same answer however you ask | **87.5%** (35/40) | 40 | 73.9–94.5% |

0 errors. Mean citation recall 85.6%, precision 40.4%, MRR 0.548. `statedFactRate` is 98.1% — the saturated regex screen finally moved off 100% once the corpus doubled, which is the clearest evidence yet that its old 100% was a property of the fixture and not of the system.

**No Ask metric is 100%, and neither is the regex screen any more.** That was not achieved
by re-rolling: it is what happened when the corpus grew from 14 documents to **31** and the
fixture from 69 items to **137**. Metric 4 was 16/16 on the original corpus; the added
documents produced a real refusal failure (§4). Every figure here is from a single run.

### Verdict — `verdict-five-gemini-3.5-flash.json`, consensus of 3

| # | Metric | Result | n | 95% CI |
|---|---|---|---|---|
| 1 | Verdict is right | 100% (8/8) | 8 | 67.6–100% |
| 2 | Prose stays inside the evidence | 100% (8/8) | 8 | 67.6–100% |
| 3 | Names the deciding rule | 100% (8/8) | 8 | 67.6–100% |
| 4 | Names every gap | 100% (8/8) | 8 | 67.6–100% |
| 5 | Runs agree (unanimous) | 100% (8/8) | 8 | 67.6–100% |

**These five are the weak point of this scoreboard, and the weakness is n, not the
model.** At n=8 the lower bound is 67.6%: 8/8 is consistent with a true rate anywhere from
about two-thirds upward. Quote them only as *"100% (8 cases, 95% CI 68–100%)"*. §5 says
what would fix it and why I did not do it here.

### Supporting — counterfactual minimal pairs

**83.3% (5/6), 95% CI 43.6–97.0%, 0 stuck, 0 base-only.**

Lead with this one. It is the only verdict result a system that ignores the evidence
cannot score well on: each pair edits exactly one fact and requires the verdict to move
with it. **0 stuck** is the important half — the model changed its answer when the
evidence changed rather than anchoring on its first read.

---

## 2. What explains metric 2

83.7% is not uniform, and the decomposition is more useful than the headline.

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
of the time, while only 83.7% state the fact correctly. **The gap is the synthesis step,
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

**The verdict five need n, and n needs a reviewer.** They are now the only part of this
scoreboard that has not grown: Ask went from 53 to 104 answerable items and its metrics
moved off 100% as a result, while the verdict fixture stayed at 8. Going to ~30 cases would
move the lower bound from 68% to roughly 88% *if the model kept its record*, and would
surface real failures if it did not. Either outcome is better than 8/8.

I did not do it, deliberately. Metric 3 scores **which rule the adjudicator names as
deciding**, and in any realistic case both R2 (exposure) and R3 (reversibility) key off
facts that are present, so isolating a single unambiguous deciding rule is genuinely hard.
Authoring a case and keying it R2 when R3 is equally defensible marks the model wrong for
being right, and injects a false failure straight into a reported number. That is the trap
`HANDOFF-evaluation.md` §7 documents four times over. **Expanding this fixture is an hour
of work for someone with tox background to review the keys**, and it is the highest-value
hour available on this project.

**I did not loop until the numbers looked good.** Re-running until a figure lands in a
target band makes it a property of how many times it was rolled. Every number here is from
a single run. The Ask metrics moved off 100% because the corpus got harder, which is the
only legitimate way that happens.

**`judgeCorrect` is self-graded.** The same model family answers and grades. The question
is narrow — "does this answer state the fact this quote states" — but the credible version
has a human grade ~20 answers so Cohen's κ can sit beside the 81.5%.

**`statedFactRate` reads 100% and should not be quoted.** It is a `mustContain` regex; 34
of 54 patterns are a single word, one fires on the bare word "liver", and an answer stating
the opposite passes. It is in the JSON as a free deterministic floor and nothing more.

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
| Variance by direction | 43.8% · 21.8% · 18.9% · 14.6% · 0.8% |
| **Effective rank** | **3.37 of 5** |
| retrieval ↔ answer cited a gold page | **r = 0.908** |
| judge correct ↔ retrieval | **r = 0.144** |
| regex screen ↔ retrieval | r = −0.031 |

Two things fall out, and both are worth saying on a slide.

**Metrics 1 and 3 are largely the same measurement.** At r = 0.908 they are close to
redundant: the model very rarely fails to cite a gold page that retrieval surfaced, so
metric 3 is mostly reporting the retriever's success rather than the answer's. On the
previous, smaller corpus they were perfectly collinear at r = 1.000 — the extra documents
broke the tie, which is itself a demonstration of why n matters.

**Metric 2 is nearly independent of retrieval, at r = 0.144.** Whether the right page was
found barely predicts whether the fact came out right. That is the quantitative form of the
claim in §2: the gap is synthesis, not search. It also means metric 2 is the metric
carrying the most information that the others do not.

So the ten-bar scoreboard measures roughly **three** independent properties — can it find
the evidence, can it reason correctly over it, and a weaker third around citation
precision. Present it that way and the numbers get harder to dismiss, not easier.

---

## 7. If you are presenting this

- **Never a bare 100%.** The five verdict metrics are the only 100%s left, and each must
  travel as "100% (8 cases, 95% CI 68–100%)".
- **Say n on every slide.** 8/8 and 77/81 are both "high"; only one is a measurement.
- **Lead Ask with 95.1% cited a correct page**, then use §2 to own 81.5% rather than bury
  it. "Near-solved at locating a stated value, weaker at synthesising a qualitative
  judgement" tells a reviewer exactly where the product is and is not ready.
- **Lead Verdict with counterfactual sensitivity, 83.3%, 0 stuck** — not with the 100%s.
  It is the one number a system ignoring the evidence cannot fake.
- **The strongest slide is not a percentage.** This evaluation found four real defects the
  test suite missed: every PDF upload silently refused, the document gate admitting the one
  document it was written to reject, the verdict being a coin flip on borderline cases, and
  `ask-eval.ts` never calling `loadEnv()` so it could not read `.env` at all. A fifth is
  organisational: the reported evaluation artifacts were never committed and were one
  machine away from being lost.

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
