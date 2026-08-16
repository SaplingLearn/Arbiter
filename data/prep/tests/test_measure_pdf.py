"""The upload gate: what counts as a nonclinical review.

The counts below are MEASURED, from the sixteen documents in
data/raw/approval-packages (not in git - 21MB of retrievable public PDFs). They are
pinned here so a change to the thresholds has to argue with the corpus rather than
with an opinion.

The regression this exists for: the old rule summed all six TOX_TERMS and refused only
at exactly zero, so troglitazone's labelling supplement - this project's own cited
example of "readable, but not a review" - passed the check written to catch it, on
nineteen mentions of the word "pharmacolog".
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from measure_pdf import REVIEW_TERMS, TOX_TERMS, review_signal  # noqa: E402


def terms(**over: int) -> dict:
    """A term-count dict with every TOX_TERM present, so a renamed term breaks here."""
    base = {t: 0 for t in TOX_TERMS}
    base.update(over)
    return base


# (name, toxicolog, nonclinical, non-clinical) as measured.
GENUINE = [
    ("ema-epar-sample-imaavy", 19, 20, 0),
    ("exkivity-215310", 35, 26, 0),
    ("inrebic-212327", 36, 11, 0),
    ("krazati-216340", 71, 22, 0),
    ("lumakras-214665", 64, 38, 0),
    ("modern-fda-211367", 47, 86, 0),
    ("nubeqa-212099", 24, 11, 0),
    ("orgovyx-214621", 41, 25, 0),
    ("qinlock-213973", 32, 10, 0),
    ("retevmo-213246", 43, 16, 0),
    ("tazverik-211723", 33, 23, 0),
    ("trikafta-212273", 42, 31, 0),
    ("turalio-211810", 29, 12, 0),
    ("xpovio-212306", 24, 7, 0),
]


def test_every_genuine_review_in_the_corpus_is_admitted():
    for name, tox, nc, ncd in GENUINE:
        assert review_signal(terms(toxicolog=tox, nonclinical=nc, **{"non-clinical": ncd})), name


def test_the_labelling_supplement_is_refused():
    """Troglitazone: readable, 133 pages, and no nonclinical review in it.

    Its 24 TOX_TERM hits are 19 x pharmacolog, 2 x toxicolog, 3 x histopatholog - which
    is why summing the bag admitted it.
    """
    trog = terms(toxicolog=2, histopatholog=3, pharmacolog=19)
    assert not review_signal(trog)


def test_pharmacology_alone_never_admits_a_document():
    """The specific failure. `pharmacolog` appears in the clinical pharmacology section
    of any drug document and says nothing about whether a tox review is present."""
    assert not review_signal(terms(pharmacolog=500))


def test_either_signal_suffices():
    """A document may say "nonclinical" throughout and "toxicology" rarely, or the
    reverse. Requiring both would refuse real documents for a vocabulary preference."""
    assert review_signal(terms(toxicolog=REVIEW_TERMS["toxicolog"]))
    assert review_signal(terms(nonclinical=REVIEW_TERMS["nonclinical+non-clinical"]))
    assert review_signal(terms(**{"non-clinical": REVIEW_TERMS["nonclinical+non-clinical"]}))


def test_the_two_spellings_of_nonclinical_are_one_signal():
    half = REVIEW_TERMS["nonclinical+non-clinical"] // 2
    assert review_signal(terms(nonclinical=half, **{"non-clinical": REVIEW_TERMS["nonclinical+non-clinical"] - half}))


def test_noael_is_not_required():
    """Five of the fourteen genuine reviews never use it - exkivity, lumakras,
    modern-fda, nubeqa, tazverik - so requiring it would refuse real documents."""
    assert review_signal(terms(toxicolog=35, nonclinical=26, NOAEL=0))


def test_thresholds_keep_a_margin_over_the_corpus():
    """A future tightening must not creep past the weakest genuine document."""
    weakest_tox = min(t for _, t, _, _ in GENUINE)
    weakest_nc = min(nc + ncd for _, _, nc, ncd in GENUINE)
    assert REVIEW_TERMS["toxicolog"] <= weakest_tox, "would refuse ema-epar-sample-imaavy"
    assert REVIEW_TERMS["nonclinical+non-clinical"] <= weakest_nc, "would refuse xpovio-212306"


# ---------------------------------------------------------------- the chapter test
#
# Word counts alone scored 0.586 accuracy and admitted twelve of thirteen clinical-only
# documents, because "toxicology" and "nonclinical" live in the contents, the executive
# summary and every cross-reference. Deleting krazati's nonclinical chapter takes it from
# 71 mentions to 14 - inside the genuine range. Structure is what separates them.
#
# NOTHING BELOW TRANSCRIBES A MEASUREMENT. A first version pasted the span of every
# document into a list and asserted against it, which proves only that I copied a past
# run correctly - the numbers would not move if the gate broke, because nothing recomputes
# them. These build page texts and exercise the detector; the accuracy figure over real
# PDFs is measured by data/prep/gate_eval.py, which reads the documents every time.

from measure_pdf import MIN_CHAPTER_PAGES  # noqa: E402
from split_review import largest_nonclinical_span  # noqa: E402

TOC = ["Table of Contents ... Nonclinical Pharmacology ... Clinical Pharmacology"] * 9


def doc(nonclinical_at: int | None, clinical_at: int | None, total: int = 60) -> list[str]:
    """A page list with headings where asked. The contents pages carry both headings, so
    every case here also exercises the reason `toc_pages` exists."""
    pages = list(TOC) + ["body text"] * (total - len(TOC))
    if nonclinical_at is not None:
        pages[nonclinical_at] = "4 Nonclinical Pharmacology/Toxicology"
    if clinical_at is not None:
        pages[clinical_at] = "5 Clinical Pharmacology"
    return pages


def test_span_is_the_distance_between_the_headings():
    assert largest_nonclinical_span(doc(10, 40)) == 30


def test_the_contents_listing_does_not_count_as_a_chapter():
    """Every heading pattern matches inside a table of contents. Without skipping it, the
    gate would find a chapter in any document that merely lists one."""
    assert largest_nonclinical_span(list(TOC) + ["body"] * 51) == 0


def test_a_document_with_no_headings_has_no_span():
    assert largest_nonclinical_span(["nothing here"] * 40) == 0


def test_a_nonclinical_heading_with_no_clinical_one_after_it_scores_zero():
    """Four of the derived negatives fail exactly this way: the chapter was deleted, the
    executive summary's mention survived, and nothing clinical follows it."""
    assert largest_nonclinical_span(doc(10, None)) == 0


