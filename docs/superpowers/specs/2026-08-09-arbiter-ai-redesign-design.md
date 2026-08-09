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
inhibitor, so the engine found something true. It then said *do not advance* about
approved, widely prescribed drugs.

That is the defect, and it is structural: **the ruleset has no vocabulary for severity.**
All six rules govern how much to trust a piece of evidence. None describes what liver
injury is, how much drug is taken, which kind of injury occurs, whether it reverses, or
how often it happens. A system with no severity inputs cannot produce severity
judgments, and no threshold change fixes that.

### The deeper finding, which decided the redesign

**The benchmark was answering a different question than the product asks.**

| | question |
|---|---|
| **Benchmark** | Given a drug marketed for decades, predict what its FDA label says about the liver. |
| **Product** | Given a compound with no human data and contradictory lab results, should it go into people? |

DILIrank labels derive from post-market human experience — information a preclinical
team does not have when the decision is made. Optimising against it turned ARBITER into
a *predictor* competing with a crowded field, when its stated claim, unchanged since
July, was **consistent and defensible decisions under conflict.**

---

### 0a. The re-grade, measured the same day

The target correction was registered as `rules/ruleset-v2.0.json` (hash `984dc08d…`) and
the existing verdicts re-graded under it. **The expected direction was written into the
ruleset file before the re-grade ran** — negative, because five of the seven commitments
are vLess compounds and become false positives. It was.

| full scored split | confusion | balanced accuracy | |
|---|---|---|---|
| **v1.0, as shipped** | tp 4 / fp 0 / tn 0 / fn 0 | 0.750 | single-class — half the definition substituted |
| **v2.0, corrected** | **tp 2 / fp 5 / tn 0 / fn 0** | **0.500** | both classes present; a real number |

Two of seven commitments right, five wrong. And 0.500 is chance.

**The wider result is worse and matters more. Under an honest target, no pipeline clears
0.601:** majorityVote 0.471, cytotox 0.507, weightedAverage 0.516, qsar 0.601. The v1.0
scorecard was making a corpus-wide absence of signal look like several systems that had
some.

`tools/rescore_v2.py` re-grades rather than re-runs — the verdicts are a function of
evidence and R1–R6, neither of which v2.0 touches, so a re-run is byte-identical by
construction and re-grading keeps this single-variable. Its metric definitions are
transcribed from `stats.ts` and it asserts that its v1.0 column reproduces
`results/metrics.json` exactly before printing. That guard passes.

**Disclosed:** the QSAR stream was fitted against the v1.0 definition, so it is optimised
for a target v2.0 rejects. Refitting would stop this being single-variable, so the v2.0
figures are a **lower bound**. It does not touch the headline — the engine commits on
transporter claims, not QSAR.

---

## 1. The claim, restated

> When preclinical evidence about a compound conflicts, ARBITER reaches the same
> conclusion every time, states exactly what is missing, and leaves a record anyone can
> reconstruct two years later. The safety lead decides. The reasoning stops living in
> their head.

Three properties, in priority order. **Accuracy is not first, and one of the three needs
no ground truth at all:**

1. **Consistency** — identical evidence yields an identical recommendation. Measurable
   without an answer key. The property human committees demonstrably lack.
2. **Recoverability** — the reasoning behind any past position can be reconstructed
   exactly, against the evidence and ruleset version in force at signing.
3. **Calibration on the reconcilable fraction** — on historical cases where the signal
   existed preclinically, does it flag? On compounds with alarming preclinical signals
   that proved fine, does it decline to?

We do not claim to predict idiosyncratic DILI. Nothing does. Master spec §12 stands.

---

## 2. What is kept, what is replaced

### Kept

| | why |
|---|---|
| **The signed record** (`evidenceSnapshotHash`, `rulesetHash`, `prevRecordHash`, dissent preserved, one accountable signer) | Independent of who reasons. The strongest built artifact in the repo, and what makes this enterprise software rather than a chat interface. |
| **The six rules, as required disclosure** | Sound, standard evidence-weighing doctrine. They were never the defect. Being the *sole decider* over six data fields was. |
| **The problem statement and language discipline** | HANDOVER §1.3 applies verbatim to every generated sentence, enforced on model output. |
| **`packages/engine` as a scoring and consistency harness** | Pure, deterministic, well tested. It stops being the decider and becomes the instrument that measures the decider. |

### Replaced

| | why |
|---|---|
| **The engine as decider** | Commits on 7/267; 5 of 7 are over-calls. Not recoverable by tuning. |
| **Dempster–Shafer fusion as the verdict path** | The belief–plausibility gap rule produces 97.4% abstention and bought no measurable accuracy. Retained as a diagnostic, not as the gate. |
| **The binarisation policy** | Requires a v2.0 re-registration. §4.1. |
| **Six fixed rules as the whole rulebook** | Becomes a growing, versioned checklist. §5. |

**This is a v2.0 re-registration, not an edit.** `rules/ruleset-v1.0.json` is never
modified. A new `rules/ruleset-v2.0.json` is committed with its own hash and a written
rationale, and every position signed under v1.0 remains attached to v1.0.

