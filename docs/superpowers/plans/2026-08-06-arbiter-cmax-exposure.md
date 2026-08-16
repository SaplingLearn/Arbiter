# Clinical Cmax Exposure Axis - Implementation Plan

> **EXECUTED. Read it with the 2026-08-09 redesign before extending it.**
>
> This plan built the R3 clinical Cmax exposure axis. It ran to completion and
> merged; the checkboxes below are a record, not a queue.
>
> The rules themselves are **kept** - §2 of
> `docs/superpowers/specs/2026-08-09-arbiter-ai-redesign-design.md` retains R1-R6 as
> required disclosure, on the grounds that they "were never the defect". What
> changed is that they stopped being the sole decider, and that the rulebook now
> grows and versions (§5) instead of being six fixed rules.
>
> So a new evidence axis is still legitimate work - but it lands as a versioned
> ruleset entry consumed by the adjudicator in `services/api`, not as another rule
> wired into `apps/web`. `rules/ruleset-v1.0.json` is never edited.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `exposureRelevant: False` on every Tox21 claim with a measured margin - the assay's top tested concentration over the drug's unbound clinical Cmax - so R3 fires on established facts rather than on an assumption nobody checked.

**Architecture:** Two new Python ingest scripts write two new artifacts under `data/out/`; `assemble_evidence.py` becomes the single site that decides `exposureRelevant` by joining them against a pre-registered, hashed margin policy. `stream-tox21.json`, `compounds.json` and `splits.json` are never regenerated. The TypeScript engine is not modified at all - `relevanceDiscount` already consumes `exposureRelevant` correctly and has simply never been handed a `true`.

**Tech Stack:** Python 3.12 (pandas, rdkit, requests, pytest) under `data/prep/`; TypeScript (tsx, vitest, zod) under `apps/harness/`.

## Global Constraints

Copied verbatim from the spec (`docs/superpowers/specs/2026-08-06-arbiter-cmax-exposure-design.md`, §12) and HANDOVER §1. **Every task's requirements implicitly include this section.**

- **`rules/ruleset-v1.0.json` is never opened.** Its hash `ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136` must still match at the end of every task.
- **`packages/engine/src` is not modified.** No `Date`, `Math.random`, `node:*`, `fs`/`path`/`crypto`, dynamic `import`, or parent imports anywhere in it. Lint enforces this.
- **`abstentionGapThreshold` stays 0.5.** Editing it to improve a headline is forbidden.
- **The benchmark corpus is frozen (2 August 2026).** No task regenerates `data/out/compounds.json` or `data/out/splits.json`.
- **`data/out/stream-tox21.json` stays byte-identical.** Verified by `git diff --exit-code` in Task 5.
- **`exposureRelevant: true` may never be set without a computed margin.**
- **Margin policy, fixed before any number is looked at:** `marginFactor: 100`, `basis: "unbound"`.
- **Language discipline:** write "review-ready evidence package" not "regulator-ready dossier"; "positions / sign-off / decision owner" not "voting / tally / majority"; "hash-chained audit log" not "blockchain". Applies to code, comments, and commit messages.
- **Commit AND push after every task.** Not batched. `git push origin ablation-spec`.
- **Every test must be watched failing before it is trusted.** Assert on `data-ok`-style discriminating values, never on a string that appears in both the pass and fail message.
- **Python commands** run as `data/prep/.venv/Scripts/python` on Windows, `data/prep/.venv/bin/python` elsewhere. Written below as `$PY`.

---

## File Structure

| file | status | responsibility |
|---|---|---|
| `rules/exposure-policy-v1.0.json` | create | The pre-registered margin policy. Hashed; the harness refuses to run on mismatch. |
| `apps/harness/src/preregistration.ts` | modify | Add the policy's projection + registered hash beside the ruleset's. One definition, no second copy. |
| `apps/harness/src/load.ts` | modify | Enforce the policy hash where the ruleset hash is already enforced. |
| `apps/harness/test/exposurePolicy.test.ts` | create | A mutated policy makes the harness refuse to run. |
| `data/prep/exposure_margin.py` | create | Pure margin arithmetic. No I/O, so it is trivially testable. |
| `data/prep/tests/test_exposure_margin.py` | create | Boundary at exactly 100×, both directions, null propagation. |
| `data/prep/cmax_ingest.py` | create | Curated Cmax table → `data/out/cmax.json`, joined on InChIKey. |
| `data/prep/tests/test_cmax_join.py` | create | Join correctness; a non-matching table exits non-zero rather than writing nothing. |
| `data/prep/tests/test_cmax_units.py` | create | ng/mL → µM against hand-worked values; unbound from `fractionUnbound`. |
| `data/prep/tox21_concentrations.py` | create | Re-pull the **already-pinned** AIDs for concentration columns → `data/out/tox21-concentrations.json`. |
| `data/prep/tox21_stream.py:275` | modify | Hardcoded `False` → `None`. The spec's §3 correction. |
| `data/prep/assemble_evidence.py` | modify | The join. The **only** site that decides `exposureRelevant`. |
| `apps/harness/src/baselines.ts` | modify | Add `cmaxThreshold` - the "is this just a Cmax rule in a costume" answer. |
| `apps/harness/test/baselines.test.ts` | modify | Test the new baseline, including that it abstains without a Cmax. |
| `apps/harness/src/main.ts:29` | modify | Wire `single:cmax-threshold` into the baseline table. |
| `apps/web/test/exposureGate.test.ts` | **verify only** | Already covers the gate in 6 tests. Must still pass once corpus claims carry `exposureRelevant: true`. Do not add duplicates. |

**Task order note.** Tasks 1–3 need no network access and are most of the work. Task 4 is the first step that touches the internet. Task 7 is the only one that moves a reported number, and it is deliberately last-but-one so everything it depends on is already tested.

---

### Task 1: Pre-register the exposure policy

Registration must precede the first number, so this task ships before anything can compute a margin. It is its own task because a reviewer could reasonably reject the policy's *content* while approving every later task.

**Files:**
- Create: `rules/exposure-policy-v1.0.json`
- Modify: `apps/harness/src/preregistration.ts` (append after `PRE_REGISTERED_HASH`, currently ends line 53)
- Modify: `apps/harness/src/load.ts:27-44`
- Test: `apps/harness/test/exposurePolicy.test.ts`

**Interfaces:**
- Consumes: `canonicalJson` and `rulesetHash` - both already exported, from `./preregistration.js` and `./hash.js` respectively.
- Produces: `projectExposurePolicyForHash(p): Record<string, unknown>` and `PRE_REGISTERED_EXPOSURE_POLICY_HASH: string`, plus the exported type `ExposurePolicy = { version: string; registeredAt: string; marginFactor: number; basis: "unbound" | "total"; statement: string; rationale: string; appliesToStreams: string[] }`. **The policy is validated and discarded, not added to `Inputs`** - no TypeScript consumer needs its contents, since Python reads `marginFactor` directly from the file. Adding an unread field would be a claim that something downstream honours it.

- [ ] **Step 1: Write the policy file**

Create `rules/exposure-policy-v1.0.json`:

