# ARBITER — custom compound intake

**Date:** 6 August 2026 · **Submission due:** 16 August 2026

Companion to `2026-07-26-arbiter-design.md` (the master spec) and
`2026-07-28-arbiter-phase3-ai-surfaces-design.md` (the AI surfaces and their governing rule). This
document decides how an organisation gets its own compound through the engine, and where AI is
allowed to help.

It answers one question the current build cannot:

> **"Can I run this on *my* compound?"**

---

## 1. The reframe that decides the design

**A user does not upload a drug. A user uploads evidence.**

This is measured, not stylistic. Given a structure and nothing else, the pipeline can manufacture
exactly one claim — a QSAR prediction. R2 discounts structure-only evidence to 6% of stated
confidence, or 1% where it carries least, because it measures no mechanism. A single claim at 1% has
a ceiling of 0.01 committed mass against a bar of 0.5.

**So a "paste a SMILES, get a verdict" feature abstains 100% of the time, correctly, and looks
broken doing it.** It would also reproduce exactly the situation 140 of the 267 corpus compounds are
already in — one claim, nothing to adjudicate.

The corollary is the more interesting half. The 97.4% abstention rate is an artifact of **public**
data being thin. An organisation holds, for its own compounds, precisely what the public corpus
lacks — internal cytotoxicity runs, transporter assays, in-vivo studies, and above all clinical
Cmax, whose absence alone accounts for 118 discounted claims. **ARBITER should perform better inside
an organisation than it does on the benchmark**, and that is a claim this feature can substantiate.

---

## 2. Scope

**In scope.** A claim intake path that produces `EvidenceClaim[]` for a compound the corpus has never
seen; validation of those claims against the existing schema; a pre-flight advisor that says what
evidence would be needed to reach a committed position; and hard separation between custom compounds
and the benchmark.

**Out of scope for v1.** Any backend. Any persistence beyond the session. Authentication and
multi-tenancy. Scoring a novel structure with the QSAR model — see §7. AI extraction — see §5, which
specifies it as tier 3 and does not schedule it.

**Not negotiable.** No change to `rules/ruleset-v1.0.json`. No change to `packages/engine`. No change
to anything under `results/`.

---

## 3. Decision 1 — v1 needs no backend at all

The engine already runs in the browser. A form where a scientist enters their own claims therefore
works entirely inside the existing self-contained `index.html`: no server, no deploy, no key, no
network, and `apps/web/e2e/static-file.spec.ts` keeps passing untouched.

That is not a compromise version. It is the version that can be demonstrated on a plane, shared over
Teams as one file, and handed to a judge who will not log in to anything. **Build this first and
independently of every AI question**, because it is the part that cannot fail for an operational
reason.

AI extraction (§5) sits on top later as an *accelerator*, never a dependency.

---

## 4. Decision 2 — the intake contract is the existing claim contract

No new shape. Intake produces objects that satisfy `EvidenceClaimSchema`
(`packages/engine/src/schema.ts:11`) and nothing else. Eleven fields, and the reason they are
tractable to ask for is that **each of the six rules reads exactly one of them**:

| Field | The question a scientist is actually being asked | Rule it feeds |
|---|---|---|
| `stream` | What kind of test was this? | R6 (independence) |
| `assertion` | What did it find? | — (direction) |
| `strength` | How strong is the finding? | — (mass) |
| `system` | Tested in what — human, rodent, non-rodent, in silico? | **R1** |
| `measuresKeyEvent` | Did it measure a specific mechanism, and which? | **R2** |
| `exposureRelevant` | Tested at a dose a patient actually receives? | **R3** |
| `inApplicabilityDomain` | Is this compound inside the model's competence? | **R4** |
| `klimisch` | Study reliability, 1–4 | **R5** |
| `availableFrom` | When was this known? | as-of replay |
| `provenance` | Where did it come from? | audit |
| `compoundId`, `id` | Which compound, which claim | routing |

So the intake form is *six questions, one per rule*, plus what the study found, how strong it is, and
where it came from. Every field a user fills in has a visible consequence in the trace, which is the
property that makes the form explainable rather than bureaucratic.

