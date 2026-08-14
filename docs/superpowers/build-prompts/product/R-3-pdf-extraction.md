# R-3: PDF extraction, so ARBITER works on a compound in no database

| | |
|---|---|
| **Priority** | Post-submission. The playbook explicitly forbids starting this before 16 August. |
| **Estimated effort** | 3 to 5 days |
| **Depends on** | nothing technically, but do not start it during the submission window |
| **Touches** | `services/api/extract.ts` (new), `apps/deliberation/src` (approval screen), `services/api/test/extract.test.ts` (new) |
| **Do not touch** | `data/cases/*.json` and `data/probe-case-coverage.json`, which are the scoring key |

---

## Why this is the biggest unbuilt piece

Everything ARBITER does today starts from findings a human typed. The completion plan
calls this Gate 1 and states the reason plainly: **a novel compound is in no database but
has a study report.** Extraction is the step that makes the system work for any drug
rather than for the 267 in the benchmark corpus. It is also, per that plan, the substantial
engineering.

The product mode that matters most is **sponsor-data mode**. Four of the twelve checklist
questions are internal screening assays that live in sponsor study reports and never
appear in a public regulatory review, which is why the best public package answers only 7
of 12. A company pointing ARBITER at its own study reports has all twelve. Public-document
mode is the demonstration; sponsor-data mode is the product.

---

## What exists to build against

**The checklist**, `rules/evidence-checklist-v1.0.json`, 12 items:

```json
{
  "id": "M1",
  "half": "mechanism",
  "field": "Human-cell hepatotoxicity result",
  "whatItBlocks": "Rule R1 cannot be applied at all. Animal in vivo evidence has nothing to be weighed against, so a clean rodent study carries the whole question by default.",
  "appliesTo": ["small_molecule", "biologic"]
}
```

Items are split into a `mechanism` half and a `consequence` half. Collapsing those two is
the defect that produced all five over-calls recorded on 2026-08-09, so the extractor must
never merge them.

**Four hand-written human manifests**, written before any extractor existed, which is what
makes them a legitimate scoring key:

| manifest | findings | what it exercises |
|---|---|---|
| `data/probe-case-coverage.json` | 6 | coverage declaration only |
| `data/cases/nipocalimab-imaavy.json` | 9 | a rich EMA chapter, a biologic |
| `data/cases/slynd-drospirenone.json` | 4 | a near-empty 505(b)(2) |
| `data/cases/turalio-pexidartinib.json` | 8 | the most complete package |

**The finding schema**, verbatim from `data/cases/turalio-pexidartinib.json`:

```json
{
  "id": "TUR:liver-histopathology",
  "label": "Liver findings, 6-month rat study",
  "assertion": "toxic",
  "detail": "\"In the liver, hemosiderin deposition and necrotizing inflammation with increased levels of aspartate aminotransferase (AST) and alanine aminotransferase (ALT) occurred at doses >=20 mg/kg (approximately 0.6 times the clinical exposure at 800 mg)...\" The liver is named as a target organ in the rat alongside the reproductive organs, kidney, and lymph/haematopoietic compartments.",
  "sourceDocument": "FDA NDA 211810",
  "sourcePage": 26,
  "covers": ["M5", "..."]
}
```

Note that `detail` **quotes the document** and then adds a sentence of context. That is
the shape to reproduce: a quotation a reader can find on the cited page, not a paraphrase.

`assertion` is `"toxic" | "safe" | "ambiguous"`. Distinguishing a genuine negative from an
absent measurement is the single most common analytical error in this domain and the
fusion layer depends on the distinction: a source that did not test a compound produces no
finding at all, while a source that tested and found nothing produces a `safe` finding.

**Document handling already exists.** `services/api/documents.ts` stores uploaded PDFs,
measures them for readability and refuses unusable ones. Two of the first five collected
documents were refused: `tolcapone` is 48 pages with **0 extractable characters** (a
scan), and `troglitazone` has 133 readable pages with **zero occurrences of "hepat"**.
That refusal rate is the measurement, not bad luck, and the extractor inherits it.

---

## The pass marks, pre-registered

From `rules/pass-marks-v1.0.json`:

| mark | value |
|---|---|
| hallucination rate | **0.0**, a **ceiling** and not a target |
| recall | **at least 0.85** |
| coverage-declaration accuracy | to be registered before the first run, in a v1.1 pass-marks file |