```json
{
  "version": "1.0",
  "registeredAt": "2026-08-06",
  "marginFactor": 100,
  "basis": "unbound",
  "statement": "A negative in-vitro finding is treated as exposure-relevant only where the assay's top tested concentration is at least 100x the drug's maximum unbound plasma concentration. Below that multiple the negative is recorded as exposure-inadequate; where either quantity is unavailable the margin is recorded as never established.",
  "rationale": "100x is the conventional in-vitro safety margin over unbound clinical exposure. Unbound rather than total, because an in-vitro assay doses nominal media concentration while Cmax,total is predominantly protein-bound; comparing a nominal concentration against total plasma concentration overstates the achieved margin by up to two orders of magnitude for a highly bound drug.",
  "appliesToStreams": ["cytotox", "transporter"]
}
```

- [ ] **Step 2: Add the projection and a deliberately wrong hash**

Append to `apps/harness/src/preregistration.ts`. Note the placeholder hash - Step 4 replaces it with the computed value, and Step 3 proves the check can actually fail before we trust it.

```ts
/**
 * The exposure policy's pre-registration surface.
 *
 * Excludes `version`, `registeredAt` (metadata) and `statement`, `rationale`
 * (prose), mirroring how projectForHash treats the ruleset. Includes
 * `appliesToStreams`, which IS a decision: it says which streams the margin
 * governs, and widening it later would change which claims R3 discounts.
 */
export function projectExposurePolicyForHash(p: {
  marginFactor: unknown;
  basis: unknown;
  appliesToStreams: unknown;
}): Record<string, unknown> {
  return {
    marginFactor: p.marginFactor,
    basis: p.basis,
    appliesToStreams: p.appliesToStreams,
  };
}

/**
 * Registered 2026-08-06, BEFORE the first margin was computed.
 *
 * The margin factor is not a knob to be tried at several values and reported at
 * the best one - that is the same failure as tuning abstentionGapThreshold. The
 * M-sensitivity curve is a disclosure reported beside the headline, never the
 * headline itself.
 */
export const PRE_REGISTERED_EXPOSURE_POLICY_HASH = "0".repeat(64);
```

- [ ] **Step 3: Enforce it, then write the test and watch it fail for the RIGHT reason**

In `apps/harness/src/load.ts`, add to the import on line 3 and insert the check immediately after the existing ruleset check (after line 44):

```ts
// line 3 becomes:
import {
  PRE_REGISTERED_EXPOSURE_POLICY_HASH, PRE_REGISTERED_HASH,
  projectExposurePolicyForHash, projectForHash, rulesetHash,
} from "./hash.js";
```

```ts
// after the ruleset hash check:
const exposurePolicy = read("rules/exposure-policy-v1.0.json") as ExposurePolicy;
const exposureHash = rulesetHash(projectExposurePolicyForHash(exposurePolicy));
if (exposureHash !== PRE_REGISTERED_EXPOSURE_POLICY_HASH) {
  throw new Error(
    `Exposure policy hash ${exposureHash} does not match the pre-registered `
    + `${PRE_REGISTERED_EXPOSURE_POLICY_HASH}.\n`
    + "rules/exposure-policy-v1.0.json has changed. The margin factor was registered "
    + "before the first margin was computed, precisely so it could not be tuned "
    + "afterwards to improve a number.",
  );
}
```

Add the type near `Inputs` and the field to the interface and its return object:

```ts
export interface ExposurePolicy {
  version: string;
  registeredAt: string;
  marginFactor: number;
  basis: "unbound" | "total";
  statement: string;
  rationale: string;
  appliesToStreams: string[];
}
```

Also re-export from `apps/harness/src/hash.ts` line 26:

```ts
export {
  canonicalJson, PRE_REGISTERED_EXPOSURE_POLICY_HASH, PRE_REGISTERED_HASH,
  projectExposurePolicyForHash, projectForHash,
} from "./preregistration.js";
```

Write `apps/harness/test/exposurePolicy.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rulesetHash } from "../src/hash.js";
import {
  PRE_REGISTERED_EXPOSURE_POLICY_HASH,
  projectExposurePolicyForHash,
} from "../src/preregistration.js";

const policy = JSON.parse(readFileSync("rules/exposure-policy-v1.0.json", "utf8"));

describe("exposure policy pre-registration", () => {
  it("matches its registered hash", () => {
    expect(rulesetHash(projectExposurePolicyForHash(policy))).toBe(
      PRE_REGISTERED_EXPOSURE_POLICY_HASH,
    );
  });

  // The test that gives the one above its meaning. Without it, a projection that
  // returned a constant would pass the first assertion forever.
  it("a mutated margin factor produces a DIFFERENT hash", () => {
    const tampered = { ...policy, marginFactor: 30 };
    expect(rulesetHash(projectExposurePolicyForHash(tampered))).not.toBe(
      PRE_REGISTERED_EXPOSURE_POLICY_HASH,
    );
  });

  // appliesToStreams is in the surface deliberately - widening it changes which
  // claims R3 governs, so it must not be silently editable.
  it("a mutated appliesToStreams produces a DIFFERENT hash", () => {
    const tampered = { ...policy, appliesToStreams: ["cytotox", "transporter", "qsar"] };
    expect(rulesetHash(projectExposurePolicyForHash(tampered))).not.toBe(
      PRE_REGISTERED_EXPOSURE_POLICY_HASH,
    );
  });

  // Prose is NOT in the surface: reworded rationale must not invalidate a result.
  it("rewording the rationale does NOT change the hash", () => {
    const reworded = { ...policy, rationale: "different words entirely" };
    expect(rulesetHash(projectExposurePolicyForHash(reworded))).toBe(
      PRE_REGISTERED_EXPOSURE_POLICY_HASH,
    );
  });
});
```

Run: `npx vitest run apps/harness/test/exposurePolicy.test.ts`
Expected: test 1 and test 4 FAIL with the real computed hash vs `000…0`; tests 2 and 3 PASS. **Read the failure message and copy the computed hash - that is Step 4's input.** If test 2 or 3 fails here, the projection is returning a constant and must be fixed before continuing.

- [ ] **Step 4: Register the computed hash**

Replace `"0".repeat(64)` in `preregistration.ts` with the hash from Step 3's failure message, as a literal:

```ts
export const PRE_REGISTERED_EXPOSURE_POLICY_HASH =
  "<paste the 64-char hash from Step 3 here>";
```

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run apps/harness/ && npm run typecheck && npm run lint`
Expected: all 4 exposure-policy tests PASS, typecheck clean, lint clean.

Then confirm the ruleset is still untouched:

Run: `git diff --exit-code rules/ruleset-v1.0.json`
Expected: exit 0, no output.

- [ ] **Step 6: Commit and push**

```bash
git add rules/exposure-policy-v1.0.json apps/harness/src/preregistration.ts \
        apps/harness/src/hash.ts apps/harness/src/load.ts \
        apps/harness/test/exposurePolicy.test.ts
git commit -m "Pre-register the exposure margin policy at 100x unbound Cmax

Registered BEFORE any margin is computed, so the factor cannot be tuned
afterwards to improve a number - the same discipline that protects
abstentionGapThreshold. ruleset-v1.0.json is not opened and ed073a8a still
matches.

The surface excludes prose and includes appliesToStreams, which is a decision
rather than metadata: widening it would change which claims R3 governs. Tests
assert both directions - a mutated factor or stream list changes the hash, a
reworded rationale does not.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin ablation-spec
```

---

### Task 2: The margin arithmetic

Pure functions, no I/O, so the logic that decides every `exposureRelevant` value in the corpus is testable without a network or a data file. TDD applies literally here - the boundary and the null cases *are* the whole of the logic.

**Files:**
- Create: `data/prep/exposure_margin.py`
- Test: `data/prep/tests/test_exposure_margin.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `margin(top_tested_um, cmax_unbound_um) -> float | None` and `exposure_relevant(top_tested_um, cmax_unbound_um, factor) -> bool | None`. Task 5 imports both.