### 4.1 The schema already blocks the highest-consequence error

`EvidenceClaimSchema`'s `.refine` rejects any `qsar` or `in_silico` claim carrying a non-null
`measuresKeyEvent`, because letting a computational prediction claim to have *measured* a key event
would let it escape R2's discount and be weighted like human clinical evidence.

That is precisely the mistake an over-eager extractor makes — reading *"the model predicts
mitochondrial dysfunction"* and recording a measured mechanism. **It is already structurally
impossible.** Intake inherits the guard for free and must not route around it.

### 4.2 The exposure gate extends unchanged

`apps/web/src/data/load.ts` already refuses to build when a literature-fixture claim sets
`exposureRelevant: true` without a cited `cmax`, `basis`, and `citation`. Intake applies the same
rule to user-supplied claims.

**Correction to this section's first draft, which said the gate applies to every claim. It does not,
and the difference is the rule's whole content.** `assertExposureBacked` gates **safe** claims only.
R3 says a positive finding at clinically relevant exposure defeats a negative one whose margin is
unstated — the asymmetry *is* the rule. A toxic finding needs no margin to be defensible; TAK-994's
murine claim is exactly that case. Applying the gate symmetrically would reject legitimate toxic
evidence and would misstate R3 in code.

So: **a user asserting `exposureRelevant: true` on a SAFE finding must supply the Cmax and its
source**, exactly as a fixture author must. That is also the direction that matters, because reaching
an `advance` verdict requires exposure-relevant safe evidence, and typing `true` is the cheapest way
to fake one.

---

## 5. Decision 3 — three tiers, and what AI is allowed to touch

The governing rule from Phase 3 §3.3 holds without exception: **models do language, never judgment.**

| Tier | Input | AI involvement |
|---|---|---|
| **1** | Manual form entry | none |
| **2** | CSV / JSON upload | none |
| **3** | Study report or abstract | extraction, proposed only |

Tiers 1 and 2 are v1. Tier 3 is specified here so that when it is built it is not designed in a
hurry.

### 5.1 What AI may propose

`stream`, `system`, `assertion`, `measuresKeyEvent`, `availableFrom`, `provenance`. All six are
reading comprehension — *what does this document say* — which is the language task the governing rule
permits.

### 5.2 What AI may not set

- **`strength`.** It becomes belief mass directly. A model choosing it is a model deciding, wearing a
  data-entry costume.
- **`inApplicabilityDomain`.** This must be **computed** by the QSAR model, never opined on. A model
  answering "yes, in domain" fabricates R4's input.
- **`klimisch`.** A judgment about study quality — GLP compliance, documentation, protocol adherence.
  Proposable as a suggestion, never accepted without a human setting it.

### 5.3 Every extracted field cites its source span, or is left blank

**This is the decision that makes review a real control rather than a rubber stamp.**

The obvious design — "the reviewer confirms each field" — degrades into clicking through eleven
dropdowns per claim, and a reviewer facing forty claims will approve them all. Requiring the model to
**cite the sentence it took each value from**, and to leave the field *empty* where it cannot, changes
the reviewer's job from *"is this plausible?"* to *"does this quote say that?"* — a question a human
answers accurately and quickly.

A field the model cannot cite is not guessed. It is blank, and a human types it or the claim does not
count.

### 5.4 The model never sees the structure

A novel compound's structure is among the most sensitive IP a pharmaceutical organisation holds, and
sending it to a third-party model is likely prohibited outright.

The existing design already answers this: Surface 1 receives *claim ids and labels only, never raw
evidence values*. Intake extends the same discipline — **the extractor receives report text and
returns structure-free claim metadata. The compound identity and structure never leave.** Everything
mechanistic runs locally.

This is worth stating aloud as a design property, not merely honouring quietly: *an AI-assisted
system in which the AI is architecturally forbidden from seeing your compound.*

---

## 6. Decision 4 — custom compounds must never touch the benchmark

