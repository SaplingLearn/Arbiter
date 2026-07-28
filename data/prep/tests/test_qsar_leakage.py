"""Leakage and conformal-coverage guarantees for the QSAR stream."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / "data" / "out"


def load():
    p = OUT / "stream-qsar.json"
    assert p.exists(), "Run data/prep/qsar_stream.py first"
    return json.loads(p.read_text())


def test_model_never_saw_calibration_or_test_compounds():
    """The single most important test in the data layer."""
    s = load()
    splits = json.loads((OUT / "splits.json").read_text())
    trained_on = set(s["trainedOn"])
    assert trained_on & set(splits["calibration"]) == set(), "LEAKAGE: trained on calibration"
    assert trained_on & set(splits["test"]) == set(), "LEAKAGE: trained on test - all numbers invalid"
    assert trained_on <= set(splits["train"])
    # And it must have actually trained on something, or the subset check above is
    # satisfied trivially by the empty set.
    assert len(trained_on) == len(splits["train"]) > 100


def test_conformal_coverage_meets_the_guarantee():
    s = load()
    target = 1 - s["alpha"]
    # Split conformal guarantees coverage >= 1 - alpha on the calibration split by
    # construction. Asserted in the direction the guarantee actually runs, plus an
    # upper bound so a degenerate qhat that puts BOTH labels in every set - which
    # would score 100% coverage and be useless - is caught.
    assert s["calibrationCoverage"] >= target - 1e-9, (
        f"coverage {s['calibrationCoverage']:.3f} below the guaranteed {target:.3f}"
    )
    assert s["calibrationCoverage"] < 1.0, "every prediction set covers the truth - qhat is degenerate"


def test_prediction_sets_are_consistent_with_the_reported_qhat():
    """The emission rule and the calibration rule must be the same rule.

    Recomputes each claim's set membership from the reported qhat and the claim's
    own strength, and checks it agrees with the assertion that was emitted. This is
    the test that fails if the two code paths ever drift apart - unlike the
    coverage check, which is near-tautological on the split that set the threshold.
    """
    s = load()
    qhat = s["qhat"]
    for c in s["claims"]:
        if c["assertion"] in ("toxic", "safe"):
            # A committed claim is a singleton set, so its own label must be inside
            # the threshold and its strength is that label's probability.
            assert 1 - c["strength"] <= qhat + 1e-9, (
                f"{c['id']}: committed at strength {c['strength']} but 1-p > qhat={qhat}"
            )
            assert c["inApplicabilityDomain"] is True
        else:
            assert c["strength"] == 0.0, f"{c['id']}: ambiguous claims carry no committed strength"


def test_every_compound_gets_exactly_one_claim():
    s = load()
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    ids = [c["compoundId"] for c in s["claims"]]
    assert len(ids) == len(set(ids)), "duplicate QSAR claims for one compound"
    assert set(ids) == {c["compoundId"] for c in compounds}


def test_out_of_domain_compounds_are_flagged_not_dropped():
    s = load()
    # An empty conformal set means the compound is outside the applicability
    # domain. Those claims must be PRESENT and flagged, not silently omitted.
    flagged = [c for c in s["claims"] if c["inApplicabilityDomain"] is False]
    for c in flagged:
        assert c["assertion"] == "ambiguous", "an out-of-domain claim must not assert a verdict"
        assert c["strength"] == 0.0
    # The count is REPORTED even when zero, so that a run producing no out-of-domain
    # compounds is visibly different from a run that dropped them. Without this the
    # loop above passes vacuously on an empty list.
    print(f"\n  out-of-domain claims: {len(flagged)}")


def test_ambiguous_claims_carry_no_committed_strength():
    s = load()
    ambiguous = [c for c in s["claims"] if c["assertion"] == "ambiguous"]
    for c in ambiguous:
        assert c["strength"] == 0.0, "an ambiguous claim carries no committed strength"
    # Non-vacuous: with a 90% conformal target on a hard endpoint there must be
    # SOME uncertain compound, or qhat is degenerate and the stream is asserting a
    # confident label for all 890.
    assert len(ambiguous) > 0, "no ambiguous claims at all - qhat is almost certainly degenerate"


def test_the_stream_commits_on_a_useful_fraction():
    """A stream that abstains on everything cannot conflict with anything."""
    s = load()
    committed = [c for c in s["claims"] if c["assertion"] in ("toxic", "safe")]
    frac = len(committed) / len(s["claims"])
    assert frac > 0.1, (
        f"only {frac:.1%} of QSAR claims commit to a label; the conflict subset will be empty"
    )


def test_claims_carry_every_field_the_engine_schema_requires():
    """The Python side must produce exactly the shape the TypeScript engine accepts.

    Checked structurally here rather than by invoking the TS schema, because Node
    cannot import a .ts module without a loader. The authoritative cross-language
    check is `npm run validate:evidence` in Task 13, which parses every claim
    through the real zod schema; this test is the fast local guard.
    """
    required = {
        "id", "compoundId", "stream", "assertion", "strength", "system",
        "measuresKeyEvent", "exposureRelevant", "inApplicabilityDomain",
        "klimisch", "availableFrom", "provenance",
    }
    streams = {"qsar", "cytotox", "toxicogenomics", "transporter", "invivo_rodent", "invivo_nonrodent"}

    for c in load()["claims"]:
        assert set(c) == required, f"{c['id']}: field mismatch {set(c) ^ required}"
        assert c["stream"] in streams
        assert c["assertion"] in {"toxic", "safe", "ambiguous"}
        assert 0.0 <= c["strength"] <= 1.0
        assert c["system"] in {"human", "rodent", "nonrodent", "in_silico"}
        assert c["klimisch"] in {1, 2, 3, 4, None}
        assert set(c["provenance"]) >= {"kind", "source", "retrieved"}
        assert c["provenance"]["kind"] in {"database", "literature"}


def test_no_qsar_claim_asserts_a_measured_key_event():
    """The engine schema forbids it, and such a claim escapes every discount clause.

    A qsar/in_silico claim with a non-null measuresKeyEvent is weighted like human
    clinical evidence. Guarded here too so the failure names this file rather than
    surfacing as a zod error in Task 13.
    """
    for c in load()["claims"]:
        assert c["measuresKeyEvent"] is None, f"{c['id']}: a prediction cannot MEASURE a key event"
