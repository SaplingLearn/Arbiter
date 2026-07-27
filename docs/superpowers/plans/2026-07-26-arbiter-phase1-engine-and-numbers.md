# ARBITER Phase 1 — Engine and Numbers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Go from an empty repo to `results/results.json` + `results/metrics.json` — real validated numbers produced by a pure TypeScript reasoning engine over real public hepatotoxicity data, with four baselines and the full metric suite.

**Architecture:** A dependency-free TypeScript engine (`packages/engine`) is the single source of truth for reasoning. A Node CLI (`apps/harness`) imports it to run the benchmark and emit JSON. Python (`data/prep`) does one-time data acquisition and writes committed JSON. Nothing in the engine touches I/O, dates, or randomness.

**Tech Stack:** Node 20 · TypeScript 5 · npm workspaces · vitest · zod · tsx · Python 3.12 (venv) · pandas · rdkit · scikit-learn · Anthropic SDK (`@anthropic-ai/sdk`)

**Spec:** `docs/superpowers/specs/2026-07-26-arbiter-design.md` — this plan implements §5, §6, §8, §11 of it. Phases 2 (web app) and 3 (AI surfaces) get their own plans after this one lands.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Node 20.12.1**, npm workspaces. TypeScript strict mode on.
- **`packages/engine` has exactly one runtime dependency: `zod`.** Nothing else. No `Date`, no `Math.random`, no I/O, no `fs`/`path`/`crypto`, no parent-directory imports. Enforced by ESLint rule + a determinism test. (`zod` is admitted deliberately — validating at the seam is worth more than nominal purity, and it introduces no clock, no I/O, and no randomness.)
- **All randomness lives in `apps/harness`**, via a seeded PRNG. The seed is committed alongside results.
- **`rules/ruleset-v1.0.json` is committed before any evaluation runs.** Its SHA-256 goes in `results/metrics.json`.
- **Three-way data split** — train / calibration / test. Boundaries and seed fixed before any fitting. Reliability priors fit on train only. Reported numbers come from test only.
- **Language discipline** (spec §1): say "review-ready evidence package", never "regulator-ready dossier"; "positions" and "sign-off", never "voting"/"tally"/"majority"; "hash-chained audit log", never "blockchain".
- **Anthropic model ID: `claude-opus-5`.** `temperature`/`top_p`/`top_k` do **not exist** on this model — passing any of them returns HTTP 400. Never add them.
- **Thinking is ON by default on `claude-opus-5`.** `max_tokens` caps thinking + output together.
- **Every Anthropic response must have `stop_reason` checked before `content` is read.** `stop_reason: "refusal"` returns HTTP 200 with empty content.
- TAK-994 is **excluded from every metric**. It is a fixture, not a benchmark row.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | npm workspaces root, shared scripts |
| `tsconfig.base.json` | strict compiler options shared by all packages |
| `packages/engine/src/types.ts` | `EvidenceClaim`, `Ruleset`, `Rule`, `Reasoning`, `TraceStep` — no logic |
| `packages/engine/src/fuse.ts` | Dempster–Shafer mass combination, belief/plausibility, conflict mass K |
| `packages/engine/src/rules.ts` | R1–R6 as predicate functions over claim pairs |
| `packages/engine/src/argue.ts` | attack graph + grounded semantics with reinstatement |
| `packages/engine/src/abstain.ts` | abstention decision from gap + applicability domain |
| `packages/engine/src/conflict.ts` | conflict detection / labelling |
| `packages/engine/src/counterfactual.ts` | exhaustive minimal-flip search |
| `packages/engine/src/plan.ts` | argument-structure-driven VOI planner |
| `packages/engine/src/index.ts` | `reason(claims, ruleset)` — the only public entry point |
| `packages/engine/src/schema.ts` | zod schemas for `EvidenceClaim` and `Ruleset` |
| `apps/harness/src/prng.ts` | seeded PRNG (all randomness) |
| `apps/harness/src/stats.ts` | Wilson intervals, balanced accuracy, confusion matrix |
| `apps/harness/src/baselines.ts` | majority vote, weighted average, best single source |
| `apps/harness/src/ablation.ts` | Anthropic Batches-API LLM baseline |
| `apps/harness/src/metrics.ts` | the five metrics |
| `apps/harness/src/main.ts` | CLI orchestration → `results/*.json` |
| `data/prep/*.py` | one-time acquisition; output committed to `data/out/` |
| `rules/ruleset-v1.0.json` | pre-registered rules + thresholds + binarisation policy |

---

## Task 1: Conflict-count spike (decision gate)

**This task can invalidate the headline metric. Do it first and report the number before writing any engine code.**

**Files:**
- Create: `data/prep/spike_conflict_count.py`
- Create: `data/prep/requirements.txt`
- Create: `data/prep/README.md`

**Interfaces:**
- Consumes: nothing
- Produces: a printed report and `data/out/spike-report.json` (n=250, the pre-registered
  sample) with `{nCompounds, nWithBothStreams, nConflicting, conflictRate,
  nCrossStreamConflict, crossStreamConflictRate, streamAWinRateWhenStreamsSplit,
  accuracyStreamA, accuracyStreamB, majorityClassBaseline, streamsBeatMajorityBaseline,
  positiveRateSample, seed, dilirankVersion, requestedSampleN}`. Passing a sample size as
  `argv[1]` (or `0` for all 982) writes `spike-report-n<N>.json` instead, so the
  pre-registered run is never overwritten by a diagnostic. Also produces
  `data/out/smiles-cache.json`.
- **Two gates, not one.** `nConflicting` is stream-vs-LABEL disagreement, which is just model
  error — a 70%-accurate model disagrees on 30% of compounds by construction, so that
  threshold cannot realistically fail, and DILIrank is the label rather than a stream.
  `nCrossStreamConflict` is stream-vs-stream, which is the shape spec §11's subset actually
  has, and it is the gate that matters.

- [ ] **Step 1: Create the Python environment and pin dependencies**

Write `data/prep/requirements.txt`:

```
pandas==2.2.3
openpyxl==3.1.5
requests==2.32.3
rdkit==2024.9.4
scikit-learn==1.5.2
numpy==2.1.3
```

Run:

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && python -m venv data/prep/.venv && data/prep/.venv/Scripts/python -m pip install -q -r data/prep/requirements.txt && data/prep/.venv/Scripts/python -c "import pandas, rdkit, sklearn; print('ok')"
```

Expected: `ok`

- [ ] **Step 2: Document the manual DILIrank download**

Write `data/prep/README.md`:

````markdown
# Data prep

## DILIrank (manual download — no stable direct URL)

1. Go to the FDA Liver Toxicity Knowledge Base (LTKB) DILIrank page.
2. Download the DILIrank dataset spreadsheet (`.xlsx`).
3. Save it as `data/raw/dilirank.xlsx`.

We do not script this download: the FDA URL is not stable and silently returning
an HTML error page as a "spreadsheet" is a worse failure than asking a human to
click once.

`data/raw/` is deliberately **not** gitignored. The workbook is 110KB of
US-government public-domain data, and committing it pins the exact dataset
version a result came from — DILIrank 2.0 reclassified 49 drugs relative to 1.0,
so "which version" is part of any result's provenance.

### Two sheets, and they are not interchangeable

| sheet | dataset | drugs |
|-------|---------|-------|
| 0 | DILIrank **2.0** — use this one | 1,336 |
| 1 | DILIrank 1.0, superseded | 1,036 |

Row 0 of each sheet is a title banner, so every reader must pass `header=1`.
With the default `header=0` every column comes back as `Unnamed: N`.

2.0 columns: `LTKBID`, `CompoundName`, `SeverityClass`, `LabelSection`,
`vDILI-Concern`, `Comment`. Note that `SeverityClass` (an integer grade)
precedes the label column, so a column lookup matching `"severity"` selects the
wrong one.

### Category strings are internally inconsistent — always normalise

The file mixes case and punctuation (`vMost-DILI-concern` 215 rows vs
`vMOST-DILI-concern` 2; `vNo-DILI-concern` 413 vs `vNo-DILI-Concern` 1), and
sheet 1 drops the `v` prefix entirely and writes `Ambiguous DILI-concern` with a
space. Compare labels only after passing both sides through the same
`norm_label()` (lowercase, strip non-letters). A hand-written alias table would
also drop rows.

## PubChem name → SMILES

PubChem renamed its SMILES properties. Requesting `property/CanonicalSMILES`
still returns HTTP 200 but the JSON key is now **`ConnectivitySMILES`**, so code
that looks up `props[0]["CanonicalSMILES"]` finds nothing and resolves zero
compounds while every request "succeeds". Request `property/SMILES` and read the
first key containing `SMILES`.

Resolutions are cached in `data/out/smiles-cache.json` so a re-run does not
re-hit the API.

## Everything else

Scripted. Run with `data/prep/.venv/Scripts/python data/prep/<script>.py`.

Environment:

```bash
python -m venv data/prep/.venv
data/prep/.venv/Scripts/python -m pip install -r data/prep/requirements.txt
```
````

`data/raw/` is deliberately NOT added to `.gitignore` — see the note in the
README above and in `.gitignore` itself. The workbook is 110KB of public-domain
US-government data and committing it pins the dataset version a result came from.
`data/out/*` IS ignored, with explicit negations for the spike reports and the
SMILES cache.

- [ ] **Step 3: Write the spike script**

Create `data/prep/spike_conflict_count.py`:

```python
"""Task-zero spike: do genuine cross-stream conflicts exist at usable scale?

Answers one question and then exits. If the answer is "no", the conflict-subset
metric in spec section 11 has no population and the plan changes before any more
code is written.

WHAT THE ORIGINAL PLAN MEASURED, AND WHY IT IS NOT ENOUGH
---------------------------------------------------------
The plan's spike counted compounds where a QSAR-style structural prediction
disagrees with the DILIrank label. That quantity is just the model's error count:
a model with 70% accuracy disagrees on 30% of compounds by construction, so on a
250-compound sample the plan's `nConflicting < 30` gate cannot realistically
fail. A gate that cannot fail is not a gate.

It is also not the thing the spec defines. DILIrank is the LABEL, not a stream.
The pre-registered conflict subset is "some stream committing to toxic differs
from some stream committing to safe" - a disagreement BETWEEN SOURCES, with the
label playing no part in deciding membership.

So this script reports both, and treats the second as the real gate:

  nConflicting          stream A vs the DILIrank label. Retained because the plan
                        pre-registered a threshold against it, and because a
                        LOW value would still invalidate the thesis: if structure
                        alone nearly predicts DILI, nobody needs ARBITER.

  nCrossStreamConflict  stream A vs stream B - two independent representations of
                        the same molecules (Morgan substructure fingerprints
                        against physicochemical descriptors), each predicting
                        out-of-fold. This is a source-versus-source disagreement,
                        the same shape as the real conflict subset, and it is the
                        best available proxy before Tox21 lands in Task 12.

Both are proxies and neither is the final number. The authoritative conflict
count comes from Task 13 over the real four streams. This is a go/no-go probe.
"""
import json
import pathlib
import re
import sys
import time

import numpy as np
import pandas as pd
import requests
from rdkit import Chem, RDLogger
from rdkit.Chem import Crippen, Descriptors, rdFingerprintGenerator, rdMolDescriptors
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.model_selection import StratifiedKFold

RDLogger.DisableLog("rdApp.*")

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "dilirank.xlsx"
RULESET = ROOT / "rules" / "ruleset-v1.0.json"
OUT = ROOT / "data" / "out"
CACHE = OUT / "smiles-cache.json"

SEED = 20260726

# 250 is the plan's pre-registered sample size and stays the default so the gate
# numbers are reproducible. Pass a larger n (or 0 for all 982) as argv[1] to run
# the training-set-size diagnostic: with 2048-bit fingerprints and ~184 training
# rows per fold, a weak model may be telling you about the sample rather than
# about DILI. Task 11 needs to know which.
SAMPLE_N = 250

# Published DILIrank 2.0 distribution, keyed by normalised label. Asserted so a
# parsing or matching regression fails loudly instead of quietly shrinking the
# evaluation set to nothing.
EXPECTED_2_0 = {
    "vmostdiliconcern": 217,
    "vlessdiliconcern": 351,
    "vnodiliconcern": 414,
    "ambiguousdiliconcern": 354,
}


def norm_label(s: str) -> str:
    """Lowercase and strip every non-letter.

    MANDATORY, not cosmetic. The workbook's category values are internally
    inconsistent in case and punctuation, and the pre-registered strings in
    ruleset-v1.0.json match almost none of them literally: "vMost-DILI-Concern"
    matches 0 rows against the file's "vMost-DILI-concern" (215) and
    "vMOST-DILI-concern" (2). An exact-match ingest yields an evaluation set of
    ONE compound.

    Normalising both sides is what makes the pre-registered policy mean what it
    says. It does not change the policy, so ruleset-v1.0.json stays untouched
    and its hash stands. Kept identical to Task 10's norm_label on purpose.
    """
    return re.sub(r"[^a-z]", "", str(s).lower())


def load_dilirank() -> pd.DataFrame:
    if not RAW.exists():
        sys.exit(f"Missing {RAW}. See data/prep/README.md for the download step.")

    # sheet_name=0 is DILIrank 2.0 (1,336 drugs); sheet 1 is the superseded 1.0
    # (1,036). header=1 because row 0 is a title banner, not column names - the
    # default header=0 makes every column "Unnamed: N" and the lookups below
    # raise StopIteration.
    df = pd.read_excel(RAW, sheet_name=0, header=1)

    name_col = next(c for c in df.columns if "compound" in c.lower() or "drug" in c.lower())
    # "concern" ONLY, and never `or "severity"`. The columns are LTKBID,
    # CompoundName, SeverityClass, LabelSection, vDILI-Concern, Comment, so a
    # "severity" clause matches SeverityClass - an integer grade - before it ever
    # reaches the label column, and binarisation would run on integers.
    label_col = next(c for c in df.columns if "concern" in c.lower())

    out = df[[name_col, label_col]].rename(columns={name_col: "name", label_col: "label"})
    out["name"] = out["name"].astype(str).str.strip()
    out["labelNorm"] = out["label"].map(norm_label)

    counts = out["labelNorm"].value_counts().to_dict()
    for key, expected in EXPECTED_2_0.items():
        got = counts.get(key, 0)
        if got != expected:
            sys.exit(
                f"DILIrank 2.0 category '{key}': expected {expected} rows, got {got}. "
                "The workbook, the sheet index, or the header row has changed - "
                "stop and re-verify before trusting any downstream number."
            )

    policy = json.loads(RULESET.read_text())["dilirankBinarisation"]
    positive = {norm_label(s) for s in policy["positive"]}
    negative = {norm_label(s) for s in policy["negative"]}

    binary = out[out["labelNorm"].isin(positive | negative)].copy()
    binary["y"] = binary["labelNorm"].isin(positive).astype(int)
    binary = binary.drop_duplicates(subset="name").reset_index(drop=True)

    if len(binary) < 900:
        sys.exit(f"Only {len(binary)} binary-labelled compounds; expected ~982. "
                 "That is the signature of the exact-match bug norm_label exists to prevent.")
    return binary[["name", "label", "y"]]


def resolve_smiles(names: list[str]) -> dict[str, str]:
    """Resolve compound names to SMILES via PubChem PUG-REST, throttled to 4/s.

    Requests `property/SMILES` and reads the first key containing "SMILES".
    PubChem renamed these properties: asking for `CanonicalSMILES` still returns
    HTTP 200 but the JSON key comes back as `ConnectivitySMILES`, so looking up
    props[0]["CanonicalSMILES"] resolves ZERO compounds while every request
    reports success.
    """
    cache: dict[str, str] = {}
    if CACHE.exists():
        cache = json.loads(CACHE.read_text())
        print(f"  SMILES cache: {len(cache)} entries")

    todo = [n for n in names if n not in cache]
    base = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name"
    misses = 0
    for i, name in enumerate(todo):
        try:
            r = requests.get(f"{base}/{requests.utils.quote(name)}/property/SMILES/JSON", timeout=20)
            if r.ok:
                props = r.json()["PropertyTable"]["Properties"]
                if props:
                    key = next((k for k in props[0] if "SMILES" in k), None)
                    if key:
                        cache[name] = props[0][key]
                    else:
                        misses += 1
                        if misses <= 3:
                            print(f"  ! no SMILES-like key for {name!r}: keys={list(props[0])}")
        except Exception:
            pass
        time.sleep(0.25)  # PubChem asks for <=5 req/s
        if (i + 1) % 25 == 0:
            print(f"  resolved {i + 1}/{len(todo)} ({len(cache)} cached total)", flush=True)

    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, indent=2, sort_keys=True))
    return {n: cache[n] for n in names if n in cache}


def morgan(mols: list) -> np.ndarray:
    """Stream A's representation: substructure presence."""
    gen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    return np.vstack([np.array(gen.GetFingerprint(m), dtype=np.int8) for m in mols])


DESCRIPTORS = [
    ("MolWt", Descriptors.MolWt),
    ("MolLogP", Crippen.MolLogP),
    ("MolMR", Crippen.MolMR),
    ("TPSA", rdMolDescriptors.CalcTPSA),
    ("NumHDonors", rdMolDescriptors.CalcNumHBD),
    ("NumHAcceptors", rdMolDescriptors.CalcNumHBA),
    ("NumRotatableBonds", rdMolDescriptors.CalcNumRotatableBonds),
    ("NumAromaticRings", rdMolDescriptors.CalcNumAromaticRings),
    ("RingCount", rdMolDescriptors.CalcNumRings),
    ("FractionCSP3", rdMolDescriptors.CalcFractionCSP3),
    ("HeavyAtomCount", Descriptors.HeavyAtomCount),
    ("NumHeteroatoms", rdMolDescriptors.CalcNumHeteroatoms),
    ("LabuteASA", rdMolDescriptors.CalcLabuteASA),
    ("NumAmideBonds", rdMolDescriptors.CalcNumAmideBonds),
]


def physchem(mols: list) -> np.ndarray:
    """Stream B's representation: bulk physicochemical properties.

    Deliberately shares no features with stream A. Morgan fingerprints ask "does
    this substructure appear"; these ask "how big, how greasy, how polar". Two
    genuinely different readings of the same molecule, which is what makes their
    disagreement stand in for a cross-stream conflict rather than for noise.
    """
    return np.vstack([np.array([fn(m) for _, fn in DESCRIPTORS], dtype=np.float64) for m in mols])


def out_of_fold(X: np.ndarray, y: np.ndarray, folds: list) -> np.ndarray:
    """Every compound scored by a model that never saw it."""
    pred = np.zeros(len(y), dtype=int)
    for tr, te in folds:
        clf = HistGradientBoostingClassifier(max_iter=150, random_state=SEED).fit(X[tr], y[tr])
        pred[te] = clf.predict(X[te])
    return pred


def main() -> None:
    n_arg = int(sys.argv[1]) if len(sys.argv) > 1 else SAMPLE_N
    df = load_dilirank()
    print(f"DILIrank 2.0 binary-labelled compounds: {len(df)} "
          f"({int(df['y'].sum())} positive, {int((1 - df['y']).sum())} negative)")

    n_take = len(df) if n_arg == 0 else min(n_arg, len(df))
    sample = df.sample(n=n_take, random_state=SEED).reset_index(drop=True)
    print(f"Sampling {len(sample)} (seed {SEED}); resolving SMILES via PubChem...")

    smiles_map = resolve_smiles(sample["name"].tolist())
    sample["smiles"] = sample["name"].map(smiles_map)
    sample = sample.dropna(subset=["smiles"]).reset_index(drop=True)

    # Drop anything RDKit cannot parse, rather than substituting a zero vector -
    # an all-zero fingerprint is a real point in feature space and the model
    # would happily learn from it.
    sample["mol"] = sample["smiles"].map(Chem.MolFromSmiles)
    n_unparsed = int(sample["mol"].isna().sum())
    sample = sample.dropna(subset=["mol"]).reset_index(drop=True)
    print(f"Resolved to SMILES: {len(sample)} usable ({n_unparsed} unparseable, dropped)")

    if len(sample) < 50:
        sys.exit(f"Only {len(sample)} usable compounds - too few to conclude anything. "
                 "Check PubChem connectivity and the SMILES property key.")

    mols = sample["mol"].tolist()
    y = sample["y"].to_numpy()
    folds = list(StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED).split(mols, y))

    pred_a = out_of_fold(morgan(mols), y, folds)      # stream A: structural
    pred_b = out_of_fold(physchem(mols), y, folds)    # stream B: physicochemical

    n_conflict = int((pred_a != y).sum())
    disagree = pred_a != pred_b
    n_cross = int(disagree.sum())

    # THE NUMBER THAT DECIDES WHETHER ARBITRATION IS POSSIBLE AT ALL.
    #
    # A population of disagreements is necessary but not sufficient: if the two
    # streams are coin flips, something has to decide them and no rule can beat
    # 50%. So measure how often stream A is the correct one ON THE DISAGREEMENT
    # SUBSET. Distance from 0.5 is the arbitrable signal. (B's figure is
    # 1 - A's by construction - on a binary disagreement exactly one side is
    # right - so only A's is reported.)
    #
    # An earlier draft of this script also reported nCrossStreamResolvable,
    # "disagreements where at least one stream was correct". That is 100% by
    # construction for two binary predictors and measured nothing - exactly the
    # can't-fail metric this project keeps catching in its own tests.
    a_wins_when_split = float((pred_a == y)[disagree].mean()) if n_cross else float("nan")

    # The floor any claim of skill has to clear. With a 59.6% positive rate,
    # "always predict toxic" scores 59.6%.
    majority_baseline = float(max(y.mean(), 1 - y.mean()))

    report = {
        "nCompounds": int(len(df)),
        "nWithBothStreams": int(len(sample)),
        "nConflicting": n_conflict,
        "conflictRate": round(n_conflict / len(sample), 4),
        "nCrossStreamConflict": n_cross,
        "crossStreamConflictRate": round(n_cross / len(sample), 4),
        "streamAWinRateWhenStreamsSplit": round(a_wins_when_split, 4),
        "accuracyStreamA": round(float((pred_a == y).mean()), 4),
        "accuracyStreamB": round(float((pred_b == y).mean()), 4),
        "majorityClassBaseline": round(majority_baseline, 4),
        "streamsBeatMajorityBaseline": bool(
            (pred_a == y).mean() > majority_baseline or (pred_b == y).mean() > majority_baseline),
        "positiveRateSample": round(float(y.mean()), 4),
        "seed": SEED,
        "dilirankVersion": "2.0 (sheet 0)",
        "note": (
            "nConflicting is stream-A-vs-LABEL disagreement, i.e. model error - retained "
            "because the plan pre-registered a threshold against it. nCrossStreamConflict "
            "is stream-A-vs-stream-B, a source-versus-source disagreement, which is the "
            "shape the pre-registered conflict subset actually has. Both are proxies; the "
            "authoritative count comes from Task 13 over the real four streams."
        ),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    # The pre-registered n=250 run and the full-set diagnostic are different
    # measurements and both matter, so neither overwrites the other.
    name = "spike-report.json" if n_arg == SAMPLE_N else f"spike-report-n{len(sample)}.json"
    report["requestedSampleN"] = "all" if n_arg == 0 else n_arg
    (OUT / name).write_text(json.dumps(report, indent=2))
    print()
    print(json.dumps(report, indent=2))
    print(f"\nwrote data/out/{name}")

    print()
    if n_conflict < 30:
        print("*** GATE A FAILED: fewer than 30 QSAR-vs-label conflicts. Structure alone "
              "nearly predicts DILI on this sample; the premise needs revisiting. ***")
    else:
        print(f"GATE A passed: {n_conflict} QSAR-vs-label conflicts (>= 30).")

    if n_cross < 30:
        print("*** GATE B FAILED: fewer than 30 cross-stream conflicts. Two independent "
              "representations almost never disagree, so the conflict subset has no "
              "population and spec section 11's headline metric is underpowered. "
              "REPORT THIS BEFORE WRITING MORE CODE. ***")
    else:
        print(f"GATE B passed: {n_cross} cross-stream conflicts.")

    # A populated conflict subset built from two skill-free streams would give the
    # headline metric an N and nothing to measure. This is a warning about Task 11,
    # not a verdict on the premise, so it is reported separately from the gates.
    print()
    if not report["streamsBeatMajorityBaseline"]:
        print(f"*** WARNING: neither stream beats the majority-class baseline "
              f"({majority_baseline:.3f}). A: {report['accuracyStreamA']:.3f}, "
              f"B: {report['accuracyStreamB']:.3f}. The conflict subset is populated but "
              f"the disagreements in it are mostly noise. Task 11's QSAR must carry real "
              f"skill or Task 15's headline measures nothing. ***")
    print(f"When the streams split, stream A is the correct one "
          f"{a_wins_when_split:.1%} of the time. Distance from 50% is the signal any "
          f"arbitration rule has to exploit; at exactly 50% no rule can beat a coin flip.")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the spike**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python data/prep/spike_conflict_count.py
```

Then run the full-set diagnostic, which also populates the SMILES cache Task 11 needs:

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python data/prep/spike_conflict_count.py 0
```

**Stop and report `nCrossStreamConflict`.** Under 30 and the conflict subset has no
population, so spec §11's headline metric is underpowered and the plan changes before any
more code is written.

**Then read `streamsBeatMajorityBaseline` and `streamAWinRateWhenStreamsSplit`, because the
gate can pass while telling you the streams are worthless.** A populated conflict subset
built from two skill-free predictors gives the headline an N and nothing to measure: if the
streams cannot beat "always guess the majority class", their disagreements are noise, and no
arbitration rule can beat a coin flip on them.

**MEASURED 2026-07-27 — this is exactly what happened at the sample size this step
originally specified:**

| | n=250 (230 resolved) | n=all (891 resolved) |
|---|---|---|
| QSAR-vs-label conflicts | 95 | 260 |
| cross-stream conflicts | 94 | 258 (29.0%) |
| stream A accuracy | 0.587 | 0.708 |
| stream B accuracy | 0.570 | 0.666 |
| majority-class baseline | 0.596 | 0.602 |
| beats baseline? | **no** | yes |
| stream A wins when split | 0.521 | 0.574 |

At 250 compounds both streams are *below* the majority-class baseline and the arbitrable
signal is 2.1 points — indistinguishable from noise. It is the sample, not DILI: 2048-bit
fingerprints with ~184 training rows per fold cannot learn. On the full set stream A reaches
0.708 against a 0.602 baseline, in line with published DILI QSAR, and the signal is 7.4
points. **Task 11 must train on the full resolved set — if the 250-compound sample leaks into
it, Task 15's headline measures noise.** PubChem resolves 891/982 (90.7%), so the real
evaluation set is 891, not 982.

- [ ] **Step 5: Commit**

```bash
git add .gitignore data/prep data/out/spike-report.json data/out/spike-report-n891.json data/out/smiles-cache.json && git commit -m "Add task-zero conflict-count spike

Answers the one question that can invalidate the headline metric: do
cross-stream conflicts exist at usable scale on DILIrank? Two independent
representations - Morgan substructure fingerprints against physicochemical
descriptors - each predicting out-of-fold, so every compound is scored by a model
that never saw it and the disagreement measured is source-versus-source rather
than model error.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

The reports and the SMILES cache are committed via `.gitignore` negations rather than `-f`.
The pattern must be `data/out/*`, **not** `data/out/` — git cannot re-include a file whose
parent directory is excluded, so the trailing-slash form makes the negations silently dead.

---

## Task 2: Monorepo scaffold, engine types, and the zod contract

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.eslintrc.json`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`
- Create: `packages/engine/src/types.ts`, `packages/engine/src/schema.ts`
- Test: `packages/engine/test/schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `EvidenceClaim`, `Ruleset`, `Rule`, `Reasoning`, `TraceStep`, `Verdict`, `Assertion`, `BiologicalSystem`; `EvidenceClaimSchema`, `RulesetSchema`

- [ ] **Step 1: Scaffold the workspace**

`package.json`:

```json
{
  "name": "arbiter",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "vitest run",
    "lint": "eslint packages apps --ext .ts",
    "typecheck": "tsc -b packages/engine apps/harness",
    "harness": "tsx apps/harness/src/main.ts"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^8.57.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "composite": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  }
}
```

`resolveJsonModule` is required — `packages/engine/test/rules.test.ts` imports `rules/ruleset-v1.0.json` directly so the tests run against the real pre-registered file rather than a copy that could drift from it.

`packages/engine/package.json`:

```json
{
  "name": "@arbiter/engine",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {}
}
```

`packages/engine/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

`.eslintrc.json` — this is where determinism is enforced:

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": ["eslint:recommended"],
  "env": { "es2022": true, "node": true },
  "overrides": [
    {
      "files": ["packages/engine/src/**/*.ts"],
      "rules": {
        "no-restricted-globals": [
          "error",
          { "name": "Date", "message": "The engine must be deterministic. Callers filter by availableFrom." },
          { "name": "performance", "message": "The engine must be deterministic. performance.now() is a clock. Callers filter by availableFrom." },
          { "name": "process", "message": "The engine must be pure. Reading process.env or process.hrtime makes the same input produce different output." },
          { "name": "crypto", "message": "The engine must be deterministic. crypto.randomUUID/getRandomValues are randomness; all randomness lives in apps/harness with a committed seed." },
          { "name": "globalThis", "message": "globalThis re-exposes every banned global (globalThis.Date.now(), globalThis.Math.random()). Name what you need directly so the other rules can see it." }
        ],
        "no-restricted-properties": [
          "error",
          { "object": "Math", "property": "random", "message": "All randomness lives in apps/harness with a committed seed." }
        ],
        "no-restricted-imports": [
          "error",
          { "patterns": ["../*", "node:*", "fs", "path", "crypto"] }
        ],
        "no-restricted-syntax": [
          "error",
          {
            "selector": "ImportExpression",
            "message": "Dynamic import() bypasses no-restricted-imports. The engine is pure and imports nothing at runtime."
          }
        ]
      }
    }
  ]
}
```

Run:

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm install && npm exec tsc --version
```

Expected: npm installs without error, `tsc` prints `Version 5.6.x`.

The ban targets `Math.random` specifically via `no-restricted-properties`, not the `Math` global — the engine legitimately uses `Math.min`, `Math.max`, and `Math.abs`, and banning the whole namespace would force pointless aliasing while catching nothing extra.

**`Date` and `Math.random` alone do not enforce purity — VERIFY the config by trying to break it.** An earlier version of this override banned only those two, and every one of the following passed with zero errors: `performance.now()` (a clock), `globalThis.Date.now()` (the banned global reached through another name), `process.env.FOO` (ambient input), `crypto.randomUUID()` (randomness), and `await import("node:fs")` — dynamic `import()` is an `ImportExpression`, which `no-restricted-imports` cannot see at all, so it needs `no-restricted-syntax`. Note `crypto` appears in BOTH `no-restricted-imports` (the module) and `no-restricted-globals` (the Web Crypto global); they are different things and banning one does not ban the other. After editing this file, write each of the five expressions into a throwaway file under `packages/engine/src/` and confirm `npx eslint` exits non-zero on every one before deleting it. A determinism guard nobody has attacked is not a guard.

- [ ] **Step 2: Write the failing schema test**

Create `packages/engine/test/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EvidenceClaimSchema, RulesetSchema } from "../src/schema.js";

const validClaim = {
  id: "tak994-rat-28d",
  compoundId: "TAK-994",
  stream: "invivo_rodent",
  assertion: "safe",
  strength: 0.8,
  system: "rodent",
  measuresKeyEvent: null,
  exposureRelevant: null,
  inApplicabilityDomain: null,
  klimisch: 1,
  availableFrom: "2021-01-01",
  provenance: { kind: "literature", source: "PMID:example", retrieved: "2026-07-26" },
};

describe("EvidenceClaimSchema", () => {
  it("accepts a well-formed claim", () => {
    expect(EvidenceClaimSchema.parse(validClaim).id).toBe("tak994-rat-28d");
  });

  it("rejects strength outside 0..1", () => {
    expect(() => EvidenceClaimSchema.parse({ ...validClaim, strength: 1.4 })).toThrow();
  });

  it("rejects an unknown stream", () => {
    expect(() => EvidenceClaimSchema.parse({ ...validClaim, stream: "vibes" })).toThrow();
  });

  it("rejects a klimisch score outside 1..4", () => {
    expect(() => EvidenceClaimSchema.parse({ ...validClaim, klimisch: 7 })).toThrow();
  });

  it("rejects an in_silico/qsar claim that asserts it MEASURED a key event", () => {
    // A computational prediction predicts a key event; it does not measure one.
    // Left unchecked, such a claim escapes every discount clause - R2 requires
    // measuresKeyEvent === null - and gets weighted like human clinical evidence.
    // Asserted on the RESULT, not merely that something threw: a `.toThrow()` here
    // would also pass if the claim were rejected for an unrelated reason.
    const r = EvidenceClaimSchema.safeParse({
      ...validClaim,
      stream: "qsar",
      system: "in_silico",
      measuresKeyEvent: "KE:55",
    });
    expect(r.success).toBe(false);
    if (r.success) throw new Error("expected the schema to reject this claim");
    expect(r.error.issues.some((i) => i.path.join(".") === "measuresKeyEvent")).toBe(true);
    expect(r.error.issues.map((i) => i.message).join(" ")).toMatch(/cannot MEASURE/);
  });

  it("accepts the same in_silico/qsar claim once measuresKeyEvent is null", () => {
    const r = EvidenceClaimSchema.safeParse({
      ...validClaim,
      stream: "qsar",
      system: "in_silico",
      measuresKeyEvent: null,
    });
    expect(r.success).toBe(true);
  });
});

describe("RulesetSchema", () => {
  it("requires all six rules", () => {
    const ruleset = {
      version: "1.0",
      registeredAt: "2026-07-26",
      abstentionGapThreshold: 0.5,
      dilirankBinarisation: { positive: ["vMost-DILI-Concern"], negative: ["vNo-DILI-Concern"], excluded: ["Ambiguous"] },
      rules: [{ id: "R1", name: "Human relevance", statement: "s", framework: { name: "f", date: "2025-04" }, enabled: true, strength: 1 }],
    };
    expect(() => RulesetSchema.parse(ruleset)).toThrow(/six/i);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/schema.test.ts
```

Expected: FAIL — `Cannot find module '../src/schema.js'`

- [ ] **Step 4: Write `types.ts`**

Create `packages/engine/src/types.ts`:

```ts
/** What a source asserts about a compound. `ambiguous` is a real answer, not missing data. */
export type Assertion = "toxic" | "safe" | "ambiguous";

/** What biology produced the signal. Consumed by R1. */
export type BiologicalSystem = "human" | "rodent" | "nonrodent" | "in_silico";

export type Stream =
  | "qsar"
  | "cytotox"
  | "toxicogenomics"
  | "transporter"
  | "invivo_rodent"
  | "invivo_nonrodent";

export type Verdict = "advance" | "do_not_advance" | "abstain";

export interface Provenance {
  kind: "database" | "literature";
  /** e.g. "DILIrank", "Tox21/AID-1234", "PMID:39876543" */
  source: string;
  /** ISO date the prep run fetched it. Set by Python, never by the engine. */
  retrieved: string;
  /**
   * `| undefined` is explicit, not redundant. The repo runs
   * `exactOptionalPropertyTypes`, under which `url?: string` means "may be absent
   * but never explicitly undefined" - and zod's `.optional()` infers
   * `string | undefined`, which permits both. Writing the narrower form made the
   * schema's inferred type NOT assignable to this interface, so the drift guard in
   * schema.ts could never pass. This form says what parsing actually produces.
   */
  url?: string | undefined;
}

/**
 * One typed evidence claim. Every field exists because exactly one rule
 * consumes it — see spec §5. Adding a field here means adding a rule.
 */
export interface EvidenceClaim {
  id: string;
  compoundId: string;
  /** → R6. Stream identity lets R6 judge whether agreeing sources are genuinely independent — agreement across distinct streams counts for more than one source agreeing with itself. */
  stream: Stream;
  assertion: Assertion;
  /** Source-reported confidence, 0..1. */
  strength: number;
  /** → R1 */
  system: BiologicalSystem;
  /** → R2. `null` means structural correlation only, not a measured key event. */
  measuresKeyEvent: string | null;
  /** → R3. `null` means the exposure margin was never tested at clinical range. */
  exposureRelevant: boolean | null;
  /** → R4. `null` means not assessable. */
  inApplicabilityDomain: boolean | null;
  /** → R5. Klimisch reliability score. */
  klimisch: 1 | 2 | 3 | 4 | null;
  /** Enables as-of replay. The ENGINE NEVER READS THIS — callers filter first. */
  availableFrom: string;
  provenance: Provenance;
}

/**
 * The on-disk evidence file the Python prep layer writes and the harness reads.
 * Mirrors `EvidenceFileSchema`; schema.ts asserts at compile time that the two
 * cannot drift apart.
 */
export interface EvidenceFile {
  /** ISO timestamp. Set by the Python prep run, never by the engine. */
  generatedAt: string;
  claims: EvidenceClaim[];
}

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";

/**
 * The four pairwise defeat rules. R4 downweights rather than defeating a
 * claim, and R6 is a property of a set of claims, not a pairwise comparison
 * — neither participates in a precedence ordering between attacker/target.
 */
export type DefeatRuleId = "R1" | "R2" | "R3" | "R5";

export interface Rule {
  id: RuleId;
  name: string;
  statement: string;
  /**
   * The published framework the rule rests on. No rule may cite TAK-994.
   * `note?: string | undefined` for the same exactOptionalPropertyTypes reason as
   * `Provenance.url` - see the note there.
   */
  framework: { name: string; date: string; note?: string | undefined };
  enabled: boolean;
  /** How strongly this rule defeats, 0..1. Editable by a toxicologist. */
  strength: number;
}

export interface Ruleset {
  version: string;
  /** ISO date, set at pre-registration. */
  registeredAt: string;
  /** Abstain when plausibility - belief exceeds this. Pre-registered. */
  abstentionGapThreshold: number;
  dilirankBinarisation: { positive: string[]; negative: string[]; excluded: string[] };
  rules: Rule[];
  /**
   * Precedence order over the four defeat rules: earlier entries outrank
   * later ones when two rules would each license an attack in opposite
   * directions on the same pair of claims. Editable by a toxicologist
   * alongside `rules`.
   */
  precedenceOrder: DefeatRuleId[];
  /** Why this precedence order was chosen. Must not reference the demonstration case — see `rules[].framework`. */
  precedenceRationale: string;
}

export type ClaimStatus = "admitted" | "defeated" | "downweighted" | "undecided";

export interface TraceStep {
  claimId: string;
  status: ClaimStatus;
  /** The rule that produced this status, when one did. */
  byRule?: RuleId;
  /** The claim that defeated this one, when applicable. */
  defeatedBy?: string;
  /**
   * Set only on the synthetic step carrying the verdict's own explanation. Filter
   * on this rather than on `claimId === "__verdict__"`, which a real claim could
   * collide with, or on `status`, which reads as a real undecided claim.
   */
  kind?: "verdict";
  /** Human-readable, rendered directly in the UI. */
  rationale: string;
}

export interface Counterfactual {
  /**
   * Every claim that must change, and what it must become, for the verdict to
   * flip — sorted by claimId so the value is stable under input reordering.
   *
   * A per-claim target rather than one shared `flipTo`, because the search is
   * exhaustive over ASSIGNMENTS and a minimal answer can be heterogeneous: "this
   * toxic reading would have to become safe *and* that one would have to become
   * ambiguous". A single `flipTo` field cannot express that, and having one is
   * what let an earlier draft search 3 combinations per pair instead of 9 while
   * still calling itself exhaustive.
   *
   * Every entry is a genuine change: a flip whose target equals the claim's
   * current assertion is never reported, so `flips.length` is the true size of
   * the minimal set.
   */
  flips: { claimId: string; to: Assertion }[];
  newVerdict: Verdict;
}

export interface NextExperiment {
  assay: string;
  /** The rule this assay would settle. This is what makes the planner novel. */
  resolvesRule: RuleId | null;
  expectedGapReduction: number;
  cost: number;
  score: number;
  rationale: string;
}

export interface Reasoning {
  verdict: Verdict;
  /**
   * True when opposed assertions both survive, i.e. neither was defeated.
   * `undecided` counts as surviving — a mutual-defeat cycle is the most contested
   * state there is. Not the pre-registered Task 15 conflict subset, which is a
   * property of the raw claims; this is the per-result display field.
   */
  contested: boolean;
  belief: number;
  plausibility: number;
  /**
   * The fused Dempster-Shafer mass the verdict was read off. Reported so a
   * reviewer can reconcile the verdict against the numbers: `belief` alone is the
   * mass on TOXIC, which cannot explain an "advance". Structurally identical to
   * `Mass` in fuse.ts.
   *
   * Written as an inline structural type ON PURPOSE. Do NOT `import` `Mass` from
   * fuse.ts here - types.ts is the leaf every other module depends on, and making
   * it depend on an implementation module inverts that.
   */
  mass: { toxic: number; safe: number; uncommitted: number };
  /** Dempster conflict mass. Surfaced, never normalised away. */
  conflictMass: number;
  trace: TraceStep[];
  counterfactual: Counterfactual | null;
  nextExperiment: NextExperiment | null;
  rulesetHash: string;
}
```

- [ ] **Step 5: Write `schema.ts`**

Add `zod` to the engine's dependencies — this is the one exception to zero-deps, and it is deliberate: schema validation at the seam is worth more than purity, and zod has no I/O, no dates, and no randomness.

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm install zod@^3.23.8 --workspace @arbiter/engine
```

Create `packages/engine/src/schema.ts`:

```ts
import { z } from "zod";
import type { EvidenceClaim, EvidenceFile, Ruleset } from "./types.js";

export const ProvenanceSchema = z.object({
  kind: z.enum(["database", "literature"]),
  source: z.string().min(1),
  retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  url: z.string().url().optional(),
});

export const EvidenceClaimSchema = z
  .object({
    id: z.string().min(1),
    compoundId: z.string().min(1),
    stream: z.enum(["qsar", "cytotox", "toxicogenomics", "transporter", "invivo_rodent", "invivo_nonrodent"]),
    assertion: z.enum(["toxic", "safe", "ambiguous"]),
    strength: z.number().min(0).max(1),
    system: z.enum(["human", "rodent", "nonrodent", "in_silico"]),
    measuresKeyEvent: z.string().nullable(),
    exposureRelevant: z.boolean().nullable(),
    inApplicabilityDomain: z.boolean().nullable(),
    klimisch: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
    availableFrom: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
    provenance: ProvenanceSchema,
  })
  .refine(
    (c) => !(c.system === "in_silico" || c.stream === "qsar") || c.measuresKeyEvent === null,
    {
      message:
        "A computational prediction cannot MEASURE an AOP key event - it can only predict one. " +
        "Leaving measuresKeyEvent non-null on an in_silico or qsar claim lets it escape R2's " +
        "structural-correlation discount and be weighted like human clinical evidence.",
      path: ["measuresKeyEvent"],
    },
  );

export const RuleSchema = z.object({
  id: z.enum(["R1", "R2", "R3", "R4", "R5", "R6"]),
  name: z.string().min(1),
  statement: z.string().min(1),
  framework: z.object({ name: z.string().min(1), date: z.string().min(1), note: z.string().optional() }),
  enabled: z.boolean(),
  strength: z.number().min(0).max(1),
});

export const RulesetSchema = z
  .object({
    version: z.string().min(1),
    registeredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    abstentionGapThreshold: z.number().min(0).max(1),
    dilirankBinarisation: z.object({
      positive: z.array(z.string()).min(1),
      negative: z.array(z.string()).min(1),
      excluded: z.array(z.string()),
    }),
    rules: z.array(RuleSchema),
    precedenceOrder: z.array(z.enum(["R1", "R2", "R3", "R5"])).length(4),
    precedenceRationale: z.string().min(1),
  })
  .refine((r) => r.rules.length === 6, { message: "A ruleset must declare all six rules R1-R6" })
  .refine((r) => new Set(r.rules.map((x) => x.id)).size === 6, { message: "Rule ids must be unique across all six" })
  .refine((r) => new Set(r.precedenceOrder).size === 4, {
    message: "precedenceOrder must contain each of R1, R2, R3, R5 exactly once",
  });

export const EvidenceFileSchema = z.object({
  generatedAt: z.string(),
  claims: z.array(EvidenceClaimSchema),
});

/* ------------------------------------------------------------------------- *
 * Drift guards: the hand-written interfaces in types.ts and the zod schemas
 * here declare the same field lists twice, and nothing forced them to agree.
 *
 * The obvious fix - derive the interfaces via `z.infer` - is WRONG HERE, and
 * that is why this was deferred rather than done. types.ts is the leaf module
 * every other engine module imports; making it depend on schema.ts would make it
 * depend on zod and invert the dependency direction the whole package rests on.
 *
 * So the assertion points the other way. These types are erased at build time
 * and cost nothing at runtime, but any field added, removed or retyped on
 * EITHER side fails the typecheck with a message naming the offending property.
 * Bidirectional on purpose: a one-way `extends` check passes happily when one
 * side gains an extra field.
 * ------------------------------------------------------------------------- */

/** Resolves to `true` only when A and B are mutually assignable. */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export type ClaimShapeMatchesInterface = MutuallyAssignable<z.infer<typeof EvidenceClaimSchema>, EvidenceClaim>;
export type RulesetShapeMatchesInterface = MutuallyAssignable<z.infer<typeof RulesetSchema>, Ruleset>;
export type EvidenceFileShapeMatchesInterface = MutuallyAssignable<z.infer<typeof EvidenceFileSchema>, EvidenceFile>;

/**
 * Forces the three checks above to be evaluated. Without a value site TypeScript
 * would leave them as unused aliases and never report the `never`.
 */
export const SCHEMAS_MATCH_TYPES: [
  ClaimShapeMatchesInterface,
  RulesetShapeMatchesInterface,
  EvidenceFileShapeMatchesInterface,
] = [true, true, true];
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/schema.test.ts && npm run lint
```

Expected: PASS (5 tests), lint clean.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json .eslintrc.json packages/ && git commit -m "Scaffold monorepo, engine types, and the zod contract

Types encode the spec's schema-from-rules discipline: every EvidenceClaim
field is annotated with the rule that consumes it, so adding a field means
adding a rule.

Determinism is enforced by ESLint inside packages/engine: Math.random is
banned outright, as are imports of fs/path/crypto and any parent directory.
availableFrom is present on the claim but documented as never read by the
engine - callers filter before calling reason().

zod is the one permitted engine dependency. It has no I/O, no clock, and no
randomness, and validating at the seam is worth more than nominal purity.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Dempster–Shafer fusion

**Files:**
- Create: `packages/engine/src/fuse.ts`
- Test: `packages/engine/test/fuse.test.ts`

**Interfaces:**
- Consumes: `Assertion` from `types.ts`
- Produces:
  - `type Mass = { toxic: number; safe: number; uncommitted: number }`
  - `claimToMass(assertion: Assertion, strength: number): Mass`
  - `combine(a: Mass, b: Mass): { mass: Mass; conflict: number }`
  - `fuse(masses: Mass[]): { belief: number; plausibility: number; conflictMass: number }`
  - `VACUOUS: Mass` — the silent-source constant

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/fuse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { VACUOUS, claimToMass, combine, fuse } from "../src/fuse.js";

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);

describe("claimToMass", () => {
  it("puts an ambiguous claim entirely in uncommitted mass", () => {
    const m = claimToMass("ambiguous", 0.9);
    near(m.uncommitted, 1);
    near(m.toxic, 0);
    near(m.safe, 0);
  });

  it("leaves 1 - strength uncommitted for a committed claim", () => {
    const m = claimToMass("toxic", 0.7);
    near(m.toxic, 0.7);
    near(m.uncommitted, 0.3);
  });
});

describe("combine", () => {
  it("is commutative", () => {
    const a = claimToMass("toxic", 0.6);
    const b = claimToMass("safe", 0.3);
    near(combine(a, b).mass.toxic, combine(b, a).mass.toxic);
  });

  it("is associative", () => {
    const [a, b, c] = [claimToMass("toxic", 0.5), claimToMass("safe", 0.4), claimToMass("toxic", 0.2)];
    const left = combine(combine(a!, b!).mass, c!).mass;
    const right = combine(a!, combine(b!, c!).mass).mass;
    near(left.toxic, right.toxic);
    near(left.safe, right.safe);
  });

  it("THE KEY PROPERTY: a silent source does not move belief", () => {
    const a = claimToMass("toxic", 0.7);
    const combined = combine(a, VACUOUS).mass;
    near(combined.toxic, a.toxic);
    near(combined.safe, a.safe);
    near(combined.uncommitted, a.uncommitted);
  });

  it("tracks conflict mass when sources disagree", () => {
    const { conflict } = combine(claimToMass("toxic", 1), claimToMass("safe", 1));
    near(conflict, 1);
  });
});

describe("fuse", () => {
  it("holds belief <= plausibility over random mass assignments", () => {
    // Deterministic pseudo-random sweep: no Math.random in tests either.
    let s = 12345;
    const next = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 500; i++) {
      const masses = Array.from({ length: 1 + (i % 5) }, () => {
        const t = next() * 0.6;
        const f = next() * (1 - t) * 0.6;
        return { toxic: t, safe: f, uncommitted: 1 - t - f };
      });
      const r = fuse(masses);
      expect(r.belief).toBeLessThanOrEqual(r.plausibility + 1e-12);
      expect(r.belief).toBeGreaterThanOrEqual(0);
      expect(r.plausibility).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it("returns a maximally wide range for no evidence at all", () => {
    const r = fuse([]);
    near(r.belief, 0);
    near(r.plausibility, 1);
  });

  it("reports total conflict rather than dividing by zero", () => {
    const r = fuse([claimToMass("toxic", 1), claimToMass("safe", 1)]);
    near(r.conflictMass, 1);
    near(r.belief, 0);
    near(r.plausibility, 1);
  });

  it("accumulates conflict multiplicatively when sources partially conflict", () => {
    // Three sources: toxic at 0.6, safe at 0.6, toxic at 0.6
    // Hand derivation:
    // A ⊕ B: {toxic: 0.375, safe: 0.375, uncommitted: 0.25}, K₁ = 0.36
    // (A ⊕ B) ⊕ C: K₂ = 0.225
    // Cumulative conflict = 1 - (1 - K₁)(1 - K₂) = 1 - 0.64 × 0.775 = 0.504
    const a = claimToMass("toxic", 0.6);
    const b = claimToMass("safe", 0.6);
    const c = claimToMass("toxic", 0.6);
    const r = fuse([a, b, c]);

    // Expected cumulative conflict is 0.504, strictly greater than max(K₁, K₂) = 0.36
    near(r.conflictMass, 0.504);
    // Strictly greater than max() is the whole point of the fix this test came
    // from, so assert it rather than leaving it to the comment.
    expect(r.conflictMass).toBeGreaterThan(0.36);
  });

  it("produces the hand-derived MASS for an ordinary partial conflict, not just the right shape", () => {
    // The suite validated structure (sums to 1, belief <= plausibility) and the
    // conflict scalar, but never an absolute mass for a partial conflict - so an
    // implementation that normalised correctly while distributing mass wrongly
    // would have passed everything.
    //
    // Two sources, toxic 0.6 against safe 0.6. Unnormalised:
    //   toxic = 0.6*0.4 = 0.24,  safe = 0.4*0.6 = 0.24,  Theta = 0.4*0.4 = 0.16
    //   K = 0.6*0.6 = 0.36,  norm = 0.64
    // Normalised: 0.24/0.64 = 0.375, 0.375, 0.16/0.64 = 0.25.
    const two = fuse([claimToMass("toxic", 0.6), claimToMass("safe", 0.6)]);
    near(two.mass.toxic, 0.375);
    near(two.mass.safe, 0.375);
    near(two.mass.uncommitted, 0.25);

    // Adding a third source, toxic 0.6, against that accumulator:
    //   toxic = 0.375*0.6 + 0.375*0.4 + 0.25*0.6 = 0.525
    //   safe  = 0.375*0.4                        = 0.15
    //   Theta = 0.25*0.4                         = 0.10
    //   K = 0.375*0.6 = 0.225,  norm = 0.775
    // which lands on exact thirty-firsts: 21/31, 6/31, 4/31 (summing to 31/31).
    const three = fuse([claimToMass("toxic", 0.6), claimToMass("safe", 0.6), claimToMass("toxic", 0.6)]);
    near(three.mass.toxic, 21 / 31);
    near(three.mass.safe, 6 / 31);
    near(three.mass.uncommitted, 4 / 31);
    // The two agreeing toxic sources must outweigh the lone safe one, and the
    // surviving belief must exceed what either toxic source carried alone.
    expect(three.mass.toxic).toBeGreaterThan(0.6);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/fuse.test.ts
```

Expected: FAIL — `Cannot find module '../src/fuse.js'`

- [ ] **Step 3: Write the implementation**

Create `packages/engine/src/fuse.ts`:

```ts
import type { Assertion } from "./types.js";

/**
 * Mass over the frame Theta = {toxic, safe}.
 *
 * `uncommitted` is mass on Theta itself: what this source genuinely cannot
 * tell you. It is NOT a hedge and NOT half a vote for each side. This is the
 * whole reason fusion beats averaging.
 */
export interface Mass {
  toxic: number;
  safe: number;
  uncommitted: number;
}

/** A source that says nothing. Contributes m(Theta) = 1, never a vote for safe. */
export const VACUOUS: Mass = { toxic: 0, safe: 0, uncommitted: 1 };

export function claimToMass(assertion: Assertion, strength: number): Mass {
  const s = Math.max(0, Math.min(1, strength));
  if (assertion === "ambiguous") return { ...VACUOUS };
  if (assertion === "toxic") return { toxic: s, safe: 0, uncommitted: 1 - s };
  return { toxic: 0, safe: s, uncommitted: 1 - s };
}

/**
 * Dempster's rule of combination.
 *
 * Returns the normalised combined mass plus the conflict mass K that was
 * normalised out. We return K rather than swallowing it: a high K means the
 * sources genuinely disagree, which is information a safety lead needs.
 */
export function combine(a: Mass, b: Mass): { mass: Mass; conflict: number } {
  const toxic = a.toxic * b.toxic + a.toxic * b.uncommitted + a.uncommitted * b.toxic;
  const safe = a.safe * b.safe + a.safe * b.uncommitted + a.uncommitted * b.safe;
  const uncommitted = a.uncommitted * b.uncommitted;
  const conflict = a.toxic * b.safe + a.safe * b.toxic;

  const norm = 1 - conflict;
  if (norm <= Number.EPSILON) {
    // Total conflict: Dempster's rule is undefined. Return the vacuous mass,
    // which is the honest answer - we know nothing - and report K = 1 so the
    // caller can abstain rather than fabricate a verdict.
    return { mass: { ...VACUOUS }, conflict: 1 };
  }
  return { mass: { toxic: toxic / norm, safe: safe / norm, uncommitted: uncommitted / norm }, conflict };
}

/**
 * Fuse many masses. belief(toxic) = m({toxic}); plausibility(toxic) =
 * m({toxic}) + m(Theta). The gap between them is what ARBITER does not know.
 *
 * conflictMass is the cumulative conflict removed across all combination steps:
 * 1 - ∏(1 - Kᵢ), where Kᵢ is the conflict at step i. This is the honest
 * aggregate: because each step normalises by (1 - Kᵢ), multiplying the survival
 * factors gives the total survival probability, and 1 minus that is the true
 * conflict removed. It is strictly >= max(Kᵢ) and equals max only when at most
 * one step has nonzero conflict.
 */
export function fuse(masses: Mass[]): { belief: number; plausibility: number; conflictMass: number; mass: Mass } {
  let acc: Mass = { ...VACUOUS };
  let survival = 1; // prod(1 - K_i)
  for (const m of masses) {
    const { mass, conflict } = combine(acc, m);
    acc = mass;
    survival *= 1 - conflict;
  }
  return { belief: acc.toxic, plausibility: acc.toxic + acc.uncommitted, conflictMass: 1 - survival, mass: acc };
}
```

Add this test to `packages/engine/test/fuse.test.ts` — it is the case `max(K_i)` cannot satisfy:

```ts
  it("accumulates conflict across the fold rather than taking the maximum", () => {
    // Three mutually opposed sources at strength 0.6. Hand derivation:
    //   step 1: acc = {t .6, s 0,  u .4}         K1 = 0
    //   step 2: K2 = .6*.6 = .36, norm = .64  -> acc = {t .375, s .375, u .25}
    //   step 3: K3 = .375*.6 = .225, norm = .775
    //   survival = 1 * .64 * .775 = .496  ->  conflictMass = .504
    // max(K_i) = .36, so cumulative STRICTLY EXCEEDS the largest single pairwise
    // conflict. That inequality is the property a max() aggregate cannot satisfy.
    const r = fuse([claimToMass("toxic", 0.6), claimToMass("safe", 0.6), claimToMass("toxic", 0.6)]);
    expect(r.conflictMass).toBeCloseTo(0.504, 6);
    expect(r.conflictMass).toBeGreaterThan(0.36);
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/fuse.test.ts && npm run lint
```

Expected: PASS (8 tests), lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "Add Dempster-Shafer fusion with conflict mass surfaced

Mass is distributed over {toxic}, {safe}, and Theta, where Theta is
uncommitted mass - what a source genuinely cannot tell you. A silent source
contributes m(Theta) = 1, never a vote for safe, and there is an explicit
test asserting it does not move belief.

Conflict mass K is returned rather than normalised away, because a high K
means the sources genuinely disagree and that should widen the reported
range. Total conflict (K = 1) returns the vacuous mass instead of dividing
by zero, so the caller abstains rather than fabricating a verdict.

belief <= plausibility is a property test over 500 deterministic
pseudo-random mass assignments - no Math.random, even in tests.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: R1–R6 and the pre-registered ruleset file

**Files:**
- Create: `packages/engine/src/rules.ts`
- Create: `rules/ruleset-v1.0.json`
- Create: `apps/harness/src/hash.ts`
- Test: `packages/engine/test/rules.test.ts`

**Interfaces:**
- Consumes: `EvidenceClaim`, `Rule`, `RuleId`, `Ruleset`
- Produces:
  - `defeats(attacker: EvidenceClaim, target: EvidenceClaim, ruleset: Ruleset): { byRule: RuleId; rationale: string } | null`
  - `downweightFactor(claim: EvidenceClaim, ruleset: Ruleset): { factor: number; byRule: RuleId; rationale: string } | null`
  - `concordanceBoost(claims: EvidenceClaim[], ruleset: Ruleset): number`
  - `conflictsWith(a: EvidenceClaim, b: EvidenceClaim): boolean`

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/rules.test.ts`. Each test crafts a minimal pair where exactly one rule can decide.

```ts
import { describe, expect, it } from "vitest";
import { reason } from "../src/index.js";
import { concordanceBoost, conflictsWith, defeats, downweightFactor, relevanceDiscount } from "../src/rules.js";
import { RulesetSchema } from "../src/schema.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;

function claim(over: Partial<EvidenceClaim>): EvidenceClaim {
  return {
    id: "c", compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: true,
    inApplicabilityDomain: true, klimisch: 1, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "test", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("conflictsWith", () => {
  it("is true only for opposed committed assertions", () => {
    expect(conflictsWith(claim({ assertion: "toxic" }), claim({ assertion: "safe" }))).toBe(true);
    expect(conflictsWith(claim({ assertion: "toxic" }), claim({ assertion: "toxic" }))).toBe(false);
    expect(conflictsWith(claim({ assertion: "toxic" }), claim({ assertion: "ambiguous" }))).toBe(false);
  });

  it("never lets claims about DIFFERENT compounds conflict, or defeat each other", () => {
    // Every caller groups by compound before reasoning, so this cannot happen
    // today - but the failure it prevents is silent: a toxic finding on compound A
    // deleting a safe finding on compound B produces a confident verdict whose
    // trace reads perfectly plausible.
    const a = claim({ id: "a", compoundId: "DRUG-1", assertion: "toxic", system: "human" });
    const b = claim({ id: "b", compoundId: "DRUG-2", assertion: "safe", system: "rodent", stream: "invivo_rodent" });
    expect(conflictsWith(a, b)).toBe(false);
    // Same pair WOULD be an R1 defeat if they were about one compound, which is
    // what makes this a real guard rather than a vacuous assertion.
    expect(defeats(a, b, RS)).toBeNull();
    expect(defeats(a, { ...b, compoundId: "DRUG-1" }, RS)?.byRule).toBe("R1");
  });
});

describe("R1 human relevance", () => {
  it("human-cell evidence defeats rodent in vivo", () => {
    const human = claim({ id: "h", assertion: "toxic", system: "human" });
    const rat = claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent" });
    expect(defeats(human, rat, RS)?.byRule).toBe("R1");
    expect(defeats(rat, human, RS)).toBeNull();
  });

  it("does not fire between two human claims", () => {
    const a = claim({ id: "a", assertion: "toxic", system: "human" });
    const b = claim({ id: "b", assertion: "safe", system: "human" });
    expect(defeats(a, b, RS)?.byRule).not.toBe("R1");
  });
});

describe("R2 mechanistic proximity", () => {
  it("a measured key event defeats structural correlation only", () => {
    const mech = claim({ id: "m", assertion: "toxic", measuresKeyEvent: "KE:55", stream: "transporter" });
    const struct = claim({ id: "s", assertion: "safe", measuresKeyEvent: null, stream: "qsar", system: "human" });
    expect(defeats(mech, struct, RS)?.byRule).toBe("R2");
  });

  it("does not fire in reverse - structural correlation cannot outrank a measured key event", () => {
    // R2 was the only defeat rule with no reverse-direction test; R1, R3 and R5 all
    // had one. Same system on both sides so R1 cannot supply the asymmetry, equal
    // exposure and Klimisch so R3 and R5 cannot either.
    const mech = claim({ id: "m", assertion: "toxic", measuresKeyEvent: "KE:55", stream: "transporter", system: "human" });
    const struct = claim({ id: "s", assertion: "safe", measuresKeyEvent: null, stream: "qsar", system: "human" });
    expect(defeats(mech, struct, RS)?.byRule).toBe("R2");
    expect(defeats(struct, mech, RS)).toBeNull();
  });

  it("does not fire against apical in-vivo evidence merely because no key event is annotated", () => {
    // A 28-day repeat-dose study with no key event annotated is apical outcome
    // evidence, not a structural correlation. Same species on both sides so R1
    // cannot confound the result; equal exposure/klimisch so R3/R5 cannot either.
    const mech = claim({ id: "m", assertion: "toxic", measuresKeyEvent: "KE:12", stream: "transporter", system: "rodent" });
    const invivo = claim({ id: "iv", assertion: "safe", measuresKeyEvent: null, stream: "invivo_rodent", system: "rodent" });
    expect(defeats(mech, invivo, RS)).toBeNull();
  });
});

describe("R3 exposure relevance", () => {
  it("a positive at clinical exposure defeats a negative with untested margin", () => {
    const pos = claim({ id: "p", assertion: "toxic", exposureRelevant: true });
    const neg = claim({ id: "n", assertion: "safe", exposureRelevant: null });
    expect(defeats(pos, neg, RS)?.byRule).toBe("R3");
    expect(defeats(neg, pos, RS)).toBeNull();
  });
});

describe("R4 applicability domain", () => {
  it("downweights an out-of-domain claim without defeating it", () => {
    const out = claim({ inApplicabilityDomain: false });
    const r = downweightFactor(out, RS);
    expect(r?.byRule).toBe("R4");
    expect(r!.factor).toBeGreaterThan(0);
    expect(r!.factor).toBeLessThan(1);
  });

  it("leaves an in-domain claim alone", () => {
    expect(downweightFactor(claim({ inApplicabilityDomain: true }), RS)).toBeNull();
  });

  it("returns exactly 1 - strength, measured at a strength where that differs from strength itself", () => {
    // R4's registered strength is 0.5, and 1 - 0.5 === 0.5, so EVERY test using the
    // real ruleset passes whether the code computes `1 - strength` or `strength`.
    // Re-measure at 0.8, where the two answers are 0.2 and 0.8.
    const eighty: Ruleset = { ...RS, rules: RS.rules.map((r) => (r.id === "R4" ? { ...r, strength: 0.8 } : r)) };
    expect(downweightFactor(claim({ inApplicabilityDomain: false }), eighty)!.factor).toBeCloseTo(0.2, 12);
    // And confirm the real ruleset is the ambiguous case, so this test is not
    // duplicating one that already discriminates.
    expect(RS.rules.find((r) => r.id === "R4")!.strength).toBe(0.5);
  });

  it("treats a null applicability domain as benign, unlike R3's null exposure", () => {
    // The two rules read `null` in opposite directions and that asymmetry is
    // deliberate: an unassessed domain is not evidence of being outside it, while an
    // unestablished exposure margin IS the reason a negative licenses nothing.
    expect(downweightFactor(claim({ inApplicabilityDomain: null }), RS)).toBeNull();
    const nullExposureNegative = relevanceDiscount(claim({ assertion: "safe", exposureRelevant: null }), RS);
    expect(nullExposureNegative.reasons.map((r) => r.byRule)).toContain("R3");
  });
});

describe("R5 study reliability", () => {
  it("a more reliable study defeats a less reliable one at equal relevance (both key-event-null)", () => {
    const good = claim({ id: "g", assertion: "toxic", klimisch: 1 });
    const poor = claim({ id: "p", assertion: "safe", klimisch: 4 });
    expect(defeats(good, poor, RS)?.byRule).toBe("R5");
    expect(defeats(poor, good, RS)).toBeNull();
  });

  it("fires when key events match only after normalizing case and whitespace", () => {
    const good = claim({ id: "g", assertion: "toxic", klimisch: 1, measuresKeyEvent: "KE:55" });
    const poor = claim({ id: "p", assertion: "safe", klimisch: 4, measuresKeyEvent: " ke:55 " });
    expect(defeats(good, poor, RS)?.byRule).toBe("R5");
  });

  it("declines when the two claims measure genuinely different key events", () => {
    const good = claim({ id: "g", assertion: "toxic", klimisch: 1, measuresKeyEvent: "KE:55" });
    const poor = claim({ id: "p", assertion: "safe", klimisch: 4, measuresKeyEvent: "KE:99" });
    expect(defeats(good, poor, RS)).toBeNull();
  });
});

describe("R6 concordance", () => {
  it("rewards agreement across distinct streams, not within one", () => {
    const twoStreams = [claim({ id: "a", stream: "cytotox" }), claim({ id: "b", stream: "transporter" })];
    const oneStream = [claim({ id: "a", stream: "cytotox" }), claim({ id: "b", stream: "cytotox" })];
    expect(concordanceBoost(twoStreams, RS).boost).toBeGreaterThan(concordanceBoost(oneStream, RS).boost);
  });

  it("is independent of claim order", () => {
    const claims = [
      claim({ id: "a", stream: "cytotox", assertion: "toxic" }),
      claim({ id: "b", stream: "transporter", assertion: "toxic" }),
      claim({ id: "c", stream: "qsar", assertion: "safe" }),
    ];
    const shuffled = [claims[2]!, claims[0]!, claims[1]!];
    expect(concordanceBoost(shuffled, RS)).toEqual(concordanceBoost(claims, RS));
  });

  it("scores an exact 2-2 stream split as no boost, with no side supported, strictly below unanimity", () => {
    const split = [
      claim({ id: "a", stream: "cytotox", assertion: "toxic" }),
      claim({ id: "b", stream: "transporter", assertion: "toxic" }),
      claim({ id: "c", stream: "qsar", assertion: "safe" }),
      claim({ id: "d", stream: "toxicogenomics", assertion: "safe" }),
    ];
    const unanimous = [
      claim({ id: "a", stream: "cytotox", assertion: "toxic" }),
      claim({ id: "b", stream: "transporter", assertion: "toxic" }),
      claim({ id: "c", stream: "qsar", assertion: "toxic" }),
      claim({ id: "d", stream: "toxicogenomics", assertion: "toxic" }),
    ];
    const splitResult = concordanceBoost(split, RS);
    expect(splitResult.supports).toBeNull();
    expect(splitResult.boost).toBe(1);
    expect(splitResult.boost).toBeLessThan(concordanceBoost(unanimous, RS).boost);
  });

  it("still scores a single chatty stream at 1.0", () => {
    const oneStream = [claim({ id: "a", stream: "cytotox" }), claim({ id: "b", stream: "cytotox" })];
    expect(concordanceBoost(oneStream, RS).boost).toBe(1);
  });

  it("attenuates a near-even split without flattening it all the way to no boost", () => {
    const nearEven = [
      claim({ id: "a", stream: "cytotox", assertion: "toxic" }),
      claim({ id: "b", stream: "transporter", assertion: "toxic" }),
      claim({ id: "c", stream: "toxicogenomics", assertion: "toxic" }),
      claim({ id: "d", stream: "qsar", assertion: "safe" }),
      claim({ id: "e", stream: "invivo_rodent", assertion: "safe" }),
    ];
    const unanimous = [
      claim({ id: "a", stream: "cytotox", assertion: "toxic" }),
      claim({ id: "b", stream: "transporter", assertion: "toxic" }),
      claim({ id: "c", stream: "toxicogenomics", assertion: "toxic" }),
    ];
    const r = concordanceBoost(nearEven, RS);
    expect(r.supports).toBe("toxic");
    expect(r.boost).toBeGreaterThan(1);
    expect(r.boost).toBeLessThan(concordanceBoost(unanimous, RS).boost);
  });
});

describe("disabled rules", () => {
  /** The ruleset with exactly one rule turned off. */
  const without = (id: string): Ruleset =>
    ({ ...RS, rules: RS.rules.map((r) => (r.id === id ? { ...r, enabled: false } : r)) });

  it("a disabled rule never fires", () => {
    const human = claim({ id: "h", assertion: "toxic", system: "human", exposureRelevant: null, klimisch: 2 });
    const rat = claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", exposureRelevant: null, klimisch: 2 });
    expect(defeats(human, rat, without("R1"))?.byRule).not.toBe("R1");
  });

  // Coverage was uneven: only R1 had a disabled-path test, so five of the six
  // rules could have ignored `enabled` entirely. Each case below is built so the
  // named rule is the ONLY one that fires, then asserted to fall silent - which
  // also proves each pairing was reaching that rule in the first place.

  it("R2 disabled: a measured key event stops outranking structural correlation", () => {
    const mech = claim({ id: "m", assertion: "toxic", measuresKeyEvent: "KE:55", stream: "transporter", system: "human" });
    const struct = claim({ id: "s", assertion: "safe", measuresKeyEvent: null, stream: "qsar", system: "human" });
    expect(defeats(mech, struct, RS)?.byRule).toBe("R2");
    expect(defeats(mech, struct, without("R2"))).toBeNull();
  });

  it("R3 disabled: a positive at clinical exposure stops outranking an untested margin", () => {
    const pos = claim({ id: "p", assertion: "toxic", exposureRelevant: true });
    const neg = claim({ id: "n", assertion: "safe", exposureRelevant: null });
    expect(defeats(pos, neg, RS)?.byRule).toBe("R3");
    expect(defeats(pos, neg, without("R3"))).toBeNull();
  });

  it("R4 disabled: an out-of-domain claim is no longer downweighted or discounted", () => {
    const out = claim({ inApplicabilityDomain: false });
    expect(downweightFactor(out, RS)?.byRule).toBe("R4");
    expect(downweightFactor(out, without("R4"))).toBeNull();
    // R4 also reaches mass through relevanceDiscount, which is a separate call
    // site and therefore a separate chance to ignore `enabled`.
    expect(relevanceDiscount(out, RS).reasons.map((r) => r.byRule)).toContain("R4");
    expect(relevanceDiscount(out, without("R4")).reasons.map((r) => r.byRule)).not.toContain("R4");
  });

  it("R5 disabled: a more reliable study stops outranking a less reliable one", () => {
    const good = claim({ id: "g", assertion: "toxic", klimisch: 1 });
    const poor = claim({ id: "p", assertion: "safe", klimisch: 4 });
    expect(defeats(good, poor, RS)?.byRule).toBe("R5");
    expect(defeats(good, poor, without("R5"))).toBeNull();
  });

  it("R6 disabled: concordance reports no boost and supports no side", () => {
    const twoStreams = [
      claim({ id: "a", stream: "cytotox", assertion: "toxic" }),
      claim({ id: "b", stream: "transporter", assertion: "toxic" }),
    ];
    expect(concordanceBoost(twoStreams, RS).boost).toBeGreaterThan(1);
    expect(concordanceBoost(twoStreams, without("R6"))).toEqual({ supports: null, boost: 1 });
  });

  it("disabling a rule leaves a GAP a lower-precedence rule can fill, rather than reordering", () => {
    // R1 outranks R5 in the pre-registered order. With R1 off, the same pair must
    // still be decided - by R5 - rather than silently surviving. This is the
    // behaviour the docstring promises and nothing asserted it.
    const human = claim({ id: "h", assertion: "toxic", system: "human", klimisch: 1 });
    const rat = claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 4 });
    expect(defeats(human, rat, RS)?.byRule).toBe("R1");
    expect(defeats(human, rat, without("R1"))?.byRule).toBe("R5");
  });
});

describe("antisymmetry", () => {
  // Cross-product over every field a defeat rule reads. For every pair drawn
  // from it, at most one direction may be licensed as a defeat — never both.
  // This is the test class a "pick one rule per test" test file structurally
  // cannot express, and it is what caught the R1/R3 2-cycle.
  function* variants(): Generator<Pick<EvidenceClaim, "system" | "measuresKeyEvent" | "exposureRelevant" | "klimisch" | "stream">> {
    const systems: EvidenceClaim["system"][] = ["human", "rodent", "nonrodent", "in_silico"];
    const keyEvents: (string | null)[] = [null, "KE:1"];
    const exposures: (boolean | null)[] = [true, false, null];
    const klimischs: EvidenceClaim["klimisch"][] = [1, 4, null];
    const streams: EvidenceClaim["stream"][] = ["qsar", "cytotox"];
    for (const system of systems) {
      for (const measuresKeyEvent of keyEvents) {
        for (const exposureRelevant of exposures) {
          for (const klimisch of klimischs) {
            for (const stream of streams) {
              yield { system, measuresKeyEvent, exposureRelevant, klimisch, stream };
            }
          }
        }
      }
    }
  }

  it("defeats() never licenses both directions, for any combination of rule-relevant fields", () => {
    const vs = [...variants()];
    let checked = 0;
    for (const vi of vs) {
      for (const vj of vs) {
        const a = claim({ id: "a", assertion: "toxic", ...vi });
        const b = claim({ id: "b", assertion: "safe", ...vj });
        const forward = defeats(a, b, RS);
        const reverse = defeats(b, a, RS);
        if (forward !== null && reverse !== null) {
          throw new Error(
            `2-cycle: (${JSON.stringify(vi)}) vs (${JSON.stringify(vj)}) — forward=${forward.byRule}, reverse=${reverse.byRule}`,
          );
        }
        checked++;
      }
    }
    expect(checked).toBe(vs.length * vs.length);
  });

  it("the motivating fixture (human in-vitro, unstated exposure vs rodent in-vivo, clinical exposure) resolves to R3 one-way, not a cycle", () => {
    const humanInVitro = claim({
      id: "h", assertion: "safe", system: "human", stream: "cytotox",
      measuresKeyEvent: "KE:1", exposureRelevant: null,
    });
    const rodentInVivo = claim({
      id: "r", assertion: "toxic", system: "rodent", stream: "invivo_rodent",
      measuresKeyEvent: null, exposureRelevant: true,
    });
    expect(defeats(humanInVitro, rodentInVivo, RS)).toBeNull();
    expect(defeats(rodentInVivo, humanInVitro, RS)?.byRule).toBe("R3");
  });
});

describe("ruleset validity", () => {
  it("the pre-registered ruleset is schema-valid", () => {
    expect(() => RulesetSchema.parse(ruleset)).not.toThrow();
  });
});

describe("pre-registration", () => {
  it("no rule justification cites TAK-994", () => {
    // Scans the whole ruleset, not just rules[], so a stray top-level field
    // (e.g. precedenceRationale) can't slip a reference past this guard.
    const blob = JSON.stringify(RS).toLowerCase();
    expect(blob).not.toContain("tak-994");
    expect(blob).not.toContain("tak994");
  });
});

describe("relevanceDiscount", () => {
  it("leaves ideal evidence undiscounted", () => {
    const d = relevanceDiscount(claim({
      system: "human", stream: "cytotox", measuresKeyEvent: "KE:1",
      exposureRelevant: true, inApplicabilityDomain: true, klimisch: 1,
    }), RS);
    expect(d.factor).toBe(1);
    expect(d.reasons).toHaveLength(0);
  });

  it("discounts a clean rodent study whose exposure was never established", () => {
    // THE PASS-1 CASE. Unopposed, but it licenses very little.
    const d = relevanceDiscount(claim({
      system: "rodent", stream: "invivo_rodent", measuresKeyEvent: null,
      exposureRelevant: null, klimisch: 1,
    }), RS);
    expect(d.factor).toBeLessThan(0.2);
    expect(d.reasons.map((r) => r.byRule).sort()).toEqual(["R1", "R3"]);
  });

  it("compounds multiplicatively - the factor is exactly the product of (1 - strength)", () => {
    // `both < one` alone would also be satisfied by max() or by 1 - sum(). Assert
    // the actual product, read from the ruleset's own strengths rather than
    // hard-coded, so the test tracks a re-registration instead of breaking on one.
    const r1 = RS.rules.find((r) => r.id === "R1")!.strength;
    const r3 = RS.rules.find((r) => r.id === "R3")!.strength;
    const both = relevanceDiscount(claim({ system: "rodent", exposureRelevant: null }), RS).factor;
    const one = relevanceDiscount(claim({ system: "rodent", exposureRelevant: true }), RS).factor;
    expect(both).toBeCloseTo((1 - r1) * (1 - r3), 10);
    expect(one).toBeCloseTo(1 - r1, 10);
    expect(both).toBeLessThan(one);
  });

  it("moves discounted mass nowhere - it only reduces, never flips", () => {
    // The no-flip property is only OBSERVABLE on a mass, so assert it there. A
    // range check on the factor cannot see a flip at all: any implementation that
    // moved mass to the opposing side would still return a factor in (0,1).
    const discountedSafe = reason([claim({
      id: "s", assertion: "safe", strength: 0.9, system: "rodent",
      stream: "invivo_rodent", exposureRelevant: null, klimisch: 1,
    })], RS);
    expect(discountedSafe.mass.safe).toBeGreaterThan(0);
    expect(discountedSafe.mass.safe).toBeLessThan(0.9);
    expect(discountedSafe.mass.toxic).toBe(0);

    const discountedToxic = reason([claim({
      id: "t", assertion: "toxic", strength: 0.9, system: "rodent",
      stream: "invivo_rodent", exposureRelevant: null, klimisch: 3,
    })], RS);
    expect(discountedToxic.mass.toxic).toBeGreaterThan(0);
    expect(discountedToxic.mass.toxic).toBeLessThan(0.9);
    expect(discountedToxic.mass.safe).toBe(0);
  });

  it("applies R3 ONLY to negative findings - a positive hit is not discounted for margin", () => {
    // R3's registered statement is about negative findings. A hazard signal at an
    // unrecorded concentration is still a hazard signal; you go and measure the
    // margin next. An absence of signal at an unrecorded concentration licenses
    // nothing. If this test flips, every hazard call in the automated streams gets
    // crushed to 15% and the whole evaluation set abstains.
    const shared = { system: "human" as const, stream: "cytotox" as const, exposureRelevant: null, klimisch: 1 };
    expect(relevanceDiscount(claim({ ...shared, assertion: "safe" }), RS).reasons.map((r) => r.byRule)).toEqual(["R3"]);
    const positive = relevanceDiscount(claim({ ...shared, assertion: "toxic" }), RS);
    expect(positive.reasons).toHaveLength(0);
    expect(positive.factor).toBe(1);
  });

  it("still discounts a positive finding for every NON-directional weakness", () => {
    // The R3 carve-out must not become a blanket exemption for positives: a
    // low-reliability rodent hit is still weak evidence about humans.
    const d = relevanceDiscount(claim({
      assertion: "toxic", system: "rodent", stream: "invivo_rodent",
      exposureRelevant: null, klimisch: 3,
    }), RS);
    expect(d.reasons.map((r) => r.byRule).sort()).toEqual(["R1", "R5"]);
  });

  it("respects disabled rules", () => {
    const off: Ruleset = { ...RS, rules: RS.rules.map((r) => ({ ...r, enabled: false })) };
    expect(relevanceDiscount(claim({ system: "rodent", exposureRelevant: null }), off).factor).toBe(1);
  });

  it("reads strengths from the ruleset rather than hard-coding them", () => {
    const weak: Ruleset = { ...RS, rules: RS.rules.map((r) => r.id === "R1" ? { ...r, strength: 0.1 } : r) };
    const strong: Ruleset = { ...RS, rules: RS.rules.map((r) => r.id === "R1" ? { ...r, strength: 0.9 } : r) };
    const c = claim({ system: "rodent", exposureRelevant: true });
    expect(relevanceDiscount(c, weak).factor).toBeGreaterThan(relevanceDiscount(c, strong).factor);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/rules.test.ts
```

Expected: FAIL — cannot resolve `../src/rules.js` and `rules/ruleset-v1.0.json`

- [ ] **Step 3: Write the pre-registered ruleset**

Create `rules/ruleset-v1.0.json`. **No rule may cite TAK-994** — every `framework` field names a published source only.

```json
{
  "version": "1.0",
  "registeredAt": "2026-07-26",
  "abstentionGapThreshold": 0.5,
  "precedenceOrder": ["R3", "R1", "R2", "R5"],
  "precedenceRationale": "Earlier entries outrank later ones when two rules license opposite defeats. Exposure relevance (R3) outranks human relevance (R1) deliberately: a negative result carries weight only across the exposure range actually tested, so a clean human in-vitro panel at unstated exposure must not override an in-vivo positive at clinically relevant dose. R4 and R6 are absent because R4 downweights rather than defeats and R6 is a property of a set of claims rather than a pair.",
  "dilirankBinarisation": {
    "positive": ["vMost-DILI-Concern", "vLess-DILI-Concern"],
    "negative": ["vNo-DILI-Concern"],
    "excluded": ["Ambiguous-DILI-concern"]
  },
  "rules": [
    {
      "id": "R1",
      "name": "Human relevance",
      "statement": "Human-cell evidence defeats animal in vivo evidence when the question is human hepatotoxicity.",
      "framework": {
        "name": "FDA Roadmap to Reducing Animal Testing in Preclinical Safety Studies; FDA Modernization Act 2.0",
        "date": "2025-04",
        "note": "Agency direction toward human-relevant new approach methodologies as the preferred evidence source."
      },
      "enabled": true,
      "strength": 0.9
    },
    {
      "id": "R2",
      "name": "Mechanistic proximity",
      "statement": "Evidence that directly measures an adverse outcome pathway key event defeats evidence that only correlates with chemical structure.",
      "framework": {
        "name": "OECD Adverse Outcome Pathway framework; AOP-Wiki key event relationship confidence",
        "date": "standing",
        "note": "Key event relationships carry explicit confidence levels assessed on biological plausibility and empirical support."
      },
      "enabled": true,
      "strength": 0.85
    },
    {
      "id": "R3",
      "name": "Exposure relevance",
      "statement": "A positive finding at clinically relevant exposure defeats a negative finding whose exposure margin is unstated or untested at that range.",
      "framework": {
        "name": "ICH M3(R2) exposure-margin expectations; standard exposure-margin practice in regulatory toxicology",
        "date": "standing",
        "note": "A negative result carries weight only across the exposure range actually tested."
      },
      "enabled": true,
      "strength": 0.85
    },
    {
      "id": "R4",
      "name": "Applicability domain",
      "statement": "Evidence from a model operating outside its applicability domain is admitted with reduced weight, or excluded.",
      "framework": {
        "name": "OECD principles for the validation of QSAR models; standard QSAR regulatory acceptance criteria",
        "date": "standing",
        "note": "A prediction about a compound unlike the training set is a different kind of evidence."
      },
      "enabled": true,
      "strength": 0.5
    },
    {
      "id": "R5",
      "name": "Study reliability",
      "statement": "Higher-reliability studies defeat lower-reliability ones at equal mechanistic relevance.",
      "framework": {
        "name": "Klimisch et al. (1997) reliability scoring",
        "date": "1997",
        "note": "The standard reliability system used in regulatory toxicology submissions."
      },
      "enabled": true,
      "strength": 0.6
    },
    {
      "id": "R6",
      "name": "Concordance",
      "statement": "Independent sources agreeing raises confidence more than one source agreeing with itself.",
      "framework": {
        "name": "OECD weight-of-evidence and Integrated Approaches to Testing and Assessment guidance",
        "date": "standing",
        "note": "Formalised by the evidence fusion layer; independence is at the stream level."
      },
      "enabled": true,
      "strength": 0.4
    }
  ]
}
```

- [ ] **Step 3a: Extend the types and schema for `precedenceOrder`**

`Ruleset` in `packages/engine/src/types.ts` gains two fields:

```ts
  /** Defeat rules in precedence order, highest first. R4 downweights and R6 is a
   *  set property, so neither appears. Pre-registered and hashed — reordering this
   *  is how a toxicologist contests the preference ordering. */
  precedenceOrder: RuleId[];
  /** Why this order. Rendered in the UI beside the ordering. */
  precedenceRationale: string;
```

And `RulesetSchema` in `packages/engine/src/schema.ts` gains matching validation — an
array of exactly the four defeat-rule ids with no duplicates, and a non-empty string:

```ts
    precedenceOrder: z
      .array(z.enum(["R1", "R2", "R3", "R5"]))
      .length(4)
      .refine((ids) => new Set(ids).size === 4, { message: "precedenceOrder ids must be unique" }),
    precedenceRationale: z.string().min(1),
```

- [ ] **Step 4: Write `rules.ts`**

Create `packages/engine/src/rules.ts`:

```ts
import type { Assertion, DefeatRuleId, EvidenceClaim, RuleId, Ruleset } from "./types.js";

const ANIMAL_SYSTEMS = new Set(["rodent", "nonrodent"]);

function rule(ruleset: Ruleset, id: RuleId) {
  const r = ruleset.rules.find((x) => x.id === id);
  return r && r.enabled ? r : null;
}

/** Trim and lowercase a key-event id so "KE:55" and " ke:55 " compare equal. */
function normalizeKeyEvent(ke: string | null): string | null {
  return ke === null ? null : ke.trim().toLowerCase();
}

/** True only for evidence that is structural correlation, not apical/mechanistic evidence that simply lacks a key-event annotation. */
function isStructuralOnly(claim: EvidenceClaim): boolean {
  return claim.measuresKeyEvent === null && (claim.stream === "qsar" || claim.system === "in_silico");
}

/**
 * Two claims conflict only when both commit to opposite conclusions ABOUT THE
 * SAME COMPOUND.
 *
 * The compoundId guard is not decoration. Every caller today groups claims by
 * compound before calling `reason`, so it cannot fire - but nothing in the type
 * system says so, and the failure it prevents is silent and severe: a "toxic"
 * finding on compound A defeating a "safe" finding on compound B would delete a
 * live argument from an unrelated compound's verdict and the trace would read
 * perfectly plausible. Cheap guard, unbounded downside.
 */
export function conflictsWith(a: EvidenceClaim, b: EvidenceClaim): boolean {
  if (a.compoundId !== b.compoundId) return false;
  if (a.assertion === "ambiguous" || b.assertion === "ambiguous") return false;
  return a.assertion !== b.assertion;
}

type RuleHit = { rationale: string };

/**
 * Predicates for the four pairwise defeat rules. Each is precedence-agnostic
 * — it only decides whether `attacker` beats `target` *if this rule is
 * consulted at all*. Which rule gets consulted first, when more than one
 * would apply, is `ruleset.precedenceOrder` (see `bestRule`/`defeats` below).
 */
const RULE_PREDICATES: Record<DefeatRuleId, (attacker: EvidenceClaim, target: EvidenceClaim) => RuleHit | null> = {
  // Says "evidence" and not "in vivo evidence" deliberately. R1's registered
  // statement is phrased about animal in vivo evidence, but the predicate reads
  // `system`, which is orthogonal to in vivo/in vitro - a rodent hepatocyte assay
  // is system: "rodent", stream: "cytotox". Claiming "in vivo" in the rationale
  // would put a false statement about the study design into the trace a
  // toxicologist reads. Narrowing the PREDICATE to in vivo streams instead would
  // be a change to the registered rule, not a correction toward it, so the
  // rationale is what gets fixed.
  R1: (attacker, target) =>
    attacker.system === "human" && ANIMAL_SYSTEMS.has(target.system)
      ? { rationale: `Human-relevant evidence outranks ${target.system} evidence for a human endpoint.` }
      : null,

  R2: (attacker, target) =>
    attacker.measuresKeyEvent !== null && isStructuralOnly(target)
      ? { rationale: `Direct measurement of key event ${attacker.measuresKeyEvent} outranks structural correlation.` }
      : null,

  R3: (attacker, target) =>
    attacker.assertion === "toxic" &&
    attacker.exposureRelevant === true &&
    target.assertion === "safe" &&
    target.exposureRelevant !== true
      ? {
          rationale: "A positive at clinically relevant exposure outranks a negative whose margin was never tested at that range.",
        }
      : null,

  // Declines when the two claims measure different key events, deliberately:
  // reliability alone should not adjudicate between two mechanistically
  // distinct measurements, only between two readings of the same question.
  R5: (attacker, target) =>
    attacker.klimisch !== null &&
    target.klimisch !== null &&
    attacker.klimisch < target.klimisch &&
    normalizeKeyEvent(attacker.measuresKeyEvent) === normalizeKeyEvent(target.measuresKeyEvent)
      ? { rationale: `Klimisch ${attacker.klimisch} outranks Klimisch ${target.klimisch} at equal mechanistic relevance.` }
      : null,
};

/**
 * The highest-precedence rule (per `ruleset.precedenceOrder`) that licenses
 * `attacker` defeating `target`, or null if none applies. A disabled rule is
 * skipped entirely — never merely deprioritised — so it can still leave a
 * gap that a lower-precedence rule fills.
 */
function bestRule(
  attacker: EvidenceClaim,
  target: EvidenceClaim,
  ruleset: Ruleset,
): { byRule: DefeatRuleId; rationale: string } | null {
  for (const id of ruleset.precedenceOrder) {
    if (!rule(ruleset, id)) continue;
    const hit = RULE_PREDICATES[id](attacker, target);
    if (hit) return { byRule: id, ...hit };
  }
  return null;
}

/**
 * Rank of a rule in the preference ordering; lower outranks higher.
 *
 * Accepts any RuleId, not just a DefeatRuleId: R4 and R6 are legitimately absent
 * from `precedenceOrder` (R4 downweights, R6 is a set property) and both rank
 * last, which is the correct answer rather than an error. Exported because
 * argue.ts needs the same ordering to pick which of several surviving attackers
 * to report, and two copies of a ranking function is how the two drift apart.
 */
export function precedenceRank(id: RuleId, ruleset: Ruleset): number {
  const idx = (ruleset.precedenceOrder as RuleId[]).indexOf(id);
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
}

/**
 * Does `attacker` defeat `target`? Returns the deciding rule, or null.
 *
 * Each rule's predicate is individually asymmetric, but two different rules
 * can each license an attack in opposite directions on the same pair (e.g.
 * a human-relevant claim outranks an animal claim by R1, while the animal
 * claim simultaneously outranks the human claim by R3). `defeats` resolves
 * this by precedence: it computes the best rule in both directions and
 * lets the higher-precedence one win. A tie — including when the reverse
 * direction is licensed by a rule that is equal-or-better in precedence —
 * yields NO defeat, so both claims survive into fusion and the disagreement
 * shows up as conflict mass rather than an arbitrary winner.
 *
 * `ruleset.precedenceOrder` (R3 before R1 before R2 before R5, pre-registered)
 * is the preference ordering a toxicologist edits. R4 is not a defeat rule
 * (it downweights) and R6 is not pairwise (it is a set property), so neither
 * participates in precedence.
 */
export function defeats(
  attacker: EvidenceClaim,
  target: EvidenceClaim,
  ruleset: Ruleset,
): { byRule: RuleId; rationale: string } | null {
  if (attacker.id === target.id) return null;
  if (!conflictsWith(attacker, target)) return null;

  const forward = bestRule(attacker, target, ruleset);
  if (!forward) return null;

  const reverse = bestRule(target, attacker, ruleset);
  if (reverse && precedenceRank(reverse.byRule, ruleset) <= precedenceRank(forward.byRule, ruleset)) {
    return null;
  }

  return forward;
}

/**
 * R4: reduce the weight of an out-of-domain prediction rather than defeating it.
 *
 * WHY `=== false` HERE AND `!== true` IN R3. The two rules treat `null` in
 * opposite directions, and that asymmetry is deliberate rather than an oversight:
 *
 *   R3 (`exposureRelevant !== true`): null IS a weakness. "We never established
 *   the margin" and "we established it and the margin was bad" both mean a
 *   negative result licenses nothing about clinical safety. Absence of the
 *   measurement is itself the problem.
 *
 *   R4 (`inApplicabilityDomain === false`): null is BENIGN. "We could not assess
 *   the applicability domain" is not evidence the model was operating outside it.
 *   Penalising unassessed predictions would punish every source that simply does
 *   not report a domain check, which is most of them.
 *
 * The distinction is what the missing value is missing ABOUT: R3's null is a gap
 * in the evidence's own support, R4's is a gap in our knowledge of the tool.
 */
export function downweightFactor(
  claim: EvidenceClaim,
  ruleset: Ruleset,
): { factor: number; byRule: RuleId; rationale: string } | null {
  const r = rule(ruleset, "R4");
  if (!r) return null;
  if (claim.inApplicabilityDomain !== false) return null;
  return {
    factor: 1 - r.strength,
    byRule: "R4",
    rationale: "Prediction falls outside the model's applicability domain; admitted with reduced weight.",
  };
}

export interface Discount {
  /** Multiplier in (0,1] applied to the claim's committed mass. */
  factor: number;
  /** Which principles reduced it, for the trace. Empty when factor is 1. */
  reasons: { byRule: RuleId; rationale: string }[];
}

/**
 * How much does this claim's committed mass survive, absent any conflict?
 *
 * R1-R6 are tie-breakers when evidence collides. They are ALSO statements about
 * evidence quality, and quality matters even when nothing disagrees. A clean
 * rodent study is weak evidence about a human endpoint whether or not anything
 * contradicts it; a margin never measured at clinical exposure does not become
 * informative just because no one challenged it.
 *
 * Discounted mass moves to Theta - uncommitted - because that is precisely what
 * it is: mass this source cannot commit anywhere. It does NOT move to the
 * opposing side. Weak evidence for safety is not evidence of toxicity.
 *
 * Multiplicative, so several weaknesses compound: a rodent study whose exposure
 * was never established is weaker than either flaw alone.
 *
 * Each factor is 1 - rule.strength, so a toxicologist tunes discounting by
 * editing the same pre-registered, hashed strengths that govern defeats. One
 * number per principle, one meaning, two mechanisms.
 */
export function relevanceDiscount(claim: EvidenceClaim, ruleset: Ruleset): Discount {
  const reasons: Discount["reasons"] = [];
  let factor = 1;

  const apply = (id: RuleId, rationale: string) => {
    const r = rule(ruleset, id);
    if (!r) return;
    // Clamped for the same reason claimToMass clamps: a schema-invalid ruleset
    // must not be able to produce a negative belief, and reason() does not
    // validate its ruleset on every call (it is invoked thousands of times in
    // robustness sampling).
    factor *= Math.min(1, Math.max(0, 1 - r.strength));
    reasons.push({ byRule: id, rationale });
  };

  // R1: non-human evidence about a human endpoint.
  if (claim.system === "rodent" || claim.system === "nonrodent") {
    apply("R1", `${claim.system} evidence is indirect for a human endpoint.`);
  }
  // R2: structural correlation rather than a measured key event. isStructuralOnly
  // already requires measuresKeyEvent === null, so no second key-event test is
  // needed - an earlier draft had one and it could never be false.
  if (isStructuralOnly(claim)) {
    apply("R2", "Correlates with chemical structure; measures no key event directly.");
  }
  // R3: a NEGATIVE finding whose exposure margin was never established.
  //
  // R3 is the ONLY directional rule, and it is directional in its own
  // pre-registered statement: "A positive finding at clinically relevant
  // exposure defeats A NEGATIVE FINDING whose exposure margin is unstated or
  // untested at that range." R1, R2, R4 and R5 describe what KIND of evidence
  // this is, so they apply whichever way the claim points. R3 describes what a
  // result can LICENSE, and that is asymmetric: a positive hit is informative
  // whatever the margin - you go and establish the margin next - whereas an
  // absence of signal at an unknown concentration licenses nothing about
  // safety. Applying R3 to positives as well would have crushed every hazard
  // finding in the automated streams, where the margin is almost never
  // recorded, and abstained on essentially the whole evaluation set.
  if (claim.assertion === "safe" && claim.exposureRelevant !== true) {
    apply("R3", claim.exposureRelevant === false
      ? "A negative result from testing outside the clinically relevant exposure range."
      : "A negative result whose exposure margin relative to the clinical range was never established.");
  }
  // R4: outside the model's applicability domain. Already the existing behaviour.
  if (claim.inApplicabilityDomain === false) {
    apply("R4", "Model was operating outside its applicability domain.");
  }
  // R5: low study reliability. Klimisch 1 and 2 are reliable; 3 and 4 are not.
  if (claim.klimisch !== null && claim.klimisch >= 3) {
    apply("R5", `Klimisch ${claim.klimisch} indicates limited study reliability.`);
  }

  return { factor, reasons };
}

/**
 * R6: a multiplier rewarding agreement across DISTINCT streams, attenuated
 * by dissent.
 *
 * Counting claims would reward a chatty source; counting distinct streams
 * rewards genuine independence, which is what weight-of-evidence means. But
 * counting only the majority's streams (as if the minority didn't exist)
 * would let a 2-2 split score as high as unanimity — so the boost is scaled
 * down by how close the split is, reaching no boost at all (1) at an exact
 * tie. `supports` reports which side the concordance favors, so a caller
 * can't accidentally apply a boost computed from one cluster to the other
 * cluster's belief.
 *
 * DIAGNOSTIC ONLY - this is deliberately NOT applied to any mass. Concordance is
 * already realised by Dempster's rule of combination in fuse(); applying a second
 * multiplicative boost on top double-counted it and could invert a verdict. Kept
 * because "how many independent streams concur, and on which side" is worth
 * REPORTING to a reviewer. If you are about to multiply a mass by this, don't.
 *
 * ON THE 0.25. It was previously flagged that this coefficient sits in source
 * rather than in the pre-registered, hashed ruleset, so "where did 0.25 come
 * from?" had no answer. That objection is DISCHARGED BY THE DEMOTION rather than
 * by registering a number: an unregistered constant matters when it can move a
 * verdict, and this one no longer touches a verdict, a mass or a metric. It scales
 * a reported diagnostic only. Registering it would imply the ruleset governs it,
 * which would be the opposite of true - and it cannot be added anyway without
 * invalidating the pre-registration hash.
 *
 * KNOWN LIMITATION, carried to Task 12: independence is proxied by `stream`, and
 * Tox21 supplies BOTH the cytotox and transporter streams. Two readouts from one
 * assay platform therefore count as two independent sources here. Since this
 * function is diagnostic-only the mis-count cannot reach a verdict, but a reviewer
 * reading the reported concordance should know it overstates independence for
 * Tox21-derived claims.
 */
export function concordanceBoost(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
): { supports: Assertion | null; boost: number } {
  const r = rule(ruleset, "R6");
  if (!r || claims.length === 0) return { supports: null, boost: 1 };

  const committed = claims.filter((c) => c.assertion !== "ambiguous");
  if (committed.length === 0) return { supports: null, boost: 1 };

  const distinctStreams = (assertion: Assertion) =>
    new Set(committed.filter((c) => c.assertion === assertion).map((c) => c.stream)).size;

  const toxicStreams = distinctStreams("toxic");
  const safeStreams = distinctStreams("safe");

  if (toxicStreams === safeStreams) return { supports: null, boost: 1 };

  const supports: Assertion = toxicStreams > safeStreams ? "toxic" : "safe";
  const majorityStreams = Math.max(toxicStreams, safeStreams);
  const minorityStreams = Math.min(toxicStreams, safeStreams);

  const rawBoost = 1 + r.strength * Math.max(0, majorityStreams - 1) * 0.25;
  const dominance = (majorityStreams - minorityStreams) / (majorityStreams + minorityStreams);

  return { supports, boost: 1 + (rawBoost - 1) * dominance };
}
```

- [ ] **Step 5: Write the hash utility (harness side, so the engine stays crypto-free)**

Create `apps/harness/package.json`:

```json
{
  "name": "@arbiter/harness",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": { "@arbiter/engine": "1.0.0", "zod": "^3.23.8" }
}
```

Create `apps/harness/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "references": [{ "path": "../../packages/engine" }],
  "include": ["src/**/*"]
}
```

Create `apps/harness/src/hash.ts`:

```ts
import { createHash } from "node:crypto";

/**
 * SHA-256 of the pre-registration surface of a ruleset.
 *
 * Hashes only the fields a toxicologist pre-registers - rules, thresholds,
 * binarisation policy - with object keys sorted, so the hash is stable
 * against JSON formatting and against fields we add later for display.
 */
export function rulesetHash(ruleset: unknown): string {
  return createHash("sha256").update(canonical(ruleset)).digest("hex");
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`).join(",")}}`;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm install && npm test -- packages/engine/test/rules.test.ts && npm run lint
```

Expected: PASS (11 tests), lint clean. The `no rule justification cites TAK-994` test is the one that keeps the circularity fix honest.

- [ ] **Step 7: Commit the ruleset separately, and record the timestamp**

The pre-registration claim rests on this commit existing before any evaluation. Commit it on its own so the git history shows it unambiguously.

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && git add rules/ruleset-v1.0.json && git commit -m "Pre-register ruleset v1.0 before any evaluation

R1-R6, the abstention gap threshold (0.50), and the DILIrank binarisation
policy, committed before any benchmark has been run. This commit is the
pre-registration; its timestamp and the file's SHA-256 are the answer to
'did you tune the rules to fit DILIrank'.

Every rule justification cites a published framework only. No rule cites
TAK-994 - deriving a rule from the hero case and then demonstrating the rule
on that case would be circular, and an automated test now asserts the
absence.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" && git rev-parse HEAD && git log -1 --format=%cI
```

Record the printed commit hash and ISO timestamp — they go on the Validation tab in Phase 2.

```bash
git add packages/engine apps/harness package-lock.json && git commit -m "Add R1-R6 predicates and the ruleset hash utility

Rules are checked in precedence order inside defeats(), so the ordering in
that function IS the preference ordering a toxicologist edits. R4 downweights
rather than defeating; R6 is a set property over distinct streams, so a
chatty single source cannot manufacture concordance.

rulesetHash lives in the harness rather than the engine, keeping node:crypto
out of the engine's import surface. It canonicalises with sorted keys so the
hash is stable against JSON formatting.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Defeasible argumentation with reinstatement

**This task is what earns the word "argumentation."** A flat decision table cannot express reinstatement — A defeats B, C defeats A, therefore B comes back. If this is not implemented, calling the system defeasible argumentation is overselling and a technical judge would be right to call it a lookup table with extra steps.

**Files:**
- Create: `packages/engine/src/argue.ts`
- Test: `packages/engine/test/argue.test.ts`

**Interfaces:**
- Consumes: `defeats`, `downweightFactor` from `rules.ts`; `EvidenceClaim`, `Ruleset`, `ClaimStatus`, `TraceStep`, `RuleId`
- Produces:
  - `interface Attack { attackerId: string; targetId: string; byRule: RuleId; rationale: string }`
  - `interface Argumentation { statuses: Map<string, ClaimStatus>; attacks: Attack[]; trace: TraceStep[] }`
  - `argue(claims: EvidenceClaim[], ruleset: Ruleset): Argumentation`

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/argue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { argue } from "../src/argue.js";
import { defeats } from "../src/rules.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "test", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("argue", () => {
  it("admits an unopposed claim", () => {
    const r = argue([claim({ id: "a", assertion: "toxic" })], RS);
    expect(r.statuses.get("a")).toBe("admitted");
    expect(r.attacks).toHaveLength(0);
  });

  it("defeats the loser of a one-way attack", () => {
    // Human toxic defeats rodent safe by R1. Rodent cannot attack back.
    const human = claim({ id: "h", assertion: "toxic", system: "human", klimisch: 1 });
    const rat = claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 2 });
    const r = argue([human, rat], RS);
    expect(r.statuses.get("h")).toBe("admitted");
    expect(r.statuses.get("r")).toBe("defeated");
    expect(r.attacks).toEqual([
      expect.objectContaining({ attackerId: "h", targetId: "r", byRule: "R1" }),
    ]);
  });

  it("REINSTATEMENT: A defeats B, C defeats A, therefore B is reinstated", () => {
    // A: human cytotox, toxic, no key event, Klimisch 3  -> defeats B by R1
    // B: rat in vivo, safe, no key event, Klimisch 2
    // C: human toxicogenomics, safe, no key event, Klimisch 1 -> defeats A by R5
    //    (same null key event as A, strictly better reliability).
    // C does not conflict with B (both safe), so B's only attacker is A.
    const A = claim({ id: "A", assertion: "toxic", system: "human", stream: "cytotox", measuresKeyEvent: null, klimisch: 3 });
    const B = claim({ id: "B", assertion: "safe", system: "rodent", stream: "invivo_rodent", measuresKeyEvent: null, klimisch: 2 });
    const C = claim({ id: "C", assertion: "safe", system: "human", stream: "toxicogenomics", measuresKeyEvent: null, klimisch: 1 });

    const r = argue([A, B, C], RS);

    expect(r.statuses.get("C")).toBe("admitted");
    expect(r.statuses.get("A")).toBe("defeated");
    // The whole point: B was defeated by A, but A fell, so B comes back.
    expect(r.statuses.get("B")).toBe("admitted");

    const bStep = r.trace.find((s) => s.claimId === "B")!;
    expect(bStep.rationale).toMatch(/reinstat/i);
  });

  it("admits BOTH when no rule can separate two opposed claims", () => {
    // Equal Klimisch, same system, same key-event status, same exposure status:
    // no rule fires in either direction, so there is no attack at all. The
    // genuine conflict is expressed downstream instead - both survive into
    // fusion, the opposing masses produce conflict mass K > 0, and reason()
    // marks the case contested.
    const a = claim({ id: "a", assertion: "toxic", klimisch: 2 });
    const b = claim({ id: "b", assertion: "safe", klimisch: 2 });
    const r = argue([a, b], RS);
    expect(r.attacks).toHaveLength(0);
    expect(r.statuses.get("a")).toBe("admitted");
    expect(r.statuses.get("b")).toBe("admitted");
  });

  it("never produces a 2-cycle, because defeats() is antisymmetric", () => {
    // Task 4's antisymmetry fix makes a reciprocal pair impossible: awarding a
    // defeat requires the attacker's best rule to STRICTLY outrank the target's,
    // and two claims cannot each strictly outrank the other.
    //
    // Asserted over a cross-product rather than one crafted pair, because the
    // original single-rule-per-test design was structurally blind to exactly
    // this defect and shipped a mutual defeat on the demo's flagship case.
    const systems = ["human", "rodent", "nonrodent", "in_silico"] as const;
    const kes = [null, "KE:1", "KE:2"] as const;
    const exposures = [null, true, false] as const;
    const klimischs = [1, 2, 4] as const;

    const built: EvidenceClaim[] = [];
    let n = 0;
    for (const system of systems)
      for (const measuresKeyEvent of kes)
        for (const exposureRelevant of exposures)
          for (const klimisch of klimischs)
            for (const assertion of ["toxic", "safe"] as const)
              built.push(claim({
                id: `x${n++}`, assertion, system, measuresKeyEvent,
                exposureRelevant, klimisch,
                stream: system === "in_silico" ? "qsar" : "cytotox",
              }));

    for (const a of built) {
      for (const b of built) {
        if (a.id === b.id) continue;
        const forward = defeats(a, b, RS);
        const reverse = defeats(b, a, RS);
        if (forward && reverse) {
          throw new Error(
            `Mutual defeat: ${a.id} beats ${b.id} by ${forward.byRule} while ` +
            `${b.id} beats ${a.id} by ${reverse.byRule}`,
          );
        }
      }
    }
  });

  it("terminates and leaves a genuine 4-cycle's members UNDECIDED rather than looping", () => {
    // 2-cycles are impossible (see the antisymmetry test above), but the attack
    // graph is BIPARTITE - attacks only ever cross the toxic/safe divide, since
    // conflictsWith() requires opposite assertions - so every cycle has even
    // length, and a 4-cycle is NOT excluded by antisymmetry alone: antisymmetry
    // only forbids a and b each defeating the other directly, it says nothing
    // about a -> b -> c -> d -> a.
    //
    // This is a REAL cycle against the actual R1-R6 ruleset (RS), constructed
    // by hand-tracing defeats() with precedenceOrder = ["R3","R1","R2","R5"]:
    //   a (toxic, human,    klimisch 4) --R1--> b (safe, rodent,    klimisch 1)
    //   b (safe,  rodent,   klimisch 1) --R5--> c (toxic, nonrodent, klimisch 2)
    //   c (toxic, nonrodent,klimisch 2) --R5--> d (safe, in_silico, klimisch 3)
    //   d (safe,  in_silico,klimisch 3) --R5--> a (toxic, human,    klimisch 4)
    // a beats b via R1 (human outranks animal) regardless of Klimisch, because
    // R1 outranks R5 in precedence - so b's much-better Klimisch never gets a
    // chance to reverse it. The other three edges are plain R5 (better Klimisch
    // wins at equal - here, matching null - key event), each one-directional
    // because the target's Klimisch is never better than its attacker's. No
    // other pair among these four conflicts (a/c are both toxic, b/d are both
    // safe), so this is exactly a 4-cycle with no extra edges.
    //
    // Grounded semantics leaves every member of such a cycle UNDECIDED, which
    // reason() maps to uncommitted mass. This test proves that branch is live
    // code reachable from the real ruleset, and that the fixpoint terminates
    // instead of looping forever on it.
    const a = claim({ id: "a", assertion: "toxic", system: "human", klimisch: 4 });
    const b = claim({ id: "b", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 1 });
    const c = claim({ id: "c", assertion: "toxic", system: "nonrodent", stream: "invivo_nonrodent", klimisch: 2 });
    const d = claim({ id: "d", assertion: "safe", system: "in_silico", stream: "qsar", klimisch: 3 });

    const r = argue([a, b, c, d], RS);

    expect(r.trace).toHaveLength(4);
    for (const id of ["a", "b", "c", "d"]) {
      expect(r.statuses.get(id)).toBe("undecided");
    }
  });

  it("admits everything when the whole ruleset is disabled", () => {
    // The floor case: a fully disabled ruleset is a no-op, not a crash. Also the
    // mechanism behind live rule editing in Phase 2 - a toxicologist switching
    // R1 off must get a coherent verdict, not an exception.
    const off: Ruleset = { ...RS, rules: RS.rules.map((r) => ({ ...r, enabled: false })) };
    const a = claim({ id: "a", assertion: "toxic", system: "human", klimisch: 1 });
    const b = claim({ id: "b", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 4 });
    const r = argue([a, b], off);
    expect(r.attacks).toHaveLength(0);
    expect(r.statuses.get("a")).toBe("admitted");
    expect(r.statuses.get("b")).toBe("admitted");
  });

  it("marks an out-of-domain claim downweighted, not defeated", () => {
    const r = argue([claim({ id: "q", stream: "qsar", system: "in_silico", inApplicabilityDomain: false })], RS);
    expect(r.statuses.get("q")).toBe("downweighted");
    expect(r.trace.find((s) => s.claimId === "q")?.byRule).toBe("R4");
  });

  it("emits exactly one trace step per claim", () => {
    const claims = ["a", "b", "c"].map((id) => claim({ id, assertion: id === "a" ? "toxic" : "safe" }));
    const r = argue(claims, RS);
    expect(r.trace.map((s) => s.claimId).sort()).toEqual(["a", "b", "c"]);
  });

  it("is order-independent", () => {
    const A = claim({ id: "A", assertion: "toxic", system: "human", klimisch: 1 });
    const B = claim({ id: "B", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 2 });
    const fwd = argue([A, B], RS);
    const rev = argue([B, A], RS);
    expect(fwd.statuses.get("A")).toBe(rev.statuses.get("A"));
    expect(fwd.statuses.get("B")).toBe(rev.statuses.get("B"));
  });

  it("attributes a defeat to the STRONGEST surviving attacker, independent of input order", () => {
    // X is attacked by two claims that both survive (neither Y nor Z is itself
    // defeated), via two different rules of different precedence:
    //   Y: human vs. X's rodent system -> beats X by R1 (precedence rank 1).
    //   Z: far better Klimisch, same (null) key event -> beats X by R5 (rank 3).
    // R1 outranks R5, so X's trace must always credit Y, never Z - regardless
    // of which order Y and Z appear in the input array. A naive
    // `incoming.find(...)` would instead credit whichever of Y/Z happened to
    // be pushed into the attacker list first, which tracks input order, not
    // rule strength - exactly the bug this test exists to catch.
    const X = claim({ id: "X", assertion: "toxic", system: "rodent", stream: "invivo_rodent", klimisch: 4 });
    const Y = claim({ id: "Y", assertion: "safe", system: "human", klimisch: 4 });
    const Z = claim({ id: "Z", assertion: "safe", system: "nonrodent", stream: "invivo_nonrodent", klimisch: 1 });

    const sortByClaimId = (r: ReturnType<typeof argue>) => [...r.trace].sort((a, b) => a.claimId.localeCompare(b.claimId));

    const orderA = argue([X, Y, Z], RS);
    const orderB = argue([Z, Y, X], RS);
    const orderC = argue([Y, X, Z], RS);

    // Sanity: this is actually the scenario intended - X defeated, credited to Y by R1.
    expect(orderA.statuses.get("X")).toBe("defeated");
    expect(orderA.statuses.get("Y")).toBe("admitted");
    expect(orderA.statuses.get("Z")).toBe("admitted");
    const xStep = orderA.trace.find((s) => s.claimId === "X")!;
    expect(xStep.byRule).toBe("R1");
    expect(xStep.defeatedBy).toBe("Y");

    // Content, not emission order, must be identical across input orderings.
    expect(sortByClaimId(orderB)).toEqual(sortByClaimId(orderA));
    expect(sortByClaimId(orderC)).toEqual(sortByClaimId(orderA));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/argue.test.ts
```

Expected: FAIL — `Cannot find module '../src/argue.js'`

- [ ] **Step 3: Write the implementation**

Create `packages/engine/src/argue.ts`:

```ts
import { defeats, downweightFactor, precedenceRank } from "./rules.js";
import type { ClaimStatus, EvidenceClaim, RuleId, Ruleset, TraceStep } from "./types.js";

export interface Attack {
  attackerId: string;
  targetId: string;
  byRule: RuleId;
  rationale: string;
}

export interface Argumentation {
  statuses: Map<string, ClaimStatus>;
  attacks: Attack[];
  trace: TraceStep[];
}

/**
 * Defeasible argumentation under grounded semantics.
 *
 * The attack graph is induced by the preference ordering in rules.ts. We then
 * compute the grounded extension by the standard characteristic-function
 * fixpoint: a claim is IN when every one of its attackers is OUT, and OUT when
 * some IN claim attacks it. Iterating to a fixpoint is what produces
 * REINSTATEMENT for free - if A defeats B and C defeats A, then C goes IN, A
 * goes OUT, and on the next pass B's only attacker is OUT so B goes back IN.
 *
 * Claims that never settle are UNDECIDED. That is a real state, not a bug: two
 * equally-ranked opposed sources is genuine conflict, and the honest answer is
 * that neither wins.
 */
export function argue(claims: EvidenceClaim[], ruleset: Ruleset): Argumentation {
  const attacks: Attack[] = [];
  for (const attacker of claims) {
    for (const target of claims) {
      const d = defeats(attacker, target, ruleset);
      if (d) attacks.push({ attackerId: attacker.id, targetId: target.id, byRule: d.byRule, rationale: d.rationale });
    }
  }

  const attackersOf = new Map<string, Attack[]>();
  for (const c of claims) attackersOf.set(c.id, []);
  for (const a of attacks) attackersOf.get(a.targetId)!.push(a);

  /** Bind the shared ranking to this ruleset. Imported from rules.ts rather than
   * re-implemented: the two copies were identical, and an ordering that exists
   * twice is an ordering that eventually disagrees with itself. */
  const rank = (byRule: RuleId): number => precedenceRank(byRule, ruleset);

  /**
   * Among several surviving attackers of a defeated claim, pick the one to
   * report as "the" defeater deterministically - by strength of defeat
   * (highest-precedence rule), not by array/input position. Ties break on
   * attackerId. This is more than tie-breaking for its own sake: the most
   * informative thing to show a toxicologist is the STRONGEST reason a claim
   * fell, and that must not depend on the order evidence happened to load in.
   */
  function strongestKiller(survivors: Attack[]): Attack {
    return survivors.reduce((best, cand) => {
      const bestRank = rank(best.byRule);
      const candRank = rank(cand.byRule);
      if (candRank !== bestRank) return candRank < bestRank ? cand : best;
      return cand.attackerId < best.attackerId ? cand : best;
    });
  }

  const IN = new Set<string>();
  const OUT = new Set<string>();
  const settled = (id: string) => IN.has(id) || OUT.has(id);

  // Fixpoint. Bounded by claims.length iterations - each pass settles at least
  // one claim or we stop, so this cannot loop forever.
  for (let pass = 0; pass <= claims.length; pass++) {
    const newlyIn = claims
      .filter((c) => !settled(c.id))
      .filter((c) => attackersOf.get(c.id)!.every((a) => OUT.has(a.attackerId)))
      .map((c) => c.id);
    if (newlyIn.length === 0) break;
    for (const id of newlyIn) IN.add(id);

    for (const c of claims) {
      if (settled(c.id)) continue;
      if (attackersOf.get(c.id)!.some((a) => IN.has(a.attackerId))) OUT.add(c.id);
    }
  }

  const statuses = new Map<string, ClaimStatus>();
  const trace: TraceStep[] = [];

  for (const c of claims) {
    const incoming = attackersOf.get(c.id)!;

    if (OUT.has(c.id)) {
      const killer = strongestKiller(incoming.filter((a) => IN.has(a.attackerId)));
      statuses.set(c.id, "defeated");
      trace.push({
        claimId: c.id,
        status: "defeated",
        byRule: killer.byRule,
        defeatedBy: killer.attackerId,
        rationale: killer.rationale,
      });
      continue;
    }

    if (!IN.has(c.id)) {
      statuses.set(c.id, "undecided");
      trace.push({
        claimId: c.id,
        status: "undecided",
        rationale:
          "Caught in a cycle of mutual defeats: this claim is attacked, and every " +
          "attacker is itself attacked from within the same cycle, so grounded " +
          "semantics never settles whether any of them stands. Not 'outranked' - no " +
          "rule ever wins the comparison. Contributes uncommitted mass only.",
      });
      continue;
    }

    // IN. Two sub-cases: R4 downweighting, and reinstatement.
    const dw = downweightFactor(c, ruleset);
    if (dw) {
      statuses.set(c.id, "downweighted");
      trace.push({ claimId: c.id, status: "downweighted", byRule: dw.byRule, rationale: dw.rationale });
      continue;
    }

    statuses.set(c.id, "admitted");
    const wasAttacked = incoming.length > 0;
    trace.push({
      claimId: c.id,
      status: "admitted",
      rationale: wasAttacked
        ? `Reinstated: attacked by ${incoming.map((a) => a.attackerId).join(", ")}, but every attacker was itself defeated.`
        : "Admitted; unchallenged.",
    });
  }

  return { statuses, attacks, trace };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/argue.test.ts && npm run lint
```

Expected: PASS (10 tests), lint clean. The antisymmetry cross-product test is the
important one — it is the class of check whose absence let a mutual defeat ship on
the demo's flagship case in Task 4.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "Add defeasible argumentation with reinstatement

Grounded semantics over the attack graph induced by R1-R6, computed as a
characteristic-function fixpoint. Reinstatement falls out of the iteration
rather than being special-cased: if A defeats B and C defeats A, then C goes
IN, A goes OUT, and on the next pass B's only attacker is OUT so B returns.
There is an explicit test for exactly that chain, because reinstatement is
what distinguishes argumentation from a decision table.

UNDECIDED is a real status, not an error path - two equally-ranked opposed
sources is genuine conflict, and the honest output is that neither wins. Those
claims contribute uncommitted mass only.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Abstention, conflict detection, and enforced determinism

**Files:**
- Create: `packages/engine/src/abstain.ts`, `packages/engine/src/conflict.ts`
- Test: `packages/engine/test/abstain.test.ts`, `packages/engine/test/conflict.test.ts`

**Interfaces:**
- Consumes: `EvidenceClaim`, `Ruleset`, `ClaimStatus`
- Produces:
  - `shouldAbstain(input: { belief: number; plausibility: number; conflictMass: number; statuses: Map<string, ClaimStatus>; claims: EvidenceClaim[]; ruleset: Ruleset }): { abstain: boolean; reason: string | null }`
  - `detectConflict(claims: EvidenceClaim[]): { conflicting: boolean; opposedStreams: string[] }`

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/abstain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldAbstain } from "../src/abstain.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { ClaimStatus, EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;
const base = { statuses: new Map<string, ClaimStatus>(), claims: [] as EvidenceClaim[], ruleset: RS };

function cl(
  id: string,
  stream: EvidenceClaim["stream"],
  assertion: EvidenceClaim["assertion"],
  inApplicabilityDomain: boolean | null,
): EvidenceClaim {
  return {
    id, compoundId: "X", stream, assertion, strength: 0.8, system: "human",
    measuresKeyEvent: null, exposureRelevant: null, inApplicabilityDomain,
    klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
  };
}

describe("shouldAbstain", () => {
  it("abstains when the gap exceeds the pre-registered threshold", () => {
    // threshold is 0.50; gap here is 0.70
    const r = shouldAbstain({ ...base, belief: 0.1, plausibility: 0.8, conflictMass: 0 });
    expect(r.abstain).toBe(true);
    expect(r.reason).toMatch(/gap/i);
  });

  it("does NOT abstain one step below the threshold", () => {
    const r = shouldAbstain({ ...base, belief: 0.2, plausibility: 0.69, conflictMass: 0 });
    expect(r.abstain).toBe(false);
    expect(r.reason).toBeNull();
  });

  it("uses the threshold from the ruleset, not a hard-coded constant", () => {
    const strict: Ruleset = { ...RS, abstentionGapThreshold: 0.05 };
    const r = shouldAbstain({ ...base, belief: 0.4, plausibility: 0.5, conflictMass: 0, ruleset: strict });
    expect(r.abstain).toBe(true);
  });

  it("abstains on total conflict", () => {
    const r = shouldAbstain({ ...base, belief: 0, plausibility: 1, conflictMass: 1 });
    expect(r.abstain).toBe(true);
    expect(r.reason).toMatch(/conflict/i);
  });

  it("abstains when every committed claim is out of its applicability domain", () => {
    const claims: EvidenceClaim[] = [{
      id: "q", compoundId: "X", stream: "qsar", assertion: "toxic", strength: 0.9,
      system: "in_silico", measuresKeyEvent: null, exposureRelevant: null,
      inApplicabilityDomain: false, klimisch: null, availableFrom: "2020-01-01",
      provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    }];
    const statuses = new Map<string, ClaimStatus>([["q", "downweighted"]]);
    const r = shouldAbstain({ belief: 0.3, plausibility: 0.4, conflictMass: 0, statuses, claims, ruleset: RS });
    expect(r.abstain).toBe(true);
    expect(r.reason).toMatch(/applicability domain/i);
  });

  it("does not let a DEFEATED in-domain claim suppress the applicability abstention", () => {
    // The only claim still carrying mass is out of its applicability domain. The
    // in-domain claim was defeated, so it contributes nothing and must not vouch
    // for a verdict it no longer supports. Before the Task 6 fix this returned
    // abstain:false - the dangerous direction.
    const claims: EvidenceClaim[] = [
      cl("live", "qsar", "toxic", false),
      cl("dead", "cytotox", "safe", true),
    ];
    const statuses = new Map<string, ClaimStatus>([["live", "admitted"], ["dead", "defeated"]]);
    const r = shouldAbstain({ belief: 0.3, plausibility: 0.4, conflictMass: 0, statuses, claims, ruleset: RS });
    expect(r.abstain).toBe(true);
    expect(r.reason).toMatch(/applicability domain/i);
  });

  it("treats an UNDECIDED claim as not live either", () => {
    const claims: EvidenceClaim[] = [
      cl("live", "qsar", "toxic", false),
      cl("limbo", "cytotox", "safe", true),
    ];
    const statuses = new Map<string, ClaimStatus>([["live", "admitted"], ["limbo", "undecided"]]);
    expect(shouldAbstain({ belief: 0.3, plausibility: 0.4, conflictMass: 0, statuses, claims, ruleset: RS }).abstain)
      .toBe(true);
  });

  it("does NOT abstain at exactly the threshold - the comparison is strict", () => {
    // 1 - 0.5 is exactly 0.5 in binary floating point, so this really does sit
    // on the boundary. (0.7 - 0.2 would not - it lands at 0.49999999999999994.)
    const r = shouldAbstain({ ...base, belief: 0.5, plausibility: 1, conflictMass: 0 });
    expect(1 - 0.5).toBe(RS.abstentionGapThreshold);
    expect(r.abstain).toBe(false);
  });

  it("does not conflate an UNKNOWN applicability domain with an out-of-domain one", () => {
    const claims: EvidenceClaim[] = [
      cl("known-bad", "qsar", "toxic", false),
      cl("unknown", "cytotox", "toxic", null),
    ];
    const statuses = new Map<string, ClaimStatus>([["known-bad", "admitted"], ["unknown", "admitted"]]);
    const r = shouldAbstain({ belief: 0.3, plausibility: 0.4, conflictMass: 0, statuses, claims, ruleset: RS });
    expect(r.abstain).toBe(false);
  });
});
```

Create `packages/engine/test/conflict.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectConflict } from "../src/conflict.js";
import type { EvidenceClaim } from "../src/types.js";

function claim(id: string, assertion: EvidenceClaim["assertion"], stream: EvidenceClaim["stream"]): EvidenceClaim {
  return {
    id, compoundId: "X", stream, assertion, strength: 0.8, system: "human",
    measuresKeyEvent: null, exposureRelevant: null, inApplicabilityDomain: true,
    klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
  };
}

describe("detectConflict", () => {
  it("is a conflict only when two DIFFERENT streams commit to opposite verdicts", () => {
    const r = detectConflict([claim("a", "toxic", "cytotox"), claim("b", "safe", "transporter")]);
    expect(r.conflicting).toBe(true);
    expect(r.opposedStreams.sort()).toEqual(["cytotox", "transporter"]);
  });

  it("is not a conflict within a single stream", () => {
    expect(detectConflict([claim("a", "toxic", "cytotox"), claim("b", "safe", "cytotox")]).conflicting).toBe(false);
  });

  it("ignores ambiguous claims", () => {
    expect(detectConflict([claim("a", "toxic", "cytotox"), claim("b", "ambiguous", "qsar")]).conflicting).toBe(false);
  });

  it("is not a conflict when all streams agree", () => {
    expect(detectConflict([claim("a", "toxic", "cytotox"), claim("b", "toxic", "qsar")]).conflicting).toBe(false);
  });

  it("IS a conflict when a self-split stream is also opposed by a third stream", () => {
    // cytotox disagrees with itself (noise on its own), but its toxic reading
    // still stands against transporter's safe reading - a real cross-stream
    // conflict. The original symmetric-difference test missed this because
    // cytotox cancelled out of both sides.
    const r = detectConflict([
      claim("a", "toxic", "cytotox"),
      claim("b", "safe", "cytotox"),
      claim("c", "safe", "transporter"),
    ]);
    expect(r.conflicting).toBe(true);
    expect(r.opposedStreams).toEqual(["cytotox", "transporter"]);
  });

  it("reports each opposed stream exactly once", () => {
    const r = detectConflict([
      claim("a", "toxic", "cytotox"),
      claim("b", "toxic", "cytotox"),
      claim("c", "safe", "transporter"),
      claim("d", "safe", "transporter"),
    ]);
    expect(r.opposedStreams).toEqual(["cytotox", "transporter"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/abstain.test.ts packages/engine/test/conflict.test.ts
```

Expected: FAIL — both modules missing.

- [ ] **Step 3: Write the implementations**

Create `packages/engine/src/abstain.ts`:

```ts
import type { ClaimStatus, EvidenceClaim, Ruleset } from "./types.js";

/**
 * Decide whether to decline a verdict.
 *
 * Abstention is a first-class output, not a failure. On a compound where the
 * evidence cannot settle the question, "I cannot vouch for this yet" is the
 * correct answer and a confident guess would be dangerous.
 *
 * The gap threshold comes from the PRE-REGISTERED ruleset, never a constant in
 * this file - so it cannot be tuned after seeing results.
 */
export function shouldAbstain(input: {
  belief: number;
  plausibility: number;
  conflictMass: number;
  statuses: Map<string, ClaimStatus>;
  claims: EvidenceClaim[];
  ruleset: Ruleset;
}): { abstain: boolean; reason: string | null } {
  const { belief, plausibility, conflictMass, statuses, claims, ruleset } = input;

  if (conflictMass >= 1 - 1e-9) {
    return { abstain: true, reason: "Total conflict between sources; no conclusion survives combination." };
  }

  // Only LIVE claims may vouch for the applicability of the verdict. A defeated
  // claim contributes zero mass and an undecided one contributes vacuous mass,
  // so neither can rescue a conclusion that rests entirely on survivors sitting
  // outside their applicability domain.
  const live = claims.filter((c) => {
    const s = statuses.get(c.id);
    return s === "admitted" || s === "downweighted";
  });
  const committed = live.filter((c) => c.assertion !== "ambiguous");
  if (committed.length > 0 && committed.every((c) => c.inApplicabilityDomain === false)) {
    return {
      abstain: true,
      reason: "Every committed source lies outside its applicability domain; this compound is off the map.",
    };
  }

  const gap = plausibility - belief;
  if (gap > ruleset.abstentionGapThreshold) {
    return {
      abstain: true,
      reason: `Belief-to-plausibility gap ${gap.toFixed(2)} exceeds the pre-registered threshold ${ruleset.abstentionGapThreshold.toFixed(2)}.`,
    };
  }

  return { abstain: false, reason: null };
}
```

Create `packages/engine/src/conflict.ts`:

```ts
import type { EvidenceClaim } from "./types.js";

/**
 * A compound is in the conflict subset when two DIFFERENT streams commit to
 * opposite conclusions.
 *
 * Stream-level rather than claim-level on purpose: two disagreeing readouts
 * from one assay is measurement noise, whereas a hepatocyte assay disagreeing
 * with a transporter assay is the situation ARBITER exists for. Ambiguous
 * claims never create a conflict - they commit to nothing.
 *
 * The predicate is existential: SOME toxic-committed stream differs from SOME
 * safe-committed stream. A stream that disagrees with itself is not excluded
 * from the comparison - it just cannot supply both halves of the pair. So a
 * cytotox assay split against itself PLUS a transporter assay reading safe is a
 * genuine cross-stream conflict, while the split cytotox assay alone is not.
 */
export function detectConflict(claims: EvidenceClaim[]): { conflicting: boolean; opposedStreams: string[] } {
  const committed = claims.filter((c) => c.assertion !== "ambiguous");
  const toxicStreams = new Set(committed.filter((c) => c.assertion === "toxic").map((c) => c.stream));
  const safeStreams = new Set(committed.filter((c) => c.assertion === "safe").map((c) => c.stream));

  // Exists t in toxicStreams, s in safeStreams with t !== s. This fails only
  // when every toxic stream equals every safe stream, i.e. both sides are the
  // same lone stream - the measurement-noise case.
  let conflicting = false;
  for (const t of toxicStreams) {
    for (const s of safeStreams) {
      if (t !== s) { conflicting = true; break; }
    }
    if (conflicting) break;
  }

  // Every stream committing on either side is party to the disagreement,
  // including one that straddles both.
  const opposed = conflicting ? [...new Set([...toxicStreams, ...safeStreams])].sort() : [];
  return { conflicting, opposedStreams: opposed };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/abstain.test.ts packages/engine/test/conflict.test.ts && npm run lint
```

Expected: PASS (15 tests), lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "Add abstention and stream-level conflict detection

Abstention fires on total conflict, on every committed source being outside
its applicability domain, or on the belief-plausibility gap exceeding the
threshold - and the threshold is read from the pre-registered ruleset rather
than hard-coded here, so it cannot be tuned after seeing results.

Conflict is defined at STREAM level, not claim level: two disagreeing readouts
from one assay is measurement noise, while a hepatocyte assay disagreeing with
a transporter assay is the situation the product exists for.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `reason()` — the public entry point, and the determinism guarantee

**Files:**
- Create: `packages/engine/src/index.ts`
- Modify: `packages/engine/src/fuse.ts` — additively extend `fuse`'s return with `mass`
- Test: `packages/engine/test/reason.test.ts`, `packages/engine/test/determinism.test.ts`

**Interfaces:**
- Consumes: `argue`, `fuse`, `claimToMass`, `shouldAbstain`, `relevanceDiscount`, `detectConflict`
  — NOT `concordanceBoost`. R6 is realised by Dempster's rule inside `fuse`; the
  explicit boost was removed from the verdict path because a stream-count majority
  could invert a mass majority. See the ruling in the fix-round notes below.
- Produces:
  - `reason(claims: EvidenceClaim[], ruleset: Ruleset, rulesetHash?: string): Reasoning`
  - Re-exports every public type and the sub-module functions
  - `fuse` now also returns `mass: Mass` (additive — Task 3's tests are unaffected)

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/reason.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reason } from "../src/index.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("reason", () => {
  it("abstains on no evidence at all, with a maximally wide range", () => {
    const r = reason([], RS);
    expect(r.verdict).toBe("abstain");
    expect(r.belief).toBeCloseTo(0, 10);
    expect(r.plausibility).toBeCloseTo(1, 10);
  });

  it("advances on unanimous strong safe evidence that is human and exposure-established", () => {
    const r = reason([
      claim({ id: "a", assertion: "safe", strength: 0.9, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
    ], RS);
    expect(r.verdict).toBe("advance");
    expect(r.contested).toBe(false);
  });

  it("THE PASS-1 CASE: abstains on unanimous evidence that licenses nothing", () => {
    // Four claims all saying "safe", none contradicting any other - and yet the
    // honest answer is that we cannot tell. Every one is either non-human or was
    // never measured at clinical exposure, so most of their mass belongs in Theta
    // rather than on "safe".
    //
    // This is the mechanism demo beat 3 rests on. Before evidence-quality
    // discounting existed, no rule fired (nothing conflicts), every claim was
    // admitted at full strength, and reason() returned ADVANCE - agreeing with the
    // historical decision that harmed three trial participants. If this test ever
    // goes back to expecting "advance", the discount mechanism has regressed and
    // the demo's central beat is broken.
    const r = reason([
      claim({ id: "rat", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent", exposureRelevant: null, measuresKeyEvent: null }),
      claim({ id: "primate", assertion: "safe", strength: 0.85, system: "nonrodent", stream: "invivo_nonrodent", exposureRelevant: null, measuresKeyEvent: null }),
      claim({ id: "invitro", assertion: "safe", strength: 0.8, system: "human", stream: "cytotox", exposureRelevant: null, measuresKeyEvent: "KE:HEPATOCYTE-DEATH" }),
      claim({ id: "bsep", assertion: "safe", strength: 0.75, system: "human", stream: "transporter", exposureRelevant: null, measuresKeyEvent: "KE:BSEP" }),
    ], RS);

    expect(r.verdict).toBe("abstain");
    // Nothing was defeated - there was no conflict to resolve.
    expect(r.trace.filter((s) => s.status === "defeated")).toHaveLength(0);
    // The gap is what carries the abstention.
    expect(r.plausibility - r.belief).toBeGreaterThan(RS.abstentionGapThreshold);
    // And the trace must SAY why, per claim, not just report a verdict.
    const ratStep = r.trace.find((s) => s.claimId === "rat")!;
    expect(ratStep.rationale).toMatch(/exposure|indirect|reduced/i);
  });

  it("discounting reduces belief without flipping it to the opposing side", () => {
    // Weak evidence for safety must never become evidence of toxicity. Asserted on
    // the MASS, not on `belief`: belief is the mass on toxic, and a lone safe claim
    // puts exactly 0 there under any implementation, so a `belief < 0.5` assertion
    // could not fail.
    const weak = reason([
      claim({ id: "a", assertion: "safe", strength: 0.9, system: "rodent", stream: "invivo_rodent", exposureRelevant: null }),
    ], RS);
    // Nothing leaked to the opposing side.
    expect(weak.mass.toxic).toBe(0);
    // The discount actually bit: safe mass is strictly below the stated 0.9.
    expect(weak.mass.safe).toBeGreaterThan(0);
    expect(weak.mass.safe).toBeLessThan(0.9);
    // And the reduction went to Theta, not anywhere else.
    expect(weak.mass.uncommitted).toBeCloseTo(1 - weak.mass.safe, 10);
    expect(weak.plausibility).toBeGreaterThan(0.5); // ignorance is wide
  });

  it("does not advance when the surviving evidence says toxic", () => {
    // The surviving human claim has exposureRelevant: null, so this case ALSO
    // guards R3's directional scope. If R3 ever starts discounting positives
    // too, this claim drops to 15% of its weight, the gap widens to 0.87, and
    // the verdict silently becomes "abstain".
    const r = reason([
      claim({ id: "h", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1 }),
      claim({ id: "r", assertion: "safe", strength: 0.9, system: "rodent", stream: "invivo_rodent", klimisch: 2 }),
    ], RS);
    expect(r.verdict).toBe("do_not_advance");
    // The defeated rodent claim is still in the trace - nothing is hidden.
    expect(r.trace.find((s) => s.claimId === "r")?.status).toBe("defeated");
    expect(r.trace.find((s) => s.claimId === "r")?.byRule).toBe("R1");
  });

  it("excludes defeated claims from fusion but keeps them in the trace", () => {
    const withDefeat = reason([
      claim({ id: "h", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1 }),
      claim({ id: "r", assertion: "safe", strength: 0.99, system: "rodent", stream: "invivo_rodent", klimisch: 2 }),
    ], RS);
    const alone = reason([claim({ id: "h", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1 })], RS);
    // The very strong defeated claim must not drag belief down.
    expect(withDefeat.belief).toBeCloseTo(alone.belief, 10);
    // One step per claim. Counted over real claim steps only, so this does not
    // silently double as an assertion that the case never abstains - a bare
    // toHaveLength(2) breaks the day this case starts abstaining for an unrelated
    // reason and appends a verdict step.
    expect(withDefeat.trace.filter((s) => s.kind !== "verdict")).toHaveLength(2);
  });

  it("marks a case contested when both sides survive", () => {
    const r = reason([
      claim({ id: "a", assertion: "toxic", klimisch: 2, stream: "cytotox" }),
      claim({ id: "b", assertion: "safe", klimisch: 2, stream: "transporter" }),
    ], RS);
    expect(r.contested).toBe(true);
  });

  it("marks a mutual-defeat cycle contested - undecided is surviving, not resolved", () => {
    // The 4-cycle from argue.test.ts: two toxic, two safe, every claim UNDECIDED
    // because each attacker is itself outranked. Nothing was settled, so this is
    // the most contested input the engine can represent.
    //
    // It previously reported contested: FALSE. `contested` was computed over
    // admitted|downweighted claims only, and undecided claims contribute vacuous
    // mass, which generates no conflict mass either - so both halves of the test
    // missed it, and the UI would have rendered four visibly deadlocked claims
    // beside a field saying nothing disagreed.
    const r = reason([
      claim({ id: "a", assertion: "toxic", system: "human", klimisch: 4 }),
      claim({ id: "b", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 1 }),
      claim({ id: "c", assertion: "toxic", system: "nonrodent", stream: "invivo_nonrodent", klimisch: 2 }),
      claim({ id: "d", assertion: "safe", system: "in_silico", stream: "qsar", klimisch: 3 }),
    ], RS);
    expect(r.trace.filter((s) => s.status === "undecided" && s.kind !== "verdict")).toHaveLength(4);
    expect(r.conflictMass).toBe(0); // vacuous masses cannot conflict - hence the miss
    expect(r.contested).toBe(true);
  });

  it("does not mark a RESOLVED conflict contested - a defeated claim is not surviving", () => {
    // The other side of the same predicate, so the fix above cannot be satisfied
    // by simply returning true whenever any two claims ever opposed each other.
    // Here R1 defeats the rodent claim outright: the disagreement was settled, and
    // only one side is left standing.
    const r = reason([
      claim({ id: "h", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1 }),
      claim({ id: "rat", assertion: "safe", strength: 0.9, system: "rodent", stream: "invivo_rodent", klimisch: 2 }),
    ], RS);
    expect(r.trace.find((s) => s.claimId === "rat")?.status).toBe("defeated");
    expect(r.contested).toBe(false);
  });

  it("carries the ruleset hash through to the output", () => {
    expect(reason([], RS, "deadbeef").rulesetHash).toBe("deadbeef");
  });

  it("emits a coherent mass - belief <= plausibility, components in [0,1], sum 1 - on every shape of input", () => {
    // The previous version of this test used ONE single-claim input, where the
    // relation holds by construction, and never touched multi-mass fusion,
    // normalisation, defeat, or the undecided branch. These are the shapes where
    // the arithmetic could actually go wrong.
    const cases: Record<string, EvidenceClaim[]> = {
      "empty": [],
      "all ambiguous": [
        claim({ id: "a", assertion: "ambiguous", strength: 0.9, stream: "qsar", system: "in_silico" }),
        claim({ id: "b", assertion: "ambiguous", strength: 0.4, stream: "cytotox" }),
      ],
      // Neither side can defeat the other (same system, equal Klimisch, both at
      // clinical exposure), so both survive into fusion and normalisation runs on
      // a genuinely conflicting pair.
      "live conflict, both admitted": [
        claim({ id: "t", assertion: "toxic", strength: 0.9, stream: "cytotox", exposureRelevant: true }),
        claim({ id: "s", assertion: "safe", strength: 0.9, stream: "transporter", exposureRelevant: true }),
      ],
      "one claim defeated": [
        claim({ id: "h", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1 }),
        claim({ id: "r", assertion: "safe", strength: 0.99, system: "rodent", stream: "invivo_rodent", klimisch: 2 }),
      ],
      // A real 4-cycle against the pre-registered ruleset: grounded semantics
      // settles none of these, so all four are UNDECIDED and contribute pure
      // ignorance. See argue.test.ts for the hand-traced edges.
      "undecided 4-cycle": [
        claim({ id: "a", assertion: "toxic", system: "human", klimisch: 4 }),
        claim({ id: "b", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 1 }),
        claim({ id: "c", assertion: "toxic", system: "nonrodent", stream: "invivo_nonrodent", klimisch: 2 }),
        claim({ id: "d", assertion: "safe", system: "in_silico", stream: "qsar", klimisch: 3 }),
      ],
      "everything out of applicability domain": [
        claim({ id: "a", assertion: "toxic", strength: 0.7, stream: "qsar", system: "in_silico", inApplicabilityDomain: false }),
        claim({ id: "b", assertion: "safe", strength: 0.7, stream: "cytotox", inApplicabilityDomain: false }),
      ],
      "the pass-1 case": [
        claim({ id: "rat", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent" }),
        claim({ id: "invitro", assertion: "safe", strength: 0.8, system: "human", stream: "cytotox", measuresKeyEvent: "KE:1" }),
      ],
    };

    for (const [name, claims] of Object.entries(cases)) {
      const r = reason(claims, RS);
      const parts = [r.mass.toxic, r.mass.safe, r.mass.uncommitted, r.belief, r.plausibility, r.conflictMass];
      for (const v of parts) {
        expect(Number.isFinite(v), `${name}: non-finite value ${v}`).toBe(true);
      }
      expect(r.belief, name).toBeLessThanOrEqual(r.plausibility);
      for (const v of [r.mass.toxic, r.mass.safe, r.mass.uncommitted]) {
        expect(v, `${name}: mass component out of [0,1]`).toBeGreaterThanOrEqual(0);
        expect(v, `${name}: mass component out of [0,1]`).toBeLessThanOrEqual(1);
      }
      expect(r.mass.toxic + r.mass.safe + r.mass.uncommitted, name).toBeCloseTo(1, 9);
      // belief and plausibility must be the mass, not a separately-derived number.
      expect(r.belief, name).toBeCloseTo(r.mass.toxic, 12);
      expect(r.plausibility, name).toBeCloseTo(r.mass.toxic + r.mass.uncommitted, 12);
    }
  });

  it("reads the verdict off the fused mass itself, with nothing applied on top", () => {
    // REGRESSION PIN for the removal of R6's explicit concordance boost.
    //
    // The boost multiplied one side of the fused mass by a stream-count factor
    // before the verdict was read, so a STREAM-COUNT majority could invert a
    // DEMPSTER-SHAFER MASS majority. Removing it changed verdicts deliberately -
    // and until this test existed, nothing detected putting it back. The
    // sum-to-1 check above only catches a boost applied WITHOUT renormalising;
    // a renormalised one (the alternative that was considered and rejected)
    // left the entire suite green while flipping this very case.
    //
    // Hand-derived rather than copied from an observed run. Two safe claims at
    // 0.5 fuse to m(safe) = 1 - 0.5^2 = 0.75, m(Theta) = 0.25. Combining the
    // toxic claim at b = 0.753 gives, before normalisation,
    //   toxic = 0.25 * b, safe = 0.75 * (1 - b), Theta = 0.25 * (1 - b),
    // with conflict K = 0.75 * b, so norm = 1 - K.
    const b = 0.753;
    const S = 1 - 0.5 * 0.5;
    const U = 0.5 * 0.5;
    const norm = 1 - S * b;

    const r = reason([
      claim({ id: "s1", assertion: "safe", strength: 0.5, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "s2", assertion: "safe", strength: 0.5, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
      claim({ id: "t1", assertion: "toxic", strength: b, stream: "toxicogenomics", exposureRelevant: true, measuresKeyEvent: "KE:3" }),
    ], RS);

    expect(r.mass.toxic).toBeCloseTo((U * b) / norm, 12);
    expect(r.mass.safe).toBeCloseTo((S * (1 - b)) / norm, 12);
    expect(r.mass.uncommitted).toBeCloseTo((U * (1 - b)) / norm, 12);

    // Mass leans TOXIC by roughly 0.007 - inside the 0.5 gap threshold, so the
    // verdict is committed rather than abstained, which is what makes the flip
    // observable at all.
    expect(r.mass.toxic).toBeGreaterThan(r.mass.safe);
    expect(r.plausibility - r.belief).toBeLessThan(RS.abstentionGapThreshold);
    // Two independent streams concur on "safe" and are outvoted anyway, because
    // Dempster's rule has already priced their agreement in. A 1.0333x boost on
    // the safe side would return "advance" here.
    expect(r.verdict).toBe("do_not_advance");
  });

  it("cannot let a stream RELABELLING change the verdict, only the rules that read stream", () => {
    // The companion property to the test above, and the more general statement:
    // outside R2's structural-only check (stream === "qsar" || system ===
    // "in_silico"), `stream` must not reach the mass at all. Fusion is blind to
    // source labels; concordance is realised by combining masses, not by counting
    // names. So moving both safe claims onto ONE stream - which changes nothing
    // about what any source measured or how strongly - must leave the mass and the
    // verdict bit-for-bit identical.
    //
    // Under the removed boost these two inputs disagreed: 2-vs-1 streams boosted
    // safe by 1.0333 and returned "advance", while 1-vs-1 boosted nothing and
    // returned "do_not_advance". Same evidence, different answer, decided by a
    // label. `contested` is deliberately NOT asserted - detectConflict reads
    // stream by design, and it legitimately differs between these two inputs.
    const twoStreams = reason([
      claim({ id: "s1", assertion: "safe", strength: 0.5, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "s2", assertion: "safe", strength: 0.5, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
      claim({ id: "t1", assertion: "toxic", strength: 0.753, stream: "toxicogenomics", exposureRelevant: true, measuresKeyEvent: "KE:3" }),
    ], RS);
    const oneStream = reason([
      claim({ id: "s1", assertion: "safe", strength: 0.5, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "s2", assertion: "safe", strength: 0.5, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
      claim({ id: "t1", assertion: "toxic", strength: 0.753, stream: "toxicogenomics", exposureRelevant: true, measuresKeyEvent: "KE:3" }),
    ], RS);

    expect(oneStream.mass).toEqual(twoStreams.mass);
    expect(oneStream.verdict).toBe(twoStreams.verdict);
    expect(oneStream.belief).toBe(twoStreams.belief);
    expect(oneStream.conflictMass).toBe(twoStreams.conflictMass);
  });

  it("explains an exactly-balanced abstention in the trace instead of going silent", () => {
    // Two equally strong, equally qualified, directly opposed human claims. No
    // rule can separate them, so the fused mass on toxic and on safe are exactly
    // equal and the honest verdict is to decline - which the trace must SAY.
    const r = reason([
      claim({ id: "t", assertion: "toxic", strength: 0.9, stream: "cytotox", exposureRelevant: true, klimisch: 2 }),
      claim({ id: "s", assertion: "safe", strength: 0.9, stream: "transporter", exposureRelevant: true, klimisch: 2 }),
    ], RS);
    expect(r.mass.toxic).toBe(r.mass.safe);
    expect(r.verdict).toBe("abstain");
    const note = r.trace.find((s) => s.kind === "verdict");
    expect(note).toBeDefined();
    expect(note!.rationale).toMatch(/exactly balanced/i);
  });

  it("marks the verdict pseudo-step with kind, and only when there is one", () => {
    // Consumers (Tasks 8 and 9, and the UI) walk this trace. The synthetic verdict
    // note must be distinguishable from a real claim step by something better than
    // its id or its status.
    const abstaining = reason([
      claim({ id: "rat", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent" }),
      claim({ id: "primate", assertion: "safe", strength: 0.85, system: "nonrodent", stream: "invivo_nonrodent" }),
    ], RS);
    expect(abstaining.verdict).toBe("abstain");
    expect(abstaining.trace.filter((s) => s.kind === "verdict")).toHaveLength(1);

    const committing = reason([
      claim({ id: "a", assertion: "safe", strength: 0.9, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
    ], RS);
    expect(committing.verdict).not.toBe("abstain");
    expect(committing.trace.filter((s) => s.kind === "verdict")).toHaveLength(0);
  });

  it("does not annotate an ambiguous claim with a discount that never happened", () => {
    // An ambiguous claim commits no mass, so there is nothing to discount. A
    // rodent Klimisch-4 ambiguous claim previously got "Weight reduced to 4% of
    // stated confidence" even though claimToMass had returned VACUOUS.
    const r = reason([
      claim({ id: "amb", assertion: "ambiguous", strength: 0.9, system: "rodent", stream: "invivo_rodent", klimisch: 4 }),
    ], RS);
    const step = r.trace.find((s) => s.claimId === "amb")!;
    expect(step.rationale).not.toMatch(/Weight reduced/);
    expect(r.mass.toxic).toBe(0);
    expect(r.mass.safe).toBe(0);
    expect(r.mass.uncommitted).toBe(1);
  });
});
```

Create `packages/engine/test/determinism.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { reason } from "../src/index.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;

const CLAIMS: EvidenceClaim[] = [
  { id: "a", compoundId: "X", stream: "qsar", assertion: "ambiguous", strength: 0.5, system: "in_silico", measuresKeyEvent: null, exposureRelevant: null, inApplicabilityDomain: true, klimisch: null, availableFrom: "2020-01", provenance: { kind: "database", source: "t", retrieved: "2026-07-26" } },
  { id: "b", compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8, system: "human", measuresKeyEvent: null, exposureRelevant: true, inApplicabilityDomain: true, klimisch: 1, availableFrom: "2020-01", provenance: { kind: "database", source: "t", retrieved: "2026-07-26" } },
  { id: "c", compoundId: "X", stream: "toxicogenomics", assertion: "toxic", strength: 0.7, system: "rodent", measuresKeyEvent: "KE:1", exposureRelevant: true, inApplicabilityDomain: true, klimisch: 2, availableFrom: "2022-01", provenance: { kind: "literature", source: "PMID:1", retrieved: "2026-07-26" } },
  { id: "d", compoundId: "X", stream: "transporter", assertion: "safe", strength: 0.6, system: "human", measuresKeyEvent: "KE:2", exposureRelevant: null, inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01", provenance: { kind: "database", source: "t", retrieved: "2026-07-26" } },
];

describe("determinism", () => {
  it("produces exactly ONE output hash across 1000 runs", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      hashes.add(createHash("sha256").update(JSON.stringify(reason(CLAIMS, RS, "h"))).digest("hex"));
    }
    expect(hashes.size).toBe(1);
  });

  it("does not mutate its inputs, including nested objects", () => {
    // Built fresh and frozen INSIDE this test. The previous version snapshotted a
    // shared array that the 1000-run test above had already passed through
    // reason(), so any mutation that converged after the first call was invisible
    // to it - verified by injecting an idempotent write, which it did not catch.
    const fresh: EvidenceClaim[] = JSON.parse(JSON.stringify(CLAIMS));
    for (const c of fresh) Object.freeze(c.provenance);
    Object.freeze(fresh);
    const rs: Ruleset = JSON.parse(JSON.stringify(RS));
    rs.rules.forEach((r) => { Object.freeze(r.framework); Object.freeze(r); });
    Object.freeze(rs.rules);
    Object.freeze(rs);

    const before = JSON.stringify({ fresh, rs });
    reason(fresh, rs, "h");
    expect(JSON.stringify({ fresh, rs })).toBe(before);
  });
});
```

Do NOT snapshot a fixture the previous `it` already ran through `reason()`. `Object.freeze` on a non-strict-mode write fails SILENTLY, which is why the snapshot comparison is kept alongside the freezing rather than replaced by it — Vitest runs ESM (strict), so a write should throw, but keep both belts.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/reason.test.ts packages/engine/test/determinism.test.ts
```

Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 2a: Add `relevanceDiscount` to `rules.ts` — the mechanism beat 3 depends on**

**Why this exists.** R1–R6 as written are pure tie-breakers: they only fire when claims collide. But TAK-994's pass 1 contains four claims that all say *safe* and one that says *ambiguous* — no conflict at all. Nothing gets defeated, everything is admitted at full strength, and `reason()` returns **advance**. Demo beat 3 shows an abstention, so as specified the flagship case does not work.

The gap is conceptual, not arithmetic. The lesson of the case is not that animal evidence loses an argument — it is that **a clean rat study is weak evidence about humans even when nothing contradicts it.** Four sources agreeing tells you little if all four are either non-human or never tested at clinical exposure. The engine had no way to express that.

So the same six principles apply as **discounts** absent conflict, with the discounted portion becoming *uncommitted* mass — which is exactly what uncommitted mass means. R4 already worked this way; this generalises it.

**One asymmetry, and it comes from the registered text.** R3 discounts only claims asserting *safe*. That is not a tuning choice — R3's pre-registered statement is already written about negative findings ("…defeats **a negative finding** whose exposure margin is unstated or untested at that range"). R1, R2, R4 and R5 characterise what *kind* of evidence a claim is and so apply in both directions; R3 characterises what a result can *license*, which is direction-dependent. A positive hit at an unrecorded concentration still tells you something and sets up the next experiment; an absence of signal at an unrecorded concentration tells you nothing about safety.

This was measured, not assumed. With R3 applied in both directions, a lone human hepatotoxicity hit whose margin was never recorded yields belief 0.135 against plausibility 1.0 — a gap of 0.87, so **abstain** — and it takes **eight** concordant sources before anything escapes abstention. Since `exposureRelevant` will be `null` for nearly every claim the QSAR (Task 11) and Tox21 (Task 12) streams produce, that would have abstained on essentially the entire evaluation set and taken the Task 15 metrics with it. Scoped to negatives, all six of this task's verdict expectations hold, including Task 7's own `do_not_advance` case.

Add to `packages/engine/src/rules.ts`:

> **This is an excerpt, shown here because it is what Task 7 contributes.** The Task 4
> listing of `rules.ts` above is the authoritative copy and already contains this code —
> it is kept byte-identical to the shipped source by the plan-sync check, so if the two
> ever disagree, believe Task 4's.

```ts
export interface Discount {
  /** Multiplier in (0,1] applied to the claim's committed mass. */
  factor: number;
  /** Which principles reduced it, for the trace. Empty when factor is 1. */
  reasons: { byRule: RuleId; rationale: string }[];
}

/**
 * How much does this claim's committed mass survive, absent any conflict?
 *
 * R1-R6 are tie-breakers when evidence collides. They are ALSO statements about
 * evidence quality, and quality matters even when nothing disagrees. A clean
 * rodent study is weak evidence about a human endpoint whether or not anything
 * contradicts it; a margin never measured at clinical exposure does not become
 * informative just because no one challenged it.
 *
 * Discounted mass moves to Theta - uncommitted - because that is precisely what
 * it is: mass this source cannot commit anywhere. It does NOT move to the
 * opposing side. Weak evidence for safety is not evidence of toxicity.
 *
 * Multiplicative, so several weaknesses compound: a rodent study whose exposure
 * was never established is weaker than either flaw alone.
 *
 * Each factor is 1 - rule.strength, so a toxicologist tunes discounting by
 * editing the same pre-registered, hashed strengths that govern defeats. One
 * number per principle, one meaning, two mechanisms.
 */
export function relevanceDiscount(claim: EvidenceClaim, ruleset: Ruleset): Discount {
  const reasons: Discount["reasons"] = [];
  let factor = 1;

  const apply = (id: RuleId, rationale: string) => {
    const r = rule(ruleset, id);
    if (!r) return;
    // Clamped for the same reason claimToMass clamps: a schema-invalid ruleset
    // must not be able to produce a negative belief, and reason() does not
    // validate its ruleset on every call (it is invoked thousands of times in
    // robustness sampling). Measured without the clamp: strength 1.6 gives a
    // factor of -0.6 and reason() reports belief -0.54.
    factor *= Math.min(1, Math.max(0, 1 - r.strength));
    reasons.push({ byRule: id, rationale });
  };

  // R1: non-human evidence about a human endpoint.
  if (claim.system === "rodent" || claim.system === "nonrodent") {
    apply("R1", `${claim.system} evidence is indirect for a human endpoint.`);
  }
  // R2: structural correlation rather than a measured key event. isStructuralOnly
  // already requires measuresKeyEvent === null, so no second key-event test is
  // needed - an earlier draft had one and it could never be false.
  if (isStructuralOnly(claim)) {
    apply("R2", "Correlates with chemical structure; measures no key event directly.");
  }
  // R3: a NEGATIVE finding whose exposure margin was never established.
  //
  // R3 is the ONLY directional rule, and it is directional in its own
  // pre-registered statement: "A positive finding at clinically relevant
  // exposure defeats A NEGATIVE FINDING whose exposure margin is unstated or
  // untested at that range." R1, R2, R4 and R5 describe what KIND of evidence
  // this is, so they apply whichever way the claim points. R3 describes what a
  // result can LICENSE, and that is asymmetric: a positive hit is informative
  // whatever the margin - you go and establish the margin next - whereas an
  // absence of signal at an unknown concentration licenses nothing about
  // safety. Applying R3 to positives as well would have crushed every hazard
  // finding in the automated streams, where the margin is almost never
  // recorded, and abstained on essentially the whole evaluation set.
  if (claim.assertion === "safe" && claim.exposureRelevant !== true) {
    apply("R3", claim.exposureRelevant === false
      ? "A negative result from testing outside the clinically relevant exposure range."
      : "A negative result whose exposure margin relative to the clinical range was never established.");
  }
  // R4: outside the model's applicability domain. Already the existing behaviour.
  if (claim.inApplicabilityDomain === false) {
    apply("R4", "Model was operating outside its applicability domain.");
  }
  // R5: low study reliability. Klimisch 1 and 2 are reliable; 3 and 4 are not.
  if (claim.klimisch !== null && claim.klimisch >= 3) {
    apply("R5", `Klimisch ${claim.klimisch} indicates limited study reliability.`);
  }

  return { factor, reasons };
}
```

**Tests to add to `packages/engine/test/rules.test.ts`:**

```ts
describe("relevanceDiscount", () => {
  it("leaves ideal evidence undiscounted", () => {
    const d = relevanceDiscount(claim({
      system: "human", stream: "cytotox", measuresKeyEvent: "KE:1",
      exposureRelevant: true, inApplicabilityDomain: true, klimisch: 1,
    }), RS);
    expect(d.factor).toBe(1);
    expect(d.reasons).toHaveLength(0);
  });

  it("discounts a clean rodent study whose exposure was never established", () => {
    // THE PASS-1 CASE. Unopposed, but it licenses very little.
    const d = relevanceDiscount(claim({
      system: "rodent", stream: "invivo_rodent", measuresKeyEvent: null,
      exposureRelevant: null, klimisch: 1,
    }), RS);
    expect(d.factor).toBeLessThan(0.2);
    expect(d.reasons.map((r) => r.byRule).sort()).toEqual(["R1", "R3"]);
  });

  it("compounds multiplicatively - the factor is exactly the product of (1 - strength)", () => {
    // `both < one` alone would also be satisfied by max() or by 1 - sum(). Assert
    // the actual product, read from the ruleset's own strengths rather than
    // hard-coded, so the test tracks a re-registration instead of breaking on one.
    const r1 = RS.rules.find((r) => r.id === "R1")!.strength;
    const r3 = RS.rules.find((r) => r.id === "R3")!.strength;
    const both = relevanceDiscount(claim({ system: "rodent", exposureRelevant: null }), RS).factor;
    const one = relevanceDiscount(claim({ system: "rodent", exposureRelevant: true }), RS).factor;
    expect(both).toBeCloseTo((1 - r1) * (1 - r3), 10);
    expect(one).toBeCloseTo(1 - r1, 10);
    expect(both).toBeLessThan(one);
  });

  it("moves discounted mass nowhere - it only reduces, never flips", () => {
    // The no-flip property is only OBSERVABLE on a mass, so assert it there. A
    // range check on the factor cannot see a flip at all: any implementation that
    // moved mass to the opposing side would still return a factor in (0,1). This
    // needs `reason` imported from ../src/index.js.
    const discountedSafe = reason([claim({
      id: "s", assertion: "safe", strength: 0.9, system: "rodent",
      stream: "invivo_rodent", exposureRelevant: null, klimisch: 1,
    })], RS);
    expect(discountedSafe.mass.safe).toBeGreaterThan(0);
    expect(discountedSafe.mass.safe).toBeLessThan(0.9);
    expect(discountedSafe.mass.toxic).toBe(0);

    const discountedToxic = reason([claim({
      id: "t", assertion: "toxic", strength: 0.9, system: "rodent",
      stream: "invivo_rodent", exposureRelevant: null, klimisch: 3,
    })], RS);
    expect(discountedToxic.mass.toxic).toBeGreaterThan(0);
    expect(discountedToxic.mass.toxic).toBeLessThan(0.9);
    expect(discountedToxic.mass.safe).toBe(0);
  });

  it("applies R3 ONLY to negative findings - a positive hit is not discounted for margin", () => {
    // R3's registered statement is about negative findings. A hazard signal at an
    // unrecorded concentration is still a hazard signal; you go and measure the
    // margin next. An absence of signal at an unrecorded concentration licenses
    // nothing. If this test flips, every hazard call in the automated streams gets
    // crushed to 15% and the whole evaluation set abstains.
    const shared = { system: "human" as const, stream: "cytotox" as const, exposureRelevant: null, klimisch: 1 };
    expect(relevanceDiscount(claim({ ...shared, assertion: "safe" }), RS).reasons.map((r) => r.byRule)).toEqual(["R3"]);
    const positive = relevanceDiscount(claim({ ...shared, assertion: "toxic" }), RS);
    expect(positive.reasons).toHaveLength(0);
    expect(positive.factor).toBe(1);
  });

  it("still discounts a positive finding for every NON-directional weakness", () => {
    // The R3 carve-out must not become a blanket exemption for positives: a
    // low-reliability rodent hit is still weak evidence about humans.
    const d = relevanceDiscount(claim({
      assertion: "toxic", system: "rodent", stream: "invivo_rodent",
      exposureRelevant: null, klimisch: 3,
    }), RS);
    expect(d.reasons.map((r) => r.byRule).sort()).toEqual(["R1", "R5"]);
  });

  it("respects disabled rules", () => {
    const off: Ruleset = { ...RS, rules: RS.rules.map((r) => ({ ...r, enabled: false })) };
    expect(relevanceDiscount(claim({ system: "rodent", exposureRelevant: null }), off).factor).toBe(1);
  });

  it("reads strengths from the ruleset rather than hard-coding them", () => {
    const weak: Ruleset = { ...RS, rules: RS.rules.map((r) => r.id === "R1" ? { ...r, strength: 0.1 } : r) };
    const strong: Ruleset = { ...RS, rules: RS.rules.map((r) => r.id === "R1" ? { ...r, strength: 0.9 } : r) };
    const c = claim({ system: "rodent", exposureRelevant: true });
    expect(relevanceDiscount(c, weak).factor).toBeGreaterThan(relevanceDiscount(c, strong).factor);
  });
});
```

- [ ] **Step 3: Extend `fuse` additively to expose the full mass**

`reason()` needs `mass.safe` to compare the two beliefs, which Task 3's return type does not carry. Add it — a purely additive change, so every Task 3 test still passes.

In `packages/engine/src/fuse.ts`, change the `fuse` signature and its return statement only:

```ts
export function fuse(masses: Mass[]): { belief: number; plausibility: number; conflictMass: number; mass: Mass } {
  let acc: Mass = { ...VACUOUS };
  let survival = 1; // prod(1 - K_i)
  for (const m of masses) {
    const { mass, conflict } = combine(acc, m);
    acc = mass;
    survival *= 1 - conflict;
  }
  return { belief: acc.toxic, plausibility: acc.toxic + acc.uncommitted, conflictMass: 1 - survival, mass: acc };
}
```

Only the `mass` field is new here — the cumulative-conflict accumulation is already in place from Task 3. Do not reintroduce a maximum.

- [ ] **Step 4: Write `index.ts`**

Create `packages/engine/src/index.ts`:

```ts
import { shouldAbstain } from "./abstain.js";
import { argue } from "./argue.js";
import { detectConflict } from "./conflict.js";
import { findCounterfactual } from "./counterfactual.js";
import { VACUOUS, claimToMass, fuse, type Mass } from "./fuse.js";
import { relevanceDiscount } from "./rules.js";
import type { EvidenceClaim, Reasoning, Ruleset, TraceStep, Verdict } from "./types.js";

export * from "./types.js";
export { EvidenceClaimSchema, EvidenceFileSchema, RulesetSchema } from "./schema.js";
export { VACUOUS, claimToMass, combine, fuse } from "./fuse.js";
export type { Mass } from "./fuse.js";
export { concordanceBoost, conflictsWith, defeats, downweightFactor, relevanceDiscount } from "./rules.js";
export type { Discount } from "./rules.js";
export { argue } from "./argue.js";
export { detectConflict } from "./conflict.js";
export { shouldAbstain } from "./abstain.js";
export { findCounterfactual } from "./counterfactual.js";

/**
 * Shift a claim's committed mass toward Theta by `factor`, leaving the rest
 * uncommitted. This is the only place evidence quality changes a mass, and it is
 * driven entirely by `relevanceDiscount` - including R4, which is one of the six
 * principles it applies. UNDECIDED claims never reach here; they push VACUOUS
 * directly, because ignorance is not a discounted opinion.
 */
function soften(m: Mass, factor: number): Mass {
  const toxic = m.toxic * factor;
  const safe = m.safe * factor;
  return { toxic, safe, uncommitted: 1 - toxic - safe };
}

/**
 * ARBITER's only public entry point.
 *
 * PURE: no I/O, no clock, no randomness. Filtering claims by `availableFrom`
 * for as-of replay is the CALLER's job - the engine cannot read a clock, which
 * is exactly why the as-of control is a change of input rather than a change
 * of behaviour.
 */
export function reason(claims: EvidenceClaim[], ruleset: Ruleset, rulesetHash = ""): Reasoning {
  return reasonCore(claims, ruleset, rulesetHash, true);
}

/**
 * The verdict and the range only - no counterfactual, no planner.
 *
 * Robustness sampling in Task 15 needs thousands of evaluations per compound and
 * reads nothing but the verdict. The counterfactual search alone costs ~130
 * recursive evaluations, so calling the full `reason` there would multiply the
 * work by two orders of magnitude for output nobody looks at.
 *
 * Identical verdict logic by construction: same function, one flag.
 */
export function reasonVerdictOnly(claims: EvidenceClaim[], ruleset: Ruleset): Reasoning {
  return reasonCore(claims, ruleset, "", false);
}

/**
 * The extras-free recursion target handed to the counterfactual search, so the
 * search cannot re-enter itself. Bound once rather than allocated per call.
 */
const bare = (c: EvidenceClaim[], rs: Ruleset): Reasoning => reasonCore(c, rs, "", false);

function reasonCore(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  rulesetHash: string,
  withExtras: boolean,
): Reasoning {
  const { statuses, trace } = argue(claims, ruleset);

  const masses: Mass[] = [];
  /** claimId -> the discount explanation, folded into that claim's existing trace step. */
  const discountNotes = new Map<string, string>();

  for (const c of claims) {
    const status = statuses.get(c.id);

    // Defeated: excluded from fusion entirely, but RETAINED in the trace.
    if (status === "defeated") continue;

    // Undecided: contributes ignorance, never a vote. This is the
    // fusion-versus-averaging distinction applied to the argumentation layer.
    if (status === "undecided") {
      masses.push({ ...VACUOUS });
      continue;
    }

    // Ambiguous claims commit to nothing, so there is no committed mass to
    // discount and a discount note would describe a reduction that never
    // happened. claimToMass already returns VACUOUS for these.
    if (c.assertion === "ambiguous") {
      masses.push(claimToMass(c.assertion, c.strength));
      continue;
    }

    // Admitted: apply the evidence-quality discount.
    //
    // This is what makes an unopposed-but-weak evidence set abstain rather than
    // advance. Four clean rodent studies with no exposure data do not license a
    // safety conclusion just because nothing contradicts them - so most of their
    // mass belongs in Theta, not on "safe".
    const { factor, reasons } = relevanceDiscount(c, ruleset);
    masses.push(soften(claimToMass(c.assertion, c.strength), factor));

    if (reasons.length > 0) {
      discountNotes.set(
        c.id,
        ` Weight reduced to ${(factor * 100).toFixed(0)}% of stated confidence: ` +
        reasons.map((r) => r.rationale).join(" "),
      );
    }
  }

  // Fold discount explanations into the EXISTING step for each claim rather than
  // appending new ones - exactly one trace step per claim is an invariant the UI
  // and the tests both rely on.
  const enrichedTrace: TraceStep[] = trace.map((step) => {
    const note = discountNotes.get(step.claimId);
    return note ? { ...step, rationale: step.rationale + note } : step;
  });

  const fused = fuse(masses);

  // R6 needs no separate mechanism here: Dempster's rule of combination IS the
  // concordance mechanism. Two independent 0.18 "safe" claims fuse to 0.3276 -
  // agreement between independent streams already raises belief more than one
  // source repeating itself, which is exactly R6's registered statement. The
  // ruleset's own framework note says so: "Formalised by the evidence fusion
  // layer; independence is at the stream level."
  //
  // An earlier draft ALSO applied an explicit multiplicative boost on top. It was
  // removed for three reasons, in order of severity:
  //   1. It could invert the verdict. A stream-count majority overrode a
  //      Dempster-Shafer mass majority: safe 0.18 + safe 0.18 + toxic 0.33 fuses
  //      to toxic 0.2488 vs safe 0.2461, yet the boost lifted safe to 0.2543 and
  //      reason() returned "advance" while still reporting belief 0.2488. The
  //      output contradicted itself and no field explained why.
  //   2. It double-counted concordance, which fusion had already rewarded.
  //   3. Its 0.25 coefficient lived outside the pre-registered, hashed ruleset,
  //      so "where did 0.25 come from?" had no defensible answer.
  const mass = fused.mass;

  const belief = mass.toxic;
  const plausibility = mass.toxic + mass.uncommitted;

  const abst = shouldAbstain({ belief, plausibility, conflictMass: fused.conflictMass, statuses, claims, ruleset });

  let verdict: Verdict;
  let verdictReason = abst.reason;
  if (abst.abstain) verdict = "abstain";
  else if (mass.toxic > mass.safe) verdict = "do_not_advance";
  else if (mass.safe > mass.toxic) verdict = "advance";
  else {
    // Exactly balanced. Declining is the honest answer, and it needs to SAY so -
    // an abstention the trace cannot explain undercuts the claim that abstention
    // is a first-class output.
    verdict = "abstain";
    verdictReason = "Evidence for and against is exactly balanced; no side can be preferred.";
  }

  // An argument survives when nothing DEFEATED it - which includes `undecided`.
  // Undecided is the state of being locked in a mutual-defeat cycle, so a case
  // where four claims deadlock two-against-two is maximally contested, not
  // uncontested. Filtering to admitted|downweighted here (as an earlier draft did)
  // reported `contested: false` on exactly that input, because vacuous masses also
  // generate no conflict mass - four visibly deadlocked claims with the field
  // beside them saying there was no disagreement.
  //
  // NOTE: this is deliberately NOT the pre-registered conflict-subset definition
  // used for the Task 15 headline. That one is fixed in spec §11 as a property of
  // the RAW claims, evaluated by the harness before any rule runs, so it cannot
  // move when rule behaviour changes. `contested` is the per-result display field.
  const undefeated = claims.filter((c) => statuses.get(c.id) !== "defeated");
  const contested = detectConflict(undefeated).conflicting || fused.conflictMass > 0;

  const withReason: TraceStep[] = verdictReason
    ? [...enrichedTrace, { claimId: "__verdict__", status: "undecided" as const, kind: "verdict" as const, rationale: verdictReason }]
    : enrichedTrace;

  return {
    verdict,
    contested,
    belief,
    plausibility,
    mass,
    conflictMass: fused.conflictMass,
    trace: withReason,
    counterfactual: withExtras ? findCounterfactual(claims, ruleset, verdict, bare) : null,
    nextExperiment: null, // Task 9
    rulesetHash,
  };
}
```

- [ ] **Step 5: Run the full engine suite to verify everything passes**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine && npm run lint && npm run typecheck
```

Expected: PASS — all engine tests including Task 3's fusion tests (the `fuse` change was additive), 1000-run determinism gives exactly one hash, lint and typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/engine && git commit -m "Add reason() and the enforced determinism guarantee

Wires argue -> fuse -> abstain into a Reasoning result. Status decides how a
claim reaches fusion: admitted contributes full mass, R4-downweighted
contributes softened mass, UNDECIDED contributes pure ignorance rather than a
vote, and defeated is excluded from fusion but RETAINED IN THE TRACE - a test
asserts a very strong defeated claim cannot drag belief, and that it still
appears in the output.

Determinism is now a measured property, not a claim: one case, 1000 runs, one
output hash. A second test asserts reason() does not mutate its inputs.

fuse() gained a `mass` field additively so reason() can compare belief in
toxic against belief in safe; Task 3's tests are unaffected.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Exhaustive counterfactual

**Files:**
- Create: `packages/engine/src/counterfactual.ts`
- Modify: `packages/engine/src/index.ts` — populate `counterfactual`
- Test: `packages/engine/test/counterfactual.test.ts`

**Interfaces:**
- Consumes: `reason` (injected to avoid a circular import), `EvidenceClaim`, `Ruleset`, `Counterfactual`
- Produces: `findCounterfactual(claims, ruleset, currentVerdict, reasonFn): Counterfactual | null`

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/counterfactual.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reason, reasonVerdictOnly } from "../src/index.js";
import { findCounterfactual } from "../src/counterfactual.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { Assertion, EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;
const TARGETS: Assertion[] = ["toxic", "safe", "ambiguous"];

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    ...over,
  };
}

const find = (claims: EvidenceClaim[]) =>
  findCounterfactual(claims, RS, reasonVerdictOnly(claims, RS).verdict, reasonVerdictOnly);

/**
 * Brute-force oracle, built to be INDEPENDENT of the implementation rather than a
 * paraphrase of it. The implementation walks nested claim/target loops; this
 * enumerates subsets as bitmasks and assignments as base-3 counters. Same
 * question, different construction, so agreement is evidence rather than an echo.
 *
 * Shares exactly one rule with the implementation on purpose: every flip must be a
 * genuine change. Without that they would disagree legitimately, since a "pair"
 * containing a no-op is really a single.
 */
function oracleMinSize(claims: EvidenceClaim[]): number | null {
  const current = reasonVerdictOnly(claims, RS).verdict;
  const n = claims.length;
  for (const wantSize of [1, 2]) {
    for (let mask = 1; mask < (1 << n); mask++) {
      const idx: number[] = [];
      for (let b = 0; b < n; b++) if (mask & (1 << b)) idx.push(b);
      if (idx.length !== wantSize) continue;

      const combos = 3 ** wantSize;
      for (let code = 0; code < combos; code++) {
        const assign: Assertion[] = [];
        let rest = code;
        for (let k = 0; k < wantSize; k++) {
          assign.push(TARGETS[rest % 3]!);
          rest = Math.floor(rest / 3);
        }
        if (assign.some((t, k) => claims[idx[k]!]!.assertion === t)) continue;

        const flipped = claims.map((c, i) => {
          const k = idx.indexOf(i);
          return k === -1 ? c : { ...c, assertion: assign[k]! };
        });
        if (reasonVerdictOnly(flipped, RS).verdict !== current) return wantSize;
      }
    }
  }
  return null;
}

describe("findCounterfactual", () => {
  it("finds a single-claim flip when one exists", () => {
    const claims = [
      claim({ id: "a", assertion: "safe", strength: 0.9, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
    ];
    const before = reasonVerdictOnly(claims, RS).verdict;
    const cf = find(claims);
    expect(cf).not.toBeNull();
    expect(cf!.flips).toHaveLength(1);
    expect(cf!.newVerdict).not.toBe(before);

    // The reported flip must actually produce the reported verdict. Without this
    // the whole output could be internally inconsistent and still "pass".
    const applied = claims.map((c) =>
      c.id === cf!.flips[0]!.claimId ? { ...c, assertion: cf!.flips[0]!.to } : c);
    expect(reasonVerdictOnly(applied, RS).verdict).toBe(cf!.newVerdict);
  });

  it("prefers the smallest flip - reports a single, never a pair, when a single works", () => {
    const claims = [
      claim({ id: "a", assertion: "safe", strength: 0.95, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.95, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
      claim({ id: "c", assertion: "safe", strength: 0.95, stream: "invivo_rodent", system: "rodent", exposureRelevant: true }),
    ];
    const cf = find(claims);
    // Asserted UNCONDITIONALLY. An earlier draft wrapped this in `if (cf)`, which
    // passes silently whenever the search returns null - the one outcome that
    // would mean the search is broken.
    expect(cf).not.toBeNull();
    expect(cf!.flips).toHaveLength(1);
    expect(oracleMinSize(claims)).toBe(1);
  });

  it("returns null when NO combination of one or two flips changes the verdict", () => {
    // A real case, not the empty list. Four heavily-discounted rodent claims: every
    // one is non-human (R1, x0.1) and most carry no exposure margin, so the fused
    // mass sits far inside the abstention gap. Flipping one or two of them cannot
    // move enough mass to escape, whichever way they are flipped.
    const stuck = [
      claim({ id: "r1", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent", klimisch: 3 }),
      claim({ id: "r2", assertion: "safe", strength: 0.85, system: "rodent", stream: "invivo_rodent", klimisch: 3 }),
      claim({ id: "r3", assertion: "safe", strength: 0.8, system: "nonrodent", stream: "invivo_nonrodent", klimisch: 3 }),
      claim({ id: "r4", assertion: "safe", strength: 0.8, system: "nonrodent", stream: "invivo_nonrodent", klimisch: 3 }),
    ];
    expect(reasonVerdictOnly(stuck, RS).verdict).toBe("abstain");
    expect(find(stuck)).toBeNull();
    // The independent oracle must agree it is genuinely unreachable, so this is a
    // real negative rather than a search that gave up.
    expect(oracleMinSize(stuck)).toBeNull();
  });

  it("returns null on no evidence at all", () => {
    expect(find([])).toBeNull();
  });

  it("never reports a flip that is not a change, so flips.length is the true minimal size", () => {
    const claims = [
      claim({ id: "a", assertion: "toxic", strength: 0.9, exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.5, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
      claim({ id: "c", assertion: "safe", strength: 0.5, stream: "toxicogenomics", exposureRelevant: true, measuresKeyEvent: "KE:3" }),
    ];
    const cf = find(claims);
    if (cf) {
      for (const f of cf.flips) {
        const original = claims.find((c) => c.id === f.claimId)!;
        expect(f.to).not.toBe(original.assertion);
      }
      expect(new Set(cf.flips.map((f) => f.claimId)).size).toBe(cf.flips.length);
    }
    // Guard against the block above being skipped entirely.
    expect(cf === null || cf.flips.length > 0).toBe(true);
  });

  it("is INDEPENDENT OF CLAIM ORDER - the same evidence gives the same counterfactual", () => {
    // The Task 5 ruling on `defeatedBy` attribution applies here too: a trace is a
    // UI output, so the same situation must give the same explanation. Returning
    // the first hit found would make this depend on load order.
    const claims = [
      claim({ id: "a", assertion: "toxic", strength: 0.7, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.7, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
      claim({ id: "c", assertion: "safe", strength: 0.6, stream: "toxicogenomics", exposureRelevant: true, measuresKeyEvent: "KE:3" }),
      claim({ id: "d", assertion: "toxic", strength: 0.6, stream: "qsar", system: "in_silico" }),
    ];
    const forward = find(claims);
    const reversed = find([...claims].reverse());
    const rotated = find([claims[2]!, claims[3]!, claims[0]!, claims[1]!]);
    expect(reversed).toEqual(forward);
    expect(rotated).toEqual(forward);
  });

  it("SEARCHES HETEROGENEOUS PAIRS - finds a flip that no single shared target could express", () => {
    // Measured on 4,000 random cases: the narrower search that flips both claims of
    // a pair to the SAME assertion never actually disagrees with this one, because
    // homogeneous assignments dominate - "both to X" moves mass further toward a
    // committed verdict than a mixed pair does, and "both to ambiguous" dominates a
    // mixed pair for reaching abstention. So this cannot be tested against the real
    // engine: no natural input distinguishes them.
    //
    // It is still worth GUARANTEEING rather than leaving to that argument, because
    // the spec promises "exhaustive, not heuristic - exact, with nothing to defend",
    // and because Tasks 11 and 12 introduce discount profiles this corpus does not
    // contain. So the property is tested where it lives: `reasonFn` is an injected
    // seam, so a stub can make exactly one heterogeneous assignment decisive. A
    // search that only ever tries shared targets returns null here.
    const claims = [
      claim({ id: "a", assertion: "toxic" }),
      claim({ id: "b", assertion: "safe" }),
    ];
    let calls = 0;
    const stub = (cs: EvidenceClaim[]): ReturnType<typeof reasonVerdictOnly> => {
      calls++;
      const a = cs.find((c) => c.id === "a")!.assertion;
      const b = cs.find((c) => c.id === "b")!.assertion;
      // Decisive ONLY for a -> safe together with b -> ambiguous. Every other
      // assignment, including all three homogeneous ones, keeps the verdict.
      const flipped = a === "safe" && b === "ambiguous";
      return { verdict: flipped ? "advance" : "abstain" } as ReturnType<typeof reasonVerdictOnly>;
    };

    const cf = findCounterfactual(claims, RS, "abstain", stub);
    expect(cf).not.toBeNull();
    expect(cf!.newVerdict).toBe("advance");
    expect(cf!.flips).toEqual([
      { claimId: "a", to: "safe" },
      { claimId: "b", to: "ambiguous" },
    ]);
    // Sanity: the stub really was consulted many times, so this is not passing by
    // some short-circuit that never evaluated anything.
    expect(calls).toBeGreaterThan(4);
  });

  it("AGREES WITH THE BRUTE-FORCE ORACLE on 120 deterministic random cases", () => {
    let s = 987654;
    const next = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const streams = ["qsar", "cytotox", "toxicogenomics", "transporter"] as const;

    let nonNull = 0;
    for (let trial = 0; trial < 120; trial++) {
      const n = 1 + Math.floor(next() * 4);
      const claims = Array.from({ length: n }, (_, i) => {
        const stream = streams[Math.floor(next() * streams.length)]!;
        return claim({
          id: `c${i}`,
          stream,
          // qsar claims must stay in_silico-consistent: the schema forbids a
          // computational prediction from asserting a MEASURED key event.
          system: stream === "qsar" ? "in_silico" : "human",
          assertion: TARGETS[Math.floor(next() * TARGETS.length)]!,
          strength: 0.4 + next() * 0.6,
          klimisch: (1 + Math.floor(next() * 4)) as 1 | 2 | 3 | 4,
          exposureRelevant: next() < 0.5 ? true : null,
        });
      });
      const found = find(claims);
      const expected = oracleMinSize(claims);
      expect(found === null, `trial ${trial}: null disagreement`).toBe(expected === null);
      if (found && expected !== null) {
        expect(found.flips.length, `trial ${trial}: size disagreement`).toBe(expected);
      }
      if (found) nonNull++;
    }
    // The corpus must actually exercise the search. If every trial came back null
    // the agreement above would be unanimous and worthless.
    expect(nonNull).toBeGreaterThan(20);
  });
});

describe("reason() integration", () => {
  it("populates counterfactual, and the reported flip really does produce the reported verdict", () => {
    const claims = [
      claim({ id: "a", assertion: "safe", strength: 0.9, stream: "cytotox", exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, stream: "transporter", exposureRelevant: true, measuresKeyEvent: "KE:2" }),
    ];
    const r = reason(claims, RS);
    expect(r.counterfactual).not.toBeNull();
    const applied = claims.map((c) => {
      const f = r.counterfactual!.flips.find((x) => x.claimId === c.id);
      return f ? { ...c, assertion: f.to } : c;
    });
    expect(reasonVerdictOnly(applied, RS).verdict).toBe(r.counterfactual!.newVerdict);
    expect(r.counterfactual!.newVerdict).not.toBe(r.verdict);
  });

  it("reasonVerdictOnly skips the search but returns the identical verdict and range", () => {
    const claims = [
      claim({ id: "a", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1, exposureRelevant: true, measuresKeyEvent: "KE:1" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, system: "rodent", stream: "invivo_rodent", klimisch: 2 }),
    ];
    const full = reason(claims, RS);
    const cheap = reasonVerdictOnly(claims, RS);
    expect(cheap.counterfactual).toBeNull();
    expect(full.counterfactual).not.toBeNull();
    // Everything the sampling path reads must be bit-identical, or Task 15's
    // robustness numbers would describe a different engine than the one shipped.
    expect(cheap.verdict).toBe(full.verdict);
    expect(cheap.belief).toBe(full.belief);
    expect(cheap.plausibility).toBe(full.plausibility);
    expect(cheap.mass).toEqual(full.mass);
    expect(cheap.conflictMass).toBe(full.conflictMass);
    expect(cheap.contested).toBe(full.contested);
    expect(cheap.trace).toEqual(full.trace);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/counterfactual.test.ts
```

Expected: FAIL — `Cannot find module '../src/counterfactual.js'`

- [ ] **Step 3: Write the implementation**

Create `packages/engine/src/counterfactual.ts`:

```ts
import type { Assertion, Counterfactual, EvidenceClaim, Reasoning, Ruleset, Verdict } from "./types.js";

/** Fixed iteration order, so the canonical tie-break below is reproducible. */
const TARGETS: readonly Assertion[] = ["toxic", "safe", "ambiguous"] as const;

const targetRank = (a: Assertion): number => TARGETS.indexOf(a);

type Flip = { claimId: string; to: Assertion };

/**
 * "What would have to change for this verdict to flip?"
 *
 * EXHAUSTIVE, not heuristic — and exhaustive in the sense the spec promises,
 * which is stronger than it first looks. An earlier draft searched pairs by
 * flipping BOTH claims to the SAME assertion, which is 3 combinations per pair
 * rather than 9, and would have missed any minimal answer of the form "this
 * toxic reading would have to become safe AND that one would have to become
 * ambiguous". The spec's claim is "exact, with nothing to defend", so the search
 * covers every assignment of target assertions to the chosen claims.
 *
 * Cost, with the six-claims-per-compound ceiling: 6x2 = 12 singles, plus 15
 * pairs x (3x3 - the no-op combinations) = at most 120 more. Around 130
 * evaluations of a pure microsecond-scale function per call. (The plan's
 * Task 15 note estimated 21; that was the homogeneous count and is corrected
 * there.) Sampling paths must use the extras-free entry point, which is exactly
 * why `reasonVerdictOnly` exists.
 *
 * A REPORTED PAIR ALWAYS REQUIRES BOTH CLAIMS TO CHANGE. Combinations where
 * either target equals the claim's existing assertion are skipped, because that
 * is a single flip wearing a pair's clothing, and the singles pass has already
 * rejected it.
 *
 * `reasonFn` is injected rather than imported to keep index.ts -> here a one-way
 * dependency.
 */
export function findCounterfactual(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  currentVerdict: Verdict,
  reasonFn: (claims: EvidenceClaim[], ruleset: Ruleset) => Reasoning,
): Counterfactual | null {
  const apply = (flips: Flip[]): EvidenceClaim[] => {
    const byId = new Map(flips.map((f) => [f.claimId, f.to]));
    return claims.map((c) => {
      const to = byId.get(c.id);
      return to === undefined ? c : { ...c, assertion: to };
    });
  };

  /**
   * Every solution of a given size, not just the first.
   *
   * Collecting all of them costs nothing at this scale and buys a property the
   * project already ruled it wants: the same situation must produce the same
   * explanation. Returning the first hit would make the reported counterfactual
   * depend on the order claims happened to load in, which is the defect fixed in
   * `defeatedBy` attribution during Task 5.
   */
  const solutionsOfSize = (size: 1 | 2): { flips: Flip[]; newVerdict: Verdict }[] => {
    const found: { flips: Flip[]; newVerdict: Verdict }[] = [];

    if (size === 1) {
      for (const c of claims) {
        for (const to of TARGETS) {
          if (c.assertion === to) continue;
          const flips: Flip[] = [{ claimId: c.id, to }];
          const v = reasonFn(apply(flips), ruleset).verdict;
          if (v !== currentVerdict) found.push({ flips, newVerdict: v });
        }
      }
      return found;
    }

    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const a = claims[i]!;
        const b = claims[j]!;
        // Two claims sharing an id are one claim; a "pair" over them is a single
        // flip and `apply` would rewrite both anyway.
        if (a.id === b.id) continue;
        for (const toA of TARGETS) {
          if (a.assertion === toA) continue;
          for (const toB of TARGETS) {
            if (b.assertion === toB) continue;
            const flips: Flip[] = [{ claimId: a.id, to: toA }, { claimId: b.id, to: toB }];
            const v = reasonFn(apply(flips), ruleset).verdict;
            if (v !== currentVerdict) found.push({ flips, newVerdict: v });
          }
        }
      }
    }
    return found;
  };

  /**
   * Total order over solutions of equal size: claim ids first (sorted, so the
   * key does not depend on input order), then target assertions in TARGETS
   * order. Deterministic and input-order-independent.
   */
  const key = (s: { flips: Flip[] }): string => {
    const sorted = [...s.flips].sort((x, y) => (x.claimId < y.claimId ? -1 : x.claimId > y.claimId ? 1 : 0));
    // JSON rather than a delimiter-joined string. Claim ids come from external
    // data files, so any printable separator could appear inside an id and make
    // two different solutions collide on one key; JSON quotes and escapes each
    // field, so the encoding is injective without picking a magic character.
    return JSON.stringify(sorted.map((f) => [f.claimId, targetRank(f.to)]));
  };

  for (const size of [1, 2] as const) {
    const found = solutionsOfSize(size);
    if (found.length === 0) continue;
    const best = found.reduce((lo, cand) => (key(cand) < key(lo) ? cand : lo));
    // Report the flips in sorted-id order too, so the output itself is stable
    // rather than merely the choice between candidates.
    const flips = [...best.flips].sort((x, y) => (x.claimId < y.claimId ? -1 : x.claimId > y.claimId ? 1 : 0));
    return { flips, newVerdict: best.newVerdict };
  }

  return null;
}
```

- [ ] **Step 4: Wire it into `reason()`**

In `packages/engine/src/index.ts`, add the import and replace the `counterfactual: null` line.

```ts
import { findCounterfactual } from "./counterfactual.js";
export { findCounterfactual } from "./counterfactual.js";
```

Replace the `return { ... }` block's counterfactual field. Because the search calls `reason` recursively, guard against infinite recursion with an internal flag: extract the body of `reason` into `reasonCore(claims, ruleset, rulesetHash, withExtras)` and have `reason` call it with `withExtras = true`, while the counterfactual search passes a bound `reasonCore(..., false)`.

**Also export `reasonVerdictOnly` here, rather than waiting for Task 15.** Task 15's plan
introduces it, but the flag it needs is created by *this* task, and leaving the public
extras-free entry point until later means Task 9's planner — which re-runs the engine per
candidate outcome — has nothing cheap to call and would recurse through the counterfactual
search on every probe.

> **Excerpt.** The authoritative `index.ts` listing is in Task 7 and is kept byte-identical
> to the shipped source by `tools/sync_plan.py`. The elision below is real elision, not a
> claim that the omitted lines are unchanged.

```ts
export function reason(claims: EvidenceClaim[], ruleset: Ruleset, rulesetHash = ""): Reasoning {
  return reasonCore(claims, ruleset, rulesetHash, true);
}

/** The verdict and the range only — for sampling paths that read nothing else. */
export function reasonVerdictOnly(claims: EvidenceClaim[], ruleset: Ruleset): Reasoning {
  return reasonCore(claims, ruleset, "", false);
}

/** Extras-free recursion target, so the search cannot re-enter itself. */
const bare = (c: EvidenceClaim[], rs: Ruleset): Reasoning => reasonCore(c, rs, "", false);

function reasonCore(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  rulesetHash: string,
  withExtras: boolean,
): Reasoning {
  /* ...argue -> discount -> fuse -> abstain -> verdict, exactly as in Task 7... */
  return {
    verdict, contested, belief, plausibility, mass,
    conflictMass: fused.conflictMass,
    trace: withReason,
    counterfactual: withExtras ? findCounterfactual(claims, ruleset, verdict, bare) : null,
    nextExperiment: null, // Task 9
    rulesetHash,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine && npm run lint && npm run typecheck
```

Expected: PASS — including the 120-trial oracle agreement test and the still-green 1000-run determinism test.

- [ ] **Step 6: Commit**

```bash
git add packages/engine && git commit -m "Add exhaustive counterfactual search

Searches single flips then pairs across all three target assertions and
returns the smallest set that changes the verdict. Exhaustive rather than
heuristic: at most six claims per compound means under 100 evaluations of a
pure microsecond function, so there is no approximation to defend.

Correctness is established against a brute-force oracle over 120 deterministic
random cases, asserting both the same null/non-null answer and the same
minimal flip size.

reason() is split into a public wrapper and reasonCore with a withExtras flag,
so the counterfactual search recurses into the bare engine and cannot loop.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Argument-structure-driven value-of-information planner

**This is the mechanism the spec names as genuinely novel (§2a).** The planner does not ask "which assay is generally informative?" It asks *"which rule is doing the defeating, and what evidence would overturn that specific rule?"*

**Files:**
- Create: `packages/engine/src/plan.ts`
- Create: `data/out/assays.json`
- Modify: `packages/engine/src/index.ts` — populate `nextExperiment`
- Test: `packages/engine/test/plan.test.ts`

**Interfaces:**
- Consumes: `EvidenceClaim`, `Ruleset`, `RuleId`, `NextExperiment`, injected `reasonFn`
- Produces:
  - `interface AssayOperator { id: string; name: string; cost: number; produces: Pick<EvidenceClaim, "stream" | "system" | "measuresKeyEvent" | "exposureRelevant" | "inApplicabilityDomain" | "klimisch">; priorToxic: number }`
  - `pivotalRules(claims, ruleset, reasonFn): RuleId[]`
  - `planNextExperiment(claims, ruleset, assays, reasonFn): NextExperiment | null`

- [ ] **Step 1: Write the assay operator catalogue**

Create `data/out/assays.json`. `priorToxic` is **expert-elicited, not learned** — the spec discloses this and Task 15 measures its sensitivity.

```json
{
  "note": "Candidate confirmatory assays as planner operators. priorToxic values are expert-elicited from literature, NOT learned from data - see spec 5 and the sensitivity analysis in metrics.",
  "assays": [
    {
      "id": "murine-cyp-induction",
      "name": "Murine CYP-induction study at clinically relevant dose",
      "cost": 40,
      "produces": { "stream": "toxicogenomics", "system": "rodent", "measuresKeyEvent": "KE:CYP-INDUCTION", "exposureRelevant": true, "inApplicabilityDomain": true, "klimisch": 1 },
      "priorToxic": 0.35
    },
    {
      "id": "human-hepatocyte-spheroid",
      "name": "3D human hepatocyte spheroid cytotoxicity, clinical exposure range",
      "cost": 25,
      "produces": { "stream": "cytotox", "system": "human", "measuresKeyEvent": "KE:HEPATOCYTE-DEATH", "exposureRelevant": true, "inApplicabilityDomain": true, "klimisch": 1 },
      "priorToxic": 0.3
    },
    {
      "id": "bsep-inhibition",
      "name": "BSEP inhibition assay with exposure-matched margin",
      "cost": 12,
      "produces": { "stream": "transporter", "system": "human", "measuresKeyEvent": "KE:BSEP-INHIBITION", "exposureRelevant": true, "inApplicabilityDomain": true, "klimisch": 1 },
      "priorToxic": 0.25
    },
    {
      "id": "mito-tox-panel",
      "name": "Mitochondrial toxicity panel, human hepatocytes",
      "cost": 15,
      "produces": { "stream": "cytotox", "system": "human", "measuresKeyEvent": "KE:MITO-DYSFUNCTION", "exposureRelevant": true, "inApplicabilityDomain": true, "klimisch": 2 },
      "priorToxic": 0.22
    },
    {
      "id": "readacross-refinement",
      "name": "Structural read-across refinement against an expanded analogue set",
      "cost": 4,
      "produces": { "stream": "qsar", "system": "in_silico", "measuresKeyEvent": null, "exposureRelevant": null, "inApplicabilityDomain": true, "klimisch": 3 },
      "priorToxic": 0.2
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/engine/test/plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reason } from "../src/index.js";
import { pivotalRules, planNextExperiment, type AssayOperator } from "../src/plan.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import assayFile from "../../../data/out/assays.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;
const ASSAYS = (assayFile as { assays: AssayOperator[] }).assays;
const bare = (c: EvidenceClaim[], rs: Ruleset) => reason(c, rs);

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("pivotalRules", () => {
  it("identifies R1 as pivotal when R1 is what defeated the opposing claim", () => {
    const claims = [
      claim({ id: "h", assertion: "toxic", system: "human", klimisch: 1, strength: 0.9 }),
      claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 2, strength: 0.9 }),
    ];
    expect(pivotalRules(claims, RS, bare)).toContain("R1");
  });

  it("returns no pivotal rule when no rule fired", () => {
    const claims = [claim({ id: "a", assertion: "toxic" })];
    expect(pivotalRules(claims, RS, bare)).toHaveLength(0);
  });
});

describe("planNextExperiment", () => {
  it("recommends nothing when the case is already settled with a narrow gap", () => {
    const claims = [
      claim({ id: "a", assertion: "safe", strength: 0.98, stream: "cytotox" }),
      claim({ id: "b", assertion: "safe", strength: 0.98, stream: "transporter" }),
      claim({ id: "c", assertion: "safe", strength: 0.98, stream: "toxicogenomics" }),
    ];
    const r = reason(claims, RS);
    if (r.verdict !== "abstain" && r.plausibility - r.belief < 0.2) {
      expect(planNextExperiment(claims, RS, ASSAYS, bare)).toBeNull();
    }
  });

  it("recommends an assay when the case abstains, and names what it resolves", () => {
    // Two clean animal studies with untested margins: nothing human-relevant.
    const claims = [
      claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", exposureRelevant: null, strength: 0.6 }),
      claim({ id: "p", assertion: "safe", system: "nonrodent", stream: "invivo_nonrodent", exposureRelevant: null, strength: 0.6 }),
    ];
    const rec = planNextExperiment(claims, RS, ASSAYS, bare);
    expect(rec).not.toBeNull();
    expect(rec!.assay).toBeTruthy();
    expect(rec!.expectedGapReduction).toBeGreaterThan(0);
    expect(rec!.score).toBeGreaterThan(0);
    expect(rec!.rationale.length).toBeGreaterThan(10);
  });

  it("scores by information gain PER UNIT COST, not raw gain", () => {
    const claims = [claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", exposureRelevant: null, strength: 0.5 })];
    const cheap: AssayOperator[] = [{ ...ASSAYS[2]!, id: "cheap", cost: 1 }];
    const same: AssayOperator[] = [{ ...ASSAYS[2]!, id: "pricey", cost: 1000 }];
    const a = planNextExperiment(claims, RS, cheap, bare);
    const b = planNextExperiment(claims, RS, same, bare);
    if (a && b) expect(a.score).toBeGreaterThan(b.score);
  });

  it("is deterministic across repeated calls", () => {
    const claims = [claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", exposureRelevant: null })];
    const runs = Array.from({ length: 25 }, () => JSON.stringify(planNextExperiment(claims, RS, ASSAYS, bare)));
    expect(new Set(runs).size).toBe(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/plan.test.ts
```

Expected: FAIL — `Cannot find module '../src/plan.js'`

- [ ] **Step 4: Write the implementation**

Create `packages/engine/src/plan.ts`:

```ts
import { argue } from "./argue.js";
import type { EvidenceClaim, NextExperiment, Reasoning, RuleId, Ruleset } from "./types.js";

export interface AssayOperator {
  id: string;
  name: string;
  /** Relative cost. Units are arbitrary but must be consistent across the catalogue. */
  cost: number;
  produces: Pick<
    EvidenceClaim,
    "stream" | "system" | "measuresKeyEvent" | "exposureRelevant" | "inApplicabilityDomain" | "klimisch"
  >;
  /** EXPERT-ELICITED prior that this assay returns a toxic result. Not learned. */
  priorToxic: number;
}

type ReasonFn = (claims: EvidenceClaim[], ruleset: Ruleset) => Reasoning;

/**
 * Which rules is the verdict actually resting on?
 *
 * A rule is pivotal when disabling it changes the verdict. This is the
 * mechanism the spec calls novel: the planner is driven by the ARGUMENT
 * STRUCTURE, not by which assay is generally informative.
 */
export function pivotalRules(claims: EvidenceClaim[], ruleset: Ruleset, reasonFn: ReasonFn): RuleId[] {
  const baseline = reasonFn(claims, ruleset).verdict;
  const fired = new Set(argue(claims, ruleset).attacks.map((a) => a.byRule));
  const pivotal: RuleId[] = [];
  for (const id of fired) {
    const without: Ruleset = { ...ruleset, rules: ruleset.rules.map((r) => (r.id === id ? { ...r, enabled: false } : r)) };
    if (reasonFn(claims, without).verdict !== baseline) pivotal.push(id);
  }
  return pivotal.sort();
}

/**
 * Pick the single assay that most reduces the belief-plausibility gap per unit
 * cost.
 *
 * For each candidate we simulate both possible outcomes weighted by the
 * expert-elicited prior, take the expected post-assay gap, and score
 * (gap reduction) / cost. Ties break on assay id so the result is stable.
 */
export function planNextExperiment(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  assays: AssayOperator[],
  reasonFn: ReasonFn,
): NextExperiment | null {
  const before = reasonFn(claims, ruleset);
  const gapBefore = before.plausibility - before.belief;

  // Nothing to resolve: a settled verdict with a narrow range needs no assay.
  if (before.verdict !== "abstain" && gapBefore < 0.2) return null;

  const pivotal = pivotalRules(claims, ruleset, reasonFn);
  let best: NextExperiment | null = null;

  for (const assay of [...assays].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    let expectedGapAfter = 0;
    for (const [assertion, p] of [["toxic", assay.priorToxic], ["safe", 1 - assay.priorToxic]] as const) {
      const hypothetical: EvidenceClaim = {
        id: `__hypothetical__${assay.id}`,
        compoundId: claims[0]?.compoundId ?? "X",
        assertion,
        strength: 0.85,
        availableFrom: "0000-01-01",
        provenance: { kind: "database", source: `planned:${assay.id}`, retrieved: "0000-01-01" },
        ...assay.produces,
      };
      const after = reasonFn([...claims, hypothetical], ruleset);
      expectedGapAfter += p * (after.plausibility - after.belief);
    }

    const reduction = gapBefore - expectedGapAfter;
    if (reduction <= 0) continue;
    const score = reduction / assay.cost;
    if (best && score <= best.score) continue;

    const resolves = pivotal.find((id) => resolvesRule(id, assay)) ?? null;
    best = {
      assay: assay.name,
      resolvesRule: resolves,
      expectedGapReduction: reduction,
      cost: assay.cost,
      score,
      rationale: resolves
        ? `${assay.name} produces evidence that would overturn ${resolves}, the rule the current verdict rests on. Expected gap reduction ${reduction.toFixed(2)} at cost ${assay.cost}.`
        : `${assay.name} narrows the belief-plausibility gap by an expected ${reduction.toFixed(2)} at cost ${assay.cost}.`,
    };
  }

  return best;
}

/** Would this assay produce evidence capable of overturning the given rule? */
function resolvesRule(id: RuleId, assay: AssayOperator): boolean {
  switch (id) {
    case "R1": return assay.produces.system === "human";
    case "R2": return assay.produces.measuresKeyEvent !== null;
    case "R3": return assay.produces.exposureRelevant === true;
    case "R4": return assay.produces.inApplicabilityDomain === true;
    case "R5": return assay.produces.klimisch === 1;
    case "R6": return true;
    default: return false;
  }
}
```

- [ ] **Step 5: Wire it into `reason()`**

In `packages/engine/src/index.ts`:

```ts
import { planNextExperiment, type AssayOperator } from "./plan.js";
export { pivotalRules, planNextExperiment, type AssayOperator } from "./plan.js";
```

Add an optional fourth parameter and populate the field:

```ts
export function reason(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  rulesetHash = "",
  assays: AssayOperator[] = [],
): Reasoning {
  return reasonCore(claims, ruleset, rulesetHash, true, assays);
}
```

…and in `reasonCore`'s return:

```ts
    nextExperiment: withExtras && assays.length > 0 ? planNextExperiment(claims, ruleset, assays, bare) : null,
```

- [ ] **Step 6: Run the full suite to verify everything passes**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine && npm run lint && npm run typecheck
```

Expected: PASS across all engine tests. Determinism still yields one hash.

- [ ] **Step 7: Commit**

```bash
git add packages/engine data/out/assays.json && git commit -m "Add argument-structure-driven value-of-information planner

This is the mechanism the spec claims as genuinely novel. The planner does not
ask which assay is generally informative - it identifies the PIVOTAL RULES by
disabling each fired rule and checking whether the verdict changes, then
prefers assays producing evidence capable of overturning those specific rules.

Scoring is expected belief-plausibility gap reduction per unit cost, with both
possible assay outcomes weighted by an expert-elicited prior. The priors are
labelled as elicited rather than learned in data/out/assays.json, and Task 15
quantifies how much the recommendation depends on them.

Deterministic: candidates are evaluated in sorted id order and a 25-run test
asserts a single output.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: DILIrank ingest, structure crosswalk, and the three-way split

**The split must be committed before any model is fitted.** That ordering is what makes the reported numbers valid — see spec §8.

**A deviation from the spec's data table, made deliberately:** the QSAR stream (Task 11) trains on the **DILIrank training split**, not on Therapeutics Data Commons. Using our own split removes cross-dataset InChIKey overlap as a leakage vector entirely, rather than trying to subtract it. TDC/ADMET-AI stays available as optional enrichment but is no longer on the critical path. This is simpler *and* more defensible: one dataset, one split, no overlap question to answer.

**Files:**
- Create: `data/prep/ingest_dilirank.py`, `data/prep/make_splits.py`
- Create: `data/prep/tests/test_splits.py`, `data/prep/pytest.ini`
- Modify: `data/prep/requirements.txt` — add pytest

**Interfaces:**
- Consumes: `data/raw/dilirank.xlsx`, `rules/ruleset-v1.0.json` (binarisation policy)
- Produces:
  - `data/out/compounds.json` — `{generatedAt, compounds: [{compoundId, name, smiles, inchikey, dilirankLabel, y}]}` where `compoundId` **is** the InChIKey
  - `data/out/splits.json` — `{seed, sizes, train: [inchikey], calibration: [...], test: [...]}`

- [ ] **Step 1: Add pytest and write the failing split tests**

Append to `data/prep/requirements.txt`:

```
pytest==8.3.4
```

Create `data/prep/pytest.ini`:

```ini
[pytest]
testpaths = tests
```

Create `data/prep/tests/test_splits.py`:

```python
"""The split is the foundation of every reported number. Test it hard."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
PY = ROOT / "data" / "prep" / ".venv" / "Scripts" / "python.exe"
SPLITS = ROOT / "data" / "out" / "splits.json"


def load():
    assert SPLITS.exists(), "Run data/prep/make_splits.py first"
    return json.loads(SPLITS.read_text())


def test_splits_are_disjoint():
    s = load()
    tr, ca, te = set(s["train"]), set(s["calibration"]), set(s["test"])
    assert tr & ca == set(), "train and calibration overlap - leakage"
    assert tr & te == set(), "train and test overlap - LEAKAGE, numbers invalid"
    assert ca & te == set(), "calibration and test overlap - leakage"


def test_splits_cover_every_compound_exactly_once():
    s = load()
    compounds = json.loads((ROOT / "data" / "out" / "compounds.json").read_text())["compounds"]
    all_keys = {c["compoundId"] for c in compounds}
    assigned = s["train"] + s["calibration"] + s["test"]
    assert len(assigned) == len(set(assigned)), "a compound appears in more than one split"
    assert set(assigned) == all_keys


def test_split_is_reproducible_from_the_committed_seed():
    """Re-running the script must reproduce the committed split byte for byte."""
    before = SPLITS.read_text()
    subprocess.run([str(PY), str(ROOT / "data" / "prep" / "make_splits.py")], check=True, cwd=ROOT)
    assert SPLITS.read_text() == before, "split is not reproducible from its seed"


def test_both_classes_present_in_every_split():
    s = load()
    compounds = {c["compoundId"]: c["y"] for c in json.loads((ROOT / "data" / "out" / "compounds.json").read_text())["compounds"]}
    for name in ("train", "calibration", "test"):
        ys = {compounds[k] for k in s[name]}
        assert ys == {0, 1}, f"{name} split is single-class; stratification failed"


def test_test_split_is_large_enough_to_report_on():
    s = load()
    assert len(s["test"]) >= 60, f"test split has {len(s['test'])} compounds - too small for a reportable interval"
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python -m pip install -q -r data/prep/requirements.txt && data/prep/.venv/Scripts/python -m pytest data/prep -q
```

Expected: FAIL — `Run data/prep/make_splits.py first`

- [ ] **Step 3: Write the DILIrank ingest**

Create `data/prep/ingest_dilirank.py`:

```python
"""DILIrank -> compounds.json, keyed by InChIKey.

The InChIKey is the compoundId throughout ARBITER. Every database uses
different identifiers for the same drug; chemical structure is the only
crosswalk that actually works, and the spec calls this out as the one real
engineering gotcha. Getting it right here means every later stream joins for
free.

Binarisation follows rules/ruleset-v1.0.json - the PRE-REGISTERED policy, not a
choice made here.

DATASET PROVENANCE, which must be reported wherever a number from it is shown:
DILIrank **2.0** (1,336 FDA-approved drugs; sheet 1 of the FDA workbook), NOT the
superseded 1.0 (1,036 drugs, sheet 2). 2.0 adds 300 drugs approved 2010-2021 and
RECLASSIFIES 49 of the original ones, so the version is not an incidental detail -
the same compound can carry a different label between versions and a result is not
reproducible without it.
"""
import json
import pathlib
import re
import time

import pandas as pd
import requests
from rdkit import Chem, RDLogger

RDLogger.DisableLog("rdApp.*")

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "dilirank.xlsx"
OUT = ROOT / "data" / "out"
RULESET = ROOT / "rules" / "ruleset-v1.0.json"
PUBCHEM = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name"


def binarisation_policy() -> dict:
    return json.loads(RULESET.read_text())["dilirankBinarisation"]


def norm_label(s: str) -> str:
    """Lowercase and strip every non-letter.

    MANDATORY, not cosmetic. The real file's category values are internally
    inconsistent in case, prefix and punctuation, and the pre-registered strings
    in ruleset-v1.0.json match almost none of them literally. Measured on the
    actual FDA workbook:

      pre-registered "vMost-DILI-Concern"  vs  file "vMost-DILI-concern" (215)
                                           and "vMOST-DILI-concern" (2)   -> 0 rows
      pre-registered "vLess-DILI-Concern"  vs  file "vLess-DILI-concern" (351) -> 0 rows
      pre-registered "vNo-DILI-Concern"    vs  file "vNo-DILI-concern" (413)
                                           and "vNo-DILI-Concern" (1)     -> 1 row

    An exact-match ingest therefore yields an evaluation set of ONE compound and
    raises nothing. Normalising both sides is what makes the pre-registered
    policy mean what it says; it does not change the policy, so
    ruleset-v1.0.json stays untouched and its hash stands.

    Version 1.0 of the dataset (sheet 2) differs again - no "v" prefix, and
    "Ambiguous DILI-concern" with a SPACE - which is why this must not be a
    hand-written alias table.
    """
    return re.sub(r"[^a-z]", "", str(s).lower())


# Published DILIrank 2.0 distribution. Asserted so a parsing or matching change
# fails the build instead of quietly shrinking the evaluation set.
EXPECTED_2_0 = {
    "vmostdiliconcern": 217,
    "vlessdiliconcern": 351,
    "vnodiliconcern": 414,
    "ambiguousdiliconcern": 354,
}


def read_raw() -> pd.DataFrame:
    if not RAW.exists():
        raise SystemExit(f"Missing {RAW}. See data/prep/README.md.")

    # sheet_name=0 is DILIrank 2.0 (1,336 drugs); sheet 1 is the superseded 1.0
    # (1,036). header=1 because row 0 is a title banner, not column names -
    # reading with the default header=0 makes every column "Unnamed: N" and the
    # column lookups below fail.
    df = pd.read_excel(RAW, sheet_name=0, header=1)

    name_col = next(c for c in df.columns if "compound" in c.lower() or "drug" in c.lower())
    # Must test "concern" FIRST and on its own. The columns are LTKBID,
    # CompoundName, SeverityClass, LabelSection, vDILI-Concern, Comment - so an
    # `or "severity"` clause matches SeverityClass (an integer grade) before it
    # ever reaches the label column, and binarisation would then run on integers.
    label_col = next(c for c in df.columns if "concern" in c.lower())

    out = df[[name_col, label_col]].rename(columns={name_col: "name", label_col: "dilirankLabel"})
    out["name"] = out["name"].astype(str).str.strip()
    out["dilirankLabel"] = out["dilirankLabel"].astype(str).str.strip()
    out["labelNorm"] = out["dilirankLabel"].map(norm_label)

    counts = out["labelNorm"].value_counts().to_dict()
    if counts != EXPECTED_2_0:
        raise SystemExit(
            "DILIrank 2.0 category distribution does not match the published one.\n"
            f"  expected: {EXPECTED_2_0}\n  got:      {counts}\n"
            "Either the wrong sheet/header was read or the file changed. Do not "
            "proceed - every downstream metric is computed over this set."
        )
    print(f"DILIrank 2.0 category counts verified against publication: {counts}")

    return out.drop_duplicates(subset="name")


def resolve_structures(names: list[str]) -> dict[str, dict[str, str]]:
    """name -> {smiles, inchikey} via PubChem PUG-REST. Throttled to <=4 req/s."""
    resolved: dict[str, dict[str, str]] = {}
    for i, name in enumerate(names):
        url = f"{PUBCHEM}/{requests.utils.quote(name)}/property/CanonicalSMILES,InChIKey/JSON"
        try:
            r = requests.get(url, timeout=20)
            if r.ok:
                props = r.json()["PropertyTable"]["Properties"][0]
                smiles, key = props.get("CanonicalSMILES"), props.get("InChIKey")
                # Reject anything RDKit cannot parse - a SMILES we cannot read is
                # a SMILES no downstream stream can featurise.
                if smiles and key and Chem.MolFromSmiles(smiles) is not None:
                    resolved[name] = {"smiles": smiles, "inchikey": key}
        except Exception:
            pass
        time.sleep(0.25)
        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{len(names)} resolved ({len(resolved)} hits)", flush=True)
    return resolved


def main() -> None:
    policy = binarisation_policy()
    # Both sides normalised through the SAME function - see norm_label.
    positive = {norm_label(s) for s in policy["positive"]}
    negative = {norm_label(s) for s in policy["negative"]}

    df = read_raw()
    print(f"DILIrank rows: {len(df)}")

    keep = df["labelNorm"].isin(positive | negative)
    excluded = df[~keep]
    df = df[keep].copy()
    print(f"Binary-labelled: {len(df)}  (excluded by policy: {len(excluded)})")

    # Expected on DILIrank 2.0: 568 positive (217 + 351), 414 negative, 354
    # excluded as Ambiguous -> 982 usable, 57.8% positive. A near-empty set here
    # is the signature of the exact-match bug norm_label exists to prevent.
    if len(df) < 900:
        raise SystemExit(
            f"Only {len(df)} binary-labelled compounds; expected ~982. The "
            "binarisation policy is not matching the file's category values."
        )

    df["y"] = df["dilirankLabel"].isin(positive).astype(int)

    structures = resolve_structures(df["name"].tolist())
    df["smiles"] = df["name"].map(lambda n: structures.get(n, {}).get("smiles"))
    df["inchikey"] = df["name"].map(lambda n: structures.get(n, {}).get("inchikey"))
    df = df.dropna(subset=["smiles", "inchikey"])

    # One row per structure. Two names for one InChIKey is the same molecule.
    df = df.drop_duplicates(subset="inchikey").reset_index(drop=True)
    print(f"Unique structures: {len(df)}")

    compounds = [
        {
            "compoundId": r.inchikey,
            "name": r.name_,
            "smiles": r.smiles,
            "inchikey": r.inchikey,
            "dilirankLabel": r.dilirankLabel,
            "y": int(r.y),
        }
        for r in df.rename(columns={"name": "name_"}).itertuples()
    ]
    compounds.sort(key=lambda c: c["compoundId"])  # stable output ordering

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "compounds.json").write_text(json.dumps({
        "generatedAt": time.strftime("%Y-%m-%d"),
        "binarisationPolicy": policy,
        "nExcludedByPolicy": int(len(excluded)),
        "compounds": compounds,
    }, indent=2))
    print(f"Wrote {len(compounds)} compounds ({sum(c['y'] for c in compounds)} positive)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Write the split script**

Create `data/prep/make_splits.py`:

```python
"""Seeded, stratified three-way split. COMMITTED BEFORE ANY MODEL IS FITTED.

train       -> fitting the QSAR stream and per-source reliability priors
calibration -> conformal nonconformity thresholds only
test        -> every reported number; touched by nothing else, ever

The seed is a constant in this file and is committed with the output, so the
split is reproducible and auditable. A test asserts re-running reproduces it
byte for byte.
"""
import json
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
SEED = 20260726
FRACTIONS = {"train": 0.50, "calibration": 0.20, "test": 0.30}


def main() -> None:
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    rng = np.random.default_rng(SEED)

    # Stratify so every split carries both classes - a single-class calibration
    # split makes conformal thresholds meaningless.
    buckets: dict[int, list[str]] = {0: [], 1: []}
    for c in sorted(compounds, key=lambda x: x["compoundId"]):
        buckets[c["y"]].append(c["compoundId"])

    splits: dict[str, list[str]] = {"train": [], "calibration": [], "test": []}
    for y, keys in buckets.items():
        idx = rng.permutation(len(keys))
        shuffled = [keys[i] for i in idx]
        n_train = int(round(len(shuffled) * FRACTIONS["train"]))
        n_cal = int(round(len(shuffled) * FRACTIONS["calibration"]))
        splits["train"] += shuffled[:n_train]
        splits["calibration"] += shuffled[n_train:n_train + n_cal]
        splits["test"] += shuffled[n_train + n_cal:]

    for k in splits:
        splits[k] = sorted(splits[k])

    payload = {
        "seed": SEED,
        "fractions": FRACTIONS,
        "sizes": {k: len(v) for k, v in splits.items()},
        "note": "Committed before any model fitting. train fits, calibration thresholds, test reports.",
        **splits,
    }
    (OUT / "splits.json").write_text(json.dumps(payload, indent=2))
    print(json.dumps(payload["sizes"], indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run both scripts, then the tests**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python data/prep/ingest_dilirank.py && data/prep/.venv/Scripts/python data/prep/make_splits.py && data/prep/.venv/Scripts/python -m pytest data/prep -q
```

Expected: PASS (5 tests). **If `test_test_split_is_large_enough_to_report_on` fails**, the structure-resolution hit rate was too low — report the compound count before continuing, because it bounds every interval in §8.

- [ ] **Step 6: Commit the split on its own, before any fitting exists**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && git add data/prep data/out/compounds.json data/out/splits.json && git commit -m "Ingest DILIrank and commit the three-way split before any fitting

compoundId is the InChIKey throughout. Chemical structure is the only
crosswalk that works across databases, so resolving it once here means every
later evidence stream joins for free. Anything RDKit cannot parse is dropped -
a SMILES we cannot read is one no stream can featurise.

Binarisation reads the pre-registered policy from ruleset-v1.0.json rather
than deciding it here, and the count excluded by that policy is recorded
rather than silently dropped.

The split is seeded, stratified so both classes appear in all three parts, and
committed in this commit - before any model exists to fit. train fits,
calibration sets conformal thresholds, test reports. Tests assert the three are
disjoint, cover every compound exactly once, and reproduce byte-for-byte from
the seed.

Deviation from the spec's data table, deliberate: the QSAR stream will train on
the DILIrank train split rather than Therapeutics Data Commons. Using our own
split removes cross-dataset structure overlap as a leakage vector entirely
instead of trying to subtract it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: QSAR stream with split conformal prediction

Restores what the spec (§5) specifies and earlier drafts dropped. Conformal is the difference between *measuring* calibration and *guaranteeing* it.

**Files:**
- Create: `data/prep/qsar_stream.py`
- Create: `data/prep/tests/test_qsar_leakage.py`

**Interfaces:**
- Consumes: `data/out/compounds.json`, `data/out/splits.json`
- Produces: `data/out/stream-qsar.json` — `{alpha, qhat, calibrationCoverage, claims: EvidenceClaim[]}`

- [ ] **Step 1: Write the failing tests**

Create `data/prep/tests/test_qsar_leakage.py`:

```python
"""Leakage and conformal-coverage guarantees for the QSAR stream."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / "data" / "out"


def load():
    p = OUT / "stream-qsar.json"
    assert p.exists(), "Run data/prep/qsar_stream.py first"
    return json.loads(p.read_text())


def test_model_never_saw_calibration_or_test_compounds():
    """The single most important test in the data layer."""
    s = load()
    splits = json.loads((OUT / "splits.json").read_text())
    trained_on = set(s["trainedOn"])
    assert trained_on & set(splits["calibration"]) == set(), "LEAKAGE: trained on calibration"
    assert trained_on & set(splits["test"]) == set(), "LEAKAGE: trained on test - all numbers invalid"
    assert trained_on <= set(splits["train"])


def test_conformal_coverage_is_near_the_target():
    s = load()
    target = 1 - s["alpha"]
    assert abs(s["calibrationCoverage"] - target) < 0.08, (
        f"calibration coverage {s['calibrationCoverage']:.3f} strays from target {target:.3f}"
    )


def test_every_compound_gets_exactly_one_claim():
    s = load()
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    ids = [c["compoundId"] for c in s["claims"]]
    assert len(ids) == len(set(ids)), "duplicate QSAR claims for one compound"
    assert set(ids) == {c["compoundId"] for c in compounds}


def test_out_of_domain_compounds_are_flagged_not_dropped():
    s = load()
    # An empty conformal set means the compound is outside the applicability
    # domain. Those claims must be PRESENT and flagged, not silently omitted.
    flagged = [c for c in s["claims"] if c["inApplicabilityDomain"] is False]
    for c in flagged:
        assert c["assertion"] == "ambiguous", "an out-of-domain claim must not assert a verdict"


def test_ambiguous_when_the_conformal_set_holds_both_labels():
    s = load()
    for c in s["claims"]:
        if c["inApplicabilityDomain"] is True and c["assertion"] == "ambiguous":
            assert c["strength"] == 0.0, "an ambiguous claim carries no committed strength"


def test_claims_carry_every_field_the_engine_schema_requires():
    """The Python side must produce exactly the shape the TypeScript engine accepts.

    Checked structurally here rather than by invoking the TS schema, because Node
    cannot import a .ts module without a loader. The authoritative cross-language
    check is `npm run validate:evidence` in Task 13, which parses every claim
    through the real zod schema; this test is the fast local guard.
    """
    required = {
        "id", "compoundId", "stream", "assertion", "strength", "system",
        "measuresKeyEvent", "exposureRelevant", "inApplicabilityDomain",
        "klimisch", "availableFrom", "provenance",
    }
    streams = {"qsar", "cytotox", "toxicogenomics", "transporter", "invivo_rodent", "invivo_nonrodent"}

    for c in load()["claims"]:
        assert set(c) == required, f"{c['id']}: field mismatch {set(c) ^ required}"
        assert c["stream"] in streams
        assert c["assertion"] in {"toxic", "safe", "ambiguous"}
        assert 0.0 <= c["strength"] <= 1.0
        assert c["system"] in {"human", "rodent", "nonrodent", "in_silico"}
        assert c["klimisch"] in {1, 2, 3, 4, None}
        assert set(c["provenance"]) >= {"kind", "source", "retrieved"}
        assert c["provenance"]["kind"] in {"database", "literature"}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python -m pytest data/prep/tests/test_qsar_leakage.py -q
```

Expected: FAIL — `Run data/prep/qsar_stream.py first`

- [ ] **Step 3: Write the implementation**

Create `data/prep/qsar_stream.py`:

```python
"""QSAR / structural evidence stream, with split conformal prediction.

Trains a Morgan-fingerprint classifier on the TRAIN split only, sets a
nonconformity threshold on the CALIBRATION split, and emits one typed evidence
claim per compound.

Conformal gives a distribution-free coverage guarantee and - more useful to
ARBITER - a principled applicability-domain flag. The prediction set is
{y : 1 - p(y|x) <= qhat}:

  singleton set -> confident, in domain      -> assertion = that label
  both labels   -> uncertain but in domain   -> assertion = ambiguous
  empty set     -> OUTSIDE the domain        -> assertion = ambiguous, flagged

That last case is what R4 consumes. "Outside its applicability domain" becomes
a nonconformity threshold rather than a judgment call.
"""
import json
import pathlib
import time

import numpy as np
from rdkit import Chem, RDLogger
from rdkit.Chem import rdFingerprintGenerator
from sklearn.ensemble import HistGradientBoostingClassifier

RDLogger.DisableLog("rdApp.*")

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
SEED = 20260726
ALPHA = 0.10  # target coverage 90%


def featurise(smiles: list[str]) -> np.ndarray:
    gen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    rows = []
    for s in smiles:
        mol = Chem.MolFromSmiles(s)
        rows.append(np.zeros(2048, dtype=np.int8) if mol is None
                    else np.array(gen.GetFingerprint(mol), dtype=np.int8))
    return np.vstack(rows)


def main() -> None:
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    splits = json.loads((OUT / "splits.json").read_text())
    by_id = {c["compoundId"]: c for c in compounds}

    train_ids = list(splits["train"])
    cal_ids = list(splits["calibration"])

    X_tr = featurise([by_id[i]["smiles"] for i in train_ids])
    y_tr = np.array([by_id[i]["y"] for i in train_ids])
    clf = HistGradientBoostingClassifier(max_iter=200, random_state=SEED).fit(X_tr, y_tr)

    # Split conformal: nonconformity = 1 - predicted probability of the TRUE label.
    X_cal = featurise([by_id[i]["smiles"] for i in cal_ids])
    y_cal = np.array([by_id[i]["y"] for i in cal_ids])
    p_cal = clf.predict_proba(X_cal)
    scores = 1 - p_cal[np.arange(len(y_cal)), y_cal]

    n = len(scores)
    level = min(1.0, np.ceil((n + 1) * (1 - ALPHA)) / n)
    qhat = float(np.quantile(scores, level, method="higher"))

    cal_sets = [{c for c in (0, 1) if 1 - row[c] <= qhat} for row in p_cal]
    coverage = float(np.mean([y in s for y, s in zip(y_cal, cal_sets)]))

    # Emit a claim for every compound, including train and calibration members -
    # the harness decides which rows it reports on, not this script.
    all_ids = sorted(by_id)
    p_all = clf.predict_proba(featurise([by_id[i]["smiles"] for i in all_ids]))
    today = time.strftime("%Y-%m-%d")

    claims = []
    for cid, row in zip(all_ids, p_all):
        pred_set = {c for c in (0, 1) if 1 - row[c] <= qhat}

        if len(pred_set) == 0:
            assertion, strength, in_domain = "ambiguous", 0.0, False
        elif len(pred_set) == 2:
            assertion, strength, in_domain = "ambiguous", 0.0, True
        else:
            label = next(iter(pred_set))
            assertion = "toxic" if label == 1 else "safe"
            strength, in_domain = float(row[label]), True

        claims.append({
            "id": f"{cid}:qsar",
            "compoundId": cid,
            "stream": "qsar",
            "assertion": assertion,
            "strength": round(strength, 4),
            "system": "in_silico",
            "measuresKeyEvent": None,      # structural correlation only -> R2 ranks it below
            "exposureRelevant": None,      # a structural model has no exposure axis
            "inApplicabilityDomain": in_domain,
            "klimisch": 3,                 # in-silico prediction, documented method
            "availableFrom": "2000-01-01", # structure is knowable from day one
            "provenance": {
                "kind": "database",
                "source": "DILIrank train split; Morgan r=2 2048-bit + HistGradientBoosting; split conformal",
                "retrieved": today,
            },
        })

    (OUT / "stream-qsar.json").write_text(json.dumps({
        "generatedAt": today,
        "seed": SEED,
        "alpha": ALPHA,
        "qhat": qhat,
        "calibrationCoverage": coverage,
        "trainedOn": sorted(train_ids),
        "claims": claims,
    }, indent=2))

    n_out = sum(1 for c in claims if c["inApplicabilityDomain"] is False)
    n_amb = sum(1 for c in claims if c["assertion"] == "ambiguous" and c["inApplicabilityDomain"])
    print(f"qhat={qhat:.4f}  calibration coverage={coverage:.3f} (target {1 - ALPHA:.2f})")
    print(f"claims={len(claims)}  out-of-domain={n_out}  ambiguous-in-domain={n_amb}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run it and verify the tests pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python data/prep/qsar_stream.py && data/prep/.venv/Scripts/python -m pytest data/prep -q
```

Expected: PASS (11 tests). Printed calibration coverage should sit near 0.90.

- [ ] **Step 5: Commit**

```bash
git add data/prep data/out/stream-qsar.json && git commit -m "Add QSAR stream with split conformal prediction

Trains on the TRAIN split only; the calibration split sets the nonconformity
threshold; the test split is untouched. The leakage test is the most important
one in the data layer and asserts the trained-on set is a subset of train.

Conformal earns its place by turning 'outside its applicability domain' from a
judgment call into a threshold: an empty prediction set means out of domain
(flagged, assertion ambiguous), both labels means uncertain but in domain, and
a singleton means a confident committed assertion. R4 consumes that flag.

Out-of-domain compounds are flagged and RETAINED rather than dropped - a test
asserts they are present and that they never assert a verdict. Silently
omitting them would quietly shrink the benchmark.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Tox21 in-vitro stream, and the TAK-994 two-pass fixture

**Files:**
- Create: `data/prep/tox21_stream.py`, `data/prep/tak994_fixture.py`, `data/prep/assemble_evidence.py`
- Create: `data/prep/tests/test_tak994_asof.py`

**Interfaces:**
- Consumes: `data/out/compounds.json`, `data/out/stream-qsar.json`
- Produces:
  - `data/out/stream-tox21.json` — cytotox and transporter claims, DATABASE-badged
  - `data/out/tak994.json` — the fixture, LITERATURE-badged, with `availableFrom` dates
  - `data/out/evidence.json` — all streams merged, schema-validated

- [ ] **Step 1: Write the failing as-of tests**

Create `data/prep/tests/test_tak994_asof.py`:

```python
"""The two-pass replay is the spine of the demo. Test the mechanism, not the story."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / "data" / "out"

PRE_FIH = "2021-06-01"   # before first-in-human dosing
POST = "2023-01-01"      # after the murine study was run during the trial


def load():
    p = OUT / "tak994.json"
    assert p.exists(), "Run data/prep/tak994_fixture.py first"
    return json.loads(p.read_text())


def as_of(claims, date):
    return [c for c in claims if c["availableFrom"] <= date]


def test_pass_one_contains_no_murine_toxicogenomics():
    """The mechanism study was run DURING the trial. Including it pre-FIH is hindsight."""
    claims = as_of(load()["claims"], PRE_FIH)
    assert claims, "pass 1 must not be empty"
    for c in claims:
        assert c["stream"] != "toxicogenomics", f"hindsight leak: {c['id']} in the pre-FIH pass"


def test_pass_one_has_the_four_studies_that_actually_existed():
    streams = {c["stream"] for c in as_of(load()["claims"], PRE_FIH)}
    assert "invivo_rodent" in streams
    assert "invivo_nonrodent" in streams
    assert "cytotox" in streams


def test_pass_two_adds_the_murine_signal():
    p1 = {c["id"] for c in as_of(load()["claims"], PRE_FIH)}
    p2 = {c["id"] for c in as_of(load()["claims"], POST)}
    assert p1 < p2, "pass 2 must strictly add claims"
    added = p2 - p1
    assert any("toxicogenomic" in a or "murine" in a for a in added)


def test_every_pre_fih_claim_asserts_safe_or_ambiguous():
    """The historical record: nothing available pre-FIH said toxic."""
    for c in as_of(load()["claims"], PRE_FIH):
        assert c["assertion"] in ("safe", "ambiguous"), f"{c['id']} claims toxic pre-FIH"


def test_fixture_is_literature_sourced_and_cites_a_pmid():
    for c in load()["claims"]:
        assert c["provenance"]["kind"] == "literature"
        assert "PMID" in c["provenance"]["source"] or "NEJM" in c["provenance"]["source"]


def test_tak994_is_excluded_from_the_benchmark():
    """It is the motivating case, not evidence. It must not be a benchmark row."""
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    fixture_ids = {c["compoundId"] for c in load()["claims"]}
    assert fixture_ids & {c["compoundId"] for c in compounds} == set()

    evidence = json.loads((OUT / "evidence.json").read_text())
    assert evidence["benchmarkCompoundIds"], "evidence.json must declare its benchmark rows"
    assert fixture_ids & set(evidence["benchmarkCompoundIds"]) == set()
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python -m pytest data/prep/tests/test_tak994_asof.py -q
```

Expected: FAIL — `Run data/prep/tak994_fixture.py first`

- [ ] **Step 3: Write the Tox21 stream**

Create `data/prep/tox21_stream.py`:

```python
"""In-vitro evidence from Tox21 via PubChem PUG-REST.

We discover assay AIDs by name search rather than hard-coding numbers nobody
can verify, then pin what we found into the output so the pull is auditable and
repeatable.

Two streams come out of this:
  cytotox     -> hepatic viability / mitochondrial readouts
  transporter -> BSEP-type readouts where present

BSEP coverage in Tox21 is thin. Where a compound has no usable readout we emit
NOTHING for that stream rather than inventing an ambiguous claim - a silent
source must contribute m(Theta)=1 through the fusion layer, and the way to say
"silent" is to have no claim at all.
"""
import json
import pathlib
import time

import requests

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
REST = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"

ASSAY_QUERIES = {
    "cytotox": ["tox21 rt-viability hepg2", "tox21 mitochondrial membrane potential"],
    "transporter": ["bile salt export pump inhibition", "bsep inhibition"],
}


def find_aids(query: str, limit: int = 3) -> list[int]:
    """Resolve an assay description to AIDs via PubChem's assay name index."""
    try:
        r = requests.get(f"{REST}/assay/name/{requests.utils.quote(query)}/aids/JSON", timeout=30)
        if r.ok:
            return r.json().get("IdentifierList", {}).get("AID", [])[:limit]
    except Exception:
        pass
    return []


def cid_for(inchikey: str) -> int | None:
    try:
        r = requests.get(f"{REST}/compound/inchikey/{inchikey}/cids/JSON", timeout=20)
        if r.ok:
            cids = r.json().get("IdentifierList", {}).get("CID", [])
            return cids[0] if cids else None
    except Exception:
        return None
    return None


def outcomes_for(cid: int, aids: set[int]) -> list[str]:
    """Return the activity outcomes this CID has against the AIDs of interest."""
    try:
        r = requests.get(f"{REST}/compound/cid/{cid}/assaysummary/JSON", timeout=30)
        if not r.ok:
            return []
        table = r.json().get("Table", {})
        cols = table.get("Columns", {}).get("Column", [])
        rows = [row.get("Cell", []) for row in table.get("Row", [])]
        try:
            i_aid, i_out = cols.index("AID"), cols.index("Activity Outcome")
        except ValueError:
            return []
        return [row[i_out] for row in rows
                if len(row) > max(i_aid, i_out) and str(row[i_aid]).isdigit() and int(row[i_aid]) in aids]
    except Exception:
        return []


def main() -> None:
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    today = time.strftime("%Y-%m-%d")

    resolved: dict[str, list[int]] = {}
    for stream, queries in ASSAY_QUERIES.items():
        aids: list[int] = []
        for q in queries:
            aids += find_aids(q)
            time.sleep(0.25)
        resolved[stream] = sorted(set(aids))
        print(f"{stream}: AIDs {resolved[stream] or 'NONE FOUND - will fall back to literature'}")

    claims = []
    for i, c in enumerate(compounds):
        cid = cid_for(c["compoundId"])
        time.sleep(0.25)
        if cid is None:
            continue
        for stream, aids in resolved.items():
            if not aids:
                continue
            outs = outcomes_for(cid, set(aids))
            time.sleep(0.25)
            if not outs:
                continue  # silent source: emit nothing, never a fabricated ambiguous claim
            n_active = sum(1 for o in outs if str(o).lower().startswith("active"))
            frac = n_active / len(outs)
            assertion = "toxic" if frac >= 0.5 else "safe"
            claims.append({
                "id": f"{c['compoundId']}:{stream}",
                "compoundId": c["compoundId"],
                "stream": stream,
                "assertion": assertion,
                "strength": round(abs(frac - 0.5) * 2 * 0.9, 4),
                "system": "human",
                "measuresKeyEvent": "KE:BSEP-INHIBITION" if stream == "transporter" else "KE:HEPATOCYTE-DEATH",
                "exposureRelevant": False,   # HTS concentrations are not clinical exposure
                "inApplicabilityDomain": True,
                "klimisch": 2,
                "availableFrom": "2010-01-01",
                "provenance": {"kind": "database", "source": f"Tox21 via PubChem AIDs {aids}", "retrieved": today},
            })
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(compounds)} compounds, {len(claims)} claims", flush=True)

    (OUT / "stream-tox21.json").write_text(json.dumps({
        "generatedAt": today, "resolvedAids": resolved, "claims": claims,
    }, indent=2))
    print(f"Wrote {len(claims)} in-vitro claims across {len({c['compoundId'] for c in claims})} compounds")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Write the TAK-994 fixture**

Create `data/prep/tak994_fixture.py`:

```python
"""TAK-994: the motivating case. LITERATURE-sourced, EXCLUDED from all metrics.

Every claim carries an availableFrom date reflecting when that evidence
actually existed. That single field is what makes the two-pass replay honest:
the murine toxicogenomic study was initiated DURING the Phase 2 trial, so it
carries a 2022 date and is invisible to a pre-first-in-human replay.

Sources to verify against the primary literature before presenting:
  - Toxicological Sciences (2025) 204(2):143 - rat and primate studies missing
    the liability; murine single-cell necrosis after CYP induction at
    clinically relevant doses; in-vitro margins >100x
  - NEJM (2023) - Phase 2: 73 patients, 8 over enzyme thresholds, 3 Hy's Law
"""
import json
import pathlib
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
CID = "TAK-994"
TOXSCI = "Toxicological Sciences 2025;204(2):143 (PMID: verify before citing)"
NEJM = "NEJM 2023 Phase 2 TAK-994 (PMID: verify before citing)"


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
        # >100x margin, but NOT established at clinical exposure -> exposureRelevant None, which R3 consumes.
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
    print(f"Wrote {len(CLAIMS)} literature claims; "
          f"{sum(1 for c in CLAIMS if c['availableFrom'] <= '2021-06-01')} visible pre-first-in-human")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Write the assembler**

Create `data/prep/assemble_evidence.py`:

```python
"""Merge every stream into data/out/evidence.json.

Declares benchmarkCompoundIds explicitly so the harness cannot accidentally
score the TAK-994 fixture, and records per-stream provenance counts so the UI
can badge DATABASE vs LITERATURE honestly.
"""
import json
import pathlib
import time
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"


def read(name: str) -> list[dict]:
    p = OUT / name
    if not p.exists():
        print(f"  (missing {name} - skipping)")
        return []
    return json.loads(p.read_text())["claims"]


def main() -> None:
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    claims = read("stream-qsar.json") + read("stream-tox21.json") + read("tak994.json")
    claims.sort(key=lambda c: (c["compoundId"], c["stream"], c["id"]))

    ids = [c["id"] for c in claims]
    dupes = [k for k, n in Counter(ids).items() if n > 1]
    if dupes:
        raise SystemExit(f"Duplicate claim ids: {dupes[:5]}")

    (OUT / "evidence.json").write_text(json.dumps({
        "generatedAt": time.strftime("%Y-%m-%d"),
        "benchmarkCompoundIds": sorted(c["compoundId"] for c in compounds),
        "provenanceCounts": dict(Counter(c["provenance"]["kind"] for c in claims)),
        "streamCounts": dict(Counter(c["stream"] for c in claims)),
        "claims": claims,
    }, indent=2))
    print(json.dumps({
        "claims": len(claims),
        "benchmarkCompounds": len(compounds),
        "byStream": dict(Counter(c["stream"] for c in claims)),
        "byProvenance": dict(Counter(c["provenance"]["kind"] for c in claims)),
    }, indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Run everything and verify the tests pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python data/prep/tox21_stream.py && data/prep/.venv/Scripts/python data/prep/tak994_fixture.py && data/prep/.venv/Scripts/python data/prep/assemble_evidence.py && data/prep/.venv/Scripts/python -m pytest data/prep -q
```

Expected: PASS (17 tests). Note the printed `byProvenance` counts — those drive the DATABASE/LITERATURE badges in Phase 2, and the ratio is the honest picture of how much landed as real database values by the **2 August data freeze**.

- [ ] **Step 7: Commit**

```bash
git add data/prep data/out/stream-tox21.json data/out/tak994.json data/out/evidence.json && git commit -m "Add Tox21 in-vitro stream, TAK-994 fixture, and the evidence assembler

Tox21 AIDs are DISCOVERED by name search and then pinned into the output, so
the pull is auditable rather than resting on hard-coded assay numbers nobody
can verify. Where a compound has no usable readout we emit NO claim rather
than a fabricated ambiguous one - a silent source must reach fusion as
m(Theta)=1, and the way to say silent is to have no claim.

The TAK-994 fixture carries a real availableFrom date per claim. The murine
toxicogenomic study is dated 2022 because it was initiated DURING the Phase 2
trial, so a pre-first-in-human replay cannot see it. Tests assert the pre-FIH
pass contains no toxicogenomics claim, that nothing available then said toxic,
and that the fixture appears in no benchmark row.

evidence.json declares benchmarkCompoundIds explicitly so the harness cannot
accidentally score the fixture, and records per-stream provenance counts so the
DATABASE/LITERATURE badges in Phase 2 tell the truth.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Harness — engine run and the three deterministic baselines

**Files:**
- Create: `apps/harness/src/prng.ts`, `apps/harness/src/load.ts`, `apps/harness/src/baselines.ts`, `apps/harness/src/main.ts`
- Create: `apps/harness/src/validate-evidence.ts`
- Modify: `package.json` — add `validate:evidence` script
- Test: `apps/harness/test/baselines.test.ts`, `apps/harness/test/prng.test.ts`

**Interfaces:**
- Consumes: `reason`, `detectConflict`, `EvidenceClaim`, `Ruleset`, `Verdict` from `@arbiter/engine`; `rulesetHash` from `./hash.js`
- Produces:
  - `mulberry32(seed: number): () => number`
  - `interface Prediction { verdict: Verdict; score: number }`
  - `majorityVote(claims: EvidenceClaim[]): Prediction`
  - `weightedAverage(claims: EvidenceClaim[]): Prediction`
  - `bestSingleSource(claims: EvidenceClaim[], stream: Stream): Prediction`
  - `loadInputs(): { evidence, splits, ruleset, assays, compounds, hash }`
  - `interface ResultRow { compoundId; y; conflicting; arbiter: Reasoning; baselines: Record<string, Prediction> }`
  - `results/results.json`

- [ ] **Step 1: Write the failing tests**

Create `apps/harness/test/prng.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mulberry32 } from "../src/prng.js";

describe("mulberry32", () => {
  it("is reproducible from a seed", () => {
    const a = Array.from({ length: 20 }, mulberry32(42));
    const b = Array.from({ length: 20 }, mulberry32(42));
    expect(a).toEqual(b);
  });

  it("differs across seeds", () => {
    expect(Array.from({ length: 20 }, mulberry32(1))).not.toEqual(Array.from({ length: 20 }, mulberry32(2)));
  });

  it("stays inside [0, 1)", () => {
    const next = mulberry32(7);
    for (let i = 0; i < 5000; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
```

Create `apps/harness/test/baselines.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bestSingleSource, majorityVote, weightedAverage } from "../src/baselines.js";
import type { EvidenceClaim } from "@arbiter/engine";

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("majorityVote", () => {
  it("counts heads regardless of strength - this is the point of the baseline", () => {
    const r = majorityVote([
      claim({ id: "a", assertion: "safe", strength: 0.01 }),
      claim({ id: "b", assertion: "safe", strength: 0.01 }),
      claim({ id: "c", assertion: "toxic", strength: 0.99 }),
    ]);
    expect(r.verdict).toBe("advance");
  });

  it("THE FLAW WE ARE DEMONSTRATING: an ambiguous claim is counted as not-toxic", () => {
    // Majority vote has nowhere to put "I don't know", so silence leans safe.
    // This is exactly what Dempster-Shafer refuses to do.
    const r = majorityVote([
      claim({ id: "a", assertion: "toxic", strength: 0.9 }),
      claim({ id: "b", assertion: "ambiguous", strength: 0 }),
      claim({ id: "c", assertion: "ambiguous", strength: 0 }),
    ]);
    expect(r.verdict).toBe("advance");
  });

  it("abstains only when there is nothing at all to count", () => {
    expect(majorityVote([]).verdict).toBe("abstain");
  });

  it("breaks a tie by abstaining rather than guessing", () => {
    const r = majorityVote([
      claim({ id: "a", assertion: "toxic" }),
      claim({ id: "b", assertion: "safe" }),
    ]);
    expect(r.verdict).toBe("abstain");
  });
});

describe("weightedAverage", () => {
  it("lets one strong claim outweigh two weak ones", () => {
    const r = weightedAverage([
      claim({ id: "a", assertion: "safe", strength: 0.1 }),
      claim({ id: "b", assertion: "safe", strength: 0.1 }),
      claim({ id: "c", assertion: "toxic", strength: 0.95 }),
    ]);
    expect(r.verdict).toBe("do_not_advance");
  });

  it("treats an ambiguous claim as a zero-strength safe vote - the averaging flaw", () => {
    const withAmbiguous = weightedAverage([
      claim({ id: "a", assertion: "toxic", strength: 0.6 }),
      claim({ id: "b", assertion: "ambiguous", strength: 0 }),
    ]);
    const alone = weightedAverage([claim({ id: "a", assertion: "toxic", strength: 0.6 })]);
    expect(withAmbiguous.score).toBeLessThan(alone.score);
  });
});

describe("bestSingleSource", () => {
  it("uses only the named stream and ignores everything else", () => {
    const r = bestSingleSource([
      claim({ id: "a", assertion: "toxic", strength: 0.9, stream: "cytotox" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, stream: "qsar" }),
    ], "qsar");
    expect(r.verdict).toBe("advance");
  });

  it("abstains when the named stream is silent for this compound", () => {
    const r = bestSingleSource([claim({ id: "a", stream: "cytotox" })], "toxicogenomics");
    expect(r.verdict).toBe("abstain");
  });
});

describe("all three baselines", () => {
  it("are deterministic", () => {
    const claims = [claim({ id: "a", assertion: "toxic" }), claim({ id: "b", assertion: "safe", stream: "qsar" })];
    for (const fn of [majorityVote, weightedAverage]) {
      const runs = new Set(Array.from({ length: 50 }, () => JSON.stringify(fn(claims))));
      expect(runs.size).toBe(1);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- apps/harness
```

Expected: FAIL — `Cannot find module '../src/prng.js'` and `'../src/baselines.js'`

- [ ] **Step 3: Write the PRNG**

Create `apps/harness/src/prng.ts`:

```ts
/**
 * All randomness in ARBITER lives here.
 *
 * The engine bans Math.random outright, so perturbation sampling for the
 * robustness and planner-sensitivity metrics happens in the harness with a
 * seeded generator and the seed committed alongside the results. That is what
 * makes those figures reproducible - and they have to be, because they are
 * golden-filed in Task 16.
 *
 * mulberry32: small, fast, well-distributed, and identical across platforms,
 * which matters because CI must reproduce a local number exactly.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform in [lo, hi). */
export function uniform(next: () => number, lo: number, hi: number): number {
  return lo + next() * (hi - lo);
}

/** Multiplicative jitter: value scaled by a factor in [1-pct, 1+pct], clamped to [0,1]. */
export function jitter01(next: () => number, value: number, pct: number): number {
  return Math.max(0, Math.min(1, value * uniform(next, 1 - pct, 1 + pct)));
}
```

- [ ] **Step 4: Write the baselines**

Create `apps/harness/src/baselines.ts`:

```ts
import type { EvidenceClaim, Stream, Verdict } from "@arbiter/engine";

export interface Prediction {
  verdict: Verdict;
  /** Toxicity leaning in [0,1]; 0.5 means undecided. For ranking and calibration plots. */
  score: number;
}

const ABSTAIN: Prediction = { verdict: "abstain", score: 0.5 };

/**
 * Baseline 1: majority vote.
 *
 * The naive aggregation the mentor named. It has NOWHERE TO PUT "I don't know" -
 * an ambiguous claim simply is not a toxic vote, so silence leans safe. That is
 * the flaw Dempster-Shafer exists to avoid, and there is a test asserting this
 * baseline exhibits it. We are not strawmanning it; we are showing its actual
 * behaviour.
 */
export function majorityVote(claims: EvidenceClaim[]): Prediction {
  if (claims.length === 0) return ABSTAIN;
  const toxic = claims.filter((c) => c.assertion === "toxic").length;
  const safe = claims.filter((c) => c.assertion === "safe").length;
  if (toxic === 0 && safe === 0) return ABSTAIN;
  if (toxic === safe) return ABSTAIN;
  const total = toxic + safe;
  return toxic > safe
    ? { verdict: "do_not_advance", score: toxic / total }
    : { verdict: "advance", score: toxic / total };
}

/**
 * Baseline 2: confidence-weighted average.
 *
 * Included because majority vote is not actually *averaging*, and averaging is
 * what the pitch claims to beat. An ambiguous claim contributes zero numerator
 * and non-zero denominator, i.e. it is treated as a zero-strength safe vote -
 * the precise error the spec's one-liner names.
 */
export function weightedAverage(claims: EvidenceClaim[]): Prediction {
  const committed = claims.filter((c) => c.assertion !== "ambiguous" || c.strength === 0);
  if (claims.length === 0) return ABSTAIN;
  const denom = claims.reduce((s, c) => s + Math.max(c.strength, 0.0001), 0);
  const numer = claims.reduce((s, c) => s + (c.assertion === "toxic" ? Math.max(c.strength, 0.0001) : 0), 0);
  if (denom === 0 || committed.length === 0) return ABSTAIN;
  const score = numer / denom;
  if (Math.abs(score - 0.5) < 1e-12) return ABSTAIN;
  return { verdict: score > 0.5 ? "do_not_advance" : "advance", score };
}

/**
 * Baseline 3: best single source.
 *
 * The unflattering bar, included precisely because it is unflattering: if one
 * predictor alone matches the whole system, the complexity is not earning its
 * place. The harness runs this once per stream and reports the strongest.
 */
export function bestSingleSource(claims: EvidenceClaim[], stream: Stream): Prediction {
  const own = claims.filter((c) => c.stream === stream && c.assertion !== "ambiguous");
  if (own.length === 0) return ABSTAIN;
  const strongest = own.reduce((a, b) => (b.strength > a.strength ? b : a));
  return strongest.assertion === "toxic"
    ? { verdict: "do_not_advance", score: strongest.strength }
    : { verdict: "advance", score: 1 - strongest.strength };
}

export const ALL_STREAMS: Stream[] = [
  "qsar", "cytotox", "toxicogenomics", "transporter", "invivo_rodent", "invivo_nonrodent",
];
```

- [ ] **Step 5: Write the loader and the evidence validator**

Create `apps/harness/src/load.ts`:

```ts
import { readFileSync } from "node:fs";
import { EvidenceClaimSchema, RulesetSchema, type AssayOperator, type EvidenceClaim, type Ruleset } from "@arbiter/engine";
import { rulesetHash } from "./hash.js";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

export interface Inputs {
  claimsByCompound: Map<string, EvidenceClaim[]>;
  benchmarkIds: string[];
  splits: { seed: number; train: string[]; calibration: string[]; test: string[] };
  truth: Map<string, number>;
  ruleset: Ruleset;
  hash: string;
  assays: AssayOperator[];
}

/**
 * Load and VALIDATE every input before the harness computes anything.
 *
 * A malformed evidence file must fail here, loudly, rather than producing a
 * plausible-looking number downstream.
 */
export function loadInputs(): Inputs {
  const ruleset = RulesetSchema.parse(read("rules/ruleset-v1.0.json")) as Ruleset;
  const evidence = read("data/out/evidence.json");
  const splits = read("data/out/splits.json");
  const compounds = read("data/out/compounds.json").compounds as { compoundId: string; y: number }[];
  const assays = read("data/out/assays.json").assays as AssayOperator[];

  const claimsByCompound = new Map<string, EvidenceClaim[]>();
  for (const raw of evidence.claims) {
    const claim = EvidenceClaimSchema.parse(raw) as EvidenceClaim;
    const list = claimsByCompound.get(claim.compoundId) ?? [];
    list.push(claim);
    claimsByCompound.set(claim.compoundId, list);
  }

  return {
    claimsByCompound,
    benchmarkIds: evidence.benchmarkCompoundIds as string[],
    splits,
    truth: new Map(compounds.map((c) => [c.compoundId, c.y])),
    ruleset,
    hash: rulesetHash({
      rules: ruleset.rules,
      abstentionGapThreshold: ruleset.abstentionGapThreshold,
      dilirankBinarisation: ruleset.dilirankBinarisation,
    }),
    assays,
  };
}

/** Claims visible as of a date. The engine cannot do this - it has no clock. */
export function asOf(claims: EvidenceClaim[], date: string): EvidenceClaim[] {
  return claims.filter((c) => c.availableFrom <= date);
}
```

Create `apps/harness/src/validate-evidence.ts`:

```ts
import { loadInputs } from "./load.js";

const { claimsByCompound, benchmarkIds, splits, ruleset, hash } = loadInputs();
const nClaims = [...claimsByCompound.values()].reduce((s, v) => s + v.length, 0);

// The fixture must never be a benchmark row.
const leaked = benchmarkIds.filter((id) => id.startsWith("TAK-994"));
if (leaked.length > 0) throw new Error(`TAK-994 leaked into the benchmark: ${leaked.join(", ")}`);

console.log(JSON.stringify({
  ok: true,
  claims: nClaims,
  compoundsWithEvidence: claimsByCompound.size,
  benchmarkCompounds: benchmarkIds.length,
  testSplit: splits.test.length,
  rulesetVersion: ruleset.version,
  rulesetHash: hash,
}, null, 2));
```

Add to the root `package.json` scripts:

```json
    "validate:evidence": "tsx apps/harness/src/validate-evidence.ts",
```

- [ ] **Step 6: Write the harness entry point**

Create `apps/harness/src/main.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { detectConflict, reason, type Reasoning } from "@arbiter/engine";
import { ALL_STREAMS, bestSingleSource, majorityVote, weightedAverage, type Prediction } from "./baselines.js";
import { loadInputs } from "./load.js";

export interface ResultRow {
  compoundId: string;
  y: number;
  conflicting: boolean;
  arbiter: Reasoning;
  baselines: Record<string, Prediction>;
}

function main(): void {
  const { claimsByCompound, splits, truth, ruleset, hash, assays } = loadInputs();

  // ONLY the test split is scored. train fitted the QSAR model, calibration set
  // the conformal threshold; scoring either would be leakage.
  const rows: ResultRow[] = [];
  for (const compoundId of splits.test) {
    const claims = claimsByCompound.get(compoundId) ?? [];
    const y = truth.get(compoundId);
    if (y === undefined) continue;

    const baselines: Record<string, Prediction> = {
      majorityVote: majorityVote(claims),
      weightedAverage: weightedAverage(claims),
    };
    for (const s of ALL_STREAMS) baselines[`single:${s}`] = bestSingleSource(claims, s);

    rows.push({
      compoundId,
      y,
      conflicting: detectConflict(claims).conflicting,
      arbiter: reason(claims, ruleset, hash, assays),
      baselines,
    });
  }

  mkdirSync("results", { recursive: true });
  writeFileSync("results/results.json", JSON.stringify({
    rulesetVersion: ruleset.version,
    rulesetHash: hash,
    splitSeed: splits.seed,
    scoredSplit: "test",
    n: rows.length,
    nConflicting: rows.filter((r) => r.conflicting).length,
    rows,
  }, null, 2));

  console.log(JSON.stringify({
    scored: rows.length,
    conflictSubset: rows.filter((r) => r.conflicting).length,
    arbiterAbstentions: rows.filter((r) => r.arbiter.verdict === "abstain").length,
    rulesetHash: hash,
  }, null, 2));
}

main();
```

- [ ] **Step 7: Run everything and verify it passes**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- apps/harness && npm run validate:evidence && npm run harness && npm run lint && npm run typecheck
```

Expected: PASS (11 harness tests). `validate:evidence` prints `ok: true` with the ruleset hash. `harness` writes `results/results.json` and prints the scored count, the conflict-subset size, and the abstention count. **Record the conflict-subset size** — it is the denominator of the headline metric.

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && echo "results/" >> .gitignore && git add .gitignore package.json apps/harness && git commit -m "Add harness: engine run over the test split plus three deterministic baselines

Only the test split is scored - train fitted the QSAR model and calibration set
the conformal threshold, so scoring either would be leakage.

The baselines are implemented to exhibit their real flaws rather than being
strawmanned, and there are tests asserting they do:
- majorityVote has nowhere to put 'I don't know', so an ambiguous claim is
  simply not a toxic vote and silence leans safe. That is precisely what
  Dempster-Shafer refuses to do
- weightedAverage is included because majority vote is not actually averaging,
  and averaging is what the pitch claims to beat. An ambiguous claim lands as a
  zero-strength safe vote
- bestSingleSource is the unflattering bar, run per stream, included because if
  one predictor matches the whole system the complexity is not earning its place

All randomness in the project now lives in prng.ts (mulberry32, seeded), since
the engine bans Math.random. Platform-identical output matters because CI has
to reproduce a local number exactly in Task 16.

validate:evidence fails loudly on a malformed evidence file and refuses to let
TAK-994 appear in benchmarkCompoundIds.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: LLM ablation baseline via the Batches API

**The most important thing we build**, per the spec: without the ablation, "symbolic reasoning beats black-box judgment on conflicting evidence" is an argument. With it, it is a measurement. It is also a test that could have disproved our own premise.

**Four decisions that need stating before the code, because each is a Q&A answer:**

1. **No `temperature`, and none is possible.** The parameter does not exist on `claude-opus-5` — sending it returns HTTP 400. We record the sampling configuration as *"none available"*. This is stronger than disclosing a value: nobody can claim we tuned a knob to manufacture variance, because there is no knob.
2. **Thinking stays ON** (the model's default). Disabling it would strawman the baseline, and on this model disabled thinking is *also* known to leak `<thinking>` tags into visible output, which would corrupt a structured-output run. Leaving it on is both fairer and safer.
3. **Structured outputs**, not prompted JSON. The verdict is schema-guaranteed, so "your parser mangled the LLM's answer" cannot explain away its variance.
4. **Refusals are exclusions, never wrong answers.** Drug-hepatotoxicity prompts can trip `bio`-category safety classifiers. A refusal is HTTP 200 with `stop_reason: "refusal"` and empty content. We count them and report the rate.

**Files:**
- Create: `apps/harness/src/ablation.ts`, `apps/harness/src/run-ablation.ts`
- Modify: `package.json` — add `@anthropic-ai/sdk` and an `ablation` script
- Test: `apps/harness/test/ablation.test.ts`

**Interfaces:**
- Consumes: `loadInputs` from `./load.js`; `EvidenceClaim`
- Produces:
  - `const LlmVerdictSchema` (zod) — `{ verdict: "advance" | "do_not_advance" | "abstain", confidence: number, reasoning: string }`
  - `buildEvidenceBlock(claims: EvidenceClaim[]): string`
  - `buildRequests(compoundId, claims, runs): BatchRequest[]`
  - `summariseRuns(runs: AblationRun[]): { modalVerdict; agreementRate; confidenceStdDev; nRefusals }`
  - `results/ablation.json` — every run, cached so the batch is never re-billed

- [ ] **Step 1: Add the SDK**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm install @anthropic-ai/sdk@^0.65.0 --workspace @arbiter/harness && npm exec -- node -e "console.log(require('@anthropic-ai/sdk/package.json').version)"
```

Add to root `package.json` scripts:

```json
    "ablation": "tsx apps/harness/src/run-ablation.ts",
```

- [ ] **Step 2: Write the failing tests**

These test the pure parts — prompt construction and run summarisation. Nothing here calls the API; the network path is exercised manually in Step 6.

Create `apps/harness/test/ablation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ABLATION_CONFIG, LlmVerdictSchema, buildEvidenceBlock, buildRequests, summariseRuns, type AblationRun } from "../src/ablation.js";
import type { EvidenceClaim } from "@arbiter/engine";

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "Tox21", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("ABLATION_CONFIG", () => {
  it("NEVER declares a temperature - the parameter does not exist on this model", () => {
    const json = JSON.stringify(ABLATION_CONFIG);
    expect(json).not.toMatch(/temperature/i);
    expect(json).not.toMatch(/top_p/i);
    expect(json).not.toMatch(/top_k/i);
  });

  it("records sampling as unavailable rather than omitting the field", () => {
    // Silence would read as an oversight; an explicit record is the Q&A answer.
    expect(ABLATION_CONFIG.sampling).toMatch(/not available|none/i);
  });

  it("runs 25 times per compound, as pre-registered", () => {
    expect(ABLATION_CONFIG.runsPerCompound).toBe(25);
  });

  it("leaves thinking at the model default rather than disabling it", () => {
    expect(ABLATION_CONFIG.thinking).toMatch(/default|adaptive|on/i);
  });
});

describe("buildEvidenceBlock", () => {
  it("includes every claim's stream, assertion, and strength", () => {
    const text = buildEvidenceBlock([
      claim({ id: "a", stream: "qsar", assertion: "toxic", strength: 0.7 }),
      claim({ id: "b", stream: "transporter", assertion: "safe", strength: 0.6 }),
    ]);
    expect(text).toContain("qsar");
    expect(text).toContain("transporter");
    expect(text).toContain("0.7");
    expect(text).toContain("0.6");
  });

  it("renders ambiguous as an explicit 'cannot determine', never as missing", () => {
    const text = buildEvidenceBlock([claim({ id: "a", assertion: "ambiguous", strength: 0 })]);
    expect(text.toLowerCase()).toMatch(/ambiguous|cannot determine/);
  });

  it("gives the LLM the SAME evidence as the engine - no rules, no hints", () => {
    const text = buildEvidenceBlock([claim({ id: "a" })]);
    // The ablation isolates the reasoning layer. Leaking R1-R6 into the prompt
    // would make this a test of prompt engineering, not of the engine.
    expect(text).not.toMatch(/\bR[1-6]\b/);
    expect(text.toLowerCase()).not.toContain("human relevance");
    expect(text.toLowerCase()).not.toContain("dempster");
  });

  it("is byte-identical for identical claims, so the prefix can cache", () => {
    const claims = [claim({ id: "a" }), claim({ id: "b", stream: "qsar" })];
    expect(buildEvidenceBlock(claims)).toBe(buildEvidenceBlock(claims));
  });
});

describe("buildRequests", () => {
  it("creates one request per run with unique custom_ids", () => {
    const reqs = buildRequests("CID1", [claim({ id: "a" })], 25);
    expect(reqs).toHaveLength(25);
    expect(new Set(reqs.map((r) => r.custom_id)).size).toBe(25);
  });

  it("encodes the compound and run index in custom_id, since results arrive unordered", () => {
    const reqs = buildRequests("CID1", [claim({ id: "a" })], 3);
    expect(reqs[0]!.custom_id).toContain("CID1");
    expect(reqs.map((r) => r.custom_id).join()).toMatch(/0.*1.*2/);
  });

  it("sets max_tokens with headroom for thinking, which is on by default", () => {
    const [req] = buildRequests("CID1", [claim({ id: "a" })], 1);
    // max_tokens caps thinking AND response text together on this model.
    expect(req!.params.max_tokens).toBeGreaterThanOrEqual(4000);
  });

  it("marks the evidence prefix cacheable", () => {
    const [req] = buildRequests("CID1", [claim({ id: "a" })], 1);
    expect(JSON.stringify(req!.params)).toContain("cache_control");
  });
});

describe("summariseRuns", () => {
  const run = (verdict: AblationRun["verdict"], confidence: number): AblationRun =>
    ({ compoundId: "X", runIndex: 0, verdict, confidence, refused: false });

  it("reports perfect agreement when every run agrees", () => {
    const s = summariseRuns([run("advance", 0.8), run("advance", 0.8), run("advance", 0.8)]);
    expect(s.agreementRate).toBe(1);
    expect(s.modalVerdict).toBe("advance");
    expect(s.confidenceStdDev).toBeCloseTo(0, 10);
  });

  it("measures disagreement across runs - the headline consistency claim", () => {
    const s = summariseRuns([run("advance", 0.9), run("do_not_advance", 0.7), run("advance", 0.8)]);
    expect(s.agreementRate).toBeCloseTo(2 / 3, 6);
    expect(s.confidenceStdDev).toBeGreaterThan(0);
  });

  it("EXCLUDES refusals from agreement and counts them separately", () => {
    const refusal: AblationRun = { compoundId: "X", runIndex: 3, verdict: null, confidence: null, refused: true };
    const s = summariseRuns([run("advance", 0.8), run("advance", 0.8), refusal]);
    expect(s.nRefusals).toBe(1);
    expect(s.agreementRate).toBe(1); // computed over the two non-refused runs only
  });

  it("reports a null modal verdict when every run was refused", () => {
    const s = summariseRuns([{ compoundId: "X", runIndex: 0, verdict: null, confidence: null, refused: true }]);
    expect(s.modalVerdict).toBeNull();
    expect(s.nRefusals).toBe(1);
  });
});

describe("LlmVerdictSchema", () => {
  it("accepts a well-formed verdict", () => {
    expect(LlmVerdictSchema.parse({ verdict: "advance", confidence: 0.7, reasoning: "x" }).verdict).toBe("advance");
  });

  it("rejects a confidence outside 0..1", () => {
    expect(() => LlmVerdictSchema.parse({ verdict: "advance", confidence: 4, reasoning: "x" })).toThrow();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- apps/harness/test/ablation.test.ts
```

Expected: FAIL — `Cannot find module '../src/ablation.js'`

- [ ] **Step 4: Write the ablation module**

Create `apps/harness/src/ablation.ts`:

```ts
import { z } from "zod";
import type { EvidenceClaim } from "@arbiter/engine";

/**
 * Configuration, recorded verbatim into results so the protocol is disclosed
 * rather than described.
 *
 * NOTE THE ABSENCE OF temperature. On claude-opus-5 the sampling parameters
 * (temperature, top_p, top_k) do not exist - sending one returns HTTP 400. So
 * the variance this baseline exhibits is the model's own at settings we could
 * not have tuned. That is a stronger position than disclosing a value.
 */
export const ABLATION_CONFIG = {
  model: "claude-opus-5",
  runsPerCompound: 25,
  maxTokens: 8000,
  /** On by default on this model. Deliberately NOT disabled - see below. */
  thinking: "model default (adaptive, on)",
  effort: "high (API default)",
  sampling: "not available on this model - temperature/top_p/top_k are rejected with HTTP 400",
  thinkingRationale:
    "Left on for two reasons. Disabling it would strawman the baseline by denying it the reasoning the engine is being compared against. And on this model disabled thinking is known to leak <thinking> tags into visible output, which would corrupt a structured-output run.",
  api: "Message Batches (50% of standard pricing; correct shape for offline, non-latency-sensitive work)",
} as const;

/** The LLM's answer, schema-enforced so parsing can never be blamed for variance. */
export const LlmVerdictSchema = z.object({
  verdict: z.enum(["advance", "do_not_advance", "abstain"]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

export interface AblationRun {
  compoundId: string;
  runIndex: number;
  verdict: "advance" | "do_not_advance" | "abstain" | null;
  confidence: number | null;
  refused: boolean;
  refusalCategory?: string | null;
  error?: string;
}

export interface BatchRequest {
  custom_id: string;
  params: Record<string, unknown>;
}

const SYSTEM_PROMPT =
  "You are a preclinical safety reviewer assessing whether a drug candidate should advance, " +
  "based only on the evidence provided. Return a verdict, a calibrated confidence in [0,1], " +
  "and a one-paragraph justification.";

/**
 * Render the evidence exactly as the engine sees it - and NOTHING ELSE.
 *
 * No rule names, no preference ordering, no mention of belief functions. The
 * ablation isolates the contribution of the reasoning engine; leaking R1-R6
 * into the prompt would turn it into a test of prompt engineering instead.
 *
 * Output is a pure function of the claims, so 25 runs share a byte-identical
 * prefix and can hit the prompt cache.
 */
export function buildEvidenceBlock(claims: EvidenceClaim[]): string {
  if (claims.length === 0) return "No evidence is available for this compound.";
  const lines = [...claims]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((c) => {
      const finding =
        c.assertion === "ambiguous"
          ? "AMBIGUOUS - this source cannot determine an answer"
          : c.assertion.toUpperCase();
      const parts = [
        `- Source: ${c.stream}`,
        `  Biological system: ${c.system}`,
        `  Finding: ${finding}`,
        `  Source-reported confidence: ${c.strength}`,
        `  Measures a mechanistic key event: ${c.measuresKeyEvent ?? "no"}`,
        `  Tested at clinically relevant exposure: ${c.exposureRelevant === null ? "unstated" : c.exposureRelevant}`,
        `  Within the model's applicability domain: ${c.inApplicabilityDomain === null ? "not assessed" : c.inApplicabilityDomain}`,
        `  Study reliability (Klimisch, 1 best): ${c.klimisch ?? "not scored"}`,
        `  Provenance: ${c.provenance.kind} - ${c.provenance.source}`,
      ];
      return parts.join("\n");
    });
  return `Evidence for this compound (${claims.length} source${claims.length === 1 ? "" : "s"}):\n\n${lines.join("\n\n")}`;
}

export function buildRequests(compoundId: string, claims: EvidenceClaim[], runs: number): BatchRequest[] {
  const evidence = buildEvidenceBlock(claims);
  return Array.from({ length: runs }, (_, runIndex) => ({
    custom_id: `${compoundId}::run-${runIndex}`,
    params: {
      model: ABLATION_CONFIG.model,
      max_tokens: ABLATION_CONFIG.maxTokens,
      // No temperature / top_p / top_k. They are rejected on this model.
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        // Cacheable prefix. Batch requests run concurrently, so cache reads are
        // opportunistic rather than guaranteed - the 50% batch discount is the
        // saving we actually rely on. Recorded either way from usage.
        { type: "text", text: evidence, cache_control: { type: "ephemeral" } },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              verdict: { type: "string", enum: ["advance", "do_not_advance", "abstain"] },
              confidence: { type: "number" },
              reasoning: { type: "string" },
            },
            required: ["verdict", "confidence", "reasoning"],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: "user", content: "Assess this compound and return your verdict." }],
    },
  }));
}

/**
 * Collapse 25 runs into the numbers the consistency metric needs.
 *
 * Refusals are EXCLUDED from the agreement denominator and counted separately.
 * A refused run is a request the classifier declined; scoring it as a wrong
 * answer would understate the baseline and overstate ARBITER.
 */
export function summariseRuns(runs: AblationRun[]): {
  modalVerdict: AblationRun["verdict"];
  agreementRate: number;
  confidenceStdDev: number;
  nRefusals: number;
  nScored: number;
} {
  const nRefusals = runs.filter((r) => r.refused).length;
  const scored = runs.filter((r) => !r.refused && r.verdict !== null);
  if (scored.length === 0) {
    return { modalVerdict: null, agreementRate: 0, confidenceStdDev: 0, nRefusals, nScored: 0 };
  }

  const counts = new Map<string, number>();
  for (const r of scored) counts.set(r.verdict!, (counts.get(r.verdict!) ?? 0) + 1);
  const [modal, modalCount] = [...counts.entries()].sort((a, b) =>
    b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  )[0]!;

  const confs = scored.map((r) => r.confidence ?? 0);
  const mean = confs.reduce((s, v) => s + v, 0) / confs.length;
  const variance = confs.reduce((s, v) => s + (v - mean) ** 2, 0) / confs.length;

  return {
    modalVerdict: modal as AblationRun["verdict"],
    agreementRate: modalCount / scored.length,
    confidenceStdDev: Math.sqrt(variance),
    nRefusals,
    nScored: scored.length,
  };
}
```

- [ ] **Step 5: Write the batch runner**

Create `apps/harness/src/run-ablation.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ABLATION_CONFIG, LlmVerdictSchema, buildRequests, summariseRuns, type AblationRun, type BatchRequest } from "./ablation.js";
import { loadInputs } from "./load.js";

const OUT = "results/ablation.json";

/**
 * Submit the ablation as ONE batch and cache the result.
 *
 * The batch is billed once. If results/ablation.json already exists this script
 * exits without spending anything - re-running the harness must never re-bill.
 * Delete the file deliberately to re-run.
 */
async function main(): Promise<void> {
  if (existsSync(OUT)) {
    console.log(`${OUT} exists - refusing to re-bill. Delete it deliberately to re-run.`);
    return;
  }

  const { claimsByCompound, splits, ruleset, hash } = loadInputs();
  const client = new Anthropic(); // resolves ANTHROPIC_API_KEY or an `ant auth login` profile

  const requests: BatchRequest[] = [];
  for (const compoundId of splits.test) {
    const claims = claimsByCompound.get(compoundId) ?? [];
    requests.push(...buildRequests(compoundId, claims, ABLATION_CONFIG.runsPerCompound));
  }
  console.log(`Submitting ${requests.length} requests (${splits.test.length} compounds x ${ABLATION_CONFIG.runsPerCompound} runs)`);

  const batch = await client.messages.batches.create({ requests: requests as never });
  console.log(`Batch ${batch.id} submitted; polling.`);

  let status = batch;
  while (status.processing_status !== "ended") {
    await new Promise((r) => setTimeout(r, 30_000));
    status = await client.messages.batches.retrieve(batch.id);
    console.log(`  ${status.processing_status} - succeeded ${status.request_counts.succeeded}, errored ${status.request_counts.errored}`);
  }

  // Results arrive in ANY order. Key by custom_id, never by position.
  const runs: AblationRun[] = [];
  let cacheReadTokens = 0;
  for await (const result of await client.messages.batches.results(batch.id)) {
    const [compoundId, runTag] = result.custom_id.split("::");
    const runIndex = Number((runTag ?? "run-0").replace("run-", ""));
    const base = { compoundId: compoundId!, runIndex };

    if (result.result.type !== "succeeded") {
      runs.push({ ...base, verdict: null, confidence: null, refused: false, error: result.result.type });
      continue;
    }

    const msg = result.result.message;
    cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;

    // CHECK stop_reason BEFORE READING content. A refusal is HTTP 200 with an
    // empty content array; indexing content[0] here would throw.
    if (msg.stop_reason === "refusal") {
      runs.push({
        ...base, verdict: null, confidence: null, refused: true,
        refusalCategory: msg.stop_details?.category ?? null,
      });
      continue;
    }

    const text = msg.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      runs.push({ ...base, verdict: null, confidence: null, refused: false, error: "no text block" });
      continue;
    }

    const parsed = LlmVerdictSchema.safeParse(JSON.parse(text.text));
    runs.push(parsed.success
      ? { ...base, verdict: parsed.data.verdict, confidence: parsed.data.confidence, refused: false }
      : { ...base, verdict: null, confidence: null, refused: false, error: "schema mismatch" });
  }

  const byCompound: Record<string, ReturnType<typeof summariseRuns>> = {};
  for (const compoundId of splits.test) {
    byCompound[compoundId] = summariseRuns(runs.filter((r) => r.compoundId === compoundId));
  }

  const nRefused = runs.filter((r) => r.refused).length;
  mkdirSync("results", { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    batchId: batch.id,
    config: ABLATION_CONFIG,
    rulesetVersion: ruleset.version,
    rulesetHash: hash,
    totals: {
      requests: runs.length,
      refused: nRefused,
      refusalRate: runs.length > 0 ? nRefused / runs.length : 0,
      cacheReadTokens,
    },
    byCompound,
    runs,
  }, null, 2));

  console.log(JSON.stringify({
    runs: runs.length,
    refused: nRefused,
    refusalRate: (nRefused / runs.length).toFixed(4),
    compoundsWithAnyRefusal: Object.values(byCompound).filter((s) => s.nRefusals > 0).length,
    meanAgreementRate: (
      Object.values(byCompound).filter((s) => s.nScored > 0).reduce((s, v) => s + v.agreementRate, 0) /
      Math.max(1, Object.values(byCompound).filter((s) => s.nScored > 0).length)
    ).toFixed(4),
    cacheReadTokens,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Add `results/ablation.json` to git (it is a *result*, not a build artifact) by amending `.gitignore`:

```
results/*
!results/ablation.json
```

- [ ] **Step 6: Run the unit tests, then the batch once**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- apps/harness/test/ablation.test.ts && npm run lint && npm run typecheck
```

Expected: PASS (14 tests), lint and typecheck clean.

Then confirm credentials and submit the batch. **This is the only step in Phase 1 that costs money** — expect roughly $20–40 depending on test-split size, since thinking output dominates and the batch discount halves it.

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm run ablation
```

Expected: a batch id, then poll lines every 30s until `ended`, then a summary. **Record `refusalRate` and `meanAgreementRate`.** If `refusalRate` is above ~0.05, report it before continuing — a materially refused benchmark needs disclosing in §8 and may need a prompt that frames the task as safety review more explicitly.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && git add .gitignore package.json package-lock.json apps/harness results/ablation.json && git commit -m "Add LLM ablation baseline via the Batches API

The spec calls this the most important thing we build: without it, 'symbolic
reasoning beats black-box judgment on conflicting evidence' is an argument;
with it, it is a measurement, and it is a test that could have disproved our
own premise.

Four decisions, each a Q&A answer, all recorded into results/ablation.json:

- NO temperature, because none exists. The sampling parameters are rejected
  with HTTP 400 on claude-opus-5, so the variance measured is the model's own
  at settings we could not have tuned. A test asserts the request config
  contains no temperature/top_p/top_k, and the config records sampling as
  explicitly unavailable rather than omitting the field
- Thinking left ON at the model default. Disabling it would strawman the
  baseline by denying it the reasoning the engine is compared against, and on
  this model disabled thinking is known to leak <thinking> tags into visible
  output, which would corrupt a structured-output run
- Structured outputs rather than prompted JSON, so 'your parser mangled the
  answer' cannot explain away the variance
- Refusals are exclusions, not wrong answers. Drug-hepatotoxicity prompts can
  trip bio-category classifiers; a refusal is HTTP 200 with empty content, so
  stop_reason is checked before content is read, refusals are excluded from the
  agreement denominator, and the refusal rate is reported

The prompt gives the model exactly the evidence the engine sees and nothing
else - a test asserts R1-R6 and the fusion vocabulary never leak into it, since
that would make this a test of prompt engineering rather than of the engine.

Results are cached: the runner refuses to re-bill if results/ablation.json
exists. Results are keyed by custom_id because the Batches API returns them in
any order.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: The metrics suite

**One design decision needs stating up front, because it changes what metric 3 means.**

The spec asks for "how often the true label falls within the belief-to-plausibility interval." Read literally against a binary truth label, that requires `belief ≤ y ≤ plausibility` — so covering `y = 1` demands plausibility of exactly 1, meaning zero mass assigned to safe. That is a demanding bar and it will read low. We report it anyway, and we report **the number that actually tests the honesty claim**: is the interval **wider on the cases ARBITER got wrong** than on the ones it got right? If the answer is yes, the uncertainty is doing its job. That is more meaningful than coverage against a binary label, and it is the calibration number worth putting on a slide.

**Files:**
- Create: `apps/harness/src/stats.ts`, `apps/harness/src/metrics.ts`, `apps/harness/src/run-metrics.ts`
- Modify: `packages/engine/src/index.ts` — export `reasonVerdictOnly`
- Modify: `package.json` — add a `metrics` script
- Test: `apps/harness/test/stats.test.ts`, `apps/harness/test/metrics.test.ts`

**Interfaces:**
- Consumes: `results/results.json`, `results/ablation.json`, `loadInputs`, `mulberry32`, `jitter01`
- Produces:
  - `wilson(successes: number, n: number, z?: number): { lo: number; hi: number }`
  - `balancedAccuracy(pairs: { y: number; predicted: number }[]): number`
  - `confusion(pairs): { tp: number; fp: number; tn: number; fn: number }`
  - `reasonVerdictOnly(claims, ruleset): Reasoning` — skips counterfactual and planner
  - `results/metrics.json`

- [ ] **Step 1: Write the failing stats tests**

Create `apps/harness/test/stats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { balancedAccuracy, confusion, wilson } from "../src/stats.js";

describe("wilson", () => {
  it("brackets the point estimate", () => {
    const { lo, hi } = wilson(7, 10);
    expect(lo).toBeLessThan(0.7);
    expect(hi).toBeGreaterThan(0.7);
  });

  it("narrows as n grows - the whole reason we report intervals", () => {
    const small = wilson(70, 100);
    const large = wilson(700, 1000);
    expect(large.hi - large.lo).toBeLessThan(small.hi - small.lo);
  });

  it("stays inside [0,1] at the extremes, unlike a normal approximation", () => {
    for (const [s, n] of [[0, 10], [10, 10], [0, 1], [1, 1]] as const) {
      const { lo, hi } = wilson(s, n);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
    }
  });

  it("returns the full interval for n = 0 rather than NaN", () => {
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
  });
});

describe("confusion and balancedAccuracy", () => {
  it("counts the four cells correctly", () => {
    const c = confusion([
      { y: 1, predicted: 1 }, { y: 1, predicted: 0 },
      { y: 0, predicted: 0 }, { y: 0, predicted: 1 },
    ]);
    expect(c).toEqual({ tp: 1, fn: 1, tn: 1, fp: 1 });
  });

  it("gives 0.5 for a coin flip on balanced data", () => {
    expect(balancedAccuracy([
      { y: 1, predicted: 1 }, { y: 1, predicted: 0 },
      { y: 0, predicted: 0 }, { y: 0, predicted: 1 },
    ])).toBeCloseTo(0.5, 10);
  });

  it("IS NOT FOOLED BY CLASS IMBALANCE - this is why we use it over accuracy", () => {
    // 90 negatives, 10 positives, predict all negative.
    // Plain accuracy would be 0.90; balanced accuracy is 0.50.
    const pairs = [
      ...Array.from({ length: 90 }, () => ({ y: 0, predicted: 0 })),
      ...Array.from({ length: 10 }, () => ({ y: 1, predicted: 0 })),
    ];
    expect(balancedAccuracy(pairs)).toBeCloseTo(0.5, 10);
  });

  it("returns 0.5 when a class is absent rather than dividing by zero", () => {
    expect(balancedAccuracy([{ y: 1, predicted: 1 }])).toBeCloseTo(0.5, 10);
  });
});
```

- [ ] **Step 2: Write the failing metrics tests**

Create `apps/harness/test/metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { abstentionQuality, calibration, conflictSubsetAccuracy, robustness } from "../src/metrics.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "@arbiter/engine";
import type { ResultRow } from "../src/main.js";

const RS = ruleset as Ruleset;

function row(over: Partial<ResultRow> & { compoundId: string; y: number }): ResultRow {
  return {
    conflicting: true,
    arbiter: {
      verdict: "do_not_advance", contested: true, belief: 0.4, plausibility: 0.6,
      conflictMass: 0.1, trace: [], counterfactual: null, nextExperiment: null, rulesetHash: "h",
    },
    baselines: { majorityVote: { verdict: "advance", score: 0.3 } },
    ...over,
  } as ResultRow;
}

describe("conflictSubsetAccuracy", () => {
  it("scores ONLY the conflict subset - unanimous cases inflate the number", () => {
    const rows = [
      row({ compoundId: "a", y: 1, conflicting: true }),
      row({ compoundId: "b", y: 0, conflicting: false }), // must be ignored
    ];
    const r = conflictSubsetAccuracy(rows);
    expect(r.n).toBe(1);
  });

  it("EXCLUDES abstentions from accuracy and reports coverage alongside", () => {
    const rows = [
      row({ compoundId: "a", y: 1 }),
      row({ compoundId: "b", y: 1, arbiter: { ...row({ compoundId: "b", y: 1 }).arbiter, verdict: "abstain" } }),
    ];
    const r = conflictSubsetAccuracy(rows);
    expect(r.arbiter.nCommitted).toBe(1);
    expect(r.arbiter.coverage).toBeCloseTo(0.5, 10);
    // 85% accuracy while abstaining on 60% is meaningless - the pair must travel together.
    expect(r.arbiter).toHaveProperty("balancedAccuracy");
    expect(r.arbiter).toHaveProperty("coverage");
  });

  it("returns a Wilson interval alongside every point estimate", () => {
    const r = conflictSubsetAccuracy([row({ compoundId: "a", y: 1 })]);
    expect(r.arbiter.ci).toHaveProperty("lo");
    expect(r.arbiter.ci).toHaveProperty("hi");
  });

  it("scores every baseline on the same subset", () => {
    const r = conflictSubsetAccuracy([row({ compoundId: "a", y: 1 })]);
    expect(Object.keys(r.baselines)).toContain("majorityVote");
  });
});

describe("calibration", () => {
  it("reports strict coverage AND mean width - a wide always-right interval is worthless", () => {
    const r = calibration([row({ compoundId: "a", y: 1 })]);
    expect(r).toHaveProperty("strictCoverage");
    expect(r).toHaveProperty("meanWidth");
  });

  it("THE HONESTY TEST: reports width split by whether ARBITER was right", () => {
    const correct = row({ compoundId: "a", y: 1 });
    correct.arbiter = { ...correct.arbiter, verdict: "do_not_advance", belief: 0.45, plausibility: 0.5 };
    const wrong = row({ compoundId: "b", y: 0 });
    wrong.arbiter = { ...wrong.arbiter, verdict: "do_not_advance", belief: 0.2, plausibility: 0.9 };

    const r = calibration([correct, wrong]);
    // Uncertainty is doing its job when the interval is wider where we were wrong.
    expect(r.meanWidthOnIncorrect).toBeGreaterThan(r.meanWidthOnCorrect);
    expect(r.widthDiscriminates).toBe(true);
  });
});

describe("abstentionQuality", () => {
  it("reports accuracy on committed cases, the decline rate, and both together", () => {
    const rows = [
      row({ compoundId: "a", y: 1 }),
      row({ compoundId: "b", y: 0, arbiter: { ...row({ compoundId: "b", y: 0 }).arbiter, verdict: "abstain" } }),
    ];
    const r = abstentionQuality(rows);
    expect(r.declineRate).toBeCloseTo(0.5, 10);
    expect(r).toHaveProperty("balancedAccuracyOnCommitted");
  });
});

describe("robustness", () => {
  const claims: EvidenceClaim[] = [{
    id: "a", compoundId: "X", stream: "cytotox", assertion: "toxic", strength: 0.9,
    system: "human", measuresKeyEvent: null, exposureRelevant: true,
    inApplicabilityDomain: true, klimisch: 1, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
  }];

  it("is reproducible from the seed - it is golden-filed, so it must be", () => {
    const a = robustness(claims, RS, 200, 12345);
    const b = robustness(claims, RS, 200, 12345);
    expect(a).toEqual(b);
  });

  it("reports near-total stability for evidence that is not near a boundary", () => {
    expect(robustness(claims, RS, 500, 999).heldFraction).toBeGreaterThan(0.9);
  });

  it("distinguishes determinism from robustness - they are different claims", () => {
    const r = robustness(claims, RS, 100, 1);
    expect(r.determinism).toBe(1); // trivially true; a pure function is a pure function
    expect(r.heldFraction).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- apps/harness/test/stats.test.ts apps/harness/test/metrics.test.ts
```

Expected: FAIL — `Cannot find module '../src/stats.js'` and `'../src/metrics.js'`

- [ ] **Step 4: Add a verdict-only engine entry point**

Robustness needs ~2,000 engine evaluations per compound. `reason()` also runs the exhaustive counterfactual, which is ~130 recursive evaluations once pairs are searched over every combination of target assertions and not just a shared one — so calling it here would multiply the work by two orders of magnitude for output nobody reads. Perturbation only needs the verdict, which is what `reasonVerdictOnly` returns. (An earlier draft of this note said ≈21; that was the homogeneous-pair count.)

In `packages/engine/src/index.ts`, add:

```ts
/**
 * The verdict and range only - no counterfactual, no planner.
 *
 * For perturbation sampling, where the extras cost 20x and are never read.
 * Identical verdict/belief/plausibility to reason() by construction, because it
 * is the same reasonCore with withExtras = false.
 */
export function reasonVerdictOnly(claims: EvidenceClaim[], ruleset: Ruleset): Reasoning {
  return reasonCore(claims, ruleset, "", false, []);
}
```

- [ ] **Step 5: Write `stats.ts`**

Create `apps/harness/src/stats.ts`:

```ts
export interface Interval { lo: number; hi: number }

/**
 * Wilson score interval for a binomial proportion.
 *
 * Chosen over the normal approximation because our n is small and Wilson stays
 * inside [0,1] at the extremes, where the normal approximation produces
 * intervals like [-0.06, 0.31] that make a deck look careless.
 */
export function wilson(successes: number, n: number, z = 1.96): Interval {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export interface Confusion { tp: number; fp: number; tn: number; fn: number }

export function confusion(pairs: { y: number; predicted: number }[]): Confusion {
  const c: Confusion = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const { y, predicted } of pairs) {
    if (y === 1 && predicted === 1) c.tp++;
    else if (y === 1) c.fn++;
    else if (predicted === 1) c.fp++;
    else c.tn++;
  }
  return c;
}

/**
 * Balanced accuracy = (sensitivity + specificity) / 2.
 *
 * Plain accuracy is not reportable on DILIrank: predicting the majority class
 * on a 90/10 split scores 0.90 while learning nothing. Returns 0.5 when a class
 * is absent, rather than dividing by zero.
 */
export function balancedAccuracy(pairs: { y: number; predicted: number }[]): number {
  const { tp, fp, tn, fn } = confusion(pairs);
  const sens = tp + fn === 0 ? 0.5 : tp / (tp + fn);
  const spec = tn + fp === 0 ? 0.5 : tn / (tn + fp);
  return (sens + spec) / 2;
}

export function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length;
}
```

- [ ] **Step 6: Write `metrics.ts`**

Create `apps/harness/src/metrics.ts`:

```ts
import { reasonVerdictOnly, type AssayOperator, type EvidenceClaim, type Ruleset, type Verdict } from "@arbiter/engine";
import { planNextExperiment } from "@arbiter/engine";
import { jitter01, mulberry32, uniform } from "./prng.js";
import { balancedAccuracy, confusion, mean, wilson, type Interval } from "./stats.js";
import type { ResultRow } from "./main.js";

/** do_not_advance means "predicted toxic" = 1. abstain is not a prediction. */
const toBinary = (v: Verdict): number | null =>
  v === "do_not_advance" ? 1 : v === "advance" ? 0 : null;

export interface ScoredPipeline {
  balancedAccuracy: number;
  ci: Interval;
  /** Fraction of the subset this pipeline committed to. Travels WITH accuracy, always. */
  coverage: number;
  nCommitted: number;
  confusion: ReturnType<typeof confusion>;
}

function score(pairs: { y: number; predicted: number | null }[]): ScoredPipeline {
  const committed = pairs.filter((p) => p.predicted !== null) as { y: number; predicted: number }[];
  const acc = balancedAccuracy(committed);
  const correct = committed.filter((p) => p.y === p.predicted).length;
  return {
    balancedAccuracy: acc,
    ci: wilson(correct, committed.length),
    coverage: pairs.length === 0 ? 0 : committed.length / pairs.length,
    nCommitted: committed.length,
    confusion: confusion(committed),
  };
}

/**
 * METRIC 1 (headline): balanced accuracy on the CONFLICT SUBSET only.
 *
 * Overall accuracy is inflated by easy unanimous cases. The conflict subset is
 * where the product lives, so it is the only subset reported as the headline.
 *
 * Accuracy is ALWAYS returned with coverage. 85% accuracy while abstaining on
 * 60% of cases is not an 85% system, and reporting the pair together is the
 * only way that number means what a reader will take it to mean.
 */
export function conflictSubsetAccuracy(rows: ResultRow[]): {
  n: number;
  arbiter: ScoredPipeline;
  baselines: Record<string, ScoredPipeline>;
} {
  const subset = rows.filter((r) => r.conflicting);
  const arbiter = score(subset.map((r) => ({ y: r.y, predicted: toBinary(r.arbiter.verdict) })));

  const names = new Set<string>();
  for (const r of subset) for (const k of Object.keys(r.baselines)) names.add(k);

  const baselines: Record<string, ScoredPipeline> = {};
  for (const name of [...names].sort()) {
    baselines[name] = score(subset.map((r) => ({
      y: r.y,
      predicted: r.baselines[name] ? toBinary(r.baselines[name]!.verdict) : null,
    })));
  }

  return { n: subset.length, arbiter, baselines };
}

/**
 * METRIC 3: uncertainty calibration.
 *
 * strictCoverage applies the literal Dempster-Shafer reading - the interval
 * covers y when belief <= y <= plausibility. Against a binary label that is
 * demanding: covering y=1 requires plausibility of exactly 1, i.e. zero mass on
 * safe. We report it because it is the honest literal answer, and we expect it
 * to be low.
 *
 * The number that actually TESTS THE HONESTY CLAIM is the width split: is the
 * interval wider where ARBITER was wrong than where it was right? If yes, the
 * uncertainty is doing its job, which is what "honest range" is supposed to
 * mean. meanWidth is reported alongside because a wide always-right interval is
 * worthless.
 */
export function calibration(rows: ResultRow[]): {
  strictCoverage: number;
  meanWidth: number;
  meanWidthOnCorrect: number;
  meanWidthOnIncorrect: number;
  widthDiscriminates: boolean;
  nCorrect: number;
  nIncorrect: number;
} {
  const width = (r: ResultRow) => r.arbiter.plausibility - r.arbiter.belief;
  const committed = rows.filter((r) => toBinary(r.arbiter.verdict) !== null);
  const correct = committed.filter((r) => toBinary(r.arbiter.verdict) === r.y);
  const incorrect = committed.filter((r) => toBinary(r.arbiter.verdict) !== r.y);

  const strict = rows.filter((r) => r.arbiter.belief <= r.y && r.y <= r.arbiter.plausibility).length;
  const wCorrect = mean(correct.map(width));
  const wIncorrect = mean(incorrect.map(width));

  return {
    strictCoverage: rows.length === 0 ? 0 : strict / rows.length,
    meanWidth: mean(rows.map(width)),
    meanWidthOnCorrect: wCorrect,
    meanWidthOnIncorrect: wIncorrect,
    widthDiscriminates: incorrect.length > 0 && wIncorrect > wCorrect,
    nCorrect: correct.length,
    nIncorrect: incorrect.length,
  };
}

/**
 * METRIC 4: abstention quality.
 *
 * The safety behaviour: ARBITER should be MORE accurate on what it commits to
 * than on the set as a whole, and should route the rest to a human. Decline rate
 * is reported inseparably from accuracy.
 */
export function abstentionQuality(rows: ResultRow[]): {
  declineRate: number;
  balancedAccuracyOnCommitted: number;
  ciOnCommitted: Interval;
  nDeclined: number;
  nCommitted: number;
} {
  const declined = rows.filter((r) => r.arbiter.verdict === "abstain");
  const pairs = rows
    .map((r) => ({ y: r.y, predicted: toBinary(r.arbiter.verdict) }))
    .filter((p) => p.predicted !== null) as { y: number; predicted: number }[];
  const correct = pairs.filter((p) => p.y === p.predicted).length;

  return {
    declineRate: rows.length === 0 ? 0 : declined.length / rows.length,
    balancedAccuracyOnCommitted: balancedAccuracy(pairs),
    ciOnCommitted: wilson(correct, pairs.length),
    nDeclined: declined.length,
    nCommitted: pairs.length,
  };
}

/**
 * METRIC 2b: robustness under perturbation.
 *
 * Determinism on its own is close to tautological - a pure function is a pure
 * function, and a judge is right to say "you proved your calculator does not
 * change its mind." The claim that matters is STABILITY: a deterministic system
 * that sits on a knife edge is not consistent in any useful sense.
 *
 * Evidence strength is jittered +/-10% and rule strength +/-25%. All randomness
 * comes from the seeded PRNG, and the seed is committed, because this figure is
 * golden-filed.
 */
export function robustness(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  samples: number,
  seed: number,
): { determinism: 1; heldFraction: number; samples: number; seed: number } {
  const baseline = reasonVerdictOnly(claims, ruleset).verdict;
  const next = mulberry32(seed);
  let held = 0;

  for (let i = 0; i < samples; i++) {
    const perturbedClaims = claims.map((c) => ({ ...c, strength: jitter01(next, c.strength, 0.10) }));
    const perturbedRules: Ruleset = {
      ...ruleset,
      rules: ruleset.rules.map((r) => ({ ...r, strength: jitter01(next, r.strength, 0.25) })),
    };
    if (reasonVerdictOnly(perturbedClaims, perturbedRules).verdict === baseline) held++;
  }

  return { determinism: 1, heldFraction: samples === 0 ? 1 : held / samples, samples, seed };
}

/**
 * METRIC 5: planner sensitivity.
 *
 * The planner's outcome priors are expert-elicited, not learned - the spec
 * discloses this. Rather than apologising for it, measure it: perturb every
 * prior by +/-50% and report how often the top recommendation is unchanged. If
 * the recommendation is driven by argument structure rather than by the priors,
 * this number is high, and the disclosed limitation becomes a result.
 */
export function plannerSensitivity(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  assays: AssayOperator[],
  samples: number,
  seed: number,
): { baselineAssay: string | null; unchangedFraction: number; samples: number; seed: number } {
  const bare = (c: EvidenceClaim[], rs: Ruleset) => reasonVerdictOnly(c, rs);
  const baseline = planNextExperiment(claims, ruleset, assays, bare);
  if (!baseline) return { baselineAssay: null, unchangedFraction: 1, samples: 0, seed };

  const next = mulberry32(seed);
  let unchanged = 0;
  for (let i = 0; i < samples; i++) {
    const perturbed = assays.map((a) => ({
      ...a,
      priorToxic: Math.max(0.01, Math.min(0.99, a.priorToxic * uniform(next, 0.5, 1.5))),
    }));
    if (planNextExperiment(claims, ruleset, perturbed, bare)?.assay === baseline.assay) unchanged++;
  }

  return {
    baselineAssay: baseline.assay,
    unchangedFraction: samples === 0 ? 1 : unchanged / samples,
    samples,
    seed,
  };
}
```

- [ ] **Step 7: Write the metrics runner**

Create `apps/harness/src/run-metrics.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { abstentionQuality, calibration, conflictSubsetAccuracy, plannerSensitivity, robustness } from "./metrics.js";
import { loadInputs } from "./load.js";
import { mean } from "./stats.js";
import type { ResultRow } from "./main.js";

const ROBUSTNESS_SAMPLES = 2000;
const SENSITIVITY_SAMPLES = 2000;
const SEED = 20260726;

function main(): void {
  const results = JSON.parse(readFileSync("results/results.json", "utf8")) as {
    rulesetVersion: string; rulesetHash: string; splitSeed: number; rows: ResultRow[];
  };
  const { claimsByCompound, ruleset, assays } = loadInputs();
  const rows = results.rows;
  const conflictRows = rows.filter((r) => r.conflicting);

  // Metric 2b + 5, per compound on the conflict subset.
  const rob = conflictRows.map((r) =>
    robustness(claimsByCompound.get(r.compoundId) ?? [], ruleset, ROBUSTNESS_SAMPLES, SEED));
  const sens = conflictRows
    .map((r) => plannerSensitivity(claimsByCompound.get(r.compoundId) ?? [], ruleset, assays, SENSITIVITY_SAMPLES, SEED))
    .filter((s) => s.baselineAssay !== null);

  // Metric 2a from the ablation, if it has been run.
  let llm: unknown = { note: "results/ablation.json not present - run `npm run ablation`" };
  if (existsSync("results/ablation.json")) {
    const a = JSON.parse(readFileSync("results/ablation.json", "utf8")) as {
      config: unknown;
      totals: { refusalRate: number; refused: number; requests: number };
      byCompound: Record<string, { agreementRate: number; confidenceStdDev: number; nScored: number }>;
    };
    const scored = Object.values(a.byCompound).filter((s) => s.nScored > 0);
    llm = {
      config: a.config,
      refusals: a.totals,
      meanAgreementRate: mean(scored.map((s) => s.agreementRate)),
      meanConfidenceStdDev: mean(scored.map((s) => s.confidenceStdDev)),
      nCompoundsFullyRefused: Object.values(a.byCompound).filter((s) => s.nScored === 0).length,
    };
  }

  const metrics = {
    provenance: {
      rulesetVersion: results.rulesetVersion,
      rulesetHash: results.rulesetHash,
      splitSeed: results.splitSeed,
      perturbationSeed: SEED,
      scoredSplit: "test",
      note: "Reliability priors and the QSAR model were fitted on the train split only; conformal thresholds on calibration. These numbers come from test, which neither touched.",
    },
    sampleSizes: { scored: rows.length, conflictSubset: conflictRows.length },
    metric1_conflictSubsetAccuracy: conflictSubsetAccuracy(rows),
    metric2a_llmConsistency: llm,
    metric2b_arbiterRobustness: {
      determinism: 1,
      determinismNote: "Trivially 1 - the engine is a pure function, verified by a 1000-run single-hash test. Reported for completeness; robustness below is the claim that carries weight.",
      meanHeldFraction: mean(rob.map((r) => r.heldFraction)),
      worstHeldFraction: rob.length === 0 ? 1 : Math.min(...rob.map((r) => r.heldFraction)),
      samplesPerCompound: ROBUSTNESS_SAMPLES,
      seed: SEED,
    },
    metric3_calibration: calibration(rows),
    metric4_abstentionQuality: abstentionQuality(rows),
    metric5_plannerSensitivity: {
      nCompoundsWithRecommendation: sens.length,
      meanUnchangedFraction: mean(sens.map((s) => s.unchangedFraction)),
      perturbation: "+/-50% on every expert-elicited priorToxic",
      samplesPerCompound: SENSITIVITY_SAMPLES,
      seed: SEED,
    },
  };

  writeFileSync("results/metrics.json", JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify({
    conflictSubsetN: metrics.sampleSizes.conflictSubset,
    arbiter: metrics.metric1_conflictSubsetAccuracy.arbiter,
    bestBaseline: Object.entries(metrics.metric1_conflictSubsetAccuracy.baselines)
      .sort((a, b) => b[1].balancedAccuracy - a[1].balancedAccuracy)[0],
    widthDiscriminates: metrics.metric3_calibration.widthDiscriminates,
    meanRobustness: metrics.metric2b_arbiterRobustness.meanHeldFraction,
    plannerUnchanged: metrics.metric5_plannerSensitivity.meanUnchangedFraction,
  }, null, 2));
}

main();
```

Add to root `package.json` scripts:

```json
    "metrics": "tsx apps/harness/src/run-metrics.ts",
```

- [ ] **Step 8: Run everything and verify it passes**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test && npm run lint && npm run typecheck && npm run harness && npm run metrics
```

Expected: PASS across the whole suite, then `results/metrics.json` written and a summary printed.

**Record these five numbers — they are the presentation:** conflict-subset n, ARBITER's balanced accuracy with its Wilson interval and coverage, the best baseline's, whether `widthDiscriminates` is true, and mean robustness.

**If ARBITER does not beat the best baseline, report it.** The spec says to prepare for a mixed result: if the LLM matches on accuracy, the advantage is consistency, traceability and calibration — which were likely the real advantages anyway. An honest mixed result with a clear interpretation is more credible than a suspiciously clean sweep.

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && git add package.json packages/engine apps/harness && git commit -m "Add the metrics suite

Five metrics, each with the reporting discipline the spec requires:

- Metric 1, headline: balanced accuracy on the CONFLICT SUBSET only, since
  overall accuracy is inflated by easy unanimous cases. Balanced rather than
  plain accuracy because predicting the majority class on DILIrank's imbalance
  scores 0.90 while learning nothing - there is a test asserting exactly that.
  Accuracy is structurally inseparable from coverage in the return type, because
  85% accuracy while abstaining on 60% is not an 85% system
- Metric 2b: robustness under perturbation, not just determinism. Determinism
  alone is close to tautological and a judge is right to say we proved our
  calculator does not change its mind. Evidence strength jittered +/-10%, rule
  strength +/-25%, 2000 seeded samples
- Metric 3: strict Dempster-Shafer coverage is reported because it is the honest
  literal reading, and it will be low. The number that actually tests the
  honesty claim is the width split - is the interval WIDER where ARBITER was
  wrong? If yes the uncertainty is doing its job
- Metric 4: decline rate reported inseparably from accuracy on committed cases
- Metric 5: planner sensitivity turns a disclosed limitation into a result.
  Perturb every expert-elicited prior +/-50% and report how often the top
  recommendation survives

Wilson intervals rather than the normal approximation: n is small, and Wilson
stays inside [0,1] at the extremes where the normal approximation produces
intervals like [-0.06, 0.31].

Adds reasonVerdictOnly to the engine so perturbation sampling skips the
counterfactual, which costs ~130 extra engine evaluations and is never read during sampling.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Golden files and CI — the numbers cannot drift

**What this task actually buys you.** The sharpest question in Q&A is *"are the numbers on your slide from the same code as the demo?"* Golden files make the answer structural: if anyone changes the engine, the rules, or the data in a way that moves a reported number, **the build fails**. Drift becomes a red CI run instead of a discovery mid-presentation.

**Files:**
- Create: `apps/harness/src/golden.ts`, `apps/harness/src/preflight.ts`
- Create: `apps/harness/test/golden.test.ts`
- Create: `results/golden/metrics.golden.json` (generated)
- Create: `.github/workflows/ci.yml`
- Modify: `.gitignore`, `package.json`

**Interfaces:**
- Consumes: `results/metrics.json`
- Produces:
  - `extractGolden(metrics: unknown): GoldenNumbers` — the reported-number surface only
  - `results/golden/metrics.golden.json`
  - scripts: `golden:check`, `golden:update`, `preflight`

- [ ] **Step 1: Write the failing golden test**

Create `apps/harness/test/golden.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractGolden } from "../src/golden.js";

const GOLDEN = "results/golden/metrics.golden.json";
const CURRENT = "results/metrics.json";

describe("extractGolden", () => {
  it("keeps every reported number", () => {
    const g = extractGolden({
      provenance: { rulesetHash: "abc", splitSeed: 1, perturbationSeed: 2 },
      sampleSizes: { scored: 100, conflictSubset: 40 },
      metric1_conflictSubsetAccuracy: {
        n: 40,
        arbiter: { balancedAccuracy: 0.7, coverage: 0.9, nCommitted: 36, ci: { lo: 0.5, hi: 0.85 } },
        baselines: { majorityVote: { balancedAccuracy: 0.55, coverage: 1, nCommitted: 40, ci: { lo: 0.4, hi: 0.7 } } },
      },
      metric2b_arbiterRobustness: { meanHeldFraction: 0.95, worstHeldFraction: 0.8 },
      metric3_calibration: { strictCoverage: 0.1, meanWidth: 0.3, meanWidthOnCorrect: 0.2, meanWidthOnIncorrect: 0.5, widthDiscriminates: true },
      metric4_abstentionQuality: { declineRate: 0.1, balancedAccuracyOnCommitted: 0.72 },
      metric5_plannerSensitivity: { meanUnchangedFraction: 0.94 },
    });
    expect(g.arbiterBalancedAccuracy).toBe(0.7);
    expect(g.baselines.majorityVote.balancedAccuracy).toBe(0.55);
    expect(g.widthDiscriminates).toBe(true);
    expect(g.rulesetHash).toBe("abc");
  });

  it("EXCLUDES timestamps and prose, which would make the golden file churn", () => {
    const json = JSON.stringify(extractGolden({
      provenance: { rulesetHash: "abc", splitSeed: 1, perturbationSeed: 2, note: "some prose that may be reworded" },
      sampleSizes: { scored: 1, conflictSubset: 1 },
      metric1_conflictSubsetAccuracy: { n: 1, arbiter: { balancedAccuracy: 0.5, coverage: 1, nCommitted: 1, ci: { lo: 0, hi: 1 } }, baselines: {} },
      metric2b_arbiterRobustness: { meanHeldFraction: 1, worstHeldFraction: 1, determinismNote: "prose" },
      metric3_calibration: { strictCoverage: 0, meanWidth: 0, meanWidthOnCorrect: 0, meanWidthOnIncorrect: 0, widthDiscriminates: false },
      metric4_abstentionQuality: { declineRate: 0, balancedAccuracyOnCommitted: 0.5 },
      metric5_plannerSensitivity: { meanUnchangedFraction: 1 },
      generatedAt: "2026-07-26T00:00:00Z",
    }));
    expect(json).not.toContain("generatedAt");
    expect(json).not.toContain("prose");
  });

  it("is stable across repeated extraction", () => {
    const input = {
      provenance: { rulesetHash: "h", splitSeed: 1, perturbationSeed: 2 },
      sampleSizes: { scored: 1, conflictSubset: 1 },
      metric1_conflictSubsetAccuracy: { n: 1, arbiter: { balancedAccuracy: 0.5, coverage: 1, nCommitted: 1, ci: { lo: 0, hi: 1 } }, baselines: {} },
      metric2b_arbiterRobustness: { meanHeldFraction: 1, worstHeldFraction: 1 },
      metric3_calibration: { strictCoverage: 0, meanWidth: 0, meanWidthOnCorrect: 0, meanWidthOnIncorrect: 0, widthDiscriminates: false },
      metric4_abstentionQuality: { declineRate: 0, balancedAccuracyOnCommitted: 0.5 },
      metric5_plannerSensitivity: { meanUnchangedFraction: 1 },
    };
    expect(JSON.stringify(extractGolden(input))).toBe(JSON.stringify(extractGolden(input)));
  });
});

describe("the committed golden numbers", () => {
  it("matches freshly computed metrics", () => {
    if (!existsSync(GOLDEN)) {
      // First run: there is nothing to compare against yet.
      expect(existsSync(CURRENT)).toBe(true);
      return;
    }
    expect(existsSync(CURRENT)).toBe(true);

    const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
    const current = extractGolden(JSON.parse(readFileSync(CURRENT, "utf8")));

    // A failure here means a reported number moved. That is either a bug or a
    // deliberate change - and if deliberate, `npm run golden:update` records it
    // in a commit rather than letting it slip in unnoticed.
    expect(current).toEqual(golden);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- apps/harness/test/golden.test.ts
```

Expected: FAIL — `Cannot find module '../src/golden.js'`

- [ ] **Step 3: Write the golden extractor**

Create `apps/harness/src/golden.ts`:

```ts
export interface GoldenPipeline {
  balancedAccuracy: number;
  coverage: number;
  nCommitted: number;
  ci: { lo: number; hi: number };
}

export interface GoldenNumbers {
  rulesetHash: string;
  splitSeed: number;
  perturbationSeed: number;
  nScored: number;
  nConflictSubset: number;
  arbiterBalancedAccuracy: number;
  arbiterCoverage: number;
  arbiterNCommitted: number;
  arbiterCi: { lo: number; hi: number };
  baselines: Record<string, GoldenPipeline>;
  meanHeldFraction: number;
  worstHeldFraction: number;
  strictCoverage: number;
  meanWidth: number;
  meanWidthOnCorrect: number;
  meanWidthOnIncorrect: number;
  widthDiscriminates: boolean;
  declineRate: number;
  balancedAccuracyOnCommitted: number;
  plannerMeanUnchangedFraction: number;
}

/**
 * Project metrics.json down to the numbers that are actually REPORTED.
 *
 * Prose, notes, and timestamps are excluded deliberately. Golden-filing the
 * whole document would make the file churn on every wording change, and a
 * golden file that cries wolf gets ignored - which defeats the point.
 *
 * Extraction is ordered and total, so the JSON is byte-stable.
 */
export function extractGolden(raw: unknown): GoldenNumbers {
  const m = raw as any;
  const acc = m.metric1_conflictSubsetAccuracy;

  const baselines: Record<string, GoldenPipeline> = {};
  for (const name of Object.keys(acc.baselines ?? {}).sort()) {
    const b = acc.baselines[name];
    baselines[name] = {
      balancedAccuracy: b.balancedAccuracy,
      coverage: b.coverage,
      nCommitted: b.nCommitted,
      ci: { lo: b.ci.lo, hi: b.ci.hi },
    };
  }

  return {
    rulesetHash: m.provenance.rulesetHash,
    splitSeed: m.provenance.splitSeed,
    perturbationSeed: m.provenance.perturbationSeed,
    nScored: m.sampleSizes.scored,
    nConflictSubset: m.sampleSizes.conflictSubset,
    arbiterBalancedAccuracy: acc.arbiter.balancedAccuracy,
    arbiterCoverage: acc.arbiter.coverage,
    arbiterNCommitted: acc.arbiter.nCommitted,
    arbiterCi: { lo: acc.arbiter.ci.lo, hi: acc.arbiter.ci.hi },
    baselines,
    meanHeldFraction: m.metric2b_arbiterRobustness.meanHeldFraction,
    worstHeldFraction: m.metric2b_arbiterRobustness.worstHeldFraction,
    strictCoverage: m.metric3_calibration.strictCoverage,
    meanWidth: m.metric3_calibration.meanWidth,
    meanWidthOnCorrect: m.metric3_calibration.meanWidthOnCorrect,
    meanWidthOnIncorrect: m.metric3_calibration.meanWidthOnIncorrect,
    widthDiscriminates: m.metric3_calibration.widthDiscriminates,
    declineRate: m.metric4_abstentionQuality.declineRate,
    balancedAccuracyOnCommitted: m.metric4_abstentionQuality.balancedAccuracyOnCommitted,
    plannerMeanUnchangedFraction: m.metric5_plannerSensitivity.meanUnchangedFraction,
  };
}
```

Create `apps/harness/src/update-golden.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extractGolden } from "./golden.js";

/**
 * Deliberately re-baseline the golden numbers.
 *
 * Only run this when a number moved ON PURPOSE. The resulting diff is the
 * record of what changed and belongs in its own commit with a reason.
 */
const golden = extractGolden(JSON.parse(readFileSync("results/metrics.json", "utf8")));
mkdirSync("results/golden", { recursive: true });
writeFileSync("results/golden/metrics.golden.json", JSON.stringify(golden, null, 2));
console.log("Updated results/golden/metrics.golden.json - commit the diff with a reason.");
console.log(JSON.stringify(golden, null, 2));
```

- [ ] **Step 4: Write the pre-flight check**

Create `apps/harness/src/preflight.ts`:

```ts
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { loadInputs } from "./load.js";

/**
 * Ninety seconds before presenting, answer: is everything consistent?
 *
 * Verifies the ruleset hash in the committed results matches the ruleset on
 * disk, and surfaces the pre-registration commit so its timestamp can be quoted
 * from memory instead of hunted for live.
 */
function main(): void {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const { ruleset, hash, splits, benchmarkIds } = loadInputs();

  checks.push({ name: "ruleset parses and declares six rules", ok: ruleset.rules.length === 6, detail: `v${ruleset.version}` });
  checks.push({ name: "ruleset hash", ok: true, detail: hash });

  for (const [name, file] of [["results", "results/results.json"], ["metrics", "results/metrics.json"], ["golden", "results/golden/metrics.golden.json"], ["ablation", "results/ablation.json"]] as const) {
    checks.push({ name: `${name} present`, ok: existsSync(file), detail: file });
  }

  if (existsSync("results/results.json")) {
    const r = JSON.parse(readFileSync("results/results.json", "utf8"));
    checks.push({
      name: "results were produced by THIS ruleset",
      ok: r.rulesetHash === hash,
      detail: r.rulesetHash === hash ? "match" : `results=${r.rulesetHash} disk=${hash}`,
    });
    checks.push({ name: "results scored the test split only", ok: r.scoredSplit === "test", detail: String(r.scoredSplit) });
  }

  checks.push({
    name: "TAK-994 absent from the benchmark",
    ok: !benchmarkIds.some((id) => id.startsWith("TAK-994")),
    detail: `${benchmarkIds.length} benchmark compounds`,
  });
  checks.push({ name: "test split size", ok: splits.test.length >= 60, detail: `${splits.test.length} compounds` });

  try {
    const log = execSync('git log --diff-filter=A --format="%h %cI" -- rules/ruleset-v1.0.json', { encoding: "utf8" }).trim();
    checks.push({ name: "pre-registration commit", ok: log.length > 0, detail: log || "not found" });
  } catch {
    checks.push({ name: "pre-registration commit", ok: false, detail: "git unavailable" });
  }

  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(42)} ${c.detail}`);
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll pre-flight checks passed.");
}

main();
```

- [ ] **Step 5: Wire up scripts, gitignore, and CI**

Update `.gitignore` so results are ignored *except* the ones that are evidence:

```
results/*
!results/ablation.json
!results/golden/
```

Add to root `package.json` scripts:

```json
    "golden:check": "vitest run apps/harness/test/golden.test.ts",
    "golden:update": "tsx apps/harness/src/update-golden.ts",
    "preflight": "tsx apps/harness/src/preflight.ts",
    "verify": "npm run lint && npm run typecheck && npm test && npm run harness && npm run metrics && npm run golden:check"
```

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: ["**"]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20.12.1"
          cache: npm

      - run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Unit tests
        run: npm test

      # data/out/* and rules/* are committed, so the harness runs with no
      # network and no API key. The ablation is NOT re-run - its cached results
      # are committed, so CI never spends money.
      - name: Recompute results and metrics
        run: |
          npm run harness
          npm run metrics

      - name: Golden numbers must not have drifted
        run: npm run golden:check

      - name: Pre-flight consistency
        run: npm run preflight
```

- [ ] **Step 6: Generate the first golden file and verify the whole chain**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm run harness && npm run metrics && npm run golden:update && npm run verify && npm run preflight
```

Expected: `golden:update` prints the captured numbers, then `verify` runs the full chain green, then `preflight` prints all PASS lines including the pre-registration commit hash and ISO timestamp.

- [ ] **Step 7: Prove the guard actually works**

A golden file nobody has seen fail is not a guard. Break something on purpose and confirm the build goes red.

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && node -e "const f='rules/ruleset-v1.0.json';const fs=require('fs');const r=JSON.parse(fs.readFileSync(f));r.rules.find(x=>x.id==='R1').strength=0.1;fs.writeFileSync(f,JSON.stringify(r,null,2));" && npm run harness && npm run metrics && (npm run golden:check && echo "GUARD FAILED - it should have caught this" && exit 1 || echo "GUARD WORKS - drift was caught") ; git checkout rules/ruleset-v1.0.json && npm run harness && npm run metrics && npm run golden:check
```

Expected: `GUARD WORKS - drift was caught`, then the revert restores green.

- [ ] **Step 8: Commit**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && git add .gitignore package.json apps/harness .github results/golden/metrics.golden.json && git commit -m "Add golden files, pre-flight check, and CI

Makes the sharpest Q&A question structural. 'Are the numbers on your slide from
the same code as the demo?' is now answered by a red build: any change to the
engine, the rules, or the data that moves a reported number fails golden:check.

extractGolden projects metrics.json down to the numbers actually reported and
deliberately excludes prose, notes, and timestamps - golden-filing the whole
document would churn on every wording change, and a golden file that cries wolf
gets ignored, which defeats the point. Re-baselining requires golden:update,
whose diff is the record of what changed and why.

CI recomputes results and metrics from the committed data on every push, with no
network and no API key. The ablation is never re-run - its cached results are
committed, so CI cannot spend money.

preflight is the ninety-seconds-before-presenting check: it verifies the results
were produced by the ruleset currently on disk, that only the test split was
scored, that TAK-994 is absent from the benchmark, and it prints the
pre-registration commit hash and ISO timestamp so they can be quoted rather than
hunted for live.

Step 7 deliberately breaks a rule strength and asserts the guard catches it,
because a golden file nobody has seen fail is not a guard.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 is complete at this point

When task 16 lands you have: a pure, deterministic reasoning engine with reinstatement, conformal-calibrated evidence, a pre-registered ruleset with a checkable hash, four baselines including the LLM ablation, five metrics with intervals, and CI that refuses to let any of those numbers drift.

**What Phase 2 consumes:** `results/results.json`, `results/metrics.json`, `data/out/evidence.json`, `data/out/tak994.json`, `rules/ruleset-v1.0.json`, and `packages/engine` imported directly into the browser. That contract is now fixed, which is why Phase 2's plan waited for this one.

**What to record as you go, because Phase 2 and the deck both need it:** the conflict-subset n, ARBITER's balanced accuracy with its Wilson interval and coverage, the best baseline's same three, whether `widthDiscriminates` is true, mean robustness, the LLM refusal rate and mean agreement rate, the planner's unchanged fraction, and the pre-registration commit hash and timestamp.

---

## Corrections to the spec this plan forces

Three things in `2026-07-26-arbiter-design.md` are not implementable as written and must be amended:

1. **§7/§8 say "temperature disclosed" and "temperature recorded and reported."** `temperature` does not exist on `claude-opus-5` — passing it returns HTTP 400. Replace with: *the API exposes no sampling parameters on this model; variance is measured at settings we could not have tuned.* This is strictly stronger, because it makes "you cranked the temperature" structurally impossible.

2. **§8 does not mention refusals.** `claude-opus-5` runs safety classifiers including a `bio` category, and drug-hepatotoxicity prompts can plausibly trip them. A refusal returns HTTP 200 with `stop_reason: "refusal"` and empty `content`. The harness must check `stop_reason` before reading `content`, count refusals, and **report the refusal rate alongside the ablation result** — a refused compound is an exclusion, not a wrong answer.

3. **§5 says the engine has zero runtime dependencies.** `zod` is admitted as the single exception, because validating at the seam is worth more than nominal purity and zod introduces no clock, no I/O, and no randomness. The ESLint rules still ban `fs`, `path`, `crypto`, `Math.random`, and parent-directory imports.

Task 14 additionally adopts three API features the spec did not anticipate: **structured outputs** (`output_config.format` with a Zod schema, so the baseline's verdict is schema-guaranteed and parser failure cannot be blamed for its variance), the **Batches API** (50% cheaper, correct shape for offline work), and **prompt caching** on the shared per-compound evidence prefix (25 runs share one prefix; `claude-opus-5`'s 512-token minimum means our evidence blocks qualify).