---

## 3. Architecture

```
study documents (PDF)
        |
        v
 [ AI extraction ]  -> findings, each with source document + page
        |              SHOWN FOR APPROVAL, never auto-accepted
        v
 [ the inventory ]  -> what was found, what was looked for and not found
        |              NEUTRAL. No verdict. Published to everyone BEFORE they answer.
        v
 [ blind positions ] -> each scientist submits a call + reasoning + cited findings
        |               nobody sees anyone else until everyone has submitted
        v
 [ reveal ]
        |
        v
 [ AI adjudication ] -> verdict + severity + per-rule disclosure + which arguments
        |               carried and why + what would resolve the live disagreement
        v
 [ deterministic checks ] -> every cited number matched against the findings;
        |                    language discipline enforced; unmatched claims blocked
        v
 [ one named person signs ] -> or overrides, on the record. Hash-chained.
```

**Four properties this shape guarantees.**

- Nothing the AI extracts is used before a human approves it.
- Nothing the AI asserts is displayed unless it matches the approved findings. The check
  is deterministic code, not a second model.
- No model touches the record. Hashing, chaining and versioning stay in plain code.
- **No count decides anything.** §6.4.

### 3.1 The two-phase disclosure — the ordering question, settled

The question: does the AI report what is missing *before* people give their opinions, or
only after? Both orderings are wrong in different ways, so the line is drawn between
**facts and conclusions.**

| | published before | published after |
|---|---|---|
| *"No exposure study was submitted."* | **yes** — a fact about the folder | |
| *"Two of your three clean results were tested at 3× where humans see 30×."* | **yes** — arithmetic on the documents | |
| *"This compound may be hepatotoxic."* | | **after** — a conclusion |
| *"The rodent study does not support advancing."* | | **after** — a judgment |

**Why facts go first.** Withholding the inventory does not produce independent judgment,
it produces uninformed judgment. Everyone should know what is in the folder. Finding a
gap is clerical work a well-organised human would also do, just slower and less
completely — **the judgment is whether the gap matters enough to stop the programme, and
that is what the humans are for.**

**Why conclusions go last.** Anchoring is the best-documented failure in group
decision-making: whoever speaks first sets the frame and everyone converges on it. An AI
verdict published before the humans answer destroys the independent signal that makes
collecting their positions worth anything at all.

**Residual risk, and its mitigation.** Reporting "the exposure study is missing" does
implicitly mark that as worth noticing. So the inventory reports **everything it looked
for, with equal weight** — present, absent, or inconclusive — as a flat checklist with
no ranking, no emphasis and no highlighting. It is a table of contents, not a summary.

### 3.2 Absence is a finding, and must be stated

**Silence about a gap is the failure mode this project exists to prevent** — TAK-994's
package looked complete.

> *No exposure data. We searched the uploaded documents for dose, Cmax and exposure
> margin and found none. Two of your four findings are clean results, and without a
> margin they cannot be distinguished from results tested below the range that matters.*

Two rules govern this surface:

1. **Named, not counted.** "3 fields missing" is useless. Which fields, and what each
   blocks.
2. **Absent is not negative.** *"No transporter assay was run"* and *"the transporter
   assay was negative"* are different facts and must never render alike.

### 3.3 The backend — the first real one in this project

Accounts, shared cases and blind submission all require state that outlives a page
refresh. This is a genuine architectural addition, not a feature.

| | |
|---|---|
| **Identity** | Email/password to start, with the `signatureMethod` seam the record model already carries (`demo-persona` \| `sso`). SSO changes one field. |
| **Storage** | ~~Postgres.~~ **Amended 2026-08-09 — see below.** Cases, documents, findings, ruleset versions, positions, the hash chain. |
| **Documents** | Object storage. Every finding references its source document and page, so any claim traces back to the sentence it came from. |
| **API** | The web app stops owning data and reads through the service. |
| **Liveness** | Polling is sufficient. A position appears within a second or two of being submitted. |

**Consequence, accepted 2026-08-09:** the single-file `file://` build can no longer
adjudicate. `apps/web/e2e/static-file.spec.ts` is re-scoped to guard that the app loads
and explains itself offline, not that it reasons offline.

#### Amendment, 2026-08-09 (built): an append-only hash chain, not Postgres

Written down because a later reader trusts this document over the code.

**The property the deliberation needs is not a query engine.** It is that a position
cannot be written, or rewritten, after its author has seen someone else's — and a
mutable row cannot demonstrate that, because an `UPDATE` leaves nothing behind. A hash
chain can: every entry commits to the one before it, so altering an earlier entry breaks
every hash after it, detectably, by anyone holding the file. `services/api/store.ts`.
`DeliberationStore` is the seam, and a Postgres implementation satisfies it without any
caller changing.

The secondary reason is smaller and honest: no database server exists on the machine
this has to run on, and a demo that cannot start is not a product.

