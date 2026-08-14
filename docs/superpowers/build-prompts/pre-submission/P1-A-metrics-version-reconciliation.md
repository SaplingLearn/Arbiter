# P1-A: Stop the app displaying a number the team has published a correction retiring

| | |
|---|---|
| **Priority** | **P1 BLOCKING.** Nothing else in this folder matters if a judge sees an invalidated number. |
| **Estimated effort** | Path B: 2 to 3 hours. Path A: 1 to 2 days. Read the decision section first. |
| **Depends on** | nothing |
| **Touches** | `results/metrics.json`, `apps/web/src/tabs/About.tsx`, `apps/web/src/tabs/Validation.tsx`, `apps/landing/src/sections/Metrics.tsx`, `apps/landing/src/sections/Result.tsx`, `apps/landing/src/sections/RecordSpeaks.tsx`, tests listed below |
| **Do not touch** | `rules/ruleset-v1.0.json`, `rules/ruleset-v2.0.json`, `results/results.json` |
| **Branch note** | Written against `origin/main`. Verify you are on a branch that contains commit `1055a97` or later before starting. |

---

## The problem, in one paragraph

`results/metrics.json` carries `provenance.rulesetVersion: "1.0"` and reports
`metric1_conflictSubsetAccuracy.arbiter.balancedAccuracy: 0.75` with confusion
`{tp: 4, fp: 0, tn: 0, fn: 0}` and `singleClass: true`. Both the product app and the
marketing site render those figures. `HANDOVER.md` section 13.1 declares the v1.0
binarisation invalid, and `rules/ruleset-v2.0.json` re-registered the target on
2026-08-09 with a written rationale. So the shipped surfaces display the exact number
the team's own published correction exists to withdraw. A judge who opens the About tab
during the demo sees it. This is the single highest-priority pre-submission task and the
Evidence-Integrated Playbook names it as blocking.

Verify it yourself before doing anything else, because everything below depends on it:

```bash
python3 -c "import json; m=json.load(open('results/metrics.json')); print(m['provenance']['rulesetVersion'], m['metric1_conflictSubsetAccuracy']['arbiter']['balancedAccuracy'], m['metric1_conflictSubsetAccuracy']['arbiter']['confusion'])"
```

Expected today: `1.0 0.75 {'tp': 4, 'fp': 0, 'tn': 0, 'fn': 0}`.

---

## Repository orientation you need

- TypeScript ESM monorepo. `apps/web` is a Vite + React app that runs `@arbiter/engine`
  in the browser over JSON bundled at build time. `apps/landing` is the marketing site.
  `apps/harness` produces the metrics. There is no Python backend and no database.
- `results/metrics.json` has exactly **one** import site:
  `apps/web/src/data/bundle.ts:18`. Everything else reads
  `useAppState().data.metrics`.
- The file is validated on load by `MetricsDocumentSchema`
  (`packages/engine/src/schema.ts:249-284`). A hand edit that violates a cross-field
  invariant makes the app throw `DataLoadError` on boot instead of rendering.
- `apps/landing` does **not** read `metrics.json` at runtime. Its figures are
  hardcoded strings, and `apps/landing/test/landing.test.tsx:168-188` reads
  `metrics.json` off disk and asserts the hardcoded page figures match it. That test is
  your safety net in both paths: if the file and the page disagree, it fails.

**House rules that apply here.** No em dashes anywhere. Write "review-ready evidence
package" not "regulator-ready dossier". Never quote a figure without its denominator and
class balance, because omitting exactly that is what produced the 0.750 headline in the
first place.

---

## The numbers, so you never guess

From `results/rescore-v2.txt`, the committed transcript of `tools/rescore_v2.py`.

**Conflict subset, n = 61.** This is the subset `metric1` reports, so this is the
apples-to-apples replacement table:

| pipeline | v1.0 balanced acc | v2.0 balanced acc | v2.0 confusion |
|---|---|---|---|
| ARBITER | 0.750 | **0.500** | tp 1 / fp 3 / tn 0 / fn 0 |
| single:transporter | 0.750 | 0.500 | tp 1 / fp 3 / tn 0 / fn 0 |
| majorityVote | 0.750 | **0.250** | tp 0 / fp 3 / tn 0 / fn 0 |
| single:cytotox | 0.500 | 0.500 | tp 0 / fp 0 / tn 43 / fn 18 |
| single:qsar | 0.500 | 0.500 | tp 17 / fp 43 / tn 0 / fn 0 |
| weightedAverage | 0.547 | **0.519** | tp 17 / fp 39 / tn 4 / fn 1 |

