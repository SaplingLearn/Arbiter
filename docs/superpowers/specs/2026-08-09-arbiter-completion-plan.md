# ARBITER — the completion plan, from the day the key arrives

**Written 2026-08-09.** Supersedes the build order in
`2026-08-09-arbiter-ai-redesign-design.md` §8, which was written before four things
were measured that change the order. Those four are recorded in §0 below, because a
plan that quietly drops its predecessor's assumptions is how a project loses track of
what it learned.

---

## 0. What changed since §8 was written

| finding | effect on the plan |
|---|---|
| **The mechanical chapter cut does not guarantee blindness.** Turalio's *nonclinical* chapter cross-references the clinical outcome in its own words. | Prediction scoring gains a prerequisite: a **leakage screen** that did not exist. Moved into Gate 3 and made blocking. |
| **Four checklist questions are never in a regulatory review.** M1, M2, M4, M6 are internal screening assays that live in sponsor study reports. | The real product is **sponsor-data mode**. Public-document mode is a demonstration, and the plan now says so rather than implying parity. |
| **Four human manifests now exist** (TAK-994, nipocalimab, Slynd, Turalio). | Extraction is scoreable *on arrival* rather than after a manifest-writing phase. Gate 1 shortens. |
| **Two of five collected documents are unusable.** | Group 1 and 3 assembly is a document-**collection** problem before it is a modelling problem, and it is the longest pole. Started in parallel from Gate 1. |

---

## 1. What "complete" means

Stated first, because without it "complete" drifts to mean "nothing left that is fun".

ARBITER is complete when **all five** hold:

1. A scientist uploads a study PDF for a compound in no database, and gets a neutral
   inventory of what the document does and does not contain, with every finding
   traceable to a page.
2. Several named people submit positions blind, the reveal is simultaneous, and the
   record proves no position was edited after sealing.
3. The AI adjudicates across positions and evidence, separates mechanism from
   consequence, cites only findings that exist, and names what is missing — and it
   says so when a room agrees about an untested question.
4. One named person signs or overrides, on the record.
5. **Every number the product quotes names its denominator, its class balance, and
   the prompt hash that produced it** — and the consistency figure is measured, not
   assumed.

Items 2 and 4 are **done**. Item 3 is built and unmeasured. Items 1 and 5 are the work.

---

## 2. The gates

Sequential, and each one can stop the project. That is the point of a gate.

### Gate 0 — The consistency probe. Before anything else. ~1 hour, ~$1–3.

```bash
export ARBITER_GCP_PROJECT=...        # Vertex AI project; auth is ADC, not an API key
npm run probe:case && npm run probe && npm run probe:report
```

**Amended 2026-08-10.** This read `export ANTHROPIC_API_KEY=...` until the model
provider moved to Gemini on Vertex AI — see `2026-08-10-model-provider-decision.md`,
which is the explicit recorded decision §9 of the redesign requires. Authentication is
Application Default Credentials (`gcloud auth application-default login` locally, a
service account in deployment), so there is no key to export. `ARBITER_MODEL` and
`ARBITER_ADJUDICATION_MODEL` still override the model, and the provider is inferred
from the model name, so this gate can still be run against an Anthropic model by
setting one variable and supplying `ANTHROPIC_API_KEY`.

Twenty runs of one case, no answer key needed.

| pass mark | source |
|---|---|
| flip rate **≤ 0.10** over 20 runs | `rules/pass-marks-v1.0.json` |
| per-rule position agreement **≥ 0.80** | same |
| hallucinated citations **= 0** | enforced by `verifyAdjudication`, so any occurrence is a 502 |

**Why first:** it is the only result that can invalidate the *architecture* rather
than the wording. Everything downstream assumes the same evidence yields the same
recommendation.

**On failure:** this is a **design** defect. Do not rewrite the prompt and re-run.
Record the number and reconsider whether an AI decider can carry the consistency
claim at all. That instruction is committed in the pass-marks file and predates any
result.

**Commit the raw runs.** `results/probe-runs.json` is allowlisted for a run whose
`"source"` is `"live"`. A reported flip rate whose answers were discarded is an
assertion.

---

### Gate 1 — Extraction. The biggest unbuilt piece, and what makes it universal.

**What:** PDF → findings, each with `label`, `assertion`, `detail`, `sourcePage`, and
a `covers` declaration naming the checklist questions it answers. A human approves
the list before it becomes a case.

**Why here:** a novel compound is in no database but has a study report. This is the
step that makes ARBITER work for any drug rather than for the 267 in the corpus.

**Scoring is already possible.** Four hand-written manifests exist and were written
before any extractor:

| manifest | findings | what it exercises |
|---|---|---|
| `data/probe-case-coverage.json` | 6 | coverage declaration only |
| `data/cases/nipocalimab-imaavy.json` | 9 | a rich EMA chapter, a biologic |
| `data/cases/slynd-drospirenone.json` | 4 | a near-empty 505(b)(2) |
| `data/cases/turalio-pexidartinib.json` | 8 | the most complete package |

| pass mark | value |
|---|---|
| hallucination rate | **0.0** — a ceiling, not a target |
| recall | **≥ 0.85** |
| coverage-declaration accuracy | *to be registered before the first run, in a v1.1 pass-marks file* |

**A miss and an invention are not symmetric.** A missed finding is a gap a human
reviewer sees on the approval screen. An invented one is a gap they cannot see, and
it destroys the product's reason to exist. That asymmetry is why the ceiling is zero.

**Deliverable:** `services/api/extract.ts`, an approval screen in the client, and
`covers` populated by the model and confirmed by a human — so the declaration carries
a signature rather than a heuristic.

