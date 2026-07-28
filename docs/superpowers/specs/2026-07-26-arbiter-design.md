# ARBITER — Round 1 Design Specification

**Team BU 1** — Jack He, Andres Lopez, Jose Cruz-Lopez
**Pfizer Digital & Technology Hackathon 2026** — Problem Statement 3, Computational Pre-Clinical Drug Development
**Date:** 26 July 2026 · **Submission due:** 16 August 2026, 11:59 PM ET · **Presentations:** 17–19 August

---

## 1. What we are building

A single-page web application in which a preclinical safety lead opens a compound, reads why ARBITER
reached its position, challenges it, and records a human consensus. The reasoning engine runs locally in
the browser and is the same code that produced the benchmark numbers.

**Framing sentence** (in the guidelines' own format; appears in the UI as well as the deck):

> We help preclinical safety leads reason through conflicting toxicity evidence so they can make
> consistent, defensible go or no-go decisions.

**Differentiator:** everyone else builds tools to predict toxicity. ARBITER reasons through the conflicts
between those predictions. It is not another predictor. It is the layer that decides — and the human
signs.

**Closing line, verbatim:** ARBITER helps toxicologists reason through conflicting safety signals,
transparently, with the human experts still making the decision.

**What kind of business this is — a judge will ask.** ARBITER is an **internal capability, not a product to
sell.** Its value to Pfizer is avoided cost, faster and more consistent decisions, and a stronger regulatory
position — not licensing revenue. If pressed on longer-term commercial potential, the credible extensions are
a cross-company consortium for shared safety-reasoning standards, or contribution to the emerging NAMs
qualification ecosystem. Offer those as possibilities, never as a plan.

### Language discipline (non-negotiable across code, UI copy, and deck)

| Say | Never say |
|---|---|
| review-ready evidence package | regulator-ready dossier |
| consistent, defensible | fast |
| ARBITER's position | ARBITER's decision |
| the committee decides | the system decides |
| positions, sign-off, decision owner | voting, vote, tally, majority |
| hash-chained audit log | blockchain |

### Branding

Pfizer-aligned palette with an **ARBITER wordmark in Pfizer blue** — not the Pfizer logo mark. Chrome reads
*"Pfizer Digital & Technology Hackathon 2026 · Team BU 1."* It should look like it belongs inside Pfizer
without presenting itself as a shipped Pfizer product.

---

## 2. Scope

### In scope

Hepatotoxicity (drug-induced liver injury) only. Four evidence streams plus rodent/non-rodent in-vivo.
The seven-beat guided demo. The Deliberation Room. Live rule editing. Counterfactual. Value-of-information
planner. Three AI surfaces with full fallback ladders. Review-ready evidence package export. Validation
harness with four baselines.

### Out of scope

Cardiac, mutagenicity, or any second endpoint. Proprietary data. Live integration with lab systems.
Authentication, real accounts, or multi-user shared state. Runtime data pulls. Live AOP-Wiki SPARQL queries.

**On accounts specifically — a persona switcher is better here, not merely cheaper.** The guidelines-derived
constraint is that the demo must open from a link with no login; a judge who has to sign in cannot explore
during Q&A. But beyond that, one presenter switching persona can become the tox lead and challenge R3, become
DMPK and dissent, and become the safety lead and sign — three perspectives in forty seconds, faster than a
single real login. Real accounts would make beat 6 slower and less legible. See §7a for how the record model
is nonetheless built as though authenticated.

### Mechanistic grounding decision

Rather than a separate Adverse Outcome Pathway visualisation, AOP provenance appears **on the rules**: R2
cites the specific key event it relies on, drawn from a small curated AOP subset shipped with the app. This
buys mechanistic credibility without a second graph view competing with the argument trace for attention.

---

## 2a. Prior art, and what is actually new

**Earlier drafts claimed "first system to…" and "nobody has built this." Both are dropped.** They are
probably false, and a judge who knows the evidence-integration literature will discount everything said
afterwards. The components are each precedented:

| Prior art | What already exists |
|---|---|
| Park, Ogunseitan & Lejano (2014) | Dempster–Shafer evidence fusion applied to a regulatory decision process for toxic-chemical alternatives. **Cited in our own Pitch Bible** — so DS in regulatory toxicology has acknowledged precedent |
| OECD IATA | A structured framework for integrating heterogeneous evidence. The *doctrine* already exists; it is simply not software |
| OECD QSAR Toolbox | Read-across with documented, inspectable justification |
| Argumentation in risk assessment | An established academic literature on argumentation schemes for evidence appraisal |
| Emerging agentic toxicology tools | Orchestrate predictors and parse literature; do not perform formal conflict reasoning, experiment planning, or produce a signed record |

### The claim we actually make

Not that symbolic weight-of-evidence reasoning is new. Rather: **the assembly does not exist as usable
software a safety lead can operate and contest** — rules a scientist owns and edits, a signed tamper-evident
decision record, determinism validated as a build-enforced property, and one mechanism that is genuinely
uncommon:

> **The experiment planner is driven by the argument structure, not by generic assay informativeness.** It does
> not ask "which assay is usually informative?" It asks *"which rule is doing the defeating, and what evidence
> would overturn that specific rule?"* That coupling of defeasible argumentation to value-of-information is the
> novel mechanism, and it is what makes beat 5 work.

A second contribution is methodological rather than technical: **the as-of-date prospective replay** as a
validation design for evidence-integration tools — testing the system on a historical case using only the
evidence that existed at the decision point.

### How to present it

A short landscape slide naming the prior art above. Knowing precisely what is and is not new reads as
command of the field; a novelty superlative reads as not having checked. Per Pitch Bible §20, any novelty
statement is bounded to mid-2026 and re-checked before presenting.

---

## 3. The demo — seven beats, 240 seconds

TAK-994 is run as a **two-pass replay** driven by an evidence `availableFrom` date and an "as of" control in
the UI. Pass 1 uses only evidence that existed before first-in-human dosing. Pass 2 adds what was learned
later.

| # | Beat | Time | Content |
|---|---|---|---|
| 1 | The desk, before first-in-human | 20s | Rat clean · primate clean · in-vitro margin >100× · QSAR ambiguous. Conflict rate across the whole assembled set shown, so the case is visibly not cherry-picked. |
| 2 | What happens today | 30s | Majority vote → advance. Weighted average → advance. Best single source → advance. LLM given identical evidence → advance, with a confident number. |
| 3 | ARBITER's argument | 55s | **Nothing is defeated — nothing contradicts anything.** Each source is instead discounted for what it cannot license: rat and primate are non-human (R1); none of the four established an exposure margin at the clinical range (R3); the QSAR read is ambiguous and commits nothing either way. Most of the weight lands on *uncommitted*. Verdict: **ABSTAIN**. |
| 4 | The honest gap, and what would flip it | 30s | Belief–plausibility gap opens from centre — the widest in the set. Then the exhaustive counterfactual. |
| 5 | The experiment it asks for | 50s | Planner asks for a **human BSEP assay at matched exposure** — cost 12, resolving R3, the rule the verdict rests on. Reveal: Takeda ran a **murine** CYP-induction study instead, during Phase 2, after three participants met Hy's Law. Feed that study in: belief in toxicity moves **0.000 → 0.090** and ARBITER **still declines** — because it is a mouse. It was still asking for the human assay. |
| 6 | The table | 35s | Challenge in plain English → interpreted → proposed change shown → applied → re-run → delta. Positions recorded including one dissent; the named decision owner signs. ARBITER holds no position. |
| 7 | What the numbers say | 20s | Determinism *and* robustness. LLM variance. Planner recommendation unchanged under ±50% prior perturbation: **0.992**. Conflict-subset accuracy vs four baselines with n, intervals, and coverage — **and coverage is currently the finding**: see §8. |

### Why the two-pass structure is mandatory, not stylistic

The murine toxicogenomic study was initiated **during** the Phase 2 trial. Presenting it as input to a
pre-first-in-human decision is hindsight, and it is the single most attackable thing in the demo. The
two-pass replay removes that vulnerability: pass 1 sees only what existed before first-in-human.

The `availableFrom` field plus the "as of" control generalises — any compound can be replayed as of any
date — so this is a real capability being exercised, not a scripted special case. A judge can move the
control themselves.

#### What the replay actually produces — measured 2026-07-27, and it is not what this section first claimed

An earlier draft said pass 1 "requests the very study that history proves was the right one", and that beat 5
ends with the verdict flipping to DO NOT ADVANCE. **Both were wrong, and the engine is right.**

| | measured |
|---|---|
| Pass 1 verdict | ABSTAIN — mass on safe 0.239, **uncommitted 0.761**, nothing defeated |
| Pass 1 counterfactual | flip the in-vitro cytotox read to toxic → `do_not_advance` (a single claim) |
| Pass 1 planner | **BSEP inhibition at matched exposure**, cost 12, resolving **R3** |
| Pass 2 verdict | **ABSTAIN** — belief 0.000 → 0.090, gap 0.910 |

R1 discounts `system: "rodent"` to 10%, so the murine study's stated strength of 0.9 reaches fusion as 0.090.
The rule that says animal evidence is indirect for a human endpoint applies to the murine study too. The
engine is being consistent with its own pre-registered rules, and consistent against the script.

**We rewrote the beat rather than the ruleset.** Amending R1 would rescue this beat and do nothing for the
validation problem in §8 — R1 touches exactly two claims in the entire 890-compound benchmark, both in this
fixture — so the amendment would buy a demo moment at the cost of the one asset that is hard to attack,
which is that nothing here was tuned after seeing a result. See the open question in §5 for the argument on
its merits, recorded but not acted on.

The honest beat is also the stronger one. "ARBITER would have said no" is a smaller claim than: *it declined,
it asked for a cheap human assay that would have settled the question, Takeda ran a mouse study instead, and
even that study does not license a conclusion on its own.* The belief track spreading from 0.000 to 0.090
with the range still open is a better visual for the belief–plausibility gap than a label swap, because the
audience watches the range move rather than a word change.

### Speaker lines that belong on screen

- Beat 3: *"You are not being asked to trust this. You are being asked to read it."*
- Beat 3: *"Note what it did not do. It did not say this drug is toxic. It said it cannot tell you yet."*
- Beat 3 (the mechanism line): *"Nothing here contradicts anything. That is the point. Four studies agreed — and not one of them measured a human endpoint at a clinically relevant dose. Agreement on a question none of them asked is not evidence."*
- Beat 7 (honesty line): *"TAK-994 is why we built this. It is not evidence that it works. The evidence is
  the benchmark, and the rules never saw it."*

---

## 4. Architecture

### Repository layout

```
Arbiter/
├─ packages/engine/          # pure TypeScript, zero runtime dependencies
│  ├─ types.ts               # EvidenceClaim, Ruleset, Reasoning, TraceStep
│  ├─ rules.ts               # R1–R6 as data plus predicates
│  ├─ argue.ts               # defeasible argumentation with reinstatement
│  ├─ fuse.ts                # Dempster–Shafer belief / plausibility
│  ├─ conflict.ts            # conflict detection and labelling
│  ├─ counterfactual.ts      # exhaustive minimal-flip search
│  └─ plan.ts                # value-of-information planner
├─ apps/harness/             # Node CLI — benchmark, four baselines, ablation, sensitivity
├─ apps/web/                 # Vite + React + TypeScript single-page app
├─ services/api/             # three thin AI endpoints (same Railway service)
├─ data/prep/                # Python — DILIrank, ADMET-AI, Tox21, InChIKey crosswalk
├─ data/out/                 # committed JSON: evidence.json, aop.json
├─ rules/ruleset-v1.0.json   # PRE-REGISTERED, hashed, committed before evaluation
└─ results/                  # results.json, metrics.json → shipped to web
```

### Data flow — one direction, no cycles

```
Python prep ──▶ evidence.json ──┐
                                ├──▶ harness (imports engine) ──▶ results.json + metrics.json
        ruleset-v1.0.json ──────┘                                          │
                                                                           ▼
                       web build ships evidence + results + metrics + ai-cache
                                                                           │
                                              browser: engine recomputes live
```

### Deployment

Railway serves the static app and the API from one service. A persistent process means no cold start on the
challenge interpreter, which is the one surface where responsiveness is visible to a judge.

**Additionally**, a fully static build (openable from `index.html`, no server) is produced and submitted as
a ZIP. With the engine in the browser and the AI surfaces falling back to cache, the static build is
functionally complete — it loses only the live interpreter path, and a judge cannot tell.

---

## 5. The reasoning engine

### Purity is load-bearing

```ts
reason(claims: EvidenceClaim[], ruleset: Ruleset): Reasoning
```

No I/O, no dates, no randomness. **Determinism is enforced, not hoped for:** an ESLint rule bans `Date`,
`Math.random`, and any import from outside the package within `packages/engine`; a test runs one case a
thousand times and asserts a single output hash. The claim *same evidence, same answer, every time* becomes
a property the build refuses to break.

**Consequence for as-of replay:** because the engine cannot touch `Date`, it cannot perform as-of filtering
itself. Filtering claims by `availableFrom` is the **caller's** responsibility — the web app and the harness
each filter before calling `reason()`. This is deliberate: the engine stays a pure function of
`(claims, ruleset)`, and the as-of control becomes a change of input rather than a change of behaviour.

### The schema is derived from the rules

Every field exists because exactly one rule consumes it. No field is unused; no rule lacks evidence backing.

| Field | Feeds | Rationale |
|---|---|---|
| `system: 'human' \| 'rodent' \| 'nonrodent' \| 'in_silico'` | R1 | The rule must know what biology produced the signal |
| `measuresKeyEvent: aopId \| null` | R2 | `null` means it only correlates with structure |
| `exposureRelevant: boolean \| null` | R3 | `null` means the margin was never tested at clinical range |
| `inApplicabilityDomain: boolean \| null` | R4 | A prediction about an unlike compound is a different kind of evidence |
| `klimisch: 1 \| 2 \| 3 \| 4 \| null` | R5 | Standard regulatory reliability score |
| stream independence | R6 | Agreement between independent sources, not a source with itself |
| `availableFrom: ISODate` | as-of replay | Enables date-bounded reasoning; prevents hindsight |
| `provenance: { kind, source, retrieved, url? }` | UI badges | DATABASE vs LITERATURE, visible per cell |

### R1–R6 — justified from doctrine only

**Critical correction to prior drafts: no rule may cite TAK-994 in its justification.** Deriving a rule from
the hero case and then demonstrating the rule on that case is circular, and one question collapses the beat.
All six are justifiable from published frameworks alone.

| Rule | Statement | Framework basis |
|---|---|---|
| **R1** Human relevance | Human-cell evidence defeats animal in-vivo evidence when the question is human hepatotoxicity | FDA Roadmap to Reducing Animal Testing (Apr 2025); FDA Modernization Act 2.0 (2022) |
| **R2** Mechanistic proximity | Evidence directly measuring an AOP key event defeats evidence that only correlates with structure | OECD AOP framework; key-event-relationship confidence in AOP-Wiki |
| **R3** Exposure relevance | A positive finding at clinically relevant exposure defeats a negative finding whose margin is unstated or untested at that range | Standard exposure-margin practice in regulatory toxicology; ICH M3(R2) exposure-margin expectations |
| **R4** Applicability domain | Evidence from a model operating outside its applicability domain is admitted with reduced weight, or excluded | OECD QSAR validation principles; standard QSAR regulatory acceptance |
| **R5** Study reliability | Higher-reliability studies defeat lower-reliability ones at equal mechanistic relevance | Klimisch et al. (1997) reliability scoring |
| **R6** Concordance | Independent sources agreeing raises confidence more than one source agreeing with itself | OECD weight-of-evidence and IATA guidance; formalised by the fusion layer |

TAK-994 is positioned as the **motivating case**, explicitly not as evidence. It is excluded from every
metric, and the rules were never exposed to it.

### The six rules do two jobs, and the second one is what makes pass 1 work

Read only as tie-breakers, R1–R6 fire when claims collide. That is not enough. TAK-994's pass 1 contains
four sources that all say *safe* and one that says *ambiguous* — **nothing conflicts, so nothing is
defeated.** Under defeat-only semantics every claim is admitted at full strength and the verdict is
**advance**: the engine reproduces the historical decision, for the same reason the humans made it, and the
demo's central beat does not exist.

The gap is conceptual rather than arithmetic. The lesson of the case is not *animal evidence loses an
argument* — it is that **a clean rat study is weak evidence about a human endpoint even when nothing
contradicts it.** So each rule also acts as a **discount** on how much of a claim's confidence it may
commit, applied whether or not anything opposes it. The discounted portion moves to **uncommitted** mass,
which is precisely what uncommitted mass means: weight this source cannot place anywhere. It does *not*
move to the opposing side — weak evidence for safety is never evidence of toxicity. Discounts compound
multiplicatively, so a rodent study whose exposure was never established is weaker than either flaw alone.
Each factor is `1 − rule.strength`, read from the same pre-registered, hashed strengths that govern defeats:
one number per principle, one meaning, two mechanisms. R4 already behaved this way; the others generalise it.

**One rule is directional, and its own registered text makes it so.** R3 discounts only claims asserting
*safe*, because R3 is written about negative findings — "defeats **a negative finding** whose margin is
unstated or untested at that range." R1, R2, R4 and R5 describe what *kind* of evidence a claim is and so
apply whichever way it points; R3 describes what a result can *license*, which is direction-dependent. A
positive hit at an unrecorded concentration is still informative and sets up the next experiment. An absence
of signal at an unrecorded concentration licenses nothing about safety.

This asymmetry is load-bearing in both directions. Without it, a lone hepatotoxicity finding whose margin
was never recorded retains 15% of its weight and yields a belief–plausibility gap of 0.87 — an abstention.
Since `exposureRelevant` is `null` for nearly every claim the QSAR and Tox21 streams produce (neither has a
Cmax source), applying R3 symmetrically would abstain on essentially the entire evaluation set.

**Expect the question "isn't discounting just a fudge factor?"** The answer is that the discounts are the
same six pre-registered numbers as the defeats, fixed and hashed before any evaluation ran, with no separate
knob to tune. A toxicologist who disagrees edits one strength and both mechanisms move together.

### Argumentation must earn the word — reinstatement is required

Six rules with a preference ordering is only genuinely defeasible argumentation if it implements
**reinstatement**: A defeats B; C defeats A; therefore B is reinstated. A flat decision table cannot express
this. Without reinstatement, calling this argumentation is overselling, and a technical judge would be right
to call it a lookup table with extra steps.

`argue.ts` implements grounded semantics over the attack graph induced by the preference ordering, and **at
least one demo compound must visibly exercise reinstatement.**

### Dempster–Shafer fusion

Frame Θ = {toxic, safe}. Each source distributes mass across `{toxic}`, `{safe}`, and `Θ`, where Θ is
uncommitted mass — what that source genuinely cannot tell you.

**A silent source contributes m(Θ) = 1. Not a vote for safe.** This is why fusion beats averaging:
*absence of evidence is not evidence of absence, and averaging treats it as though it were.*

Combination is Dempster's rule. `belief(toxic) = m({toxic})`;
`plausibility(toxic) = m({toxic}) + m(Θ)`. Conflict mass **K** is tracked and surfaced rather than
normalised away — high K means the sources genuinely disagree, and it widens the reported range.

**The full fused mass is reported, not just `belief`.** `belief` is the mass on *toxic* alone, so it cannot
by itself explain an `advance` verdict — a reviewer seeing `belief: 0.25` next to `advance` has no way to
check the two against each other. All three components (`toxic`, `safe`, `uncommitted`) are in the output.

### Dempster's rule *is* R6 — there is no separate concordance bonus

R6 needs no mechanism of its own, because fusion already is one. Two independent sources each putting 0.18
on *safe* combine to 0.3276 — strictly more than either alone, while a source repeating itself adds nothing.
That is R6's registered statement discharged by the arithmetic, and the ruleset's own framework note says as
much: *"Formalised by the evidence fusion layer; independence is at the stream level."*

An earlier draft **also** applied an explicit multiplicative boost keyed to the number of concurring streams.
It was removed, and the reason is worth stating because it is the kind of thing a judge should ask about:

1. **It could invert the verdict.** A stream-count majority overrode a mass majority. `safe 0.18` +
   `safe 0.18` + `toxic 0.33` fuses to *toxic* 0.2488 against *safe* 0.2461, yet the boost lifted safe to
   0.2543 and the engine returned **advance** while still reporting `belief` 0.2488. The output contradicted
   itself, and nothing in it explained why.
2. **It double-counted.** Fusion had already rewarded the concordance; the boost rewarded it again.
3. **Its coefficient was not pre-registered.** A `0.25` scaling factor lived in source rather than in the
   hashed ruleset, so *"where did 0.25 come from?"* had no defensible answer.

`concordanceBoost` survives as a **reported diagnostic** — how many independent streams concur, and on which
side, is worth showing a reviewer — and is explicitly documented as never being applied to a mass.

### Conformal prediction on the QSAR stream

The Pitch Bible specifies conformal prediction (§06, §17) and earlier drafts of this spec dropped it. It is
restored, because it is the difference between *measuring* calibration and *guaranteeing* it.

**Split conformal** over the ADMET-AI / TDC predictions, using a DILIrank calibration split held separate
from both training and test. This yields two things the engine consumes:

- A **calibrated confidence** per prediction with distribution-free coverage at a chosen level, rather than a
  raw model score
- A principled **in / out of applicability domain** flag, feeding R4 — so "outside its domain" is a
  nonconformity threshold rather than a judgment call

This upgrades calibration from an empirical observation to a guaranteed level, which is a materially stronger
answer to *"is your uncertainty real?"* Roughly half a day, and it applies to the stream we wrap rather than
requiring us to build a predictor.

### Read-across and structural alerts

For compounds with no history, the mechanistic and structural lens is what transfers: a novel molecule sharing
a scaffold with known hepatotoxicants, or carrying a known toxicophore, inherits those inferences. This is
regulatory-accepted rather than exotic, and it is why public data functions as **the lens, not the answer**.
In this build it enters as evidence claims flagged `measuresKeyEvent: null` — structural correlation, which
R2 correctly ranks below direct key-event measurement.

### Abstention

Triggers when the belief–plausibility gap exceeds a threshold, when the sources have entirely cancelled each
other out (total conflict mass), or when every **live** committed source lies outside its applicability
domain. "Live" is doing real work in that third trigger: a *defeated* claim contributes no mass, so an
in-domain claim that lost its argument must not be allowed to vouch for a verdict resting entirely on
out-of-domain survivors. An *undecided* claim is excluded for the same reason — it contributes ignorance,
not a vote.

Note the division of labour with the discount mechanism above: discounting decides *how much* each source
commits, and abstention reads the resulting gap. Pass 1 abstains through the gap trigger, not the domain
trigger — nothing there is out of domain; it is simply that nothing licenses a conclusion. **The threshold lives in the pre-registered ruleset** so it cannot be tuned after
results are seen. **Proposed starting value: gap > 0.50.** The final value is committed to
`ruleset-v1.0.json` before any evaluation runs and is not changed afterwards; if it proves badly chosen, that
is reported as a finding rather than quietly corrected.

### Counterfactual — exhaustive, not heuristic

With at most six claims per compound, the engine is re-run over every single-claim flip and then every pair,
and the smallest set that changes the verdict is reported. Exhaustive over **assignments**, not just over
subsets: a pair is tried with every combination of target assertions, so a minimal answer of the form "this
toxic reading would have to become safe *and* that one would have to become ambiguous" cannot be missed. That
is 12 single flips plus at most 120 pairs — around 130 re-runs of a pure microsecond-scale function. Exact,
with nothing to defend.

Measured aside, recorded because it is the kind of thing worth knowing rather than assuming: across 4,000
random cases the narrower search that flips both claims of a pair to the *same* assertion never once produced a
different answer. Homogeneous assignments appear to dominate — "both to X" pushes mass further toward a
committed verdict than a mixed pair does, and "both to ambiguous" dominates a mixed pair for reaching
abstention. The exhaustive search is kept because the guarantee is what was promised, the cost is negligible,
and 4,000 samples of one evidence distribution is not a proof.

### Value-of-information planner

Candidate assays are operators carrying `{ cost, fieldsResolved }`. For each, expected narrowing of the
belief–plausibility gap across possible outcomes, divided by cost; argmax wins.

**Stated limitation:** the outcome priors are curated from literature, not learned. This is standard
practice for value-of-information analysis where the data does not exist, and it is disclosed rather than
hidden. It is mitigated by measurement — see the sensitivity analysis in §8.

### Pre-registration, made checkable

`rules/ruleset-v1.0.json` — including R1–R6, the abstention threshold, and the DILIrank binarisation policy —
is committed **before** any evaluation runs. Its SHA-256 is printed in the app chrome beside
*"Ruleset v1.0 · locked."* The defence against *"you tuned the rules to fit DILIrank"* stops being a verbal
claim and becomes a hash checkable against git history.

The harness enforces it rather than trusting it: `loadInputs()` recomputes the hash over the projected
surface and **refuses to run** if it differs from `ed073a8a…`. A results file cannot be produced under a
silently-edited ruleset.

### Recorded open question for a v1.1 re-registration — should R1 discount, or only defeat?

**Not acted on. Recorded because the argument is real and because recording it before the pitch is worth
more than winning a beat with it.**

R1's registered statement is *"Human-cell evidence **defeats** animal in vivo evidence…"* — the language of
conflict resolution — and its framework note calls human NAMs the *"preferred"* source, which is comparative.
The design decision in §5 generalised all six rules into evidence-quality discounts applied at
mass-construction time, so that quality matters when nothing conflicts. That generalisation is what makes
pass 1 abstain, and it is right for R2–R5, which describe intrinsic weaknesses: structural correlation only,
an unestablished exposure margin, out-of-domain, low reliability. Those are weaknesses whether or not anything
disagrees.

R1 may be different in kind. A rodent study is not intrinsically weak evidence; it is weaker **than a human
study of the same thing**. Applying a 90% discount with no human comparator present asserts something the
registered text does not say. The measured consequence is that the murine TAK-994 study reaches fusion at
0.090 and pass 2 abstains.

**Why we did not act on it.** The argument arrived immediately after discovering it would rescue a demo beat.
That is exactly the circumstance in which a textual argument is least trustworthy, and a judge is entitled to
ask whether we would have made it had the demo worked. It also fixes almost nothing measurable: R1 applies to
two claims in the whole 890-compound benchmark. If it is right, it is right in v1.1, argued on doctrine, with
the demo consequence disclosed up front.

---

## 6. Data layer

### Strategy: real-data-first with provenance badges as the safety net

Chase real database values in priority order, with a **hard data freeze on 2 August**. Whatever has landed is
DATABASE-badged; anything outstanding falls back to literature-sourced values, LITERATURE-badged and visible
in the UI. Same ceiling as a full-pipeline commitment, no schedule cliff. A tool whose thesis is *evidence
quality determines which evidence wins* displaying the quality of its own evidence is thematically correct.

| Source | Role | Effort | Priority |
|---|---|---|---|
| FDA DILIrank | Ground-truth labels | One XLSX download, ~1,000 drugs | 1 — essential |
| ADMET-AI / Therapeutics Data Commons | QSAR and ADMET predictions per SMILES | `pip install`, half a day | 2 — essential |
| Tox21 via PubChem PUG-REST | In-vitro assay evidence, no API key required | 1–2 days | 3 — expected |
| EPA ToxCast (CompTox API) | Richer in-vitro coverage, needs an emailed API key | Uncertain turnaround | 4 — opportunistic |
| ChEMBL | Structure linking for the InChIKey crosswalk; bioactivity enrichment | REST API, hours | 3 — required by the crosswalk |
| Open TG-GATEs | Toxicogenomics | A week minimum; raw CEL files; predominantly rat liver | 5 — literature fallback expected |
| Comparative Toxicogenomics DB | Curated chemical–gene–disease interactions; mechanistic enrichment | Free for research | 6 — opportunistic |

**Identifier crosswalk** is by chemical structure — InChIKey, with SMILES via PubChem and ChEMBL. This is the
known time sink and it is scheduled first.

**TG-GATEs is deliberately deprioritised.** It is a bioinformatics project rather than a download, and the
stream it yields is predominantly rat liver — which R1 downweights. Spending a week acquiring the stream our
own reasoning discounts is a poor trade against the guidelines' own statement that Round 1 evaluates the
idea, impact, feasibility and communication, *not* access to datasets.

### TAK-994 is literature-sourced and outside the benchmark

TAK-994 was terminated in Phase 2 and never approved, so it is not in DILIrank. Its evidence and outcome come
from the Phase 2 NEJM report and the 2025 *Toxicological Sciences* mechanistic paper. The interface must never
blur the motivating case with the benchmark population; if asked whether TAK-994 was in the benchmark, the
answer is a crisp no, with the reason.

### Task zero — the conflict-count spike

**Before anything else, a two-hour spike:** pull DILIrank plus ADMET-AI predictions for ~200 compounds and
count how often streams disagree. The entire product depends on genuine conflicts existing. If ADMET-AI and
Tox21 outcomes correlate tightly on DILIrank drugs, the conflict subset could be too small to support the
headline metric — and that invalidates a metric, not merely a slide. Week one is when to discover this.

---

## 7. The three AI surfaces

**Discipline that resolves the apparent inconsistency of using LLMs while benchmarking against one:** models
are used for **language** tasks — parsing a sentence, matching a question to an anchor — and never for
**judgment**. This is stated deliberately in the deck and Q&A prep rather than left to be discovered.

### Surface 1 — Challenge interpreter (live)

`POST /api/interpret` receives challenge text, the current ruleset (ids, enabled, strength), and claim **ids
and labels only** — never raw evidence values. Small payload, and a genuine data-minimisation story.

```ts
{ targetRule: 'R3' | null, targetClaimId: string | null,
  action: 'disable' | 'lower_strength' | 'raise_strength' | 'reclassify_field',
  field?: string, newValue?: unknown, paraphrase: string, confidence: 'high' | 'low' }
```

**The proposed change is displayed before it is applied.** Human-in-the-loop at the level of a single
interaction: a misinterpretation is visible and rejectable, never silent.

Fallback ladder:

1. Live call, 2.5s timeout
2. Cached interpretation, exact match on challenge text (~12 pre-baked)
3. Local fuzzy match over cached challenges — Jaccard similarity on character trigrams, **accepted at ≥0.55**
4. Deterministic keyword mapping (`rat`, `margin`, `domain`, rule names, stream names → rules)
5. UI degrades to a rule picker: *"Which rule do you want to contest?"*

At every rung the resulting change runs through the same engine. **The reasoning is never faked — only the
route from English to rule change differs.**

### Surface 2 — Live ablation as a spot check

The headline is pre-computed: **25 runs per compound** across the conflict subset, temperature disclosed,
every output shown including concordant ones. The live button appends **one** further run.

This is safe where five live runs would not have been: **the claim is already established by the pre-computed
n, so the live run is a spot check rather than the evidence.** A concordant live run contradicts nothing.
Offline, the button disables with a tooltip and the table is untouched.

### Surface 3 — Navigator, structurally unable to hallucinate

`POST /api/navigate` receives the question plus available anchors (trace steps, evidence cards, rules, the
belief bar, the consensus record) and returns:

```ts
{ anchorIds: string[], noMatch: boolean }   // ids only — no prose, ever
```

The UI scrolls to, spotlights, and surfaces text that **already exists** at those anchors. It cannot invent a
claim because the return type gives it nowhere to put one. The Q&A answer: *it cannot hallucinate — not
because we prompted carefully, but because it only returns identifiers.*

Fallback: cached question→anchor map → local keyword match over anchor labels and rule statements →
*"no match — try one of these"* with four suggested questions.

---

## 7a. The consensus record — positions, not votes

### Positions recorded, one accountable owner signs

**This is a correction to earlier drafts, which displayed "2 agree · 1 dissent" beside a RECORD CONSENSUS
button.** That reads as a vote tally producing the outcome, and it quietly contradicts the accountability
story: if a tally decides, then a judge asks *"what happens at 2–1 the other way?"* and the answer is that the
group outvotes the accountable owner. The decision would have been handed back to a mechanism — a
human-shaped one, but a mechanism.

Real pharma governance is not majority rule. **A committee advises; one accountable individual decides.**

So: **positions are recorded, dissent is preserved, and one named decision owner signs.** Counts are context
for a later reader, never the thing that determines the outcome. **The word "voting" is dropped from the
product, the UI, and the deck** — *positions* and *sign-off* are more accurate and stronger.

### The record model — built as though authenticated

A consensus record is theatre unless it binds to what was actually reviewed. The model therefore carries
everything an authenticated signature needs, with the identity source as the only stub:

```ts
{ reviewerId, displayName, role,
  position: 'agree' | 'dissent' | 'abstain',
  rationale: string | null,
  signedAt: ISODateTime,
  rulesetHash: string,            // which rules were in force
  evidenceSnapshotHash: string,   // exactly what was on screen
  asOfDate: ISODate,              // which replay state
  signatureMethod: 'demo-persona' | 'sso',   // the seam, made explicit
  prevRecordHash: string }        // hash-chained, append-only
```

Two fields earn their keep. **`evidenceSnapshotHash`** binds the signature to the precise evidence and verdict
reviewed — without it, "I agree" attaches to nothing and a later data change silently rewrites what someone
endorsed. **`prevRecordHash`** makes the log tamper-evident in a few lines: this is a standard hash-chained
audit log and must be described as exactly that, **never as a blockchain.**

### Why this matters for the Q&A

It converts *"do you have accounts?"* from a weak answer into a strong one: **the record already carries what
a 21 CFR Part 11 electronic signature requires — unique signer identity, binding to the signed content, and a
tamper-evident trail. In deployment the identity comes from Pfizer SSO instead of a demo persona, and
`signatureMethod` is the only field that changes.**

Part 11 is the actual regulation behind the playbook's claim that a full audit trail supports
electronic-records expectations. This is what makes that line defensible rather than aspirational.

**Honest limit, consistent with §12:** the demo does not prove authentication or Part 11 compliance. That is a
design commitment, in the same category as the security architecture.

---

## 8. Validation

### Four baselines

1. **Majority vote** across streams
2. **Confidence-weighted average** — included because majority vote is not actually *averaging*, and
   averaging is what the pitch claims to beat
3. **Best single source** — the unflattering bar; included precisely because it is unflattering
4. **LLM ablation** — identical evidence, no symbolic layer, **25 runs per compound**, temperature recorded
   and reported

### Protocol

- Ruleset, abstention threshold, and DILIrank binarisation policy pre-registered, hashed, committed **before**
  evaluation
- Held-out test set untouched during development

### Three-way split — a correctness constraint, not a nicety

**This resolves a genuine conflict inside the source documents.** Pitch Bible §05 point 3 and §17 both call for
per-source reliabilities *calibrated on ground truth* — measuring how often each source has historically been
right, using DILIrank. The Playbook simultaneously demands pre-registration before evaluation. **Fitting source
weights on DILIrank and then scoring on DILIrank is leakage**, and it inflates the headline metric by an
unknown amount.

The data is therefore split three ways, with the boundaries fixed before any fitting:

| Split | Used for | Never used for |
|---|---|---|
| **Train** | Fitting per-source reliability priors | Anything reported |
| **Calibration** | Conformal nonconformity thresholds | Fitting priors; anything reported |
| **Test** | Every reported number | Any fitting or threshold selection, ever |

What is pre-registered is the **procedure** — how reliabilities are estimated and how thresholds are chosen —
not the resulting values, which are derived from the train and calibration splits. Split assignments are
committed with a fixed seed alongside the ruleset hash.

Without this, the reported conflict-subset accuracy does not mean what a slide would claim it means. It is not
an enhancement; it is the condition under which the numbers are valid at all.
- Conflict subset reported separately from overall — overall accuracy is inflated by easy unanimous cases
- Repeat runs for the stochastic pipeline; identical treatment applied to ARBITER
- Wilson confidence intervals, explicit n, and confusion matrices rather than bare accuracy

**DILIrank binarisation, pre-registered:** vMost + vLess = positive; vNo = negative; Ambiguous reported
separately rather than quietly dropped.

### Metrics, in priority order

| # | Metric | Definition |
|---|---|---|
| 1 | Conflict-subset balanced accuracy | Against all four baselines. The headline. **Subset definition, fixed before any data landed:** a compound is in the conflict subset when *some* stream committing to `toxic` differs from *some* stream committing to `safe`. Stream-level, not claim-level — two disagreeing readouts from one assay is measurement noise, whereas a hepatocyte assay disagreeing with a transporter assay is the situation ARBITER exists for. A stream split against itself does not qualify on its own, but it still counts against a third stream that opposes it. Ambiguous claims commit to nothing and never create a conflict. |
| 2 | Decision consistency **and robustness** | Determinism (trivially 100%) reported *alongside* stability under perturbation: evidence `strength` jittered by **±10%** and rule `strength` varied by **±25%**, over **2,000 samples** per compound, reporting the share of samples returning the original verdict. A deterministic but knife-edge system is not consistent in any useful sense. |
| 3 | Uncertainty calibration | Coverage *and* mean interval width, both reported — a wide-but-always-right interval is worthless. Reported alongside the **conformal coverage guarantee** at the chosen level, so the claim is guaranteed rather than merely observed. |
| 4 | Abstention quality **with coverage** | Accuracy on committed cases reported *inseparably* from the decline rate. 85% accuracy while abstaining on 60% of cases is meaningless, and reporting accuracy alone would silently inflate the headline. |
| 5 | Planner sensitivity | Share of cases where the top recommendation survives **±50%** perturbation of the outcome priors, over **2,000 samples**. Converts a stated limitation into a measurement. |

### Operational metrics — modeled, never presented as measured

Business & Operational Feasibility is a judged criterion, so these belong in the deck. **They must be
labelled as projected, with assumptions stated, and never reported as measured results:**

- Time to assemble a review-ready evidence package, versus manual assembly
- Number of confirmatory assays avoided through targeted next-experiment recommendations
- Inter-reviewer variance removed

**Inter-reviewer consistency is the metric that actually matters to the workflow** — the real problem is that
different reviewers weigh the same evidence differently — and it is **not measurable in this build**, because
it needs human subjects. Say so. Reporting engine determinism as if it were inter-reviewer agreement would be
the single most misleading thing in the presentation.

### Where the randomness lives

Metrics 2 and 5 require sampling, but the engine forbids `Math.random`. **The harness owns all randomness**,
using a **seeded PRNG with the seed committed alongside the results.** The engine remains a pure function
receiving already-perturbed inputs. This keeps determinism intact *and* makes the robustness figures
reproducible — which they must be, since they are golden-filed.

### Prepare for a mixed result

If the LLM baseline matches on accuracy, the advantage becomes consistency, traceability and calibration —
which are likely the real advantages regardless. Report what is found. An honest mixed result with a clear
interpretation is more credible than a suspiciously clean sweep.

### The mixed result arrived — measured 2026-07-27, on the test split

| | value |
|---|---|
| scored (test split) | 267 |
| conflict subset | 61 (22.8%), positive rate 0.902 |
| ARBITER | balanced accuracy 0.75, **coverage 6.6%**, n committed **4**, single-class |
| best baseline (majority vote) | balanced accuracy 0.75, **coverage 4.9%**, n committed **3**, single-class |
| planner unchanged under ±50% prior perturbation | **0.992** |
| robustness on committed compounds | 1.00 |

**Coverage is the finding, and the headline is not reportable as accuracy.** ARBITER abstains on 260 of 267
compounds. Every one of those abstentions is the belief–plausibility gap rule; none is applicability domain
and none is total conflict. The median compound musters 0.060 of committed mass against a threshold that
needs more than 0.5.

The cause is measurable and structural: **no benchmark compound carries exposure-relevant evidence.** The
only `exposureRelevant: true` claim in the corpus is the TAK-994 murine study, which is excluded from the
benchmark by design. QSAR has no exposure axis; Tox21 qHTS concentrations are not clinical. R3 therefore
fires on 100% of safe claims and 0% of toxic ones — retained weight is 0.150 for cytotox/safe and 0.009 for
qsar/safe against 1.000 for cytotox/toxic — so the engine **cannot license "advance" on this evidence base**,
and returned zero advances.

This is the engine being correct about weak evidence. An HTS "inactive" at an unknown multiple of clinical
exposure genuinely licenses nothing. It is simultaneously a coverage problem, and the two facts are the same
fact.

**The baseline is degenerate in the same way**, which is itself a result: the conflict subset is by
construction where the streams tie, and majority vote abstains on ties, so it commits on 3 of 61. Neither
pipeline has a reportable accuracy on this subset. Reporting them side by side with n and coverage is the
honest presentation, and `results/metrics.json` emits a `singleClass` flag plus explicit coverage and
single-class warnings so the figure cannot be quoted as an accuracy by accident.

**What would fix it is data, not rules.** A clinical Cmax source for even a few hundred compounds before the
2 August freeze stops R3 firing unconditionally and makes the headline reportable. Tuning
`abstentionGapThreshold` would also "fix" it and is forbidden: the threshold is pre-registered precisely so
it cannot be moved after an abstention rate is seen, and that was already considered and rejected once.

---

## 9. Interface

### Tokens — one file, so sampling real Pfizer hexes is a single commit

- Ink `#14172E`, muted `#616784`
- Canvas `#FFFFFF`, surface `#F2F4FE`, hairlines `#DCE1F2` / `#E9EBF5`
- **Pfizer blue `#0000C9` reserved for exactly three jobs**: naming the rule that fired, the primary action,
  the belief fill. Scarcity is what makes it read as deliberate.
- Deep `#001A72` for the top bar only
- Semantic: toxic `#C81E3C`, clean `#0E8A5F`, ambiguous `#B0700A` — **always paired with a form difference**
  (solid vs outlined marker), so colour is never the sole carrier of meaning
- Georgia serif for verdict statements and beat headlines; system sans elsewhere
- Radii ≤4px. No shadows. No gradients. Hairlines and whitespace do the work.

Exact Pfizer hexes are sampled from pfizer.com during build; the values above are approximations.

### Navigation — five tabs at the concern boundary

The app has five top-level destinations. The split is at the **concern** boundary, never inside the reasoning.

| Tab | Contains | Why separate |
|---|---|---|
| **Compounds** | The library, conflict rate across the whole set, each compound tagged agree / conflict / abstain | The screen that proves the hero case was not cherry-picked |
| **Case** | Evidence · argument trace · uncertainty · the table · consensus. Beats 1–6 happen here. | **Does not split — see below** |
| **Ruleset** | R1–R6 in full with statement, framework citation, editable strength; version hash and an edit changelog | Makes "expert-governed, not algorithm-invented" touchable rather than asserted |
| **Validation** | Four baselines, the five metrics, ablation runs, sensitivity, ruleset hash and pre-registration date. Beat 7. | A different concern with a different audience-moment |
| **Record** | The review-ready evidence package and the signed decision log | An output artifact, not a workspace |

**Routing uses a hash router** (`#/case`, `#/validation`), not a history router — because the static offline
build must work opened from `index.html` over `file://`, where a history router breaks.

The guided tour drives *across* tabs: advancing a beat switches tab when the beat requires it, so the
presenter never has to click the right thing under pressure.

### Why the Case tab does not split

ARBITER's thesis is **integration** — that the value lies in seeing the conflict and its resolution together.
Concretely: the challenge to R3 sits in the right column, the rule it attacks fires in the middle column, and
the belief gap it moves is directly beneath. Split across tabs, that causal chain becomes invisible, and the
`belief 0.34 → 0.41` moment — the entire point of the Deliberation Room — stops existing. An interface that
separates evidence from argument is arguing against the product.

The **as-of control lives in the case header**, not in global settings: it is an input to this case. The
evidence panel states how many streams are hidden by the current as-of date, so the two-pass replay is
legible rather than mysterious.

### Shell within the Case tab — workbench with an enlarging spotlight

Three regions (evidence · trace · table) plus the case header and tour footer, laid out with CSS grid. The
spotlight is a `grid-template-columns` transition: the focused region grows to presentation size and the
others collapse to 56px rails that still show every evidence verdict and reviewer position as coloured dots —
so a judge can see nothing was hidden from them.

**Tour state is `{ beat: 0..6, tab: TabId, focus: 'evidence' | 'trace' | 'table' | null }`** — presentational
only and structurally unable to touch data, so the guided and free-navigation modes cannot disagree with each
other.

### Sizing for a compressed share

Body 14px, evidence names 15–16px when focused, verdicts 24–27px. **Verified on a real Teams share before
16 August, not after.** Screen-share compression degrades silently: it will look fine locally while a judge
cannot read the rule names.

### Motion — Level 2 with a kill switch

Staged motion under three rules: nothing animates unless it carries meaning; nothing exceeds 1.5s per beat;
a global toggle (`M`) plus `prefers-reduced-motion` drops the whole app to opacity-only instantly.

The two movements that carry meaning:

- The strike-through **draws** across defeated rows as they recede — you watch evidence lose.
- The belief track **spreads outward from the centre** — which is literally what the belief–plausibility gap
  *is*. The hardest concept in the pitch becomes something a non-technical judge understands by watching.

### Accessibility

Form plus colour, full keyboard navigation, visible focus rings, contrast ≥4.5:1, reduced-motion support.

### Presenting under pressure

Keyboard driving — `←`/`→` beats, `M` motion, `Esc` exit tour — so nobody fumbles a mouse mid-sentence, and
**any of the three team members can drive it** with no hidden knowledge. A pre-flight panel on `?` lists
which live paths are healthy and which are on cache, so the state of the world can be confirmed ninety
seconds before presenting.

### Review-ready evidence package export

One click produces a print-ready page carrying the evidence matrix, the argument trace, the uncertainty
range, the recommended experiment, the consensus record including dissent, and the ruleset version hash.
Without it the deliverable is described; with it the deliverable is handed to a judge.

---

## 10. Fallbacks

| Failure | Behaviour |
|---|---|
| `results.json` fails to load | An inlined TAK-994 fixture is compiled into the JS bundle — the app **always** has one complete case |
| Engine throws on a user-edited ruleset | Catch, revert to last-good ruleset, non-blocking toast: *"reverted — that edit produced an invalid ordering"* |
| A panel errors at render | Error boundary **per panel** — one broken region never blanks the app, and the tour continues |
| Share looks laggy | `M` → opacity-only motion instantly; also honours `prefers-reduced-motion` |
| Railway down, or no network | Static build runs from `index.html`; all three AI surfaces serve from cache |
| Everything | Recorded walkthrough video, submitted alongside as the guidelines permit |

**Fallbacks that have never been tested are decorations.** Each is exercised in CI — see §11.

---

## 11. Testing

### Engine — properties, not only examples

- **DS fusion:** commutativity, associativity, and the one that matters — a silent source does not move
  belief. `belief ≤ plausibility` as a property test over random mass assignments.
- **Each of R1–R6:** a crafted minimal case where that rule and only that rule decides the outcome.
- **Reinstatement:** a case where A defeats B, C defeats A, and B is correctly reinstated.
- **Determinism:** one case, a thousand runs, a single output hash.
- **Counterfactual:** exhaustive search checked against a brute-force oracle on random small cases.
- **Abstention:** fires at the pre-registered threshold and not a step before.

### Golden files

`results.json` and `metrics.json` are golden-filed. Any engine or rule change that moves a benchmark number
fails CI loudly. This is what guarantees the numbers on the slide and the code in the demo never drift apart:
the drift becomes a build failure rather than a discovery during Q&A.

### Contract tests

`evidence.json` validated against a zod schema before the harness runs, so a malformed prep output fails
early and legibly.

### Fallback tests

Each AI surface exercised against network-off, HTTP 500, malformed JSON, timeout, and missing key — asserting
the UI still renders and degrades to the **correct rung** of its ladder.

### Visual regression

A Playwright walk of all seven beats with screenshots, run before submission, to catch layout breaks that
would otherwise be found on stage.

### Explicitly not tested

LLM content quality. Only schema validity and failure behaviour are testable; pretending otherwise would be
dishonest.

---

## 12. Risks and honest limits

| Risk | Mitigation |
|---|---|
| Identifier crosswalk slips | 2 August data freeze; provenance badges absorb it; TAK-994 fixture inlined so the demo never depends on a pull succeeding |
| Genuine conflict cases sparse | Task-zero spike in week one; exact counts reported; any constructed adversarial cases labelled as constructed |
| LLM baseline matches on accuracy | Advantage becomes consistency, traceability, calibration. Reported honestly. |
| Preference ordering not reviewed by a practising toxicologist | Named as the top caveat before a judge names it; rules editable and versioned; expert review actively pursued |
| Planner priors expert-elicited rather than learned | Disclosed, and quantified by the sensitivity analysis |
| Hosting or billing surprise | Static build plus recorded walkthrough |
| Screen-share legibility | Designed for compression; verified on a real Teams share |

### Limits stated plainly

- ARBITER cannot invent signal that does not exist. A first-in-class mechanism with no precedent will not be
  predicted by any system. What ARBITER does is report wide uncertainty and route the case to a human — the
  safe failure mode.
- One case is an illustration, not proof. The aggregate numbers are the claim.
- The sample is small. Intervals and n are reported.
- The demo does not prove enterprise security. It runs on public data; the security architecture is a design
  commitment, not a demonstrated result.
- Two components rest on expert judgment rather than measurement — the preference ordering and the planner's
  priors. Both are explicit and editable, and expert review is the next thing needed.

### The applicability boundary: idiosyncratic DILI

**State this before a judge asks. A hepatotoxicity specialist will ask it with near-certainty, and volunteered
it reads as command of the field while extracted it reads as not having considered it.**

Drug-induced liver injury divides roughly into two classes:

| | **Intrinsic** | **Idiosyncratic** |
|---|---|---|
| Dose relationship | Dose-dependent, reproducible | Largely host-dependent |
| Mechanism | Findable in mechanistic assays | Often immune-mediated, HLA-associated |
| Incidence | Higher, appears in small cohorts | Rare — may not surface until thousands are exposed |
| Preclinical predictability | Tractable | Poorly predicted by standard models |

**Most clinically serious DILI is idiosyncratic**, which is precisely why hepatotoxicity leads post-market
withdrawals: it does not appear until large populations are exposed. No preclinical system predicts it — ours
included.

**What ARBITER actually addresses is the reconcilable fraction:** cases where the signal existed somewhere and
nobody put it together in time. TAK-994 is squarely in that class — 8 of 73 participants over enzyme thresholds
and 3 of 73 meeting Hy's Law is a high incidence, and a mechanism was found (hepatic single-cell necrosis
following CYP induction at clinically relevant doses). That pattern is intrinsic and mechanism-findable. **This
is exactly why it is the right demonstration case, and exactly why it does not generalise to idiosyncratic
DILI.**

