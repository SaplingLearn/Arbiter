# The evaluation dataset

What Arbiter is measured on, how varied it actually is, and — the part most dataset
descriptions leave out — **where the variety runs out**. Every number here is produced by
a harness in this repo and can be re-derived; none is transcribed from a past run.

---

## 1. In one line

**23 real regulatory review documents** — the original 16, plus the seven added in §8 —
expanded to **42 documents** for the upload gate, carrying **104 questions with 127
human-verified quotes** for the Ask surface and **23 cases** for the verdict surface.

Of those 104: **81 answerable, 23 unanswerable**, over **21 documents**. §2 and §4 below
describe the original 16 and their 55 questions and have not been rewritten — they are the
record of what was measured when the committed Ask numbers were produced. §8 is the
extension, and the counts in this paragraph are the current totals.

---

## 2. The source documents

| Document | Pages | Chars/page | Regulator |
|---|---:|---:|---|
| retevmo (selpercatinib) | 398 | 2,258 | FDA |
| exkivity (mobocertinib) | 292 | 2,122 | FDA |
| krazati (adagrasib) | 288 | 2,197 | FDA |
| lumakras (sotorasib) | 269 | 2,068 | FDA |
| turalio (pexidartinib) | 264 | 2,185 | FDA |
| inrebic (fedratinib) | 257 | 2,039 | FDA |
| orgovyx (relugolix) | 250 | 2,305 | FDA |
| trikafta (elexacaftor/tezacaftor/ivacaftor) | 245 | 2,419 | FDA |
| qinlock (ripretinib) | 233 | 2,117 | FDA |
| nubeqa (darolutamide) | 203 | 2,219 | FDA |
| tazverik (tazemetostat) | 189 | 2,295 | FDA |
| xpovio (selinexor) | 188 | 1,925 | FDA |
| imaavy / nipocalimab | 178 | 2,780 | **EMA** |
| troglitazone (Rezulin) | 133 | 1,221 | FDA, **1997** |
| modern-fda-211367 | 132 | 2,102 | FDA |
| tolcapone (Tasmar) | 48 | **0** | FDA, **1998** |

### Where the variety actually lives

**Therapeutic area.** Solid-tumour oncology (krazati, lumakras, retevmo, exkivity,
qinlock, tazverik), haematology (inrebic, xpovio), prostate cancer (nubeqa, orgovyx),
cystic fibrosis (trikafta), tenosynovial giant cell tumour (turalio), myasthenia gravis
(nipocalimab), narcolepsy (TAK-994, the probe case), contraception (slynd), Parkinson's
(tolcapone), type 2 diabetes (troglitazone). Risk tolerance differs enormously across
these — an oncology package and a contraceptive package are not judged on the same scale,
and both are in here.

**Modality.** Mostly small molecules, but nipocalimab is a **monoclonal antibody**, which
matters structurally: four checklist items (transporter inhibition, reactive metabolite,
and others) are *not applicable* to a biologic. That case exercises the
"not applicable ≠ missing" distinction, which a small-molecule-only corpus never touches.

**Era and format — two clusters, not a spread.** Read from the documents themselves:
**two** are late-1990s (troglitazone 1997; tolcapone 1998, taken from catalogue metadata
because the document is scanned and nothing is extractable) and **fourteen** are 2018–2025,
mostly 2019–2022 approvals. There is a twenty-year hole between them. An earlier draft of
this file described the range as "1997–2023", which implied a continuous spread and was
wrong. The two old documents are still valuable — they predate the multidiscipline format,
so headings, vocabulary and scan quality all differ — but they are two documents, not an era.

**Regulator.** FDA plus one EMA EPAR, which uses different section names and a different
report structure.

**Machine-readability.** 0 to 2,780 characters per page. Tolcapone is 48 pages of scanned
images with **zero** extractable text — an entire failure mode that a corpus of clean PDFs
cannot represent.

