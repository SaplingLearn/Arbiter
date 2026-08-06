"""Top tested concentration per compound and stream, for the ALREADY-PINNED AIDs.

This is the half of the margin ratio the repo has never had. outcomes_for_aid in
tox21_stream.py reads PUBCHEM_ACTIVITY_OUTCOME and nothing else, so no
concentration exists anywhere in ARBITER and no margin was ever established for
any compound - which is why every Tox21 claim currently carries a hardcoded
exposureRelevant: False it cannot support.

REUSES THE PINNED AIDS rather than re-running discovery. A re-discovery that
silently selected different assays would change the evidence base while looking
like a refresh, and stream-tox21.json's claims would then describe assays that no
longer back them.

ADDITIVE ONLY: stream-tox21.json is not rewritten. It stays byte-identical and
auditable, and the change shows up in exactly one place (assemble_evidence.py).

WHY THIS DOES NOT LOOK LIKE THE FIRST DRAFT: the initial plan was to read one
"concentration" column per row, the way a simple screening assay CSV works. The
real PubChem CSVs for the pinned AIDs do not have that column at all. Verified
live against all 8 pinned AIDs before writing this:

  cytotox (720634, 743086, 743203, 1224867): these are genuine qHTS titration
  curves. PubChem reports them WIDE, one block of columns per replicate run
  ("Potency-Replicate_1", "Activity at 0.0000044240 uM-Replicate_1", ... up to
  45 replicate blocks per AID). The concentration is not a cell value - it is
  encoded IN THE COLUMN NAME, and a cell is populated only for the concentration
  points that specific sample was actually tested at. So the top tested
  concentration for a compound is the max "Activity at X uM" column that has a
  non-blank value for one of its rows, not a value read out of a fixed column.
  A "RESULT_ATTR_CONC_MICROMOL" metadata row (its PUBCHEM_CID field is blank,
  so the existing CID digit-check already skips it as a row) independently
  confirms this: it echoes the same concentration back as the value under each
  "Activity at X uM" column name.

  transporter (1473738, 1820614, 1961262, 2225845): 1820614, 1961262 and 2225845
  return HTTP 404 ("No assay data found for the given AID") - PubChem no longer
  serves them under these AIDs. 1473738 is live but is a curated
  IC50-style deposit (columns "PubChem Standard Value" / "Standard Type: IC50" /
  "Standard Relation"), not a titration - there is no per-compound record of how
  high the concentration was actually run. Mapping that IC50 into
  topTestedConcUM would report an inhibition potency as if it were the assay's
  tested ceiling, which is a different quantity and would be wrong for every row
  where Standard Relation is "=" rather than ">". That is exactly the kind of
  substituted-value fabrication this script must not produce, so 1473738's data
  is read for nothing: it yields zero concentrations, and the transporter stream
  ends up empty. That is reported as a finding, not patched over with a guess.
"""
import csv
import io
import json
import re
import time

import requests

from dilirank_common import OUT

REST = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
CID_BATCH = 100
PAUSE = 0.25

# The real column shape (see module docstring): concentration lives in the
# HEADER NAME of a titration point column, not in a fixed "concentration" cell.
# "Activity at <uM> uM-Replicate_<n>" is populated for a compound's row only for
# the concentration points that sample was actually tested at.
ACTIVITY_COL_RE = re.compile(r"^Activity at ([0-9.eE+-]+) uM-Replicate_(\d+)$")
POTENCY_COL_RE = re.compile(r"^Potency-Replicate_(\d+)$")


