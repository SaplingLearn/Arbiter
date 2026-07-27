"""Task-zero spike: do genuine cross-stream conflicts exist at usable scale?

Answers one question and then exits. If the answer is "no", the conflict-subset
metric in spec section 11 has no population and the plan changes before any more
code is written.

WHAT THE ORIGINAL PLAN MEASURED, AND WHY IT IS NOT ENOUGH
---------------------------------------------------------
The plan's spike counted compounds where a QSAR-style structural prediction
disagrees with the DILIrank label. That quantity is just the model's error count:
a model with 70% accuracy disagrees on 30% of compounds by construction, so on a
250-compound sample the plan's `nConflicting < 30` gate cannot realistically
fail. A gate that cannot fail is not a gate.

It is also not the thing the spec defines. DILIrank is the LABEL, not a stream.
The pre-registered conflict subset is "some stream committing to toxic differs
from some stream committing to safe" - a disagreement BETWEEN SOURCES, with the
label playing no part in deciding membership.

So this script reports both, and treats the second as the real gate:

  nConflicting          stream A vs the DILIrank label. Retained because the plan
                        pre-registered a threshold against it, and because a
                        LOW value would still invalidate the thesis: if structure
                        alone nearly predicts DILI, nobody needs ARBITER.

  nCrossStreamConflict  stream A vs stream B - two independent representations of
                        the same molecules (Morgan substructure fingerprints
                        against physicochemical descriptors), each predicting
                        out-of-fold. This is a source-versus-source disagreement,
                        the same shape as the real conflict subset, and it is the
                        best available proxy before Tox21 lands in Task 12.

Both are proxies and neither is the final number. The authoritative conflict
count comes from Task 13 over the real four streams. This is a go/no-go probe.
"""
import json
import pathlib
import re
import sys
import time

import numpy as np
import pandas as pd
import requests
from rdkit import Chem, RDLogger
from rdkit.Chem import Crippen, Descriptors, rdFingerprintGenerator, rdMolDescriptors
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import StratifiedKFold

RDLogger.DisableLog("rdApp.*")

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "dilirank.xlsx"
RULESET = ROOT / "rules" / "ruleset-v1.0.json"
OUT = ROOT / "data" / "out"
CACHE = OUT / "smiles-cache.json"

SEED = 20260726

# 250 is the plan's pre-registered sample size and stays the default so the gate
# numbers are reproducible. Pass a larger n (or 0 for all 982) as argv[1] to run
# the training-set-size diagnostic: with 2048-bit fingerprints and ~184 training
# rows per fold, a weak model may be telling you about the sample rather than
# about DILI. Task 11 needs to know which.
SAMPLE_N = 250

# Published DILIrank 2.0 distribution, keyed by normalised label. Asserted so a
# parsing or matching regression fails loudly instead of quietly shrinking the
# evaluation set to nothing.
EXPECTED_2_0 = {
    "vmostdiliconcern": 217,
    "vlessdiliconcern": 351,
    "vnodiliconcern": 414,
    "ambiguousdiliconcern": 354,
}


def norm_label(s: str) -> str:
    """Lowercase and strip every non-letter.

    MANDATORY, not cosmetic. The workbook's category values are internally
    inconsistent in case and punctuation, and the pre-registered strings in
    ruleset-v1.0.json match almost none of them literally: "vMost-DILI-Concern"
    matches 0 rows against the file's "vMost-DILI-concern" (215) and
    "vMOST-DILI-concern" (2). An exact-match ingest yields an evaluation set of
    ONE compound.

    Normalising both sides is what makes the pre-registered policy mean what it
    says. It does not change the policy, so ruleset-v1.0.json stays untouched
    and its hash stands. Kept identical to Task 10's norm_label on purpose.
    """
    return re.sub(r"[^a-z]", "", str(s).lower())