Positive rate in the subset moves from 90.2% under v1.0 to 29.5% under v2.0.

**Full scored split, n = 267, positives 21.7% under v2.0:** ARBITER 0.500
(tp 2 / fp 5 / tn 0 / fn 0), majorityVote 0.471, single:cytotox 0.507,
single:qsar 0.601, weightedAverage 0.516.

**Two traps in those numbers.**

1. `HANDOVER.md` section 13.2's table is labelled "full scored split" but its v1.0 row
   reports `tp 4 / 0 / 0 / 0`, which is the **conflict subset** confusion. The two rows
   in that table come from different subsets. The transcript is the authority:
   full-split v1.0 ARBITER is `tp 7 / fp 0 / tn 0 / fn 0` at `results/rescore-v2.txt:53`.
   Do not copy the HANDOVER table.
2. **Under v2.0 the tie story changes shape.** ARBITER at 0.500 now ties
   `single:transporter`, `single:cytotox` and `single:qsar`, and is **beaten by**
   `weightedAverage` at 0.519. The About tab's headline sentence "It does not beat the
   best baseline. It ties one, exactly." becomes false. It would tie three and lose to
   one. This sentence is hardcoded prose, not derived, so no regeneration fixes it.

**Four figures do not move under v2.0**, because v2.0 changes only the target
definition and `ruleset-v2.0.json`'s own `scopeNote` says R1-R6 are byte-identical:
coverage 6.6%, committed 4 on the subset and 7 on the full split, decline rate 97.4%,
planner stability 0.992. `nStructurallyForced: 254` also does not move.

---

## The decision: which path

**Path B, version-label and correct the prose, is the default.** Take Path A only if
you have a clear day and nothing more valuable to do with it. Here is the honest cost
comparison, so you choose on facts rather than ambition.

**Path A, re-grade under v2.0, requires all of this:**

- `apps/harness/src/load.ts:41` hardcodes the string `"rules/ruleset-v1.0.json"` and is
  not parameterised.
- `apps/harness/src/load.ts:49-57` compares the computed hash against
  `PRE_REGISTERED_HASH` unconditionally. Under v2.0 the computed hash is `984dc08d...`
  and this **throws before anything runs**, in `npm run harness`, `npm run metrics`,
  `npm run validate:evidence` and `npm run coverage:report` alike.
- Every metric takes `y` from `ResultRow.y`, written under v1.0. A re-grade needs a
  relabelling step from `compounds.json.dilirankLabel` to the v2.0 policy. **That
  function exists only in Python** (`tools/rescore_v2.py:108-119`). There is no
  TypeScript `relabel`.
- `apps/harness/src/run-metrics.ts:58-59` copies provenance from `results.json`, which
  says v1.0, so either `results.json` changes or that copy stops.
- The golden file moves a lot. `results/golden/metrics.golden.json` pins
  `rulesetHash`, `arbiterBalancedAccuracy: 0.75`, `arbiterBalancedAccuracyCi: null`,
  every baseline accuracy and CI, and the calibration widths.
  `apps/harness/test/golden.test.ts:196-205` fails until you run `npm run golden:update`,
  and CI runs it at `.github/workflows/ci.yml:23`.
- **A schema landmine.** `ScoredPipelineSchema`
  (`packages/engine/src/schema.ts:93-128`) enforces that confusion sums to
  `nCommitted` (`:108`), that `singleClass` agrees with the confusion counts (`:114`),
  and that `balancedAccuracyCi === null` **exactly when** `singleClass === true`
  (`:121`). Under v2.0 the ARBITER row becomes `tp1/fp3/tn0/fn0`, so `singleClass`
  flips to `false` and the CI **must** become non-null. Change the accuracy without
  changing those three together and the app throws `DataLoadError` on boot.
- **The sharpest trap.** `tools/rescore_v2.py:194-212` contains a drift guard that reads
  `results/metrics.json` and asserts it still matches the **v1.0** re-grade, exiting 1
  on mismatch. The artifact that proves v1.0 was wrong is anchored to v1.0's numbers
  still being on disk. Replace `metrics.json` in place and you break the proof.