def concentrations_for_aid(aid: int, cids: list[int]) -> tuple[dict[int, float], dict[int, float], bool]:
    """CID -> (top tested concentration uM, AC50 uM) for one assay.

    Returns (top, ac50, saw_titration_columns). The third value tells the
    caller whether this AID's CSV had the wide qHTS titration shape at all, so
    a dead or differently-shaped AID (see module docstring: 3 of the 4
    transporter AIDs 404, and the 4th is an IC50 deposit with no titration) can
    be reported as a finding instead of silently producing nothing or crashing
    a run where OTHER AIDs in the same stream did resolve.
    """
    top: dict[int, float] = {}
    ac50: dict[int, float] = {}
    saw_titration_columns = False

    for i in range(0, len(cids), CID_BATCH):
        chunk = cids[i:i + CID_BATCH]
        r = requests.get(f"{REST}/assay/aid/{aid}/CSV",
                         params={"cid": ",".join(map(str, chunk))}, timeout=120)
        if not r.ok:
            time.sleep(PAUSE)
            continue

        # csv module, not str.split(","): several metadata rows (RESULT_DESCR)
        # contain embedded commas inside quoted fields. The data rows for the
        # pinned AIDs verified clean under both, but the metadata rows do not,
        # and a naive split silently misaligns every column after that point.
        rows = list(csv.reader(io.StringIO(r.text)))
        if not rows:
            continue
        header = rows[0]
        i_cid = header.index("PUBCHEM_CID") if "PUBCHEM_CID" in header else None
        if i_cid is None:
            time.sleep(PAUSE)
            continue

        conc_cols: list[tuple[int, float]] = []
        potency_cols: dict[int, int] = {}
        for idx, name in enumerate(header):
            m = ACTIVITY_COL_RE.match(name)
            if m:
                conc_cols.append((idx, float(m.group(1))))
                continue
            m2 = POTENCY_COL_RE.match(name)
            if m2:
                potency_cols[int(m2.group(1))] = idx

        if not conc_cols:
            # This AID's CSV is not the wide qHTS titration shape (dead AID, or
            # a curated-value deposit like 1473738's IC50 columns). Nothing to
            # extract from THIS AID - move on rather than raising, so a stream
            # with other working AIDs still produces its data.
            time.sleep(PAUSE)
            continue
        saw_titration_columns = True

        for row in rows[1:]:
            if len(row) <= i_cid:
                continue
            raw_cid = row[i_cid].strip()
            if not raw_cid.isdigit():
                # Metadata rows (RESULT_TYPE, RESULT_DESCR, RESULT_UNIT,
                # RESULT_IS_ACTIVE_CONCENTRATION, RESULT_ATTR_CONC_MICROMOL)
                # leave PUBCHEM_CID blank and are filtered out here.
                continue
            cid = int(raw_cid)

            row_top = None
            for idx, conc in conc_cols:
                if idx < len(row) and row[idx].strip() != "":
                    if row_top is None or conc > row_top:
                        row_top = conc
            if row_top is not None and row_top > 0:
                top[cid] = max(top.get(cid, 0.0), row_top)

            # First valid potency reading wins for this CID within this AID -
            # mirrors the first-AID-wins merge already used across AIDs below.
            # AC50 is supplementary here (nullable in the output); the field
            # the margin depends on is topTestedConcUM above.
            for _, idx in sorted(potency_cols.items()):
                if idx < len(row) and row[idx].strip() != "":
                    try:
                        v = float(row[idx].strip())
                    except ValueError:
                        continue
                    ac50.setdefault(cid, v)
                    break
        time.sleep(PAUSE)

    return top, ac50, saw_titration_columns


def main() -> None:
    stream_doc = json.loads((OUT / "stream-tox21.json").read_text())
    cid_of = json.loads((OUT / "cid-cache.json").read_text())
    cid_to_key = {int(v): k for k, v in cid_of.items()}
    all_cids = sorted(cid_to_key)

    out: dict[str, dict] = {}
    aids_used: dict[str, list[int]] = {}

    for stream, aid_map in stream_doc["resolvedAids"].items():
        aids = sorted(int(a) for a in aid_map)
        aids_used[stream] = aids
        merged_top: dict[int, float] = {}
        merged_ac50: dict[int, float] = {}
        for aid in aids:
            print(f"  pulling concentrations for AID {aid} ({stream})...", flush=True)
            top, ac50, saw_titration_columns = concentrations_for_aid(aid, all_cids)
            if not saw_titration_columns:
                print(f"    AID {aid}: no qHTS titration columns found "
                      "(dead AID or non-titration deposit) - contributes nothing")
            for cid, v in top.items():
                merged_top[cid] = max(merged_top.get(cid, 0.0), v)
            for cid, v in ac50.items():
                merged_ac50.setdefault(cid, v)

        for cid, conc in sorted(merged_top.items()):
            out[f"{cid_to_key[cid]}:{stream}"] = {
                "topTestedConcUM": round(conc, 6),
                "ac50UM": (
                    None if cid not in merged_ac50 else round(merged_ac50[cid], 6)
                ),
            }
        n_stream = sum(1 for k in out if k.endswith(':' + stream))
        print(f"{stream}: {n_stream} concentrations")
        if n_stream == 0:
            print(f"  WARNING: {stream} stream resolved to ZERO concentrations. "
                  "This is a real finding (see module docstring), not a bug to "
                  "paper over with a substituted value.")

    if not out:
        raise SystemExit(
            "No concentrations resolved for any compound. The margin cannot be "
            "computed and exposureRelevant would be null for the entire corpus."
        )

    (OUT / "tox21-concentrations.json").write_text(json.dumps({
        "generatedAt": time.strftime("%Y-%m-%d"),
        "note": "Concentrations for the AIDs already pinned in stream-tox21.json. "
                "stream-tox21.json is NOT regenerated by this script.",
        "aidsUsed": aids_used,
        "nResolved": len(out),
        "concentrations": dict(sorted(out.items())),
    }, indent=2))
    print(f"Wrote data/out/tox21-concentrations.json ({len(out)} entries)")


if __name__ == "__main__":
    main()