**Why the failure mode is nonetheless the right one.** For a compound whose risk is idiosyncratic, mechanistic
evidence genuinely cannot resolve the question — and reporting that is precisely what a wide belief–plausibility
gap plus abstention *says*. A confident predictor on an idiosyncratic-risk compound would be actively
dangerous. ARBITER's behaviour on the hardest class of DILI is honest rather than confidently wrong, which is
the correct engineering outcome even though it is not a solution.

**What this means for the business case, honestly.** The addressable share is smaller than "a third of attrition
is toxicity" — it is the reconcilable part of that third. That does not weaken the arithmetic, because per the
Playbook's own asymmetry argument, *"we do not need to claim a large effect size for the arithmetic to work; we
need to claim a real one."* A narrower, defensible claim beats a broad, attackable one.

**Roadmap, not dead end.** Idiosyncratic risk is where HLA genotype, immune-competent liver co-culture models,
and post-marketing pharmacovigilance signals would enter as additional evidence streams. ARBITER's architecture
absorbs new streams by adding claim types and rules rather than by redesign, so the boundary moves as the
evidence base does.

---

## 12b. Q&A preparation — answers settled during design

The hardest questions, with the answer each design decision produces. Rehearse these separately from the talk.

| Question | Answer |
|---|---|
| **What about idiosyncratic DILI?** | See above. Name the class, name TAK-994 as intrinsic, explain that abstention is the correct behaviour, keep the claim narrow. |
| **Is this novel? Hasn't Dempster–Shafer been used in risk assessment?** | Yes it has — Park et al. 2014. The components are precedented; the assembly as contestable software is not, and the specific novel mechanism is that the planner is driven by the argument structure rather than generic assay informativeness. See §2a. |
| **You use an LLM as your baseline *and* in your product. Which is it?** | Models are used for **language** — parsing a sentence, matching a question to an anchor — and never for **judgment**. The navigator returns identifiers only and so cannot hallucinate. |
| **Did you tune the rules to fit DILIrank?** | The ruleset, abstention threshold and binarisation policy were committed with a published hash before evaluation, and reliability priors are fit on a train split the reported numbers never touch. Check the hash against the git history. |
| **Do you have accounts? Who signs?** | No accounts in the demo, deliberately — a login would stop you exploring it now. The record carries what a 21 CFR Part 11 signature requires, and `signatureMethod` is the only field deployment changes. See §7a. |
| **What if the committee splits 2–1?** | It is not a vote. Positions are recorded and dissent is preserved; one named owner signs and is accountable. Counts never determine the outcome. |
| **Isn't feeding it the mouse study hindsight?** | Yes, which is why the as-of control exists — move it yourself. Pass 1 uses only pre-first-in-human evidence, and ARBITER abstains and asks for that study. |
| **Your consistency claim is trivial — deterministic code is deterministic.** | Agreed, which is why we also report robustness under perturbation. The claim that matters is inter-reviewer consistency, and we cannot measure it without human subjects. We say so. |
| **Nothing in pass 1 contradicts anything. So what is there to arbitrate?** | Exactly the point, and it is the case most tools miss. Arbitration is not only about resolving contradictions — it is about deciding what evidence *licenses*. Four sources agreed, and not one measured a human endpoint at a clinically relevant dose. ARBITER discounts each for what it cannot support, the weight lands on *uncommitted*, and the gap opens. See §5. |
| **Isn't the discounting just a fudge factor to force the answer you wanted?** | The discounts are the same six pre-registered strengths as the defeats — one number per principle, hashed before any evaluation ran, with no separate knob. Disagree with a weight and you edit one value; both mechanisms move together. What we did *not* do is touch the abstention threshold, which is pre-registered precisely so the abstention rate cannot be tuned. |
| **Why does R3 only apply to negative findings? That looks convenient.** | It is R3's registered wording, written before we implemented it: *"defeats a negative finding whose margin is unstated or untested at that range."* A hazard signal at an unrecorded concentration is still a signal — you go and measure the margin next. An absence of signal at an unrecorded concentration tells you nothing about safety. The other five rules describe what *kind* of evidence a claim is and apply in both directions. |
| **Doesn't discounting make you abstain on everything?** | It nearly did, and we measured it rather than assumed it: applying R3 in both directions gave a lone hepatotoxicity finding a gap of 0.87 and would have abstained on essentially the whole evaluation set. The reported abstention rate is a headline metric for exactly this reason — a system that abstains on everything is useless, and we show the number rather than hide it. |
| **If R6 has no code of its own, is it really a rule?** | It has no *separate* code because Dempster's rule already is its mechanism — two independent sources at 0.18 fuse to 0.3276, one source repeating itself adds nothing. R6 is the reason we fuse rather than average. We did build an explicit concordance bonus on top and then deleted it: it double-counted, its coefficient was not pre-registered, and it could invert a verdict against the mass it was reported alongside. See §5. |
| **What is your biggest weakness?** | The preference ordering has not been reviewed by a practising toxicologist. It is drawn from published frameworks, but expert validation is the next thing we need. |

