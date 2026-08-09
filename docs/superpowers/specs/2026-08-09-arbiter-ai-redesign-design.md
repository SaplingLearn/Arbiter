# ARBITER — AI redesign

**Status: design, agreed 2026-08-09. Supersedes the decision architecture of the
2026-07-26 master spec. Does not supersede its language discipline, its record model,
or its problem statement.**

---

## 0. Why this document exists

On 2026-08-09 we audited the shipped numbers against the underlying data and found the
benchmark could not support the claims being made on it. Three findings, all measured
from files in this repo, all reproducible:

**1. The positive class is not hepatotoxicity.** The pre-registered binarisation policy
counts `vMost-DILI-concern` and `vLess-DILI-concern` together as positive. That makes
**330 of the 536 positives (62%) "Less concern"** — a class containing aspirin,
amoxicillin, atenolol, amlodipine, alprazolam, acyclovir, azithromycin, ampicillin,
apixaban and anastrozole. The labels are not wrong; DILIrank's severity grades are
defensible. **Collapsing them is what breaks the target.** A system that correctly
declines to flag amlodipine is scored as wrong.

**2. ARBITER has never identified a safe compound.** Its confusion matrix on the
conflict subset is `tp 4 / fp 0 / tn 0 / fn 0`. Zero true negatives. The reported
balanced accuracy of 0.750 is **sensitivity 1.0 averaged with a 0.5 convention for a
specificity that was never measured**, on n=4. `metrics.json` records this itself:
`singleClass: true`, `balancedAccuracyCi: null`, and a raw-accuracy CI of
**0.51–1.00**, an interval that excludes nothing.

**3. The engine detects mechanism and reports severity.** Across the full test split it
commits on 7 of 267 compounds. Two are `vMost` (sorafenib, cyclosporine — genuinely
hepatotoxic). **The other five are `vLess`: prochlorperazine, thioridazine, glyburide,
mifepristone, irbesartan.** Every one of the five is a real bile-transport (BSEP)
inhibitor, so the engine found something true — phenothiazine cholestasis is textbook.
It then said *do not advance* about approved, widely prescribed drugs.

That is the defect, and it is structural rather than a tuning error: **the ruleset has
no vocabulary for severity.** All six rules govern how much to trust a piece of
evidence. None describes what liver injury is, how much drug is taken, which kind of
injury occurs, whether it reverses, or how often it happens. A system with no severity
inputs cannot produce severity judgments, and no threshold change fixes that.

### The deeper finding, which decided the redesign

**The benchmark was answering a different question than the product asks.**

| | question |
|---|---|
| **Benchmark** | Given a drug marketed for decades, predict what its FDA label says about the liver. |
| **Product** | Given a novel compound with no human data and contradictory lab results, should it go into people? |

DILIrank labels derive from post-market human experience. That is information a
preclinical team does not have at the moment the decision is made. Optimising against
it turned ARBITER into a *predictor* competing with a crowded field, when its stated
claim — in the README, unchanged since July — was **consistent and defensible decisions
under conflict.** Prediction accuracy was never the claim. It should never have been
the measurement.

---

## 1. The claim, restated

> When preclinical evidence about a compound conflicts, ARBITER reaches the same
> conclusion every time, states exactly what is still missing, and leaves a record
> anyone can reconstruct two years later. The safety lead decides. The reasoning stops
> living in their head.

Three properties, in priority order. **Note that accuracy is not first, and one of the
three needs no ground truth at all:**

1. **Consistency** — identical evidence yields an identical recommendation. Measurable
   without an answer key. This is the property human committees demonstrably lack.
2. **Recoverability** — the reasoning behind any past position can be reconstructed
   exactly, against the evidence and ruleset version in force at signing.
3. **Calibration on the reconcilable fraction** — on historical cases where the signal
   existed preclinically and was not assembled, does it flag? And on compounds with
   alarming preclinical signals that proved fine, does it decline to?

We do not claim to predict idiosyncratic DILI. Nothing does. The master spec's §12
boundary stands unchanged and remains the honest answer.

---

## 2. What is kept, what is replaced

### Kept

