# Evidence-Integrated Playbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship every engineering item in the ARBITER Evidence-Integrated Round 1 Playbook (§08 P1-A/B/C, P2-A/B/C and §12 checklist), so the running apps state the same honest position the team's own audit reached.

**Architecture:** Three independent surfaces. (1) A committed v2.0 re-grade artifact (`results/rescore-v2.json`) emitted by the existing Python re-scorer, rendered by `apps/web` and `apps/landing` alongside the v1.0 figures they already show — this is the blocking scoring-version reconciliation. (2) Engine values already computed but never rendered (`conflictMass`, applicability domain) surfaced in `apps/web`. (3) Server-side deliberation analysis already written but never routed (`disagreementReport`, plus a new agreement statistic) exposed over HTTP behind a reveal gate, with an existing blindness leak closed on the way.

**Tech Stack:** TypeScript, React 18, Vitest + @testing-library/react, Playwright, plain global CSS with custom properties, Node `node:http` (no framework), Python 3 + pytest for `data/prep` and `tools`.

**Spec:** `~/Downloads/ARBITER_Evidence_Integrated_Playbook.pdf`, extracted to `docs/superpowers/specs/2026-08-14-evidence-integrated-playbook.txt`. Internal corroboration: `HANDOVER.md` §13.

## Global Constraints

- **Never regenerate `results/metrics.json`.** Its only writer, `apps/harness/src/run-metrics.ts`, reaches it through `apps/harness/src/load.ts:41`, which hardcodes `rules/ruleset-v1.0.json` and hard-fails unless it hashes to `PRE_REGISTERED_HASH` `ed073a8a…`. The `y` labels come from a Python ingest (`data/prep/dilirank_common.py:26`) that also reads v1.0. Rewriting it also breaks the `rescore_v2.py` drift guard (`tools/rescore_v2.py:194-212`), the golden gate (`apps/harness/test/golden.test.ts:195`), and the `MetricsDocumentSchema` refinements (`packages/engine/src/schema.ts:112-126`). v2.0 figures ship as a *separate* artifact.
- **Populations must never be mixed.** The conflict subset is n=61; the full scored split is n=267. HANDOVER §13.2 pairs a v1.0 conflict-subset confusion (`tp 4/fp 0/tn 0/fn 0`) against a v2.0 full-split confusion (`tp 2/fp 5/tn 0/fn 0`). Both give 0.750 → 0.500, so the headline survives, but any table must label which population each row is from.
- **QSAR v2.0 is a disclosed lower bound.** It was fitted against v1.0. Every surface reporting `qsar 0.601` must carry that caveat.
- **Counts are never an input** (`services/api/deliberation.ts:18-21`, spec §6.4). No new code computes a majority, quorum or threshold, and nothing may turn a count into a decision. Descriptive post-reveal statistics are permitted; running tallies during the blind phase are not.
- **`UnanimityReport` keeps exactly three keys** — `call`, `concerns`, `unanimous`. A tripwire test at `services/api/test/deliberation.test.ts:350-356` asserts this. New statistics go on new types.
- **Blindness is enforced by not returning the data**, never by the client declining to render (`services/api/deliberation.ts:11-16`, `:253-257`).
- **Styling:** plain global CSS, semantic class names, CSS custom properties. No Tailwind, no CSS modules. `apps/web` tokens in `src/ui/tokens.css` + `src/ui/app.css`; `apps/deliberation` in `src/app.css`. Inline `style` only for data-driven geometry.
- **`var(--pfizer-blue)` is reserved** for the fired-rule chip, the primary action, and the belief fill. A conflict or warning readout uses `--toxic` via `.chip-warn` / `.caveat-warn`.
- **All Dempster figures render `.toFixed(3)`.**
- **Relative imports carry `.js` extensions** in both apps and services.
- **Timestamps are passed in, never read** (`services/api/deliberation.ts:23-25`). The core stays pure so hashes are reproducible.
- **New `data-anchor` values require registry updates.** `apps/web/src/ai/anchors.ts:55-104` is closed (`as const satisfies Record<string, Anchor>`) and `apps/web/test/anchors.test.tsx:47-61` asserts the exact sorted list. Prefer reusing an existing anchor.
- Verification for every task: `npm test`, `npm run typecheck`, `npm run lint` must all pass. Python tasks additionally run `python3 -m pytest data/prep/tests -q`.

---

### Task 1: Emit the v2.0 re-grade as a committed JSON artifact

`tools/rescore_v2.py` already computes both targets × both populations × six pipelines, but only `print()`s them. Everything downstream needs the numbers as data.

**Files:**
- Modify: `tools/rescore_v2.py:134-212`
- Create: `results/rescore-v2.json`
- Create: `data/prep/tests/test_rescore_v2.py`

**Interfaces:**
- Produces: `results/rescore-v2.json` with shape
  ```json
  {
    "generatedBy": "tools/rescore_v2.py",
    "driftGuard": "pass",
    "qsarCaveat": "The QSAR model was fitted under the v1.0 target, so its v2.0 figures are a lower bound.",
    "targets": [
      {
        "version": "1.0", "label": "v1.0 (as shipped)", "superseded": true,
        "positive": ["vMost-DILI-Concern", "vLess-DILI-Concern"],
        "negative": ["vNo-DILI-Concern"],
        "populations": [
          { "population": "conflictSubset", "n": 61, "positiveRate": 0.9016393442622951,
            "pipelines": [ { "pipeline": "ARBITER", "balancedAccuracy": 0.75,
              "balancedAccuracyCi": null, "rawAccuracyCi": {"lo":0.51,"hi":1.0},
              "coverage": 0.0655…, "nCommitted": 4,
              "confusion": {"tp":4,"fp":0,"tn":0,"fn":0}, "singleClass": true } ]
          }
        ]
      }
    ]
  }
  ```
  `populations[].population` is `"conflictSubset"` or `"fullSplit"`. `targets[].version` is `"1.0"` or `"2.0"`.

- [ ] **Step 1: Write the failing test**

Create `data/prep/tests/test_rescore_v2.py`:

```python
"""The re-grade must be readable as data, not only as a printed transcript.

The UI renders the v2.0 correction beside the v1.0 figures it supersedes, so the
numbers have to leave this script in a machine-readable form. These tests pin the
shape and the four headline values HANDOVER section 13.2 quotes.
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / "results" / "rescore-v2.json"


def _doc() -> dict:
    subprocess.run([sys.executable, "tools/rescore_v2.py"], cwd=ROOT, check=True,
                   capture_output=True)
    return json.loads(OUT.read_text())


def _pipeline(doc: dict, version: str, population: str, name: str) -> dict:
    target = next(t for t in doc["targets"] if t["version"] == version)
    pop = next(p for p in target["populations"] if p["population"] == population)
    return next(x for x in pop["pipelines"] if x["pipeline"] == name)


def test_writes_both_targets_and_both_populations():
    doc = _doc()
    assert [t["version"] for t in doc["targets"]] == ["1.0", "2.0"]
    for target in doc["targets"]:
        assert [p["population"] for p in target["populations"]] == [
            "conflictSubset", "fullSplit"]


def test_marks_v1_superseded_and_records_the_drift_guard():
    doc = _doc()
    v1 = next(t for t in doc["targets"] if t["version"] == "1.0")
    v2 = next(t for t in doc["targets"] if t["version"] == "2.0")
    assert v1["superseded"] is True
    assert v2["superseded"] is False
    assert doc["driftGuard"] == "pass"
    assert "lower bound" in doc["qsarCaveat"]


def test_reproduces_the_headline_correction():
    doc = _doc()
    # The figure the pitch leads with, on the population it was measured on.
    shipped = _pipeline(doc, "1.0", "conflictSubset", "ARBITER")
    assert shipped["balancedAccuracy"] == 0.75
    assert shipped["confusion"] == {"tp": 4, "fp": 0, "tn": 0, "fn": 0}
    assert shipped["singleClass"] is True

    corrected = _pipeline(doc, "2.0", "fullSplit", "ARBITER")
    assert corrected["balancedAccuracy"] == 0.5
    assert corrected["confusion"] == {"tp": 2, "fp": 5, "tn": 0, "fn": 0}


def test_no_pipeline_clears_0601_under_the_corrected_target():
    doc = _doc()
    v2 = next(t for t in doc["targets"] if t["version"] == "2.0")
    full = next(p for p in v2["populations"] if p["population"] == "fullSplit")
    best = max(x["balancedAccuracy"] for x in full["pipelines"])
    assert round(best, 3) == 0.601
    assert next(x["pipeline"] for x in full["pipelines"]
                if x["balancedAccuracy"] == best) == "single:qsar"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest data/prep/tests/test_rescore_v2.py -q`
Expected: FAIL — `results/rescore-v2.json` does not exist (`FileNotFoundError`).

