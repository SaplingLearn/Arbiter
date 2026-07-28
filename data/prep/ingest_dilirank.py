"""DILIrank -> compounds.json, keyed by InChIKey.

The InChIKey is the compoundId throughout ARBITER. Every database uses different
identifiers for the same drug; chemical structure is the only crosswalk that
actually works, and the spec calls this out as the one real engineering gotcha.
Getting it right here means every later stream joins for free.

Binarisation follows rules/ruleset-v1.0.json - the PRE-REGISTERED policy, not a
choice made here.

DATASET PROVENANCE, which must be reported wherever a number from it is shown:
DILIrank **2.0** (1,336 FDA-approved drugs; SHEET 0 of the FDA workbook), NOT the
superseded 1.0 (1,036 drugs, sheet 1). 2.0 adds 300 drugs approved 2010-2021 and
RECLASSIFIES 49 of the originals, so the version is not an incidental detail - the
same compound can carry a different label between versions, and a result is not
reproducible without it.
"""
import json
import time

from dilirank_common import (
    OUT,
    binarisation_policy,
    inchikey_from_smiles,
    norm_label,
    read_raw,
    resolve_smiles,
)


def main() -> None:
    policy = binarisation_policy()
    # BOTH sides normalised through the SAME function - see norm_label.
    positive = {norm_label(s) for s in policy["positive"]}
    negative = {norm_label(s) for s in policy["negative"]}

    df = read_raw()
    print(f"DILIrank 2.0 rows: {len(df)}")

    keep = df["labelNorm"].isin(positive | negative)
    n_excluded = int((~keep).sum())
    df = df[keep].copy()
    print(f"Binary-labelled: {len(df)}  (excluded by policy: {n_excluded})")

    # Expected on DILIrank 2.0: 568 positive (217 + 351), 414 negative, 354
    # excluded as Ambiguous -> 982 usable, 57.8% positive. A near-empty set here is
    # the signature of the exact-match bug norm_label exists to prevent.
    if len(df) < 900:
        raise SystemExit(
            f"Only {len(df)} binary-labelled compounds; expected ~982. The "
            "binarisation policy is not matching the file's category values."
        )

    # From labelNorm, NOT from the raw dilirankLabel. `positive` holds NORMALISED
    # strings, so testing the raw label against it is False for every row and every
    # compound comes out negative - a silent all-one-class dataset. The stratified
    # split would then fail with a confusing message about a single-class split
    # rather than pointing here.
    df["y"] = df["labelNorm"].isin(positive).astype(int)
    print(f"  positive {int(df['y'].sum())}, negative {int((1 - df['y']).sum())}")

    smiles_map = resolve_smiles(df["name"].tolist())
    df["smiles"] = df["name"].map(smiles_map)
    unresolved = df["smiles"].isna().sum()
    df = df.dropna(subset=["smiles"]).copy()

    # InChIKey computed from the SMILES we will actually featurise, so the key and
    # the structure cannot disagree.
    df["inchikey"] = df["smiles"].map(inchikey_from_smiles)
    unparsed = df["inchikey"].isna().sum()
    df = df.dropna(subset=["inchikey"]).copy()
    print(f"Resolved structures: {len(df)}  (unresolved by PubChem: {unresolved}, unparseable by RDKit: {unparsed})")

    # One row per structure. Two names for one InChIKey is the same molecule.
    before_dedup = len(df)
    df = df.drop_duplicates(subset="inchikey").reset_index(drop=True)
    print(f"Unique structures: {len(df)}  (collapsed {before_dedup - len(df)} duplicate structures)")

    compounds = [
        {
            "compoundId": r.inchikey,
            "name": r.name_,
            "smiles": r.smiles,
            "inchikey": r.inchikey,
            "dilirankLabel": r.dilirankLabel,
            "y": int(r.y),
        }
        for r in df.rename(columns={"name": "name_"}).itertuples()
    ]
    compounds.sort(key=lambda c: c["compoundId"])  # stable output ordering

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "compounds.json").write_text(json.dumps({
        "generatedAt": time.strftime("%Y-%m-%d"),
        "dataset": "DILIrank 2.0 (sheet 0 of the FDA LTKB workbook), 1336 drugs",
        "binarisationPolicy": policy,
        "nExcludedByPolicy": n_excluded,
        "nCompounds": len(compounds),
        "nPositive": sum(c["y"] for c in compounds),
        "compounds": compounds,
    }, indent=2))
    print(f"Wrote {len(compounds)} compounds ({sum(c['y'] for c in compounds)} positive) to data/out/compounds.json")


if __name__ == "__main__":
    main()