| | why |
|---|---|
| **The signed record** (`evidenceSnapshotHash`, `rulesetHash`, `prevRecordHash`, dissent preserved, one accountable signer) | Independent of who reasons. It is the strongest built artifact in the repo and it is what makes this enterprise software rather than a chat interface. Unchanged. |
| **The six rules, as required disclosure** | Sound, standard evidence-weighing doctrine. They were never the defect. Being the *sole decider* over six data fields was. |
| **The problem statement and language discipline** | §1.3 of HANDOVER applies verbatim to every generated sentence, and is enforced on model output. |
| **`packages/engine` as a scoring and consistency harness** | Pure, deterministic, well tested. It stops being the decider and becomes the thing that checks the decider. |

### Replaced

| | why |
|---|---|
| **The engine as decider** | Commits on 7/267; 5 of 7 are over-calls. Not recoverable by tuning. |
| **Dempster–Shafer fusion as the verdict path** | The belief–plausibility gap rule produces 97.4% abstention and bought no measurable accuracy. It stays available as a diagnostic, not as the gate. |
| **The binarisation policy** | Requires a v1.1 re-registration. See §4. |
| **Six fixed rules as the whole rulebook** | Becomes a growing, versioned checklist. See §5. |

**This is a v2.0 re-registration, not an edit.** `rules/ruleset-v1.0.json` is never
modified. A new `rules/ruleset-v2.0.json` is committed with its own hash and a written
rationale, and every position signed under v1.0 remains attached to v1.0.

---

## 3. Architecture

One direction, no cycles.

```
study PDFs / labels / assay exports
            |
            v
   [ AI extraction ]  -> structured findings, SHOWN FOR APPROVAL, never auto-accepted
            |
            v
   [ AI adjudication ] -> verdict + severity + per-rule disclosure + citations
            |            (must address every registered rule; may propose new ones)
            v
   [ deterministic checks ] -> every cited number matched against the findings;
            |                  language discipline enforced; unmatched claims blocked
            v
   [ the Finding ]    -> plain-English conclusion + what is still missing
            |
            v
   [ signed record ]  -> hash-chained, bound to evidence + ruleset version
```

**Three properties this shape guarantees.**

- **Nothing the AI extracts is used before a human approves it.** Extraction is a
  proposal surface, exactly as the challenge interpreter already is.
- **Nothing the AI asserts is displayed unless it matches the findings.** The check is
  deterministic code, not a second model. A number the AI invented does not render.
- **The AI never touches the record.** Hashing, chaining, and versioning stay in plain
  code with no model in the path.

### The verdict is two questions, not one

The single biggest correction from the audit. These were conflated, and that conflation
produced all five over-calls:

| | question | what answers it |
|---|---|---|
| **Mechanism** | Is there a plausible route by which this compound injures the liver? | Assay evidence. The current engine is genuinely decent here — it surfaced five real BSEP inhibitors unprompted. |
| **Consequence** | Is it severe enough to stop the programme? | Daily dose, injury type, exposure margin, reversibility, expected frequency. **None of this exists in the current pipeline.** |

The output states both, separately. *"Cholestatic mechanism present; at 150 mg/day with
a 40× margin and a reversible pattern, not disqualifying"* is a useful sentence.
*"Do not advance"* about irbesartan is not.

### 3.1 The backend — the first real one in this project

Until now the app has been a static artifact with no server and no persistence. Accounts,
shared cases and a live multi-party debate all require state that outlives a page
refresh, so this is a genuine architectural addition rather than a feature.

| | |
|---|---|
| **Identity** | Email/password to start, with the same `signatureMethod` seam the record model already carries (`demo-persona` \| `sso`). SSO changes one field and nothing else. |
| **Storage** | Postgres. Cases, documents, extracted findings, ruleset versions, per-user lenses, positions, and the hash chain. |
| **Documents** | Object storage for uploaded PDFs. The extracted findings reference the source document and page, so every finding can be traced back to the sentence it came from. |
| **API** | The web app stops owning data. It reads and writes through the service. |
| **Liveness** | Polling on the case view is sufficient. A debate updates within a second or two of a colleague signing; websockets are an optimisation, not a requirement. |

**The record model does not change.** `evidenceSnapshotHash`, `rulesetHash`,
`prevRecordHash` and preserved dissent were built as though authenticated. Adding real
identity is what they were designed for.

**Consequence, accepted 2026-08-09:** the single-file `file://` build can no longer
adjudicate, because adjudication needs the service. `apps/web/e2e/static-file.spec.ts`
is re-scoped to guard that the app *loads and explains itself* offline rather than that
it reasons offline.

