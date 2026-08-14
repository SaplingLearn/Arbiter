# R-4: The leakage screen, without which no prediction claim is defensible

| | |
|---|---|
| **Priority** | Post-submission, but **blocking for any prediction scoring**. Build it before Gate 3, not after. |
| **Estimated effort** | 1 day |
| **Depends on** | nothing |
| **Touches** | `data/prep/leakage_screen.py` (new), `data/prep/tests/` (new test) |
| **Do not touch** | `data/prep/split_review.py` (match its style, do not modify it) |

---

## The measurement that makes this necessary

`HANDOVER.md` section 13.4c records a correction to the project's own method, and it is
the sharpest one in the document:

> **The mechanical cut does not guarantee blindness.** Section 13.3 and spec section 4.4
> claimed no hindsight contamination because the cut is mechanical. That is false for FDA
> multi-discipline reviews: the Turalio **nonclinical** chapter contains "The liver is a
> major target organ **clinically**". One document written by reviewers who already knew
> the outcome. Cutting at the chapter boundary moves the pages, not the knowledge.

Two consequences were recorded, and both are already in force:

1. Turalio is a **deliberation case and never a prediction case**.
2. Any future prediction scoring must grep the nonclinical extract for clinical
   cross-references first. **And that check does not exist yet.**

Without it, "the system predicted the clinical outcome" can quietly mean "the system read
the sentence that stated it". That is the difference between a result and an artefact, and
a Pfizer judge will ask.

EMA assessment reports do not have this problem the same way, which is why the two
acceptance cases below differ.

---

## What to build

A screen that **refuses** a nonclinical extract containing clinical cross-references.
Refuses, not warns. A warning gets clicked past; the plan's own wording is that the screen
is blocking.

Match the style of `data/prep/split_review.py`, which already does the chapter cut. Read
it first:

```bash
cat data/prep/split_review.py
```

**The two acceptance cases, which are the test:**

| document | expected | why |
|---|---|---|
| Turalio, `data/cases/turalio-pexidartinib.json` source, FDA NDA 211810 | **FAIL the screen** | its nonclinical chapter contains "The liver is a major target organ clinically" |
| Nipocalimab, `data/cases/nipocalimab-imaavy.json` source, EMA | **PASS the screen** | EMA reports separate the chapters differently |

If your implementation passes Turalio, it is wrong no matter how clean the code is.

---

## Step by step

- [ ] **Step 1: Read the existing splitter and the two documents**

```bash
cat data/prep/split_review.py
ls documents/
python3 -c "import json; d=json.load(open('data/cases/turalio-pexidartinib.json')); print(d['_source']); print(d['documentScope'])"
```

- [ ] **Step 2: Write the failing test first**

Create `data/prep/tests/test_leakage_screen.py`:

```python
from leakage_screen import scan, Verdict

def test_refuses_a_clinical_cross_reference_in_a_nonclinical_chapter():
    text = (
        "The liver is a major target organ clinically, and in the 6-month rat study "
        "hemosiderin deposition occurred at doses >= 20 mg/kg."
    )
    v = scan(text)
    assert v.refused is True
    assert any("clinically" in m.matched.lower() for m in v.markers)
    # The verdict must name the offending sentence, because a refusal a human
    # cannot check is a refusal they will override.
    assert "major target organ" in v.markers[0].sentence

def test_passes_a_chapter_that_stays_nonclinical():
    text = (
        "In the 6-month rat study, hemosiderin deposition and necrotizing inflammation "
        "occurred at doses >= 20 mg/kg, approximately 0.6 times the exposure at 800 mg."
    )
    assert scan(text).refused is False

def test_does_not_fire_on_the_word_clinical_inside_a_dose_comparison():
    # "clinical exposure" is the standard way to express a margin and appears in
    # every nonclinical chapter ever written. Refusing on it would refuse everything.
    text = "Findings occurred at approximately 0.6 times the clinical exposure at 800 mg."
    assert scan(text).refused is False
```

