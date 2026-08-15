import json, sys
from pathlib import Path
sys.path.insert(0, "data/prep")
import pymupdf
from split_review import _all_matches, _first_match, NONCLINICAL_PATTERNS, CLINICAL_PATTERNS

def largest_span(pages, toc=8):
    """Largest nonclinical-heading -> next-clinical-heading span. No contiguity rules:
    the gate asks whether a tox chapter EXISTS, not whether it can be cut out cleanly."""
    best = 0
    for s in _all_matches(pages, NONCLINICAL_PATTERNS, after=toc):
        e = _first_match(pages, CLINICAL_PATTERNS, after=s + 1)
        if e is not None and e > s:
            best = max(best, e - s)
    return best

corpus = Path("data/raw/approval-packages")
entries = json.loads((corpus / "gate-manifest.json").read_text())["documents"]
acc, ref = [], []
for e in entries:
    d = pymupdf.open(corpus / e["file"])
    pages = [d[i].get_text() for i in range(d.page_count)]
    d.close()
    n = largest_span(pages)
    (acc if e["expect"] == "accept" else ref).append((n, e["file"]))
    print(f"{e['file'][:52]:<52} {e['expect']:<8} span={n:>3}")
print()
print("genuine reviews   span min/max:", min(a[0] for a in acc), "/", max(a[0] for a in acc))
print("  weakest:", sorted(acc)[0][1], sorted(acc)[0][0])
print("should-refuse     span min/max:", min(r[0] for r in ref), "/", max(r[0] for r in ref))
print("  strongest:", sorted(ref)[-1][1], sorted(ref)[-1][0])
