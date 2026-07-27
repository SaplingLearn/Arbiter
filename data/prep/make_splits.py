"""Seeded, stratified three-way split. COMMITTED BEFORE ANY MODEL IS FITTED.

train       -> fitting the QSAR stream and per-source reliability priors
calibration -> conformal nonconformity thresholds only
test        -> every reported number; touched by nothing else, ever

The seed is a constant in this file and is committed with the output, so the split
is reproducible and auditable. A test asserts re-running reproduces it byte for
byte.

The ordering claim - split first, fit second - is the whole basis on which the
reported numbers are valid (spec section 8). It is only a real claim if the split
artifact is actually committed, which is why .gitignore carries an explicit
negation for data/out/splits.json rather than leaving it to a `git add` that would
silently add nothing.
"""
import json
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
SEED = 20260726
FRACTIONS = {"train": 0.50, "calibration": 0.20, "test": 0.30}


def main() -> None:
    payload_path = OUT / "compounds.json"
    if not payload_path.exists():
        raise SystemExit("Run data/prep/ingest_dilirank.py first - compounds.json is missing.")
    compounds = json.loads(payload_path.read_text())["compounds"]
    rng = np.random.default_rng(SEED)

    # Stratify so every split carries both classes - a single-class calibration
    # split makes conformal thresholds meaningless.
    #
    # Sorted by compoundId before shuffling: the permutation is only reproducible if
    # the sequence it permutes is itself in a fixed order, and compounds.json's
    # order could change with an ingest edit.
    buckets: dict[int, list[str]] = {0: [], 1: []}
    for c in sorted(compounds, key=lambda x: x["compoundId"]):
        buckets[c["y"]].append(c["compoundId"])

    splits: dict[str, list[str]] = {"train": [], "calibration": [], "test": []}
    for y in sorted(buckets):  # fixed class order, so the rng draws are stable
        keys = buckets[y]
        idx = rng.permutation(len(keys))
        shuffled = [keys[i] for i in idx]
        n_train = int(round(len(shuffled) * FRACTIONS["train"]))
        n_cal = int(round(len(shuffled) * FRACTIONS["calibration"]))
        splits["train"] += shuffled[:n_train]
        splits["calibration"] += shuffled[n_train:n_train + n_cal]
        splits["test"] += shuffled[n_train + n_cal:]

    for k in splits:
        splits[k] = sorted(splits[k])

    labels = {c["compoundId"]: c["y"] for c in compounds}
    payload = {
        "seed": SEED,
        "fractions": FRACTIONS,
        "sizes": {k: len(v) for k, v in splits.items()},
        "positiveRate": {
            k: round(sum(labels[i] for i in v) / len(v), 4) if v else None
            for k, v in splits.items()
        },
        "note": "Committed before any model fitting. train fits, calibration thresholds, test reports.",
        **splits,
    }
    (OUT / "splits.json").write_text(json.dumps(payload, indent=2))
    print(json.dumps({"sizes": payload["sizes"], "positiveRate": payload["positiveRate"]}, indent=2))


if __name__ == "__main__":
    main()
