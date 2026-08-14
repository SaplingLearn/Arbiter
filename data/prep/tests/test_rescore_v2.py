"""The re-grade must be readable as data, not only as a printed transcript.

The UI renders the v2.0 correction beside the v1.0 figures it supersedes, so the
numbers have to leave this script in a machine-readable form. These tests pin the
shape and the four headline values HANDOVER section 13.2 quotes.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / "results" / "rescore-v2.json"


def _doc() -> dict:
    subprocess.run([sys.executable, "tools/rescore_v2.py"], cwd=ROOT, check=True,
                   capture_output=True)
    return json.loads(OUT.read_text())


def _pipeline(doc: dict, version: str, population: str, name: str) -> dict:
    target = next(t for t in doc["targets"] if t["version"] == version)
    pop = next(p for p in target["populations"] if p["population"] == population)
    return next(x for x in pop["pipelines"] if x["pipeline"] == name)


def test_writes_both_targets_and_both_populations():
    doc = _doc()
    assert [t["version"] for t in doc["targets"]] == ["1.0", "2.0"]
    for target in doc["targets"]:
        assert [p["population"] for p in target["populations"]] == [
            "conflictSubset", "fullSplit"]


def test_marks_v1_superseded_and_records_the_drift_guard():
    doc = _doc()
    v1 = next(t for t in doc["targets"] if t["version"] == "1.0")
    v2 = next(t for t in doc["targets"] if t["version"] == "2.0")
    assert v1["superseded"] is True
    assert v2["superseded"] is False
    assert doc["driftGuard"] == "pass"
    assert "lower bound" in doc["qsarCaveat"]


def test_reproduces_the_headline_correction():
    doc = _doc()
    # The figure the pitch leads with, on the population it was measured on.
    shipped = _pipeline(doc, "1.0", "conflictSubset", "ARBITER")
    assert shipped["balancedAccuracy"] == 0.75
    assert shipped["confusion"] == {"tp": 4, "fp": 0, "tn": 0, "fn": 0}
    assert shipped["singleClass"] is True

    corrected = _pipeline(doc, "2.0", "fullSplit", "ARBITER")
    assert corrected["balancedAccuracy"] == 0.5
    assert corrected["confusion"] == {"tp": 2, "fp": 5, "tn": 0, "fn": 0}


def test_no_pipeline_clears_0601_under_the_corrected_target():
    doc = _doc()
    v2 = next(t for t in doc["targets"] if t["version"] == "2.0")
    full = next(p for p in v2["populations"] if p["population"] == "fullSplit")
    best = max(x["balancedAccuracy"] for x in full["pipelines"])
    assert round(best, 3) == 0.601
    assert next(x["pipeline"] for x in full["pipelines"]
                if x["balancedAccuracy"] == best) == "single:qsar"