def load_dilirank() -> pd.DataFrame:
    if not RAW.exists():
        sys.exit(f"Missing {RAW}. See data/prep/README.md for the download step.")

    # sheet_name=0 is DILIrank 2.0 (1,336 drugs); sheet 1 is the superseded 1.0
    # (1,036). header=1 because row 0 is a title banner, not column names - the
    # default header=0 makes every column "Unnamed: N" and the lookups below
    # raise StopIteration.
    df = pd.read_excel(RAW, sheet_name=0, header=1)

    name_col = next(c for c in df.columns if "compound" in c.lower() or "drug" in c.lower())
    # "concern" ONLY, and never `or "severity"`. The columns are LTKBID,
    # CompoundName, SeverityClass, LabelSection, vDILI-Concern, Comment, so a
    # "severity" clause matches SeverityClass - an integer grade - before it ever
    # reaches the label column, and binarisation would run on integers.
    label_col = next(c for c in df.columns if "concern" in c.lower())

    out = df[[name_col, label_col]].rename(columns={name_col: "name", label_col: "label"})
    out["name"] = out["name"].astype(str).str.strip()
    out["labelNorm"] = out["label"].map(norm_label)

    counts = out["labelNorm"].value_counts().to_dict()
    for key, expected in EXPECTED_2_0.items():
        got = counts.get(key, 0)
        if got != expected:
            sys.exit(
                f"DILIrank 2.0 category '{key}': expected {expected} rows, got {got}. "
                "The workbook, the sheet index, or the header row has changed - "
                "stop and re-verify before trusting any downstream number."
            )

    policy = json.loads(RULESET.read_text())["dilirankBinarisation"]
    positive = {norm_label(s) for s in policy["positive"]}
    negative = {norm_label(s) for s in policy["negative"]}

    binary = out[out["labelNorm"].isin(positive | negative)].copy()
    binary["y"] = binary["labelNorm"].isin(positive).astype(int)
    binary = binary.drop_duplicates(subset="name").reset_index(drop=True)

    if len(binary) < 900:
        sys.exit(f"Only {len(binary)} binary-labelled compounds; expected ~982. "
                 "That is the signature of the exact-match bug norm_label exists to prevent.")
    return binary[["name", "label", "y"]]


def resolve_smiles(names: list[str]) -> dict[str, str]:
    """Resolve compound names to SMILES via PubChem PUG-REST, throttled to 4/s.

    Requests `property/SMILES` and reads the first key containing "SMILES".
    PubChem renamed these properties: asking for `CanonicalSMILES` still returns
    HTTP 200 but the JSON key comes back as `ConnectivitySMILES`, so looking up
    props[0]["CanonicalSMILES"] resolves ZERO compounds while every request
    reports success.
    """
    cache: dict[str, str] = {}
    if CACHE.exists():
        cache = json.loads(CACHE.read_text())
        print(f"  SMILES cache: {len(cache)} entries")

    todo = [n for n in names if n not in cache]
    base = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name"
    misses = 0
    for i, name in enumerate(todo):
        try:
            r = requests.get(f"{base}/{requests.utils.quote(name)}/property/SMILES/JSON", timeout=20)
            if r.ok:
                props = r.json()["PropertyTable"]["Properties"]
                if props:
                    key = next((k for k in props[0] if "SMILES" in k), None)
                    if key:
                        cache[name] = props[0][key]
                    else:
                        misses += 1
                        if misses <= 3:
                            print(f"  ! no SMILES-like key for {name!r}: keys={list(props[0])}")
        except Exception:
            pass
        time.sleep(0.25)  # PubChem asks for <=5 req/s
        if (i + 1) % 25 == 0:
            print(f"  resolved {i + 1}/{len(todo)} ({len(cache)} cached total)", flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, indent=2, sort_keys=True))
    return {n: cache[n] for n in names if n in cache}


def morgan(mols: list) -> np.ndarray:
    """Stream A's representation: substructure presence."""
    gen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    return np.vstack([np.array(gen.GetFingerprint(m), dtype=np.int8) for m in mols])


