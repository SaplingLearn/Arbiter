"""Split a regulatory review into the nonclinical chapter and everything after it.

WHY THIS EXISTS. Spec section 4.4. A modern FDA multi-discipline review or EMA
assessment report contains both the preclinical evidence and what subsequently
happened in humans. Feeding the model the nonclinical chapter alone and asking it
to predict the clinical one is a clean prospective experiment with the answer key
in the same file - no hindsight contamination, because the cut is mechanical
rather than a promise to ignore what one already knows.

THE CUT IS ENFORCED, NOT PROMISED. A single page of the clinical chapter reaching
the model turns the exercise into transcription. So:

  - the two page sets must be disjoint, asserted;
  - no page carrying a clinical-section heading may appear in the input set,
    asserted;
  - a document whose chapters cannot be located is REFUSED, not trimmed by hand.

That last one is the rule that matters. A hand-trimmed document is a document
whose contents nobody can reconstruct later, and "I checked it carefully" is not a
guard. Spec section 10 rule 14.

WHAT THIS DOES NOT DO. It does not judge whether the nonclinical chapter is
sufficient, and it does not extract findings - that needs a model, and the human
manifest of section 4.4a has to exist first or an extraction miss cannot be told
apart from absent data.
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

# Headings that open the preclinical chapter.
#
# WRITTEN AGAINST REAL DOCUMENTS, not from the template. A first draft guessed at
# the section numbering and matched neither of the two formats it was aimed at:
# EMA numbers the chapter 2.5, not 2.3, and writes "Non-clinical" with a hyphen and
# two spaces after the number. Both formats number the heading, so nothing here
# should assume an unnumbered one.
#   FDA  "5. Nonclinical Pharmacology/Toxicology"      -> p27 of NDA 211367
#   EMA  "2.5.  Non-clinical aspects"                  -> p32 of the imaavy EPAR
NONCLINICAL_PATTERNS = [
    r"^\s*[\d.]+\s+Nonclinical\s+Pharmacology",
    r"^\s*[\d.]+\s+Non-?clinical\s+aspects",
    r"^\s*[\d.]+\s+Pharmacology\s+and\s+Toxicology\s+Review",
]

# Headings that open the clinical chapter, i.e. the answer key. Everything from the
# first of these onward is withheld.
#   FDA  "6. Clinical Pharmacology"                    -> p29
#   EMA  "2.6.  Clinical aspects"                      -> p50
CLINICAL_PATTERNS = [
    r"^\s*[\d.]+\s+Clinical\s+(Safety|Efficacy|Pharmacology|aspects)",
    r"^\s*[\d.]+\s+Integrated\s+Review\s+of\s+(Effectiveness|Safety)",
    r"^\s*[\d.]+\s+Benefit.Risk\s+Assessment",
]

# Terms whose presence indicates the chapter REPORTS STUDIES rather than merely
# referring to them. See `_reports_studies`.
STUDY_EVIDENCE_TERMS = [
    r"NOAEL", r"mg/kg", r"\bdose[- ]group", r"histopatholog", r"toxicokinetic",
    r"\brat(s)?\b", r"\bdog(s)?\b", r"\bmouse\b", r"\bmice\b", r"\bmonkey",
    r"repeat[- ]dose", r"\bAmes\b", r"micronucleus", r"carcinogenicity study",
    r"exposure margin", r"\bin vitro\b", r"\bin vivo\b",
]

# Phrasing that says outright no studies were done. Checked explicitly because a
# chapter can carry a handful of incidental term matches while reporting nothing.
NO_STUDIES_PATTERNS = [
    r"did not conduct any new nonclinical",
    r"no new nonclinical [a-z/]+ studies were conducted",
    r"has not conducted nonclinical studies",
    r"no nonclinical studies were (conducted|required|requested)",
]


@dataclass
class Split:
    ok: bool
    reason: str
    nonclinical_pages: list[int]
    withheld_pages: list[int]
    nonclinical_start: int | None
    clinical_start: int | None


def _all_matches(pages: list[str], patterns: list[str], after: int = 0) -> list[int]:
    """Every page index whose text contains a line matching any pattern."""
    compiled = [re.compile(p, re.I | re.M) for p in patterns]
    return [
        i for i in range(after, len(pages))
        if any(c.search(pages[i]) for c in compiled)
    ]


def _first_match(pages: list[str], patterns: list[str], after: int = 0) -> int | None:
    found = _all_matches(pages, patterns, after)
    return found[0] if found else None


# Degenerate-match floor only. Two pages is enough to catch a match on a bare
# contents line; it is NOT a judgement about whether a chapter is substantial.
#
# THE GUARD THAT REPLACED A WRONG ONE. On a real 132-page FDA review the splitter
# returned a two-page nonclinical chapter and reported OK, which looked exactly like
# a heading-match bug. A page-count floor was added to catch it - and that floor was
# wrong. The chapter genuinely IS two pages: NDA 211367 is a 505(b)(2) whose
# applicant conducted no new nonclinical studies, and the chapter says so in as many
# words. A size floor would have rejected a correctly-split document for the wrong
# reason, and would reject any legitimately brief chapter elsewhere.
#
# What actually disqualifies that document is not its length but that it REPORTS NO
# STUDIES - there is nothing for an adjudicator to reason about. So the guard asks
# about substance instead, and says so in the refusal.
MIN_CHAPTER_PAGES = 2
MIN_STUDY_TERMS = 8


def _reports_studies(text: str) -> tuple[bool, str]:
    """Does this chapter report preclinical studies, or only refer to them?"""
    for p in NO_STUDIES_PATTERNS:
        if re.search(p, text, re.I):
            return False, f'chapter states outright that no studies were conducted ("{p}")'
    hits = sum(1 for t in STUDY_EVIDENCE_TERMS if re.search(t, text, re.I))
    if hits < MIN_STUDY_TERMS:
        return False, f"only {hits} of {len(STUDY_EVIDENCE_TERMS)} study-evidence terms present (need {MIN_STUDY_TERMS})"
    return True, f"{hits} study-evidence terms present"


def largest_nonclinical_span(pages: list[str], toc_pages: int = 8) -> int:
    """How many pages lie between a nonclinical heading and the next clinical one.

    A WEAKER TEST THAN plan_split, on purpose, and the difference is the point. Splitting
    needs boundaries clean enough to cut a PDF at, so plan_split refuses a document whose
    chapters interleave. The upload gate is asking something else - does a nonclinical
    review exist in here at all - and a document that cannot be cut cleanly can still be
    read by a person. Holding the gate to the splitter's standard refused
    modern-fda-multidiscipline-211367, a genuine review, for a reason that has nothing to
    do with whether it contains toxicology.

    Zero when no nonclinical heading is followed by a clinical one.
    """
    best = 0
    for s in _all_matches(pages, NONCLINICAL_PATTERNS, after=toc_pages):
        e = _first_match(pages, CLINICAL_PATTERNS, after=s + 1)
        if e is not None and e > s:
            best = max(best, e - s)
    return best


def plan_split(pages: list[str], toc_pages: int = 8) -> Split:
    """Decide the cut from page texts alone. Pure, so it is testable without a PDF.

    `toc_pages` skips the contents listing, whose entries otherwise match every
    heading pattern. Skipping it is necessary and, as the constants above record,
    nowhere near sufficient - executive summaries name every chapter too.

    The chapter is chosen as the LARGEST nonclinical-to-clinical span rather than
    the first, because a summary mention produces a short span and the real chapter
    produces a long one. Ties break on the earlier start so the result is stable.
    """
    if len(pages) <= toc_pages:
        return Split(False, f"Document has {len(pages)} pages; too short to split.", [], [], None, None)

    starts = _all_matches(pages, NONCLINICAL_PATTERNS, after=toc_pages)
    if not starts:
        return Split(False, "No nonclinical chapter heading found after the contents. REFUSED - do not trim by hand.", [], [], None, None)

    # Candidate spans: each nonclinical heading, paired with the next clinical
    # heading after it. Deduplicated on the resulting span so consecutive headings
    # inside one chapter do not each produce a candidate.
    candidates: list[tuple[int, int]] = []
    for s in starts:
        e = _first_match(pages, CLINICAL_PATTERNS, after=s + 1)
        if e is not None and e > s and (s, e) not in candidates:
            candidates.append((s, e))

    if not candidates:
        return Split(
            False,
            "Nonclinical chapter found but no clinical chapter after it. REFUSED - without "
            "an answer key in the same file this case tests nothing.",
            [], [], starts[0], None,
        )

    # IN DOCUMENT ORDER, first substantive candidate wins - not the longest.
    #
    # A largest-span rule looks reasonable and is wrong: on NDA 211367 it selected a
    # 16-page labelling appendix at p90 over the actual chapter at p27, because the
    # appendix happens to sit further from the next clinical heading. The first real
    # chapter IS the chapter; length is a coincidence of what follows it.
    nc = cl = None
    last_failure = ""
    for s, e in candidates:
        span = e - s
        if span < MIN_CHAPTER_PAGES:
            last_failure = (
                f"p{s}-{e - 1} is {span} page(s) - the signature of a contents line rather "
                "than a chapter"
            )
            continue
        reports, why = _reports_studies("\n".join(pages[s:e]))
        if not reports:
            last_failure = (
                f"chapter located correctly at p{s}-{e - 1} ({span} pages), but it reports no "
                f"preclinical studies: {why}. This is a property of the APPLICATION, not a "
                "splitting failure - replace the document rather than adjusting the split"
            )
            continue
        nc, cl = s, e
        break

    if nc is None or cl is None:
        return Split(
            False,
            f"No candidate chapter is usable. Last: {last_failure}. REFUSED - do not widen by hand.",
            [], [], candidates[0][0], candidates[0][1],
        )

    nonclinical = list(range(nc, cl))
    withheld = [i for i in range(len(pages)) if i not in set(nonclinical)]

    # Guard 1: disjoint. Cheap, and it is the property the whole design rests on.
    if set(nonclinical) & set(withheld):
        return Split(False, "Page sets overlap. REFUSED.", [], [], nc, cl)

    # Guard 2: no clinical heading inside the input set. Catches an interleaved
    # document where the chapters are not contiguous blocks - which the page-range
    # arithmetic above would otherwise paper over.
    compiled = [re.compile(p, re.I | re.M) for p in CLINICAL_PATTERNS]
    for i in nonclinical:
        for c in compiled:
            if c.search(pages[i]):
                return Split(False, f"A clinical heading appears on p{i}, inside the input range. REFUSED - chapters are not contiguous.", [], [], nc, cl)

    return Split(True, "ok", nonclinical, withheld, nc, cl)


def split_pdf(path: Path, out_dir: Path, toc_pages: int = 8) -> Split:
    # Imported here so plan_split stays testable without PyMuPDF. The new module name
    # first: imported as `fitz`, PyMuPDF >= 1.26 prints a deprecation banner to stdout,
    # and these scripts speak JSON on stdout.
    try:
        import pymupdf as fitz
    except ImportError:
        import fitz

    doc = fitz.open(path)
    pages = [doc[i].get_text() for i in range(doc.page_count)]

    scanned = sum(1 for t in pages if len(t.strip()) < 50)
    if scanned > len(pages) * 0.5:
        return Split(
            False,
            f"{scanned} of {len(pages)} pages carry almost no extractable text - this is a "
            "scanned document and needs OCR before anything can read it. REFUSED.",
            [], [], None, None,
        )

    plan = plan_split(pages, toc_pages=toc_pages)
    if not plan.ok:
        return plan

    out_dir.mkdir(parents=True, exist_ok=True)
    stem = path.stem
    (out_dir / f"{stem}.nonclinical.txt").write_text(
        "\n".join(pages[i] for i in plan.nonclinical_pages), encoding="utf-8")
    # The withheld half is written too, and that is deliberate: it is the answer
    # key, and scoring needs it. It is written to a DIFFERENT file so that nothing
    # assembling an adjudication payload can reach it by accident.
    (out_dir / f"{stem}.WITHHELD-answer-key.txt").write_text(
        "\n".join(pages[i] for i in plan.withheld_pages), encoding="utf-8")
    (out_dir / f"{stem}.split.json").write_text(
        json.dumps({
            "source": path.name,
            "totalPages": len(pages),
            **asdict(plan),
            "manifestRequired": (
                "A human must now list what the nonclinical chapter actually contains, "
                "before any model reads it. Spec section 4.4a: without that list, a finding "
                "missing from the output cannot be told apart from a finding missing from "
                "the document, and neither number can be interpreted."
            ),
        }, indent=2) + "\n", encoding="utf-8")
    return plan


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: python split_review.py <review.pdf> [out_dir]")
        raise SystemExit(2)
    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("data/out/reviews")

    plan = split_pdf(src, out)
    print(f"source            {src.name}")
    print(f"result            {'OK' if plan.ok else 'REFUSED'}")
    print(f"reason            {plan.reason}")
    if plan.ok:
        print(f"nonclinical       pages {plan.nonclinical_start}-{plan.clinical_start - 1} "
              f"({len(plan.nonclinical_pages)} pages)  -> model input")
        print(f"withheld          {len(plan.withheld_pages)} pages                -> answer key, never sent")
        print(f"written to        {out}")
        print()
        print("NEXT: a human writes the manifest of what the nonclinical chapter contains.")
        print("Until that exists, extraction cannot be scored in either direction.")


if __name__ == "__main__":
    main()