**Length.** 48 to 398 pages, an 8× spread.

**Outcome.** Approved (12), approved **with a hepatotoxicity boxed warning and a REMS**
(turalio), **restricted** (tolcapone), **withdrawn for hepatotoxicity** (troglitazone).

---

## 3. Derived documents: 16 → 42

Real negatives are the hard part of any dataset, so 26 more were **derived by ablation**
from the genuine reviews rather than written by hand. Synthetic text would only prove the
gate can read words someone chose for it.

| Shape | Count | What it is | Gate must |
|---|---:|---|---|
| Full review | 14 | As published | accept |
| `-nonclinical-only` | 13 | The tox chapter alone — a standalone Pharmacology/Toxicology Review, the pre-multidiscipline FDA format and the shape of a sponsor's own report | accept |
| `-clinical-only` | 13 | The same review with its tox chapter **deleted** — real clinical and labelling prose that cannot support a safety call | refuse |
| Unreadable | 1 | Scanned images, zero text | refuse |
| Not a review | 1 | Readable, but a labelling supplement | refuse |

The two ablations pull in opposite directions on purpose. `-clinical-only` catches a gate
that waves everything through; `-nonclinical-only` catches a gate that has learned
"chapter boundary" as a proxy for "review" — and it did. Requiring a chapter refused all
thirteen standalone tox reviews and dropped recall from 1.000 to 0.519. **That failure was
only visible because the dataset contained a document shape the thresholds were not tuned
on**, which is the single strongest argument for building it this way.

---

## 4. The question set (Ask)

**As originally built: 55 questions over 14 documents, 98 human-verified verbatim quotes**
with page numbers. The table below is that original set, kept because it is what the
committed Ask numbers in `results/ask-eval.json` were measured against. Current totals
after the §8 extension are in the right-hand column.

| Topic | Questions (v2.0) | Now |
|---|---:|---:|
| NOAEL | 19 | 26 |
| Reversibility | 12 + 2 clinical | 20 + 2 clinical + 1 organ-level |
| Liver findings | 12 + 4 | 15 + 4 |
| Exposure margins | 2 | 2 |
| Nonclinical (general) | 2 | 2 |
| NOAEL not established / disputed | — | 3 + 2 |
| NOAEL for liver toxicity | — | 2 |
| Stated absent study | — | 2 |
| **Unanswerable** | **2** | **23** |

Two design choices worth naming:

**Unanswerable items are scored separately and never averaged in.** This is the SQuAD 2.0
shape: a system tested only on questions that have answers has not been tested. A surface
that answers a question its document cannot support is worse than one that answers
nothing, because the reader cannot tell the two apart.

**Questions are grouped by paraphrase.** "What NOAEL was set?" and "no observed adverse
effect level" are the same question to a reviewer, so retrieval stability is measured
inside each group. It currently scores **33.7%** — the weakest number in the whole
evaluation, and a retrieval problem, not a model one.

---

## 5. The verdict cases

Two fixtures, deliberately separate, because they answer different questions.

**Constructed — 9 cases, 20 findings.** Each isolates one decision, so the correct answer
follows from the ruleset rather than from anyone's toxicology opinion. Four are
`cannot_conclude` **by construction**: an empty consequence half, no established exposure
margin, a tie R1 cannot break, and a QSAR outside its own applicability domain. All three
verdict classes are represented — including `advance`, which nothing in the repo had ever
asserted before.

**Real — 14 drugs, 54 findings, every one a verbatim quote with its page.** Findings are
asserted `ambiguous`, never pre-labelled: marking turalio's evidence "toxic" would encode
the answer in the input and score the model for reading it back.

---

## 6. Where the variety runs out

The honest section, and the reason this file exists.

**Three of the five headline rates are 100%, and none of them means what it looks like.**