- [ ] **Step 1: Write the failing test**

Create `data/prep/tests/test_exposure_margin.py`:

```python
"""The arithmetic that decides every exposureRelevant value in the corpus.

Pure functions with no I/O, so the rule R3 consumes can be tested exactly rather
than inferred from a pipeline run.
"""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from exposure_margin import exposure_relevant, margin


def test_margin_is_top_tested_over_unbound_cmax():
    assert margin(92.0, 0.92) == pytest.approx(100.0)
    assert margin(92.0, 9.2) == pytest.approx(10.0)


def test_margin_is_none_when_either_input_is_missing():
    assert margin(None, 0.92) is None
    assert margin(92.0, None) is None
    assert margin(None, None) is None


def test_margin_refuses_a_nonpositive_cmax_rather_than_returning_infinity():
    """A zero Cmax would clear any factor and silently mark everything relevant."""
    with pytest.raises(ValueError):
        margin(92.0, 0.0)
    with pytest.raises(ValueError):
        margin(92.0, -1.0)


def test_exactly_at_the_factor_is_relevant():
    """The boundary is >=, and it is asserted in BOTH directions so an
    implementation using > fails here rather than shifting one compound silently."""
    assert exposure_relevant(92.0, 0.92, 100) is True     # exactly 100x
    assert exposure_relevant(91.9, 0.92, 100) is False    # a hair under


def test_wide_margin_is_relevant_and_narrow_is_not():
    assert exposure_relevant(92.0, 0.001, 100) is True    # 92,000x
    assert exposure_relevant(92.0, 92.0, 100) is False    # 1x


def test_missing_input_is_none_not_false():
    """null and false are DIFFERENT statements to R3: 'never established' versus
    'established and inadequate'. Collapsing them re-introduces the overclaim this
    whole change exists to remove."""
    assert exposure_relevant(None, 0.92, 100) is None
    assert exposure_relevant(92.0, None, 100) is None
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd data/prep && $PY -m pytest tests/test_exposure_margin.py -v`
Expected: FAIL - `ModuleNotFoundError: No module named 'exposure_margin'`

- [ ] **Step 3: Write the minimal implementation**

Create `data/prep/exposure_margin.py`:

```python
"""Exposure margin arithmetic for R3.

Deliberately pure: no I/O, no config lookup, no data files. The rule that decides
every exposureRelevant value in the corpus should be readable in one screen and
testable without a network.

WHY None IS NOT False. R3 reads `exposureRelevant !== true`, so the engine treats
them identically and no verdict depends on the difference. The TRACE does:

    false -> "a negative result from testing outside the clinically relevant range"
    null  -> "whose exposure margin relative to the clinical range was never established"

The first is a claim about a measurement. Emitting it where nothing was measured
tells a toxicologist a fact nobody checked, which is exactly the overclaim this
module exists to remove - see the design spec section 3.
"""


def margin(top_tested_um: float | None, cmax_unbound_um: float | None) -> float | None:
    """How many multiples of unbound clinical exposure the assay actually reached.

    Returns None when either quantity is unavailable. Raises on a non-positive
    Cmax rather than returning infinity: a zero would clear any factor and mark
    every compound exposure-relevant, which is the silent-catastrophe direction.
    """
    if top_tested_um is None or cmax_unbound_um is None:
        return None
    if cmax_unbound_um <= 0:
        raise ValueError(
            f"cmax_unbound_um must be positive, got {cmax_unbound_um}. A zero or "
            "negative unbound Cmax produces an infinite margin that clears any "
            "factor, marking every compound exposure-relevant."
        )
    return top_tested_um / cmax_unbound_um


def exposure_relevant(
    top_tested_um: float | None,
    cmax_unbound_um: float | None,
    factor: float,
) -> bool | None:
    """The three-valued answer R3 consumes. `factor` comes from the registered policy."""
    m = margin(top_tested_um, cmax_unbound_um)
    if m is None:
        return None
    return m >= factor
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `cd data/prep && $PY -m pytest tests/test_exposure_margin.py -v`
Expected: 6 passed.

Then confirm the boundary test can fail - change `>= factor` to `> factor`, re-run, and watch `test_exactly_at_the_factor_is_relevant` fail. Revert.

- [ ] **Step 5: Commit and push**

```bash
git add data/prep/exposure_margin.py data/prep/tests/test_exposure_margin.py
git commit -m "Add the exposure margin arithmetic, with the boundary pinned

Pure functions, no I/O, so the rule deciding every exposureRelevant value is
testable without a network. The >= boundary at exactly 100x is asserted in both
directions; a > implementation fails the test rather than shifting one compound
silently.

None is not False and the tests say so. R3 treats them identically so no verdict
depends on it, but the trace prints a different rationale for each, and emitting
'tested outside the clinically relevant range' where nothing was measured is the
overclaim this change exists to remove.

A non-positive unbound Cmax raises instead of returning infinity - that would
clear any factor and mark every compound relevant.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin ablation-spec
```

---

### Task 3: Cmax ingest

**Files:**
- Create: `data/prep/cmax_ingest.py`
- Test: `data/prep/tests/test_cmax_join.py`, `data/prep/tests/test_cmax_units.py`
- Modify: `data/prep/README.md` (append the download step)

**Interfaces:**
- Consumes: `OUT` from `dilirank_common`.
- Produces: `data/out/cmax.json` shaped `{ generatedAt, source, sourceRetrieved, marginBasis, nCompounds, nWithUnbound, entries: { <inchikey>: { cmaxTotalUM, cmaxUnboundUM, fractionUnbound } } }`; plus `ug_per_ml_to_um(ug_per_ml, mw) -> float` and `unbound_from(total_um, fraction_unbound) -> float | None`. Task 5 reads `entries`.

**Before starting:** the curated table must be downloaded to `data/raw/cmax-source.csv` by hand, exactly as DILIrank is (`data/prep/README.md` explains why: a URL that silently returns an HTML error page as a "spreadsheet" is a worse failure than asking a human to click once). Append a section documenting the source, its URL, and its retrieval date.

- [ ] **Step 1: Write the failing unit tests**

Create `data/prep/tests/test_cmax_units.py`:

```python
"""Unit conversion, against hand-worked values.

Getting this wrong by 1000x is silent: every margin scales together, so the
distribution still looks plausible and only the exposureRelevant counts move.
"""
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from cmax_ingest import ug_per_ml_to_um, unbound_from


def test_ug_per_ml_to_um_hand_worked():
    # Paracetamol, MW 151.16 g/mol. 20 ug/mL = 20 mg/L; 20 / 151.16 = 0.13231 mM
    # = 132.31 uM.
    assert ug_per_ml_to_um(20.0, 151.16) == pytest.approx(132.31, rel=1e-3)
    # Ciclosporin, MW 1202.6. 1 ug/mL -> 0.8315 uM. A big molecule is the case
    # where a missing molecular weight would be most visible.
    assert ug_per_ml_to_um(1.0, 1202.6) == pytest.approx(0.8315, rel=1e-3)


