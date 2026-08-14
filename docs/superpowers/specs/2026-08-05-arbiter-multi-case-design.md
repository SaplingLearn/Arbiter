# ARBITER - multiple hero cases

> **SUPERSEDED, 2026-08-09. Cases moved out of the bundle and into the service.**
>
> This designs several hero cases shipped as fixtures inside `apps/web`. In the
> redesign, cases are created, joined and deliberated by real accounts through
> `services/api` and read by `apps/deliberation` - see
> `2026-08-09-arbiter-ai-redesign-design.md` §6, "how multiple scientists work a
> case".
>
> The case-selection reasoning here still holds; the delivery mechanism does not.
> Add cases through the service, not to a static bundle.

**Date:** 5 August 2026 · **Submission due:** 16 August 2026 · **Data freeze: 2 August 2026, already passed.**

Companion to `2026-07-26-arbiter-design.md` (the master spec), `2026-07-27-arbiter-phase2-web-app-design.md`
and `2026-07-28-arbiter-phase3-ai-surfaces-design.md`. It decides how the app carries more than one
demonstrated compound, and it records four corrections that measuring the corpus forced - including one to a
recommendation made earlier in the conversation that produced this document.

Every number below was produced by running `reason()` from `packages/engine/src/index.ts` over the committed
artifacts on 5 August 2026. Nothing here is estimated.

## 1. Scope

**In scope.** Turning the singular literature fixture into a set of **hero cases**; a second hero case backed
by the existing corpus; a machine-enforced gate for a third; per-case as-of milestones; the tour carrying a
compound; and a `compoundId` inside the hash-chained audit record.

**Specified but not built.** Hero case 3, the `advance` case. It is gated on a clinical Cmax that the project
does not have (HANDOVER §3.1), and §5 below makes the loader *refuse* to accept a substitute. Its shape is
fixed here so it can be added without reopening this document, and so that never adding it costs nothing.

**Out of scope.** Any change to `rules/ruleset-v1.0.json`. Any change to the benchmark population, the
splits, or anything under `results/`. The harness ablation.

## 2. The decision this document rests on: three verdicts, not three cases

Measured across the 267-compound test split:

| verdict | n |
|---|---|
| abstain | 260 |
| do_not_advance | 7 |
| **advance** | **0** |

TAK-994 abstains too. So the naive reading of "support more drugs" - author two more literature fixtures in
the shape of the first - produces a demo that says *the same thing three times* and hands a judge the "you
abstain on 97% of everything" objection on three separate screens instead of one.

**The second and third cases earn their place only by showing the engine doing something the first one does
not.** That is the whole design constraint, and everything below follows from it.

All three verdicts are reachable with the pre-registered ruleset untouched. Case 1 and case 2 are measured on
real committed evidence. Case 3's reachability was confirmed against a **hypothetical** claim set and is
recorded as such in §5 - it is a statement about the engine, not about any compound.

## 3. What the corpus actually contains, and a correction

### 3.1 Correction: Cyclosporine shows no defeat

An earlier recommendation in this workstream said Cyclosporine's `cytotox:safe` claim is *defeated by* its
`transporter:toxic` claim. **That was wrong, and it was inferred from stream polarity without reading the
trace.** What the engine actually does on Cyclosporine:

| claim | status | rule |
|---|---|---|
| `…:cytotox` (safe) | admitted, weight reduced to 15% | R3 discount - negative result outside the clinically relevant exposure range |
| `…:qsar` (ambiguous) | **downweighted** | R4 - outside the model's applicability domain |
| `…:transporter` (toxic) | admitted, unchallenged | - |

Nothing is defeated. The safe and toxic human streams coexist and produce conflict mass. The correction
matters because "a defeat is visible" was the stated reason for the recommendation, and it is not true.

### 3.2 The seven committed compounds in the test split