*States the fact* is a `mustContain` regex drawn from the gold quote. The harness says so
in its own docstring: it "catches an answer that missed the number, not one that
misdescribed it". An answer carrying the right figure inside a wrong sentence passes. It
is a presence check, not a correctness check.

*Same answer twice* is measured at temperature 0 with a deterministic retriever. Zero
flips is the expected result; the row is a plumbing check that would be alarming if it
failed and proves little when it passes.

*Verdict correct* is 100% on nine cases whose answer key was written by the same person
who wrote the cases. It is the most suspect number here and the first that should be
discarded.

**And the verdict n is inflated.** Three repeats of nine cases at temperature 0 are not
twenty-seven independent observations - they measure stability, not breadth. The honest
denominator is 9, which moves the Wilson lower bound from 88% to roughly 70%. Figures
reporting n=27 overstate the sample.

**The informative numbers are the ones below 100%**: MRR 0.529 (the first correct page
lands around rank 2 of 16), paraphrase stability 33.7%, citation recall 81.1%, and
real-drug specificity 12/13. Those describe the system; the 100%s describe the metrics.

**~~Only one drug has a hepatotoxicity outcome.~~ Eight do, as of the v2.1 extension.**
This was the sharpest limit in the whole dataset and it has been addressed directly — see
§8. Turalio was the only one of the original fourteen; seven FDA reviews of drugs whose
*outcome* was hepatic were added beside it, two of them **withdrawn from the US market for
liver injury**.

The survivorship-bias reasoning below still holds for the ORIGINAL fourteen and for any
figure computed over them, so it is kept rather than deleted: approval packages contain
drugs that cleared the bar, and a classifier that always says "advance" scored 13/14 on
that set. Sensitivity computed on the original fourteen is still **a single observation
(n=1), never a rate**. What has changed is that the corpus is no longer confined to it.

**~~The two drugs with genuine negative outcomes cannot supply cases.~~ Two more can, and
now do.** Troglitazone was withdrawn for hepatotoxicity and tolcapone was restricted —
exactly the labels the dataset was short of — and the upload gate refuses both documents,
one scanned and one a labelling supplement. The gate is right to refuse them.

That was the binding constraint, and the fix was not to weaken the gate but to find
withdrawn drugs whose reviews are *readable*. **Kynamro (mipomersen)** was withdrawn in
2019 for hepatotoxicity and **Ocaliva (obeticholic acid)** was withdrawn at FDA's request
after post-marketing liver injury. Both have full FDA pharmacology reviews that extract
cleanly — 67% and 79% of pages carry text — and both are now in the corpus with items
against them. §8.

**DILIrank cannot fill the gap.** It was the obvious external ground truth: 1,336
compounds with DILI-concern labels. Seven of the fifteen drugs here are post-2016
approvals absent from it, six more are `Ambiguous-DILI-concern`, and the only two with
definite labels are — again — tolcapone and troglitazone. **Usable labelled positives:
zero.**

**"FDA label outcome" is a proxy, not the target.** The verdict asks whether the
nonclinical evidence supports advancing; the label records what a regulator concluded
after clinical data, monitoring plans and risk/benefit. These come apart, and there is a
worked example: both models flagged **tazverik**, which has no hepatotoxicity boxed
warning. They were reading real quotes — liver enzymes still elevated in recovery, and
*"deaths occurred even at the low dose of 50 mg/kg (approximately equal to the adult human
exposure)"*, with 25% mortality. That is a defensible read of the nonclinical package.
**The specificity figure is therefore a lower bound**, and its one miss is more likely the
label's construct validity than the model's reasoning.

**Sample sizes are small and the intervals say so.** 53 answerable questions, 9
constructed cases, 14 real drugs. Every rate is reported with a 95% Wilson score interval
rather than a bare percentage, because at n=53 a rate of 100% has a lower bound of 93.2%,
not 100%.

**One therapeutic area dominates.** Six of fourteen are solid-tumour oncology. A corpus
weighted toward oncology is weighted toward high risk tolerance.