**Two files, and the split is load-bearing.** The log holds commitments; a sibling file
holds live case state including position plaintext. That is what lets the log be handed
to a participant, or an auditor, **while a case is still open** without revealing
anybody's answer. A single store holding both would make every export a reveal.

**What is proved and what is not.** `verifySeals` proves no revealed position differs
from what was sealed at submit time. It does **not** prove the server never read one
early — the server holds plaintext because it must hand it to the adjudicator, and no
server-side scheme changes that. Participants trust the operator on that point. Stating
it matters more than the guarantee: a reader who believes this is cryptographically
blind will trust a property nobody built.

**Identity, as built, is `demo-persona` only** — an `x-arbiter-user` header. Anyone who
can reach the port can claim to be anyone, so the server binds to loopback and has no
flag to change it. Real accounts are a prerequisite for any real sponsor data (§9).

### 3.4 The verdict is two questions, not one

The conflation that produced all five over-calls:

| | question | what answers it |
|---|---|---|
| **Mechanism** | Is there a plausible route by which this compound injures the liver? | Assay evidence. The current engine is genuinely decent here — it surfaced five real BSEP inhibitors unprompted. |
| **Consequence** | Is it severe enough to stop the programme? | Daily dose, injury type, exposure margin, reversibility, expected frequency. **None of this exists in the current pipeline.** |

Both are stated, separately. *"Cholestatic mechanism present; at 150 mg/day with a 40×
margin and a reversible pattern, not disqualifying"* is useful. *"Do not advance"* about
irbesartan is not.

### 3.5 The web application — a new app, not a conversion

**`apps/web` is replaced rather than migrated.** This is not a redesign of screens; the
program is a different kind of program.

Today's app is a **viewer for an engine running in the browser**, with its data compiled
into the bundle — which is exactly why it can ship as one self-contained `index.html`.
The redesign is a **client for a multi-user service**: documents live server-side,
positions are submitted and locked, other participants' answers appear on reveal,
adjudication runs remotely. The screens change because the workflow changed.

**Built alongside, not in place.** The existing app keeps running untouched until the
replacement is complete. Converting in place produces a long stretch where neither
works, and the old app is the only working demonstration that exists.

#### What carries over

The expensive parts, which is most of the accumulated work: **design tokens and CSS,
component primitives, the motion system and its kill switch, the accessibility work, the
error boundaries**, and — most valuable — **the signing and hash-chain code
(`record/chain.ts`)**, which is independent of who reasons and needs no change.
`packages/engine` carries over as the consistency harness (§7.1).

#### What does not

| tab | why |
|---|---|
| **Case** | Built around browser-side reasoning over bundled claims. That flow no longer exists. |
| **Compounds** | A 267-row table of the corpus being replaced. |
| **Validation** | Displays the metrics §0 retired. |
| **Ruleset** | Live per-session rule editing, removed by §5.2. |
| **Intake** | Hand-entered claims, replaced by document upload. |
| **The eight-beat tour** | Tied to the old hero cases and the old flow. |

#### The screens

Seven, and they are a **sequence** rather than a set of views. The workflow *is* the
information architecture:

```
  login
    |
  cases            which are open, which need your position
    |
  documents        upload, extraction status, approve the findings
    |
  inventory        present / absent / inconclusive. neutral, unranked.
    |              everyone reads this BEFORE answering (section 3.1)
  your position    your call, your reasoning, checkboxes for what you
    |              cite. LOCKS on submit; you cannot see anyone else.
  reveal           every position, once all participants have submitted
    |
  verdict          the AI's reasoning, which arguments held and why,
    |              the crux, the experiment that would settle it
  sign             one named person. hash-chained.
```

The linearity is a feature. Seven tabs presented seven parallel views and left the order
to the reader; this presents one path with a defined order, and the order is what §3.1
exists to protect.

---

## 4. Data

### 4.1 The answer key

**LiverTox (NIH/NIDDK) becomes the primary label source.** Over 1,000 drugs, each with
injury pattern, latency, severity, mechanism, dose relationship, and a **seven-level
likelihood score** (A >50 published cases · B 12–50 · C 4–12 · D 1–3 · E no credible
evidence despite wide use · E\* suspected-unproven · X insufficient data). That scale
grades *strength of evidence*, which is the right axis: irbesartan and cyclosporine do
not share a bucket under it.

**LiverTox is prose**, which is exactly why no fixed pipeline in this field uses it as a
structured source and exactly why an AI can. The same extraction capability the product
needs for study documents builds the answer key.

**DILIst** (FDA, 1,279 drugs, 768 positive / 511 negative) replaces DILIrank as the
breadth dataset — larger and better balanced than the 890 in use.

**Precedence, so no compound carries two labels.** Where LiverTox has a monograph, its
likelihood score is the label and DILIst is ignored for that compound. DILIst covers the
remainder, and any compound labelled from DILIst alone is flagged so a mixed-provenance
figure can never be quoted as one number.

**DILIN** (899 adjudicated patient cases) is roadmap: formal request to the NIDDK
repository, SAS files. Named here so it is not rediscovered as novel later.