---

## 12a. Adoption, workflow fit, and patient impact

Absent from earlier drafts of this spec despite being central to two judged criteria — **Business &
Operational Feasibility** and the newly added **Pfizer & Patient Impact**.

### The adoption ladder

| Stage | What happens |
|---|---|
| **Shadow mode** | Runs in parallel on real cases; output reviewed but **never binding**. Pure validation, zero risk, no workflow change. This is where the track record is earned. |
| **Advisory** | Once the record holds, its evidence package becomes the official pre-read that frames the safety discussion. |
| **Integrated** | Part of the standard candidate-nomination package, feeding NAM submissions. |

**The human is the decision-maker at every stage.** Nothing about that changes as the ladder is climbed.

### Where ARBITER physically sits

The workflow today, in five steps:

1. Assays run; results land in separate systems — predictions in one place, in-vitro in a LIMS, omics in
   another, literature in people's heads and reference managers
2. A safety lead **manually** pulls results together and assembles an evidence package
3. Where sources conflict, the lead reconciles them from experience. **This reasoning is rarely written down
   in structured form**
4. The committee reviews, debates, decides — often re-deriving the same conflicts from scratch in the meeting
5. If the programme advances, the reasoning is reconstructed later for the submission, often by different people

**ARBITER occupies steps 2 and 3 only.** Steps 1, 4 and 5 are unchanged — and steps 2 and 3 are precisely the
manual, inconsistent, undocumented part.

