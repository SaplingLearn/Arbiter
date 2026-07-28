"""QSAR / structural evidence stream, with split conformal prediction.

Trains a Morgan-fingerprint classifier on the TRAIN split only, sets a
nonconformity threshold on the CALIBRATION split, and emits one typed evidence
claim per compound.

TWO SEPARATE QUESTIONS, TWO SEPARATE MECHANISMS. An earlier draft used the
conformal prediction set for both, and the second one could never fire.

1. HOW UNCERTAIN IS THIS PREDICTION? Split conformal. The set is
   {y : 1 - p(y|x) <= qhat}; a singleton is a confident committed assertion, both
   labels means genuinely uncertain -> ambiguous.

2. IS THIS COMPOUND EVEN IN THE MODEL'S DOMAIN? Nearest-neighbour Tanimoto
   similarity to the training set. This is what R4 consumes.

   The draft flagged out-of-domain as the EMPTY conformal set. That is unreachable
   arithmetic: an empty set needs p(0) < 1-qhat AND p(1) < 1-qhat, but the two
   probabilities sum to 1, so it is impossible for any qhat >= 0.5. Measured qhat
   here is 0.866, and the observed count of out-of-domain compounds was exactly 0
   out of 890 - R4 could never have fired from this stream, while the code and the
   plan both read as though it would.

   Nearest-neighbour similarity is also what the RULE ACTUALLY SAYS. R4's
   registered framework note reads "A prediction about a compound UNLIKE THE
   TRAINING SET is a different kind of evidence", citing the OECD QSAR validation
   principles - where the applicability domain is defined by the chemical space the
   training data covers, not by the model's confidence. Confidence and coverage are
   different failure modes, and the classic QSAR failure is precisely a model that
   is confident about a compound unlike anything it was trained on. So this is a
   correction TOWARD the pre-registration, not a change to it: ruleset-v1.0.json is
   untouched and its hash stands.

   The cutoff is derived from the training set's own density rather than picked:
   the 5th percentile of each training compound's nearest-neighbour similarity to
   the rest of training. A compound less similar to the training set than 95% of
   the training set is to itself is outside the space the model learned.

IN-SAMPLE HAZARD, read this before using the output. A claim is emitted for EVERY
compound, including the 445 the model was fitted on, because the harness decides
which rows it reports on. The predictions for those compounds are IN-SAMPLE and
wildly overconfident. `trainedOn` in the output lists them precisely so a consumer
can exclude them; Task 13 reports on the TEST split only. Anything that reports a
number computed over train-split claims is reporting memorisation.
"""
import json
import pathlib
import time

import numpy as np
from rdkit import Chem, RDLogger
from rdkit.Chem import rdFingerprintGenerator
from sklearn.ensemble import HistGradientBoostingClassifier

RDLogger.DisableLog("rdApp.*")

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
SEED = 20260726
ALPHA = 0.10  # target coverage 90%; reported in the output, not hidden here


def featurise(smiles: list[str]) -> np.ndarray:
    """Morgan r=2, 2048 bits.

    RAISES on anything RDKit cannot parse rather than substituting a zero vector.
    An all-zero fingerprint is a real point in feature space that the model would
    happily learn from and predict on, so the fallback would silently train on
    junk. The ingest already drops unparseable structures, so reaching this is a
    contract violation upstream and should say so.
    """
    gen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    rows = []
    for s in smiles:
        mol = Chem.MolFromSmiles(s)
        if mol is None:
            raise SystemExit(f"Unparseable SMILES reached the featuriser: {s!r}. "
                             "ingest_dilirank.py should have dropped it.")
        rows.append(np.array(gen.GetFingerprint(mol), dtype=np.int8))
    return np.vstack(rows)


def prediction_set(row: np.ndarray, qhat: float) -> set[int]:
    """{y : 1 - p(y|x) <= qhat}. One definition, used for calibration and emission."""
    return {c for c in (0, 1) if 1 - row[c] <= qhat}