DESCRIPTORS = [
    ("MolWt", Descriptors.MolWt),
    ("MolLogP", Crippen.MolLogP),
    ("MolMR", Crippen.MolMR),
    ("TPSA", rdMolDescriptors.CalcTPSA),
    ("NumHDonors", rdMolDescriptors.CalcNumHBD),
    ("NumHAcceptors", rdMolDescriptors.CalcNumHBA),
    ("NumRotatableBonds", rdMolDescriptors.CalcNumRotatableBonds),
    ("NumAromaticRings", rdMolDescriptors.CalcNumAromaticRings),
    ("RingCount", rdMolDescriptors.CalcNumRings),
    ("FractionCSP3", rdMolDescriptors.CalcFractionCSP3),
    ("HeavyAtomCount", Descriptors.HeavyAtomCount),
    ("NumHeteroatoms", rdMolDescriptors.CalcNumHeteroatoms),
    ("LabuteASA", rdMolDescriptors.CalcLabuteASA),
    ("NumAmideBonds", rdMolDescriptors.CalcNumAmideBonds),
]


def physchem(mols: list) -> np.ndarray:
    """Stream B's representation: bulk physicochemical properties.

    Deliberately shares no features with stream A. Morgan fingerprints ask "does
    this substructure appear"; these ask "how big, how greasy, how polar". Two
    genuinely different readings of the same molecule, which is what makes their
    disagreement stand in for a cross-stream conflict rather than for noise.
    """
    return np.vstack([np.array([fn(m) for _, fn in DESCRIPTORS], dtype=np.float64) for m in mols])


def out_of_fold(X: np.ndarray, y: np.ndarray, folds: list) -> np.ndarray:
    """Every compound scored by a model that never saw it."""
    pred = np.zeros(len(y), dtype=int)
    for tr, te in folds:
        clf = HistGradientBoostingClassifier(max_iter=150, random_state=SEED).fit(X[tr], y[tr])
        pred[te] = clf.predict(X[te])
    return pred


