# ARBITER — the LLM ablation (metric 2a)

**Date:** 5 August 2026 · **Submission due:** 16 August 2026 · **Data freeze:** 2 August 2026 (passed)

Companion to `2026-07-26-arbiter-design.md` (the master spec, §12 baseline 4) and
`2026-07-28-arbiter-phase3-ai-surfaces-design.md` (§6, Surface 2, which is gated on this document's
output existing). This decides the four things HANDOVER §3.2 says have to be decided before any code
is written, and records **two corrections** that reading the current API forced.

The metric answers one judge question, and it currently has no measured answer at all — only an
argument:

> **"Why not just ask a model?"**

The shape of the answer is: a strong model, given the same evidence and the same rules, returns
different verdicts to identical inputs; ARBITER returns one. Until this runs, that sentence is a
claim we cannot support.

---

## 1. Scope

**In scope.** A harness runner (`npm run ablation`) that scores the conflict subset with a Claude
model, 25 runs per compound; the prompt and its evidence serialisation; the consistency metric; the
committed artifacts a reviewer re-derives the number from; and refusal accounting.

**Out of scope.** Surface 2, the live spot check — already specified in Phase 3 §6 and deliberately
not built. Any change to `rules/ruleset-v1.0.json`. Any change to `packages/engine`.

**Purity is not at risk.** This lives entirely in `apps/harness`, which is allowed I/O. The engine is
not touched, imported for reasoning, or consulted. **Determinism is also not at risk, and that is now
measured rather than assumed:** `metric2a_llmConsistency` is not in `extractGolden`'s projection
(`apps/harness/src/golden.ts`), so a model's non-reproducible output cannot make `golden:update`
churn. HANDOVER §3.2 raised this as a live risk; it is closed.

---

## 2. Two corrections to HANDOVER §3.2 and master spec §12

### 2.1 There is no temperature to disclose

Master spec §12 specifies "25 runs per compound, **temperature recorded and reported**", and Phase 3
§6 repeats "with the temperature disclosed". **Both are now unexecutable.** `temperature`, `top_p`,
and `top_k` are removed on every current Claude model — Opus 5, Sonnet 5, Opus 4.7/4.8 all reject a
request carrying one with a 400. There is no sampling knob to set, and therefore none to disclose.

This makes the metric **stronger**, not weaker, and the write-up must say so plainly:

> The variance reported here is the model's own. It is not the product of a sampling temperature we
> chose, because current Claude models do not expose one.

A reader who knows the older API will expect a temperature line and read its absence as an omission.
§7's `config` block exists partly to answer that before it is asked.

### 2.2 Refusals are an operating condition, not an error path

Hepatotoxicity adjudication is life-sciences adjacent, and current models run safety classifiers that
can decline. A declined request returns **HTTP 200** with `stop_reason: "refusal"` and an empty or
partial `content` array — not an exception, not a non-2xx. A runner that reads `content[0]`
unconditionally crashes on the first one.

This was anticipated by whoever wrote the metric contract: `run-metrics.ts` already reads
`refusalRate`, `refused`, `requests`, and derives `nCompoundsFullyRefused`. The contract is
refusal-aware. The runner must be too.

**The `fallbacks` parameter must NOT be used.** It re-runs a declined request on a different model
and returns that model's answer. Silently measuring a second model's consistency and reporting it
under the first model's name would be a fabrication. A refusal is data: record it.

---

## 3. The contract is already fixed — do not renegotiate it

`results/ablation.json` has a reader today. Its shape is pinned by `LlmConsistencyMeasured`
(`packages/engine/src/types.ts`) and by the destructuring in `run-metrics.ts`:

```ts
{
  config: unknown,                                    // opaque here by design — §7 fills it
  totals: { refusalRate: number, refused: number, requests: number },
  byCompound: Record<string, {
    agreementRate: number,
    confidenceStdDev: number,
    nScored: number,
  }>,
}
```

The reader derives `meanAgreementRate` and `meanConfidenceStdDev` as means over compounds with
`nScored > 0`, and `nCompoundsFullyRefused` as the count with `nScored === 0`. **Emit exactly this.**
Changing the shape means changing the engine type, the schema, and the Validation tab — work this
document does not authorise and the calendar does not have room for.