def test_ng_per_ml_is_ug_per_ml_over_a_thousand():
    """Stated as its own test because the source mixes ng/mL and ug/mL, and a
    1000x error here is invisible downstream - every margin scales together."""
    assert ug_per_ml_to_um(1000.0 / 1000.0, 151.16) == pytest.approx(
        ug_per_ml_to_um(1.0, 151.16)
    )


def test_unbound_is_total_times_free_fraction():
    assert unbound_from(10.0, 0.01) == pytest.approx(0.1)
    assert unbound_from(10.0, 1.0) == pytest.approx(10.0)


def test_unbound_is_none_without_a_free_fraction():
    """Silence, not a guess. An assumed fu of 1.0 would overstate unbound exposure
    by up to 100x for a highly bound drug and understate every margin with it."""
    assert unbound_from(10.0, None) is None


def test_unbound_rejects_an_out_of_range_free_fraction():
    with pytest.raises(ValueError):
        unbound_from(10.0, 1.5)
    with pytest.raises(ValueError):
        unbound_from(10.0, -0.1)
```

Create `data/prep/tests/test_cmax_join.py`:

```python
"""cmax.json is what assemble_evidence.py joins against. Guard its invariants."""
import json
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / "data" / "out"

FLOOR = 300


def load():
    p = OUT / "cmax.json"
    assert p.exists(), "Run data/prep/cmax_ingest.py first"
    return json.loads(p.read_text())


def test_every_key_is_an_inchikey_present_in_the_benchmark():
    """A join on the wrong column produces entries keyed by drug NAME, which looks
    fine in isolation and matches zero compounds downstream."""
    cmax = load()
    known = {
        c["compoundId"]
        for c in json.loads((OUT / "compounds.json").read_text())["compounds"]
    }
    orphans = [k for k in cmax["entries"] if k not in known]
    assert not orphans, f"{len(orphans)} entries key nothing in the corpus: {orphans[:5]}"


def test_the_join_cleared_its_floor():
    cmax = load()
    assert cmax["nCompounds"] >= FLOOR, (
        f"only {cmax['nCompounds']} compounds resolved to a Cmax, below the {FLOOR} "
        "floor. A structure join that quietly matches nothing is the failure that "
        "emptied the Tox21 stream once already."
    )


def test_unbound_is_never_greater_than_total():
    for key, e in load()["entries"].items():
        if e["cmaxUnboundUM"] is None:
            continue
        assert e["cmaxUnboundUM"] <= e["cmaxTotalUM"] + 1e-9, (
            f"{key}: unbound {e['cmaxUnboundUM']} exceeds total {e['cmaxTotalUM']}"
        )


def test_every_cmax_is_strictly_positive():
    """A zero would produce an infinite margin and mark the compound
    exposure-relevant regardless of what the assay actually tested."""
    for key, e in load()["entries"].items():
        assert e["cmaxTotalUM"] > 0, f"{key}: non-positive total Cmax"
        if e["cmaxUnboundUM"] is not None:
            assert e["cmaxUnboundUM"] > 0, f"{key}: non-positive unbound Cmax"


def test_the_source_is_pinned():
    """A re-run that silently resolves a different table version must be visible
    as a diff, the way stream-tox21.json pins its resolved AIDs."""
    cmax = load()
    assert cmax["source"], "source is unpinned"
    assert cmax["sourceRetrieved"], "retrieval date is unpinned"
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `cd data/prep && $PY -m pytest tests/test_cmax_units.py tests/test_cmax_join.py -v`
Expected: `test_cmax_units.py` FAILS with `ModuleNotFoundError: No module named 'cmax_ingest'`; `test_cmax_join.py` FAILS on the `assert p.exists()` message "Run data/prep/cmax_ingest.py first".

- [ ] **Step 3: Write the implementation**

Create `data/prep/cmax_ingest.py`:

```python
"""Curated clinical Cmax -> data/out/cmax.json, keyed by InChIKey.

WHY NOT openFDA. It was the obvious candidate and it does not work here. Cmax
appears in SPL labels only as free prose inside clinical_pharmacology sections,
in mixed units, with no ontology linkage - so every value would be extracted from
a sentence. Decisively, labels report TOTAL Cmax, and an in-vitro assay doses
nominal media concentration: comparing the two ignores protein binding and
overstates the achieved margin by up to two orders of magnitude for a highly
bound drug. An openFDA-only pipeline cannot compute a defensible margin at all.

The join is on InChIKey, the structure crosswalk used everywhere else in ARBITER.
Compounds with no Cmax get NO ENTRY - silence, not ambiguity, matching how
tox21_stream.py handles a missing readout.
"""
import json
import pathlib
import time

import pandas as pd
from rdkit import Chem
from rdkit.Chem import Descriptors

from dilirank_common import OUT

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "data" / "raw" / "cmax-source.csv"

# Pinned so a re-run that silently resolves a different table version shows up as
# a diff, the way stream-tox21.json pins its resolved AIDs.
SOURCE_NAME = "DILI-Predictor curated human Cmax (derived from the Lombardo human PK compilation)"
SOURCE_URL = "https://srijitseal.com/DILI_Predictor/datasets.html"

# A tripwire for a broken join, NOT a target. Set from the source's stated size
# (~730 drugs with total Cmax) against a DILIrank overlap that cannot reasonably
# fall below roughly half the smaller figure. The realised count is recorded and
# reported - this clearing is not evidence that coverage is good.
FLOOR = 300


def ug_per_ml_to_um(ug_per_ml: float, mw: float) -> float:
    """ug/mL -> uM. ug/mL is mg/L, so dividing by g/mol gives mmol/L; x1000 -> uM."""
    return (ug_per_ml / mw) * 1000.0


def unbound_from(total_um: float, fraction_unbound: float | None) -> float | None:
    """Unbound Cmax, or None where the free fraction is unknown.

    None rather than an assumed fu of 1.0, deliberately. Assuming a drug is
    entirely unbound overstates unbound exposure by up to 100x for a highly bound
    drug, which UNDERSTATES its margin and suppresses exposure relevance - a
    quiet, systematic bias in the direction that looks conservative.
    """
    if fraction_unbound is None:
        return None
    if not 0 < fraction_unbound <= 1:
        raise ValueError(f"fraction_unbound must be in (0, 1], got {fraction_unbound}")
    return total_um * fraction_unbound


def mw_of(smiles: str) -> float | None:
    m = Chem.MolFromSmiles(smiles)
    return None if m is None else Descriptors.MolWt(m)


def main() -> None:
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    by_key = {c["compoundId"]: c for c in compounds}

    if not SRC.exists():
        raise SystemExit(
            f"{SRC} not found. Download the curated Cmax table by hand - see "
            "data/prep/README.md. Not scripted, for the same reason DILIrank is "
            "not: a URL that returns an HTML error page as a 'spreadsheet' is a "
            "worse failure than asking a human to click once."
        )

    df = pd.read_csv(SRC)
    entries: dict[str, dict] = {}
    for row in df.itertuples():
        key = getattr(row, "inchikey", None)
        if key not in by_key:
            continue
        total_um = float(row.cmax_um)
        if total_um <= 0:
            continue
        fu = None if pd.isna(row.fraction_unbound) else float(row.fraction_unbound)
        entries[key] = {
            "cmaxTotalUM": round(total_um, 6),
            "cmaxUnboundUM": (
                None if unbound_from(total_um, fu) is None
                else round(unbound_from(total_um, fu), 8)
            ),
            "fractionUnbound": fu,
        }

    n_unbound = sum(1 for e in entries.values() if e["cmaxUnboundUM"] is not None)
    print(f"Resolved {len(entries)} of {len(compounds)} compounds ({n_unbound} with unbound)")

    if len(entries) < FLOOR:
        raise SystemExit(
            f"Only {len(entries)} compounds resolved to a Cmax, below the {FLOOR} "
            "floor. Check the join column - a structure join that quietly matches "
            "nothing is the failure that emptied the Tox21 stream once already."
        )

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "cmax.json").write_text(json.dumps({
        "generatedAt": time.strftime("%Y-%m-%d"),
        "source": SOURCE_NAME,
        "sourceUrl": SOURCE_URL,
        "sourceRetrieved": time.strftime("%Y-%m-%d"),
        "marginBasis": "unbound",
        "nCompounds": len(entries),
        "nWithUnbound": n_unbound,
        "entries": dict(sorted(entries.items())),
    }, indent=2))
    print(f"Wrote data/out/cmax.json ({len(entries)} entries, {n_unbound} with unbound Cmax)")


if __name__ == "__main__":
    main()
```

