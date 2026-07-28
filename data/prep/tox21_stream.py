"""In-vitro evidence from Tox21 / PubChem BioAssay.

Two streams come out of this:
  cytotox     -> hepatic viability / mitochondrial readouts
  transporter -> bile-salt-export-pump readouts where any exist

DISCOVERY, and why it is not the plan's version. The plan resolved assay names via
`GET /assay/name/{query}/aids/JSON`. That endpoint DOES NOT EXIST - it returns
HTTP 400 PUGREST.BadRequest. `find_aids` would therefore have returned [] for every
query, the per-stream loop would have skipped every compound on `if not aids`, and
stream-tox21.json would have been written containing ZERO claims. With no Tox21
stream there is no second source, so the entire cross-stream conflict subset - the
headline metric - would have been empty, and the script would have printed
"NONE FOUND - will fall back to literature" while implementing no fallback.

Verified working replacements, checked live before this was written:
  - E-utilities esearch over the `pcassay` database for name search
  - /assay/aid/{aids}/description/JSON for titles, in batches
  - /assay/aid/{aid}/CSV?cid=... for outcomes, filtered server-side by CID so we
    fetch kilobytes instead of the 26MB full table
  - /compound/inchikey/{k1,k2,...}/cids/JSON for batched structure -> CID

Whatever is discovered is PINNED into the output, so the pull is auditable and a
re-run that silently resolves different assays is visible as a diff.

SILENCE IS NOT AMBIGUITY. Where a compound has no usable readout we emit NOTHING
for that stream. A silent source must reach fusion as m(Theta)=1, and the way to
say silent is to have no claim at all - an "ambiguous" claim is a source that spoke
and declined, which is a different statement.
"""
import json
import pathlib
import time
import urllib.parse

import requests

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
CID_CACHE = OUT / "cid-cache.json"
REST = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"

# Search terms per stream, and the keywords an assay TITLE must match to be kept.
# Both are pinned here and echoed into the output so the selection is contestable.
STREAM_QUERIES = {
    "cytotox": {
        "terms": [
            "Tox21[All Fields] AND viability[All Fields]",
            "Tox21[All Fields] AND mitochondrial membrane potential[All Fields]",
            "Tox21[All Fields] AND cytotoxicity[All Fields] AND HepG2[All Fields]",
        ],
        "title_any": ["viability", "cytotox", "mitochondrial membrane potential"],
        "title_none": [],
    },
    "transporter": {
        "terms": [
            "bile salt export pump[All Fields]",
            "BSEP[All Fields] AND inhibition[All Fields]",
        ],
        # Must be an INHIBITION measurement. "bsep" alone also matches assays that
        # measure the opposite direction.
        "title_any": ["inhibition of bsep", "inhibition of human bsep", "bile salt export pump"],
        # EXCLUSIONS, added after inspecting what the keyword filter actually
        # selected. Two of the four kept assays were "Ratio of drug concentration
        # at steady state ... to IC50 for human BSEP" - pharmacokinetic margin
        # measurements for particular drugs, not inhibition screens. They match
        # "bsep" in their titles, but an "Active" outcome there means something
        # entirely different from inhibiting the transporter, and reading them as
        # transporter evidence would be a category error.
        "title_none": [
            # PK margin measurements for particular drugs, not inhibition screens.
            # "Active" there means something entirely different from inhibiting the
            # transporter, so reading them as transporter evidence is a category error.
            "ratio of drug concentration", "steady state",
            # Wrong species and wrong direction: one selected assay was "Activation of
            # FXR in C57BL/6 MOUSE liver assessed as UPREGULATION of BSEP gene
            # expression". This stream hardcodes system: "human", so a mouse assay
            # would emit a false statement about the biology - and upregulating the
            # transporter is protective, the opposite of inhibiting it.
            "mouse", "gene expression", "upregulation", "activation of fxr",
        ],
    },
}

MAX_AIDS_PER_STREAM = 4     # keep the pull bounded and the provenance readable
CID_BATCH = 100
PAUSE = 0.25                # PubChem asks for <=5 req/s


def esearch_aids(term: str, retmax: int = 30) -> list[int]:
    try:
        r = requests.get(ESEARCH, params={
            "db": "pcassay", "term": term, "retmax": retmax, "retmode": "json",
        }, timeout=30)
        if r.ok:
            return [int(x) for x in r.json()["esearchresult"]["idlist"]]
    except Exception:
        pass
    return []