### 4.2 New inputs, in descending value

| input | source | why |
|---|---|---|
| **Daily dose** | FDA labels / DailyMed | Among the strongest single DILI predictors known. Currently absent entirely; a 5 mg and a 2,000 mg drug are treated identically. |
| **Lipophilicity (logP)** | public chemistry databases | Pairs with dose in the well-established "rule of two". |
| **Injury pattern** | LiverTox | Hepatocellular vs cholestatic. The distinction that explains all five over-calls. |
| **Reversibility / adaptation** | LiverTox | A transient enzyme rise that resolves on continued dosing is not a programme stopper. |
| **Expected frequency** | LiverTox likelihood score | 1-in-50,000 is not preclinically findable and should not block. |

### 4.3 The leakage wall — non-negotiable

**LiverTox is a label source and must never reach the model as an input.** An AI that
reads a LiverTox monograph and then predicts that drug's hepatotoxicity has read the
answer. It would score near-perfectly and mean nothing.

Enforcement is structural: label extraction and input extraction run as separate jobs
writing to separate files, and the adjudication payload is assembled from the input file
only. A test asserts no label-derived field appears in any adjudication payload. Direct
descendant of `test_qsar_leakage.py`, and it carries the same weight: **if this wall
fails, every number downstream is void.**

### 4.4 Test documents — measured 2026-08-09, and the first plan did not survive

**An earlier draft of this section claimed the historical withdrawals could be replayed
from their approval packages. That was checked and it is wrong.** What follows is what
the files actually contain.

#### What was tried, and what came back

| attempt | result |
|---|---|
| **Troglitazone**, NDA 020720, the retrievable 1997 PDF | Downloads, 133 pages, genuinely text — but it is a **labelling supplement**. Zero occurrences of "hepat", no pharm/tox review. Unusable. |
| **Tolcapone**, NDA 020697 medical review, 1998 | 48 pages, **every page a scanned image, 47 extractable characters in the whole file.** OCR or nothing. |
| **Drugs@FDA coverage** | FDA's own documentation: full review documents exist mainly for drugs approved **1998 onward.** Earlier applications carry little more than labels. |
| **Lumiracoxib, sitaxentan** | **Never FDA-approved** — European only. No FDA package exists to fetch. |
| **Ximelagatran** | **FDA rejected it.** No approval package. |

So the historical-replay design fails on document availability, not on principle. Recorded
at this length because the plan read as sound and cost an hour to falsify.

#### What does work, measured on the same day

| | FDA multi-discipline review (2019) | EMA assessment report |
|---|---|---|
| pages | 132 | 178 |
| extractable characters | **277,609** | **495,108** |
| scanned pages | **0** | **0** |
| coverage | toxicology, carcinogenicity, genotoxicity, repeat-dose, Cmax, safety pharmacology | the same **plus NOAEL, exposure margins and reversibility explicitly** |

**EMA reports are the richer source for nonclinical detail.** Both formats are
born-digital text, and the FDA multi-discipline format carries a numbered contents with
**"5. Nonclinical Pharmacology/Toxicology" as its own chapter**, separate from the
clinical sections.

Raw GLP study reports remain **effectively never public**. Do not plan around them.

#### The experiment this enables, which is better than the one it replaces

A modern review contains **both** the preclinical chapter and what subsequently happened
in humans. So:

> **Feed the model the nonclinical chapter only.** Animal studies, in vitro data,
> exposure margins — precisely what a preclinical team holds before first human dose.
> **Ask it to predict what the clinical chapter found. The answer key is the same file.**

Better than the historical replay on three counts: **no hindsight contamination**,
because the cut is mechanical rather than a promise to ignore what one knows; **no OCR**;
and it works in **both directions**, since drugs with liver findings and drugs without
both have full reviews.

Candidate selection therefore stops being "drugs that failed" and becomes **"drugs where
the liver answer is known"** — recent approvals carrying liver warnings for §4.5's
positive direction, recent approvals with clean liver profiles for the negative.

**The cut must be enforced, not promised.** A single sentence of the clinical chapter
reaching the model turns the exercise into transcription. The split is asserted by a test
over the extracted text, and a case whose chapters cannot be cleanly separated is dropped
rather than trimmed by hand.

### 4.4a A human manifest per document, or extraction cannot be scored

**Without this, every extraction result is ambiguous** — a finding absent from the output
could mean the model missed it or that the document never contained it, and those are
opposite conclusions.

So before the model sees a document, **a person reads it and lists what it actually
contains.** Scoring then resolves:

| situation | verdict |
|---|---|
| present in the document, absent from the output | **extraction failure** |
| absent from the document, reported absent | **correct** |
| absent from the document, reported present | **hallucination — a hard fail** |

That third row is the one that matters and the one no verdict-level metric would ever
surface.

**The cost is real and sets the size of the test set:** a person reading a 130-page
review, probably most of a day per compound. That is the honest reason §4.5 is around ten
cases rather than fifty, and it is not a corner that can be cut — an unmanifested document
produces numbers that cannot be interpreted in either direction.

