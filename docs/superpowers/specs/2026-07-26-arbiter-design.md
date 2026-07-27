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

### Language discipline (non-negotiable across code, UI copy, and deck)

| Say | Never say |
|---|---|
| review-ready evidence package | regulator-ready dossier |
| consistent, defensible | fast |
| ARBITER's position | ARBITER's decision |
| the committee decides | the system decides |

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
Authentication or real accounts — other reviewers are seeded personas. Runtime data pulls. Live AOP-Wiki
SPARQL queries.

### Mechanistic grounding decision

Rather than a separate Adverse Outcome Pathway visualisation, AOP provenance appears **on the rules**: R2
cites the specific key event it relies on, drawn from a small curated AOP subset shipped with the app. This
buys mechanistic credibility without a second graph view competing with the argument trace for attention.

---

## 3. The demo — seven beats, 240 seconds

TAK-994 is run as a **two-pass replay** driven by an evidence `availableFrom` date and an "as of" control in
the UI. Pass 1 uses only evidence that existed before first-in-human dosing. Pass 2 adds what was learned
later.

| # | Beat | Time | Content |
|---|---|---|---|
| 1 | The desk, before first-in-human | 20s | Rat clean · primate clean · in-vitro margin >100× · QSAR ambiguous. Conflict rate across the whole assembled set shown, so the case is visibly not cherry-picked. |
| 2 | What happens today | 30s | Majority vote → advance. Weighted average → advance. Best single source → advance. LLM given identical evidence → advance, with a confident number. |
| 3 | ARBITER's argument | 55s | Rat and primate defeated by R1. In-vitro margin defeated by R3. QSAR downweighted by R4. Little survives as evidence either way. Verdict: **ABSTAIN**. |
| 4 | The honest gap, and what would flip it | 30s | Belief–plausibility gap opens from centre — the widest in the set. Then the exhaustive counterfactual. |
| 5 | The experiment it asks for | 50s | Planner names the murine CYP-induction study at clinically relevant dose. Reveal: that is the study Takeda ran, during Phase 2, after three participants met Hy's Law. Then the result is fed in and the verdict flips live to **DO NOT ADVANCE**. |
| 6 | The table | 35s | Challenge in plain English → interpreted → proposed change shown → applied → re-run → delta. Two agree, one dissents, all recorded. ARBITER did not vote. |
| 7 | What the numbers say | 20s | Determinism *and* robustness. LLM variance. Conflict-subset accuracy vs four baselines with n, intervals, and coverage. |

### Why the two-pass structure is mandatory, not stylistic

The murine toxicogenomic study was initiated **during** the Phase 2 trial. Presenting it as input to a
pre-first-in-human decision is hindsight, and it is the single most attackable thing in the demo. The
two-pass replay removes that vulnerability and produces a stronger result: in pass 1 ARBITER abstains and
*requests the very study that history proves was the right one*. That is a forecast, not a retrodiction.

The `availableFrom` field plus the "as of" control generalises — any compound can be replayed as of any
date — so this is a real capability being exercised, not a scripted special case. A judge can move the
control themselves.

### Speaker lines that belong on screen

- Beat 3: *"You are not being asked to trust this. You are being asked to read it."*
- Beat 3: *"Note what it did not do. It did not say this drug is toxic. It said it cannot tell you yet."*
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

### Abstention

Triggers when the belief–plausibility gap exceeds a threshold, or when the dominant streams fail their
applicability domain. **The threshold lives in the pre-registered ruleset** so it cannot be tuned after
results are seen. **Proposed starting value: gap > 0.50.** The final value is committed to
`ruleset-v1.0.json` before any evaluation runs and is not changed afterwards; if it proves badly chosen, that
is reported as a finding rather than quietly corrected.

### Counterfactual — exhaustive, not heuristic

