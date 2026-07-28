"""evidence.json is what the harness reads. Guard its invariants."""
import json
import pathlib
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / "data" / "out"


def load():
    p = OUT / "evidence.json"
    assert p.exists(), "Run data/prep/assemble_evidence.py first"
    return json.loads(p.read_text())


def test_claim_ids_are_unique():
    ids = [c["id"] for c in load()["claims"]]
    dupes = [k for k, n in Counter(ids).items() if n > 1]
    assert not dupes, f"duplicate claim ids: {dupes[:5]}"


def test_every_claim_belongs_to_a_known_compound_or_the_fixture():
    e = load()
    known = set(e["benchmarkCompoundIds"]) | set(e["fixtureCompoundIds"])
    for c in e["claims"]:
        assert c["compoundId"] in known, f"orphan claim {c['id']}"


def test_a_real_population_can_produce_cross_stream_conflict():
    """The headline metric needs compounds where two streams both commit.

    With one stream there is nothing to disagree with, so this is the number that
    bounds the conflict subset before any rule runs.
    """
    e = load()
    assert e["compoundsWithAtLeastTwoCommittedStreams"] > 100, (
        f"only {e['compoundsWithAtLeastTwoCommittedStreams']} compounds have two committed "
        "streams; the conflict subset cannot be large enough to report on"
    )


def test_no_in_silico_claim_asserts_a_measured_key_event():
    for c in load()["claims"]:
        if c["stream"] == "qsar" or c["system"] == "in_silico":
            assert c["measuresKeyEvent"] is None, f"{c['id']}"


def test_strengths_and_enums_are_in_range():
    streams = {"qsar", "cytotox", "toxicogenomics", "transporter", "invivo_rodent", "invivo_nonrodent"}
    for c in load()["claims"]:
        assert 0.0 <= c["strength"] <= 1.0, c["id"]
        assert c["stream"] in streams, c["id"]
        assert c["assertion"] in {"toxic", "safe", "ambiguous"}, c["id"]
        assert c["system"] in {"human", "rodent", "nonrodent", "in_silico"}, c["id"]
        assert c["klimisch"] in {1, 2, 3, 4, None}, c["id"]


def test_ambiguous_claims_carry_no_strength():
    for c in load()["claims"]:
        if c["assertion"] == "ambiguous":
            assert c["strength"] == 0.0, f"{c['id']} is ambiguous but carries strength"