**If the source CSV's columns differ from `inchikey` / `cmax_um` / `fraction_unbound`, map them explicitly at the top of `main` and record the mapping in a comment.** Do not rename the source file's columns in place - the raw file stays as downloaded.

- [ ] **Step 4: Run the ingest, then the tests**

Run: `cd data/prep && $PY cmax_ingest.py`
Expected: prints a resolved count ≥ 300 and writes `data/out/cmax.json`.

Run: `cd data/prep && $PY -m pytest tests/test_cmax_units.py tests/test_cmax_join.py -v`
Expected: 9 passed.

**Record the realised overlap in the commit message.** The spec's §5 coverage figures are the source's stated sizes, not a measured join, and this is the step that replaces them with a fact.

- [ ] **Step 5: Commit and push**

```bash
git add data/prep/cmax_ingest.py data/prep/tests/test_cmax_units.py \
        data/prep/tests/test_cmax_join.py data/prep/README.md \
        data/raw/cmax-source.csv 'data/out/cmax.json'
git commit -m "Ingest curated clinical Cmax, joined on InChIKey

Resolved <N> of 890 compounds, <M> of them with a measured free fraction. Those
are measured counts - the spec quoted the source's stated sizes because no join
had been run.

Unbound rather than total, because an in-vitro assay doses nominal media
concentration while Cmax,total is predominantly protein-bound. A missing free
fraction yields None, never an assumed fu of 1.0: assuming a drug is entirely
unbound overstates unbound exposure by up to 100x for a highly bound drug, which
understates its margin and suppresses exposure relevance - a quiet bias in the
direction that merely looks conservative.

openFDA was assessed and rejected. Cmax appears there only as SPL prose in mixed
units, and labels report total Cmax, so it cannot support a protein-binding
corrected margin at all.

The table and its retrieval date are pinned into cmax.json so a re-run that
resolves a different version is visible as a diff.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin ablation-spec
```

---

### Task 4: Tox21 concentration re-pull

The first task that touches the network. It reuses the AIDs **already pinned** in `stream-tox21.json` rather than re-running discovery - a re-discovery that silently selected different assays would change the evidence base while looking like a refresh.

**Files:**
- Create: `data/prep/tox21_concentrations.py`

**Interfaces:**
- Consumes: `data/out/stream-tox21.json`'s `resolvedAids` block; `data/out/cid-cache.json`.
- Produces: `data/out/tox21-concentrations.json` shaped `{ generatedAt, aidsUsed, nResolved, concentrations: { "<inchikey>:<stream>": { topTestedConcUM, ac50UM } } }`. Task 5 reads `concentrations`.

- [ ] **Step 1: Write the puller**

Create `data/prep/tox21_concentrations.py`:

```python
"""Top tested concentration per compound and stream, for the ALREADY-PINNED AIDs.

This is the half of the margin ratio the repo has never had. outcomes_for_aid in
tox21_stream.py reads PUBCHEM_ACTIVITY_OUTCOME and nothing else, so no
concentration exists anywhere in ARBITER and no margin was ever established for
any compound - which is why every Tox21 claim currently carries a hardcoded
exposureRelevant: False it cannot support.

REUSES THE PINNED AIDS rather than re-running discovery. A re-discovery that
silently selected different assays would change the evidence base while looking
like a refresh, and stream-tox21.json's claims would then describe assays that no
longer back them.

ADDITIVE ONLY: stream-tox21.json is not rewritten. It stays byte-identical and
auditable, and the change shows up in exactly one place (assemble_evidence.py).
"""
import json
import time

import requests

from dilirank_common import OUT

REST = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
CID_BATCH = 100
PAUSE = 0.25

# PubChem concentration column names, in the order they are preferred. Tox21 qHTS
# assays report a titration; different AIDs expose it under different headers, and
# a missing column must FAIL rather than fall back to the protocol's nominal 92 uM
# top concentration. A substituted constant presented as a measurement is a
# fabrication, and it would be invisible in the output.
CONC_COLUMNS = [
    "PUBCHEM_ACTIVITY_CONCENTRATION",
    "Activity_Concentration_uM",
    "Max_Concentration_uM",
]
AC50_COLUMNS = ["PUBCHEM_AC50_UM", "AC50_uM", "AC50"]


def _column(header: list[str], candidates: list[str]) -> int | None:
    for name in candidates:
        if name in header:
            return header.index(name)
    return None


def concentrations_for_aid(aid: int, cids: list[int]) -> tuple[dict[int, float], dict[int, float]]:
    """CID -> (top tested concentration uM, AC50 uM) for one assay."""
    top: dict[int, float] = {}
    ac50: dict[int, float] = {}
    saw_conc_column = False

    for i in range(0, len(cids), CID_BATCH):
        chunk = cids[i:i + CID_BATCH]
        r = requests.get(f"{REST}/assay/aid/{aid}/CSV",
                         params={"cid": ",".join(map(str, chunk))}, timeout=120)
        if not r.ok:
            time.sleep(PAUSE)
            continue
        lines = r.text.splitlines()
        if not lines:
            continue
        header = lines[0].split(",")
        i_cid = _column(header, ["PUBCHEM_CID"])
        i_conc = _column(header, CONC_COLUMNS)
        i_ac50 = _column(header, AC50_COLUMNS)
        if i_cid is None or i_conc is None:
            time.sleep(PAUSE)
            continue
        saw_conc_column = True

        for line in lines[1:]:
            parts = line.split(",")
            if len(parts) <= max(i_cid, i_conc):
                continue
            raw_cid = parts[i_cid].strip()
            if not raw_cid.isdigit():
                continue
            cid = int(raw_cid)
            try:
                conc = float(parts[i_conc].strip())
            except ValueError:
                continue
            if conc > 0:
                top[cid] = max(top.get(cid, 0.0), conc)
            if i_ac50 is not None and len(parts) > i_ac50:
                try:
                    ac50[cid] = float(parts[i_ac50].strip())
                except ValueError:
                    pass
        time.sleep(PAUSE)

    if not saw_conc_column:
        raise SystemExit(
            f"AID {aid} returned no recognisable concentration column. Tried "
            f"{CONC_COLUMNS}. Fix the column list rather than defaulting to the "
            "Tox21 nominal 92 uM top concentration - a substituted constant "
            "reported as a measurement is a fabrication and would be invisible."
        )
    return top, ac50


def main() -> None:
    stream_doc = json.loads((OUT / "stream-tox21.json").read_text())
    cid_of = json.loads((OUT / "cid-cache.json").read_text())
    cid_to_key = {int(v): k for k, v in cid_of.items()}
    all_cids = sorted(cid_to_key)

    out: dict[str, dict] = {}
    aids_used: dict[str, list[int]] = {}

    for stream, aid_map in stream_doc["resolvedAids"].items():
        aids = sorted(int(a) for a in aid_map)
        aids_used[stream] = aids
        merged_top: dict[int, float] = {}
        merged_ac50: dict[int, float] = {}
        for aid in aids:
            print(f"  pulling concentrations for AID {aid} ({stream})...", flush=True)
            top, ac50 = concentrations_for_aid(aid, all_cids)
            for cid, v in top.items():
                merged_top[cid] = max(merged_top.get(cid, 0.0), v)
            for cid, v in ac50.items():
                merged_ac50.setdefault(cid, v)

        for cid, conc in sorted(merged_top.items()):
            out[f"{cid_to_key[cid]}:{stream}"] = {
                "topTestedConcUM": round(conc, 6),
                "ac50UM": (
                    None if cid not in merged_ac50 else round(merged_ac50[cid], 6)
                ),
            }
        print(f"{stream}: {sum(1 for k in out if k.endswith(':' + stream))} concentrations")

    if not out:
        raise SystemExit(
            "No concentrations resolved for any compound. The margin cannot be "
            "computed and exposureRelevant would be null for the entire corpus."
        )

    (OUT / "tox21-concentrations.json").write_text(json.dumps({
        "generatedAt": time.strftime("%Y-%m-%d"),
        "note": "Concentrations for the AIDs already pinned in stream-tox21.json. "
                "stream-tox21.json is NOT regenerated by this script.",
        "aidsUsed": aids_used,
        "nResolved": len(out),
        "concentrations": dict(sorted(out.items())),
    }, indent=2))
    print(f"Wrote data/out/tox21-concentrations.json ({len(out)} entries)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it**

Run: `cd data/prep && $PY tox21_concentrations.py`
Expected: per-AID progress lines, a per-stream count, and `data/out/tox21-concentrations.json` written.

**If it exits with "no recognisable concentration column", read the actual CSV header before adding a name** - inspect one AID by hand with `curl "https://pubchem.ncbi.nlm.nih.gov/rest/pug/assay/aid/<AID>/CSV?cid=2244" | head -1` and add the real column name to `CONC_COLUMNS`. Do not work around it with a constant.

- [ ] **Step 3: Verify the frozen artifact did not move**

Run: `git diff --exit-code data/out/stream-tox21.json`
Expected: exit 0, no output. **If this fails, the script rewrote a frozen artifact - stop and fix it.**

- [ ] **Step 4: Commit and push**

```bash
git add data/prep/tox21_concentrations.py data/out/tox21-concentrations.json
git commit -m "Pull Tox21 tested concentrations for the already-pinned AIDs