| | |
|---|---|
| **Uses it directly** | The preclinical safety assessment lead — opens a compound, reads the reasoning, adjusts rules where their expertise disagrees, exports the package |
| **Consumes the output** | The safety review committee as a pre-read; regulatory affairs later, as the basis for the submission narrative |
| **Never touches it** | **Bench scientists generating the assay data.** Their workflow is completely unchanged |
| **Integrates with** | Lab notebooks, LIMS, assay databases. Wraps existing predictors rather than replacing them |

**"Bench scientists never touch it" is the strongest adoption line available**, because it means adoption
requires no change in laboratory behaviour — which is where technology rollouts in pharma usually die.

### Four channels of patient benefit

| Channel | Mechanism |
|---|---|
| **Fewer patients exposed to unsafe candidates** | Catching a reconcilable signal before first-in-human means the trial that would have injured participants never runs |
| **More safe medicines reaching patients** | Overly conservative review kills borderline candidates; naming the resolving experiment rescues them, and a rescued medicine is a treatment someone eventually receives |
| **Resources redirected to candidates that can work** | Every year spent advancing a doomed compound is not spent on one that could help. Earlier termination is a patient benefit, not only a financial one |
| **Fewer animals used** | Supporting the shift to human-relevant methods advances the **3Rs** directly — and human-relevant evidence is also *better* evidence for predicting human outcomes |