| compound | DILIrank | belief | gap | defeats | conflict mass |
|---|---|---|---|---|---|
| Sorafenib tosylate | vMost | 0.906 | 0.094 | 0 | 0.000 |
| Thioridazine hydrochloride | vLess | 0.905 | 0.095 | 0 | 0.000 |
| Prochlorperazine maleate | vLess | 0.900 | 0.100 | 0 | 0.000 |
| **Cyclosporine** | **vMost** | **0.886** | **0.098** | 0 (one R4 downweight) | **0.122** |
| Mifepristone | vLess | 0.886 | 0.098 | 1 (R2) | 0.122 |
| Irbesartan | vLess | 0.886 | 0.098 | 1 (R2) | 0.122 |
| Glyburide | vLess | 0.886 | 0.098 | 1 (R2) | 0.122 |

All seven are `do_not_advance`.

### 3.3 A visible defeat and a clean split are not available on the same compound

Scanning all 890 compounds for *severe DILI, contested, with a defeat in the trace* returns exactly four:

| compound | split | verdict | belief | defeat |
|---|---|---|---|---|
| Troglitazone | train | do_not_advance | 0.890 | R2 |
| Tolvaptan | train | do_not_advance | 0.886 | R2 |
| Ritonavir | train | do_not_advance | 0.891 | R2 |
| Posaconazole | calibration | do_not_advance | 0.886 | R2 |

**None is in the test split.** The three test-split compounds that do show a defeat - Mifepristone,
Irbesartan, Glyburide - are all `vLess-DILI-concern`, are numerically identical to each other, and are
widely-prescribed drugs on which a rendered `do_not_advance` reads badly to anyone who knows them, however
correct it is under the registered binarisation policy.

So the choice is forced: a visible defeat costs either a train-split disclosure or a bad-optics compound.

### 3.4 Two properties of the corpus worth recording

- **Zero reinstatements fire anywhere.** 60 of 267 test compounds carry a defeated claim; not one produces
  the reinstatement path in `argue.ts:119-133`. That code is core product and no data in this project has
  ever exercised it.
- **The as-of replay is inert on corpus evidence.** Every QSAR claim carries `availableFrom: 2000-01-01` and
  every Tox21 claim `2010-01-01`. A corpus-backed hero case therefore has no two-pass story. This is a
  property of the streams, not a defect, and §7 makes the UI say so rather than imply otherwise.

## 4. Hero case 2 - Cyclosporine

**Selected.** `PMATZTZNYRCHOR-CGLBZJNRSA-N`, test split, `vMost-DILI-concern`, y=1.

| | TAK-994 (all evidence) | Cyclosporine |
|---|---|---|
| verdict | abstain | **do_not_advance** |
| belief | 0.090 | 0.886 |
| gap | **0.910** | **0.098** |
| contested | false | **true** |
| conflict mass | 0.000 | **0.122** |
| defeats in trace | 4, all R3 | 0 (one R4 downweight) |

The contrast that carries the beat is the **gap**, not the verdict label: 0.910 against 0.098 is a visual an
audience reads without being told what it means, which is the same argument `BeliefTrack.tsx:6` already makes
for the belief track.

**Note what the last row does not say.** TAK-994 is *not* short of defeats - once the murine study becomes
visible, R3 defeats all four safe claims, because a positive finding at clinically relevant exposure outranks
a negative one whose exposure margin was never established. Beat 2's line "nothing is defeated" is true only
of the **pre-first-in-human** pass, which is the as-of date that beat runs at (measured: 0 defeats,
`contested: false`, belief 0.000, gap 0.761). Cyclosporine's contribution is therefore **not** "a defeat is
finally visible" - it is a *contested* case, with non-zero conflict mass, that **commits**. TAK-994 has never
done any of those three.

Three further reasons, in order of weight:

1. It is the only hero case where **conflict mass on screen is non-zero and means something.** Dempster–Shafer
   conflict is a headline concept in the architecture and no rendered case has ever exercised it.
2. The claim driving the verdict is `transporter:toxic`, and cyclosporine's real hepatotoxicity **is**
   BSEP-mediated. The engine is right for the right reason, and that is a sentence worth being able to say.
3. It is in the test split, so nothing needs disclosing and no reported number is implicated.

Its counterfactual is a single flip (`transporter → safe`, returning it to `abstain`) and its planner asks
for a mitochondrial toxicity panel in human hepatocytes resolving R3 at cost 15. Both surfaces therefore have
real content on this case; neither is empty.