def main() -> None:
    n_arg = int(sys.argv[1]) if len(sys.argv) > 1 else SAMPLE_N
    df = load_dilirank()
    print(f"DILIrank 2.0 binary-labelled compounds: {len(df)} "
          f"({int(df['y'].sum())} positive, {int((1 - df['y']).sum())} negative)")

    n_take = len(df) if n_arg == 0 else min(n_arg, len(df))
    sample = df.sample(n=n_take, random_state=SEED).reset_index(drop=True)
    print(f"Sampling {len(sample)} (seed {SEED}); resolving SMILES via PubChem...")

    smiles_map = resolve_smiles(sample["name"].tolist())
    sample["smiles"] = sample["name"].map(smiles_map)
    sample = sample.dropna(subset=["smiles"]).reset_index(drop=True)

    # Drop anything RDKit cannot parse, rather than substituting a zero vector -
    # an all-zero fingerprint is a real point in feature space and the model
    # would happily learn from it.
    sample["mol"] = sample["smiles"].map(Chem.MolFromSmiles)
    n_unparsed = int(sample["mol"].isna().sum())
    sample = sample.dropna(subset=["mol"]).reset_index(drop=True)
    print(f"Resolved to SMILES: {len(sample)} usable ({n_unparsed} unparseable, dropped)")

    if len(sample) < 50:
        sys.exit(f"Only {len(sample)} usable compounds - too few to conclude anything. "
                 "Check PubChem connectivity and the SMILES property key.")

    mols = sample["mol"].tolist()
    y = sample["y"].to_numpy()
    folds = list(StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED).split(mols, y))

    pred_a = out_of_fold(morgan(mols), y, folds)      # stream A: structural
    pred_b = out_of_fold(physchem(mols), y, folds)    # stream B: physicochemical

    n_conflict = int((pred_a != y).sum())
    disagree = pred_a != pred_b
    n_cross = int(disagree.sum())

    # THE NUMBER THAT DECIDES WHETHER ARBITRATION IS POSSIBLE AT ALL.
    #
    # A population of disagreements is necessary but not sufficient: if the two
    # streams are coin flips, something has to decide them and no rule can beat
    # 50%. So measure how often stream A is the correct one ON THE DISAGREEMENT
    # SUBSET. Distance from 0.5 is the arbitrable signal. (B's figure is
    # 1 - A's by construction - on a binary disagreement exactly one side is
    # right - so only A's is reported.)
    #
    # An earlier draft of this script also reported nCrossStreamResolvable,
    # "disagreements where at least one stream was correct". That is 100% by
    # construction for two binary predictors and measured nothing - exactly the
    # can't-fail metric this project keeps catching in its own tests.
    a_wins_when_split = float((pred_a == y)[disagree].mean()) if n_cross else float("nan")

    # The floor any claim of skill has to clear. With a 59.6% positive rate,
    # "always predict toxic" scores 59.6%.
    majority_baseline = float(max(y.mean(), 1 - y.mean()))

    report = {
        "nCompounds": int(len(df)),
        "nWithBothStreams": int(len(sample)),
        "nConflicting": n_conflict,
        "conflictRate": round(n_conflict / len(sample), 4),
        "nCrossStreamConflict": n_cross,
        "crossStreamConflictRate": round(n_cross / len(sample), 4),
        "streamAWinRateWhenStreamsSplit": round(a_wins_when_split, 4),
        "accuracyStreamA": round(float((pred_a == y).mean()), 4),
        "accuracyStreamB": round(float((pred_b == y).mean()), 4),
        "majorityClassBaseline": round(majority_baseline, 4),
        "streamsBeatMajorityBaseline": bool(
            (pred_a == y).mean() > majority_baseline or (pred_b == y).mean() > majority_baseline),
        "positiveRateSample": round(float(y.mean()), 4),
        "seed": SEED,
        "dilirankVersion": "2.0 (sheet 0)",
        "note": (
            "nConflicting is stream-A-vs-LABEL disagreement, i.e. model error - retained "
            "because the plan pre-registered a threshold against it. nCrossStreamConflict "
            "is stream-A-vs-stream-B, a source-versus-source disagreement, which is the "
            "shape the pre-registered conflict subset actually has. Both are proxies; the "
            "authoritative count comes from Task 13 over the real four streams."
        ),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    # The pre-registered n=250 run and the full-set diagnostic are different
    # measurements and both matter, so neither overwrites the other.
    name = "spike-report.json" if n_arg == SAMPLE_N else f"spike-report-n{len(sample)}.json"
    report["requestedSampleN"] = "all" if n_arg == 0 else n_arg
    (OUT / name).write_text(json.dumps(report, indent=2))
    print()
    print(json.dumps(report, indent=2))
    print(f"\nwrote data/out/{name}")

    print()
    if n_conflict < 30:
        print("*** GATE A FAILED: fewer than 30 QSAR-vs-label conflicts. Structure alone "
              "nearly predicts DILI on this sample; the premise needs revisiting. ***")
    else:
        print(f"GATE A passed: {n_conflict} QSAR-vs-label conflicts (>= 30).")

    if n_cross < 30:
        print("*** GATE B FAILED: fewer than 30 cross-stream conflicts. Two independent "
              "representations almost never disagree, so the conflict subset has no "
              "population and spec section 11's headline metric is underpowered. "
              "REPORT THIS BEFORE WRITING MORE CODE. ***")
    else:
        print(f"GATE B passed: {n_cross} cross-stream conflicts.")

    # A populated conflict subset built from two skill-free streams would give the
    # headline metric an N and nothing to measure. This is a warning about Task 11,
    # not a verdict on the premise, so it is reported separately from the gates.
    print()
    if not report["streamsBeatMajorityBaseline"]:
        print(f"*** WARNING: neither stream beats the majority-class baseline "
              f"({majority_baseline:.3f}). A: {report['accuracyStreamA']:.3f}, "
              f"B: {report['accuracyStreamB']:.3f}. The conflict subset is populated but "
              f"the disagreements in it are mostly noise. Task 11's QSAR must carry real "
              f"skill or Task 15's headline measures nothing. ***")
    print(f"When the streams split, stream A is the correct one "
          f"{a_wins_when_split:.1%} of the time. Distance from 50% is the signal any "
          f"arbitration rule has to exploit; at exactly 50% no rule can beat a coin flip.")


if __name__ == "__main__":
    main()