**The asymmetry is the whole design and you must understand it before writing code.** A
missed finding is a gap a human reviewer sees on the approval screen and can add. An
invented finding is a gap they **cannot** see, and it destroys the product's reason to
exist. That is why the hallucination ceiling is zero while recall is allowed to be 0.85.
An engineer who does not internalise this will trade them off and tune for F1, which is
the wrong objective here.

**Register the coverage-declaration pass mark before the first run**, in
`rules/pass-marks-v1.1.json`. A number chosen after seeing a score is a description.

---

## What to build

- [ ] **Step 1: Read the four manifests and the checklist in full**

```bash
cat rules/evidence-checklist-v1.0.json
for f in data/probe-case-coverage.json data/cases/*.json; do echo "=== $f"; python3 -m json.tool "$f" | head -60; done
```

Read the `_note`, `_whyOnlySevenOfTwelve` and
`_THIS_CASE_IS_NOT_A_BLIND_PREDICTION_TEST` keys. They carry decisions you must not
reverse. Turalio in particular is a deliberation case and **never** a prediction case,
for the reason in R-4.

- [ ] **Step 2: Write the scorer before the extractor**

This ordering is deliberate. A scorer written after an extractor tends to score what the
extractor happens to produce.

Create `services/api/test/extract-score.test.ts` with a pure function
`scoreExtraction(produced, manifest)` returning `{ recall, hallucinated, matched }`.
Matching is by checklist coverage and source page, not by string similarity of the label:
two humans write the same finding with different words, and a string-similarity match
would flatter the extractor. A produced finding counts as **hallucinated** when its
`sourcePage` does not contain the claim it asserts, which is checkable against the stored
document text.

- [ ] **Step 3: Build the extractor**

`services/api/extract.ts`. It takes stored document text plus the checklist and returns
candidate findings in the schema above, each with `label`, `assertion`, `detail`,
`sourcePage` and `covers`.

Constrain the model the way `services/api/adjudicate.ts` already constrains the
adjudicator: build the JSON schema **from the request** so `covers` is an enum of the
real checklist ids and there is nowhere in the schema to put an invented one. Read
`adjudicate.ts` and copy that pattern rather than inventing a second one.

Then verify deterministically, the way `verifyAdjudication` does: every `sourcePage` must
exist in the document, and every `covers` entry must be a real checklist id. Verification
is plain code and never a second model call.

- [ ] **Step 4: Build the approval screen**

A human approves the list before it becomes a case. The approval is what makes the
`covers` declaration carry a signature rather than a heuristic, and the completion plan is
explicit that coverage must never be inferred from wording.

The screen shows each candidate with its quoted `detail`, a link to its `sourcePage`, and
its declared `covers`, and lets the reviewer accept, edit or reject. Only accepted
findings become case findings.

- [ ] **Step 5: Score against all four manifests and report honestly**

Report recall and hallucination **per manifest**, never pooled. Slynd is a near-empty
505(b)(2) with 4 findings and Turalio has 8; pooling lets a good result on one hide a
failure on the other. Report `n` with every figure.

- [ ] **Step 6: Commit the scores with the prompt hash that produced them**

Every reported number names the prompt version and hash. That rule is in
`rules/pass-marks-v1.0.json` and applies here identically.

---

## Definition of done

- [ ] `scoreExtraction` exists and is unit tested on hand-built inputs before the
      extractor runs once.
- [ ] Hallucination rate is **0.0** on all four manifests. Anything above zero is a
      failure, not a near miss.
- [ ] Recall is at least 0.85 per manifest, reported per manifest with n.
- [ ] A human approval step gates every finding into a case.
- [ ] The coverage-declaration pass mark was registered before the first scored run.

## Traps specific to this task

- **Do not merge the mechanism and consequence halves.** That collapse produced all five
  recorded over-calls.
- **Do not infer `covers` from wording.** It is a declaration a human confirms.
- **Do not tune against the manifests and then report the same manifests.** They become
  development cases permanently once you iterate against them. The iteration budget is
  five prompt revisions, each logged with its result.
- **An absent measurement is not a negative finding.** No finding at all, versus a `safe`
  finding, is the distinction the whole fusion layer rests on.
- **Two of five real documents were unusable.** Build for refusal as a normal outcome, and
  surface the reason the way `documents.ts` already does.