That third test is the one that decides whether this tool is usable. `clinical exposure`
is how every exposure margin in toxicology is written. A screen that fires on the bare
word `clinical` refuses every document and will be switched off within a day.

- [ ] **Step 3: Run and watch it fail**

```bash
data/prep/.venv/bin/python -m pytest data/prep/tests/test_leakage_screen.py -v
```

Use `data/prep/.venv/Scripts/python` on Windows.

- [ ] **Step 4: Implement**

Create `data/prep/leakage_screen.py`. The marker set, drawn from the recorded failure and
from the shape of these documents:

```python
# Patterns that indicate the writer knew the clinical outcome. Each is a phrase and
# not a bare word: "clinical" alone appears in every exposure margin ever written
# ("0.6 times the clinical exposure"), so a bare-word screen refuses everything and
# gets switched off, which is worse than no screen.
LEAKAGE_MARKERS = [
    r"\bmajor target organ\b[^.]{0,40}\bclinical",
    r"\bclinically\b(?![\s-]*relevant exposure)",
    r"\bin (?:the )?clinic\b",
    r"\bin patients\b",
    r"\brefer to section 8\b",
    r"\bpost[- ]?marketing\b",
    r"\bhepatotoxicity was observed in (?:the )?(?:trial|study participants|subjects)\b",
    r"\bhy'?s law\b",
    r"\bdrug[- ]induced liver injury\b(?=[^.]{0,60}\bpatients\b)",
]
```

`scan(text)` returns a verdict carrying `refused: bool` and a list of markers, each with
the pattern that matched, the matched substring, and **the whole sentence it sat in**. A
refusal a human cannot check is a refusal they will override.

Provide a CLI that exits non-zero on refusal, so it can gate a pipeline:

```bash
data/prep/.venv/bin/python data/prep/leakage_screen.py <extract.txt>
```

- [ ] **Step 5: Run against the two real documents**

Turalio must refuse. Nipocalimab must pass. If Turalio passes, your patterns are too
narrow; if nipocalimab refuses, they are too broad. **Tune against these two and then stop**,
and record which patterns you changed and why.

- [ ] **Step 6: Wire it as a gate, not a report**

Any prediction-scoring path must call this first and refuse the document on a hit. Write
that into the calling code, not into a README.

- [ ] **Step 7: Commit**

```bash
git add data/prep/leakage_screen.py data/prep/tests/test_leakage_screen.py
git commit -m "Refuse a nonclinical extract that already knows the clinical answer

HANDOVER section 13.4c measured that the mechanical chapter cut does not
guarantee blindness: the Turalio nonclinical chapter says the liver is a major
target organ clinically, because the reviewers writing it already knew. Cutting
at the chapter boundary moves the pages, not the knowledge.

Refuses rather than warns, and names the sentence, because a refusal a reader
cannot check is one they will override. Phrases rather than bare words: clinical
exposure is how every margin in toxicology is written, and a bare-word screen
refuses every document and gets switched off."
```

---

## Definition of done

- [ ] Turalio's nonclinical extract is **refused**.
- [ ] Nipocalimab's is **passed**.
- [ ] `clinical exposure` in a dose margin does not trigger a refusal.
- [ ] Every refusal names the sentence that caused it.
- [ ] A prediction-scoring path cannot run without calling it.

## Traps specific to this task

- **A bare `clinical` match refuses everything.** This is the failure mode that makes the
  tool useless. The third test exists to prevent it.
- **Do not "fix" a refusal by deleting the marker.** If Turalio starts passing, you have
  broken the screen, not improved it.
- **This does not make Turalio a prediction case.** It stays a deliberation case
  permanently. The screen protects future documents; it does not rehabilitate that one.
- **Passing the screen is not proof of blindness.** It is proof that the obvious markers
  are absent. Say that in the output, so nobody quotes a pass as a guarantee. The project
  has already been burned once by exactly that inference.