The half of the margin ratio ARBITER has never had. outcomes_for_aid reads
PUBCHEM_ACTIVITY_OUTCOME and nothing else, so no concentration existed anywhere
in the repo and no margin was ever established for any compound.

Reuses the AIDs pinned in stream-tox21.json rather than re-running discovery: a
re-discovery that silently selected different assays would change the evidence
base while looking like a refresh. The pull is additive and stream-tox21.json is
byte-identical, verified with git diff --exit-code.

A missing concentration column exits non-zero rather than falling back to the
Tox21 nominal 92 uM top concentration. A substituted constant reported as a
measurement is a fabrication and would be invisible in the output.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin ablation-spec
```

---

### Task 5: The join - the only site that decides `exposureRelevant`

**Files:**
- Modify: `data/prep/tox21_stream.py:275`
- Modify: `data/prep/assemble_evidence.py`
- Test: `data/prep/tests/test_evidence_assembly.py` (append)

**Interfaces:**
- Consumes: `exposure_relevant` from Task 2; `entries` from Task 3's `cmax.json`; `concentrations` from Task 4's `tox21-concentrations.json`; `marginFactor` from Task 1's policy file.
- Produces: `evidence.json` with a new `exposureResolution` block: `{ true: int, false: int, null: int, marginFactor: int, policyVersion: string }`.

- [ ] **Step 1: Make the §3 correction**

In `data/prep/tox21_stream.py`, line 275:

```python
                # NOT False. False means "we established the margin and it was
                # inadequate"; this script establishes nothing - it reads
                # PUBCHEM_ACTIVITY_OUTCOME and never sees a concentration. null is
                # "never established", which is the truthful value at this point in
                # the pipeline. assemble_evidence.py resolves it against the
                # measured margin. See the design spec section 3.
                "exposureRelevant": None,
```

- [ ] **Step 2: Write the failing test**

Append to `data/prep/tests/test_evidence_assembly.py`:

```python
def test_exposure_relevance_is_resolved_three_ways():
    """All three values must be earned. Before this change every Tox21 claim
    carried a hardcoded False asserting a margin nobody measured."""
    e = load()
    assert "exposureResolution" in e, "run assemble_evidence.py after the Cmax ingest"
    r = e["exposureResolution"]
    assert r["marginFactor"] == 100, "margin factor must come from the registered policy"
    assert r["true"] + r["false"] + r["null"] > 0


def test_no_qsar_claim_is_ever_exposure_relevant():
    """A structural model has no exposure axis. If one of these is True the join
    is keyed wrongly and is matching across streams."""
    for c in load()["claims"]:
        if c["stream"] == "qsar":
            assert c["exposureRelevant"] is None, (
                f"{c['id']}: a QSAR claim cannot carry exposure relevance"
            )


def test_an_exposure_relevant_claim_has_a_margin_recorded():
    """The HANDOVER 3.1 prohibition, enforced on the corpus: the flag may not be
    set without a computed margin standing behind it."""
    for c in load()["claims"]:
        if c["exposureRelevant"] is True:
            assert c.get("exposureMargin") is not None, (
                f"{c['id']}: exposureRelevant true with no margin recorded"
            )
            assert c["exposureMargin"] >= 100, (
                f"{c['id']}: margin {c['exposureMargin']} is below the registered 100x"
            )
```

Run: `cd data/prep && $PY -m pytest tests/test_evidence_assembly.py -v`
Expected: the three new tests FAIL - `exposureResolution` is absent.

- [ ] **Step 3: Write the join**

In `data/prep/assemble_evidence.py`, add the imports and constants at the top:

```python
RULES = ROOT / "rules"


def _load_optional(name: str) -> dict:
    p = OUT / name
    if not p.exists():
        print(f"  (missing {name} - exposure relevance will be null throughout)")
        return {}
    return json.loads(p.read_text())