### 3.2 Absence is a finding, and must be stated

A universal system will constantly be handed incomplete evidence. **Silence about a gap
is the failure mode this whole project exists to prevent** — TAK-994's package looked
complete.

So for every case the system states, explicitly, what it looked for and did not find:

> *No exposure data. We searched the uploaded documents for dose, Cmax, and exposure
> margin and found none. Without it, R3 cannot distinguish a genuinely clean result from
> one tested below the range that matters — and 2 of your 4 findings are clean results.*

Two rules govern this surface:

1. **Named, not counted.** "3 fields missing" is useless. Which fields, why each matters
   here, and what it blocks.
2. **Distinguish absent from negative.** *"No transporter assay was run"* and *"the
   transporter assay was negative"* are different facts and must never render alike.

---

## 4. Data

### 4.1 The answer key

**LiverTox (NIH/NIDDK) becomes the primary label source.** Over 1,000 drugs, each with
injury pattern, latency, severity, mechanism, dose relationship, and a **seven-level
likelihood score** (A >50 published cases · B 12–50 · C 4–12 · D 1–3 · E no credible
evidence despite wide use · E\* suspected-unproven · X insufficient data).

That scale grades *strength of evidence*, which is the right axis. Under it, irbesartan
and cyclosporine do not share a bucket.

**LiverTox is prose.** That is precisely why no fixed pipeline in this field uses it as
a structured input, and precisely why an AI can. The same extraction capability the
product needs for study PDFs builds the answer key. One build, two uses.

**DILIst** (FDA, 1,279 drugs, 768 positive / 511 negative) replaces DILIrank as the
breadth dataset — larger and far better balanced than the 890 currently in use.

**Precedence, so no compound has two labels.** Where LiverTox carries a monograph, its
likelihood score is the label and DILIst is ignored for that compound. DILIst supplies
coverage only where no monograph exists, and any compound labelled from DILIst alone is
flagged as such in the results so a mixed-provenance figure can never be quoted as a
single number.

**DILIN** (899 adjudicated patient cases with severity, outcome, latency, formal
causality scoring) is roadmap. It requires a formal request to the NIDDK repository and
ships as SAS files. Named here so it is not rediscovered as novel later.

### 4.2 New inputs, in descending value

| input | source | why |
|---|---|---|
| **Daily dose** | FDA labels / DailyMed | Among the strongest single DILI predictors known. Currently absent entirely; a 5 mg and a 2,000 mg drug are treated identically. |
| **Lipophilicity (logP)** | public chemistry databases | Pairs with dose in the well-established "rule of two". |
| **Injury pattern** | LiverTox | Hepatocellular vs cholestatic. The distinction that explains all five over-calls. |
| **Reversibility / adaptation** | LiverTox | A transient enzyme rise that resolves on continued dosing is not a programme stopper. |
| **Expected frequency** | LiverTox likelihood score | 1-in-50,000 is not preclinically findable and should not block. |

### 4.3 The leakage wall — non-negotiable

**LiverTox is a label source and must never reach the model as an input feature.** An
AI that reads a LiverTox monograph and then predicts that drug's hepatotoxicity has read
the answer. It would score near-perfectly and mean nothing.

Enforcement is structural, not procedural: extraction for labels and extraction for
inputs run as separate jobs writing to separate files, and the adjudication prompt is
assembled from the input file only. A test asserts no label-derived field appears in any
adjudication payload. This is the direct descendant of `test_qsar_leakage.py`, which
guards the same class of error for the split, and it carries the same weight: **if this
wall fails, every number downstream is void.**

### 4.4 The three test groups

A one-directional test set measures only willingness to say "danger", which is exactly
the failure §0 found. Three groups, and **all three are required**.

#### Group 1 — preclinical missed it, humans were harmed

Eight drugs were withdrawn for hepatotoxicity between 1997 and 2016: **tolcapone,
troglitazone, trovafloxacin, bromfenac, nefazodone, ximelagatran, lumiracoxib,
sitaxentan.** The literature states that **tolcapone, ximelagatran and lumiracoxib
showed no hepatotoxicity in preclinical animal studies at all.** Add **fialuridine**
(1993, deaths in an NIH trial, every animal study clean — the most documented failure in
the field) and **fasiglifam / TAK-875** (Takeda, phase 3 halted 2013 for liver failure).

