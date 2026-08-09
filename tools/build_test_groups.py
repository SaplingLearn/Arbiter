"""Emit data/test-groups.json - the evaluation sets for the AI redesign.

Group 2 is DERIVED, not typed. It is the set of compounds the v1.0 engine
committed on, split by whether the v2.0 target agrees - so the list cannot drift
out of step with what the engine actually did, and re-running this after any
change to the engine regenerates the truth rather than restating a memory of it.

Group 1 and group 3 are declared here as specifications rather than populated,
because both need material this script cannot reach:

  - Group 1 needs modern review documents (spec section 4.4). Selection is
    "drugs where the liver answer is known and the review is readable", NOT
    "drugs that were withdrawn" - that plan was measured on 2026-08-09 and failed
    on document availability.
  - Group 3 needs LiverTox likelihood scores, which are prose monographs on NCBI
    Bookshelf with no bulk download. Category E only; E* (suspected but unproven)
    is excluded by design, because the whole point of the group is that there is
    nothing to find.

Writing them as empty-with-a-spec rather than omitting them is deliberate: a
missing group reads as an oversight, an empty one with its filter written down
reads as work not yet done.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def norm(s: str) -> str:
    return s.strip().lower()


def main() -> None:
    results = json.loads((ROOT / "results" / "results.json").read_text())
    compounds = json.loads((ROOT / "data" / "out" / "compounds.json").read_text())["compounds"]
    v2 = json.loads((ROOT / "rules" / "ruleset-v2.0.json").read_text())
    policy = v2["dilirankBinarisation"]

    by_id = {c["compoundId"]: c for c in compounds}
    pos = {norm(s) for s in policy["positive"]}

    committed = [r for r in results["rows"] if r["arbiter"]["verdict"] != "abstain"]

    agreed, overcalled = [], []
    for r in committed:
        c = by_id[r["compoundId"]]
        entry = {
            "compoundId": c["compoundId"],
            "name": c["name"],
            "dilirankLabel": c["dilirankLabel"],
            "engineVerdict": r["arbiter"]["verdict"],
            "belief": r["arbiter"]["belief"],
            "inConflictSubset": r["conflicting"],
        }
        (agreed if norm(c["dilirankLabel"]) in pos else overcalled).append(entry)

    doc = {
        "generatedBy": "tools/build_test_groups.py",
        "generatedFrom": {
            "results": "results/results.json",
            "compounds": "data/out/compounds.json",
            "target": f"rules/ruleset-v2.0.json ({policy['positive']} positive)",
        },
        "note": (
            "All three groups are REQUIRED. A one-directional set measures only "
            "willingness to say danger, which is the defect measured on 2026-08-09."
        ),
        "group1_documentedLiverSignal": {
            "status": "SPECIFIED, NOT POPULATED",
            "passingBehaviour": "flags it, or states plainly what is missing and what would find it",
            "selectionRule": (
                "Recent approvals (1998+, preferably 2015+ for the FDA multi-discipline "
                "format) whose CLINICAL chapter documents a liver finding. The nonclinical "
                "chapter is the input; the clinical chapter is the answer key; the two are "
                "separated mechanically and a case whose chapters will not split cleanly is "
                "dropped rather than trimmed by hand."
            ),
            "supersededPlan": (
                "The eight drugs withdrawn for hepatotoxicity 1997-2016. Measured 2026-08-09 "
                "and abandoned as a DOCUMENT source: lumiracoxib and sitaxentan were never "
                "FDA-approved, ximelagatran was rejected, troglitazone's retrievable package "
                "is a labelling supplement with no pharm/tox review, and tolcapone's 1998 "
                "medical review is 48 pages of scanned images carrying 47 extractable "
                "characters. They remain useful as NARRATIVE - three of them showed nothing "
                "preclinically, which is the argument for why this product should exist - but "
                "narrative is not evidence that it works and must not be presented as such."
            ),
            "compounds": [],
        },
        "group2_realMechanismFineInPractice": {
            "status": "POPULATED - derived from the engine's own commitments",
            "passingBehaviour": "reports the mechanism, declines to call it disqualifying",
            "note": (
                "Every compound below is a genuine BSEP (bile-salt export pump) inhibitor, so "
                "the engine found something true and then reported it as a reason not to "
                "advance. All are approved and widely prescribed. This group is free: it is "
                "the measured defect, not a set assembled to look for one."
            ),
            "compounds": overcalled,
        },
        "group2a_engineWasRight": {
            "status": "POPULATED - the same derivation, other side",
            "note": (
                "Kept beside group 2 rather than discarded. Two correct commitments out of "
                "seven is the numerator of the v2.0 result, and dropping them would leave the "
                "file showing only failures."
            ),
            "compounds": agreed,
        },
        "group3_genuinelyClean": {
            "status": "SPECIFIED, NOT POPULATED",
            "passingBehaviour": (
                "no concern - and an objection with nothing behind it is visibly unsupported"
            ),
            "selectionRule": (
                "LiverTox likelihood category E only: widespread use, no credible evidence of "
                "liver injury. Category E* (suspected but unproven) is EXCLUDED - the point of "
                "this group is that there is nothing to find, and E* is precisely the case "
                "where there might be."
            ),
            "whyItMatters": (
                "The only group that can test the cited-position mechanism. On a category-E "
                "compound there is nothing for an objection to cite and nothing external to "
                "attach, so an unsupported position is unmissable."
            ),
            "source": "LiverTox, NCBI Bookshelf. Prose monographs, no bulk download.",
            "compounds": [],
        },
    }

    out = ROOT / "data" / "test-groups.json"
    out.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")

    print(f"wrote {out.relative_to(ROOT)}")
    print(f"  engine committed on {len(committed)} compounds")
    print(f"  group 2  (over-called, real mechanism, drug is fine): {len(overcalled)}")
    for c in overcalled:
        print(f"      {c['name']:<28} {c['dilirankLabel']}")
    print(f"  group 2a (engine was right): {len(agreed)}")
    for c in agreed:
        print(f"      {c['name']:<28} {c['dilirankLabel']}")
    print("  group 1, group 3: specified, awaiting documents")


if __name__ == "__main__":
    main()