`results/` is the pre-registered benchmark. A custom compound entering it would contaminate every
reported number, and the contamination would be invisible in a diff.

**Custom compounds are session-local and are never written to `results/`, `data/out/`, or the golden
file.** The separation is enforced in code, not by convention — the same argument that produced
`findLeakedFixtures` in `apps/harness/src/validate-evidence.ts`, which exists because a fixture id
reaching the benchmark is exactly this failure with a different source.

Intake therefore ships with a guard of the same shape and a test that can fail.

---

## 7. What is deliberately NOT solved here

**Scoring a novel structure with the QSAR model.** `data/prep/qsar_stream.py:123` fits the classifier
in-process and never persists it — only the resulting claims are written. Scoring an unseen molecule
would need the fitted model *and* the conformal threshold serialised, plus a genuine
applicability-domain determination. That is a Python-side change with its own leakage risk, and it is
not attempted in v1.

Consequence to state plainly in the UI: **a custom compound gets no QSAR claim.** Given R2 discounts
that stream to 6% or 1% anyway, losing it costs the user almost nothing — but it must be said rather
than silently absent.

---

## 8. Decision 5 — abstention has to be explained before it happens

A user who enters three weak claims and receives *abstain* will conclude the tool is broken. They are
the 140-compound case, and the honest framing is available before they start.

Intake carries a **pre-flight advisor**: given the claims entered so far, it reports whether any
committed position is reachable *at all*, and if not, what is missing. This is not a new inference —
it is the ceiling argument §2 of HANDOVER already makes for 254 of the 260 declines: sum the surviving
weight of every live claim, pretend each was stated at full confidence 1.0, and check whether that
generous ceiling can reach the threshold.

The advisor must say the specific thing that is true:

> On this evidence no verdict is reachable at any confidence values. Committing needs at least one
> human-system claim that measures a key event and is exposure-relevant with a cited Cmax.

That sentence is the difference between a demo that looks broken and one that looks honest.

---

## 9. Testing

Per HANDOVER §5.1 — every test must be able to fail, and be watched failing.

| # | test | must fail when |
|---|---|---|
| 1 | a valid hand-entered claim set produces a verdict through the real engine | intake emits a shape `reason()` rejects |
| 2 | a qsar claim with a non-null `measuresKeyEvent` is rejected | the `.refine` guard is routed around |
| 3 | `exposureRelevant: true` without a cited Cmax is rejected | the exposure gate is not applied to user claims |
| 4 | a custom compound id never appears in benchmark ids | the separation guard is removed |
| 5 | the advisor reports unreachable when the ceiling cannot reach the threshold | the ceiling is computed against stated rather than full confidence |
| 6 | the advisor reports reachable for a claim set that does commit | the advisor always says unreachable and is therefore useless |
| 7 | CSV and JSON intake produce identical claims for identical input | one parser drifts from the other |

**No test may call a model.** Tier 3 extraction, when built, takes an injected function exactly as
`services/api/` does.

---

## 10. Build order

1. **Claim validation + the separation guard**, with tests 2, 3, 4. Pure logic, no UI.
2. **The pre-flight advisor**, with tests 5 and 6. Pure logic, reuses the engine.
3. **CSV/JSON intake**, with test 7.
4. **The form and the Case-tab wiring**, with test 1 end to end.
5. **Tier 3 extraction** — separate work, separate approval, not scheduled here.

Steps 1–3 are pure functions over data and are testable without a browser. **Step 4 is the only one
that touches the UI**, which is deliberate: if the calendar takes this feature, it takes step 4 and
the first three still stand as a tested library.

---

## 11. Explicitly not decided here

- **Whether this ships before 16 August.** It is not on HANDOVER §3's critical path and must not
  displace the packaging window.
- **Whether tier 3 is ever built.** §5 makes it *possible*, not *scheduled*.
- **Read-across from public data on structural analogues.** Legitimate and precedented (OECD QSAR
  Toolbox), but those are claims about *different compounds* and the engine reasons per-compound.
  Pooling evidence across molecules needs modelling explicitly, and is not free.