### 4.5 The three test groups

A one-directional set measures only willingness to say "danger" — the exact failure §0
found. **All three groups are required.**

**Scope, decided 2026-08-09 and closed.** The set is drugs that *injure* the liver, not
drugs that *treat* it. None of the fifteen is a liver medicine — they are a diabetes
pill, an antibiotic, a painkiller, an antidepressant, a blood thinner. That is the point:
the liver metabolises nearly everything swallowed, so DILI is a risk carried by drugs for
every indication, and **the teams it happens to are the ones not watching for it.**
TAK-994 is a narcolepsy drug. Narrowing scope to liver-targeted medicines would put the
anchor case out of scope and shrink the claim to a problem people already watch closely.

Considered and not taken: a fourth group of liver-disease drugs (obeticholic acid and
similar), where patients begin with abnormal liver chemistry and separating drug injury
from disease progression is genuinely harder. A real problem and a possible later group —
**not a replacement for this set.**

#### Group 1 — a documented liver signal

**Revised 2026-08-09 after §4.4 was measured.** The original selection was the eight
drugs withdrawn for hepatotoxicity between 1997 and 2016. **That set cannot be used as
documents** — two were never FDA-approved, one was rejected, and the packages that do
exist are either scanned images or the wrong document entirely.

The group is therefore selected on **"the liver answer is known and the review is
readable"**, not on "the drug was withdrawn": **recent approvals (1998 onward, and
preferably 2015 onward for the multi-discipline format) whose clinical chapter documents
a liver finding.** The nonclinical chapter is the input, the clinical chapter is the
answer key, and §4.4's cut keeps them apart.

The withdrawn drugs keep a role, but a different one: **as narrative, not as data.**
Tolcapone, ximelagatran and lumiracoxib showing nothing in preclinical animal studies is
the argument for why the product should exist. It is not evidence that the product works,
and must never be presented as though it were.

**fialuridine** and **fasiglifam / TAK-875** are likewise narrative. Both failed before
approval, so no package exists at all.

TAK-994 stays the anchor for the demo. **Do not build the set predominantly from Takeda
compounds** — TAK-875 and TAK-994 together read as picking on one sponsor rather than
describing a field-wide problem.

#### Group 2 — real mechanism, fine in practice

**Already in the data, free.** ARBITER's five over-calls: **prochlorperazine,
thioridazine, glyburide, mifepristone, irbesartan.** Every one a genuine BSEP inhibitor;
every one approved and widely prescribed. A system that flags these is crying wolf, and
§0 is the measurement of what happens when nothing checks for it.

#### Group 3 — genuinely clean

**LiverTox category E**, defined by the source itself: *widespread use, no credible
evidence of liver injury.* Category **E\*** is deliberately excluded — the point of this
group is that there is nothing to find. Approved drugs, so full approval packages exist.

Group 3 is not padding. **It is the only group that can test §6.5** — whether a position
with no evidence behind it is visibly distinguishable from one with evidence. On a
category-E compound there is nothing for an objection to cite.

#### What each group proves

| group | passing behaviour |
|---|---|
| 1 | flags, or states plainly what is missing and what would find it |
| 2 | reports the mechanism, declines to call it disqualifying |
| 3 | commits to no concern, and an unsupported objection is visibly unsupported |

**Honest limit.** Group 1 gives roughly ten cases, seven of them on complete documents.
**Report n and call it calibration, never accuracy.**

---

## 5. The rules — fixed, versioned, and not personal

### 5.1 What changed, and what did not

Today the six rules **are** the reasoning: six checks, and whatever falls out is the
answer. That is why cases the rules do not cover produce nothing useful, and why **140
of 267 compounds carry a single claim** — leaving the three comparative rules with
nothing to compare.

Under the redesign: **the AI reasons; the rules are what it must address.**

Before any verdict, the model states its position on every registered rule, citing the
finding it relies on. **A rule that does not apply must be stated as not applying, with
a reason** — that is information, not a gap. The rules become a disclosure requirement,
not a straitjacket: the AI may reason about matters no rule covers; it may not skip what
the rules require.

### 5.2 Rules are not customisable per person — considered and rejected

An earlier draft of this document gave every account its own weighting of the rules.
**That was wrong and is removed.**

**A tool where each person permanently tunes the rules produces whatever answer that
person wanted** — the exact failure the pre-registered ruleset exists to prevent,
reintroduced one account at a time. Worse, it is invisible: nobody reviewing a decision
sees that a reviewer's exposure rule has been at half strength since March.

The two things that genuinely vary are handled without personal settings:

| | where it lives |
|---|---|
| **Context** — a late-stage oncology drug and a daily pill for healthy people do not get the same tolerance for a liver signal | **A property of the case**, not the person. Indication, dosing duration, population. Entered once, visible to everyone, part of the signed snapshot. An oncology drug is an oncology drug regardless of who opens it. |
| **A specific objection** — *"that transporter assay overcalls for this chemical class"* | **A position on this case**, argued and cited, recorded permanently. §6. Specific, auditable, and unable to bias any future case. |