TAK-994 stays the anchor. **Do not build the set predominantly from Takeda compounds** —
TAK-875 and TAK-994 together read as picking on one sponsor rather than describing a
field-wide problem.

#### Group 2 — real mechanism, fine in practice

**Already in the data, free.** ARBITER's five over-calls: **prochlorperazine,
thioridazine, glyburide, mifepristone, irbesartan.** Every one is a genuine BSEP
inhibitor; every one is approved and widely prescribed. A system that flags these is
crying wolf, and §0 is the measurement of what happens when nothing checks for it.

#### Group 3 — genuinely clean, and the reason it matters

**LiverTox category E** is exactly this group, defined by the source itself: *widespread
use, no credible evidence of liver injury.* Category **E\*** (suspected but unproven) is
deliberately excluded — the point of this group is that there is nothing to find.

Group 3 is not padding. **It is the only group that can test §5a.3** — whether an
objection with no evidence behind it is visibly distinguishable from one with evidence.
On a category-E compound there is nothing for a dissent to cite, which makes it the
cleanest possible demonstration.

#### What each group proves

| group | passing behaviour |
|---|---|
| 1 | flags, or states plainly what is missing and what would find it |
| 2 | reports the mechanism, declines to call it disqualifying |
| 3 | commits to no concern, and an unsupported objection is visibly unsupported |

**Honest limit.** Reconstructing "what was known before first human dose" is manual
literature work and, for the older compounds, partly inference from retrospective
papers. Expect on the order of ten defensible reconstructions, not fifty. **Report n and
call it calibration, never accuracy.**

---

## 5. The rules, reworked

### The change

Today the six rules **are** the reasoning: six checks, and whatever falls out is the
answer. That is why cases the rules do not cover produce nothing useful, and why **140
of 267 compounds carry a single claim** — leaving the three comparative rules with
nothing to compare.

Under the redesign: **the AI reasons; the rules are what it must address.**

Before any verdict is emitted, the model states its position on every registered rule,
citing the finding it relies on. *"Dose is 400 mg/day, above the risk threshold."*
*"Injury pattern is cholestatic, typically reversible."* *"The clean rodent study
carries little weight — run at 3× where humans see 30×."* **A rule that does not apply
must be stated as not applying, with a reason.** That is information, not a gap.

The rules become a **disclosure requirement**, not a straitjacket. The AI may reason
about matters no rule covers; it may not skip what the rules require.

### The ruleset grows, and versions

When the model's reasoning turns on a principle no registered rule covers, **it proposes
a new rule.** The team adopts it or rejects it. Adoption mints a new ruleset version
with a new hash.

**Every past position stays bound to the version under which it was signed.** That is
already how `rulesetHash` works in the record model, so growth costs no auditability:
the rulebook can expand indefinitely and nobody can claim a rule was changed to fit an
answer. The ruleset becomes the team's accumulated reasoning — an asset that appreciates
with use rather than a fixed liability.

### Seed set for v2.0

The six current rules, plus the categories the audit found missing: **dose magnitude ·
injury pattern · reversibility and adaptation · expected frequency · reactive-metabolite
formation · latency and dechallenge.**

Clinical hepatology already scores causality on a multi-domain weighted checklist
covering timing, dechallenge, alternative causes and prior reports. It is built for
diagnosing a patient rather than screening a candidate, so it does not transfer
directly — but its *shape* is evidence that "many weighted factors applied as a
checklist" is how the field actually reasons, and that six is too few.

---

## 5a. Scientists, lenses, and the crux

### 5a.1 A lens per account

Each account owns a **lens** — that person's settings for how much each registered rule
weighs. It is theirs, it persists, and it applies to every case they open. A lens is a
first-class object with its own version history, because *"what was Chen's lens when
Chen signed this"* has to be answerable years later.

Every case is evaluated through **every participating lens at once**. Two outcomes:

- **All lenses agree** → settled. Say so and stop discussing it.
- **They diverge** → open the crux view.

### 5a.2 The crux view — the primary screen

The observation this rests on: **people who disagree agree about almost everything.** Two
safety leads agree on eleven judgments out of twelve and burn an hour on the twelfth
without ever isolating which one it is.