**Troglitazone is the recorded alternate**, not a rejection. It is the canonical DILI withdrawal, it commits
at 0.890, it is contested, and it *does* show the R2 defeat. Its cost is that it is in the **train** split,
so its QSAR claim is an in-sample prediction. That is disclosable rather than disqualifying - and there is a
real argument in it, since the in-sample claim is the one the engine defeats anyway - but it requires a
rendered split-provenance badge, not a footnote. If it is added, §6's `splitDisclosure` field is what carries
it, and the badge is built whether or not Troglitazone ships.

## 5. Hero case 3 - the `advance` slot, and a gate instead of a rule

The strongest available answer to *"your system abstains on 97% of cases"* is a case where it does not.
Confirmed reachable: a **hypothetical** claim set of safe human evidence carrying `exposureRelevant: true`
returns `advance` at belief 0.000, plausibility 0.014, gap 0.014. **This is a statement about the engine. It
is not evidence about any compound, and it must never be presented as one.**

Reaching it on a real compound requires `exposureRelevant: true`, which requires a clinical Cmax, which is
HANDOVER §3.1's data-acquisition problem - and §3.1 explicitly forbids setting that flag without one. The
2 August data freeze has now passed, so this is later than it was.

**This document does not restate the prohibition. It makes it unrepresentable.**

`FixtureDoc` gains an optional `exposure` block:

```ts
interface FixtureExposure {
  cmax: number;            // ng/mL, free or total, stated
  basis: "free" | "total";
  citation: string;        // a real source, not a placeholder
}
```

and the loader in `apps/web/src/data/load.ts` **throws `DataLoadError`** if any literature-fixture claim sets
`exposureRelevant: true` while the document has no `exposure` block. The failure names the claim.

This converts a discipline into a build failure. It costs about fifteen lines, it cannot be forgotten under
time pressure at 11pm on 14 August, and it means case 3 drops in the day the data exists and cannot be faked
before then. The existing TAK-994 murine claim - the corpus's only `exposureRelevant: true` - is
`assertion: "toxic"`, so the gate is written against safe claims specifically and TAK-994 continues to load
unchanged. This is asserted by a test, not by inspection.

## 6. The data model

`LoadedData.fixture: FixtureDoc` becomes:

```ts
type CaseSource = "fixture" | "corpus";

interface HeroCase {
  compoundId: string;
  displayName: string;              // replaces the literal "TAK-994" at CaseHeader.tsx:24
  source: CaseSource;
  subtitle: string;                 // replaces the hardcoded "Literature fixture · outside..." string
  claims: EvidenceClaim[] | null;   // fixture-backed only; null for corpus-backed
  asOfMilestones: Record<string, string>;   // may be empty
  citationStatus: string | null;    // fixture-backed only
  splitDisclosure: string | null;   // set when the compound is not in the test split
  exposure: FixtureExposure | null;
}

interface LoadedData {
  heroCases: Map<string, HeroCase>;
  // ...unchanged
}
```

**A corpus-backed hero case carries no claims of its own.** It resolves through `data.claimsByCompound` like
any library row, so the Case tab and the Compounds table read one source and *cannot* disagree. This is the
hazard `store.tsx:147-151` already anticipates in writing - the fixture-beats-corpus precedence exists so the
two may diverge without the Case tab silently switching source - and the cheapest way to never trip it is to
give corpus-backed cases nothing to diverge with.

Consequently `registeredClaims` (`store.tsx:153-157`) becomes:

```ts
function registeredClaims(data: LoadedData, compoundId: string): EvidenceClaim[] {
  return data.heroCases.get(compoundId)?.claims
    ?? data.claimsByCompound.get(compoundId)
    ?? [];
}
```

Set membership replaces the single equality, and a corpus-backed case falls through to the corpus by having a
null `claims` - one expression, no branch on `source`.

`bundle.ts:15` imports the fixture files it is given rather than one literal path. `evidence.json`'s
`fixtureCompoundIds` is **already a list** (currently length 1), so the Python assembly layer needs no
structural change - only `assemble_evidence.py:27`'s hardcoded filename list and
`tak994_fixture.py`'s module-level `CID`.