**Path B costs none of that.** Nothing in it trips a hash guard, and
`extractGolden` (`apps/harness/src/golden.ts:88-120`) does not project
`rulesetVersion` or the provenance `note`, so the golden file does not move.

---

# PATH B: version-label and correct the prose

The goal: make it impossible to read any figure on any surface without also reading
which target definition produced it, and remove every sentence that the correction has
made false.

## Step by step

- [ ] **Step 1: Confirm the schema will accept a longer provenance note**

`MetricsProvenanceSchema` (`packages/engine/src/schema.ts:130-137`) types `note` as
`z.string().min(1)`, so any content is legal. Confirm by reading that block:

```bash
sed -n '130,137p' packages/engine/src/schema.ts
```

Do **not** add a new provenance field. `MetricsProvenance` has no `supersededBy` or
`targetDefinition` key, and adding one means editing `packages/engine/src/types.ts`,
both halves of `schema.ts`, and satisfying the bidirectional drift guard
`MetricsShapeMatchesInterface` at `schema.ts:308`. The existing `note` carries the
message with no type surgery.

- [ ] **Step 2: Write the failing test for the on-screen scoring label**

Add to `apps/web/test/validation.test.tsx`:

```tsx
it("names the scoring target beside the accuracy, so no figure is quotable alone", () => {
  const { getByTestId } = renderValidation();
  const scoring = getByTestId("scoring-target").textContent ?? "";
  expect(scoring).toMatch(/v1\.0/);
  expect(scoring).toMatch(/superseded/i);
  expect(scoring).toMatch(/ruleset-v2\.0\.json/);
});
```

Use whatever render helper the neighbouring tests in that file already use. Read the
top of the file first and reuse it rather than writing a second one.

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run apps/web/test/validation.test.tsx
```

Expected: FAIL, no element with `data-testid="scoring-target"`.

- [ ] **Step 4: Put the scoring target on the Validation tab**

In `apps/web/src/tabs/Validation.tsx`, immediately after the provenance line
(currently `:52-54`, `data-testid="provenance"`), add:

```tsx
<p className="scoring-target" data-testid="scoring-target">
  <strong>Scored against ruleset v{m.provenance.rulesetVersion}, which this project
  has since superseded.</strong>{" "}
  The v1.0 binarisation counted vLess-DILI-Concern as positive, which placed 330 of 536
  positives in a class containing aspirin, amoxicillin, atenolol, amlodipine and
  apixaban. Under that target a system correctly declining to flag amlodipine scores as
  wrong. <code>rules/ruleset-v2.0.json</code> re-registered the target on 2026-08-09.
  Every figure on this page is reported under v1.0 and is not comparable to a v2.0
  figure. The re-graded numbers are in <code>results/rescore-v2.txt</code>.
</p>
```

- [ ] **Step 5: Run it and watch it pass**

```bash
npx vitest run apps/web/test/validation.test.tsx
```

- [ ] **Step 6: Fix the About tab's tie sentence, which the correction has made false**

`apps/web/src/tabs/About.tsx:154` is a hardcoded heading:

```tsx
<h2 className="title">It does not beat the best baseline. It ties one, exactly.</h2>
```

Under v2.0 ARBITER ties three baselines and is beaten by `weightedAverage` at 0.519.
The sentence is a claim about a comparison that the retired target produced. Replace the
heading and the paragraph beneath it (`:156-166`) with a framing that survives both
targets:

```tsx
<h2 className="title">Under an honest target, nothing here works.</h2>
```

and the body:

```tsx
<p>
  On the pre-registered conflict subset, scored under ruleset v1.0, ARBITER and{" "}
  <span className="mono">single:transporter</span> return the same figure in every
  column: {arbiter.balancedAccuracy.toFixed(3)} balanced accuracy,{" "}
  {pct(arbiter.coverage)} coverage, {arbiter.nCommitted} compounds committed, and the
  identical confusion matrix.
</p>
<p>
  That comparison was made under a target this project has since retired. Re-graded
  against <span className="mono">rules/ruleset-v2.0.json</span>, ARBITER scores 0.500 on
  the same subset and the best pipeline tested reaches 0.601. The finding is not that
  one system underperforms. It is that predicting this endpoint from public evidence
  streams is unsolved by every method measured, which is why a system that refuses to
  commit without adequate evidence is the correct design rather than a broken one.
