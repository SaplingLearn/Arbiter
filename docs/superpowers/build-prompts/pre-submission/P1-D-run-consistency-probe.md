# P1-D: Run Gate 0, the consistency probe, and record whatever it says

| | |
|---|---|
| **Priority** | P1. HANDOVER section 13.4e: "If only one thing gets done: Gate 0." |
| **Estimated effort** | 1 hour, plus roughly one dollar of model spend |
| **Depends on** | credentials for one model provider, and nothing else |
| **Touches** | `results/probe-runs.json` and `results/gate0-consistency.txt`, both generated |
| **Do not touch** | `rules/pass-marks-v1.0.json`, `prompts/adjudicator-*.json` |

---

## Why this is P1 with no code in it

The project's primary claim is **consistency**: identical evidence yields an identical
recommendation. For the deterministic engine that is proven, by a test that hashes 1000
runs and asserts one hash. For the **model adjudicator** it is unmeasured. The whole
comparison the pitch wants to draw, deterministic core against a language model on
identical inputs, currently has one side missing.

Every piece of tooling exists. There is no code to write. Verify the measurement has
never been run:

```bash
ls -la results/probe-runs.json
```

Expected today: no such file.

**The pass marks were committed before any model was called**, which is the entire point
of them, and `rules/pass-marks-v1.0.json` says so in its own `registrationNote`. Read them
before you run anything, and do not change them afterwards:

| pass mark | value |
|---|---|
| flip rate over 20 runs of one case | **at most 0.10** |
| per-rule position agreement | **at least 0.80** |
| hallucinated citations | **0**, enforced by `verifyAdjudication`, so any occurrence is a 502 |

**The failure rule, also pre-committed:** a failing flip rate is a **design** defect, not
a prompt defect. Do not respond by rewriting the prompt and re-running. Record the number.
That instruction predates this result and is in the pass-marks file.

---

## What changed recently, and why it matters here

`origin/main` moved the AI surfaces to **Gemini on Vertex**. Provider is inferred from
the model name in `services/api/interpret.ts`:

```ts
export function providerFor(model: string): Provider {
  return model.startsWith("gemini-") ? "vertex" : "anthropic";
}
```

Defaults, from the same file: `DEFAULT_ADJUDICATION_MODEL = "gemini-3.5-flash"`, and
`resolveModel("adjudication", env)` reads `ARBITER_ADJUDICATION_MODEL`, then
`ARBITER_MODEL`, then that default. The probe resolves its model with the same function
the server uses (`services/api/probe.ts:153`, `:177`).

So **the default run is Gemini**, and any older instruction telling you to set
`ANTHROPIC_API_KEY` is stale. Credentials, from `services/api/gemini.ts`:

- Project: `ARBITER_GCP_PROJECT` or `GOOGLE_CLOUD_PROJECT`
- Credentials: `GOOGLE_APPLICATION_CREDENTIALS` (path to a key file) or
  `GOOGLE_APPLICATION_CREDENTIALS_JSON` (inline), or ambient gcloud application default
  credentials

To run against Anthropic instead, name a non-Gemini model and supply its key:

```bash
export ARBITER_ADJUDICATION_MODEL=claude-opus-5
export ANTHROPIC_API_KEY=...
```

`buildComplete` returns `null` rather than throwing when the chosen provider has no
credentials, so a missing key is a first-class state and the probe falls back to a
deterministic stub labelled `"source": "stub"` in the output.

---

## Step by step

- [ ] **Step 1: Write down the pass marks before you look at anything**

```bash
python3 -c "import json; p=json.load(open('rules/pass-marks-v1.0.json')); print('flip rate ceiling:', p['consistency']['maxFlipRate']); print('runs:', p['consistency']['runsPerCase']); print('rule agreement floor:', p['ruleStability']['minAgreement'])"
```

Write the three numbers somewhere outside the terminal. If you only read them after
seeing a result, they stop being pass marks and become a description.

- [ ] **Step 2: Confirm the probe case exists**

```bash
ls -la data/probe-case.json data/probe-case-coverage.json
```

If `data/probe-case.json` is missing, rebuild it:

```bash
npm run probe:case
```

- [ ] **Step 3: Exercise the whole path on the stub first, with the output redirected**