Note what the type's own comment already establishes: `LlmConsistency` is a genuine union
discriminated on `note`, specifically so that a half-written document — an agreement rate with no
refusal denominator beside it — cannot validate. **A consistency figure quoted without its refusal
rate is the one reading of this metric that is actively misleading.** They travel together.

---

## 4. Decision 1 — the model, and why not a cheap one

**`claude-opus-5`.** Fixed ID, no date suffix.

The temptation is a cheaper model to hold the bill down. **Reject it.** The metric's entire value is
that a *strong* model is inconsistent on this evidence. A weak model losing to ARBITER is a strawman,
a judge will say so in the room, and the answer we would have to give — "we used the cheap one" —
costs more credibility than the run costs money.

Thinking stays **on** (adaptive is the default on Opus 5) at the default `high` effort. Two reasons,
and the first is the one that matters:

1. **Giving the model its best shot is the point.** Turning thinking down to make the comparison look
   better is the same category of error as tuning `abstentionGapThreshold` to improve the headline,
   and §1.1's prohibition exists because that temptation is real.
2. Disabling thinking on Opus 5 can leak `<thinking>` tags into the visible response, which would
   confound a parse failure with a model disagreement.

---

## 5. Decision 2 — the prompt, and what the model is given

**The model receives the same claims the engine receives, and the registered rules.** Both.

Master spec §12 says "identical evidence, no symbolic layer". Evidence is unambiguous — the claim
objects for that compound, exactly as `reason()` gets them. The rules are the judgment call, and this
document decides: **include them.**

The reason is adversarial. The strongest form of "why not just ask a model" is *"give the model the
same rules and the same evidence and let it apply them itself."* If the model is inconsistent even
then, the finding survives the obvious rebuttal. Withholding the rules produces a cheaper-looking
result and invites the one-sentence reply that destroys it: **"you never told it the rules."**

The alternative — evidence only, no rules — was considered and rejected on that ground. It measures a
different and less interesting thing: unconstrained clinical judgment rather than rule-governed
adjudication.

### 5.1 Serialisation

Claims are serialised as **canonical JSON**, through the same canonicalisation
`apps/harness/src/preregistration.ts` already owns. Not prose. Prose serialisation is a second
authored artifact that can be tuned — deliberately or accidentally — to produce a better-looking
result, and there is no way to prove it wasn't. Canonical JSON of the exact objects the engine reads
is verifiable by inspection and is the same bytes on every run.

The rules are supplied as their **registered statements** from `rules/ruleset-v1.0.json`, verbatim,
including `abstentionGapThreshold` and `precedenceOrder`. The file is read, never edited.

### 5.2 The verdict space must be ARBITER's own

The model is offered all three verdicts: **`advance`, `do_not_advance`, `abstain`.**

Denying it `abstain` — the verdict ARBITER uses on 97.4% of compounds — would rig the comparison in
ARBITER's favour and would be indefensible the moment anyone read the prompt. The model must be able
to decline for the same reason ARBITER can.

### 5.3 Structured outputs, to separate disagreement from parse failure

The response is constrained with `output_config.format` (a `json_schema`) to
`{ verdict, confidence }`, where `confidence` is `0..1`.

This constrains the **format**, never the content — the verdict is whatever the model decides. It
exists to remove a confound: if 3% of free-text responses fail to parse, that 3% is indistinguishable
from model inconsistency in the aggregate, and we would have no way to tell a reviewer which it was.
Disclose the constraint in `config` (§7).

### 5.4 The prefix is stable on purpose

The system prompt and the rule statements are identical across all 1,525 requests, and the per-
compound evidence is identical across that compound's 25. This is a **prompt-caching** prefix by
construction — put the stable content first and the varying content last. Caching changes cost, never
output distribution, so it is methodologically free.

---

## 6. Decision 3 — the consistency metric, and its floor

Per compound, over the runs that returned a parseable verdict:

| field | definition |
|---|---|
| `nScored` | runs returning a verdict. Refusals are excluded here and counted in `totals`. |
| `agreementRate` | count of the **modal** verdict ÷ `nScored`. 25 runs at 20 toxic / 5 safe → 0.80. |
| `confidenceStdDev` | population standard deviation of self-reported `confidence` over the scored runs. |

