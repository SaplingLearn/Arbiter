"""Refuse a nonclinical extract that references the clinical outcome.

WHY THIS EXISTS, AND WHY IT IS BLOCKING. Completion plan Gate 3a; HANDOVER 13.4c.

`split_review.py` cuts a review at the chapter boundary and the design document
claimed that made the exercise blind: the model reads the nonclinical chapter, the
clinical chapter is the answer key, and the cut is mechanical rather than a promise.
That claim was MEASURED ON 2026-08-09 AND IT IS FALSE. An FDA multi-disciplinary
review is one document written by reviewers who already knew the clinical result,
and its nonclinical chapter cross-references that result in its own words. From
Turalio's nonclinical chapter, verbatim:

    "The liver is a major target organ CLINICALLY, with frequent elevations in
     transaminases, including serious ones (refer to Section 8.3 of the review for
     details)."

That sentence is the answer key sitting inside the input. Cutting at the chapter
boundary moved the pages, not the knowledge. Without this screen, "the model
predicted the clinical outcome" can mean "the model read the sentence that stated
it", and every prediction number the project reports would be uninterpretable.

EMA assessment reports do not have this problem in the same way: the non-clinical
section is written separately and before the clinical one. Nipocalimab's extract
carries no such reference. So this is not a reason to abandon prediction scoring -
it is the filter that decides which documents can carry it.

REFUSES, NEVER TRIMS. Same rule as split_review.py and for the same reason: a
hand-trimmed document is one nobody can reconstruct later, and "I deleted the bad
sentence" is not a guard a reader can check. A document that leaks is disqualified
as a PREDICTION case and stays usable as a DELIBERATION case, which is exactly what
happened to Turalio.

WHAT THIS DOES NOT DO. It does not prove a passing document is blind. It catches
explicit textual cross-references, which is the failure that was measured; a reviewer
who alludes to a clinical finding without any of this vocabulary would pass. Stating
that matters more than the guard does: a reader who believes this certifies blindness
will trust a property nobody built.
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, asdict
from pathlib import Path

# WRITTEN AGAINST THE MEASURED FAILURE, not invented from a template. Each pattern
# below is here because it appears in, or directly generalises, the Turalio sentence
# quoted in the module docstring.
#
# Deliberately NOT included: bare "clinical". A nonclinical chapter says "clinical
# pathology", "clinical signs" and "clinical chemistry" constantly, all of which are
# in-life observations in an animal study and none of which leak a human outcome.
# Matching it would refuse every document in the corpus and the screen would be
# switched off within a day - a guard everyone disables protects nothing.
LEAK_PATTERNS: list[tuple[str, str]] = [
    (r"\bclinically\b",
     "adverb form is almost always used to contrast animal findings with the human result"),
    (r"\bin\s+the\s+clinic\b",
     "names the human setting directly"),
    (r"\bin\s+patients\b",
     "a nonclinical chapter has no patients"),
    (r"\brefer\s+to\s+section\s+[\d.]+\s+of\s+the\s+review\b",
     "an explicit pointer into the withheld chapter"),
    (r"\b(see|refer\s+to)\s+section\s+(6|7|8)[\d.]*\b",
     "FDA multi-discipline reviews number the clinical chapters 6-8"),
    (r"\bclinical\s+(trial|study|studies|experience|outcome|finding|data)\b",
     "names human evidence as a source"),
    (r"\bhuman\s+(hepatotoxicity|liver\s+injury|DILI)\b",
     "states the endpoint in humans, which is the answer being predicted"),
    (r"\bpost[- ]?marketing\b",
     "post-marketing evidence postdates the decision point being replayed"),
    (r"\bboxed\s+warning\b",
     "a label outcome, not a preclinical finding"),
    (r"\bhepatotoxicity\s+(was|has\s+been)\s+(observed|reported)\s+in\s+(humans|patients|subjects)\b",
     "states the outcome outright"),
]

# Kept separate because these are the phrases that make an otherwise-suspicious
# match innocent. "Clinical signs" in a rat study is not a leak.
#
# `clinically relevant|significant` EARNED ITS PLACE HERE by a false positive on the
# first real run, 2026-08-10. The nipocalimab chapter reads "the absence of findings
# in clinically relevant changes in serum clinical chemistry" - which is a
# toxicologist's term of art for "of a magnitude that would matter", said about the
# ANIMAL study. It is one of the commonest phrases in nonclinical prose, and a screen
# that refuses it refuses nearly every document, which is the failure mode that gets
# a guard switched off. Note this suppresses the phrase, not the word: "a similar
# pattern appears clinically" in the same document is still caught, and should be.
BENIGN_CONTEXTS = [
    r"clinical\s+(sign|pathology|chemistry|observation|condition)",
    r"clinical\s+candidate",
    r"clinically\s+(relevant|significant|meaningful)",
]


@dataclass
class Hit:
    pattern: str
    why: str
    line: int
    excerpt: str


@dataclass
class Screen:
    ok: bool
    reason: str
    source: str
    hits: list[dict]
    lines_scanned: int


def _excerpt(line: str, start: int, end: int, window: int = 110) -> str:
    """A window CENTRED ON THE MATCH, not the head of the line.

    The first version truncated from the start of the line, and on the nipocalimab
    case that printed 200 characters of monkey dosing and hid the six words the
    screen had actually objected to. An excerpt that does not contain the match is
    worse than no excerpt: it invites the reader to conclude the screen misfired.
    """
    lo = max(0, start - window)
    hi = min(len(line), end + window)
    s = " ".join(line[lo:hi].split())
    return ("..." if lo > 0 else "") + s + ("..." if hi < len(line) else "")


def _mask_benign(line: str) -> str:
    """Blank out benign phrases so leak patterns cannot match inside them.

    PER-OCCURRENCE, not per-line. A line reading "Clinical signs were normal,
    although the liver is a target organ clinically" carries one innocent phrase and
    one real leak, and a line-level benign flag would discard both - which is a way
    to hide a leak by padding the sentence around it. Masking replaces each benign
    span with spaces of the same length, so offsets and the reported excerpt still
    line up with the original text.
    """
    masked = line
    for p in BENIGN_CONTEXTS:
        masked = re.sub(p, lambda m: " " * len(m.group(0)), masked, flags=re.I)
    return masked


def screen_text(text: str, source: str = "(text)") -> Screen:
    """Scan an extract and refuse it if it references the clinical outcome."""
    lines = text.splitlines()
    hits: list[Hit] = []

    for i, line in enumerate(lines, start=1):
        masked = _mask_benign(line)
        for pattern, why in LEAK_PATTERNS:
            m = re.search(pattern, masked, re.I)
            if m is None:
                continue
            hits.append(Hit(pattern=pattern, why=why, line=i,
                            excerpt=_excerpt(line, m.start(), m.end())))

    ok = len(hits) == 0
    reason = (
        "no clinical cross-reference found; usable as a prediction case"
        if ok else
        f"{len(hits)} clinical cross-reference(s) found - REFUSED as a prediction case. "
        "It remains usable as a deliberation case."
    )
    return Screen(ok=ok, reason=reason, source=source, hits=[asdict(h) for h in hits],
                  lines_scanned=len(lines))


def screen_file(path: Path) -> Screen:
    return screen_text(path.read_text(encoding="utf-8", errors="replace"), source=path.name)


def screen_case(path: Path) -> Screen:
    """Screen an assembled case file rather than a raw extract.

    The case JSON is what actually reaches an adjudication payload, so screening it
    catches a leak that survived into a hand-written finding - which is the path the
    Turalio quote in fact took. `_`-prefixed keys are provenance notes written BY
    this project ABOUT the leak, so scanning them would make every screened case
    refuse itself for containing its own warning.
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    parts: list[str] = []
    for finding in data.get("findings", []):
        parts.append(f"{finding.get('label', '')}: {finding.get('detail', '')}")
    for absent in data.get("absent", []):
        parts.append(f"{absent.get('field', '')}: {absent.get('whatItBlocks', '')}")
    parts.append(str(data.get("context", "")))
    return screen_text("\n".join(parts), source=path.name)


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: python leakage_screen.py <extract.txt | case.json> [...]")
        print()
        print("Refuses any nonclinical extract that references the clinical outcome.")
        print("Exit code 1 if ANY input is refused, so this can gate a pipeline.")
        raise SystemExit(2)

    refused = 0
    for arg in sys.argv[1:]:
        path = Path(arg)
        result = screen_case(path) if path.suffix == ".json" else screen_file(path)

        print(f"source            {result.source}")
        print(f"result            {'OK' if result.ok else 'REFUSED'}")
        print(f"reason            {result.reason}")
        print(f"lines scanned     {result.lines_scanned}")
        for h in result.hits:
            print(f"  line {h['line']:>5}  /{h['pattern']}/")
            print(f"             why: {h['why']}")
            print(f"             {h['excerpt']}")
        print()
        if not result.ok:
            refused += 1

    if refused:
        print(f"{refused} input(s) REFUSED as prediction cases.")
        print("Do not score prediction on a refused document. HANDOVER 13.4c.")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