**The line for the patient-impact slide:** *Three people in that trial developed serious liver injury. The
signals that pointed to it existed, scattered across species and assays that disagreed with each other. Nobody
had a structured way to put them together in time. That is the problem we are solving, and that is who we are
solving it for.*

---

## 13. Pfizer values, mapped to decisions

- **Courage** — makes disagreement visible instead of averaging it away, and preserves dissent in the record.
  Enables a confident *go*, not only a cautious *no*.
- **Excellence** — pre-registered hashed ruleset, deterministic engine, golden-file CI, versioned rule changes.
- **Equity** — the reasoning is readable by everyone at the table, so decision authority is not gated on who
  can read a model's weights. Human-relevant evidence over animal proxies. Colour-blind-safe encoding.
- **Joy** — removes the grinding evidence assembly and the re-litigating of the same conflict across four
  meetings.

This belongs in the deck. **In the app it appears exactly once, implicitly, in the consensus record that
preserves dissent.** Values plastered across an interface read as pandering and judges notice.

---

## 14. Schedule

| Window | Work |
|---|---|
| **Jul 26 – Aug 2** | **Order matters here.** (1) Task-zero conflict spike. (2) **Data layer first** — assemble compounds, crosswalk identifiers by structure, normalise each stream to a common scale; the playbook names this the hidden time sink. (3) R1–R6 plus abstention threshold and binarisation policy pre-registered, hashed, committed *before any evaluation*. (4) Conflict detection defined in code. The engine is developed **in parallel** against the TAK-994 fixture, since it is pure and depends on no real data. **Data freeze 2 August.** |
| **Aug 3 – Aug 9** | Harness, four baselines, ablation runs, metrics, sensitivity analysis, golden files. Web shell, workbench, trace, belief track. |
| **Aug 10 – Aug 14** | Deliberation Room, three AI surfaces with full fallback ladders, export, spotlight and tour, motion, Playwright walk, Teams-share test, static build. |
| **Aug 15 – Aug 16** | Deck on real numbers, recorded walkthrough, rehearse to 14:00, **submit early.** |

