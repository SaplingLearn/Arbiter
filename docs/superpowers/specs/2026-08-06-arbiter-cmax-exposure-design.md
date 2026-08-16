# ARBITER - the clinical Cmax exposure axis (R3)

> **STILL RELEVANT, but read it with the 2026-08-09 redesign.**
>
> The rules are **kept**: §2 of `2026-08-09-arbiter-ai-redesign-design.md` retains
> R1-R6 as required disclosure because "they were never the defect. Being the *sole
> decider* over six data fields was."
>
> Two things changed underneath this document. The rules no longer decide by
> themselves - the adjudicator in `services/api` does, and discloses a position per
> rule. And the rulebook now grows and versions (§5) rather than being six fixed
> rules, so a new evidence axis lands as a versioned ruleset entry rather than as
> another rule wired into `apps/web`. `rules/ruleset-v1.0.json` is never edited.

**Date:** 6 August 2026 · **Submission due:** 16 August 2026 · **Data freeze:** 2 August 2026 (passed)

Companion to `2026-07-26-arbiter-design.md` (the master spec, §5 R3 and §8 the honest results
section). This is HANDOVER §3.1 - the item that document ranks **first and time-critical**, and the
only one on its list that was never started.

HANDOVER §3.1 frames the work as a coverage fix: find a Cmax source, R3 stops firing
unconditionally, the headline becomes reportable. **This spec accepts the work and rejects that
framing.** Measured below, the most likely outcome of doing it correctly is that reported accuracy
*falls*, because R3's blanket discount has been silently compensating for a stream that does not
measure the endpoint. That is a better result than a coverage bump, but only if it is written down
before the run rather than explained after it.

---

## 1. Scope

**In scope.** A curated clinical Cmax ingest; a concentration re-pull for the Tox21 assay IDs already
pinned in `stream-tox21.json`; a pre-registered exposure-margin policy with its own hash; the join
that decides `exposureRelevant` in `assemble_evidence.py`; one new harness baseline; and the metrics
and disclosures that go with them.

**Out of scope.** Any change to `rules/ruleset-v1.0.json`. Any change to `packages/engine`. Any
change to the benchmark compound set, the three-way split, or the QSAR model. The Intake tab.

**Neither purity nor the split is at risk.** All new code is Python under `data/prep/` plus one
baseline in `apps/harness/`, both of which are allowed I/O. The engine is not modified, and
`data/out/splits.json` is not regenerated, so `test_qsar_leakage.py`'s guarantee - that the split was
fixed before any model was fitted - is untouched.

---

## 2. The measurement this is built on

Run on `data/out/evidence.json` at `0da8665`, test split only (267 compounds, 398 claims).

R3 discounts **161** claims in the scored split:

| stream | claims R3 discounts | rescuable? |
|---|---|---|
| cytotox | **118** | yes - an HTS assay has a concentration axis |
| qsar | 43 | **never** - a structural model has no exposure axis |

The 118 confirm HANDOVER §2's "cause 1 accounts for 118 of the 225 discounted claims" independently,
from `relevanceDiscount`'s own predicate rather than from prose.

**109 of the 118 sit at strength 0.9** (a unanimous inactive readout). Each contributes
`0.9 × (1 − 0.85) = 0.135` of committed mass today against a bar of 0.5. Undiscounted it is `0.9`,
which alone produces belief 0.9, plausibility 1.0, gap 0.1 - a commit with room to spare.

### 2.1 And that is exactly why the naive version is a trap

Those 118 cytotox claims say "safe". The compounds they sit on are mostly not:

| the cytotox stream calls it safe | true DILIrank label |
|---|---|
| 118 compounds | **88 have DILI concern**, 30 do not |

Sharper still, restricted to genuine cross-stream disagreement:

| | compounds | true label y=1 | y=0 |
|---|---|---|---|
| cytotox says safe **and** QSAR says toxic | **60** | **54** | 6 |

In those 60, the discounted stream is the *wrong* one. QSAR is right on 54 of 60 and reaches fusion
at roughly 6% of stated confidence (R2 × R5); cytotox is wrong and, once R3 stops firing, reaches it
at 100%. The remaining 45 cytotox-safe compounds have an *ambiguous* QSAR claim, which commits no
mass at all - so nothing opposes them whatsoever.

**Setting `exposureRelevant: true` without measuring a margin would therefore manufacture on the
order of 118 confident `advance` verdicts on drugs that are 75% hepatotoxic.** This is the shortcut
HANDOVER §3.1 lists as forbidden, and this is the number that makes it forbidden.

---

## 3. The correction this makes, independent of any number it moves

