"""Tests for the nonclinical/clinical cut.

`plan_split` is pure over a list of page strings, so every case here is exact and
none needs a PDF. Two of these tests exist because the implementation was WRONG in
that specific way against a real document, and both are marked.
"""
from __future__ import annotations

import pathlib
import sys

# tests/ is a sibling of the modules it tests, and pytest.ini sets testpaths=tests,
# so the prep directory is not on the path by default. Added here rather than via a
# conftest because this is the only test in the suite that imports a prep module
# directly - the others shell out to the scripts.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from split_review import MIN_STUDY_TERMS, plan_split  # noqa: E402

# Enough study-evidence vocabulary to clear MIN_STUDY_TERMS.
SUBSTANTIVE = (
    "A 13-week repeat-dose study in rats and dogs. NOAEL 30 mg/kg/day. "
    "Histopathology showed no findings. Toxicokinetic sampling confirmed exposure. "
    "In vitro Ames and micronucleus assays were negative. In vivo carcinogenicity "
    "study in mice. Dose-group allocation was randomised. Exposure margin 12x. "
    "A monkey study supported the selection."
)
# EXACTLY `toc_pages` long, so body page 0 lands at index 8 where the search
# begins. An earlier version of this fixture used nine pages, which left index 8
# still inside the contents - every heading then matched a contents line and five
# tests failed for a reason that had nothing to do with the code under test.
TOC_PAGES = 8
TOC = ["Contents\n5. Nonclinical Pharmacology\n6. Clinical Pharmacology\n"] * TOC_PAGES
BODY = TOC_PAGES  # index of the first body page


def pages(*body: str) -> list[str]:
    """A document with a contents block in front, as real ones have."""
    return [*TOC, *body]


def test_splits_a_clean_document():
    p = pages(
        "5. Nonclinical Pharmacology/Toxicology\n" + SUBSTANTIVE,
        "more toxicology, NOAEL 10 mg/kg",
        "6. Clinical Pharmacology\nhuman data begins",
        "clinical safety findings",
    )
    s = plan_split(p)
    assert s.ok, s.reason
    assert s.nonclinical_pages == [BODY, BODY + 1]
    assert s.clinical_start == BODY + 2
    # The whole design rests on this: the answer key never overlaps the input.
    assert set(s.nonclinical_pages).isdisjoint(s.withheld_pages)
    assert BODY + 2 in s.withheld_pages and BODY + 3 in s.withheld_pages


def test_matches_the_ema_heading_style():
    # REGRESSION. The first pattern set guessed EMA's numbering as 2.3 and required
    # "Nonclinical" unhyphenated, so it matched NEITHER format it was written for.
    # Real: "2.5.  Non-clinical aspects" -> "2.6.  Clinical aspects".
    p = pages(
        "2.5.  Non-clinical aspects\n" + SUBSTANTIVE,
        "toxicology continues, NOAEL 5 mg/kg",
        "2.6.  Clinical aspects\nhuman data",
    )
    s = plan_split(p)
    assert s.ok, s.reason
    assert s.nonclinical_pages == [BODY, BODY + 1]


def test_refuses_a_chapter_that_reports_no_studies():
    # NDA 211367 is a 505(b)(2) whose applicant ran no new nonclinical studies. The
    # split is CORRECT and the document is still unusable, so the refusal must name
    # the application rather than the splitter.
    # Two pages, so it clears the contents-line floor and actually reaches the
    # substance check - which is the thing under test here.
    p = pages(
        "5. Nonclinical Pharmacology/Toxicology\n"
        "The Applicant did not conduct any new nonclinical toxicology studies.",
        "Pharmacology/Toxicology supports approval on the previous findings for DRSP.",
        "6. Clinical Pharmacology\nhuman data",
    )
    s = plan_split(p)
    assert not s.ok
    assert "reports no preclinical studies" in s.reason
    assert "property of the APPLICATION" in s.reason


def test_prefers_the_first_substantive_chapter_over_a_longer_later_one():
    # REGRESSION, and the subtle one. A largest-span rule looks reasonable and picked
    # a 16-page labelling appendix at p90 over the real chapter at p27 on NDA 211367,
    # purely because more pages happened to follow it before the next clinical
    # heading. Length is a coincidence of what comes after; the first real chapter is
    # the chapter. Reverting to `max(..., key=span)` makes this test select the
    # appendix and pass everything else in this file.
    p = pages(
        "5. Nonclinical Pharmacology/Toxicology\n" + SUBSTANTIVE,   # 9
        "more tox",                                                  # 10
        "6. Clinical Pharmacology\nhuman",                           # 11
        "clinical",                                                  # 12
        "14.3. Nonclinical Pharmacology appendix\n" + SUBSTANTIVE,   # 13
        *["appendix padding"] * 8,                                   # 14-21
        "15. Clinical Safety appendix",                              # 22
    )
    s = plan_split(p)
    assert s.ok, s.reason
    assert s.nonclinical_start == BODY, "took the longer appendix instead of the real chapter"
    assert len(s.nonclinical_pages) == 2