**A nearer deadline than Aug 16:** the next ambassador check-in expects **the demo and the business
presentation**. Whatever exists then is what gets feedback, so a thin end-to-end slice beats a polished
fragment. Roughly 22 teams are in this round; the mentor's guess at advancement was around half but he was
explicit that he did not know — treat as unknown.

### Roadmap beyond Round 1, in order

Generalise beyond liver to **cardiotoxicity** then mutagenicity — the reasoning engine is endpoint-agnostic, so
extending means adding evidence streams and pathway-specific rules, not rebuilding. Wire in real prediction and
assay pipelines. Add **organ-on-chip** readouts as an evidence stream: it is named explicitly in the FDA's NAMs
roadmap and is what a NAMs-literate audience is tracking. Then internal shadow-mode pilot on one team and one
endpoint, validated against historical decisions.

### Cut order, decided now while it is cheap

If behind: **navigator (surface 3) → live ablation garnish → evidence-package export → motion Level 2 down to
Level 1.**

**Never cut:** engine determinism tests, the argument trace, the belief–plausibility track, the consensus
record. Those four are the product.

Deciding this now means that at 11pm on 14 August the decision is already made and nobody argues about it.

---

## 15. Sources to verify before presenting

Every claim below must be checked against the primary source before it appears in the deck. A Pfizer audience
is exactly the audience that will catch an error about Pfizer.