`data/prep/tox21_stream.py:275` writes `"exposureRelevant": False` on every Tox21 claim, with the
comment *"HTS concentrations are not clinical exposure"*.

In R3's vocabulary - and `packages/engine/src/types.ts:51` is explicit that the field is
`boolean | null` for this reason - the two falsy values mean different things:

- `false` = **we established the margin and it was inadequate.**
- `null` = **the margin was never established at all.**

No concentration is fetched anywhere in the repo. `outcomes_for_aid` reads
`PUBCHEM_ACTIVITY_OUTCOME` and nothing else, so no margin was ever established for any compound.
**The corpus is currently asserting knowledge it does not have**, and `null` is today's honest value.

`relevanceDiscount` treats `false` and `null` identically (`exposureRelevant !== true`), so **no
verdict is wrong because of this** - but the trace prints a different rationale for each, and today
every Tox21 compound gets *"a negative result from testing outside the clinically relevant exposure
range"* when the truthful sentence is *"whose exposure margin was never established"*. A toxicologist
reading the trace is being told a fact nobody checked.

Making all three values earned is the deliverable, independent of which way coverage moves:

| value | meaning | today | after |
|---|---|---|---|
| `true` | tested at ≥ 100× unbound Cmax, no signal | never set | measured |
| `false` | tested, margin inadequate | **asserted on all 131, unsupported** | measured |
| `null` | margin never established | never set | Cmax or concentration missing |

131 is every Tox21 claim in the scored split - 127 cytotox plus 4 transporter.

---

## 4. The pre-registered exposure policy

Choosing the margin factor after seeing which value flatters the headline is precisely what
pre-registration exists to prevent, and it is the same failure mode as tuning
`abstentionGapThreshold`. So the factor is registered, hashed, and committed **before the pipeline is
run for the first time.**

**New file: `rules/exposure-policy-v1.0.json`.**

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

`transporter` is listed for completeness and **has no effect today**: all 4 transporter claims in the
scored split assert `toxic`, and R3 discounts only `safe` claims. Listing it means a future
transporter negative is governed by a policy that already exists rather than by a decision made at
the time it appears.

**`rules/ruleset-v1.0.json` is not opened.** Its hash
`ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136` stays valid, R3's registered
statement and its strength of 0.85 are unchanged, and HANDOVER §1.1 is respected. This policy governs
how *data* is prepared for R3, not what R3 says - the same relationship `dilirankBinarisation`
already has to the label column.

The harness recomputes this file's hash and **refuses to run on a mismatch**, exactly as it already
does for the ruleset. `marginFactor` is not a knob to be tried at several values and reported at the
best one: the M-sensitivity curve is a **disclosure**, reported alongside the headline in the manner
of HANDOVER §2's gap-threshold table, never as the headline itself.

---

## 5. Why not openFDA, and why not the FDA's own table

HANDOVER §3.1 says only "a clinical Cmax source". Three were assessed:

| source | coverage of our 890 | unbound Cmax? | verdict |
|---|---|---|---|
| **openFDA drug label API** | unknown until tried | **no** | rejected |
| **FDA LTKB benchmark dataset** | 134 drugs, literature-collected | no | too thin |
| **Curated DILI Cmax tables** (DILI-Predictor / Seal et al., derived from the Lombardo human PK compilation) | ~730 total, ~500 unbound | **yes** | **selected** |

**The exact table and its retrieval date are pinned into `cmax.json`** the way `stream-tox21.json`
pins its resolved AIDs, so a re-run that silently resolves a different version is visible as a diff.
Step 3 of §11 confirms the realised overlap with our 890 before anything downstream is built on it -
the coverage figures above are the source's stated sizes, not a measured join.

**openFDA was the obvious candidate and does not work here.** Cmax appears only as free prose inside
SPL `clinical_pharmacology` sections, in mixed units, with no ontology linkage - so every value would
be regex- or model-extracted from a sentence. That is the silent-wrong-number failure this repo has
already been bitten by twice (§6.4: the renamed PubChem SMILES property and the non-existent Tox21
endpoint, both of which returned success while producing nothing). Decisively, **SPL labels report
total Cmax**, so an openFDA-only pipeline cannot compute a protein-binding-corrected margin at all
and every margin it produced would run optimistic by up to 100×.

The selected source is joined on **InChIKey**, the structure crosswalk used everywhere else in the
project, and badges `provenance.kind: "literature"` rather than `"database"` - the honest label, and
a visible difference from the Tox21 claims it attaches to.

---

## 6. Artifacts and data flow

Five new files - one policy, two scripts, two outputs. **No existing data artifact is regenerated.**

