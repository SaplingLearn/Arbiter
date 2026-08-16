# The ten benchmarks — measured

All ten are measured. Run 2026-08-16 on `gemini-3.5-flash` via Vertex AI with
Application Default Credentials, over a corpus of 21 regulatory review documents and a
104-item question fixture. Every figure below is read from JSON a harness wrote; none is
transcribed. `tools/plot_benchmarks.py` draws the figures from the same files.

**Figures:** `results/figures/benchmarks-ten.png`, `benchmarks-ask-topics.png`,
`benchmarks-coverage.png`.

---

## 1. The ten

Intervals are 95% Wilson score intervals. Not the normal approximation: it returns a
**zero-width** interval at p = 1.0, which would claim a rate measured on 8 cases is known
perfectly (Wilson 1927; Brown, Cai & DasGupta 2001, *Statistical Science* 16(2)).

### Ask — `results/model-comparison/ask-eval-gemini-3.5-flash.json`

| # | Metric | Result | n | 95% CI |
|---|---|---|---|---|
| 1 | Finds the passage (hit@16) | **95.1%** (77/81) | 81 | 88.0–98.1% |
| 2 | Gets the fact right (judged) | **81.5%** (66/81) | 81 | 71.7–88.4% |
| 3 | Points to a correct page | **95.1%** (77/81) | 81 | 88.0–98.1% |
| 4 | Says when it cannot answer | **95.7%** (22/23) | 23 | 79.0–99.2% |
| 5 | Same answer however you ask | **86.7%** (26/30) | 30 | 70.3–94.7% |

0 errors. `answeredRate` 100%. Mean citation recall 85.2%, precision 42.5%, MRR 0.542.

**No Ask metric is 100%.** That is the material change from the previous run, and it was
not achieved by re-rolling — it is what happened when the corpus grew from 14 documents to
21 and the fixture from 69 items to 104. Metric 4 was 16/16 before; the seven added
documents produced a real refusal failure (§4).

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

81.5% is not uniform, and the decomposition is more useful than the headline.

| Topic | Judged correct |
|---|---|
| NOAEL | **96%** (25/26) |
| NOAEL not established | 100% (3/3) |
| NOAEL disputed by the reviewer | 100% (2/2) |
| NOAEL for liver toxicity | 100% (2/2) |
| Stated absent study | 100% (2/2) |
| Organ-level reversibility | 100% (1/1) |
| Nonclinical scope | 100% (2/2) |
| Reversibility | **80%** (16/20) |
| Liver findings | 75% (3/4) |
| Liver | **60%** (9/15) |
| Safety margins | 50% (1/2) |
| Clinical reversibility | 0% (0/2) |

Retrieval reaches a gold page 95.1% of the time and the answer cites a correct page 95.1%
of the time, while only 81.5% state the fact correctly. **The gap is the synthesis step,
not the search.** Ask is near-solved at locating a single stated scalar — NOAEL, 25 of 26,
including the three cases where the reviewer *rejects* the sponsor's number. It is weaker
where the answer is a qualitative judgement synthesised across several studies and then
scoped correctly, which is what the liver and reversibility questions are.

The bottom rows carry n=1 to n=4 and are texture, not claims — the interval on
`clinical-reversibility` runs to 65.8%.

---

## 3. What the benchmark is measured on

21 documents, 104 questions. `benchmarks-coverage.png` draws both panels.

**Toxicity outcome of the drug.** 13 with no liver warning · **6 with a boxed hepatic
warning** · **2 withdrawn from the US market for liver injury** (Kynamro 2019, Ocaliva).
Before this work it was 13 / 1 / 0 — a single drug whose outcome was hepatic, which meant
a system could score well on every liver question without ever being asked about a drug
the liver findings turned out to be right about.

The seven added are Iclusig, Stivarga, Ocaliva, Jynarque, Aubagio, Yondelis and Kynamro,
fetched from `accessdata.fda.gov` by application number and chosen for **outcome** rather
than findings. Four of seven are non-oncology; Kynamro is an antisense oligonucleotide;
all are 2012–2018 `PharmR`-format reviews that are partly scanned, so era, format and
machine-readability vary too (52%–100% of pages carry text).

**Availability of the information.** 79 answerable · 23 the document cannot answer · 2
where a study was *not done and the document says why*. The third class is scored
**answerable**, not as a refusal: *not applicable* is not *missing*, and scoring
ponatinib's "Carcinogenicity studies were not completed because of the short
life-expectancy of CML and Ph+ ALL patients" as a refusal would teach the opposite of the
rule the product depends on.

Every one of the 23 unanswerable items was verified by a zero-hit search over the full
extracted text. Two candidates were rejected during this extension — `juvenile` and
`hERG` for ponatinib, both actually present.

---

## 4. The failures, named

A scoreboard that lists only rates is not auditable. Every miss:

**Metric 4, the one refusal failure — `reg-abuse-unanswerable`.** "Was abuse or dependence
potential assessed nonclinically?" against the Stivarga review. `abuse liability` returns
zero hits in that document, so the correct answer is to decline; the model answered.

That single item is also a warning about the result file. `items[].answerable` records
whether the model **produced an answer**, not what the item is — `ask-eval.ts` line 186
sets `refused: kind === "unanswerable" ? !answerable : null`. Filtering on `answerable`
instead of `kind` moves this failure out of the refusal denominator and into the
answerable one, turning 22/23 into 22/22 and reporting a bare 100% that is not true. Key
off `kind`.

**Metric 1 and 5, the four retrieval misses.** `tur-liver-b` and `lumakras-liver-b` are
both *"does this drug damage the liver?"*; `pona-reversible-b` and `reg-reversible-b` are
both *"Did the … recover after dosing stopped?"*. So the four misses are **two phrasings**,
each failing on two independent documents while their sibling phrasings retrieve
correctly. That is two reproducible vocabulary gaps in the retriever, not four unrelated
failures, and it is exactly what metric 5 exists to surface.

**Metric 2, the 15 judged wrong.** Concentrated in `liver` (6 of 15) and `reversibility`
(4 of 15) — see §2.

---

## 5. What would make this stronger, and what I refused to do

**The verdict five need n, and n needs a reviewer.** Going from 8 cases to ~30 would move
the lower bound from 68% to roughly 88% *if the model kept its record*, and would surface
real failures if it did not. Either outcome is better than 8/8.

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

## 6. If you are presenting this

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

## 7. Reproducing all of it

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
