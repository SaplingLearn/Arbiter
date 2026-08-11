# ARBITER — model provider decision

**Status: decision, recorded 2026-08-10. Required by the AI redesign §9, which permits
"no third-party model provider without that being an explicit recorded decision."**

---

## 0. What is being decided

The product's AI surfaces move from the Anthropic API to **Gemini on Google Vertex AI**.

Affected: `interpret`, `navigate`, `adjudicate`, the deliberation adjudication, the
consistency probe (Gate 0), and the LLM ablation's adversary arm. Not affected:
`packages/engine`, the record and hash chain, or any deterministic check — §10 #4 stands
and no model touches the record.

This document exists because §9 requires it. Before it, the only trace of the change was
a constant in `services/api/interpret.ts`, which is not a decision, it is a side effect.

---

## 1. Why

**The Anthropic API cannot be paid for from the credit this project is deployed
against.** Google's free-trial documentation is explicit:

> "You can't access or use the $300 credit for a generative AI partner model that is
> offered as a managed API, which is also known as model as a service."

Claude on Vertex AI is exactly that category — it resolves under
`publishers/anthropic`, and it is priced on a separate page from Gemini. Measured
2026-08-10 in project `project-7f4f8910-63be-4b85-a67`: `claude-sonnet-5` and
`claude-opus-4-5` both return **429, quota 0**, not 404. The models are visible and the
per-base-model quota is zero. The same documentation records that a trial account
**cannot request a quota increase**, so that 429 is not a form to fill in.

Gemini on Vertex AI (`aiplatform.googleapis.com`) is not a partner model and is covered.
The distinction is *partner model*, not *endpoint*: Gemini and Claude share the Vertex
hostname and only one of them is payable here.

**This is a funding constraint, not a capability judgement.** It is recorded that way on
purpose. Nothing measured in §3 says Gemini is better than Claude at this task; what was
measured is that two Gemini models clear Gate 0's flip-rate mark.

---

## 2. Confidentiality — the reason §9 asks

§9's risk row is *"Uploaded documents may be confidential"*: the moment ARBITER accepts a
real sponsor's study report it holds unpublished safety data, and an adjudication payload
is the one thing that leaves storage.

**What this decision changes:** that payload now goes to Google rather than Anthropic.

**What has NOT been established, and must be before any sponsor data is accepted:**

- Google's data-handling terms for Vertex AI generative models — retention, human
  review, and whether inputs may be used to improve the service. **This has not been
  verified and must not be assumed.** It is the blocking question for §9's row, and it is
  a contractual question rather than a technical one.
- Whether the deployment sets `inference_geo`. Vertex exposes a residency pin that the
  first-party Anthropic API does not; it is currently unset, so requests follow the
  workspace default.
- Whether a per-case opt-out is needed for sponsors who will not accept any third-party
  processor.

**Until those are settled this decision covers public and synthetic data only.** TAK-994
and the approval-package cases in §4.5 of the redesign are public documents. No sponsor
document may be adjudicated under this decision as recorded.

---

## 3. The models, and the evidence for them

Measured on `data/probe-case.json` (caseHash `6d5c14178d72`), prompt v1.0
(promptHash `42f548ea1df3`), 20 runs each, via `npm run probe && npm run probe:report`.
Raw runs are committed; a reported flip rate whose answers were discarded is an
assertion.

| surface | model | why |
|---|---|---|
| `interpret`, `navigate` | `gemini-2.5-flash-lite` | The only candidate emitting **zero** thought tokens by default, ~850ms against the 2.5s client abort. On an ambiguous mechanism-objection it returned `targetRule=null` 3/3 where `gemini-3.5-flash-lite` named a rule the objection never named, 3/3. |
| `adjudicate`, deliberation | `gemini-3.5-flash` | The **only** candidate clearing all three Gate 0 pass marks: flip rate 0.0%, zero hallucinated citations, every rule ≥ 0.80 (worst 80.0%). `gemini-2.5-pro` fails the third at R1 75.0%. |
| ablation adversary | `gemini-3.5-flash` | See §5. |

`gemini-2.5-pro` **rejects `thinkingBudget: 0`** (HTTP 400). Irrelevant to adjudication,
which wants thinking on, but it can never serve a short-call shape.

**Amended 2026-08-10, after measurement.** This table read `gemini-2.5-pro` for
adjudication until three successive measurements overturned it — n=5 → n=20,
then `temperature: 0`, then the `inApplicabilityDomain` fix. Each earlier reading was
recorded and each was wrong in the same way: called before the measurement could carry
it. The figures above are 20 runs at temperature 0 against caseHash `9677b5a68c09`.

**The Pro tier lost.** Stated plainly because it inverts the usual instinct: §7.1 makes
consistency the primary claim and says accuracy is not first, and on that axis the flash
models were better behaved than either Pro model.

---

## 4. What the move buys the primary claim

Redesign §7.1 lists **deterministic decoding** first among the mitigations applied before
the flip rate is measured, and the flip rate is the redesign's primary claim.

`temperature`, `top_p` and `top_k` are **removed on every current Claude model** — the
ablation spec records this — so on the Anthropic path that mitigation is unavailable.
Vertex accepts `temperature: 0`, and it is now set in `services/api/gemini.ts`.

So the provider move is not only a way to pay the bill; it restores a §7.1 mitigation
that could not be applied before. That is an argument for the decision, and it was found
after the decision was already forced by §1 — recorded in that order so nobody reads it
as the reason.

---

## 5. Consequence for the ablation

The ablation spec pins the adversary to `claude-opus-5`, on the grounds that *"that arm
has to be frontier or 'why not just ask a model' is a strawman."* That pin cannot hold
under §1, and the adversary becomes `gemini-2.5-pro`.

**The ablation is now same-model on both arms, and must be reported as such.** This is
defensible and arguably stronger: with the product and the adversary on one model, the
comparison isolates the engine's contribution instead of confounding it with a
model-tier gap. The original pin existed because the product ran Sonnet and needed a
frontier opposite; that asymmetry is gone.

The ablation spec's model section and its cost estimate are stale and must be amended
before any ablation number is reported.

---

## 6. What this decision does not license

1. **No sponsor document** is adjudicated under it until §2's open questions are closed.
2. **No change to §10.** Every item stands, in particular #3 (no unverified model output
   reaches the screen) and #4 (no model touches the record).
3. **No re-reporting of past numbers.** Results measured on Claude keep their model
   label; §7.2a's discipline applies to the provider exactly as it applies to the prompt.
4. **No claim that Gemini is more capable.** §1 is the reason. Capability was not tested
   across providers and no such comparison is recorded here.

---

## 7. Reversal

`buildComplete` in `services/api/interpret.ts` infers the provider from the model name,
so reversal is one environment variable plus an `ANTHROPIC_API_KEY`:

```bash
ARBITER_ADJUDICATION_MODEL=claude-opus-5 ANTHROPIC_API_KEY=... npm run probe
```

Verified 2026-08-10: with no key set, that command resolves to the Anthropic path and
reports "No credentials for claude-opus-5", rather than silently running on Gemini and
labelling the result `claude-opus-5`. That failure mode — a probe that runs one model and
reports another — is what `5501c2c` and HANDOVER §3.2 exist to prevent, and the provider
split preserves it.
