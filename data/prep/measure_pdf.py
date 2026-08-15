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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from split_review import largest_nonclinical_span

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

# Pages a nonclinical chapter must span. THIS is what separates a review from the
# clinical half of one, and the word counts alone could not.
#
# Measured over 29 documents (data/prep/gate_eval.py): the fourteen genuine reviews plus
# fifteen negatives, thirteen of which are those same reviews with their nonclinical
# chapter deleted - the exact mistake of uploading the clinical half of a package.
#
#                        toxicolog   chapter span
#   genuine reviews         19-71        14-48
#   clinical-only           6-19          0-14
#
# Counting mentions cannot do this. "Toxicology" and "nonclinical" appear in the
# contents, the executive summary and every cross-reference, so deleting the chapter
# only takes krazati from 71 mentions to 14 - inside the genuine range. On word counts
# alone the gate scored 0.586 accuracy and admitted twelve of thirteen clinical-only
# documents.
#
# Twelve, below the weakest genuine chapter of fourteen. One negative also spans
# fourteen (inrebic, whose executive summary sits fourteen pages before a clinical
# heading), so this corpus has one unavoidable collision and the threshold is set to
# keep every genuine document rather than to win it. A false REFUSAL silently removes a
# reviewer's evidence and they cannot argue with it; a false ACCEPT produces an
# inventory visibly full of gaps, which is a thing they can see.
MIN_CHAPTER_PAGES = 12

# A document that is ENTIRELY nonclinical has no clinical chapter for a span to end at,
# so the structural test scores it zero and refuses it. That is not a corner case: it is
# the standalone Pharmacology/Toxicology Review - what FDA published as its own document
# before the multidiscipline format, and the shape of a sponsor's own tox report. The
# first version of the chapter rule refused ALL THIRTEEN in the corpus and took recall
# from 1.000 to 0.519, which is the worst failure this gate can have: the most valuable
# document a reviewer owns, rejected with a message about chapters.
#
# So density rescues them. Toxicology mentions per page, measured:
#
#   nonclinical-only (must accept)   0.44 - 1.24
#   clinical-only    (must refuse)   0.06 - 0.09
#
# 0.25 sits between, with roughly 2x headroom to the weakest document it must admit and
# 3x to the strongest it must refuse. It does not have to carry the full reviews - those
# pass on their chapter - so it can be set purely to separate these two.
MIN_TOX_DENSITY = 0.25
LIVER_TERMS = ["hepat", "liver", "transaminase", "ALT", "AST", "bilirubin", "cholestat", "biliary"]


def review_signal(tox: dict) -> bool:
    """Whether the toxicology vocabulary is dense enough to be a nonclinical review.

    Either signal on its own is enough; see REVIEW_TERMS for why, and for the measured
    counts the thresholds come from. NECESSARY, NOT SUFFICIENT - it is what catches a
    labelling supplement, and it cannot tell a review from the clinical half of one.
    See MIN_CHAPTER_PAGES for the test that can.
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

    span = largest_nonclinical_span(pages)

    result = {
        "pages": n,
        "nonclinicalChapterPages": span,
        "toxPerPage": round(tox["toxicolog"] / n, 3) if n else 0,
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
    elif span < MIN_CHAPTER_PAGES and tox["toxicolog"] / n < MIN_TOX_DENSITY:
        result.update(
            ok=False,
            verdict="no_nonclinical_chapter",
            reason=(
                "The text is readable and mentions toxicology, but there is no nonclinical "
                f"chapter in it: the longest run between a nonclinical heading and the next "
                f"clinical one is {span} page(s), and toxicology is mentioned on "
                f"{tox['toxicolog'] / n:.2f} of every page. A review that can support a safety "
                "call either carries a nonclinical chapter or is one throughout. This looks "
                "like the clinical half of a package, or a summary that refers to a review "
                "held elsewhere."
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