So the screen's job is to locate that one thing and put it in the middle: everything the
lenses agree on, collapsed to a line each; the specific judgments where they diverge;
and of those, **which ones actually change the outcome.** A disagreement that changes
nothing is noted and set aside — that is a result, not a gap.

Then the loop closes: **the crux is handed to the experiment planner**, which already
answers *"which rule is the verdict resting on, and what evidence would overturn that
specific rule?"* A disagreement becomes a research question with a named next step.

**Disagreement → the exact question it turns on → the experiment that settles it.** That
motion is the product.

### 5a.3 A position must cite what it rests on

**New requirement, and the reason group 3 exists.**

Recording a position — agree, dissent, or abstain — requires citing the findings it
rests on. The system then checks, deterministically, two things: **do the cited findings
exist in this case**, and **are they relevant to the rule being invoked**. A position
citing nothing is stored and displayed as **unsupported**.

**Unsupported does not mean deleted, and it does not mean overruled by headcount.**
Dissent is preserved permanently — that is the record's entire purpose, and §7a of the
master spec killed vote tallies for a reason that still holds: if a count decides, the
group can outvote the accountable owner and nobody is accountable.

What changes is that the *basis* of every position is now visible. The decision owner
signing off can see that three positions cite specific findings and one cites nothing.
**They still decide. They can no longer do it without noticing.**

On a group-3 compound there is nothing available to cite, which makes the distinction
unmissable and is exactly why that group is in the test set.

### 5a.4 What is deliberately not built

**No consensus mechanism, no quorum, no threshold to proceed.** A committee advises; one
named individual signs. Every mechanism that would relieve that person of the decision
is out of scope on purpose, not for lack of time.

---

## 6. Validation — three measurements

### 6.1 Consistency (needs no answer key; this is the primary claim)

Run the same case N times. Run near-identical cases that differ only in ways no rule
makes relevant. **Report the flip rate.**

This is the direct evidence for claim 1, and it is where an AI decider is structurally
weakest — which is exactly why it is measured first and published whatever it says. A
3% flip rate is a strong result against human committee variance. A 30% flip rate is a
defect we must find ourselves rather than have a judge find.

Mitigations, applied before measuring: deterministic decoding settings, a fixed
reasoning structure the model fills rather than free-writes, and structured output
rather than prose for the verdict fields.

`packages/engine` runs this harness. The pure deterministic core becomes the instrument
that measures the AI.

### 6.2 Historical replay (the calibration claim)

Reconstruct **only the evidence that existed before first human dose** for compounds
whose outcome is now known, and ask whether the system flags them.

**Both directions are mandatory.** Cases that failed in humans *and* cases with alarming
preclinical signals that proved fine. A one-sided replay measures only willingness to
say "danger", which is the exact failure the audit found.

TAK-994 is the anchor case and remains outside any benchmark. Honest constraint: n is
small, because reconstructing what was known and when is manual work. **Ten defensible
replays beat 267 mislabelled compounds**, and they test the actual product question.

### 6.3 Recoverability

Binary and demonstrable: select any signed position, reconstruct the evidence, the
ruleset version, and the argument that produced it. Already true of the record model;
now stated as a measured claim rather than a feature.

### What is no longer reported

Balanced accuracy on the DILIrank conflict subset. It measured the wrong question against
a broken target on n=4. **§0 of this document replaces it, and the finding is presented
rather than buried** — a team that audited its own benchmark and found it unsound is more
credible than one that shipped the number.

---

## 7. Build order

Each phase is independently useful and ends in something demonstrable.