```

Then insert this after `claims.sort(...)` and before the duplicate-id check:

```python
    # THE ONLY SITE THAT DECIDES exposureRelevant.
    #
    # Kept in one place deliberately: the streams emit null because they measure
    # no concentration, and the margin is the join of two artifacts neither stream
    # can see. Two sites deciding one field is how the two drift apart.
    policy = json.loads((RULES / "exposure-policy-v1.0.json").read_text())
    factor = policy["marginFactor"]
    cmax = _load_optional("cmax.json").get("entries", {})
    conc = _load_optional("tox21-concentrations.json").get("concentrations", {})

    resolution = {"true": 0, "false": 0, "null": 0}
    for c in claims:
        if c["stream"] not in policy["appliesToStreams"]:
            continue
        entry = cmax.get(c["compoundId"], {})
        cmax_unbound = entry.get("cmaxUnboundUM")
        top_tested = conc.get(f"{c['compoundId']}:{c['stream']}", {}).get("topTestedConcUM")

        m = margin(top_tested, cmax_unbound)
        resolved = exposure_relevant(top_tested, cmax_unbound, factor)
        c["exposureRelevant"] = resolved
        c["exposureMargin"] = None if m is None else round(m, 3)
        # Explicit mapping, NOT str(resolved).lower(): that yields "none" for None
        # while the counter's key is "null", so every unresolved claim would raise
        # a KeyError - or, with a defaultdict, be counted under a fourth key nobody
        # reads and silently vanish from the reported total.
        resolution[{True: "true", False: "false", None: "null"}[resolved]] += 1

    print(f"exposure relevance: {resolution} at {factor}x unbound Cmax")
```

Add to the imports at the top of the file:

```python
from exposure_margin import exposure_relevant, margin
```

And add to the `evidence.json` payload, beside `provenanceCounts`:

```python
        "exposureResolution": {
            **resolution,
            "marginFactor": factor,
            "policyVersion": policy["version"],
        },
```

- [ ] **Step 4: Regenerate and test**

Run: `cd data/prep && $PY assemble_evidence.py`
Expected: prints `exposure relevance: {'true': N, 'false': M, 'null': K} at 100x unbound Cmax`.

Run: `cd data/prep && $PY -m pytest -v`
Expected: all tests pass - the original 32 plus the new ones.

Run: `git diff --exit-code data/out/stream-tox21.json data/out/compounds.json data/out/splits.json`
Expected: exit 0. **The frozen artifacts must not have moved.**

Run: `npm run validate:evidence`
Expected: passes.

**`exposureMargin` is deliberately NOT added to `EvidenceClaimSchema`.** Verified on zod 3.25.76: `EvidenceClaimSchema` is a plain `z.object()` with no `.strict()`, and zod strips unknown keys rather than rejecting them - so the field passes validation and is simply absent on the TypeScript side. That is the intended outcome. It exists as an audit record inside `evidence.json`, read by the Python test that enforces the HANDOVER §3.1 prohibition ("no flag without a margin standing behind it"); nothing in TypeScript consumes it. Modifying `packages/engine/src` to type a field no TypeScript code reads would breach a Global Constraint to no benefit.

- [ ] **Step 5: Commit and push**

```bash
git add data/prep/tox21_stream.py data/prep/assemble_evidence.py \
        data/prep/tests/test_evidence_assembly.py data/out/evidence.json
git commit -m "Resolve exposure relevance from a measured margin, in one place

tox21_stream.py hardcoded exposureRelevant False on every Tox21 claim with the
comment 'HTS concentrations are not clinical exposure'. It establishes nothing -
it reads PUBCHEM_ACTIVITY_OUTCOME and never sees a concentration - so the corpus
was asserting knowledge it did not have. false means 'established and
inadequate'; null means 'never established'. It now emits null, and
assemble_evidence.py resolves it against the real margin.

No verdict was wrong: relevanceDiscount reads exposureRelevant !== true, so both
falsy values behave identically. The TRACE was wrong, printing 'a negative result
from testing outside the clinically relevant exposure range' to a toxicologist
about a margin nobody measured.

One decision site, deliberately. The streams cannot see the margin, which joins
two artifacts neither of them reads.

exposure relevance: <counts> at 100x unbound Cmax.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin ablation-spec
```

---

### Task 6: The `single:cmax-threshold` baseline

Cmax alone separates most-DILI from no-DILI at roughly 80/73% on the LTKB benchmark. The moment Cmax enters the pipeline, "is your improvement just a Cmax threshold in a costume?" becomes a fair question, and without this baseline it is unfalsifiable.

**Files:**
- Modify: `apps/harness/src/baselines.ts` (append after `bestSingleSource`, line 70)
- Modify: `apps/harness/src/main.ts:29`
- Test: `apps/harness/test/baselines.test.ts` (append)

**Interfaces:**
- Consumes: `Prediction`, `ABSTAIN` - both already in `baselines.ts`.
- Produces: `cmaxThreshold(cmaxTotalUM: number | null): Prediction`, wired as `single:cmax-threshold`.

- [ ] **Step 1: Write the failing test**

Append to `apps/harness/test/baselines.test.ts`:

```ts
describe("cmaxThreshold baseline", () => {
  it("calls a drug above 1.1 uM total Cmax do_not_advance", () => {
    expect(cmaxThreshold(2.0).verdict).toBe("do_not_advance");
  });

  it("calls a drug below 1.1 uM advance", () => {
    expect(cmaxThreshold(0.5).verdict).toBe("advance");
  });

  // The boundary, asserted in both directions so a > / >= slip fails here.
  it("treats exactly 1.1 uM as above the threshold", () => {
    expect(cmaxThreshold(1.1).verdict).toBe("do_not_advance");
    expect(cmaxThreshold(1.0999).verdict).toBe("advance");
  });

  it("abstains where no Cmax is known", () => {
    expect(cmaxThreshold(null).verdict).toBe("abstain");
    expect(cmaxThreshold(null).score).toBe(0.5);
  });
});
```

Run: `npx vitest run apps/harness/test/baselines.test.ts`
Expected: FAIL - `cmaxThreshold is not defined`.

- [ ] **Step 2: Implement**

Append to `apps/harness/src/baselines.ts`:

```ts
/**
 * Baseline 4: the clinical Cmax threshold alone.
 *
 * Published work on the LTKB benchmark found Cmax,total >= 1.1 uM separates
 * most-DILI from no-DILI drugs at roughly 80% sensitivity and 73% specificity. So
 * once Cmax enters the pipeline, one question becomes fair and this baseline is
 * the only thing that can answer it:
 *
 *   "Is your improvement just a Cmax threshold in a costume?"
 *
 * Reported in the same table as the others. If ARBITER does not beat it, the
 * results section says so in its first sentence - the same discipline already
 * applied to the single:transporter tie.
 *
 * Reads NO claims: the whole point is that it consults nothing but exposure. A
 * compound with no known Cmax abstains rather than defaulting to a side.
 */
export const CMAX_DILI_THRESHOLD_UM = 1.1;

export function cmaxThreshold(cmaxTotalUM: number | null): Prediction {
  if (cmaxTotalUM === null) return ABSTAIN;
  return cmaxTotalUM >= CMAX_DILI_THRESHOLD_UM
    ? { verdict: "do_not_advance", score: 1 }
    : { verdict: "advance", score: 0 };
}
```

Add the import to the test file's existing import line.

- [ ] **Step 3: Run the test**

Run: `npx vitest run apps/harness/test/baselines.test.ts`
Expected: PASS. Then flip `>=` to `>` and confirm the boundary test fails. Revert.

- [ ] **Step 4: Wire it into the harness**

In `apps/harness/src/main.ts`, after line 29:

```ts
    baselines["single:cmax-threshold"] = cmaxThreshold(cmaxById.get(id) ?? null);
```

Load the map once near the top of the same function, beside the other reads:

```ts
const cmaxDoc = JSON.parse(readFileSync("data/out/cmax.json", "utf8")) as {
  entries: Record<string, { cmaxTotalUM: number }>;
};
const cmaxById = new Map(
  Object.entries(cmaxDoc.entries).map(([k, v]) => [k, v.cmaxTotalUM]),
);
```

**`main.ts:1` currently imports only `mkdirSync, writeFileSync` from `node:fs`** - add `readFileSync`, or the file will not compile:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
```