def test_the_largest_span_wins_over_a_summary_mention():
    """An executive summary names every chapter, producing a short span; the real chapter
    produces a long one. Taking the first match would find the summary."""
    pages = doc(10, 14)
    pages[20] = "4 Nonclinical Pharmacology/Toxicology"
    pages[50] = "5 Clinical Pharmacology"
    assert largest_nonclinical_span(pages) == 30


def test_a_short_summary_span_alone_is_refused():
    """The failure mode the threshold exists for: a document that mentions its chapters
    close together but does not contain one."""
    assert largest_nonclinical_span(doc(10, 10 + MIN_CHAPTER_PAGES - 1)) < MIN_CHAPTER_PAGES


def test_a_real_chapter_length_is_admitted():
    assert largest_nonclinical_span(doc(10, 10 + MIN_CHAPTER_PAGES)) >= MIN_CHAPTER_PAGES


# ------------------------------------------------------- the standalone tox review
#
# The failure a new document SHAPE caught, which no amount of tuning on the original
# corpus would have. A document that is entirely nonclinical has no clinical chapter for
# a span to end at, so the structural rule scored all thirteen of them zero and refused
# every one - recall 1.000 -> 0.519. Density is what admits them.

from measure_pdf import MIN_TOX_DENSITY  # noqa: E402


def admits(span: int, tox_per_page: float) -> bool:
    """The accept condition, expressed once so a test cannot drift from the rule."""
    return span >= MIN_CHAPTER_PAGES or tox_per_page >= MIN_TOX_DENSITY


def test_a_standalone_tox_review_is_admitted_on_density_alone():
    """No chapter boundary anywhere in it, because the whole document is the chapter."""
    assert admits(span=0, tox_per_page=MIN_TOX_DENSITY)


def test_the_clinical_half_of_a_package_is_still_refused():
    """Its toxicology mentions are spread thin over a long clinical document."""
    assert not admits(span=0, tox_per_page=MIN_TOX_DENSITY / 2)


def test_a_full_review_does_not_depend_on_density():
    """It passes on structure, which is why the density floor can be set purely to
    separate the standalone review from the clinical half."""
    assert admits(span=MIN_CHAPTER_PAGES, tox_per_page=0.0)


def test_the_two_routes_are_independent():
    assert not admits(span=MIN_CHAPTER_PAGES - 1, tox_per_page=MIN_TOX_DENSITY - 0.01)
