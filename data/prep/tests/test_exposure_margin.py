"""The arithmetic that decides every exposureRelevant value in the corpus.

Pure functions with no I/O, so the rule R3 consumes can be tested exactly rather
than inferred from a pipeline run.
"""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from exposure_margin import exposure_relevant, margin


def test_margin_is_top_tested_over_unbound_cmax():
    assert margin(92.0, 0.92) == pytest.approx(100.0)
    assert margin(92.0, 9.2) == pytest.approx(10.0)


def test_margin_is_none_when_either_input_is_missing():
    assert margin(None, 0.92) is None
    assert margin(92.0, None) is None
    assert margin(None, None) is None


def test_margin_refuses_a_nonpositive_cmax_rather_than_returning_infinity():
    """A zero Cmax would clear any factor and silently mark everything relevant."""
    with pytest.raises(ValueError):
        margin(92.0, 0.0)
    with pytest.raises(ValueError):
        margin(92.0, -1.0)


def test_exactly_at_the_factor_is_relevant():
    """The boundary is >=, and it is asserted in BOTH directions so an
    implementation using > fails here rather than shifting one compound silently."""
    assert exposure_relevant(92.0, 0.92, 100) is True     # exactly 100x
    assert exposure_relevant(91.9, 0.92, 100) is False    # a hair under


def test_wide_margin_is_relevant_and_narrow_is_not():
    assert exposure_relevant(92.0, 0.001, 100) is True    # 92,000x
    assert exposure_relevant(92.0, 92.0, 100) is False    # 1x


def test_missing_input_is_none_not_false():
    """null and false are DIFFERENT statements to R3: 'never established' versus
    'established and inadequate'. Collapsing them re-introduces the overclaim this
    whole change exists to remove."""
    assert exposure_relevant(None, 0.92, 100) is None
    assert exposure_relevant(92.0, None, 100) is None