</p>
```

Keep the existing `data-testid="about-tie"` on whichever element the test at
`apps/web/test/about.test.tsx:24-27` targets, or update that test in the same commit.
Note that `about.test.tsx:27` asserts `/does not beat the best baseline/i`, so it will
fail on this edit: change it to assert the new claim rather than deleting it.

- [ ] **Step 7: Correct the four hardcoded 0.750 sites on the marketing page**

None of these read `metrics.json`. All are literal strings.

| file | line | current |
|---|---|---|
| `apps/landing/src/sections/Metrics.tsx` | `:27` | `to: 0.75, decimals: 3` renders `0.750` labelled "Balanced Accuracy" |
| `apps/landing/src/sections/Result.tsx` | `:19` | `{ pipeline: "ARBITER", accuracy: "0.750", ... }` |
| `apps/landing/src/sections/Result.tsx` | `:20` | `{ pipeline: "single:transporter", accuracy: "0.750", ... }` |
| `apps/landing/src/sections/Result.tsx` | `:21` | `{ pipeline: "majorityVote", accuracy: "0.750", ... }` |
| `apps/landing/src/sections/RecordSpeaks.tsx` | `:71-72` | `who: "Balanced acc. 0.750"`, `what: "Conflict subset n=61"` |

For each, either replace the v1.0 figure with its v2.0 counterpart from the table at the
top of this prompt, **or** keep the figure and add the scoring label beside it. Do not
mix the two approaches across files: pick one and apply it everywhere, because a page
that labels one number and not another reads as an oversight rather than a discipline.

If you replace figures, the honest v2.0 row set for `Result.tsx` is:
ARBITER 0.500 / 6.6% / 4, single:transporter 0.500 / 6.6% / 4,
majorityVote 0.250 / 4.9% / 3, weightedAverage 0.519 / 100% / 61.
Note that `weightedAverage` then outscores ARBITER, so check the surrounding copy at
`Result.tsx:51` ("It Does Not Beat The Baseline.") still reads correctly. It does, and
it becomes more accurate rather than less.

- [ ] **Step 8: Make the landing test enforce whichever choice you made**

`apps/landing/test/landing.test.tsx:168-188` reads `results/metrics.json` off disk and
asserts the page renders `metric1.arbiter.balancedAccuracy`. If you replaced the page
figures with v2.0 numbers while `metrics.json` still says 0.75, **this test now fails,
and that is correct behaviour**: the page and the file genuinely disagree. Update the
test to assert against the v2.0 transcript rather than against `metrics.json`, and leave
a comment saying why the source of truth moved.

- [ ] **Step 9: Sweep for survivors**

```bash
grep -rn "0\.750\|0\.75\b" apps/web/src apps/landing/src --include=*.tsx --include=*.ts | grep -v node_modules
grep -rniE "beats|outperform|superior|better than" apps/web/src apps/landing/src | grep -v node_modules
```

Every hit must either be gone, be labelled with its scoring target, or be a false
positive you can name. Record which in the commit message.

- [ ] **Step 10: Full verification and commit**

```bash
npm run typecheck && npx vitest run && npm run lint
```

```bash
git add -A
git commit -m "Label every reported figure with the target that produced it

results/metrics.json is scored under ruleset v1.0, whose binarisation HANDOVER
section 13.1 declares invalid. The About and Validation tabs and four sites on
the marketing page rendered those figures with no indication of which target
definition produced them.

The About tab's tie sentence was also false under the corrected target: ARBITER
ties three baselines there and is beaten by weightedAverage at 0.519. Replaced
with the framing the re-grade actually supports."
```

---

# PATH A: re-grade under v2.0

Take this only with a clear day. Every trap listed in the decision section is real and
each one costs an hour when it surprises you.

- [ ] **Step 1: Decide where the output goes, before writing any code**

Do **not** overwrite `results/metrics.json`. It is the artifact
`tools/rescore_v2.py:194-212` anchors its drift guard to. Write
`results/metrics-v2.json` and add a negation to `.gitignore` beside the existing
whitelist at `.gitignore:53-58`.

- [ ] **Step 2: Port `relabel` to TypeScript**

`tools/rescore_v2.py:108-119` is the only implementation. Create
`apps/harness/src/relabel.ts` with a function whose behaviour is byte-identical,
including the `norm()` lowercasing at `:108-109`:

```ts
/** Re-derive the binary label from a DILIrank grade under a named binarisation
 *  policy. Ported from tools/rescore_v2.py:108-119, which is the reference
 *  implementation and stays the reference: a divergence between them is a bug in
 *  this file, not in that one. */
