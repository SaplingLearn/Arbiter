"""TAK-994: the motivating case. LITERATURE-sourced, EXCLUDED from all metrics.

Every claim carries an availableFrom date reflecting when that evidence actually
existed. That single field is what makes the two-pass replay honest: the murine
toxicogenomic study was initiated DURING the Phase 2 trial, so it carries a 2022
date and is invisible to a pre-first-in-human replay.

CITATIONS ARE UNVERIFIED AND THE OUTPUT SAYS SO. The sources below were written
from summary knowledge and have NOT been checked against the primary literature.
`citationStatus` is emitted as "UNVERIFIED" at the top level and Phase 2 must
render it, because a fixture that looks like a cited literature record while
carrying unchecked references is worse than one that admits the gap. Verify
before presenting:
  - Toxicological Sciences (2025) 204(2):143 - rat and primate studies missing the
    liability; murine single-cell necrosis after CYP induction at clinically
    relevant doses; in-vitro margins >100x
  - NEJM (2023) - Phase 2: 73 patients, 8 over enzyme thresholds, 3 Hy's Law
"""
import json
import pathlib
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
CID = "TAK-994"
TOXSCI = "Toxicological Sciences 2025;204(2):143 (UNVERIFIED - confirm before citing)"
NEJM = "NEJM 2023 Phase 2 TAK-994 (UNVERIFIED - confirm before citing)"


def claim(**kw) -> dict:
    base = {
        "compoundId": CID, "measuresKeyEvent": None, "exposureRelevant": None,
        "inApplicabilityDomain": True, "klimisch": 1,
    }
    return {**base, **kw}


CLAIMS = [
    claim(
        id="TAK-994:invivo_rodent", stream="invivo_rodent", assertion="safe", strength=0.85,
        system="rodent", exposureRelevant=None, availableFrom="2020-06-01",
        provenance={"kind": "literature", "source": f"Rat repeat-dose: no hepatotoxicity. {TOXSCI}", "retrieved": "2026-07-26"},
    ),
    claim(
        id="TAK-994:invivo_nonrodent", stream="invivo_nonrodent", assertion="safe", strength=0.85,
        system="nonrodent", exposureRelevant=None, availableFrom="2020-09-01",
        provenance={"kind": "literature", "source": f"Non-human primate repeat-dose: no hepatotoxicity. {TOXSCI}", "retrieved": "2026-07-26"},
    ),
    claim(
        # >100x margin, but NOT established at clinical exposure -> exposureRelevant
        # None, which R3 consumes.
        id="TAK-994:cytotox", stream="cytotox", assertion="safe", strength=0.8,
        system="human", measuresKeyEvent="KE:HEPATOCYTE-DEATH", exposureRelevant=None,
        availableFrom="2020-03-01",
        provenance={"kind": "literature", "source": f"In-vitro DILI panel, margins >100x (cytotoxicity, mitochondrial, BSEP). {TOXSCI}", "retrieved": "2026-07-26"},
    ),
    claim(
        id="TAK-994:transporter", stream="transporter", assertion="safe", strength=0.75,
        system="human", measuresKeyEvent="KE:BSEP-INHIBITION", exposureRelevant=None,
        availableFrom="2020-03-01",
        provenance={"kind": "literature", "source": f"BSEP inhibition: wide margin. {TOXSCI}", "retrieved": "2026-07-26"},
    ),
    claim(
        id="TAK-994:qsar", stream="qsar", assertion="ambiguous", strength=0.0,
        system="in_silico", klimisch=3, availableFrom="2020-01-01",
        provenance={"kind": "literature", "source": "First-in-class orexin receptor 2 agonist; no informative structural precedent.", "retrieved": "2026-07-26"},
    ),
    # PASS 2 ONLY. Initiated during the Phase 2 trial - after first-in-human.
    claim(
        id="TAK-994:toxicogenomics-murine", stream="toxicogenomics", assertion="toxic", strength=0.9,
        system="rodent", measuresKeyEvent="KE:CYP-INDUCTION", exposureRelevant=True,
        availableFrom="2022-03-01",
        provenance={"kind": "literature", "source": f"Murine hepatic single-cell necrosis after CYP450 induction at clinically relevant doses. Study initiated DURING the Phase 2 trial. {TOXSCI}", "retrieved": "2026-07-26"},
    ),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "tak994.json").write_text(json.dumps({
        "generatedAt": time.strftime("%Y-%m-%d"),
        "compoundId": CID,
        "name": "TAK-994",
        "indication": "Narcolepsy type 1",
        "citationStatus": "UNVERIFIED",
        "citationNote": (
            "Sources are written from summary knowledge and have NOT been checked against "
            "the primary literature. Any surface that renders these claims must show this "
            "status alongside them."
        ),
        "excludedFromBenchmark": True,
        "excludedBecause": "Terminated in Phase 2 and never approved, so absent from DILIrank. It is the motivating case, not evidence.",
        "outcome": {
            "summary": "Phase 2 stopped; programme terminated.",
            "nPatients": 73,
            "nOverEnzymeThreshold": 8,
            "nHysLaw": 3,
            "source": NEJM,
        },
        "asOfMilestones": {"preFirstInHuman": "2021-06-01", "postMurineStudy": "2023-01-01"},
        "claims": CLAIMS,
    }, indent=2))
    pre = sum(1 for c in CLAIMS if c["availableFrom"] <= "2021-06-01")
    print(f"Wrote {len(CLAIMS)} literature claims; {pre} visible pre-first-in-human")


if __name__ == "__main__":
    main()