```
compounds.json ─┬─→ cmax_ingest.py ───────────→ cmax.json ─────────┐
                └─→ tox21_concentrations.py ──→ tox21-conc.json ───┤
stream-tox21.json  (frozen; supplies the pinned AIDs) ─────────────┤
exposure-policy-v1.0.json  (hashed) ───────────────────────────────┤
                                                                    ▼
                                                         assemble_evidence.py
                                                                    │
                                     margin = topTestedConcUM / cmaxUnboundUM
                                     true if ≥ 100 · false if < 100 · null if either absent
                                                                    ▼
                                                            evidence.json
```

**`data/prep/cmax_ingest.py` → `data/out/cmax.json`.** Joins the curated table to `compounds.json` on
InChIKey. Emits `cmaxTotalUM`, `cmaxUnboundUM`, `fractionUnbound`, and provenance per compound.
Where the source reports mass concentration, conversion to µM uses RDKit molecular weight computed
from the SMILES already in `compounds.json` - the same structure the InChIKey was computed from, so
the weight and the identifier cannot disagree. **Compounds with no Cmax get no entry**: silence, not
ambiguity, matching how `tox21_stream.py` already handles a missing readout.

**`data/prep/tox21_concentrations.py` → `data/out/tox21-concentrations.json`.** Re-pulls the PubChem
assay CSVs for the AIDs **already pinned** in `stream-tox21.json`'s `resolvedAids` block, reading the
concentration columns this time. Per compound and stream: `topTestedConcUM`, and `ac50UM` where the
readout was active. Reusing the pinned AIDs rather than re-running discovery is deliberate - a
re-discovery that silently selected different assays would change the evidence base while looking
like a refresh.

**`stream-tox21.json` stays byte-identical.** The pull is purely additive, so the existing claims
remain a frozen, auditable artifact and the change shows up in exactly one place.

**`assemble_evidence.py`** gains the join and becomes the **only** site where `exposureRelevant` is
decided. `tox21_stream.py:275` changes from the hardcoded `False` to `None`, which is §3's correction
and is the honest value at the point in the pipeline where nothing about concentration is yet known.

QSAR claims are untouched and remain `null` permanently. A structural model has no exposure axis;
those 43 claims are cause 2, and no Cmax addresses them.

---

## 7. One new baseline, because the obvious attack deserves a measured answer

Published work on the LTKB benchmark found that **Cmax,total ≥ 1.1 µM alone** separates most-DILI
from no-DILI drugs at roughly 80% sensitivity and 73% specificity. Cmax is therefore a DILI predictor
in its own right, and the moment it enters the pipeline the question becomes fair:

> **"Is your improvement just a Cmax threshold in a costume?"**

`apps/harness` gains a `single:cmax-threshold` baseline implementing exactly that rule, reported in
the same table as `single:transporter` and the rest. If ARBITER does not beat it, the results section
says so in the first sentence - the same discipline HANDOVER §2 already applies to the
`single:transporter` tie.

This baseline is cheap and it is not optional. Without it the Cmax work is unfalsifiable.

---

## 8. Error handling - assert on counts

HANDOVER §6.4's pattern is that **a silent empty result looks exactly like a working pipeline**. Every
stage fails loudly rather than degrading:

- `cmax_ingest.py` exits non-zero if **fewer than 300 of the 890** compounds resolve to a Cmax. The
  floor is set from the source's own stated size (~730 drugs with total Cmax, ~500 with unbound)
  against a DILIrank overlap that cannot reasonably fall below roughly half of the smaller figure; it
  is a tripwire for a broken join, not a target. A structure join that quietly matches nothing is the
  exact failure that emptied the Tox21 stream once already. **The realised count is recorded in
  `cmax.json` and reported - the floor passing is not evidence that coverage is good.**
- `tox21_concentrations.py` exits non-zero if a pinned AID returns no recognisable concentration
  column. It must **not** silently fall back to the Tox21 protocol's nominal 92 µM top concentration -
  a substituted constant presented as a measurement is a fabrication, and it would be invisible.
- The margin computation rejects a zero, negative, or missing `cmaxUnboundUM` rather than producing
  an infinite margin that clears any factor.
- A compound whose margin is exactly `100.0` resolves to `true`; the boundary is `>=` and is tested.
- Hash mismatch on `exposure-policy-v1.0.json` → the harness refuses to run.
- `assemble_evidence.py` prints and records counts of each of the three resolved states, so a run
  that resolved nothing is visible in its own output rather than discovered in a metric.

---

## 9. Testing

Three new files beside the existing four in `data/prep/tests/`, run with `cd data/prep && python -m pytest`:

| test | what it protects |
|---|---|
| `test_cmax_join.py` | InChIKey join correctness; a non-matching table produces zero rows and a non-zero exit, not silence |
| `test_cmax_units.py` | ng/mL → µM against hand-worked values; unbound derived from `fractionUnbound` |
| `test_exposure_margin.py` | margin arithmetic, the exact-100× boundary in both directions, and null propagation when either input is absent |

That is three Python files, not four. **The policy hash check is not a Python test**: the
pre-registration surface lives in `apps/harness/src/preregistration.ts`, so the check belongs beside
the ruleset's and its test is a vitest one in `apps/harness` asserting that a mutated
`exposure-policy-v1.0.json` makes the harness refuse to run. Putting it in `data/prep/` would create
a second implementation of the hash surface, which HANDOVER §6.4 already records going wrong once.

On the web side, one test asserting **both directions** of the `load.ts:46` gate, per HANDOVER §5.1:
a *corpus* claim may carry `exposureRelevant: true` (the exemption at `load.ts:47` exists precisely
for this pipeline), while a *fixture* claim without a cited `FixtureExposure` still throws.

`packages/engine` is not modified, so its determinism and fusion tests are untouched and must
continue to pass unchanged.

These Python tests still do not run in CI (HANDOVER §3.5d). **Run them by hand after any change under
`data/prep/`.**

---

## 10. What this moves, stated before it is run

`results/golden/*` **will churn, and that is the intent rather than a regression.** Coverage, balanced
accuracy, the confusion matrix and `metric4_abstentionQuality.nStructurallyForced` all move. HANDOVER
§2 must be rewritten from the new `metrics.json` afterwards, and any deck built on it with it.

### 10.1 The prediction

Recorded here so the conclusion is confirmed rather than rationalised.

Tox21 qHTS tests 15 concentrations from roughly 1.1 nM to **92 µM**. Unbound Cmax for most oral drugs
is below 1 µM and frequently in the nanomolar range. **Most of the 118 should therefore clear a 100×
margin, earn `exposureRelevant: true` legitimately, and commit to `advance`** - including a large
share of the 54 compounds where cytotox disagrees with QSAR and QSAR is right.

If that happens, the honest conclusion is **not** "ARBITER improved". It is:

> Acute HepG2 cytotoxicity at high concentration is a poor instrument for idiosyncratic DILI, and
> R3's blanket exposure discount was compensating for that mis-specification rather than measuring an
> exposure margin. Correcting the exposure axis removes the compensation and exposes the stream.

That finding is more useful to a toxicologist than a coverage number, and it is the kind of result
HANDOVER §2 is already written to state well. It also sharpens §2's existing claim: cause 1 was real,
but fixing it does not simply hand back 118 compounds - it hands back 118 compounds *and* reveals
that R2 and R5 are carrying the wrong weight on the cytotox stream.

**If instead most margins land below 100×**, R3 keeps firing on measured rather than assumed grounds,
coverage barely moves, and the deliverable is §3's correction plus a defensible exposure axis. Both
outcomes are reportable. Neither requires touching the ruleset.

---

## 11. Build order

Steps 1–3 need no network access and are most of the work.

1. `rules/exposure-policy-v1.0.json` + its hash check in the harness. **Commit before running
   anything**, so the registration timestamp precedes the first number.
2. `test_exposure_margin.py` and the margin function it tests, against fixtures. TDD - the boundary
   and the null cases are the whole of the logic.
3. `cmax_ingest.py` + its two tests.
4. `tox21_concentrations.py`. First network step; reuses the pinned AIDs.
5. The join in `assemble_evidence.py`, and `tox21_stream.py:275` `False` → `None`.
6. `single:cmax-threshold` baseline in the harness.
7. Re-run the pipeline, `npm run harness`, `npm run metrics`, `golden:update`. **Record what moved
   before interpreting it.**
8. Rewrite HANDOVER §2 and §3.1 from the new `metrics.json`. Never retype a number.

---

## 12. What must not be touched

- **`rules/ruleset-v1.0.json`** - not opened. R3's statement and its 0.85 strength are unchanged.
  This spec adds a data-preparation policy, not a rule.
- **`abstentionGapThreshold`** - still 0.5, still forbidden, and HANDOVER §2's curve shows it would
  not help anyway.
- **`packages/engine`** - no change. `relevanceDiscount` already consumes `exposureRelevant`
  correctly; it has simply never been given a `true`.
- **The compound set and the split** - the benchmark corpus was frozen on 2 August 2026. This work
  adds no compounds and regenerates neither `compounds.json` nor `splits.json`.
- **`exposureRelevant: true` without a computed margin** - the prohibition from HANDOVER §3.1, now
  enforced by `load.ts:46` for fixtures and by §8's assertions for the corpus.