### 5.3 The ruleset grows, and versions

When reasoning turns on a principle no registered rule covers, **the model proposes a
new rule.** The team adopts or rejects it. Adoption mints a new ruleset version with a
new hash, and **every past position stays bound to the version under which it was
signed** — which is already how `rulesetHash` works. The rulebook can expand
indefinitely and nobody can claim a rule was changed to fit an answer.

### 5.4 Seed set for v2.0

The six current rules, plus the categories the audit found missing: **dose magnitude ·
injury pattern · reversibility and adaptation · expected frequency · reactive-metabolite
formation · latency and dechallenge.**

Clinical hepatology already scores causality on a multi-domain weighted checklist. It is
built for diagnosing a patient rather than screening a candidate, so it does not
transfer directly — but its *shape* is evidence that "many weighted factors applied as a
checklist" is how the field reasons, and that six is too few.

---

## 6. The deliberation — how multiple scientists work a case

### 6.1 The sequence

1. **Documents uploaded.** AI extracts findings; a human approves them.
2. **The inventory is published** to everyone — what is present, what is absent, what is
   inconclusive. Neutral, unranked, no verdict. §3.1.
3. **Everyone answers blind.** Each participant submits a call, their reasoning, and the
   findings they are relying on. **Nobody sees anyone else's until all have submitted.**
4. **Reveal.**
5. **The AI adjudicates** across every position and the evidence itself.
6. **One named person signs**, or overrides the AI on the record.

### 6.2 Why blind

The first person to speak in a meeting drags everyone else. Blind submission is the
whole reason collecting several positions produces more information than collecting one,
and it costs nothing to implement.

A case names its participants and closes when all have submitted, or when the decision
owner closes it early — recording who did not answer.

### 6.3 What the AI produces

Not a summary. A worked judgment:

- **The verdict, the severity call, and what drove it**
- **Which arguments carried and which did not, with reasons.** *"The concern about a
  reactive metabolite is not supported by anything in the uploaded documents — no
  metabolite study was submitted. That is a gap, not a disagreement."*
- **Where participants were talking past each other** — usually most of it
- **The one disagreement that changes the answer**, handed to the experiment planner,
  which already asks *"which rule is the verdict resting on, and what evidence would
  overturn that specific rule?"*

**Disagreement → the exact question it turns on → the experiment that settles it.**

### 6.4 It weighs arguments, never headcount

**The AI reasons about the arguments and the evidence, not about how many people held
each view.** Three participants saying "I am uneasy" with nothing cited does not
outweigh one pointing at a specific finding. Counts are never an input to the verdict,
and are shown to a later reader as context only.

Master spec §7a killed vote tallies for a reason that still holds: **if a count decides,
the group can outvote the accountable owner and nobody is accountable.**

### 6.5 A position must cite what it rests on

Recording a position requires citing the findings it relies on. The system checks
deterministically that the cited findings exist in this case and are relevant to the
rule invoked.

#### Two fields, doing different jobs

**What you cite is a selection.** Checkboxes against the approved findings, placed
beside the inventory the participant is already reading. **Not free text**, and the
reason is load-bearing: a selected citation points at a specific object, so the check is
deterministic. A *typed* citation would have to be run through a model to decide whether
it referred to anything real — and then **a model is gatekeeping dissent**, which §6.4
forbids for the same reason vote tallies are forbidden.

**Why you cite it is prose.** *"The transporter result is real, but this assay overcalls
for phenothiazines and the margin is 40×."* No structure captures that, and it is the
part a later reader actually needs.

Citation granularity is the whole finding, not a span within it. Finer granularity is
friction with no payoff.

#### Three states, not two

| state | meaning |
|---|---|
| **Cited** | points at findings in this case. Checkable. |
| **External** | points at something outside the case documents — a paper, prior experience with the chemical class. The claim is stated and a source may be attached. |
| **Unsupported** | cites nothing at all. |

**External is not a weaker form of cited.** It is *asserted, not yet in evidence*, and it
is useful precisely because it is testable: *"this assay overcalls for phenothiazines"*
is a claim someone can go and verify. **An external citation joins the missing-evidence
list** rather than evaporating, and attaching its source promotes it to a finding.

Without this state the design fails in a specific way: a scientist relying on genuine
expertise not present in the uploaded documents would either have to click an adjacent
finding and misrepresent themselves, or be marked unsupported while being right. **Both
outcomes teach people to route around the citation requirement, and a requirement people
route around is worse than none.**

#### What unsupported does and does not mean

**Unsupported does not mean deleted and does not mean overruled.** Dissent is preserved
permanently — that is the record's purpose. What changes is that the *basis* of every
position is visible: the person signing can see three positions citing specific findings
and one citing nothing. **They still decide. They can no longer do it without noticing.**

On a group-3 compound there is nothing to cite *and* nothing external to point at, so an
objection lands in the third state visibly. That is why the group exists.

### 6.6 Unanimity is not correctness — the feature that matters most