export function relabel(
  dilirankLabel: string,
  binarisation: { positive: string[]; negative: string[]; excluded: string[] },
): 0 | 1 | null {
  const norm = (s: string) => s.trim().toLowerCase();
  const grade = norm(dilirankLabel);
  if (binarisation.positive.some((p) => norm(p) === grade)) return 1;
  if (binarisation.negative.some((n) => norm(n) === grade)) return 0;
  return null;
}
```

Write the test first, with the grades taken verbatim from
`rules/ruleset-v2.0.json.dilirankBinarisation`, and assert that
`vLess-DILI-Concern` maps to 0 under v2.0 and to 1 under v1.0. That single assertion is
the whole correction in one line.

- [ ] **Step 3: Parameterise the ruleset load**

`apps/harness/src/load.ts:41` and the hash guard at `:49-57`. Add an explicit parameter
rather than an env var, so a v2.0 run is something a caller asked for and never
something that drifted. The v2.0 hash is `984dc08dad55683c74bcdaae9b9da810829046669461d193a4687325be192227`
and is already exported as `PRE_REGISTERED_HASH_V2` at
`apps/harness/src/preregistration.ts:75-76`, imported by nothing today.

- [ ] **Step 4: Regenerate, then check the schema invariants by hand**

After writing the file, confirm all three of these hold in the ARBITER row, because the
schema will reject the document otherwise and the error is thrown at load time in the
browser rather than at write time:

- confusion sums to `nCommitted`
- `singleClass` is `false`, since `tp1/fp3/tn0/fn0` has both classes present
- `balancedAccuracyCi` is **non-null**, since `singleClass` is false

- [ ] **Step 5: Regenerate the goldens deliberately and diff them**

```bash
npm run golden:update
git diff --stat results/golden
```

Read the diff. `nStructurallyForced: 254`, `nScored: 267`, `nConflictSubset: 61`,
`declineRate`, `streamCoverage` and `plannerMeanUnchangedFraction` must **not** move,
because none of them reads `y`. If any of them moved, you have re-run more than you
intended and should stop.

- [ ] **Step 6: Then do every step of Path B anyway**

Regenerating the file does not fix the hardcoded prose on About, and does not touch the
five hardcoded figures on the marketing page. Path A is a superset of Path B, not an
alternative to it.

---

## Definition of done

- [ ] `npm run typecheck && npx vitest run && npm run lint` all pass.
- [ ] No figure on the About tab, the Validation tab or the marketing page can be read
      without its scoring target being visible in the same view.
- [ ] `grep -rn "ties one, exactly" apps/` returns nothing.
- [ ] Someone who reads only the screen cannot quote a number that the project's own
      HANDOVER retires.
- [ ] `npm run dev`, then open `http://localhost:5173/` and `http://localhost:5173/app/#/about`
      and read both with fresh eyes as a judge would.

## Traps specific to this task

- **The landing page does not read the metrics file.** Fixing `metrics.json` alone
  changes nothing on the marketing site. Five hardcoded sites, listed in Step 7.
- **`apps/web/test/validation.test.tsx:61-62`** asserts `singleClass === true` and a
  null CI. Under a v2.0 file both flip and this is a hard failure, not a warning.
- **`apps/web/e2e/static-file.spec.ts:114-117`** asserts the font size and weight of
  `single-class-warning`. Under v2.0 that block stops rendering entirely, because
  `Validation.tsx:78` gates it on `arbiter.singleClass`, and the spec then fails on a
  missing element rather than on a number.
- **`apps/web/test/validation.test.tsx:74`** pins the rendered provenance to
  `/ed073a8a/`, which is the v1.0 hash. It fails the moment `metrics.json` carries the
  v2.0 hash.
- **Do not fix a failing test by loosening it.** Each of these tests is telling you a
  real consequence of the change. Update them to assert the new truth, in the same
  commit, with the reasoning in the message.
