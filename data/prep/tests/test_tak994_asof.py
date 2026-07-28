"""The two-pass replay is the spine of the demo. Test the mechanism, not the story."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / "data" / "out"

PRE_FIH = "2021-06-01"   # before first-in-human dosing
POST = "2023-01-01"      # after the murine study was run during the trial


def load():
    p = OUT / "tak994.json"
    assert p.exists(), "Run data/prep/tak994_fixture.py first"
    return json.loads(p.read_text())


def as_of(claims, date):
    return [c for c in claims if c["availableFrom"] <= date]


def test_pass_one_contains_no_murine_toxicogenomics():
    """The mechanism study was run DURING the trial. Including it pre-FIH is hindsight."""
    claims = as_of(load()["claims"], PRE_FIH)
    assert claims, "pass 1 must not be empty"
    for c in claims:
        assert c["stream"] != "toxicogenomics", f"hindsight leak: {c['id']} in the pre-FIH pass"


def test_pass_one_has_exactly_the_evidence_that_existed_pre_first_in_human():
    """Asserts the exact set, not merely that some expected streams appear.

    The plan's version was named "the four studies that actually existed" and
    checked three streams with `in`, which passes just as happily if a hindsight
    claim is also present.
    """
    streams = sorted(c["stream"] for c in as_of(load()["claims"], PRE_FIH))
    assert streams == ["cytotox", "invivo_nonrodent", "invivo_rodent", "qsar", "transporter"], streams


def test_pass_two_adds_the_murine_signal():
    p1 = {c["id"] for c in as_of(load()["claims"], PRE_FIH)}
    p2 = {c["id"] for c in as_of(load()["claims"], POST)}
    assert p1 < p2, "pass 2 must strictly add claims"
    added = p2 - p1
    assert added == {"TAK-994:toxicogenomics-murine"}, added


def test_the_added_claim_is_the_one_that_says_toxic():
    """Otherwise the two-pass demo has no reversal to show."""
    p1 = as_of(load()["claims"], PRE_FIH)
    p2 = as_of(load()["claims"], POST)
    assert all(c["assertion"] != "toxic" for c in p1)
    assert any(c["assertion"] == "toxic" for c in p2)


def test_every_pre_fih_claim_asserts_safe_or_ambiguous():
    """The historical record: nothing available pre-FIH said toxic."""
    for c in as_of(load()["claims"], PRE_FIH):
        assert c["assertion"] in ("safe", "ambiguous"), f"{c['id']} claims toxic pre-FIH"


def test_fixture_is_literature_sourced():
    for c in load()["claims"]:
        assert c["provenance"]["kind"] == "literature"


def test_unverified_citations_are_declared_as_such():
    """A fixture that looks cited while carrying unchecked references is worse than
    one that admits the gap. Any surface rendering these must be able to see it."""
    d = load()
    assert d["citationStatus"] == "UNVERIFIED"
    assert "citationNote" in d


def test_tak994_is_excluded_from_the_benchmark():
    """It is the motivating case, not evidence. It must not be a benchmark row."""
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    fixture_ids = {c["compoundId"] for c in load()["claims"]}
    assert fixture_ids & {c["compoundId"] for c in compounds} == set()

    evidence = json.loads((OUT / "evidence.json").read_text())
    assert evidence["benchmarkCompoundIds"], "evidence.json must declare its benchmark rows"
    assert fixture_ids & set(evidence["benchmarkCompoundIds"]) == set()


def test_no_qsar_or_in_silico_claim_asserts_a_measured_key_event():
    """The engine schema forbids it; guarded here so the failure names the fixture."""
    for c in load()["claims"]:
        if c["stream"] == "qsar" or c["system"] == "in_silico":
            assert c["measuresKeyEvent"] is None, f"{c['id']}: a prediction cannot MEASURE a key event"
