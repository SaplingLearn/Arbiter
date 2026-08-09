"""Emit data/probe-case.json - the single case the consistency probe runs against.

TAK-994, because it is the anchor case and because it is EXCLUDED FROM THE
BENCHMARK (terminated in Phase 2, never approved, absent from DILIrank). That
exclusion is what makes it the right probe case: the flip rate needs no answer
key, and using a scored compound would risk a development-set case being burned
on a measurement that never needed one.

The claims are derived from data/out/tak994.json rather than retyped, so the
probe case cannot drift from the fixture the rest of the project uses. The
fixture's citations are marked UNVERIFIED upstream and that status is carried
through into the case file rather than quietly dropped - a probe measures
stability, not truth, so unverified sources are acceptable here in a way they
would not be in a scored result, and the file has to say so.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    fixture = json.loads((ROOT / "data" / "out" / "tak994.json").read_text())
    ruleset = json.loads((ROOT / "rules" / "ruleset-v2.0.json").read_text())

    findings = []
    for c in fixture["claims"]:
        bits = [f"stream {c['stream']}", f"system {c['system']}"]
        if c.get("measuresKeyEvent"):
            bits.append(f"measures key event {c['measuresKeyEvent']}")
        else:
            bits.append("measures no key event")
        if c.get("exposureRelevant") is True:
            bits.append("tested at clinically relevant exposure")
        elif c.get("exposureRelevant") is False:
            bits.append("NOT tested at clinically relevant exposure")
        else:
            bits.append("exposure relevance unstated")
        if c.get("klimisch") is not None:
            bits.append(f"Klimisch {c['klimisch']}")
        bits.append(f"stated confidence {c['strength']}")
        bits.append(f"source: {c['provenance']['source']}")

        findings.append({
            "id": c["id"],
            "label": f"{c['stream']} ({c['system']})",
            "assertion": c["assertion"],
            "detail": "; ".join(bits),
        })

    # Absence, stated, and derived rather than written by hand so it cannot drift
    # from the findings beside it. "Not measured" reading as "measured negative" is
    # the exact confusion spec section 3.2 exists to prevent.
    #
    # THE ASYMMETRY IS R3 AND IS DELIBERATE. A first draft asked whether ANY claim
    # established an exposure margin, found that one did - the murine
    # toxicogenomics claim, which is the TOXIC one - and reported no absence at all.
    # That is exactly backwards. R3 gates SAFE claims: a positive finding needs no
    # margin to be defensible, while a clean result without one rules out less than
    # it appears to. HANDOVER section 12.1 records the same correction being made
    # once already in the intake spec. So the question is not "does a margin exist
    # anywhere" but "which reassuring findings lack one".
    safe_no_margin = [
        c for c in fixture["claims"]
        if c["assertion"] == "safe" and c.get("exposureRelevant") is not True
    ]
    no_key_event = [c for c in fixture["claims"] if not c.get("measuresKeyEvent")]

    absent = []
    if safe_no_margin:
        ids = ", ".join(c["id"] for c in safe_no_margin)
        absent.append({
            "field": "clinical Cmax / exposure margin",
            "whatItBlocks": (
                f"{len(safe_no_margin)} of {len(fixture['claims'])} findings assert SAFE with no "
                f"established exposure margin ({ids}). Each rules out less than it appears to, "
                "and none can be distinguished from a result tested below the range that matters."
            ),
        })
    if no_key_event:
        ids = ", ".join(c["id"] for c in no_key_event)
        absent.append({
            "field": "measured adverse-outcome-pathway key event",
            "whatItBlocks": (
                f"{len(no_key_event)} findings correlate rather than measure ({ids}), so they "
                "evidence no mechanism in either direction."
            ),
        })

    case = {
        "_note": (
            "Probe case for the consistency measurement. TAK-994 is excluded from the "
            "benchmark, so using it here burns no development or held-out case. Its "
            "citations are UNVERIFIED upstream (data/out/tak994.json) and that is "
            "acceptable for a stability measurement, which needs no answer key - it "
            "would NOT be acceptable in a scored result."
        ),
        "_generatedBy": "tools/build_probe_case.py",
        "compoundLabel": f"{fixture['name']} ({fixture['indication']})",
        "context": (
            f"{fixture['indication']}. Chronic oral dosing in otherwise healthy adults, "
            "so tolerance for a liver signal is low. Decision point: whether to advance "
            "toward first-in-human."
        ),
        "rules": [
            {
                "id": r["id"], "name": r["name"], "statement": r["statement"],
                "enabled": r["enabled"], "strength": r["strength"],
            }
            for r in ruleset["rules"]
        ],
        "findings": findings,
        "absent": absent,
    }

    out = ROOT / "data" / "probe-case.json"
    out.write_text(json.dumps(case, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}")
    print(f"  {len(case['rules'])} rules, {len(findings)} findings, {len(absent)} absences")
    for f in findings:
        print(f"    {f['id']:<34} {f['assertion']}")
    for a in absent:
        print(f"    ABSENT: {a['field']}")


if __name__ == "__main__":
    main()
