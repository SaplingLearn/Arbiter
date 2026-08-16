"""Measure the upload gate's accuracy against a labelled corpus.

WHY THIS EXISTS. `measure_pdf.py` decides which documents a reviewer may build a case
from. Its thresholds were chosen from fourteen documents that all had the same answer -
"accept" - which measures nothing: a gate that accepts everything scores 14/14 on that
set. Accuracy needs documents that SHOULD be refused, and enough of them to tell a
gate from a rubber stamp.

WHERE THE NEGATIVES COME FROM, and why they are not invented. Two are real: the scanned
tolcapone review and the troglitazone labelling supplement. The rest are DERIVED from
the genuine reviews by deleting their nonclinical chapter - the span `split_review.py`
already knows how to find - leaving a real regulatory document, with real clinical and
labelling prose, that genuinely cannot support a safety call. That is the exact mistake
a reviewer makes: uploading the clinical half of a package and expecting a tox case out
of it. Synthetic text would have proved only that the gate can read the words I chose.

Run:  python data/prep/gate_eval.py [--build] [corpus_dir]

  --build   regenerate the derived negatives from the genuine reviews first
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from measure_pdf import measure  # noqa: E402
from split_review import plan_split  # noqa: E402

MANIFEST = "gate-manifest.json"


def build_derived(corpus: Path, sources: list[Path]) -> list[dict]:
    """Two derivatives per source, and they pull the gate in opposite directions.

    `-clinical-only` deletes the nonclinical chapter: a real regulatory document with no
    tox review in it, which is the mistake of uploading the clinical half of a package.
    It must be REFUSED.

    `-nonclinical-only` keeps ONLY that chapter: a standalone Pharmacology/Toxicology
    review, which is what FDA published as its own document before the multidiscipline
    format and what a sponsor's own tox report looks like. It must be ACCEPTED - and it
    is the document most likely to break a structural test, because there is no clinical
    chapter after the nonclinical one for a span to end at.
    """
    import pymupdf

    out = []
    for src in sources:
        doc = pymupdf.open(src)
        try:
            pages = [doc[i].get_text() for i in range(doc.page_count)]
            plan = plan_split(pages)
            if not plan.ok:
                print(f"  skip {src.name}: {plan.reason}")
                continue

            # Everything that is NOT the nonclinical chapter. A real document, minus
            # the only part that could answer a nonclinical question.
            keep = [i for i in range(doc.page_count) if i not in set(plan.nonclinical_pages)]
            dest = corpus / f"{src.stem}-clinical-only.pdf"
            # DELETE the chapter from a copy rather than inserting the keepers one page
            # at a time. Page-by-page insertion re-embeds the shared fonts and images per
            # page: the first build turned 114 MB of sources into 428 MB of derivatives.
            # `garbage=4` then drops what the deletion orphaned.
            new = pymupdf.open(src)
            new.delete_pages(sorted(set(plan.nonclinical_pages)))
            new.save(dest, garbage=4, deflate=True)
            new.close()
            out.append({
                "file": dest.name,
                "expect": "refuse",
                "why": f"{src.stem} with its {len(plan.nonclinical_pages)}-page nonclinical chapter removed. "
                       "Real clinical and labelling prose, no tox review.",
            })
            print(f"  built {dest.name} ({len(keep)} of {doc.page_count} pages)")

            keep_nc = sorted(set(plan.nonclinical_pages))
            dest2 = corpus / f"{src.stem}-nonclinical-only.pdf"
            only = pymupdf.open(src)
            only.delete_pages([i for i in range(doc.page_count) if i not in set(keep_nc)])
            only.save(dest2, garbage=4, deflate=True)
            only.close()
            out.append({
                "file": dest2.name,
                "expect": "accept",
                "why": f"{src.stem}'s nonclinical chapter alone ({len(keep_nc)}pp) - a standalone "
                       "Pharmacology/Toxicology review, the pre-multidiscipline FDA format.",
            })
            print(f"  built {dest2.name} ({len(keep_nc)} of {doc.page_count} pages)")
        finally:
            doc.close()
    return out


def evaluate(corpus: Path, manifest: list[dict]) -> int:
    rows, tp, tn, fp, fn = [], 0, 0, 0, 0

    for entry in manifest:
        path = corpus / entry["file"]
        if not path.exists():
            print(f"MISSING {entry['file']}")
            return 2
        m = measure(str(path))
        got = "accept" if m["ok"] else "refuse"
        want = entry["expect"]
        ok = got == want
        if want == "accept":
            tp, fn = (tp + 1, fn) if ok else (tp, fn + 1)
        else:
            tn, fp = (tn + 1, fp) if ok else (tn, fp + 1)
        rows.append((entry["file"], want, got, m.get("verdict", "-"), ok,
                     m["termCounts"]["toxicology"] if "termCounts" in m else {}))

    print(f"\n{'DOCUMENT':<52} {'WANT':<8} {'GOT':<8} {'VERDICT':<14} {'':<3} tox/nonclin")
    for f, want, got, verdict, ok, t in rows:
        nc = t.get("nonclinical", 0) + t.get("non-clinical", 0) if t else 0
        print(f"{f[:52]:<52} {want:<8} {got:<8} {verdict:<14} {'ok' if ok else 'XX':<3} "
              f"{t.get('toxicolog', 0) if t else 0}/{nc}")

    total = tp + tn + fp + fn
    # Recall on the positives is the number that matters most: a gate that refuses a
    # real review has silently removed a reviewer's evidence, and they cannot argue with
    # it. A false accept is recoverable - the inventory shows the gaps.
    print(f"\n  accepted correctly (TP) {tp:>3}      refused correctly (TN) {tn:>3}")
    print(f"  WRONGLY REFUSED    (FN) {fn:>3}      WRONGLY ACCEPTED  (FP) {fp:>3}")
    print(f"\n  accuracy  {(tp + tn) / total:.3f}   ({tp + tn}/{total})")
    if tp + fn:
        print(f"  recall    {tp / (tp + fn):.3f}   of genuine reviews admitted")
    if tp + fp:
        print(f"  precision {tp / (tp + fp):.3f}   of admitted documents that are genuine")
    return 0 if fp == 0 and fn == 0 else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("corpus", nargs="?", default="data/raw/approval-packages")
    ap.add_argument("--build", action="store_true", help="regenerate derived negatives")
    args = ap.parse_args()

    corpus = Path(args.corpus)
    manifest_path = corpus / MANIFEST
    if not manifest_path.exists():
        print(f"No {MANIFEST} in {corpus}.")
        raise SystemExit(2)
    entries = json.loads(manifest_path.read_text(encoding="utf-8"))["documents"]

    if args.build:
        genuine = [corpus / e["file"] for e in entries
                   if e["expect"] == "accept"
                   and not e["file"].endswith(("-clinical-only.pdf", "-nonclinical-only.pdf"))]
        print("Building derived documents:")
        derived = build_derived(corpus, genuine)
        keep = [e for e in entries
                if not e["file"].endswith(("-clinical-only.pdf", "-nonclinical-only.pdf"))]
        manifest_path.write_text(
            json.dumps({"documents": keep + derived}, indent=2) + "\n", encoding="utf-8")
        entries = keep + derived

    raise SystemExit(evaluate(corpus, entries))