1. TAK-994 mechanistic investigation, *Toxicological Sciences* (2025) 204(2):143 — rat and primate studies
   missing the liability, murine single-cell necrosis after CYP induction, wide in-vitro margins.
2. TAK-994 Phase 2 results, *NEJM* (2023), and Takeda's termination announcement — 73 patients, eight
   enzyme-threshold cases, three Hy's Law cases.
3. FDA, *General Considerations for the Use of New Approach Methodologies in Drug Development*, draft
   guidance, March 2026 — the weight-of-evidence pathway.
4. FDA, *Roadmap to Reducing Animal Testing in Preclinical Safety Studies*, April 2025; FDA Modernization
   Act 2.0, 2022.
5. ICH M3(R2) and S9 — two-species repeat-dose requirement before first-in-human.
6. FDA DILIrank / Liver Toxicity Knowledge Base — ground-truth classifications.
7. Klimisch et al. (1997) — study reliability scoring. OECD AOP handbook and AOP-Wiki — key-event confidence.
8. Cost figures — Tufts CSDD analyses (capitalised cost per approved drug ≈ $2.23bn in 2024 for major
   biopharma; the widely cited Tufts figure is $2.6bn in 2013 dollars); Wong et al. and Tufts phase-transition
   data (roughly 10–14% of drugs entering Phase 1 reach approval); Tufts 2014 and the Institute for Safe
   Medication Practices analysis (average Phase 3 ≈ $255m; median pivotal trial ≈ $48m, IQR $20–102m);
   Martin et al. (2017) median per-phase costs (≈ $3.4m Phase 1, $8.6m Phase 2, $21.4m Phase 3).
   **Present as ranges with attribution; the literature is contested by an order of magnitude depending on
   methodology, mostly over whether capital and failure costs are included. A Pfizer judge will know this
   literature far better than we do, and acknowledging the controversy is safer than quoting one number as
   fact.**
