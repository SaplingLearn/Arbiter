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

# PyMuPDF >= 1.26 prints a deprecation banner to STDOUT when it is imported as `fitz`,
# and these scripts talk to services/api by printing one JSON object to stdout. The
# banner lands in front of it, every JSON.parse on the Node side fails, and the result is
# that EVERY upload of EVERY document is refused on any current install. Import the new
# module name first; keep the old one so older environments still work.
try:
    import pymupdf as fitz
except ImportError:  # pragma: no cover - environment problem, not a logic branch
    try:
        import fitz  # PyMuPDF < 1.26
    except ImportError:
        print(json.dumps({"ok": False, "reason": "PyMuPDF is not installed. pip install -r data/prep/requirements.txt"}))
        sys.exit(0)

# A page carrying fewer than this many characters is treated as unreadable. Chosen
# from the measured documents rather than guessed: the scanned tolcapone review has
# 0 characters per page, and the thinnest genuine text page in the readable set
# carries several hundred.
MIN_CHARS_PER_PAGE = 40

# Vocabulary counted and reported. Kept whole because the counts are diagnostic - a
# reader deciding whether a refusal was fair wants to see them - but NOT all of it is
# evidence that a nonclinical review is present. See REVIEW_TERMS.
TOX_TERMS = ["toxicolog", "nonclinical", "non-clinical", "pharmacolog", "NOAEL", "histopatholog"]

# The terms that actually MARK a nonclinical toxicology review, and the floor each has
# to clear. Measured over the sixteen documents in data/raw/approval-packages rather
# than guessed, which is the same standard MIN_CHARS_PER_PAGE is held to.
#
#                        toxicolog   nonclinical(+non-clinical)
#   14 genuine reviews      19-71            7-86
#   troglitazone             2               0
#   tolcapone (scanned)      0               0
#
# WHY THE OLD RULE MISSED. It summed all six TOX_TERMS and refused only at exactly
# zero. Troglitazone's labelling supplement scores 24 on that sum - nineteen of them
# the word "pharmacolog", which appears in the clinical pharmacology section of any
# drug document and says nothing about whether a tox review is present. So the one
# document this project cites as its example of "readable but not a review" passed the
# check written to catch it. The comment here claimed it scored zero on every term; it
# does not, and that claim is why nobody looked.
#
# NOAEL is deliberately NOT required: five of the fourteen genuine reviews never use
# it, so requiring it would refuse real documents.
#
# EITHER signal suffices. A document may say "nonclinical" throughout and "toxicology"
# rarely, or the reverse, and requiring both would refuse a real review over a
# vocabulary preference.
#
# Each floor sits BELOW the weakest genuine document on its own axis, so neither axis
# depends on the other to admit anything in the corpus - toxicolog 10 against a weakest
# 19, nonclinical 5 against a weakest 7 (xpovio). A first pass set both to ten, which
# was above xpovio's seven: it still passed on its toxicolog count, but the nonclinical
# floor was doing no work and the comment claiming a margin was wrong. The test that
# pins this caught it.
#
# Against troglitazone the margins are 5x on toxicolog and absolute on nonclinical,
# which it scores zero on.
REVIEW_TERMS = {"toxicolog": 10, "nonclinical+non-clinical": 5}
LIVER_TERMS = ["hepat", "liver", "transaminase", "ALT", "AST", "bilirubin", "cholestat", "biliary"]


def review_signal(tox: dict) -> bool:
    """Whether the toxicology vocabulary is dense enough to be a nonclinical review.

    Either signal on its own is enough; see REVIEW_TERMS for why, and for the measured
    counts the thresholds come from.
    """
    return (
        tox["toxicolog"] >= REVIEW_TERMS["toxicolog"]
        or tox["nonclinical"] + tox["non-clinical"] >= REVIEW_TERMS["nonclinical+non-clinical"]
    )


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
    elif not review_signal(tox):
        result.update(
            ok=False,
            verdict="not_a_review",
            reason=(
                "The text is readable, but it carries almost no nonclinical toxicology "
                f"vocabulary: {tox['toxicolog']} mentions of toxicology and "
                f"{tox['nonclinical'] + tox['non-clinical']} of nonclinical across {n} pages. "
                "A review that supports a safety call discusses both throughout. This is "
                "very likely a labelling or clinical document rather than a nonclinical review."
            ),
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
