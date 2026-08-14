"""Re-grade the ALREADY-COMPUTED engine verdicts under the v2.0 target definition.

WHAT THIS DOES AND DOES NOT DO.

It does NOT re-run the engine. `results/results.json` holds the verdict the engine
produced for every scored compound, and those verdicts are a function of the
evidence and R1-R6 only - neither of which v2.0 changes. Re-running would produce
byte-identical verdicts, so this script re-grades the existing ones. That is what
makes it a clean single-variable measurement: same predictions, different
scorecard, and any movement in the numbers is attributable to the target
correction alone.

The metric definitions below are transcribed from apps/harness/src/stats.ts and
apps/harness/src/metrics.ts rather than reimplemented from a textbook, so the
v1.0 column of the output must reproduce results/metrics.json exactly. It is
asserted at the end; a mismatch means this file drifted from the harness and no
number it prints can be trusted.

DISCLOSED LIMITATION. The QSAR stream was fitted against the v1.0 label
definition, so it is optimised for a target v2.0 rejects. Refitting it under v2.0
is correct and is not done here, because refitting would change the QSAR claims
and stop this being a single-variable measurement. The consequence is one-sided
and worth stating plainly: the v2.0 figures below are a LOWER BOUND on what a
properly refitted pipeline would score. It does not affect the headline finding -
the engine commits on transporter claims, not QSAR ones.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


# --- transcribed from apps/harness/src/stats.ts -----------------------------

def wilson(successes: int, n: int, z: float = 1.96) -> dict:
    if n == 0:
        return {"lo": 0.0, "hi": 1.0}
    p = successes / n
    z2 = z * z
    denom = 1 + z2 / n
    centre = (p + z2 / (2 * n)) / denom
    half = (z * math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
    return {"lo": max(0.0, centre - half), "hi": min(1.0, centre + half)}


def confusion(pairs: list[tuple[int, int]]) -> dict:
    c = {"tp": 0, "fp": 0, "tn": 0, "fn": 0}
    for y, pred in pairs:
        if y == 1 and pred == 1:
            c["tp"] += 1
        elif y == 1:
            c["fn"] += 1
        elif pred == 1:
            c["fp"] += 1
        else:
            c["tn"] += 1
    return c


def balanced_accuracy(pairs: list[tuple[int, int]]) -> float:
    c = confusion(pairs)
    # The 0.5 substitution for an absent class is the harness's own behaviour and
    # is reproduced deliberately - it is the thing the audit found misleading, and
    # hiding it here would hide the defect rather than measure it.
    sens = 0.5 if c["tp"] + c["fn"] == 0 else c["tp"] / (c["tp"] + c["fn"])
    spec = 0.5 if c["tn"] + c["fp"] == 0 else c["tn"] / (c["tn"] + c["fp"])
    return (sens + spec) / 2


def single_class(pairs: list[tuple[int, int]]) -> bool:
    c = confusion(pairs)
    return c["tp"] + c["fn"] == 0 or c["tn"] + c["fp"] == 0


def balanced_accuracy_interval(pairs: list[tuple[int, int]]):
    c = confusion(pairs)
    if c["tp"] + c["fn"] == 0 or c["tn"] + c["fp"] == 0:
        return None
    sens = wilson(c["tp"], c["tp"] + c["fn"])
    spec = wilson(c["tn"], c["tn"] + c["fp"])
    return {"lo": (sens["lo"] + spec["lo"]) / 2, "hi": (sens["hi"] + spec["hi"]) / 2}


def to_binary(verdict: str):
    """do_not_advance means predicted-toxic. abstain is not a prediction."""
    return 1 if verdict == "do_not_advance" else 0 if verdict == "advance" else None


def score(pairs_with_none) -> dict:
    committed = [(y, p) for y, p in pairs_with_none if p is not None]
    correct = sum(1 for y, p in committed if y == p)
    return {
        "balancedAccuracy": balanced_accuracy(committed),
        "balancedAccuracyCi": balanced_accuracy_interval(committed),
        "rawAccuracyCi": wilson(correct, len(committed)),
        "coverage": 0.0 if not pairs_with_none else len(committed) / len(pairs_with_none),
        "nCommitted": len(committed),
        "confusion": confusion(committed),
        "singleClass": single_class(committed),
    }


# --- the two target definitions ---------------------------------------------

def norm(s: str) -> str:
    return s.strip().lower()


def relabel(raw_label: str, policy: dict):
    """Return 1, 0, or None (excluded) under the given binarisation policy."""
    lab = norm(raw_label)
    if lab in {norm(s) for s in policy["positive"]}:
        return 1
    if lab in {norm(s) for s in policy["negative"]}:
        return 0
    return None


def fmt(v) -> str:
    if v is None:
        return "     -    "
    if isinstance(v, dict):
        return f"{v['lo']:.2f}-{v['hi']:.2f}"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, float):
        return f"{v:.3f}"
    return str(v)


def report(title: str, scored: dict, n: int, positive_rate: float) -> dict:
    c = scored["confusion"]
    print(f"  {title}")
    print(f"    subset n={n}   positives in subset: {positive_rate:.1%}")
    print(f"    committed          {scored['nCommitted']}   coverage {scored['coverage']:.1%}")
    print(f"    confusion          tp {c['tp']}  fp {c['fp']}  tn {c['tn']}  fn {c['fn']}")
    print(f"    balanced accuracy  {scored['balancedAccuracy']:.3f}"
          f"   CI {fmt(scored['balancedAccuracyCi'])}"
          f"   single-class: {fmt(scored['singleClass'])}")
    print(f"    raw accuracy CI    {fmt(scored['rawAccuracyCi'])}")
    print()
    return {"pipeline": title.replace("baseline ", ""), **scored}


def main() -> None:
    results = json.loads((ROOT / "results" / "results.json").read_text())
    compounds = json.loads((ROOT / "data" / "out" / "compounds.json").read_text())["compounds"]
    v1 = json.loads((ROOT / "rules" / "ruleset-v1.0.json").read_text())["dilirankBinarisation"]
    v2 = json.loads((ROOT / "rules" / "ruleset-v2.0.json").read_text())["dilirankBinarisation"]

    label_of = {c["compoundId"]: c["dilirankLabel"] for c in compounds}
    rows = results["rows"]

    missing = [r["compoundId"] for r in rows if r["compoundId"] not in label_of]
    if missing:
        raise SystemExit(f"{len(missing)} scored compounds have no DILIrank label; cannot re-grade.")

    doc_targets = []
    for policy_name, policy, version in (
        ("v1.0 (as shipped)", v1, "1.0"), ("v2.0 (corrected)", v2, "2.0")
    ):
        print("=" * 74)
        print(f"TARGET: {policy_name}")
        print(f"  positive = {policy['positive']}")
        print(f"  negative = {policy['negative']}")
        print("=" * 74)

        graded = []
        for r in rows:
            y = relabel(label_of[r["compoundId"]], policy)
            if y is None:
                continue  # excluded by policy; none expected, the corpus is pre-filtered
            graded.append((r, y))

        populations = []
        for subset_name, population_key, subset in (
            ("CONFLICT SUBSET (the headline)", "conflictSubset",
             [(r, y) for r, y in graded if r["conflicting"]]),
            ("FULL SCORED SPLIT", "fullSplit", graded),
        ):
            n = len(subset)
            pos_rate = sum(y for _, y in subset) / n if n else 0.0
            print(f"-- {subset_name} --")
            pipelines = []
            arb = score([(y, to_binary(r["arbiter"]["verdict"])) for r, y in subset])
            pipelines.append(report("ARBITER", arb, n, pos_rate))

            names = sorted({k for r, _ in subset for k in r["baselines"]})
            for name in names:
                b = score([
                    (y, to_binary(r["baselines"][name]["verdict"]) if r["baselines"].get(name) else None)
                    for r, y in subset
                ])
                if b["nCommitted"] == 0:
                    continue
                pipelines.append(report(f"baseline {name}", b, n, pos_rate))

            populations.append({
                "population": population_key, "n": n,
                "positiveRate": pos_rate, "pipelines": pipelines,
            })

        doc_targets.append({
            "version": version, "label": policy_name, "superseded": version == "1.0",
            "positive": policy["positive"], "negative": policy["negative"],
            "populations": populations,
        })

    # --- the drift guard ----------------------------------------------------
    shipped = json.loads((ROOT / "results" / "metrics.json").read_text())
    m1 = shipped["metric1_conflictSubsetAccuracy"]
    recomputed = score([
        (relabel(label_of[r["compoundId"]], v1), to_binary(r["arbiter"]["verdict"]))
        for r in rows if r["conflicting"]
    ])
    ok = (
        abs(recomputed["balancedAccuracy"] - m1["arbiter"]["balancedAccuracy"]) < 1e-9
        and recomputed["confusion"] == m1["arbiter"]["confusion"]
        and recomputed["nCommitted"] == m1["arbiter"]["nCommitted"]
    )
    print("=" * 74)
    print("DRIFT GUARD - the v1.0 column must reproduce results/metrics.json exactly")
    print(f"  shipped    balancedAccuracy {m1['arbiter']['balancedAccuracy']}  confusion {m1['arbiter']['confusion']}")
    print(f"  recomputed balancedAccuracy {recomputed['balancedAccuracy']}  confusion {recomputed['confusion']}")
    print(f"  {'PASS - this script matches the harness' if ok else 'FAIL - DO NOT TRUST THE v2.0 NUMBERS ABOVE'}")
    if not ok:
        raise SystemExit(1)

    # Written only after the guard passes: a failed guard must leave no artifact
    # for the UI to read.
    (ROOT / "results" / "rescore-v2.json").write_text(json.dumps({
        "generatedBy": "tools/rescore_v2.py",
        "driftGuard": "pass",
        "qsarCaveat": (
            "The QSAR model was fitted under the v1.0 target, so its v2.0 figures "
            "are a lower bound."
        ),
        "targets": doc_targets,
    }, indent=2) + "\n", encoding="utf-8")
    print()
    print("wrote results/rescore-v2.json")


if __name__ == "__main__":
    main()