9. DILI attrition and withdrawal literature — hepatotoxicity as a leading cause of development termination
   and post-market withdrawal.

---

## Appendix A — Decisions locked during design

| Decision | Choice |
|---|---|
| Product centre | Deliberation Room — ARBITER argues, humans challenge, humans record consensus, dissent preserved, ARBITER never votes |
| AI surfaces | Interpreter live with cached fallback; ablation pre-computed with a live spot-check garnish; navigator non-generative, returns identifiers only |
| Data strategy | Real-data-first with provenance badges as the safety net; 2 August freeze |
| Engine location | Pure TypeScript, runs in both Node harness and browser — one source of truth |
| Hosting | Railway (static app plus API in one service), with a fully static build as backup |
| Navigation | Five tabs at the concern boundary (Compounds · Case · Ruleset · Validation · Record), hash router so the static build works over `file://`. The Case tab does not split. |
| Interface shell | Within the Case tab: workbench with an enlarging spotlight |
| Identity | No accounts. Persona switcher — better for the demo, not merely cheaper. Record model built as though authenticated; `signatureMethod` is the only field deployment changes. |
| Decision model | Positions recorded, dissent preserved, one named owner signs. **Not voting.** Counts never determine the outcome. |
| Visual identity | Editorial discipline on Pfizer's palette |
| Motion | Level 2 staged, with kill switch |
| Build ownership | Claude builds; team owns science review, validation, deck, rehearsal |
| TAK-994 handling | Two-pass as-of-date replay; motivating case only; excluded from all metrics |
| Novelty claim | Precise, with a prior-art landscape slide. No "first system to." The specific novel mechanism is argument-structure-driven experiment planning; the methodological contribution is the as-of prospective replay |
| Uncertainty | Dempster–Shafer belief/plausibility **plus split conformal** on the QSAR stream, giving a guaranteed coverage level and a principled applicability-domain flag |
| Data splits | Three-way train / calibration / test, boundaries and seed fixed before any fitting. A correctness constraint — reliability priors fit on train only, never on the evaluated data |