def assay_titles(aids: list[int]) -> dict[int, str]:
    """AID -> title, in batches."""
    titles: dict[int, str] = {}
    for i in range(0, len(aids), 20):
        chunk = aids[i:i + 20]
        try:
            r = requests.get(f"{REST}/assay/aid/{','.join(map(str, chunk))}/description/JSON", timeout=60)
            if r.ok:
                for a in r.json().get("PC_AssayContainer", []):
                    d = a["assay"]["descr"]
                    titles[int(d["aid"]["id"])] = d.get("name", "")
        except Exception:
            pass
        time.sleep(PAUSE)
    return titles


def resolve_cids(inchikeys: list[str]) -> dict[str, int]:
    """InChIKey -> CID, batched.

    PubChem returns a flat CID list with no echo of which key produced which entry,
    so a batch is only safe when the counts line up. When they do not, the batch is
    retried one key at a time rather than risking a silent mis-join - a wrong
    structure/CID pairing would attach one drug's assay results to another drug.
    """
    out: dict[str, int] = {}
    if CID_CACHE.exists():
        cached = json.loads(CID_CACHE.read_text())
        out.update({k: v for k, v in cached.items() if k in set(inchikeys)})
        print(f"  CID cache: {len(out)} entries")
    inchikeys = [k for k in inchikeys if k not in out]
    if not inchikeys:
        return out
    for i in range(0, len(inchikeys), CID_BATCH):
        chunk = inchikeys[i:i + CID_BATCH]
        got: list[int] = []
        try:
            r = requests.get(f"{REST}/compound/inchikey/{','.join(chunk)}/cids/JSON", timeout=60)
            if r.ok:
                got = r.json().get("IdentifierList", {}).get("CID", [])
        except Exception:
            got = []
        time.sleep(PAUSE)

        if len(got) == len(chunk):
            out.update(dict(zip(chunk, got)))
        else:
            for k in chunk:
                try:
                    r = requests.get(f"{REST}/compound/inchikey/{k}/cids/JSON", timeout=20)
                    if r.ok:
                        cids = r.json().get("IdentifierList", {}).get("CID", [])
                        if cids:
                            out[k] = cids[0]
                except Exception:
                    pass
                time.sleep(PAUSE)
        print(f"  CIDs {min(i + CID_BATCH, len(inchikeys))}/{len(inchikeys)} ({len(out)} resolved)", flush=True)
    CID_CACHE.write_text(json.dumps(out, indent=2, sort_keys=True))
    return out


def outcomes_for_aid(aid: int, cids: list[int]) -> dict[int, list[str]]:
    """CID -> activity outcomes for one assay, fetched in CID batches."""
    found: dict[int, list[str]] = {}
    for i in range(0, len(cids), CID_BATCH):
        chunk = cids[i:i + CID_BATCH]
        try:
            r = requests.get(f"{REST}/assay/aid/{aid}/CSV",
                             params={"cid": ",".join(map(str, chunk))}, timeout=120)
            if not r.ok:
                time.sleep(PAUSE)
                continue
            lines = r.text.splitlines()
            if not lines:
                continue
            header = lines[0].split(",")
            try:
                i_cid = header.index("PUBCHEM_CID")
                i_out = header.index("PUBCHEM_ACTIVITY_OUTCOME")
            except ValueError:
                continue
            for line in lines[1:]:
                parts = line.split(",")
                if len(parts) <= max(i_cid, i_out):
                    continue
                raw_cid, outcome = parts[i_cid].strip(), parts[i_out].strip()
                if not raw_cid.isdigit() or not outcome:
                    continue
                found.setdefault(int(raw_cid), []).append(outcome)
        except Exception:
            pass
        time.sleep(PAUSE)
    return found