Add `cmaxThreshold` to the `./baselines.js` import on line 3, which currently reads
`import { ALL_STREAMS, bestSingleSource, majorityVote, weightedAverage, type Prediction } from "./baselines.js";`

- [ ] **Step 5: Commit and push**

```bash
git add apps/harness/src/baselines.ts apps/harness/src/main.ts \
        apps/harness/test/baselines.test.ts
git commit -m "Add the single:cmax-threshold baseline

Cmax,total >= 1.1 uM separates most-DILI from no-DILI on the LTKB benchmark at
roughly 80/73%. Once Cmax enters the pipeline, 'is your improvement just a Cmax
threshold in a costume' is a fair question, and without this baseline it is
unfalsifiable.

Consults no claims at all - that is the point. A compound with no known Cmax
abstains rather than defaulting to a side. The 1.1 uM boundary is asserted in
both directions.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin ablation-spec
```

---

### Task 7: Re-run, and record what moved BEFORE interpreting it

The only task that moves a reported number. Recording precedes interpretation deliberately - the spec's §10.1 prediction is worth nothing if the numbers are read first and the prediction reconciled afterwards.

**Files:**
- Modify: `results/metrics.json`, `results/results.json`, `results/verdict-manifest.json`, `results/golden/metrics.golden.json` (all regenerated, none hand-edited)

- [ ] **Step 1: Capture the before state**

```bash
cp results/metrics.json /tmp/metrics-before.json
git rev-parse HEAD
```

- [ ] **Step 2: Re-run the pipeline**

Run: `npm run harness && npm run metrics && npm run coverage:report`
Expected: completes without the ruleset OR exposure-policy hash error.

- [ ] **Step 3: Record the deltas, without interpreting them yet**

```bash
python - <<'EOF'
import json
a = json.load(open('/tmp/metrics-before.json'))
b = json.load(open('results/metrics.json'))
m = 'metric1_conflictSubsetAccuracy'
print(f"{'pipeline':28} {'bal acc':>9} {'coverage':>9}   (before -> after)")
for k in sorted(set(a[m]['baselines']) | set(b[m]['baselines']) | {'arbiter'}):
    ga = a[m].get(k) or a[m]['baselines'].get(k, {})
    gb = b[m].get(k) or b[m]['baselines'].get(k, {})
    print(f"{k:28} {ga.get('balancedAccuracy')} -> {gb.get('balancedAccuracy')}   "
          f"{ga.get('coverage')} -> {gb.get('coverage')}")
print()
print("nStructurallyForced:",
      a['metric4_abstentionQuality']['nStructurallyForced'], "->",
      b['metric4_abstentionQuality']['nStructurallyForced'])
EOF
```

**Write the output into the commit message verbatim.** Do not retype a number.

- [ ] **Step 4: Update the golden file**

Run: `npm run golden:update && git diff --stat results/`
Expected: a diff. This is intended - see the spec's §10.

**On Windows the golden file may look modified when it is not** (HANDOVER §0): the script writes LF and `autocrlf` rewrites to CRLF. Distinguish a real change from a phantom before believing it:

```bash
git show HEAD:results/golden/metrics.golden.json | sha256sum
sha256sum results/golden/metrics.golden.json   # identical => nothing moved
```

- [ ] **Step 5: Run everything**

Run: `npm run lint && npm run typecheck && npm test && npm run web:build && npm run e2e`
Expected: all green. Also `cd data/prep && $PY -m pytest` - these do not run in CI (HANDOVER §3.5d).

- [ ] **Step 6: Commit and push**

```bash
git add results/
git commit -m "Re-run on the measured exposure axis

<paste the delta table from Step 3 verbatim>

Recorded before interpretation, deliberately. The prediction in the design spec
section 10.1 is worth nothing if the numbers are read first and the prediction
reconciled afterwards.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin ablation-spec
```

---

### Task 8: Rewrite HANDOVER §2 and §3.1 from the new numbers

**Files:**
- Modify: `HANDOVER.md` §2, §3.1, and the §3 work-item table

- [ ] **Step 1: Confirm the existing exposure-gate tests still hold**

**An earlier draft of this task added tests to `apps/web/test/load.test.ts`, claiming the `load.ts:47` corpus exemption "has never been tested". Both halves were wrong.** That file does not exist, and `apps/web/test/exposureGate.test.ts` already covers the gate in six tests - including, at lines 55-58, an isolation of the exact `source !== "fixture"` clause the draft claimed was uncovered, with a comment explaining why the sibling test cannot isolate it. Writing near-duplicate tests in a second file would give a future change to the gate two places to update.

So this step **verifies rather than adds.** After Task 5, corpus claims genuinely carry `exposureRelevant: true` for the first time - which is precisely the condition tests 4 and 5 assert is exempt, so they should hold unchanged:

Run: `npx vitest run apps/web/test/exposureGate.test.ts`
Expected: 6 passed. **If the last test fails, TAK-994's murine claim has been disturbed by the pipeline change - stop and investigate rather than editing the test.**

- [ ] **Step 2: Rewrite HANDOVER §2**

Pull every number from `results/metrics.json`. **Never retype one.** §2's existing structure is right; what changes is the content:

- The three-causes table: cause 1 is now *resolved* rather than outstanding. Say what replaced it.
- The stream-coverage table is unchanged (no compounds were added).
- Add `single:cmax-threshold` to the pipeline comparison table.
- If accuracy fell, say so in §2's first sentence and give the §10.1 reading: acute HepG2 cytotoxicity is a poor instrument for idiosyncratic DILI, and R3's blanket discount was compensating for that. Link the prediction's commit so it is visibly prior.
- Update the §3.7 Q&A answer on abstention - `nStructurallyForced` has moved.

- [ ] **Step 3: Rewrite HANDOVER §3.1 and the §3 table**

§3.1 is titled "BLOCKING AND TIME-CRITICAL - the Cmax hunt (before 2 Aug)" and is now done. Replace it with what was built, what it measured, and what remains. Mark row 1 of the §3 work-item table complete. Add a §13 recording this work in the style of §10 and §11.

- [ ] **Step 4: Verify every command in the touched sections**

HANDOVER §0 promises every command in it was executed. Re-run the block and update the counts:

```bash
npm run lint && npm run typecheck && npm test
npm run web:build && npm run e2e
cd data/prep && $PY -m pytest
```

- [ ] **Step 5: Commit and push**

```bash
git add HANDOVER.md
git commit -m "Rewrite HANDOVER 2 and 3.1 on the measured exposure axis

3.1 was the item ranked first and time-critical and had never been started. It
is done: the numbers in 2 now come from a measured margin rather than from a
hardcoded assumption, and cause 1 of the abstention is resolved rather than
outstanding.

Also closes the load.ts:46 test gap in both directions. The corpus exemption at
line 47 exists specifically for this pipeline and had never been tested -
inverting the guard left the whole suite green.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push origin ablation-spec
```

---

## Rollback

Every task is a single commit and no task rewrites a frozen artifact, so `git revert` of any one is clean. The exception is Task 7, which regenerates `results/`: revert Task 7 and re-run `npm run harness && npm run metrics && npm run golden:update` to restore consistency between the metrics and the golden file, rather than reverting the golden file alone.