---

## 7. What the corpus showed about model choice

Both surfaces were run on `gemini-3.5-flash` and `gemini-3.1-pro-preview` over identical
inputs.

| | flash | 3.1-pro-preview |
|---|---|---|
| Ask — states the fact | 100.0% | 100.0% |
| Ask — citation recall | 81.1% | 82.1% |
| Ask — flips over 3 runs | 0 | 0 |
| **Verdict — constructed cases** | **27/27** | **24/27** |
| Verdict — real drugs, caught turalio | yes | yes |
| Verdict — specificity | 12/13 | 11/12 (+1 error) |
| Latency per Ask item | ~40s | ~90s |

Pro's Ask advantage is +1.0pp on citation recall, which is **less than one item** out of
53. Its verdict deficit is not noise: all three failures are the same case,
`human-tox-over-animal-safe`, in 3 of 3 runs — the R1 case, where human-cell evidence
should defeat a clean animal study and Pro abstained instead. The provider decision of
2026-08-10 recorded `gemini-2.5-pro` failing the same pass mark at R1 75.0%. **Same rule,
different model generation, newer prompt.**

---

## 8. v2.1 — the toxic / non-toxic / incomplete axis, made real

Added 2026-08-16. The question this answers: **are the documents spread across drugs that
turned out toxic, drugs that did not, and documents with incomplete information?** For the
original fourteen the honest answer was "barely" — one boxed warning, thirteen clean
approvals, and the two genuinely-withdrawn drugs unusable. Seven FDA reviews were added to
close that, chosen for their *outcome* rather than their findings.

| Document | NDA | Outcome | Area | Pages | Readable |
|---|---|---|---|---:|---:|
| Iclusig (ponatinib) | 203469 | BOXED: arterial occlusion + hepatotoxicity | oncology | 127 | 52% |
| Stivarga (regorafenib) | 203085 | BOXED: fatal hepatotoxicity | oncology | 219 | 83% |
| Ocaliva (obeticholic acid) | 207999 | BOXED: hepatic decompensation; **WITHDRAWN** | hepatology | 229 | 79% |
| Jynarque (tolvaptan) | 204441 | BOXED: serious liver injury, REMS | nephrology | 111 | **100%** |
| Aubagio (teriflunomide) | 202992 | BOXED: hepatotoxicity + embryofetal | neurology | 238 | 75% |
| Yondelis (trabectedin) | 207953 | hepatotoxicity incl. hepatic failure | oncology | 19 | 74% |
| Kynamro (mipomersen) | 203568 | BOXED: hepatotoxicity, REMS; **WITHDRAWN 2019** | lipidology | 271 | 67% |

Every one was fetched from `accessdata.fda.gov` by its application number and screened with
the same extractor the product uses. What the set buys, beyond the outcome label:

- **Four of seven are non-oncology.** The original corpus was six-of-fourteen solid-tumour
  oncology, and §6 flagged that as a weighting toward high risk tolerance. Hepatology,
  nephrology, neurology and lipidology now sit beside it.
- **A modality nothing else covers.** Mipomersen is an antisense oligonucleotide. The
  corpus previously ran small molecules plus one monoclonal antibody.
- **The twenty-year format hole is partly filled.** These are 2012–2018 `PharmR`-format
  pharmacology reviews, not the 2019+ multidiscipline format — different headings,
  different structure, and *partly scanned*: readability runs 52% to 100%, where the
  modern reviews are essentially all born-digital.
- **A document shape that is not a review at all.** Yondelis is 19 pages, and most of it
  is a director's concurrence memorandum over reviews conducted elsewhere. It still
  carries citable toxicology, and it is the shape the upload gate should be tested on.

### 8.1 The three classes, stated plainly

**Toxic outcome — 8 of 21 documents.** Turalio plus the seven above. Two are withdrawn.

**Non-toxic outcome — 13 of 21.** The original approvals with no liver warning.