**The AI checks the evidence itself, not only the humans.** When everyone agrees and the
documents do not support it, it says so:

> *All four participants supported advancing. No exposure study was submitted, and two
> of the three clean results were run at 3× where the projected human exposure is 30×.
> The agreement is not evidence; nobody tested the question.*

**That is TAK-994.** A room that agrees, a package that looks complete, and a gap nobody
named. A system that only reconciled disagreement would have sailed straight through it.

### 6.7 What is deliberately not built

**No consensus mechanism, no quorum, no threshold to proceed.** A committee advises; one
named individual signs. Every mechanism that would relieve that person of the decision
is out of scope on purpose.

---

## 7. Validation — three measurements

### 7.1 Consistency (needs no answer key; the primary claim)

Run the same case N times. Run near-identical cases differing only in ways no rule makes
relevant. **Report the flip rate.**

This is where an AI decider is structurally weakest, which is why it is measured first
and published whatever it says. 3% is a strong result against human committee variance.
30% is a defect we must find ourselves rather than have a judge find.

Mitigations applied before measuring: deterministic decoding, a fixed reasoning
structure the model fills rather than free-writes, structured output for verdict fields.

`packages/engine` runs this harness — the pure deterministic core becomes the instrument
that measures the AI.

### 7.2 Replay on the three groups

Feed the approval-package documents, ask for a verdict, compare against §4.5's table.
**Both directions are mandatory.** A one-sided replay measures only willingness to say
"danger".

### 7.2a Falsifiability — the prompt is a model parameter

**The trap this section exists to close:** with an AI decider, every wrong answer can be
attributed to the prompt. Tweak, rerun, get a better number, declare success — and the
prompt has now been fitted to the test set. That is the same leakage
`test_qsar_leakage.py` already guards for the QSAR model, moved from weights to wording.
**Once the prompt is understood as a model parameter, the discipline is one this project
already has.**

Six mechanisms, all of which must be in place before the first reported run.

**1. A held-out split, sealed.** Each group in §4.5 divides into development and
held-out cases. Prompt iteration happens against development only. **Held-out cases run
exactly once, after the prompt is frozen.** A large development-to-held-out gap is not a
disappointment to be explained — it *is* the measurement that the prompt was overfitted.

**2. The prompt is versioned and hashed.** Every change mints a version. Every reported
number names the version that produced it. **No result may be reported from a prompt
edited after that result was seen.** Identical rule to `rules/ruleset-v1.0.json`,
identical reason, and enforced the same way: the harness records the prompt hash beside
every verdict.

**3. Thresholds are pre-committed, in git, before the first run.** Maximum flip rate,
maximum group 1 misses, maximum group 2 false alarms, maximum group 3 false alarms —
written down and committed with a timestamp. A result then clears the bar or it does
not, and there is nothing to negotiate afterwards.

**4. The reasoning is graded, not only the verdict.** With ten to fifteen cases,
verdict-only scoring is close to meaningless — chance alone reaches 70%. Because the
model must cite findings and address every registered rule, **whether it flagged for a
defensible reason is checkable.** Troglitazone flagged on an irrelevant citation is
**scored as a failure, not a pass.** Right-for-the-wrong-reason is precisely the failure
mode that survives prompt-tweaking, because tweaking teaches a model to say the right
words without reasoning better.

**5. All three groups are reported from the same prompt version, always.** Never a group
in isolation. A change that improves group 1 and degrades group 2 has not made the system
smarter — **it has made it more trigger-happy, which is the defect §0 found in the
original engine.** Joint reporting surfaces that immediately.

**6. Iteration is bounded and logged.** A fixed budget of prompt revisions against the
development set, each recorded with its result. Unbounded iteration is the mechanism by
which the system turns unfalsifiable, and a visible revision count is what prevents it.

**What distinguishes a prompt defect from a design defect**, decided in advance so the
question is not settled by whoever is most invested:

| | |
|---|---|
| **Prompt defect** | The model had the information and reasoned poorly, or misread the output contract. Fixable within budget. |
| **Design defect** | The model lacked the information to answer at all (§4.2), or answers the same case differently across runs (§7.1), or reaches correct verdicts on incorrect reasoning (mechanism 4). **Not fixable by wording.** |

**§7.1's flip rate is structurally immune to this trap** — if one prompt gives one case
two answers, no rewording addresses it. That is why it is measured first.

### 7.3 Recoverability

Binary and demonstrable: select any signed position, reconstruct the evidence, the
ruleset version, the participants' arguments, and the reasoning that produced it.

### What is no longer reported

Balanced accuracy on the DILIrank conflict subset. **§0 replaces it, and the finding is
presented rather than buried** — a team that audited its own benchmark and found it
unsound is more credible than one that shipped the number.

---

## 8. Build order