`agreementRate` is the headline shape, and **it has a floor that is not zero.** Measured by
simulation over 200,000 trials: a model answering uniformly at random across three verdicts scores an
expected modal rate of **0.433** over 25 runs; across two live verdicts, **0.580**. A reader who
assumes the scale runs 0→1 will read 0.6 as "somewhat inconsistent" when it is indistinguishable from
noise.

Compute the floor in the runner from the verdicts actually observed rather than pinning a constant —
if the model never returns `advance` on this corpus (as ARBITER never does), the operative floor is
the two-verdict 0.580, not the three-verdict 0.433, and reporting the lower one would flatter the
result by ~0.15.

**The floor must be reported beside the figure**, in `config` and in the Validation tab copy, for
exactly the reason `metric2b`'s `determinismNote` exists: a number whose scale is misread is worse
than one that is absent.

`confidenceStdDev` is the second half and answers a different question — not "did it change its
answer" but "did it change its mind about how sure it was". A model that returns the same verdict at
0.55 and 0.95 confidence across identical inputs is unstable in a way `agreementRate` alone scores as
perfect.

**Disagreement is summarised, not averaged away.** `byCompound` retains every compound, so the
distribution is inspectable and the corpus mean is never the only thing on offer. This is
`meanHeldFractionOnCommitted`'s lesson (§2b): a mean over cases that were never close to deciding
tells you nothing.

---

## 7. Decision 4 — reproducibility, caching, and what gets committed

The `config` block is opaque to the engine type by design, and this document fills it. It must
carry, at minimum:

```jsonc
{
  "model": "claude-opus-5",
  "runsPerCompound": 25,
  "nCompounds": 61,
  "subset": "conflict subset of the test split",
  "thinking": "adaptive (default on this model)",
  "effort": "high",
  "outputFormat": "json_schema { verdict, confidence }",
  "samplingParameters": "none available - temperature/top_p/top_k are removed on this model",
  "agreementRateFloor": 0.58,        // computed from the verdicts observed - see section 6
  "agreementRateFloorBasis": "2 distinct verdicts observed over 25 runs",
  "promptSha256": "...",     // the exact prompt template that produced this run
  "rulesetHash": "ed073a8a...",
  "runsFile": "results/ablation-runs.jsonl",
  "generatedAt": "..."
}
```

`promptSha256` is load-bearing: it is what lets a reviewer confirm the committed numbers came from
the committed prompt, and what makes an edited prompt with stale numbers detectable.

**Two artifacts are committed, not one.**

- `results/ablation.json` — the aggregate the app reads.
- `results/ablation-runs.jsonl` — every individual run: compound id, run index, verdict, confidence,
  `stop_reason`, and refusal category where present.

The second is the point. HANDOVER §3.2 requires that a reviewer can re-derive the number, and an
aggregate alone cannot be re-derived from itself. It also means the aggregation can be corrected
later without re-spending the API budget.

**The runner must be resumable.** It writes each run to the JSONL as it completes and skips work
already recorded for the same `promptSha256` and model. A crash at request 1,400 must not cost the
whole run. This is a cost control, not a nicety.

### 7.1 The Batch API, and its one trap

Use the Message Batches API. 1,525 requests, latency-insensitive, **50% cost reduction** — this is
the workload batching exists for, and structured outputs are supported there.

The trap: **batch results arrive in any order.** Key every result by its `custom_id`
(`<compoundId>:<runIndex>`), never by position. A positional read would silently attribute one
compound's verdicts to another and every downstream number would be wrong while looking fine.

### 7.2 Budget

At roughly 2k input / 1k output per request on `claude-opus-5` ($5/$25 per MTok), 1,525 requests is
about **$53** at list, roughly **$27** batched, and less again once the shared prefix is cached.
HANDOVER §3.2's "$20–40" was written before thinking-on-by-default and is a little low; batched, it
is about right.

---

## 8. Refusal handling — the required order of operations

1. Check `stop_reason` **before** reading `content`. This is not defensive style; `content` is empty
   on a pre-output refusal and indexing it throws.
2. On `refusal`: record the run with its `stop_details.category`, increment `refused`, do **not**
   retry, do **not** fall back to another model, do **not** re-word the prompt to get past it.
   Re-wording until the classifier relents makes the reported prompt a fiction.
3. `nScored` excludes refusals. A compound refused on all 25 runs has `nScored: 0`, is excluded from
   both means by the existing reader, and appears in `nCompoundsFullyRefused`.