| # | phase | why here |
|---|---|---|
| **1** | **v2.0 re-registration** — new ruleset file, new hash, written rationale, severity-aware target definition | Must precede any measurement, so no one can claim the target moved after seeing a score. Cheap. Blocking. |
| **2** | **Document intake** — upload a PDF, AI extracts findings with source page, shown for approval, never auto-accepted | The capability everything else needs, and what makes the system universal — a novel compound is in no database, but its study report is a document. Also builds the answer key (§4.1). |
| **3** | **AI adjudication** — verdict, severity, per-rule disclosure, citations, deterministic verification of every cited number, and §3.2's named-absence report | The product. |
| **4** | **Backend and accounts** — Postgres, identity, document storage, the API the app now reads through | Blocking for everything multi-party. Start in parallel with 2; it shares no code with the AI work. |
| **5** | **Consistency harness** — flip-rate measurement over repeated runs | The primary claim. Must land before any presentation quotes a number. |
| **6** | **Lenses and the crux view** — per-account rule settings, all lenses evaluated at once, crux isolated and routed to the planner | The live debate. Needs 4. |
| **7** | **Cited positions** — positions cite findings, unsupported ones are labelled as such, dissent preserved | Small once 4 and 6 exist. The demo beat that group 3 was assembled for. |
| **8** | **The Finding** — plain-English conclusion, what is missing, what to test next; signed into the record | The deliverable a team carries into a meeting. |
| **9** | **The three test groups** — assemble groups 1, 2 and 3; group 2 is free, group 3 is a LiverTox category-E filter, group 1 is manual | Manual and slow, highest evidential value. Start collecting during 2–5. |
| **10** | **Rule proposal and versioning** — model proposes, team adopts, hash mints | Makes the ruleset an appreciating asset. Last because it is the only phase with no consumer waiting on it. |

**Two tracks, deliberately.** Phases 2–3 and 5 are AI work. Phase 4 is backend work. They
share nothing and should run in parallel rather than in sequence.

**Timeline honesty.** Submission is 16 August; this is written on 9 August. Phases 1–3
plus a partial 5 are a realistic seven days if nothing else competes, and that is already
optimistic given phase 4 lands in the same window. **Phases 6–10 are after.** This
document is the plan for the product, not for the submission, and the two should not be
conflated — what ships on the 16th is a subset, described as a subset.

**If the live debate must be shown on the 16th**, the honest shortcut is one screen and
several accounts signing in turn. It demonstrates lenses, crux and cited positions
completely; it just does not demonstrate three people at three desks. Say which one is
being shown.

---

## 8. Risks, stated plainly

| risk | standing |
|---|---|
| **The AI is inconsistent** | Real, and it attacks the primary claim directly. §6.1 exists to measure it rather than assume it. Unmitigated until measured. |
| **Leakage via LiverTox** | Fatal if it happens. §4.3 makes it structural rather than procedural. |
| **Fluent wrongness** | An AI given the same six thin fields fails as the engine did, but persuasively. Mitigated only by §4.2 — the redesign is worthless without the new inputs. |
| **Replay set too small to support a claim** | Likely. Report n and state it as illustrative calibration, never as accuracy. |
| **Extraction errors propagate** | Every extracted finding is displayed for approval before use, with its source document and page. Never auto-accepted. |
| **The static ZIP loses the product** | The AI path needs a server. A build with no network cannot adjudicate. This is now an accepted consequence, not a defect to design around — decided 2026-08-09. |
| **The backend is new territory** | No server, no database and no auth has ever existed in this project, and phase 4 lands in the same week as phases 2–3. Highest schedule risk on the board. Mitigated only by running the two tracks in parallel and by the one-screen fallback for the debate demo. |
| **Group 1 reconstruction is partly inference** | "What was known before first human dose" is assembled from retrospective literature. Every reconstruction records its sources and what could not be established, and a case that cannot be reconstructed honestly is dropped rather than guessed. |
| **Uploaded documents may be confidential** | The moment this accepts a real sponsor's study report it is handling unpublished safety data. Access control per case, no document leaves storage except into an adjudication payload, and no third-party model provider is used without that being an explicit, recorded decision. |

---

## 9. What must not happen

1. **`rules/ruleset-v1.0.json` is never edited.** v2.0 is a new file with a new hash.
2. **LiverTox never enters an adjudication payload.** §4.3.
3. **No model output reaches the screen unverified.** Every cited number matched against
   the findings; unmatched claims do not render.
4. **No model touches the record.** Hashing, chaining and versioning stay in plain code.
5. **The word "safe" is never applied to a compound.** A preclinical package establishes
   the absence of a signal under tested conditions and nothing more. HANDOVER §1.3
   applies to generated text exactly as to hand-written copy.
6. **Accuracy is never quoted without its denominator and its class balance.** That
   omission is what produced §0.
7. **"Not measured" and "measured negative" never render alike.** §3.2. The distinction
   between an assay nobody ran and an assay that came back clean is the difference
   between a gap and a result, and TAK-994 is what happens when it blurs.
8. **Dissent is never deleted, and no headcount decides anything.** §5a.3 labels the
   basis of a position; it does not remove one. One named person signs.