Do this before spending anything. A crash on run 17 of 20 wastes the budget and teaches
you nothing about the model.

```bash
env -u ANTHROPIC_API_KEY -u GOOGLE_APPLICATION_CREDENTIALS \
  PROBE_OUT=/tmp/probe-stub.json npm run probe
PROBE_OUT=/tmp/probe-stub.json npm run probe:report
```

Expected: a report prints and says `source stub`. The stub is deterministic by design, so
it reports a flip rate of exactly 0. **That number is meaningless and must never be
quoted.** You are checking that the pipeline runs, nothing more.

If this errors, fix the error before Step 4.

- [ ] **Step 4: Run it live**

Set credentials for whichever provider you are using, then:

```bash
npm run probe
```

Expected: `results/probe-runs.json` written, with `"source": "live"` and 20 entries under
`runs`. Confirm:

```bash
python3 -c "import json; d=json.load(open('results/probe-runs.json')); print(d['source'], d['model'], d['promptVersion'], d['promptHash'][:12], len(d['runs']))"
```

- [ ] **Step 5: Produce the report and keep it**

```bash
npm run probe:report | tee results/gate0-consistency.txt
```

- [ ] **Step 6: Write the verdict against the pass marks, whatever it says**

Append to `results/gate0-consistency.txt` two lines naming the mark and the measurement,
for example:

```
PASS MARK  flip rate <= 0.10 over 20 runs (rules/pass-marks-v1.0.json v1.0)
MEASURED   flip rate 0.05, 1 of 20 runs disagreed with the modal verdict
MODEL      gemini-3.5-flash on vertex, prompt v1.1 hash 4a91c0e2f8d3
```

Name the model and the prompt hash. A consistency figure that does not say which model
and which prompt produced it is not a measurement of anything.

- [ ] **Step 7: If the flip rate exceeds 0.10, stop**

Do not rewrite the prompt. Do not re-run hoping for a better draw. Record the number,
tell the team, and treat it as a design finding: the pitch's consistency comparison
changes, and the claim becomes "we specified this measurement, ran it, and it did not
support the comparison", which is a stronger thing to say in a judged Q and A than a
number that was tuned until it passed.

- [ ] **Step 8: Commit the raw runs, not only the summary**

```bash
git add results/probe-runs.json results/gate0-consistency.txt
git commit -m "Measure Gate 0 consistency on the probe case

Twenty runs of one case against the pass marks pre-registered in
rules/pass-marks-v1.0.json before any model was called.

Raw runs committed alongside the report: a flip rate whose underlying answers
were discarded is an assertion rather than a measurement, and the collection and
analysis halves are split precisely so re-analysing costs nothing and never
becomes a reason to call the model again."
```

---

## Definition of done

- [ ] `results/probe-runs.json` exists with `"source": "live"` and 20 runs.
- [ ] `results/gate0-consistency.txt` exists and names the model, the prompt hash, the
      pass mark and the measured value.
- [ ] Both are committed.
- [ ] Nobody has edited `rules/pass-marks-v1.0.json`.

## If you have no credentials at all

Then this task is **skipped, not faked**. Nothing downstream blocks on it: every other
prompt in this folder is independent of Gate 0. What changes is the pitch. Remove any
claim that compares ARBITER's determinism against a measured model inconsistency, and say
instead that the measurement is specified, the tooling is built, the pass marks are
committed, and it has not been run. That is honest and it is defensible. A comparison
asserted without the run is neither.

## Traps specific to this task

- **The stub reports flip rate 0.** It is deterministic on purpose
  (`services/api/probe.ts`), and its reasoning field literally says "STUB, no model was
  called. This is not a result." Quoting a stub run as a consistency figure would be the
  worst single error available in this whole folder.
- **Any instruction to set `ANTHROPIC_API_KEY` is stale** unless you have also set
  `ARBITER_ADJUDICATION_MODEL` to a non-Gemini model. Provider follows the model name.
- **`verifyAdjudication` turns a hallucinated citation into a 502**, so unverified runs
  are excluded from the flip rate by `consistency-report.ts` and reported separately.
  Those are two different failures and the report keeps them apart. Read both numbers.
- **Held-out discipline.** Re-running against a revised prompt makes a case a development
  case permanently. The iteration budget in the pass-marks file is five prompt revisions,
  each logged with its result.