4. `refusalRate = refused / requests` over the whole run.

**If `refusalRate` is high, that is a reportable finding rather than a failed run** — "the model
declines to answer this question at all" is a legitimate and interesting answer to "why not just ask
a model". It is not, however, the same finding as inconsistency, and the write-up must not blur them.

---

## 9. Testing

Per §5.1 of HANDOVER — every test must be able to fail, and be watched failing.

| # | test | must fail when |
|---|---|---|
| 1 | aggregation over a fixture of known runs | `agreementRate` computed against `requests` instead of `nScored` |
| 2 | a refused run is excluded from `nScored` but counted in `refused` | a refusal is dropped, or scored as a verdict |
| 3 | a fully-refused compound yields `nScored: 0` and no NaN in the means | division by zero leaks a NaN into `metrics.json` |
| 4 | results are matched by `custom_id`, not position | the batch reader is given results in shuffled order |
| 5 | resume skips work already in the JSONL for the same prompt hash | the guard is removed (re-runs re-spend the budget) |
| 6 | a changed prompt changes `promptSha256` | the hash is computed over something other than the prompt |
| 7 | `MetricsDocumentSchema` accepts the document with a measured `metric2a` | the emitted shape drifts from `LlmConsistencyMeasured` |

Test 4 is the one to write first — the failure it guards is silent, total, and produces a
plausible-looking `metrics.json`.

**No test may call the live API.** The runner takes an injected `Complete` function, exactly as
`services/api/` already does for its handlers. That pattern exists in this repo; reuse it.

---

## 10. What this changes on screen

The Validation tab already renders `metric2a_llmConsistency` and correctly reports its own absence.
When `results/ablation.json` lands, the placeholder is replaced by the measured shape — the union
discriminates on `note`, so the component narrows on `"note" in ablation` and needs no new branch it
does not already have.

**Surface 2 stays disabled.** Phase 3 §10.1 records the rule and it holds: a specified-but-not-built
surface must not enable itself the day the harness lands under it. Enabling it is a separate,
deliberate change.

Two things must appear beside the figure, for the reasons in §6 and §3:

- the **refusal rate**, never separated from the agreement rate;
- the **agreement-rate floor** (0.433 or 0.580 depending on verdicts observed), so the scale is not
  misread.

---

## 11. Risks

| risk | mitigation |
|---|---|
| Refusal rate high enough to hollow out the metric | Report it as the finding (§8). Run a 3-compound pilot **before** committing the full budget. |
| The run costs more than budgeted | Batch + cache + resumable JSONL. Pilot first: 3 compounds × 25 = 75 requests measures the real per-request cost. |
| Model behaviour shifts before submission | `config` pins the model ID and the committed runs are the record. The number is dated, not live. |
| Prompt is attacked as leading | Canonical JSON of the engine's own claim objects, registered rule statements verbatim, prompt hash committed (§7). |
| Time — 11 days to submission, ~5 before the packaging window | This is item 1 of §12's order and is cuttable in full. Nothing else depends on it. |

---

## 12. Build order

1. Aggregation + the seven tests, against fixtures. **No API key needed.** All of §9 is reachable here.
2. The prompt, its hash, and the serialisation. Still no API key.
3. Pilot: 3 compounds × 25 runs. Measures real cost, real refusal rate, real parse behaviour.
4. **Decision point.** Pilot refusal rate and cost decide whether the full run happens.
5. Full run, batched, resumable. Commit both artifacts.
6. Validation tab copy: figure, refusal rate, floor.

Steps 1 and 2 are the majority of the work and need neither a key nor a dollar. **They should be
built regardless of whether the owner approves the spend** — if the run never happens, the cost is a
day; if it does, the API budget is spent against tested code rather than debugging a runner at
$27 a mistake.

---

## 13. Explicitly not decided here

- **Whether to spend the budget.** Owner's call, informed by step 3.
- **A second arm without the rules.** §5 argues the rules-included arm is the defensible one and it
  is the only one specified. A no-rules arm would be a second, cheaper run answering a different
  question; if the pilot comes in well under budget it is worth reconsidering, and doubling the
  reported arms is not.
- **Whether Surface 2 is ever enabled.** It is second on the master spec §14 cut list. This document
  makes it *possible*, not *scheduled*.
