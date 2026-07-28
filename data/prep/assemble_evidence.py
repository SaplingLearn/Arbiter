"""Merge every stream into data/out/evidence.json.

Declares benchmarkCompoundIds explicitly so the harness cannot accidentally score
the TAK-994 fixture, and records per-stream provenance counts so the UI can badge
DATABASE vs LITERATURE honestly.
"""
import json
import pathlib
import time
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"


def read(name: str) -> list[dict]:
    p = OUT / name
    if not p.exists():
        print(f"  (missing {name} - skipping)")
        return []
    return json.loads(p.read_text())["claims"]


def main() -> None:
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    splits = json.loads((OUT / "splits.json").read_text())
    claims = read("stream-qsar.json") + read("stream-tox21.json") + read("tak994.json")
    claims.sort(key=lambda c: (c["compoundId"], c["stream"], c["id"]))

    ids = [c["id"] for c in claims]
    dupes = [k for k, n in Counter(ids).items() if n > 1]
    if dupes:
        raise SystemExit(f"Duplicate claim ids: {dupes[:5]}")

    benchmark_ids = sorted(c["compoundId"] for c in compounds)
    fixture_ids = {c["compoundId"] for c in read("tak994.json")}
    overlap = fixture_ids & set(benchmark_ids)
    if overlap:
        raise SystemExit(f"The fixture is inside the benchmark set: {overlap}")

    # How many streams actually commit per compound. This is the number that decides
    # whether a cross-stream conflict is even POSSIBLE, so it is reported rather
    # than discovered later in Task 13.
    committed_streams: dict[str, set[str]] = {}
    for c in claims:
        if c["compoundId"] in fixture_ids:
            continue
        if c["assertion"] in ("toxic", "safe"):
            committed_streams.setdefault(c["compoundId"], set()).add(c["stream"])
    multi = sum(1 for v in committed_streams.values() if len(v) >= 2)

    (OUT / "evidence.json").write_text(json.dumps({
        "generatedAt": time.strftime("%Y-%m-%d"),
        "benchmarkCompoundIds": benchmark_ids,
        "testSplitCompoundIds": sorted(splits["test"]),
        "fixtureCompoundIds": sorted(fixture_ids),
        "provenanceCounts": dict(Counter(c["provenance"]["kind"] for c in claims)),
        "streamCounts": dict(Counter(c["stream"] for c in claims)),
        "compoundsWithAtLeastTwoCommittedStreams": multi,
        "claims": claims,
    }, indent=2))
    print(json.dumps({
        "claims": len(claims),
        "benchmarkCompounds": len(compounds),
        "byStream": dict(Counter(c["stream"] for c in claims)),
        "byProvenance": dict(Counter(c["provenance"]["kind"] for c in claims)),
        "compoundsWithAtLeastTwoCommittedStreams": multi,
    }, indent=2))


if __name__ == "__main__":
    main()
