"""The split is the foundation of every reported number. Test it hard."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
PREP = ROOT / "data" / "prep"
# The INTERPRETER RUNNING THE TESTS, not a hardcoded venv path.
#
# This used to be `PREP / ".venv" / "Scripts" / "python.exe"`, which exists only on a
# Windows machine that happened to build its venv in that spot. Anywhere else - a
# POSIX venv, a bare interpreter, a CI runner - the subprocess raised
# FileNotFoundError and the reproducibility test failed for a reason that had nothing
# to do with reproducibility. That is worse than the test not existing: it is the
# guard on the split seed, and a guard that cries wolf on every fresh checkout is one
# people learn to skip. sys.executable is by definition the interpreter that imported
# this module, so it is present by construction.
PY = sys.executable
SPLITS = ROOT / "data" / "out" / "splits.json"
COMPOUNDS = ROOT / "data" / "out" / "compounds.json"


def load():
    assert SPLITS.exists(), "Run data/prep/make_splits.py first"
    return json.loads(SPLITS.read_text())


def load_compounds():
    assert COMPOUNDS.exists(), "Run data/prep/ingest_dilirank.py first"
    return json.loads(COMPOUNDS.read_text())["compounds"]


def test_splits_are_disjoint():
    s = load()
    tr, ca, te = set(s["train"]), set(s["calibration"]), set(s["test"])
    assert tr & ca == set(), "train and calibration overlap - leakage"
    assert tr & te == set(), "train and test overlap - LEAKAGE, numbers invalid"
    assert ca & te == set(), "calibration and test overlap - leakage"


def test_splits_cover_every_compound_exactly_once():
    s = load()
    all_keys = {c["compoundId"] for c in load_compounds()}
    assigned = s["train"] + s["calibration"] + s["test"]
    assert len(assigned) == len(set(assigned)), "a compound appears in more than one split"
    assert set(assigned) == all_keys


def test_split_is_reproducible_from_the_committed_seed():
    """Re-running the script must reproduce the committed split byte for byte."""
    before = SPLITS.read_text()
    r = subprocess.run([str(PY), str(PREP / "make_splits.py")], cwd=ROOT,
                       capture_output=True, text=True)
    assert r.returncode == 0, f"make_splits.py failed:\n{r.stdout}\n{r.stderr}"
    assert SPLITS.read_text() == before, "split is not reproducible from its seed"


def test_both_classes_present_in_every_split():
    s = load()
    labels = {c["compoundId"]: c["y"] for c in load_compounds()}
    for name in ("train", "calibration", "test"):
        ys = {labels[k] for k in s[name]}
        assert ys == {0, 1}, f"{name} split is single-class; stratification failed"


def test_test_split_is_large_enough_to_report_on():
    s = load()
    assert len(s["test"]) >= 60, f"test split has {len(s['test'])} compounds - too small for a reportable interval"


def test_compound_ids_are_inchikeys():
    """compoundId is the cross-database join key; if it is not an InChIKey, nothing joins."""
    import re
    pat = re.compile(r"^[A-Z]{14}-[A-Z]{10}-[A-Z]$")
    for c in load_compounds():
        assert c["compoundId"] == c["inchikey"], f"{c['name']}: compoundId is not the InChIKey"
        assert pat.match(c["compoundId"]), f"{c['name']}: {c['compoundId']!r} is not InChIKey-shaped"


def test_labels_are_not_all_one_class():
    """Guards the exact silent defect the plan's ingest had.

    The plan derived `y` by testing the RAW DILIrank label against a set of
    NORMALISED strings, which is False for every row - so every compound came out
    negative and the dataset was silently single-class.
    """
    ys = [c["y"] for c in load_compounds()]
    assert set(ys) == {0, 1}, "compounds.json is single-class - check how y is derived"
    rate = sum(ys) / len(ys)
    assert 0.4 < rate < 0.75, f"positive rate {rate:.3f} is far from the expected ~0.58"


def test_stratification_holds_in_each_split():
    """Each split's positive rate should track the overall rate, not drift."""
    s = load()
    labels = {c["compoundId"]: c["y"] for c in load_compounds()}
    overall = sum(labels.values()) / len(labels)
    for name in ("train", "calibration", "test"):
        rate = sum(labels[k] for k in s[name]) / len(s[name])
        assert abs(rate - overall) < 0.05, f"{name} positive rate {rate:.3f} vs overall {overall:.3f}"