def main() -> None:
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    today = time.strftime("%Y-%m-%d")

    # 1. Discover and pin the assays.
    selected: dict[str, dict[int, str]] = {}
    for stream, cfg in STREAM_QUERIES.items():
        candidates: list[int] = []
        for term in cfg["terms"]:
            candidates += esearch_aids(term)
            time.sleep(PAUSE)
        candidates = sorted(set(candidates))
        titles = assay_titles(candidates)
        keep = {
            aid: t for aid, t in sorted(titles.items())
            if any(k in t.lower() for k in cfg["title_any"])
            and not any(k in t.lower() for k in cfg.get("title_none", []))
        }
        selected[stream] = dict(list(keep.items())[:MAX_AIDS_PER_STREAM])
        print(f"{stream}: {len(candidates)} candidates -> {len(keep)} title-matched -> "
              f"{len(selected[stream])} kept")
        for aid, t in selected[stream].items():
            print(f"    AID {aid}: {t[:95]}")

    # 2. Structures -> CIDs.
    print("resolving CIDs...")
    keys = [c["compoundId"] for c in compounds]
    cid_of = resolve_cids(keys)
    cid_to_key = {v: k for k, v in cid_of.items()}
    all_cids = sorted(cid_to_key)
    print(f"  {len(all_cids)} of {len(keys)} structures resolved to a CID")

    # 3. Outcomes per stream.
    claims = []
    per_stream_hits: dict[str, int] = {}
    for stream, aids in selected.items():
        if not aids:
            print(f"{stream}: no assays selected - emitting nothing (silence, not ambiguity)")
            per_stream_hits[stream] = 0
            continue
        merged: dict[int, list[str]] = {}
        for aid in aids:
            print(f"  pulling AID {aid} for {stream}...", flush=True)
            for cid, outs in outcomes_for_aid(aid, all_cids).items():
                merged.setdefault(cid, []).extend(outs)

        n = 0
        for cid, outs in sorted(merged.items()):
            # Inconclusive/unspecified readouts are not evidence either way and are
            # dropped BEFORE the fraction is computed, so they cannot drag it toward
            # 0.5 and manufacture a spurious near-tie.
            usable = [o for o in outs if o.lower().startswith(("active", "inactive"))]
            if not usable:
                continue
            n_active = sum(1 for o in usable if o.lower().startswith("active"))
            frac = n_active / len(usable)

            if frac == 0.5:
                # An exact split is the source disagreeing with itself. The plan's
                # `frac >= 0.5` branch called this "toxic" at strength 0.0 - a
                # committed assertion carrying no mass, which reads as a toxic
                # finding in the trace while contributing nothing to the verdict.
                assertion, strength = "ambiguous", 0.0
            else:
                assertion = "toxic" if frac > 0.5 else "safe"
                strength = round(abs(frac - 0.5) * 2 * 0.9, 4)

            key = cid_to_key[cid]
            claims.append({
                "id": f"{key}:{stream}",
                "compoundId": key,
                "stream": stream,
                "assertion": assertion,
                "strength": strength,
                "system": "human",
                "measuresKeyEvent": "KE:BSEP-INHIBITION" if stream == "transporter" else "KE:HEPATOCYTE-DEATH",
                "exposureRelevant": False,   # HTS concentrations are not clinical exposure
                "inApplicabilityDomain": True,
                "klimisch": 2,
                "availableFrom": "2010-01-01",
                "provenance": {
                    "kind": "database",
                    "source": f"Tox21/PubChem AIDs {sorted(aids)} ({len(usable)} readouts, {n_active} active)",
                    "retrieved": today,
                },
            })
            n += 1
        per_stream_hits[stream] = n
        print(f"{stream}: {n} claims")

    claims.sort(key=lambda c: (c["compoundId"], c["stream"]))
    (OUT / "stream-tox21.json").write_text(json.dumps({
        "generatedAt": today,
        "discovery": {
            "method": "E-utilities esearch over pcassay, then title keyword filter. "
                      "The plan's /assay/name/{q}/aids endpoint returns HTTP 400 and does not exist.",
            "queries": {k: v["terms"] for k, v in STREAM_QUERIES.items()},
            "titleKeywords": {k: v["title_any"] for k, v in STREAM_QUERIES.items()},
            "titleExclusions": {k: v.get("title_none", []) for k, v in STREAM_QUERIES.items()},
            "maxAidsPerStream": MAX_AIDS_PER_STREAM,
        },
        "resolvedAids": {k: {str(a): t for a, t in v.items()} for k, v in selected.items()},
        "nStructuresResolvedToCid": len(all_cids),
        "claimsPerStream": per_stream_hits,
        "independenceCaveat": (
            "cytotox and transporter are DISTINCT STREAMS but may share Tox21 as a platform. "
            "R6 proxies source independence by stream, so concordance between them overstates "
            "how independent they are. This cannot reach a verdict - R6's boost is diagnostic "
            "only - but it does affect the reported concordance figure. The pre-registered "
            "conflict-subset definition in spec section 11 explicitly rules a hepatocyte assay "
            "disagreeing with a transporter assay IN, so the metric is unaffected."
        ),
        "claims": claims,
    }, indent=2))
    print(f"Wrote {len(claims)} in-vitro claims across "
          f"{len({c['compoundId'] for c in claims})} compounds")


if __name__ == "__main__":
    main()