def tanimoto_matrix(A: np.ndarray, B: np.ndarray) -> np.ndarray:
    """Pairwise Tanimoto between two sets of binary fingerprints. |A| x |B|."""
    a = A.astype(np.float32)
    b = B.astype(np.float32)
    inter = a @ b.T
    na = a.sum(axis=1)[:, None]
    nb = b.sum(axis=1)[None, :]
    union = na + nb - inter
    return np.divide(inter, union, out=np.zeros_like(inter), where=union > 0)


def applicability_cutoff(X_tr: np.ndarray) -> float:
    """5th percentile of the training set's own nearest-neighbour similarity.

    Data-derived rather than a picked constant: it asks "how close to its nearest
    neighbour is a typical training compound?" and treats anything below the bottom
    5% of that distribution as outside the space the model learned. Reported in the
    output so it can be contested.
    """
    sim = tanimoto_matrix(X_tr, X_tr)
    np.fill_diagonal(sim, -1.0)  # a compound is not its own neighbour
    nn = sim.max(axis=1)
    return float(np.quantile(nn, 0.05))


def main() -> None:
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    splits = json.loads((OUT / "splits.json").read_text())
    by_id = {c["compoundId"]: c for c in compounds}

    train_ids = sorted(splits["train"])
    cal_ids = sorted(splits["calibration"])

    X_tr = featurise([by_id[i]["smiles"] for i in train_ids])
    y_tr = np.array([by_id[i]["y"] for i in train_ids])
    clf = HistGradientBoostingClassifier(max_iter=200, random_state=SEED).fit(X_tr, y_tr)

    # Split conformal: nonconformity = 1 - predicted probability of the TRUE label.
    X_cal = featurise([by_id[i]["smiles"] for i in cal_ids])
    y_cal = np.array([by_id[i]["y"] for i in cal_ids])
    p_cal = clf.predict_proba(X_cal)
    scores = 1 - p_cal[np.arange(len(y_cal)), y_cal]

    n = len(scores)
    level = min(1.0, np.ceil((n + 1) * (1 - ALPHA)) / n)
    qhat = float(np.quantile(scores, level, method="higher"))

    cal_sets = [prediction_set(row, qhat) for row in p_cal]
    coverage = float(np.mean([y in s for y, s in zip(y_cal, cal_sets)]))

    ad_cutoff = applicability_cutoff(X_tr)

    # OUT-OF-SAMPLE SKILL, measured on CALIBRATION and never on test.
    #
    # Task 1 established that this model's accuracy is dominated by training-set
    # size: 0.587 at ~184 rows per fold against a 0.596 majority baseline, rising
    # to 0.708 at ~713. The split discipline caps training at 445 rows, so where
    # this lands between those two figures decides whether the conflict subset
    # contains signal or noise - and Task 15's headline is meaningless if it is
    # noise. Measured here rather than discovered later.
    #
    # Calibration, not test: the test split is touched by nothing before Task 13.
    cal_pred = (p_cal[:, 1] >= 0.5).astype(int)
    cal_acc = float(np.mean(cal_pred == y_cal))
    cal_majority = float(max(y_cal.mean(), 1 - y_cal.mean()))

    # Emit a claim for every compound - see the in-sample hazard note above.
    all_ids = sorted(by_id)
    X_all = featurise([by_id[i]["smiles"] for i in all_ids])
    p_all = clf.predict_proba(X_all)
    # Similarity of every compound to its nearest TRAINING neighbour. Training
    # compounds score 1.0 against themselves and are trivially in domain, which is
    # correct - the model has seen them.
    nn_to_train = tanimoto_matrix(X_all, X_tr).max(axis=1)
    today = time.strftime("%Y-%m-%d")

    claims = []
    for cid, row, nn in zip(all_ids, p_all, nn_to_train):
        pred_set = prediction_set(row, qhat)
        in_domain = bool(nn >= ad_cutoff)

        if not in_domain:
            # Outside the chemical space the model learned. The prediction is not
            # trusted whatever its confidence, so the claim commits to nothing and
            # carries the flag R4 reads.
            assertion, strength = "ambiguous", 0.0
        elif len(pred_set) != 1:
            assertion, strength = "ambiguous", 0.0
        else:
            label = next(iter(pred_set))
            assertion = "toxic" if label == 1 else "safe"
            strength = float(row[label])

        claims.append({
            "id": f"{cid}:qsar",
            "compoundId": cid,
            "stream": "qsar",
            "assertion": assertion,
            "strength": round(strength, 4),
            "system": "in_silico",
            "measuresKeyEvent": None,      # structural correlation only -> R2 ranks it below
            "exposureRelevant": None,      # a structural model has no exposure axis
            "inApplicabilityDomain": in_domain,
            "klimisch": 3,                 # in-silico prediction, documented method
            "availableFrom": "2000-01-01", # structure is knowable from day one
            "provenance": {
                "kind": "database",
                "source": "DILIrank train split; Morgan r=2 2048-bit + HistGradientBoosting; split conformal",
                "retrieved": today,
            },
        })

    (OUT / "stream-qsar.json").write_text(json.dumps({
        "generatedAt": today,
        "seed": SEED,
        "alpha": ALPHA,
        "qhat": qhat,
        "applicabilityCutoff": round(ad_cutoff, 4),
        "applicabilityCutoffNote": (
            "Nearest-neighbour Tanimoto to the training set, below which a compound is "
            "flagged out of domain. Derived as the 5th percentile of the training set's "
            "own nearest-neighbour similarity, not picked. R4's registered framework note "
            "defines the applicability domain by likeness to the training set; the empty "
            "conformal set an earlier draft used is unreachable for a binary problem "
            "whenever qhat >= 0.5."
        ),
        "calibrationCoverage": coverage,
        "calibrationCoverageNote": (
            "Coverage on the split that SET the threshold, so it sits at 1-alpha close to "
            "by construction and is a consistency check rather than evidence of "
            "generalisation. The out-of-sample coverage check is Task 15's, on the test split."
        ),
        "calibrationAccuracy": round(cal_acc, 4),
        "calibrationMajorityBaseline": round(cal_majority, 4),
        "beatsMajorityBaseline": bool(cal_acc > cal_majority),
        "nTrain": len(train_ids),
        "trainedOn": train_ids,
        "inSampleWarning": (
            "Claims are emitted for every compound, including the trainedOn set. Those "
            "predictions are in-sample. Report only on the test split."
        ),
        "claims": claims,
    }, indent=2))

    n_out = sum(1 for c in claims if c["inApplicabilityDomain"] is False)
    n_amb = sum(1 for c in claims if c["assertion"] == "ambiguous" and c["inApplicabilityDomain"])
    print(f"trained on {len(train_ids)} compounds")
    print(f"qhat={qhat:.4f}  calibration coverage={coverage:.3f} (target {1 - ALPHA:.2f})")
    print(f"applicability cutoff (5th pct of train NN Tanimoto)={ad_cutoff:.4f}")
    print(f"calibration accuracy={cal_acc:.4f}  majority baseline={cal_majority:.4f}  "
          f"beats baseline={cal_acc > cal_majority}")
    print(f"claims={len(claims)}  out-of-domain={n_out}  ambiguous-in-domain={n_amb}  "
          f"committed={len(claims) - n_out - n_amb}")
    if cal_acc <= cal_majority:
        print("\n*** WARNING: the QSAR stream does not beat the majority-class baseline "
              "out of sample. Its disagreements with other streams will be noise, and "
              "Task 15's conflict-subset headline will measure nothing. ***")


if __name__ == "__main__":
    main()