---

### Gate 2 — Adjudication, measured on the four cases. ~$5–15.

Run live adjudication on all four cases and hand-score the reasoning.

**What is checked, in order of importance:**

1. **Mechanism and consequence answered separately.** Collapsing them is the defect
   that produced all five over-calls on 2026-08-09.
2. **Right answer for the right reason.** On four cases chance is high. A correct
   verdict on incorrect reasoning is a **failure**, and it is exactly what survives
   prompt-tweaking.
3. **Absences named.** The gaps the humans read are the gaps the model is given
   (`absentForAdjudication` + `externalClaimsAsGaps`), so failing to mention them is a
   failure to read its own input.
4. **The unanimity beat.** On TAK-994 the deterministic check already names eight
   untested questions. Does the model's prose agree, or does it congratulate the room?

**Iteration budget: 5 prompt revisions, development cases only, each logged with its
result.** On revision twelve the number that matters is twelve. This is committed.

**Expected shape of the answer, per case:**

| case | passing behaviour |
|---|---|
| TAK-994 | names the empty consequence half; does not mistake agreement for evidence |
| Nipocalimab | identifies the 44× vs 6.7× margin dispute as the crux |
| Slynd | says the questions are unanswered *by this document* — not that the sponsor was negligent |
| Turalio | states that animal injury begins **below** human exposure, and does not call it reassuring |

---

### Gate 3 — Prediction scoring. Blocked on two things that do not exist.

**3a. The leakage screen — build first, and it is blocking.**

A script that greps a nonclinical extract for clinical cross-references
(`clinically`, `refer to Section 8`, `in the clinic`, `in patients`, transaminase
language tied to human data) and **refuses** any document that contains them, in the
same style as `split_review.py`. Turalio fails this screen; nipocalimab passes.

Without it, "predicted the clinical outcome" can mean "read the sentence that stated
it".

**3b. Group assembly — the longest pole, start during Gate 1.**

| group | status | what it needs |
|---|---|---|
| **Group 2** — real mechanism, fine in practice | **done**, free | already derived from the engine's own five over-calls |
| **Group 1** — a documented liver signal | Turalio only, and it fails the leakage screen | modern reviews (1998+, ideally 2015+) whose clinical chapter documents a liver finding **and** whose nonclinical chapter does not leak it |
| **Group 3** — genuinely clean | **not started** | LiverTox category **E** (explicitly not E\*), then a readable review for each |

| pass mark | value |
|---|---|
| group 1 missed | ≤ 0.20 — *"cannot conclude, here is what would settle it" counts as a pass* |
| group 2 false alarm | ≤ 0.20 — five compounds, so at most one |
| group 3 false alarm | ≤ 0.10 — the tightest bar on the board |

**All three groups reported together, from one prompt version, always.** A change that
improves group 1 while degrading group 2 has not made the system smarter; it has made
it more trigger-happy. **Held-out cases run once.**

**Report n and call it calibration, never accuracy.**

---

### Gate 4 — The product surface. No AI in it; can run in parallel from Gate 1.

| item | replaces |
|---|---|
| **Real accounts** — email/password, then the `signatureMethod` seam to SSO | `x-arbiter-user`, which is a header the server takes at its word |
| **Document upload + object storage** | the hand-written case files in `data/cases/` |
| **Per-case access control** | nothing — required before any real sponsor data touches this |
| **Postgres, if wanted** | `FileStore`; `DeliberationStore` is the seam and the hash chain columns transfer as-is |

**Do not skip the access-control line.** The moment this accepts a sponsor's study
report it holds unpublished safety data, and the current build binds to loopback
precisely because it has no answer to that.

---

### Gate 5 — Rule proposal and versioning. Last, because nothing waits on it.

The ruleset grows. A new rule is proposed, reviewed, and **versioned with a new hash**,
and every result already reported stays attached to the ruleset version that produced
it. Rules are never customised per person — §5.2, settled and closed.

---

## 3. Sponsor-data mode is the product

The four questions no regulatory review answers — human-cell hepatotoxicity, BSEP
inhibition, mitochondrial toxicity, structural alert with a stated applicability
domain — are exactly the assays a sponsor runs internally and does not publish.

So the demonstration and the product differ, and the plan should say which is which:

- **Public-document mode** (what exists now) reaches 7 of 12 on the best available
  package. Good enough to show the mechanism; not the product.
- **Sponsor-data mode** — a company pointing ARBITER at their own study reports — has
  all twelve available. That is the real deployment, and it is also where the
  confidentiality obligations in Gate 4 become non-negotiable.

---

## 4. The four rules that govern all of it

1. **The prompt is a model parameter.** Tuning it against the test set is leakage.
   Every reported number names the prompt hash that produced it.
2. **A correct verdict on incorrect reasoning is a failure.**
3. **A failing consistency number is a design defect, not a prompt defect.**
4. **No accuracy figure without its denominator and class balance.** That omission is
   what produced the 0.750 headline this whole redesign exists to retire.

---

## 5. Honest sequencing, without dates

Gate 0 is an hour. Gate 1 is the substantial engineering. Gate 2 is short and mostly
reading. **Gate 3 is gated on document collection, which is slow, uncertain, and the
single most likely thing to stall** — two of the first five documents were unusable,
and that rate is the measurement, not bad luck. Gate 4 is ordinary product work with
no research risk. Gate 5 waits.

If only one thing gets done: **Gate 0**. It is cheap, it needs no answer key, and it
is the only measurement that can tell you the architecture is wrong before you build
another month on top of it.