def test_refuses_a_bare_contents_match():
    # Two-page floor. A match on a contents line with a clinical line right after it
    # produces a one-page "chapter".
    p = pages(
        "5. Nonclinical Pharmacology ... 27\n6. Clinical Pharmacology ... 29",
        "6. Clinical Pharmacology\nhuman",
    )
    s = plan_split(p)
    assert not s.ok
    assert "contents line" in s.reason


def test_refuses_when_no_clinical_chapter_follows():
    # Without an answer key in the same file the case tests nothing, so this is a
    # refusal rather than "withhold everything after the end".
    p = pages("5. Nonclinical Pharmacology/Toxicology\n" + SUBSTANTIVE, "more tox")
    s = plan_split(p)
    assert not s.ok
    assert "no clinical chapter" in s.reason.lower()


def test_refuses_when_no_nonclinical_chapter_is_found():
    p = pages("1. Introduction", "6. Clinical Pharmacology\nhuman")
    s = plan_split(p)
    assert not s.ok
    assert "No nonclinical chapter heading" in s.reason


def test_refuses_interleaved_chapters():
    # The structural guard that page arithmetic alone would paper over: a clinical
    # heading INSIDE the input range means the chapters are not contiguous blocks,
    # and a range-based cut would ship clinical text to the model.
    p = pages(
        "5. Nonclinical Pharmacology/Toxicology\n" + SUBSTANTIVE,
        "7. Clinical Safety\nleaked human outcome data",
        "more tox, NOAEL 1 mg/kg",
        "6. Clinical Pharmacology\nhuman",
    )
    s = plan_split(p)
    # Either it refuses outright, or it selects a range that excludes the leak.
    if s.ok:
        assert BODY + 1 not in s.nonclinical_pages, "clinical heading page reached the model input"
    else:
        assert "REFUSED" in s.reason


def test_refuses_a_document_shorter_than_its_contents():
    s = plan_split(["one page"])
    assert not s.ok
    assert "too short" in s.reason


def test_study_term_threshold_is_actually_enforced():
    # A chapter that mentions one or two study words is not a chapter that reports
    # studies. Without this, MIN_STUDY_TERMS could be set to 0 and everything above
    # would still pass.
    p = pages(
        "5. Nonclinical Pharmacology/Toxicology\nThe rat was mentioned once.",
        "nothing else of substance here",
        "6. Clinical Pharmacology\nhuman",
    )
    s = plan_split(p)
    assert not s.ok
    assert f"need {MIN_STUDY_TERMS}" in s.reason


def test_flags_a_clinical_crossreference_in_the_nonclinical_prose():
    # REGRESSION, HANDOVER section 13.4c. The Turalio nonclinical chapter carries a
    # clinical cross-reference because reviewers wrote it already knowing the human
    # outcome. The mechanical cut moves the pages, not the knowledge, so a heading
    # guard alone cannot make this document a prediction case.
    p = pages(
        "5. Nonclinical Pharmacology/Toxicology\n" + SUBSTANTIVE,
        "The liver is a major target organ clinically, with frequent elevations "
        "in transaminases observed in patients.",
        "6. Clinical Pharmacology\nhuman data begins",
    )
    s = plan_split(p)
    assert s.ok, s.reason
    assert s.prediction_safe is False
    assert len(s.clinical_crossrefs) == 1
    assert s.clinical_crossrefs[0]["page"] == BODY + 1
    assert "major target organ clinically" in s.clinical_crossrefs[0]["text"]


def test_a_clean_chapter_is_prediction_safe():
    p = pages(
        "5. Nonclinical Pharmacology/Toxicology\n" + SUBSTANTIVE,
        "more toxicology, NOAEL 10 mg/kg",
        "6. Clinical Pharmacology\nhuman data begins",
    )
    s = plan_split(p)
    assert s.ok, s.reason
    assert s.prediction_safe is True
    assert s.clinical_crossrefs == []


def test_does_not_flag_the_word_clinical_in_a_preclinical_sense():
    # "clinical signs" is standard tox vocabulary for observations in animals, and
    # "clinically relevant dose" is a comparison, not an outcome. Flagging either
    # would make the guard fire on every chapter and so mean nothing.
    p = pages(
        "5. Nonclinical Pharmacology/Toxicology\n" + SUBSTANTIVE,
        "Clinical signs were observed in rats at the high dose. The clinically "
        "relevant dose margin was 12x.",
        "6. Clinical Pharmacology\nhuman data begins",
    )
    s = plan_split(p)
    assert s.ok, s.reason
    assert s.prediction_safe is True, s.clinical_crossrefs