- [ ] **Step 3: Implement the JSON emission**

In `tools/rescore_v2.py`, change `report()` to return the row it prints, and accumulate in `main()`. Keep every existing `print()` byte-identical so `results/rescore-v2.txt` does not churn, and keep the drift guard exactly where it is.

Replace `report` (currently at line 134) with:

```python
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
```

In `main()`, replace the target loop body so it collects. The loop header at line 160 becomes:

```python
    doc_targets = []
    for policy_name, policy, version in (
        ("v1.0 (as shipped)", v1, "1.0"), ("v2.0 (corrected)", v2, "2.0")
    ):
```

Inside, after the existing four `print()` calls, add `populations = []`. Change the subset loop so each population is captured — replace the body from `n = len(subset)` through the baseline `for` loop with:

```python
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
```

and change the subset tuple at line 174 to carry the key:

```python
        for subset_name, population_key, subset in (
            ("CONFLICT SUBSET (the headline)", "conflictSubset",
             [(r, y) for r, y in graded if r["conflicting"]]),
            ("FULL SCORED SPLIT", "fullSplit", graded),
        ):
```

After the subset loop, still inside the target loop, append the target:

```python
        doc_targets.append({
            "version": version, "label": policy_name, "superseded": version == "1.0",
            "positive": policy["positive"], "negative": policy["negative"],
            "populations": populations,
        })
```

Finally, after the drift guard's `if not ok: raise SystemExit(1)` (line 212), write the file:

```python
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
```

Writing it only after the guard passes is the point: a failed guard must leave no artifact for the UI to read.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest data/prep/tests/test_rescore_v2.py -q`
Expected: 4 passed.

Then confirm the transcript did not churn:
Run: `python3 tools/rescore_v2.py > /tmp/rescore-check.txt && diff <(grep -v 'rescore-v2.json' /tmp/rescore-check.txt) results/rescore-v2.txt`
Expected: no differences other than the trailing blank line and the new "wrote" line, both filtered.

- [ ] **Step 5: Commit**

```bash
git add tools/rescore_v2.py results/rescore-v2.json data/prep/tests/test_rescore_v2.py
git commit -m "Emit the v2.0 re-grade as data, not only as a printed transcript"
```

---

### Task 2: Render the scoring-version correction in apps/web (BLOCKING)

The About and Validation tabs render v1.0 figures the team's own audit invalidated, with no superseded marker. This is playbook §08 P1-A and §12 item 1: *"Nothing else matters if a judge sees an invalidated number."*

**Files:**
- Create: `apps/web/src/data/rescore.ts`
- Modify: `apps/web/src/data/bundle.ts:18`
- Modify: `apps/web/src/tabs/About.tsx:151-167`
- Modify: `apps/web/src/tabs/Validation.tsx`
- Create: `apps/web/test/rescore.test.tsx`
- Modify: `apps/web/test/about.test.tsx:27`

**Interfaces:**
- Consumes: `results/rescore-v2.json` from Task 1.
- Produces: `loadRescore(): RescoreDocument`, and a `<ScoringVersionNotice />` component exported from `apps/web/src/data/rescore.ts`'s sibling `apps/web/src/ui/ScoringVersionNotice.tsx`, taking no props.

```ts
export interface RescorePipeline {
  pipeline: string;
  balancedAccuracy: number;
  balancedAccuracyCi: { lo: number; hi: number } | null;
  rawAccuracyCi: { lo: number; hi: number } | null;
  coverage: number;
  nCommitted: number;
  confusion: { tp: number; fp: number; tn: number; fn: number };
  singleClass: boolean;
}
export interface RescorePopulation {
  population: "conflictSubset" | "fullSplit";
  n: number;
  positiveRate: number;
  pipelines: RescorePipeline[];
}
export interface RescoreTarget {
  version: "1.0" | "2.0";
  label: string;
  superseded: boolean;
  positive: string[];
  negative: string[];
  populations: RescorePopulation[];
}
export interface RescoreDocument {
  generatedBy: string;
  driftGuard: string;
  qsarCaveat: string;
  targets: RescoreTarget[];
}
export function pipelineAt(
  doc: RescoreDocument, version: "1.0" | "2.0",
  population: "conflictSubset" | "fullSplit", pipeline: string,
): RescorePipeline | undefined;
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/rescore.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loadRescore, pipelineAt } from "../src/data/rescore.js";
import { ScoringVersionNotice } from "../src/ui/ScoringVersionNotice.js";

describe("the re-grade document", () => {
  it("loads both targets and marks v1.0 superseded", () => {
    const doc = loadRescore();
    expect(doc.targets.map((t) => t.version)).toEqual(["1.0", "2.0"]);
    expect(doc.targets.find((t) => t.version === "1.0")!.superseded).toBe(true);
  });

  it("carries the corrected headline on the full split", () => {
    const arbiter = pipelineAt(loadRescore(), "2.0", "fullSplit", "ARBITER")!;
    expect(arbiter.balancedAccuracy.toFixed(3)).toBe("0.500");
    expect(arbiter.confusion).toEqual({ tp: 2, fp: 5, tn: 0, fn: 0 });
  });
});

