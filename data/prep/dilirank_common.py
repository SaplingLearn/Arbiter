"""Shared DILIrank loading and structure resolution.

Every defect this module exists to prevent was measured on the real FDA workbook,
not guessed at. See the docstrings below.

NOT imported by `spike_conflict_count.py`, deliberately. That script is the frozen
record of Task 1's decision gate, and the committed numbers in
`data/out/spike-report*.json` were produced by exactly the code that is committed
beside them. Refactoring it would mean the script no longer matches its own output.
It therefore carries its own copy of `norm_label`, kept identical to this one.
"""
import json
import pathlib
import re
import time

import pandas as pd
import requests
from rdkit import Chem, RDLogger

RDLogger.DisableLog("rdApp.*")

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "dilirank.xlsx"
OUT = ROOT / "data" / "out"
RULESET = ROOT / "rules" / "ruleset-v1.0.json"
SMILES_CACHE = OUT / "smiles-cache.json"
PUBCHEM = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name"

# Published DILIrank 2.0 distribution, keyed by normalised label. Asserted so a
# parsing or matching regression fails loudly instead of quietly shrinking the
# evaluation set that every downstream metric is computed over.
EXPECTED_2_0 = {
    "vmostdiliconcern": 217,
    "vlessdiliconcern": 351,
    "vnodiliconcern": 414,
    "ambiguousdiliconcern": 354,
}


def binarisation_policy() -> dict:
    """The PRE-REGISTERED policy, read rather than decided here."""
    return json.loads(RULESET.read_text())["dilirankBinarisation"]


def norm_label(s: str) -> str:
    """Lowercase and strip every non-letter.

    MANDATORY, not cosmetic. The workbook's category values are internally
    inconsistent in case and punctuation, and the pre-registered strings in
    ruleset-v1.0.json match almost none of them literally. Measured on the real
    file:

      pre-registered "vMost-DILI-Concern"  vs  file "vMost-DILI-concern" (215)
                                           and "vMOST-DILI-concern" (2)   -> 0 rows
      pre-registered "vLess-DILI-Concern"  vs  file "vLess-DILI-concern" (351) -> 0 rows
      pre-registered "vNo-DILI-Concern"    vs  file "vNo-DILI-concern" (413)
                                           and "vNo-DILI-Concern" (1)     -> 1 row

    An exact-match ingest therefore yields an evaluation set of ONE compound and
    raises nothing. Normalising both sides is what makes the pre-registered policy
    mean what it says; it does not change the policy, so ruleset-v1.0.json stays
    untouched and its hash stands.

    Sheet 1 (the superseded 1.0) differs again - no "v" prefix, and "Ambiguous
    DILI-concern" with a SPACE - which is why this must not be an alias table.
    """
    return re.sub(r"[^a-z]", "", str(s).lower())


def read_raw() -> pd.DataFrame:
    """Sheet 0 of the FDA workbook as {name, dilirankLabel, labelNorm}."""
    if not RAW.exists():
        raise SystemExit(f"Missing {RAW}. See data/prep/README.md.")

    # sheet_name=0 is DILIrank 2.0 (1,336 drugs); sheet 1 is the superseded 1.0
    # (1,036). header=1 because row 0 is a title banner, not column names - with
    # the default header=0 every column becomes "Unnamed: N" and the lookups below
    # raise StopIteration.
    df = pd.read_excel(RAW, sheet_name=0, header=1)

    name_col = next(c for c in df.columns if "compound" in c.lower() or "drug" in c.lower())
    # "concern" ONLY, never `or "severity"`. The columns are LTKBID, CompoundName,
    # SeverityClass, LabelSection, vDILI-Concern, Comment - so a "severity" clause
    # matches SeverityClass, an integer grade, before it ever reaches the label
    # column, and binarisation would run on integers.
    label_col = next(c for c in df.columns if "concern" in c.lower())

    out = df[[name_col, label_col]].rename(columns={name_col: "name", label_col: "dilirankLabel"})
    out["name"] = out["name"].astype(str).str.strip()
    out["dilirankLabel"] = out["dilirankLabel"].astype(str).str.strip()
    out["labelNorm"] = out["dilirankLabel"].map(norm_label)

    counts = out["labelNorm"].value_counts().to_dict()
    if counts != EXPECTED_2_0:
        raise SystemExit(
            "DILIrank 2.0 category distribution does not match the published one.\n"
            f"  expected: {EXPECTED_2_0}\n  got:      {counts}\n"
            "Either the wrong sheet/header was read or the file changed. Do not "
            "proceed - every downstream metric is computed over this set."
        )
    print(f"DILIrank 2.0 category counts verified against publication: {counts}")
    return out


def resolve_smiles(names: list[str]) -> dict[str, str]:
    """name -> SMILES via PubChem PUG-REST, cached on disk, throttled to 4/s.

    Requests `property/SMILES` and reads the first key CONTAINING "SMILES".
    PubChem renamed these properties: asking for `CanonicalSMILES` still returns
    HTTP 200, but the JSON key comes back as `ConnectivitySMILES`, so a lookup of
    props["CanonicalSMILES"] resolves ZERO compounds while every request reports
    success - and the failure looks like a network problem rather than a key-name
    problem. Verified live before this was written.

    The cache is committed. PubChem is a live service that can re-resolve a name or
    change a canonicalisation, and an unpinned resolution turns a "reproduction"
    into a different experiment.
    """
    cache: dict[str, str] = {}
    if SMILES_CACHE.exists():
        cache = json.loads(SMILES_CACHE.read_text())
        print(f"  SMILES cache: {len(cache)} entries")

    todo = [n for n in names if n not in cache]
    if todo:
        print(f"  resolving {len(todo)} uncached names via PubChem...")
    for i, name in enumerate(todo):
        try:
            r = requests.get(f"{PUBCHEM}/{requests.utils.quote(name)}/property/SMILES/JSON", timeout=20)
            if r.ok:
                props = r.json()["PropertyTable"]["Properties"]
                if props:
                    key = next((k for k in props[0] if "SMILES" in k), None)
                    if key:
                        cache[name] = props[0][key]
        except Exception:
            pass
        time.sleep(0.25)  # PubChem asks for <=5 req/s
        if (i + 1) % 50 == 0:
            print(f"    {i + 1}/{len(todo)} ({len(cache)} cached total)", flush=True)

    if todo:
        OUT.mkdir(parents=True, exist_ok=True)
        SMILES_CACHE.write_text(json.dumps(cache, indent=2, sort_keys=True))
    return {n: cache[n] for n in names if n in cache}


def inchikey_from_smiles(smiles: str) -> str | None:
    """InChIKey computed LOCALLY from the SMILES, not fetched as a second field.

    One source of truth: the key identifies exactly the structure the QSAR stream
    featurises. Fetching it separately would allow a SMILES/InChIKey pair that
    disagree, and there would be no way to tell which one a join was keyed on.
    Verified to agree with PubChem's own value (aspirin -> BSYNRYMUTXBXSQ-UHFFFAOYSA-N).

    Returns None for anything RDKit cannot parse - a SMILES we cannot read is one
    no downstream stream can featurise.
    """
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    try:
        key = Chem.MolToInchiKey(mol)
    except Exception:
        return None
    return key or None
