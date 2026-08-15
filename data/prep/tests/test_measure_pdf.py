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