**Incomplete information — two distinct kinds, and the distinction matters.**
*At the document level*: slynd is a 505(b)(2) with no nonclinical studies at all, and
Yondelis is a memorandum rather than a study report. *At the question level*: 23
`unanswerable` items, up from 16, each verified by the zero-hit rule in §4 — the term that
would have to appear for the document to answer was searched across the whole extracted
text, and only zero-hit candidates were kept. Two candidates were rejected during this
extension: `juvenile` for ponatinib (it appears in a study-type checklist) and `hERG` for
ponatinib (the assay was actually run).

A third kind is worth separating out because it is **not** incompleteness: a study that was
deliberately not done, where the document says so and says why. Ponatinib's
*"Carcinogenicity studies were not completed because of the short life-expectancy of CML
and Ph+ ALL patients"* and Yondelis's *"Carcinogenicity studies were not conducted and are
not required"* are **answerable** questions about an absence. Scoring them as refusals
would teach exactly the wrong lesson: `not applicable` is not `missing`.

### 8.2 What the new documents let the fixture ask that it could not before

- **A reversibility minimal pair across two documents.** Ponatinib's transaminase
  elevations had *no microscopic correlate* and *"were not present during the recovery
  period"*; Yondelis's liver **necrosis** *"persisted through the recovery period in many
  studies"*. Same question, opposite answer, both verbatim.
- **A NOAEL the reviewer refuses.** Tolvaptan p23: *"According to the sponsor, the NOAEL
  for this study was 30 mg/kg/day. However, it is incorrect"* … *"A NOAEL could not be
  determined for this study."* An answer that quotes 30 mg/kg/day has read the document and
  still got it wrong, which no keyword screen can detect.
- **A NOAEL that does not exist because toxicity started at the lowest dose.**
  Teriflunomide p230, and obeticholic p68.
- **A NOAEL expressed as a bound.** Mipomersen: *"the NOAEL for liver toxicity is
  considered to be < 5 mg/kg/week"*.
- **A drug with a boxed hepatotoxicity warning whose nonclinical package does not
  obviously predict it.** Ponatinib. This is the direct counter to the concern in
  `HANDOFF-evaluation.md` §8 that FDA reviews leak the clinical answer into the
  nonclinical text — here they do not.

### 8.3 Measured, without a model

The retrieval half needs no credentials, so the new documents were scored on this checkout:

```
npx tsx tools/validate_fixture.ts --score ponatinib regorafenib obeticholic \
  tolvaptan teriflunomide mipomersen trabectedin
```

**hit@16 92.9% (26/28), recall@16 92.9%, MRR 0.567**, against 96.2% and MRR 0.529 on the
original fourteen. The new documents are slightly harder, which is the expected direction
for older, partly-scanned reviews and is a reason to keep them.

**Both misses are the same paraphrase.** `pona-reversible-b` and `reg-reversible-b` are
each *"Did the … recover after dosing stopped?"*, and in both documents the sibling
phrasing — *"reversible"*, *"during the recovery period"* — retrieves correctly. That is
one reproducible vocabulary gap in the retriever, found on two independent documents, and
it is precisely the failure metric 5 exists to surface.

The ask half of these items has **not** been run: it needs a model, and this checkout has
no GCP credentials. See `docs/EVALUATION-SCOREBOARD.md` §3.

---

## 9. Reproducing all of it

```bash
python data/prep/gate_eval.py --build   # 42 documents, confusion matrix
npm run retrieval:eval                  # 55 questions, no model needed
npm run ask:eval -- --repeats=3         # needs a model
npx tsx services/api/verdict-eval.ts --repeats=3
npx tsx services/api/verdict-real-eval.ts
python tools/plot_evaluation.py         # figures, from the JSON above
```

The 42-document corpus is also packaged at `Downloads/arbiter-test-pdfs/` with the
manifest and per-document labels.
