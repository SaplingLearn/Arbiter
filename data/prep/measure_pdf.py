"""Measure an uploaded PDF and say whether anything can read it.

WHY THIS EXISTS AS ITS OWN STEP. Two of the first five documents collected for this
project were unusable, and the failures were invisible until measured: one was 48
pages of scanned images with zero extractable characters, and one was 133 pages of
perfectly readable text that turned out to be a labelling supplement with no
toxicology review in it at all. Both would have produced a confident, empty case.

So an upload is measured BEFORE it is accepted, and the measurement is reported to
the person who uploaded it. The alternative - accept anything, discover later - puts
the discovery after somebody has already formed an opinion.

Prints one JSON object to stdout. Called from services/api/documents.ts.
"""
import json
import re
import sys

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover - environment problem, not a logic branch
    print(json.dumps({"ok": False, "reason": "PyMuPDF is not installed. pip install -r data/prep/requirements.txt"}))
    sys.exit(0)

# A page carrying fewer than this many characters is treated as unreadable. Chosen
# from the measured documents rather than guessed: the scanned tolcapone review has
# 0 characters per page, and the thinnest genuine text page in the readable set
# carries several hundred.
MIN_CHARS_PER_PAGE = 40

# Terms that must appear somewhere for this to be a document about toxicology at all.
# Troglitazone's labelling supplement is readable and scores zero on every one of
# them, which is exactly the case this catches.
TOX_TERMS = ["toxicolog", "nonclinical", "non-clinical", "pharmacolog", "NOAEL", "histopatholog"]
LIVER_TERMS = ["hepat", "liver", "transaminase", "ALT", "AST", "bilirubin", "cholestat", "biliary"]


def measure(path: str) -> dict:
    doc = fitz.open(path)
    try:
        pages = [p.get_text() for p in doc]
        images = sum(len(p.get_images(full=True)) for p in doc)
    finally:
        doc.close()

    text = "".join(pages)
    n = len(pages)
    sparse = sum(1 for p in pages if len(p.strip()) < MIN_CHARS_PER_PAGE)

    tox = {t: len(re.findall(t, text, re.I)) for t in TOX_TERMS}
    liver = {t: len(re.findall(t, text, re.I)) for t in LIVER_TERMS}

    result = {
        "pages": n,
        "characters": len(text),
        "charactersPerPage": len(text) // n if n else 0,
        "embeddedImages": images,
        "sparsePages": sparse,
        "toxTermHits": sum(tox.values()),
        "liverTermHits": sum(liver.values()),
        "termCounts": {"toxicology": tox, "liver": liver},
    }

    # Refusals, in the order they should be reported: a scan cannot be read at all,
    # so that verdict comes before any judgement about content.
    if n == 0:
        result.update(ok=False, verdict="empty", reason="The file contains no pages.")
    elif sparse == n:
        result.update(
            ok=False,
            verdict="scanned",
            reason=f"All {n} pages carry almost no extractable text. This is a scanned document and needs OCR before anything can read it.",
        )
    elif sparse > n * 0.5:
        result.update(
            ok=False,
            verdict="partly_scanned",
            reason=f"{sparse} of {n} pages carry almost no extractable text. Most of this document is images; OCR it before uploading.",
        )
    elif sum(tox.values()) == 0:
        result.update(
            ok=False,
            verdict="not_a_review",
            reason="The text is readable, but it contains no toxicology or nonclinical vocabulary anywhere. This is very likely a labelling document rather than a review.",
        )
    else:
        result.update(ok=True, verdict="readable", reason="Readable, and it contains toxicology vocabulary.")
        if sum(liver.values()) == 0:
            # Not a refusal. A genuine review with no liver vocabulary is a real
            # thing, and it is a finding about the compound rather than the file.
            result["note"] = "No liver vocabulary anywhere in the document. That may be correct, and the inventory will report it as absent evidence rather than as a bad upload."

    return result


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"ok": False, "reason": "usage: measure_pdf.py <file.pdf>"}))
        sys.exit(0)
    try:
        print(json.dumps(measure(sys.argv[1])))
    except Exception as exc:  # noqa: BLE001 - the caller needs the reason as JSON, not a traceback
        print(json.dumps({"ok": False, "verdict": "unreadable", "reason": f"Could not open the file: {exc}"}))