## 7. As-of, per case

`CaseHeader.tsx:30` reads `data.fixture.asOfMilestones` **unconditionally**, so selecting any of the 267
library compounds today offers `preFirstInHuman (2021-06-01)` and `postMurineStudy (2023-01-01)` - TAK-994's
milestones, rendered on a different drug. Nothing is hidden at those dates on corpus evidence, so the numbers
are right and only the buttons are wrong. It is a live defect regardless of this work.

Milestones come from the selected hero case. A case with none renders the "All evidence" control alone and no
milestone buttons. Cyclosporine has none, per §3.4.

## 8. The tour

**One tour. Beats gain a required `compoundId`.**

```ts
export interface Beat {
  n: number;
  title: string;
  tab: TabId;
  compoundId: string;   // dispatched via selectCompound when it differs from current
  focus: Region | null;
  actions: Action[];
  line: string;
}
```

An optional field was tried and is wrong: with only the contrast beat naming a compound, pressing ← off it
leaves Cyclosporine selected while the next beat back narrates TAK-994. Required means every beat states its
subject and none inherits one, so the tour is correct from any entry point and in both directions.

`TourFooter.go()` dispatches `selectCompound` before the beat's own actions when `compoundId` differs from the
one currently selected. This is chosen over one-tour-per-drug and over a case picker because both are more
machinery than a 240-second demo needs, and because it closes a latent bug on the way: **no beat dispatches
`selectCompound` today**, so clicking a library row and then pressing `→` narrates TAK-994's script over
another compound's numbers.

`beats.ts:18-19` currently duplicates the fixture's milestone dates as module literals `PRE_FIH` and
`POST_MURINE`. They are read from the hero case instead, so the tour and the as-of bar cannot drift apart.

**The new beat sits between the record table (beat 5) and the validation tab (beat 6):**

> *"Same rules, same engine. Here the human streams disagree at the mechanism - and it commits."*

The placement is deliberate. Beat 6 is where coverage is named as the finding, and an audience that has just
watched the engine commit hears "it abstains on 97%" as a calibration claim rather than as an admission.

Seven beats become eight. `apps/web/e2e/demo.spec.ts:8-14` and `static-file.spec.ts:45-62` assert
`Beat n of 7` and a terminal URL; both are ours and both are updated. `static-file.spec.ts:27-28` asserts the
literal string `"TAK-994"` appears in the shipped artifact - that assertion stays, since TAK-994 remains the
boot case and its disappearance would be a real regression.

## 9. The audit chain

`ReviewerPosition` (`store.tsx:12-29`) carries no `compoundId`, and `chain.ts:57-68` hashes only that
record's own fields. Signing on two compounds today produces one interleaved chain in which no link says what
it was about.

`compoundId` is added to `ReviewerPosition` **and to `canonicalRecord`**, so it is covered by the hash rather
than merely displayed. Adding it to the render alone would reproduce HANDOVER §6.4's `prevRecordHash` defect
exactly - a field a reader trusts that tampering does not disturb.

One chain is kept rather than one per compound. The chain records a session's decisions in the order they
were taken; interleaving is honest once every link states its subject. The Record tab gains a compound column.

## 10. Benchmark safety

Nothing here can move a reported number, and each guard is structural rather than procedural:

- The ruleset is untouched, so `rulesetHash` is unchanged.
- A corpus-backed hero case **adds no claims**, so `evidence.json` is byte-identical and the 267-row scoring
  loop in `apps/harness/src/main.ts:20` sees exactly what it saw before.
- `validate-evidence.ts:7` stops leak-checking with the literal `id.startsWith("TAK-994")` - which would
  silently miss a second fixture with any other prefix - and checks membership in `fixtureCompoundIds`.
- `npm run golden:update` must produce **no diff**, and `results/verdict-manifest.json` must stay
  byte-identical. Both are asserted in CI already; this document adds no new guard because the existing one
  is the right one.