| # | phase | why here |
|---|---|---|
| **1** | **v2.0 re-registration** — new ruleset file, new hash, written rationale, severity-aware target | Must precede any measurement, so nobody can claim the target moved after a score was seen. Cheap. Blocking. |
| **2** | **Document intake** — upload a PDF, AI extracts findings with source page, human approves | What everything needs, and what makes the system universal: a novel compound is in no database, but it has a study report. Also builds the answer key. |
| **3** | **The inventory** — present / absent / inconclusive, flat and unranked | §3.1's "before" half. Small, and it is the honest half of the product. |
| **4** | **Backend and accounts** — Postgres, identity, document storage, the API | Blocking for anything multi-party. Runs in parallel with 2–3; shares no code with them. |
| **5** | **AI adjudication** — verdict, severity, per-rule disclosure, citations, deterministic verification, §6.6's unanimity check | The product. |
| **6** | **The consistency probe** — one case, twenty runs, count the disagreements | **Moved up deliberately.** An hour's work the day adjudication first runs. It is the one result that can invalidate the architecture rather than the prompt (§7.2a), so it must not sit behind six phases built on the assumption that it passes. |
| **7** | **Falsifiability scaffolding** — held-out split sealed, prompt versioning and hashing, thresholds committed | §7.2a. Must precede any reported number, so it precedes phase 9. |
| **8** | **Blind deliberation** — submit, lock, reveal, adjudicate, sign; positions cite findings and unsupported ones are labelled | Needs 4 and 5. Carries the beat group 3 was assembled for. |
| **9** | **The three groups** — assemble and replay. Group 2 free, group 3 a category-E filter, group 1 document collection from approval packages | Highest evidential value. Start collecting during 2–5. |
| **10** | **Rule proposal and versioning** | Last: the only phase with no consumer waiting on it. |

**Two tracks, deliberately.** Phases 2–3 and 5 are AI work; phase 4 is backend work and
the new app. They share nothing and run in parallel.

**Sequencing constraints that are real**, as distinct from preference:

- **1 before everything.** The target cannot move after a score has been seen.
- **6 immediately after 5.** §7.2a — find out whether the approach is stable before
  building on it.
- **7 before 9.** No number is reported without the scaffolding that makes it falsifiable.
- **4 before 8.** Blind submission needs somewhere to lock a position.

---

## 9. Risks, stated plainly

| risk | standing |
|---|---|
| **The AI is inconsistent** | Real, and it attacks the primary claim directly. §7.1 measures it rather than assumes it. Unmitigated until measured. |
| **Leakage via LiverTox** | Fatal if it happens. §4.3 makes it structural rather than procedural. |
| **Fluent wrongness** | An AI given the same six thin fields fails as the engine did, but persuasively. Mitigated only by §4.2 — the redesign is worthless without the new inputs. |
| **The backend is new territory** | No server, database or auth has ever existed here, and phase 4 lands in the same week as 2–3. Highest schedule risk on the board. |
| **Group 1 is partly reconstruction** | Seven cases have complete approval packages; fialuridine and TAK-875/994 do not and are assembled from literature. Each records its sources and what could not be established; a case that cannot be reconstructed honestly is dropped rather than guessed. |
| **Uploaded documents may be confidential** | The moment this accepts a real sponsor's study report it holds unpublished safety data. Per-case access control; no document leaves storage except into an adjudication payload; no third-party model provider without that being an explicit recorded decision. |
| **The inventory still nudges** | Naming a missing test marks it as worth noticing. Mitigated by flat, unranked, exhaustive reporting (§3.1) — not eliminated. |

---

## 10. What must not happen

1. **`rules/ruleset-v1.0.json` is never edited.** v2.0 is a new file with a new hash.
2. **LiverTox never enters an adjudication payload.** §4.3.
3. **No model output reaches the screen unverified.** Every cited number matched against
   the approved findings; unmatched claims do not render.
4. **No model touches the record.** Hashing, chaining and versioning stay in plain code.
5. **The word "safe" is never applied to a compound.** A preclinical package establishes
   the absence of a signal under tested conditions and nothing more.
6. **Accuracy is never quoted without its denominator and class balance.** That omission
   produced §0.
7. **"Not measured" and "measured negative" never render alike.** §3.2.
8. **No AI conclusion is published before the humans answer.** §3.1. Facts before,
   judgments after.
9. **Dissent is never deleted, and no headcount decides anything.** §6.4, §6.5. One named
   person signs.
10. **No number is reported from a prompt version edited after that number was seen.**
    §7.2a. The prompt is a model parameter; tuning it against the test set is leakage.
11. **Held-out cases are run once.** A second run against a revised prompt makes them
    development cases permanently, and they cannot be restored.
12. **A correct verdict on incorrect reasoning is scored as a failure.** §7.2a. It is the
    failure mode that survives prompt-tweaking, and verdict-only scoring records it as a
    success.
13. **No document is used for extraction scoring without a human manifest.** §4.4a. An
    unmanifested document cannot distinguish an extraction miss from absent data, so it
    produces numbers that cannot be read in either direction.
14. **A replay case may only see material that predates the decision.** For the
    chapter-split design that means the clinical chapter never reaches the model, enforced
    by a test over the extracted text — not by intending to be careful. A case whose
    chapters will not separate cleanly is dropped, never trimmed by hand.
