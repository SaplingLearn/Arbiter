"""Rebuild the findings in data/verdict-real.json uniformly, from the extracted reviews.

WHY UNIFORM, AND WHY THAT MATTERS MORE THAN QUALITY PER CASE. The fixture pairs drugs
whose label carries a hepatotoxicity action against drugs whose label does not, and asks
whether the adjudicator separates them. If the positives were built one way and the
negatives another - richer quotes for the drugs I added, thinner ones for the drugs that
were already there - then any separation it found could be an artefact of how the input
was assembled rather than of the evidence. Extracting all twenty the same way removes
that, and it makes the input reproducible: this script regenerates it byte for byte.

WHAT IS KEPT AND WHAT IS REBUILT. `expectFlag`, `labelEvidence` and `outcomeTier` are the
answer key and are human-verified against the label; they are preserved exactly. Only the
findings, and the present/absent inventory derived from them, are rebuilt.

THREE FILTERS, EACH FOR A FAILURE THIS PROJECT HAS ALREADY HAD.

  LEAKAGE. HANDOFF-evaluation.md section 8 records that an FDA multidiscipline review can
  state the clinical outcome inside the nonclinical chapter - turalio's says the liver is
  a major target organ CLINICALLY. A quote like that hands over the answer key, so
  anything naming a clinical outcome, labelling, post-marketing experience or a boxed
  warning is dropped.

  TABLE OF CONTENTS. Dot-leader index lines are not findings. Four study-table headers
  reached the Ask fixture as gold quotes and every item that carried one failed, because
  a header carries no fact for an answer to state.

  DENSITY. A fragment that is mostly digits and symbols is a dosing table, not a sentence.

ABSENCE IS DECLARED, NOT LEFT IMPLICIT. A consequence dimension no quote covers is listed
in `absent` with what it blocks, rather than simply being missing from `present`. The
adjudicator is then told what was not measured instead of inferring it from silence, which
is the same distinction the product makes everywhere else: a measured negative and a
never-measured dimension are different facts.

Run:  python tools/build_verdict_real.py
"""
from __future__ import annotations

import io
import json
import re

PATH = "data/verdict-real.json"
CACHE = "results/library/{}.pages.json"

MECH = "mechanism"
CONS = "consequence"

# dimension -> (pattern, inventory field, half, what its absence blocks)
DIMENSIONS = [
    ("liver",
     re.compile(r"(hepatocellular|hepatotox|liver (necrosis|weight|enzyme|findings)|bile duct|"
                r"ALT and AST|transaminase|centrilobular)", re.I),
     "Repeat-dose in vivo liver findings", MECH,
     "No liver finding was extracted from the review, so there is no mechanism evidence to weigh."),
    ("reversibility",
     re.compile(r"(reversib|not reverse|persisted through|recovery period|recoverable|"
                r"resolved (after|during))", re.I),
     "Reversibility on withdrawal", CONS,
     "R3 turns on whether the damage persists, and no recovery finding was extracted."),
    ("exposure_margin",
     re.compile(r"(NOAEL|exposure margin|safety margin|times the (MRHD|clinical|human)|"
                r"x the (clinical|human)|fold the (clinical|human))", re.I),
     "Exposure margin: tested concentration or NOAEL against projected human Cmax", CONS,
     "R2 turns on the multiple of projected human Cmax, and none was extracted."),
    ("injury_pattern",
     re.compile(r"(cholestatic|hepatocellular (injury|pattern|necrosis|hypertrophy)|"
                r"single[- ]cell necrosis|steatosis|mixed injury)", re.I),
     "Injury pattern: hepatocellular, cholestatic or mixed", CONS,
     "The severity of a liver finding cannot be characterised without its injury pattern."),
]

LEAK = re.compile(
    r"(clinical(ly)? (observed|relevant|cases|adverse|significant)|in patients|boxed warning|"
    r"labell?ing|post-?marketing|REMS|black box|warnings and precautions|withdraw)", re.I)
DOT_LEADER = re.compile(r"\.{4,}")

MAX_PER_DIMENSION = 3
MIN_LEN, MAX_LEN = 70, 200


def is_junk(quote: str) -> bool:
    """A table of contents line, or a dosing table, rather than a sentence."""
    if DOT_LEADER.search(quote):
        return True
    letters = sum(ch.isalpha() or ch.isspace() for ch in quote)
    return letters / max(len(quote), 1) < 0.72


def findings_for(doc: str) -> tuple[list[dict], set[str]]:
    try:
        pages = json.loads(io.open(CACHE.format(doc), encoding="utf-8").read())
    except FileNotFoundError:
        return [], set()

    out: list[dict] = []
    covered: set[str] = set()
    seen: set[str] = set()

    for dim, rx, _field, _half, _blocks in DIMENSIONS:
        found = 0
        for p in pages:
            if found >= MAX_PER_DIMENSION:
                break
            text = re.sub(r"\s+", " ", p["text"]).strip()
            for m in rx.finditer(text):
                start = max(0, m.start() - 45)
                quote = text[start:start + MAX_LEN].strip()
                if len(quote) < MIN_LEN or LEAK.search(quote) or is_junk(quote) or quote in seen:
                    continue
                seen.add(quote)
                out.append({
                    "id": f"{doc}:{dim}:p{p['page']}",
                    "label": f"{dim} (from the review, p{p['page']})",
                    # NEVER pre-labelled. Asserting `toxic` would encode the answer in
                    # the input and score the model for reading my label back.
                    "assertion": "ambiguous",
                    "detail": f"Verbatim from {doc} p{p['page']}: \"{quote}\"",
                    "sourceDocument": doc,
                    "sourcePage": p["page"],
                })
                covered.add(dim)
                found += 1
                break
    return out, covered


def main() -> int:
    data = json.loads(io.open(PATH, encoding="utf-8").read())
    rebuilt, skipped = 0, []

    for case in data["cases"]:
        doc = case["id"]
        findings, covered = findings_for(doc)
        if len(findings) < 2:
            skipped.append(doc)
            continue

        present, absent = [], []
        for dim, _rx, field, half, blocks in DIMENSIONS:
            if dim in covered:
                present.append({"field": field, "half": half})
            else:
                absent.append({"field": field, "whatItBlocks": blocks})

        case["findings"] = findings
        case["present"] = present
        case["absent"] = absent
        rebuilt += 1
        print(f"  {doc:<15} {len(findings):>2} findings  present={len(present)} absent={len(absent)}")

    data["_findingsAreBuiltByScript"] = (
        "Findings, present and absent are regenerated by tools/build_verdict_real.py so every drug is "
        "assembled identically. Building the positives one way and the negatives another would let any "
        "separation the adjudicator found be an artefact of the assembly. expectFlag, labelEvidence and "
        "outcomeTier are the human-verified answer key and are never touched by the script."
    )
    io.open(PATH, "w", encoding="utf-8", newline="\n").write(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n")

    pos = sum(1 for c in data["cases"] if c["expectFlag"])
    neg = len(data["cases"]) - pos
    print(f"\nrebuilt {rebuilt} of {len(data['cases'])} drugs; {pos} positive, {neg} negative")
    if skipped:
        print(f"left as authored (no extraction cache, or too few quotes): {', '.join(skipped)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