**The 2 August data freeze has passed.** A corpus-backed hero case adds no data and is unaffected. A *new
literature fixture* would be new data, though it sits outside the benchmark by construction exactly as
TAK-994 does. Whether the freeze binds an out-of-benchmark fixture is an owner's call, not an engineering
one; it is not needed for cases 1 and 2 and is recorded here so it is decided deliberately if case 3 arrives.

## 11. Testing

**No test in the suite calls `selectCompound`.** Every UI test renders on the default fixture, so the
multi-compound path the app already has is entirely unguarded. That gap closes as part of this work.

Required, each verified by injecting the defect it guards against, per HANDOVER §5.1:

| # | test | verified by |
|---|---|---|
| 1 | the as-of bar shows no milestone buttons on a corpus-backed case | giving Cyclosporine milestones and watching it fail |
| 2 | a corpus-backed hero case and its library row show the **same** verdict | forcing divergent claims into `heroCases` |
| 3 | the loader throws when a literature fixture sets `exposureRelevant: true` with no `exposure` block | removing the gate |
| 4 | TAK-994 still loads, its murine `exposureRelevant: true` claim intact | the same ablation as 3 |
| 5 | a beat carrying a `compoundId` changes the selected compound | dropping the `selectCompound` dispatch |
| 6 | `compoundId` is inside the record hash | mutating it post-sign and asserting the chain breaks |
| 7 | `golden:update` produces no diff | - (existing CI guard) |

Test 2 is the one that matters most and is the easiest to write vacuously: it must compare two *rendered*
verdicts across a real `selectCompound`, not two calls to the same selector. `useLibraryVerdicts` and
`useCaseReasoning` are different code paths and the test is worthless unless it exercises both.

## 12. Corrections this document records

1. **Cyclosporine shows no defeat** (§3.1). The earlier recommendation's stated reason was false; the
   recommendation survives on different grounds (§4).
2. **No test-split compound is both severe-DILI and defeat-bearing** (§3.3). A visible defeat costs either a
   train-split disclosure or a bad-optics compound. There is no free option.
3. **`CaseHeader.tsx:30` renders TAK-994's milestones on every compound** (§7). Pre-existing, independent of
   this work.
4. **"The demo never shows a defeat" was false**, and it was nearly written into §4 as Cyclosporine's
   justification. Measured: TAK-994 at all-evidence carries **four** R3 defeats. The claim is true only of
   the pre-first-in-human pass. Recorded because it is the second time in this document that a property was
   inferred from stream polarity rather than read off a trace, after §3.1 - the same mistake twice, caught
   both times only by running the engine.
5. **The Phase 3 spec's §16 leaves "whether the navigator may change the selected compound" undecided.** With
   more than one hero case that question is now load-bearing. It stays **no** - `NavigatorBar.tsx:65-71`'s
   rule is unchanged - which means a cached answer naming a TAK-994 claim anchor is unreachable while
   Cyclosporine is selected. `validAgainstEvidence` already drops such proposals silently; §11 does not add a
   test for it because the behaviour is correct and unchanged.

## 13. Risks

- **Eight beats is a longer demo than seven.** The added beat is worth roughly 30 seconds against a
  240-second budget. If the rehearsal says otherwise, **cutting the new beat is the first thing to cut** - the
  hero case remains reachable by clicking, and nothing else in this document depends on the beat existing.
- **The test surface is the larger half of the work.** Around forty test files reference the fixture; most
  need only the singular-to-map rename, but "most" is not "all" and the count is from `grep`, not from having
  changed them.
- **Case 3 may never arrive.** That is the expected outcome, and §5 is written so that its absence costs
  nothing and its arrival cannot be faked.

## 14. Explicitly not decided here

- **Whether Troglitazone ships alongside Cyclosporine.** The `splitDisclosure` field and its badge are built
  either way; adding the case is then data, not code.
- **The Cmax source for case 3.** HANDOVER §3.1, a team-capacity call, and now past the freeze.
- **Whether a fourth hero case demonstrates reinstatement.** §3.4 records that no data in the project has
  ever exercised that path. Constructing evidence specifically to light up an engine feature is close to
  choosing the answer, and it is not attempted without a real compound behind it.