describe("ScoringVersionNotice", () => {
  it("states which target the figures on screen were graded under", () => {
    render(<ScoringVersionNotice />);
    expect(screen.getByTestId("scoring-version")).toHaveTextContent(/graded under target v1\.0/i);
  });

  it("states the corrected figure and that no pipeline clears it", () => {
    render(<ScoringVersionNotice />);
    const el = screen.getByTestId("scoring-version");
    expect(el).toHaveTextContent(/0\.500/);
    expect(el).toHaveTextContent(/0\.601/);
  });

  it("names the population of each figure, because they are different populations", () => {
    render(<ScoringVersionNotice />);
    expect(screen.getByTestId("scoring-version")).toHaveTextContent(/full scored split/i);
  });

  it("discloses that the QSAR figure is a lower bound", () => {
    render(<ScoringVersionNotice />);
    expect(screen.getByTestId("scoring-version")).toHaveTextContent(/lower bound/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/web/test/rescore.test.tsx`
Expected: FAIL — cannot resolve `../src/data/rescore.js`.

- [ ] **Step 3: Implement the loader and the notice**

Add to `apps/web/src/data/bundle.ts`, beside the existing `metrics` import at line 18:

```ts
import rescore from "../../../../results/rescore-v2.json";
```

and add `rescore` to the exported bundle object in the same shape the file already uses for `metrics`.

Create `apps/web/src/data/rescore.ts` with the interfaces from the Interfaces block above, plus:

```ts
import { RAW } from "./bundle.js";

export function loadRescore(): RescoreDocument {
  return RAW.rescore as RescoreDocument;
}

export function pipelineAt(
  doc: RescoreDocument,
  version: "1.0" | "2.0",
  population: "conflictSubset" | "fullSplit",
  pipeline: string,
): RescorePipeline | undefined {
  return doc.targets
    .find((t) => t.version === version)
    ?.populations.find((p) => p.population === population)
    ?.pipelines.find((x) => x.pipeline === pipeline);
}
```

Create `apps/web/src/ui/ScoringVersionNotice.tsx`:

```tsx
/**
 * The correction, on screen, next to the figures it corrects.
 *
 * WHY THIS IS NOT A FOOTNOTE. Every accuracy figure this app renders comes from
 * results/metrics.json, which is graded under target v1.0 - the binarisation this
 * project's own audit invalidated, because it counted Less-DILI-Concern as
 * positive and so scored a system correctly declining to flag amlodipine as
 * wrong. Regenerating metrics.json under v2.0 is not a display change: the
 * harness pins the v1.0 ruleset hash and the labels come from a Python ingest.
 * So the shipped figures stay v1.0 and say so, and the corrected figures are
 * rendered beside them from the re-grade.
 *
 * POPULATIONS ARE NAMED because they differ. The v1.0 headline is the conflict
 * subset (n=61); the corrected full-split figure is n=267. HANDOVER section 13.2
 * pairs one row from each, which is why the label is here rather than assumed.
 */
import { loadRescore, pipelineAt } from "../data/rescore.js";

export function ScoringVersionNotice() {
  const doc = loadRescore();
  const corrected = pipelineAt(doc, "2.0", "fullSplit", "ARBITER");
  const best = pipelineAt(doc, "2.0", "fullSplit", "single:qsar");
  if (!corrected || !best) return null;

  return (
    <div className="caveat caveat-warn" data-testid="scoring-version">
      <p>
        Every accuracy figure on this page is graded under target v1.0, which this
        project&apos;s own audit invalidated: it counted Less-DILI-Concern as positive,
        placing 330 of 536 positives in a class containing aspirin, amoxicillin and
        amlodipine.
      </p>
      <p>
        Re-graded against the corrected target, ARBITER scores{" "}
        <span className="num">{corrected.balancedAccuracy.toFixed(3)}</span> balanced accuracy
        on the full scored split (n={267}, confusion {corrected.confusion.tp} /{" "}
        {corrected.confusion.fp} / {corrected.confusion.tn} / {corrected.confusion.fn}). Under
        that target no pipeline tested clears{" "}
        <span className="num">{best.balancedAccuracy.toFixed(3)}</span>, including every
        baseline. The finding is about the target, not about this system.
      </p>
      <p className="small muted">{doc.qsarCaveat}</p>
    </div>
  );
}
```

Render `<ScoringVersionNotice />` in `About.tsx` immediately after the `<p className="label">The result, stated plainly</p>` at line 152, and in `Validation.tsx` at the top of its first section. Import it in both.

Change the About heading at line 154 so it no longer asserts a tie as the current position:

```tsx
<h2 className="title">Under the target it was graded on, it ties one baseline exactly. Under the corrected one, nothing works.</h2>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/web/test/rescore.test.tsx apps/web/test/about.test.tsx apps/web/test/validation.test.tsx`
Expected: PASS. `about.test.tsx:27` pins `/does not beat the best baseline/i` against the old heading — update that assertion to `/ties one baseline exactly/i` in the same commit, since the prose it pinned is the prose being corrected.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/data/rescore.ts apps/web/src/ui/ScoringVersionNotice.tsx \
  apps/web/src/data/bundle.ts apps/web/src/tabs/About.tsx apps/web/src/tabs/Validation.tsx \
  apps/web/test/rescore.test.tsx apps/web/test/about.test.tsx
git commit -m "Say on screen which target every figure was graded under"
```

---

### Task 3: Render conflictMass on the Case tab

Playbook §08 P1-B. The engine computes it and documents it as "surfaced, never normalised away" (`packages/engine/src/types.ts:186-187`), but `grep -rn conflictMass apps/web/src` returns nothing — only the derived boolean `contested` reaches the screen, so a reader cannot tell 0.122 from 0.999.

**Files:**
- Modify: `apps/web/src/tabs/Case/TracePanel.tsx:23-28`
- Create: `apps/web/test/conflictMass.test.tsx`

**Interfaces:**
- Consumes: `Reasoning.conflictMass: number` and `Reasoning.contested: boolean` from `packages/engine/src/types.ts:164-192`.
- Produces: a `data-testid="conflict-mass"` element carrying `data-conflict` set to the raw `.toFixed(3)` value.

Reuse the existing `data-anchor="trace.mass"` element. Do **not** add a new anchor: `apps/web/src/ai/anchors.ts:55-104` is a closed registry and `apps/web/test/anchors.test.tsx:47-61` asserts the exact sorted anchor list.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/conflictMass.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider, initialState } from "../src/state/store.js";
import { TracePanel } from "../src/tabs/Case/TracePanel.js";
import { loadData } from "../src/data/load.js";
import { CYCLOSPORINE, BOOT_CASE } from "../src/data/heroCases.js";

const data = loadData();

const renderAt = (compoundId: string) =>
  render(
    <StoreProvider data={data} initialState={{ ...initialState(data), selectedCompoundId: compoundId }}>
      <TracePanel />
    </StoreProvider>,
  );

describe("conflict mass on the Case tab", () => {
  it("shows the magnitude, not just the word contested", () => {
    renderAt(CYCLOSPORINE);
    const el = screen.getByTestId("conflict-mass");
    expect(el.getAttribute("data-conflict")).toBe("0.122");
    expect(el).toHaveTextContent(/0\.122/);
  });

  it("renders zero conflict as a number rather than hiding it", () => {
    renderAt(BOOT_CASE);
    expect(screen.getByTestId("conflict-mass").getAttribute("data-conflict")).toBe("0.000");
  });

  it("says what the number means, because Dempster conflict is not self-explanatory", () => {
    renderAt(CYCLOSPORINE);
    expect(screen.getByTestId("conflict-mass")).toHaveTextContent(/removed in combination/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/web/test/conflictMass.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="conflict-mass"]`.

- [ ] **Step 3: Implement**

In `apps/web/src/tabs/Case/TracePanel.tsx`, replace the mass paragraph at lines 23-28 with:

```tsx
      <p className="small muted case-mass" data-anchor="trace.mass">
        mass toxic <span className="num">{r.mass.toxic.toFixed(3)}</span> ·
        safe <span className="num">{r.mass.safe.toFixed(3)}</span> ·
        uncommitted <span className="num">{r.mass.uncommitted.toFixed(3)}</span>
        {r.contested && " · contested"}
      </p>

      {/*
        The conflict measure, shown rather than averaged away. Dempster's rule
        normalises conflict out of the combined mass; this engine keeps the
        quantity and reports it, which is the whole answer to the standard
        high-conflict objection. A boolean cannot carry that - 0.122 and 0.999 are
        different situations - so the magnitude is on screen.
      */}
      <p
        className="small muted case-mass"
        data-testid="conflict-mass"
        data-conflict={r.conflictMass.toFixed(3)}
      >
        conflict mass <span className="num">{r.conflictMass.toFixed(3)}</span>
        {" - the belief removed in combination, reported rather than normalised away."}
      </p>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/web/test/conflictMass.test.tsx apps/web/test/anchors.test.tsx`
Expected: PASS, including the anchor sweep (no new anchor was introduced).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/tabs/Case/TracePanel.tsx apps/web/test/conflictMass.test.tsx
git commit -m "Show the conflict measure the engine refuses to normalise away"
```

---

### Task 4: Close the blind-assessment leak on GET /unanimity

Not in the playbook — found during this work and confirmed by a repro. `services/api/deliberation-service.ts:352` calls `unanimityCheck` with no status check, and `server.ts:315-318` adds none. On an **open** case where one of four participants has submitted, `GET /api/cases/:id/unanimity` returns `{"unanimous":true,"call":"do_not_advance",…}` to any other participant. Only `apps/deliberation/src/App.tsx:81-87` hides it. That contradicts the file's own contract at `deliberation.ts:11-16` and the playbook's Claim 2, and it must be fixed before Task 5 puts more analysis behind the same door.

**Files:**
- Modify: `services/api/deliberation-service.ts:352-356`
- Modify: `services/api/test/deliberation-service.test.ts`

**Interfaces:**
- Produces: `DeliberationService.unanimity(caseId: string): UnanimityReport | null` now returns `null` while `status === "open"`. Signature unchanged; `null` already means "nothing to show" to both the route (404) and the client.

- [ ] **Step 1: Write the failing test**

Append to `services/api/test/deliberation-service.test.ts` inside the existing unanimity `describe`:

```ts
  it("returns nothing while the case is open, because a running tally drags the room", () => {
    const svc = service();
    opened(svc, ["ann", "bea", "cal", "dee"]);
    svc.submit("c1", pos("ann", { call: "do_not_advance" }));
    // The leak this replaced: one submitted position made the room "unanimous",
    // and the call was served to everyone who asked for it directly. Blindness is
    // enforced by not returning the data, never by the client not rendering it.
    expect(svc.unanimity("c1")).toBeNull();
  });

  it("returns the report once the case is revealed", () => {
    const svc = service();
    opened(svc, ["ann", "bea"]);
    svc.submit("c1", pos("ann"));
    svc.submit("c1", pos("bea"));
    svc.reveal("c1", "owner", "t", "all_in");
    expect(svc.unanimity("c1")!.unanimous).toBe(true);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run services/api/test/deliberation-service.test.ts -t "while the case is open"`
Expected: FAIL — received `{ unanimous: true, call: 'do_not_advance', … }`, expected `null`.

- [ ] **Step 3: Implement**

In `services/api/deliberation-service.ts`, replace the body of `unanimity` at lines 352-356:

```ts
  unanimity(caseId: string): UnanimityReport | null {
    const c = this.store.get(caseId);
    const inv = this.inventory(caseId);
    if (c === null || inv === null) return null;
    // NOT VISIBLE BEFORE THE REVEAL. unanimityCheck reports agreement among the
    // positions SUBMITTED SO FAR, so on an open case it is a running tally - the
    // one thing section 6.2 exists to prevent, and worth more than the positions
    // themselves to anyone deciding what to write. Gated here rather than in the
    // client, because a rendering convention is one forgotten conditional away
    // from being nothing at all.
    if (c.status === "open") return null;
    return unanimityCheck(c, inv);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run services/api/test services/api/test/server.test.ts`
Expected: PASS. The client at `App.tsx:81-87` already skips the call while open, so no client change is required; the route's existing `null → 404` mapping covers a direct request.

- [ ] **Step 5: Commit**

```bash
git add services/api/deliberation-service.ts services/api/test/deliberation-service.test.ts
git commit -m "Stop serving a running tally before the reveal"
```

---

### Task 5: Route disagreementReport and add the agreement statistic

Playbook §08 P1-C (*"the single most valuable feature already written and not shipped"*) and P2-B, shipped together because they are one panel and one route. Today, when the room splits, `screens.tsx:574` suppresses the entire unanimity block and the reader gets raw positions and nothing else.

P2-B needs care: `services/api/deliberation.ts:18-21` forbids counts as an input, and `services/api/test/deliberation.test.ts:350-356` asserts `UnanimityReport` has exactly the keys `["call","concerns","unanimous"]`. The statistic therefore goes on a **new** type behind a **reveal-gated** route, where it is descriptive of an already-revealed split rather than a running tally, and derivable from `split[].participantIds` which the same response already carries. `UnanimityReport` is not touched.

**Files:**
- Modify: `services/api/deliberation.ts` (add `agreement`, export `AgreementStat`)
- Modify: `services/api/deliberation-service.ts` (add `disagreement`)
- Modify: `services/api/server.ts:303-335` (add the `disagreement` GET tail)
- Modify: `services/api/test/deliberation.test.ts`
- Modify: `services/api/test/deliberation-service.test.ts`
- Modify: `services/api/test/server.test.ts:173-181`
- Modify: `apps/deliberation/src/api.ts` (types + method)
- Modify: `apps/deliberation/src/App.tsx` (state + fetch)
- Modify: `apps/deliberation/src/screens.tsx:553-584` (panel)
- Modify: `apps/deliberation/src/app.css`
- Modify: `apps/deliberation/test/screens.test.tsx`

**Interfaces:**
- Consumes: `DisagreementReport` (`deliberation.ts:439-445`), `Call` (`:28`), `DeliberationCase` (`:90`).
- Produces:

```ts
/** Descriptive, post-reveal, and never an input to anything. */
export interface AgreementStat {
  /** Share of positions holding the most common call. 1 when unanimous. */
  percent: number;
  /** Positions submitted. Reported beside percent because 2 of 3 is not 67%. */
  n: number;
  modalCall: Call | null;
}
export function agreement(c: DeliberationCase): AgreementStat;

export interface DisagreementView {
  report: DisagreementReport | null;
  agreement: AgreementStat;
}
```
  `DeliberationService.disagreement(caseId: string): DisagreementView | null` — `null` when the case is missing **or** `status === "open"`.
  Route: `GET /api/cases/:caseId/disagreement` → 200 `DisagreementView` | 404 `{ error: "no_case" }`.
  Client: `api.disagreement(token: string, caseId: string): Promise<DisagreementView>`.

- [ ] **Step 1: Write the failing tests**

Append to `services/api/test/deliberation.test.ts`:

```ts
describe("agreement", () => {
  it("is 1 when everyone made the same call", () => {
    const c = submitAll(CASE, { ann: "advance", bea: "advance", cal: "advance" });
    expect(agreement(c)).toEqual({ percent: 1, n: 3, modalCall: "advance" });
  });

  it("reports the modal share, with n beside it because 2 of 3 is not a percentage", () => {
    const c = submitAll(CASE, { ann: "advance", bea: "advance", cal: "do_not_advance" });
    const a = agreement(c);
    expect(a.n).toBe(3);
    expect(a.modalCall).toBe("advance");
    expect(a.percent).toBeCloseTo(2 / 3, 10);
  });

  it("counts cannot_conclude as a call, not as a non-response", () => {
    const c = submitAll(CASE, { ann: "cannot_conclude", bea: "cannot_conclude" });
    expect(agreement(c)).toEqual({ percent: 1, n: 2, modalCall: "cannot_conclude" });
  });

  it("is empty rather than 100% when nobody has answered", () => {
    expect(agreement(CASE)).toEqual({ percent: 0, n: 0, modalCall: null });
  });

  it("breaks a tie deterministically so the output is stable", () => {
    const c = submitAll(CASE, { ann: "advance", bea: "do_not_advance" });
    expect(agreement(c).modalCall).toBe("advance");
    expect(agreement(c).percent).toBeCloseTo(0.5, 10);
  });
});
```

Append to `services/api/test/deliberation-service.test.ts`:

```ts
describe("disagreement", () => {
  it("is withheld while the case is open", () => {
    const svc = service();
    opened(svc, ["ann", "bea"]);
    svc.submit("c1", pos("ann", { call: "advance" }));
    svc.submit("c1", pos("bea", { call: "do_not_advance" }));
    expect(svc.disagreement("c1")).toBeNull();
  });

  it("reports the split and the agreement share once revealed", () => {
    const svc = service();
    opened(svc, ["ann", "bea"]);
    svc.submit("c1", pos("ann", { call: "advance", citedFindingIds: ["f-rodent"] }));
    svc.submit("c1", pos("bea", { call: "do_not_advance", citedFindingIds: ["f-rodent"] }));
    svc.reveal("c1", "owner", "t", "all_in");

    const d = svc.disagreement("c1")!;
    expect(d.report!.split).toEqual([
      { call: "advance", participantIds: ["ann"] },
      { call: "do_not_advance", participantIds: ["bea"] },
    ]);
    expect(d.report!.contested).toEqual(["f-rodent"]);
    expect(d.agreement).toEqual({ percent: 0.5, n: 2, modalCall: "advance" });
  });

  it("returns a null report but a real agreement stat when the room is unanimous", () => {
    const svc = service();
    opened(svc, ["ann", "bea"]);
    svc.submit("c1", pos("ann"));
    svc.submit("c1", pos("bea"));
    svc.reveal("c1", "owner", "t", "all_in");

    const d = svc.disagreement("c1")!;
    expect(d.report).toBeNull();
    expect(d.agreement.percent).toBe(1);
  });
});
```

In `services/api/test/server.test.ts:173-181`, add `"disagreement"` to the array of tails an outsider must receive 404 for.

Append to `apps/deliberation/test/screens.test.tsx` inside `describe("Reveal")`:

```tsx
  it("shows where the room split instead of leaving raw positions unexplained", () => {
    render(
      <Reveal
        nameOf={(id) => id}
        view={view}
        unanimity={{ unanimous: false, call: null, concerns: [] }}
        disagreement={{
          report: {
            split: [
              { call: "advance", participantIds: ["ann"] },
              { call: "do_not_advance", participantIds: ["bea"] },
            ],
            contested: ["f-rodent"],
            oneSided: [{ findingId: "f-qsar", call: "advance" }],
          },
          agreement: { percent: 0.5, n: 2, modalCall: "advance" },
        }}
      />,
    );
    expect(screen.getByText(/Where the room split/i)).toBeInTheDocument();
    expect(screen.getByTestId("agreement-stat")).toHaveTextContent(/50%/);
    expect(screen.getByTestId("agreement-stat")).toHaveTextContent(/n\s*=\s*2/);
    expect(screen.getByText(/f-rodent/)).toBeInTheDocument();
    expect(screen.getByText(/f-qsar/)).toBeInTheDocument();
  });

  it("does not present the share as a decision rule", () => {
    render(
      <Reveal nameOf={(id) => id} view={view}
        unanimity={{ unanimous: false, call: null, concerns: [] }}
        disagreement={{ report: null, agreement: { percent: 1, n: 2, modalCall: "advance" } }} />,
    );
    expect(screen.getByTestId("agreement-stat")).toHaveTextContent(/describes the record, not the answer/i);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run services/api/test/deliberation.test.ts services/api/test/deliberation-service.test.ts apps/deliberation/test/screens.test.tsx`
Expected: FAIL — `agreement is not defined`, `svc.disagreement is not a function`, and `Unable to find text /Where the room split/i`.

- [ ] **Step 3: Implement**

In `services/api/deliberation.ts`, after `disagreementReport` (line 473), add:

```ts
/**
 * How much of the room landed on the most common call. §6.4-safe because it is
 * DESCRIPTIVE and POST-REVEAL: nothing reads it, no threshold consumes it, and it
 * is derivable from `split` which the same response already carries. It is not a
 * quorum, and it decides nothing.
 *
 * NOT A KAPPA. Three to five reviewers is too thin for chance-corrected
 * agreement to mean anything, so the honest figure is the plain share with `n`
 * printed beside it. A kappa here would look more rigorous and be less true.
 *
 * `cannot_conclude` is a call, not a non-response, so it counts in the
 * denominator. Genuine non-responders have no Position at all and are outside
 * `n` already.
 */
export interface AgreementStat {
  percent: number;
  n: number;
  modalCall: Call | null;
}

export function agreement(c: DeliberationCase): AgreementStat {
  const n = c.positions.length;
  if (n === 0) return { percent: 0, n: 0, modalCall: null };

  const counts = new Map<Call, number>();
  for (const p of c.positions) counts.set(p.call, (counts.get(p.call) ?? 0) + 1);

  // Ties break on the sorted call name, so the same room always prints the same
  // figure. Which call wins a tie carries no meaning and must not look like it does.
  const ranked = [...counts.entries()].sort(
    ([aCall, aN], [bCall, bN]) => (bN - aN) || (aCall < bCall ? -1 : 1),
  );
  const [modalCall, top] = ranked[0]!;
  return { percent: top / n, n, modalCall };
}

export interface DisagreementView {
  report: DisagreementReport | null;
  agreement: AgreementStat;
}
```

In `services/api/deliberation-service.ts`, beside `unanimity`, add:

```ts
  disagreement(caseId: string): DisagreementView | null {
    const c = this.store.get(caseId);
    if (c === null) return null;
    // Same gate as `unanimity`, for the same reason and more so: `split` names who
    // called what, which is precisely what blindness withholds.
    if (c.status === "open") return null;
    return { report: disagreementReport(c), agreement: agreement(c) };
  }
```

Import `agreement`, `disagreementReport` and the two types at the top of that file.

In `services/api/server.ts`, add a tail inside the existing GET switch, beside `unanimity`:

```ts
          case "disagreement": {
            const d = deps.service.disagreement(caseId);
            return d === null ? json(res, 404, { error: "no_case" }) : json(res, 200, d);
          }
```

In `apps/deliberation/src/api.ts`, mirror `AgreementStat`, `DisagreementReport` and `DisagreementView` beside `UnanimityReport` (line 128), and add beside `unanimity` (line 335):

```ts
  disagreement: (token: string, caseId: string) =>
    call<DisagreementView>("GET", `/api/cases/${caseId}/disagreement`, token),
```

In `apps/deliberation/src/App.tsx`, add `disagreement` state beside `unanimity` (line 42) and fetch it in the same `else` branch at lines 81-87:

```tsx
        setUnanimity(await api.unanimity(t, id));
        setDisagreement(await api.disagreement(t, id));
        setAudit(await api.audit(t, id));
```
with `setDisagreement(null)` in the `if (v.status === "open")` branch. Pass `disagreement={disagreement}` to `<Reveal />` at line 350.

In `apps/deliberation/src/screens.tsx`, widen `Reveal`'s props with `disagreement?: DisagreementView | null`, and add after the existing unanimity fragment (line 584):

```tsx
      {disagreement != null && (
        <div data-testid="agreement-stat" className="note" style={{ marginTop: 24 }}>
          {Math.round(disagreement.agreement.percent * 100)}% of positions held the most
          common call (n = {disagreement.agreement.n}). This describes the record, not the
          answer: nothing here counts votes, and the decision owner still signs.
        </div>
      )}

      {disagreement?.report != null && (
        <>
          <h2 style={{ marginTop: 32 }}>Where the room split, and on what.</h2>
          <p className="muted small">
            Plain arithmetic over the positions. It reports the shape of the disagreement
            and stops - deciding which reading is right is the adjudication, and then the
            signature.
          </p>
          {disagreement.report.split.map((camp) => (
            <div className="pos" key={camp.call}>
              <span className="mono">{camp.call}</span>{" "}
              {camp.participantIds.map(nameOf).join(", ")}
            </div>
          ))}
          {disagreement.report.contested.length > 0 && (
            <>
              <p className="muted small" style={{ marginTop: 16 }}>
                Cited by more than one camp - the same evidence, read two ways.
              </p>
              {disagreement.report.contested.map((id) => (
                <div className="concern" key={id}><span className="mono">{id}</span></div>
              ))}
            </>
          )}
          {disagreement.report.oneSided.length > 0 && (
            <>
              <p className="muted small" style={{ marginTop: 16 }}>
                Cited by one camp only - evidence the other side has not answered.
              </p>
              {disagreement.report.oneSided.map((o) => (
                <div className="note" key={o.findingId}>
                  <span className="mono">{o.findingId}</span>{" "}
                  <span className="muted small">({o.call})</span>
                </div>
              ))}
            </>
          )}
        </>
      )}
```

No new CSS class is required — `.pos`, `.concern`, `.note`, `.mono`, `.muted` and `.small` all already exist in `apps/deliberation/src/app.css`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run services/api/test apps/deliberation/test`
Expected: PASS, including the untouched three-key tripwire at `deliberation.test.ts:350-356`.

- [ ] **Step 5: Commit**

```bash
git add services/api/deliberation.ts services/api/deliberation-service.ts services/api/server.ts \
  services/api/test apps/deliberation/src apps/deliberation/test
git commit -m "Ship the disagreement analysis that was written and never routed"
```

---

### Task 6: Enforce the blindness claim with a contamination check

Playbook §11: *"any future prediction scoring has to grep the nonclinical extract for clinical cross-references first. That check does not exist yet."* HANDOVER §13.4c measured the mechanical cut insufficient — the Turalio nonclinical chapter says *"The liver is a major target organ **clinically**, with frequent elevations in transaminases"*, written by reviewers who already knew the outcome. Cutting at the chapter boundary moves the pages, not the knowledge.

`data/prep/split_review.py` already has Guard 1 (disjoint page sets) and Guard 2 (no clinical *heading* inside the input range). What is missing is a check for clinical *prose* cross-references. A document that trips it is not refused — §13.4c's resolution is that such a document becomes a deliberation case and never a prediction case — so the split reports it and marks the document unusable for prediction.

**Files:**
- Modify: `data/prep/split_review.py`
- Modify: `data/prep/tests/test_split_review.py`

**Interfaces:**
- Produces: two new fields on the existing `Split` dataclass (`split_review.py:79-87`):
```python
    clinical_crossrefs: list[dict]   # [{"page": int, "text": str}], text is the matched sentence
    prediction_safe: bool            # False when clinical_crossrefs is non-empty
```
  Both are emitted into `<stem>.split.json` automatically via the existing `asdict(plan)`.

- [ ] **Step 1: Write the failing test**

Append to `data/prep/tests/test_split_review.py`:

```python
def test_flags_a_clinical_crossreference_in_the_nonclinical_prose():
    # REGRESSION, HANDOVER section 13.4c. The Turalio nonclinical chapter carries a
    # clinical cross-reference because reviewers wrote it already knowing the human
    # outcome. The mechanical cut moves the pages, not the knowledge, so a heading
    # guard alone cannot make this document a prediction case.
    p = pages(
        "5. Nonclinical Pharmacology/Toxicology\n" + SUBSTANTIVE,
        "The liver is a major target organ clinically, with frequent elevations "
        "in transaminases observed in patients.",
        "6. Clinical Pharmacology\nhuman data begins",
    )
    s = plan_split(p)
    assert s.ok, s.reason
    assert s.prediction_safe is False
    assert len(s.clinical_crossrefs) == 1
    assert s.clinical_crossrefs[0]["page"] == BODY + 1
    assert "major target organ clinically" in s.clinical_crossrefs[0]["text"]


def test_a_clean_chapter_is_prediction_safe():
    p = pages(
        "5. Nonclinical Pharmacology/Toxicology\n" + SUBSTANTIVE,
        "more toxicology, NOAEL 10 mg/kg",
        "6. Clinical Pharmacology\nhuman data begins",
    )
    s = plan_split(p)
    assert s.ok, s.reason
    assert s.prediction_safe is True
    assert s.clinical_crossrefs == []


def test_does_not_flag_the_word_clinical_in_a_preclinical_sense():
    # "clinical signs" is standard tox vocabulary for observations in animals, and
    # "clinically relevant dose" is a comparison, not an outcome. Flagging either
    # would make the guard fire on every chapter and so mean nothing.
    p = pages(
        "5. Nonclinical Pharmacology/Toxicology\n" + SUBSTANTIVE,
        "Clinical signs were observed in rats at the high dose. The clinically "
        "relevant dose margin was 12x.",
        "6. Clinical Pharmacology\nhuman data begins",
    )
    s = plan_split(p)
    assert s.ok, s.reason
    assert s.prediction_safe is True, s.clinical_crossrefs
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python3 -m pytest data/prep/tests/test_split_review.py -q`
Expected: FAIL — `AttributeError: 'Split' object has no attribute 'prediction_safe'`.

- [ ] **Step 3: Implement**

In `data/prep/split_review.py`, after `NO_STUDIES_PATTERNS` (line 76) add:

```python
# Prose that reports a HUMAN outcome inside the nonclinical chapter. HANDOVER
# section 13.4c: the cut is mechanical, but the writing is not - an FDA
# multi-discipline review is written after the fact, so its nonclinical chapter can
# refer to what happened in patients. Guard 2 catches a clinical HEADING; this
# catches a sentence.
#
# WRITTEN NARROWLY ON PURPOSE. "Clinical signs" is routine tox vocabulary for
# observations in animals and "clinically relevant dose" is a comparison, so a bare
# search for "clinical" fires on every chapter and therefore means nothing. Each
# pattern below needs a human-outcome word, not just the stem.
CLINICAL_CROSSREF_PATTERNS = [
    r"\bclinically\b(?![- ]relevant)(?![- ]meaningful)",
    r"\bin (patients|humans|subjects)\b",
    r"\b(patients|subjects) (experienced|developed|reported|discontinued)",
    r"\bhuman (hepatotoxicity|toxicity|exposure data|trials?)\b",
    r"\bHy'?s Law\b",
    r"\belevations? in (transaminases|ALT|AST)\b.{0,60}\b(patient|human|clinical)",
    r"\b(phase [123]|first[- ]in[- ]human)\b",
]

# Sentences are the unit reported, so a reviewer can judge each hit rather than
# being handed a page number and a promise.
_SENTENCE = re.compile(r"[^.!?\n]*[.!?]")


def _clinical_crossrefs(pages: list[str], indices: list[int]) -> list[dict]:
    """Every sentence in the input set that reports a human outcome."""
    compiled = [re.compile(p, re.I) for p in CLINICAL_CROSSREF_PATTERNS]
    hits: list[dict] = []
    for i in indices:
        for sentence in _SENTENCE.findall(pages[i]):
            s = " ".join(sentence.split())
            if s and any(c.search(s) for c in compiled):
                hits.append({"page": i, "text": s})
    return hits
```

Extend the dataclass at lines 79-87:

```python
@dataclass
class Split:
    ok: bool
    reason: str
    nonclinical_pages: list[int]
    withheld_pages: list[int]
    nonclinical_start: int | None
    clinical_start: int | None
    clinical_crossrefs: list[dict]
    prediction_safe: bool
```

Every existing `Split(...)` call is positional and stops at `clinical_start`, so give the two new fields defaults instead of editing eight call sites — change the two lines to:

```python
    clinical_crossrefs: list[dict] = field(default_factory=list)
    prediction_safe: bool = True
```

and add `field` to the dataclasses import at line 32:

```python
from dataclasses import dataclass, asdict, field
```

Then replace the success return at line 217 with:

```python
    # Guard 3: the chapter may be the right pages and still not be blind. A
    # document that trips this is not refused - section 13.4c's resolution is that
    # it becomes a deliberation case and never a prediction case - so the split
    # succeeds and says so.
    crossrefs = _clinical_crossrefs(pages, nonclinical)
    return Split(True, "ok", nonclinical, withheld, nc, cl, crossrefs, not crossrefs)
```

Finally, surface it in `main()` after the existing `withheld` line (line 277):

```python
        if plan.prediction_safe:
            print("blindness         no clinical cross-reference found -> usable as a prediction case")
        else:
            print(f"blindness         {len(plan.clinical_crossrefs)} clinical cross-reference(s) IN THE INPUT SET")
            for h in plan.clinical_crossrefs[:5]:
                print(f"                  p{h['page']}: {h['text'][:96]}")
            print("                  NOT a prediction case. The chapter was written by reviewers who")
            print("                  already knew the outcome. Use it for deliberation only.")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest data/prep/tests -q`
Expected: all pass, including the 10 pre-existing `test_split_review.py` tests.

- [ ] **Step 5: Commit**

```bash
git add data/prep/split_review.py data/prep/tests/test_split_review.py
git commit -m "Check the nonclinical extract for the knowledge the page cut cannot remove"
```

---

### Task 7: Applicability-domain badge on evidence rows

Playbook §08 P2-A. `EvidenceClaim.inApplicabilityDomain: boolean | null` is already on every claim (`packages/engine/src/types.ts:50`) and R4 already downweights on `=== false` (`packages/engine/src/rules.ts:181`), but `EvidencePanel.tsx:68` gives a downweighted row only a rationale sentence — `is-defeated` fires on `status === "defeated"` only, so **a downweighted row is visually identical to an admitted one**. Maps to the OECD QAF reliability principle.

**Files:**
- Modify: `apps/web/src/tabs/Case/EvidencePanel.tsx:53-64`
- Modify: `apps/web/src/ui/app.css` (near line 335)
- Create: `apps/web/test/applicabilityDomain.test.tsx`

**Interfaces:**
- Consumes: `EvidenceClaim.inApplicabilityDomain` (`packages/engine/src/types.ts:50`), tri-state `boolean | null` where `null` means not assessable and is benign.
- Produces: `data-testid="domain-badge"` inside `.evidence-head`.

Render on `c.inApplicabilityDomain === false` only, matching R4's own `=== false` test — `null` is benign and must not be badged. The corpus has 12 such claims, all on `:qsar`; the Cyclosporine hero case (`PMATZTZNYRCHOR-CGLBZJNRSA-N:qsar`) is one, so the badge is visible in the demo.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/applicabilityDomain.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider, initialState } from "../src/state/store.js";
import { EvidencePanel } from "../src/tabs/Case/EvidencePanel.js";
import { loadData } from "../src/data/load.js";
import { CYCLOSPORINE, BOOT_CASE } from "../src/data/heroCases.js";

const data = loadData();

const renderAt = (compoundId: string) =>
  render(
    <StoreProvider data={data} initialState={{ ...initialState(data), selectedCompoundId: compoundId }}>
      <EvidencePanel collapsed={false} onExpand={() => {}} />
    </StoreProvider>,
  );

describe("the applicability-domain badge", () => {
  it("marks the row R4 downweighted, so the discount is visible without reading the trace", () => {
    renderAt(CYCLOSPORINE);
    const badges = screen.getAllByTestId("domain-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent(/OUT OF DOMAIN/i);
  });

  it("says the warning in words, never in colour alone", () => {
    renderAt(CYCLOSPORINE);
    expect(screen.getByTestId("domain-badge").textContent!.trim().length).toBeGreaterThan(0);
  });

  it("does not badge a claim that is in domain or not assessable", () => {
    // Every TAK-994 claim is inApplicabilityDomain: true. R4 tests `=== false`,
    // so `null` (not assessable) is benign and must not be badged either - a badge
    // on every row would carry no information.
    renderAt(BOOT_CASE);
    expect(screen.queryByTestId("domain-badge")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/web/test/applicabilityDomain.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="domain-badge"]`.

- [ ] **Step 3: Implement**

In `apps/web/src/tabs/Case/EvidencePanel.tsx`, add after the `MODIFIED` chip block (which closes at line 63):

```tsx
                {/*
                  R4 fired on this claim. The trace already says so in a sentence,
                  but a sentence in the rationale is not a property of the ROW - a
                  downweighted claim otherwise looks exactly like an admitted one,
                  and the reduced weight is the whole point of the rule. Rendered
                  on `=== false` and not on `null`, matching R4 itself: not
                  assessable is benign, and badging it would make the badge noise.
                */}
                {c.inApplicabilityDomain === false && (
                  <strong data-testid="domain-badge" className="chip chip-domain">
                    OUT OF DOMAIN - R4
                  </strong>
                )}
```

In `apps/web/src/ui/app.css`, after `.chip-warn` (line 335), add:

```css
/* Outside the applicability domain. A downweight is not a defeat, so this must
   not read as loud as .chip-warn - outline rather than fill, and the words carry
   the meaning either way. Not --pfizer-blue: that is reserved for the fired-rule
   chip, the primary action and the belief fill. */
.chip-domain { background: transparent; border-color: var(--toxic); color: var(--toxic); }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/web/test/applicabilityDomain.test.tsx apps/web/test/evidencePanel.test.tsx apps/web/test/a11y.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/tabs/Case/EvidencePanel.tsx apps/web/src/ui/app.css \
  apps/web/test/applicabilityDomain.test.tsx
git commit -m "Badge the rows R4 discounted, instead of burying it in the rationale"
```

---

### Task 8: Retire the invalidated claims across landing and docs

Playbook §12 item 5. The sweep found **no false superiority claim anywhere** — the codebase consistently states the opposite. The real exposure is different and worse: `apps/landing` hardcodes every figure as a TypeScript literal, only four of which any test binds to `results/metrics.json`, and it prints `0.750` with **no single-class caveat anywhere on the page**. Two further defects: three stale blindness assertions, and a self-contradiction on denominators.

**Files:**
- Modify: `apps/landing/src/sections/Result.tsx:19-22, 28-29, 34, 51-53`
- Modify: `apps/landing/src/sections/Metrics.tsx:27-31`
- Modify: `apps/landing/src/sections/RecordSpeaks.tsx:69-72`
- Modify: `apps/landing/src/sections/Faq.tsx:37`
- Modify: `apps/landing/test/landing.test.tsx:207, 208, 315`
- Modify: `HANDOVER.md:1609-1613`
- Modify: `docs/superpowers/specs/2026-08-09-arbiter-ai-redesign-design.md:435-438`
- Modify: `data/test-groups.json:12`

**Interfaces:** none. Copy and data only.

- [ ] **Step 1: Write the failing test**

Append to `apps/landing/test/landing.test.tsx`:

```tsx
describe("the superseded scoring target", () => {
  it("does not print a bare 0.750 without saying which target produced it", () => {
    render(<App />);
    // The figure may appear - it is what was measured - but never alone. The v1.0
    // binarisation counted Less-DILI-Concern as positive, so this number scored a
    // system correctly declining to flag amlodipine as wrong.
    const body = document.body.textContent ?? "";
    if (body.includes("0.750")) {
      expect(body).toMatch(/target v1\.0|superseded|re-graded/i);
    }
  });

  it("states the corrected figure somewhere on the page", () => {
    render(<App />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/0\.500/);
    expect(body).toMatch(/0\.601/);
  });

  it("uses one denominator for the structurally-forced declines", () => {
    render(<App />);
    const body = document.body.textContent ?? "";
    // 254 is nStructurallyForced out of nDeclined = 260, never out of scored = 267.
    expect(body).not.toMatch(/254 of 267/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/landing/test/landing.test.tsx`
Expected: FAIL — `0.500` / `0.601` absent, and `/254 of 267/` matches `Faq.tsx:37`.

- [ ] **Step 3: Implement**

In `apps/landing/src/sections/Faq.tsx:37`, fix the denominator:

```tsx
        "Abstention is a result: for 254 of the 260 compounds it declined, full confidence on every live claim still cannot reach it.",
```

In `apps/landing/src/sections/Result.tsx`, change the section heading at lines 51-53:

```tsx
              It Does Not Beat The Baseline.
              <br />
              And Under The Corrected Target, Nothing Does.
```

Add a superseded note immediately under the table (after the `</table>` that closes the block opened near line 19's data), reading from nothing — these are literals on this page by existing convention, so state them as literals with their target named:

```tsx
        <p className="result-note">
          Every figure in that table was graded under target v1.0, which this project&apos;s
          own audit invalidated: it counted Less-DILI-Concern as positive, placing 330 of
          536 positives in a class containing aspirin, amoxicillin and amlodipine. Re-graded
          against the corrected target, ARBITER scores 0.500 on the full scored split, and
          no pipeline tested clears 0.601 - including every baseline. The QSAR figure was
          fitted under v1.0, so its corrected number is a lower bound. The finding is about
          the target, not about this system.
        </p>
```

In `apps/landing/src/sections/Metrics.tsx:27-31`, retire the accuracy tile's misleading note:

```tsx
    to: 0.75, decimals: 3, suffix: "",
    label: "Balanced Accuracy (target v1.0, superseded)",
    note: "Conflict subset, n=61. Re-graded against the corrected target it is 0.500, and nothing tested clears 0.601.",
```

In `apps/landing/src/sections/RecordSpeaks.tsx:69-72`:

```tsx
    text: "Ties single:transporter exactly under target v1.0, because both pipelines score the same four compounds. Under the corrected target, 0.500. We say so.",
    badge: "=",
    who: "Balanced acc. 0.750 (v1.0, superseded)",
    what: "Conflict subset n=61",
```

Update the two pinned assertions in `apps/landing/test/landing.test.tsx` at lines 207 and 315 from `/It Ties One Stream, Exactly\./` to `/And Under The Corrected Target, Nothing Does\./`, in this same commit.

In `HANDOVER.md:1609-1613`, append a forward pointer to the stale §13.3 passage so it cannot be read alone:

```markdown
> **CORRECTED by §13.4c.** The mechanical cut does not guarantee blindness for FDA
> multi-discipline reviews: the Turalio nonclinical chapter cross-references the
> clinical outcome in its own words, because one document was written by reviewers
> who already knew it. The cut moves the pages, not the knowledge. `split_review.py`
> now screens for this (Guard 3), and a document that trips it is a deliberation
> case and never a prediction case.
```

Add the identical block under `docs/superpowers/specs/2026-08-09-arbiter-ai-redesign-design.md:438`.

In `data/test-groups.json:12`, extend `selectionRule` so the data file carries the caveat too:

```
"... separated mechanically and a case whose chapters will not split cleanly is dropped rather than trimmed by hand. The mechanical separation is necessary and NOT sufficient: an FDA multi-discipline review is one document written after the clinical outcome was known, so the nonclinical extract is additionally screened for clinical cross-references, and a document containing one is used for deliberation and never for prediction scoring."
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/landing/test/landing.test.tsx`
Expected: PASS, including the pre-existing metrics cross-check at lines 39-59 (untouched: `metrics.json` still says `0.75` and the literal `"0.750"` still appears in the table).

- [ ] **Step 5: Commit**

```bash
git add apps/landing/src/sections HANDOVER.md data/test-groups.json \
  docs/superpowers/specs/2026-08-09-arbiter-ai-redesign-design.md apps/landing/test/landing.test.tsx
git commit -m "Name the target every published figure was graded under"
```

---

### Task 9: Commit-before-reveal gate in apps/web

Playbook §08 P2-C, backed by Buçinca, Malaya & Gajos 2021: explanations alone increase uncritical acceptance, and cognitive forcing functions measurably reduce over-reliance. The deliberation app already has the strongest form of this; `apps/web` renders the verdict unconditionally the moment the Case tab mounts.

Two constraints from exploration. First, **the verdict leaks from four components, not one** — `useCaseReasoning()` is called independently by `CaseHeader`, `EvidencePanel`, `TracePanel` and `TablePanel`, so gating `CaseHeader` alone leaves the verdict readable from `trace.verdictReason` and the counterfactual's `newVerdict`. Second, **six Playwright assertions use `getByTestId("verdict")` on `#/case` mount as a readiness barrier**; they must be updated to commit through the gate first, not worked around.

Per the playbook, the gate fires only on high-gap or contested cases so it is not friction on every view. Both hero cases trip it, by different clauses.

**Files:**
- Modify: `apps/web/src/state/store.tsx:107-160, 353` (state, action, reducer)
- Create: `apps/web/src/tabs/Case/CommitGate.tsx`
- Modify: `apps/web/src/tabs/Case/CaseHeader.tsx:42-58`
- Modify: `apps/web/src/tabs/Case/TracePanel.tsx:21-54`
- Modify: `apps/web/src/ai/anchors.ts:42-48` (`CONDITIONAL_ANCHORS`)
- Modify: `apps/web/src/tabs/Case/case.css`
- Create: `apps/web/test/commitGate.test.tsx`
- Modify: `apps/web/test/caseHeader.test.tsx:12-16`
- Modify: `apps/web/e2e/demo.spec.ts`, `apps/web/e2e/static-file.spec.ts`, `apps/web/e2e/ai-static.spec.ts`

**Interfaces:**
- Produces, on `AppState` (beside `customCompounds` at `store.tsx:107-122`):
```ts
  /** The reader's own call, recorded before the verdict is shown. Session-local,
   *  keyed by compoundId, exactly like `customCompounds`. */
  provisionalCalls: Record<string, Verdict>;
```
  Action: `| { type: "recordProvisionalCall"; compoundId: string; call: Verdict }`.
  Gate predicate, used by both `CaseHeader` and `TracePanel`:
```ts
export function gateHolds(state: AppState, r: Reasoning, compoundId: string): boolean;
```
  exported from `apps/web/src/tabs/Case/CommitGate.tsx`, returning `true` while the verdict must stay hidden.

Store state rather than `useState`: a collapsed Case region **unmounts** its content (`apps/web/src/ai/anchors.ts:20-22`), so panel-local state is destroyed by the spotlight and the tour.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/commitGate.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider, initialState } from "../src/state/store.js";
import { CaseHeader } from "../src/tabs/Case/CaseHeader.js";
import { loadData } from "../src/data/load.js";
import { CYCLOSPORINE, BOOT_CASE } from "../src/data/heroCases.js";

const data = loadData();

const renderAt = (compoundId: string) =>
  render(
    <StoreProvider data={data} initialState={{ ...initialState(data), selectedCompoundId: compoundId }}>
      <CaseHeader />
    </StoreProvider>,
  );

describe("the commit-before-reveal gate", () => {
  it("withholds the verdict on a high-gap case until the reader commits", () => {
    // TAK-994: gap 0.910 against a 0.5 threshold.
    renderAt(BOOT_CASE);
    expect(screen.queryByTestId("verdict")).toBeNull();
    expect(screen.getByTestId("commit-gate")).toBeInTheDocument();
  });

  it("reveals the verdict once a call is recorded, and keeps it revealed", () => {
    renderAt(BOOT_CASE);
    fireEvent.click(screen.getByTestId("commit-abstain"));
    expect(screen.getByTestId("verdict")).toHaveTextContent(/abstain/i);
    expect(screen.queryByTestId("commit-gate")).toBeNull();
  });

  it("shows the reader their own call beside the engine's, so the two can be compared", () => {
    renderAt(BOOT_CASE);
    fireEvent.click(screen.getByTestId("commit-advance"));
    expect(screen.getByTestId("provisional-call")).toHaveTextContent(/you said/i);
    expect(screen.getByTestId("provisional-call")).toHaveTextContent(/advance/i);
  });

  it("fires on a contested case even when the gap is narrow", () => {
    // Cyclosporine: gap 0.098, well under the threshold, but contested with
    // conflict mass 0.122. Contested is the second clause for exactly this case.
    renderAt(CYCLOSPORINE);
    expect(screen.getByTestId("commit-gate")).toBeInTheDocument();
  });

  it("says why it is asking, because an unexplained gate is just friction", () => {
    renderAt(BOOT_CASE);
    expect(screen.getByTestId("commit-gate")).toHaveTextContent(/before you see/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/web/test/commitGate.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="commit-gate"]`.

- [ ] **Step 3: Implement**

In `apps/web/src/state/store.tsx`, add the state slot beside `customCompounds`:

```ts
  /**
   * The reader's own call on a compound, recorded BEFORE the verdict was shown.
   *
   * SESSION-LOCAL, like customCompounds, and for a sharper reason: this is a
   * cognitive forcing function (Buçinca, Malaya & Gajos 2021), and its value comes
   * entirely from being answered before the answer is visible. Persisting it
   * across reloads would let a reader see the verdict, reload, and "commit" to it.
   */
  provisionalCalls: Record<string, Verdict>;
```

with `provisionalCalls: {}` in `initialState`, the action in the `Action` union, and the reducer case near line 353:

```ts
    case "recordProvisionalCall": {
      // Write-once. A reader who has seen the verdict cannot revise the call they
      // made before seeing it - that would make the record meaningless.
      if (s.provisionalCalls[a.compoundId] !== undefined) return s;
      return { ...s, provisionalCalls: { ...s.provisionalCalls, [a.compoundId]: a.call } };
    }
```

Create `apps/web/src/tabs/Case/CommitGate.tsx`:

```tsx
/**
 * Commit before reveal. Spec: playbook §08 P2-C.
 *
 * WHY A GATE AND NOT A NOTE. Explanations alone measurably increase uncritical
 * acceptance - a plausible rationale invites agreement rather than scrutiny, and
 * human-plus-AI teams frequently underperform the AI alone. What reduces that is a
 * cognitive forcing function: something that compels an analytical judgement
 * before the recommendation is visible (Buçinca, Malaya & Gajos 2021, CSCW). The
 * deliberation app already does this with blind positions; this is the same idea
 * for the single-user app.
 *
 * ONLY ON THE CASES THAT WARRANT IT. A gate on every view is friction that gets
 * clicked through, which is worse than no gate because it manufactures a record of
 * a judgement nobody made. It fires when the belief-plausibility gap exceeds the
 * registered abstention threshold, or when the claims are contested - the two
 * situations where the reader's own reading is worth capturing.
 */
import type { Reasoning, Verdict } from "@arbiter/engine";
import { useAppState, useDispatch, type AppState } from "../../state/store.js";

export function gateHolds(state: AppState, r: Reasoning, compoundId: string): boolean {
  if (state.provisionalCalls[compoundId] !== undefined) return false;
  const gap = r.plausibility - r.belief;
  return gap > state.data.ruleset.abstentionGapThreshold || r.contested;
}

const CALLS: { call: Verdict; testid: string; label: string }[] = [
  { call: "advance", testid: "commit-advance", label: "Advance" },
  { call: "do_not_advance", testid: "commit-do-not-advance", label: "Do not advance" },
  { call: "abstain", testid: "commit-abstain", label: "Abstain" },
];

export function CommitGate({ compoundId }: { compoundId: string }) {
  const dispatch = useDispatch();
  return (
    <div className="commit-gate" data-testid="commit-gate">
      <p className="caveat">
        The evidence on this compound is contested or leaves a wide gap. Before you see
        what ARBITER concluded, record your own call - it is kept beside the verdict so
        you can see where the two differ.
      </p>
      <div className="commit-gate-actions">
        {CALLS.map((c) => (
          <button
            key={c.call}
            type="button"
            className="btn"
            data-testid={c.testid}
            onClick={() => dispatch({ type: "recordProvisionalCall", compoundId, call: c.call })}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ProvisionalCall({ compoundId }: { compoundId: string }) {
  const { provisionalCalls } = useAppState();
  const call = provisionalCalls[compoundId];
  if (call === undefined) return null;
  return (
    <p className="small muted" data-testid="provisional-call">
      You said <strong>{call.replace(/_/g, " ")}</strong> before seeing this.
    </p>
  );
}
```

In `CaseHeader.tsx`, wrap the verdict (line 44) and the figures block (lines 49-58):

```tsx
  const held = gateHolds(state, r, selectedCompoundId);
  ...
  {held ? <CommitGate compoundId={selectedCompoundId} /> : (
    <>
      <span data-anchor="case.verdict"><VerdictLabel verdict={r.verdict} /></span>
      <ProvisionalCall compoundId={selectedCompoundId} />
      {/* the existing case-figures block, unchanged */}
    </>
  )}
```

Apply the same `held` guard in `TracePanel.tsx` around lines 21-28 (belief track, mass, conflict mass from Task 3) and lines 42-54 (`verdict-reason`, counterfactual). Leave the trace steps themselves visible — the reasoning is what the reader should engage with; only the conclusion is withheld.

In `apps/web/src/ai/anchors.ts`, add `case.verdict`, `case.beliefRange`, `trace.beliefTrack`, `trace.mass`, `trace.verdictReason` and `trace.counterfactual` to `CONDITIONAL_ANCHORS` (lines 42-48), since each is now conditionally absent. Without this, `anchors.test.tsx`'s "every unconditional anchor is present exactly once" sweep fails.

In `apps/web/src/tabs/Case/case.css`:

```css
/* The gate is a pause, not an alarm. Bordered and calm - a red panel would read
   as an error and get dismissed rather than answered. */
.commit-gate { border: 1px solid var(--hairline); border-radius: var(--radius-sm); padding: var(--s4); background: var(--surface); }
.commit-gate-actions { display: flex; gap: var(--s2); flex-wrap: wrap; margin-top: var(--s3); }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/web/test`
Expected: PASS. Update `caseHeader.test.tsx:12-16` (which asserts `verdict` on bare mount) to click through the gate first, in this commit.

Then update the e2e barriers and run them:

```bash
npm run e2e
```
In `demo.spec.ts:4-5`, `static-file.spec.ts:23-28, 62, 162-163` and `ai-static.spec.ts:45-46, 81-86`, commit through the gate before asserting the verdict, e.g.:
```ts
await page.goto("/#/case");
await page.getByTestId("commit-abstain").click();
await expect(page.getByTestId("verdict")).toContainText(/abstain/i);
```
For the two readiness-barrier uses in `ai-static.spec.ts:82-86` and `static-file.spec.ts:163`, await `commit-gate` instead of `verdict` as the barrier, then click.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src apps/web/test apps/web/e2e
git commit -m "Ask the reader for a call before showing them the answer"
```

---

## Self-Review

**Spec coverage.** Playbook §08 P1-A → Tasks 1+2. P1-B → Task 3. P1-C → Task 5. P2-A → Task 7. P2-B → Task 5. P2-C → Task 9. §12 item 1 → Task 2. Item 2 → Tasks 3+5. Item 3 (consistency probe) → **already done before this plan**: `results/probe-runs.json` is a live 20-run `gemini-3.5-flash` result, flip rate 0.0% against a pre-committed 10.0% pass mark, so Gate 0 passes; the playbook's premise that no key ever existed is outdated. Item 4 (verify external figures) is a rehearsal task, not an engineering one, and is out of scope for this plan. Item 5 → Task 8. Items 6-8 (rehearse, submit) are not engineering tasks. §11's "that check does not exist yet" → Task 6. Not in the playbook but found and confirmed by repro → Task 4.

**Explicitly not attempted**, per the playbook's own list: sharing the engine between the two apps, live adjudication against a real model, PDF extraction, and Surface 2's live consistency run.

**Ordering.** Task 1 → Task 2 (Task 2 reads the artifact Task 1 writes). Task 4 → Task 5 (Task 4 establishes the reveal gate Task 5 reuses). Task 3 → Task 9 (Task 9 gates the element Task 3 adds). Tasks 6, 7, 8 are independent.

**Known residual risk.** Task 9 is the only task that changes an existing rendering contract, and it touches three Playwright specs. If it destabilises the demo, revert Task 9 alone: nothing else depends on it.

