"""The leakage screen must refuse Turalio and pass nipocalimab.

Those two are not arbitrary examples. They are the measurement that produced the
screen: on 2026-08-09 the Turalio nonclinical chapter was found to cross-reference
the clinical outcome and the nipocalimab one was found not to. A screen that cannot
tell those two apart has no reason to exist, so both directions are asserted.

Every test here is written to be able to FAIL. The passing cases use real
nonclinical prose containing the words most likely to trigger a careless screen
("clinical signs", "clinical pathology"), because a screen that refuses everything
is indistinguishable from a working one on refusal cases alone.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from leakage_screen import screen_case, screen_text  # noqa: E402


# Verbatim from the Turalio nonclinical chapter, quoted in
# data/cases/turalio-pexidartinib.json and HANDOVER 13.4c.
TURALIO_LEAK = (
    "The liver is a major target organ clinically, with frequent elevations in "
    "transaminases, including serious ones (refer to Section 8.3 of the review for details)."
)

# Nonclinical prose that a careless screen would refuse. Every one of these is an
# in-life observation in an animal study.
CLEAN_NONCLINICAL = """
In the 13-week repeat-dose study in Sprague-Dawley rats, clinical signs were limited
to reduced activity at 100 mg/kg/day. Clinical pathology showed no treatment-related
change in ALT or AST. Clinical chemistry parameters were within historical control
ranges. The NOAEL was established at 30 mg/kg/day based on histopathology.
The clinical candidate was administered by oral gavage.
"""


def test_refuses_the_turalio_sentence():
    r = screen_text(TURALIO_LEAK)
    assert r.ok is False
    assert len(r.hits) >= 1


def test_names_which_phrase_leaked_rather_than_only_counting():
    # "3 problems found" is useless to somebody deciding whether to drop a document.
    r = screen_text(TURALIO_LEAK)
    patterns = {h["pattern"] for h in r.hits}
    assert any("clinically" in p for p in patterns)
    assert any("refer" in p for p in patterns)
    for h in r.hits:
        assert h["why"], "every hit must say why it is a leak"
        assert "liver is a major target organ" in h["excerpt"]


def test_passes_ordinary_nonclinical_prose_containing_the_word_clinical():
    # THE TEST THAT MAKES THE SCREEN USEFUL. A screen that fails this refuses every
    # document in the corpus and gets switched off within a day.
    r = screen_text(CLEAN_NONCLINICAL)
    assert r.ok is True, [h["excerpt"] for h in r.hits]


@pytest.mark.parametrize("line", [
    "Hepatotoxicity was observed in patients receiving the drug.",
    "See Section 8.3 for the clinical safety review.",
    "The compound carries a boxed warning for hepatic failure.",
    "Post-marketing reports describe hepatic injury.",
    "Clinical trial data show transaminase elevation.",
    "This finding is relevant to human hepatotoxicity.",
])
def test_refuses_each_measured_leak_shape(line):
    assert screen_text(line).ok is False, line


@pytest.mark.parametrize("line", [
    "Clinical signs included piloerection and hunched posture.",
    "Clinical pathology was unremarkable at all dose levels.",
    "Clinical chemistry showed no ALT elevation in dogs.",
])
def test_does_not_refuse_animal_in_life_observations(line):
    assert screen_text(line).ok is True, line


def test_a_leak_on_a_line_that_also_carries_benign_wording_is_still_caught():
    # Benign context suppresses only the generic `clinical <noun>` family. A line
    # holding both must refuse, or a leak can be hidden by padding the sentence.
    line = "Clinical signs were normal, although the liver is a target organ clinically."
    assert screen_text(line).ok is False


def test_exposes_how_much_was_actually_scanned():
    r = screen_text("a\nb\nc")
    assert r.lines_scanned == 3


def test_screens_an_assembled_case_and_not_only_a_raw_extract():
    # The Turalio quote reached a hand-written finding, so screening only raw
    # extracts would miss the path the real leak actually took.
    case = {
        "context": "Giant cell tumour",
        "findings": [{"label": "hepatotox", "detail": TURALIO_LEAK}],
        "absent": [],
    }
    p = Path(__file__).parent / "_tmp_case.json"
    p.write_text(json.dumps(case), encoding="utf-8")
    try:
        assert screen_case(p).ok is False
    finally:
        p.unlink()


def test_ignores_underscore_prefixed_provenance_notes_in_a_case_file():
    # Those keys are this project's own warnings ABOUT the leak. Scanning them would
    # make every documented case refuse itself for carrying its own documentation.
    case = {
        "_note": f"THIS CASE LEAKS: {TURALIO_LEAK}",
        "context": "Narcolepsy",
        "findings": [{"label": "rat repeat-dose", "detail": "No hepatotoxicity. NOAEL 30 mg/kg/day."}],
        "absent": [],
    }
    p = Path(__file__).parent / "_tmp_case2.json"
    p.write_text(json.dumps(case), encoding="utf-8")
    try:
        assert screen_case(p).ok is True
    finally:
        p.unlink()


def test_the_real_turalio_case_file_is_refused():
    """The end-to-end assertion, against the file actually in the repo."""
    case = Path(__file__).resolve().parents[3] / "data" / "cases" / "turalio-pexidartinib.json"
    if not case.exists():
        pytest.skip("turalio case file not present")
    assert screen_case(case).ok is False


def test_toxicology_term_of_art_clinically_relevant_is_not_a_leak():
    """The other direction, and the false positive that produced BENIGN_CONTEXTS.

    Without a passing case somewhere the screen could be `return False` and every
    test above would still pass.
    """
    line = ('The 4-week NOAEL was set at 306 mg/kg based on the absence of findings in '
            'clinically relevant changes in serum clinical chemistry and histological parameters.')
    assert screen_text(line).ok is True


def test_the_real_nipocalimab_case_file_carries_exactly_one_cross_reference():
    """A CORRECTION TO HANDOVER 13.4c, found by this screen on its first real run.

    13.4c says EMA assessment reports "do not have this problem in the same way" and
    that "nipocalimab carries no such warning". Measured 2026-08-10: it carries one.
    The chapter says a finding may be secondary to an immune response "and that a
    similar pattern appears clinically" - a reference to what happens in humans,
    inside the nonclinical section.

    It is much weaker than Turalio's: it concerns albumin and cholesterol, not the
    liver endpoint being predicted, and the case file itself records that the finding
    "Covers no checklist question". That is a judgement for a human, which is exactly
    why the screen refuses and names the sentence rather than scoring it.

    This test asserts the measurement, not the hope. If the count changes, the
    document or the screen changed and somebody must say which.
    """
    case = Path(__file__).resolve().parents[3] / "data" / "cases" / "nipocalimab-imaavy.json"
    if not case.exists():
        pytest.skip("nipocalimab case file not present")
    r = screen_case(case)
    assert len(r.hits) == 1, [h["excerpt"] for h in r.hits]
    assert "similar pattern appears clinically" in r.hits[0]["excerpt"]