With at most six claims per compound, each assertion is flipped, the engine re-run, and the minimal set that
changes the verdict identified. Six re-runs of a pure function. Exact, with nothing to defend.

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
| Open TG-GATEs | Toxicogenomics | A week minimum; raw CEL files; predominantly rat liver | 5 — literature fallback expected |

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
- Conflict subset reported separately from overall — overall accuracy is inflated by easy unanimous cases
- Repeat runs for the stochastic pipeline; identical treatment applied to ARBITER
- Wilson confidence intervals, explicit n, and confusion matrices rather than bare accuracy

**DILIrank binarisation, pre-registered:** vMost + vLess = positive; vNo = negative; Ambiguous reported
separately rather than quietly dropped.

### Metrics, in priority order

| # | Metric | Definition |
|---|---|---|
| 1 | Conflict-subset balanced accuracy | Against all four baselines. The headline. |
| 2 | Decision consistency **and robustness** | Determinism (trivially 100%) reported *alongside* stability under perturbation: evidence `strength` jittered by **±10%** and rule `strength` varied by **±25%**, over **2,000 samples** per compound, reporting the share of samples returning the original verdict. A deterministic but knife-edge system is not consistent in any useful sense. |
| 3 | Uncertainty calibration | Coverage *and* mean interval width, both reported — a wide-but-always-right interval is worthless. |
| 4 | Abstention quality **with coverage** | Accuracy on committed cases reported *inseparably* from the decline rate. 85% accuracy while abstaining on 60% of cases is meaningless, and reporting accuracy alone would silently inflate the headline. |
| 5 | Planner sensitivity | Share of cases where the top recommendation survives **±50%** perturbation of the outcome priors, over **2,000 samples**. Converts a stated limitation into a measurement. |

### Where the randomness lives

Metrics 2 and 5 require sampling, but the engine forbids `Math.random`. **The harness owns all randomness**,
using a **seeded PRNG with the seed committed alongside the results.** The engine remains a pure function
receiving already-perturbed inputs. This keeps determinism intact *and* makes the robustness figures
reproducible — which they must be, since they are golden-filed.

### Prepare for a mixed result

If the LLM baseline matches on accuracy, the advantage becomes consistency, traceability and calibration —
which are likely the real advantages regardless. Report what is found. An honest mixed result with a clear
interpretation is more credible than a suspiciously clean sweep.

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

### Shell — workbench with an enlarging spotlight

Three regions (evidence · trace · table) plus top bar and tour footer, laid out with CSS grid. The spotlight
is a `grid-template-columns` transition: the focused region grows to presentation size and the others
collapse to 56px rails that still show every evidence verdict and reviewer state as coloured dots — so a
judge can see nothing was hidden from them.

**Tour state is `{ beat: 0..6, focus: 'evidence' | 'trace' | 'table' | null }`** — presentational only and
structurally unable to touch data, so the two modes cannot disagree with each other.

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
| **Jul 26 – Aug 2** | Task-zero conflict spike. Engine plus R1–R6 pre-registered, hashed, committed. Python prep, `evidence.json`, TAK-994 fixture. **Data freeze 2 August.** |
| **Aug 3 – Aug 9** | Harness, four baselines, ablation runs, metrics, sensitivity analysis, golden files. Web shell, workbench, trace, belief track. |
| **Aug 10 – Aug 14** | Deliberation Room, three AI surfaces with full fallback ladders, export, spotlight and tour, motion, Playwright walk, Teams-share test, static build. |
| **Aug 15 – Aug 16** | Deck on real numbers, recorded walkthrough, rehearse to 14:00, **submit early.** |

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
8. Cost figures — Tufts CSDD analyses; Martin et al. (2017) per-phase costs. **Present as ranges with
   attribution; the literature is contested by an order of magnitude depending on methodology.**
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
| Interface shell | Workbench with an enlarging spotlight |
| Visual identity | Editorial discipline on Pfizer's palette |
| Motion | Level 2 staged, with kill switch |
| Build ownership | Claude builds; team owns science review, validation, deck, rehearsal |
| TAK-994 handling | Two-pass as-of-date replay; motivating case only; excluded from all metrics |
