# R-6: Conflict-aware fusion, so a wide disagreement stops reading as a narrow certainty

| | |
|---|---|
| **Priority** | Post-submission. A rigor upgrade, **not** a credibility fix. Read the honesty note. |
| **Estimated effort** | 1 to 2 days across two commits |
| **Depends on** | nothing. Pairs naturally with P1-B, which puts the conflict measure on screen. |
| **Touches** | `packages/engine/src/fuse.ts`, `types.ts`, `index.ts`, `rules/fusion-policy-v1.0.json` (new), `apps/harness/test/` |
| **Do not touch** | `rules/ruleset-*.json` |

---

## Honesty note, read this first

An earlier planning document justified this task by pointing at a line in the older full
system specification's Q and A script, which claimed ARBITER would "apply a documented
alternative combination beyond a threshold". That claim was false of the code.

**The current Evidence-Integrated Playbook has reworded that answer** to say ARBITER
"preserves and displays the conflict measure rather than averaging it away", which **is**
true of the code today: `fuse.ts` computes `conflictMass` and returns it rather than
discarding it, and P1-B puts it on screen.

So this is no longer closing a false claim. It is a genuine improvement to how the engine
behaves under high conflict, and it should be presented as that and nothing more. Do not
resurrect the retired claim in order to justify the work.

---

## The actual defect

Dempster's rule of combination normalises the conflict mass K away by dividing through by
`1 - K`. Under near-total conflict that rescaling takes two sources that have destroyed
each other and returns a **narrow** belief-to-plausibility interval, which reads as
confidence.

Work it by hand, on the binary frame `{toxic, safe}` with `uncommitted` as the mass on the
frame itself. Two sources at 0.99 strength pointing opposite ways:

```
a = {toxic: 0.99, safe: 0,    uncommitted: 0.01}
b = {toxic: 0,    safe: 0.99, uncommitted: 0.01}

toxic       = 0.99*0 + 0.99*0.01 + 0.01*0    = 0.0099
safe        = 0*0.99 + 0*0.01    + 0.01*0.99 = 0.0099
uncommitted = 0.01 * 0.01                    = 0.0001
K           = 0.99*0.99                      = 0.9801
```

**Dempster**, dividing by `1 - K = 0.0199`:

```
toxic 0.4975, safe 0.4975, uncommitted 0.0050
belief 0.4975, plausibility 0.5025, interval width 0.0050
```

Two sources in near-total conflict, and the interval is half a percentage point wide.

**Yager**, assigning K to the frame instead of dividing it out:

```
toxic 0.0099, safe 0.0099, uncommitted 0.0001 + 0.9801 = 0.9802
belief 0.0099, plausibility 0.9901, interval width 0.9802
```

The width **is** the disagreement, which is what the interval is for.

Only Dempster exists today. Verify:

```bash
git grep -rniE "yager|pcr5|pcr6|dubois|prade|murphy|smets" -- packages apps services
```

Expected: zero hits.

---

## Constraints that shape the implementation

**Engine purity.** `packages/engine/src` is lint-restricted against `Date`,
`Math.random`, `performance`, `process`, `crypto`, `globalThis`, `node:*`, `fs`, `path`,
dynamic `import` and parent imports. So a policy the engine needs is a **constant in the
engine** plus a registered JSON file that the **harness** reads and compares, which is
exactly the drift-guard pattern `rules/exposure-policy-v1.0.json` already uses.

**Order independence.** Select the rule from the **aggregate** conflict, computed by a
full Dempster pass, not per step. Selecting per step on that step's own K makes the result
depend on the order masses arrive in, and order independence is a property the determinism
claim rests on. Two passes, and say so in the comment.

**Pre-registration.** The threshold is registered before the run it governs.

---

## Two commits, deliberately

### Commit 1: add the rule with an unreachable threshold

The capability lands and **provably moves nothing**: the golden files must be
byte-identical. That is the strongest possible test of "this changed no verdict".

- [ ] Add `combineYager`, the `CombinationRule` and `FusionPolicy` types, and
      `DEFAULT_FUSION_POLICY` with `conflictThreshold: 1.1`. Cumulative conflict is a
      probability and cannot exceed 1, so 1.1 is unreachable by construction.
- [ ] Thread `ruleUsed` onto the `Reasoning` type in `types.ts` and out of `reason()` in
      `index.ts` beside `conflictMass`, or nothing downstream can display it. The
      typecheck will name every construction site.
- [ ] Write the worked arithmetic above as a test, both rules, and assert the interval
      widths differ by more than 0.97.
- [ ] Assert Yager and Dempster agree exactly when conflict is zero.
- [ ] Register `rules/fusion-policy-v1.0.json` with the rationale, the citation
      (Yager, R. R. 1987, *On the Dempster-Shafer framework and new combination rules*,
      Information Sciences 41(2):93-137), and a `consideredAndRejected` note explaining
      why not PCR5 or Dubois-Prade: both are defensible and PCR5 is arguably better
      behaved, but each redistributes conflict across focal elements in a way that needs a
      paragraph, and an unexplainable rule in a five-minute Q and A is worse than a
      slightly blunter one. Yager's transfer-to-ignorance is one sentence and it is the
      conservative direction: it widens uncertainty, never narrows it.
- [ ] Add the harness drift guard asserting the engine constant equals the registered file.
- [ ] **Prove nothing moved:**

```bash
npx vitest run && git diff --exit-code results/golden
```

If any golden moved, the policy is not actually switched off. Stop and fix that.

### Commit 2: turn it on and measure

- [ ] Register `rules/fusion-policy-v1.1.json` with `conflictThreshold: 0.5`, chosen from
      what the quantity **means**: at or above half, the majority of what the sources
      jointly said was contradiction, and an interval derived from the minority that
      survived is not defensible. Register the **expected effect** in the same file before
      running anything: abstention should **rise** on the conflict subset, because widening
      the interval past `abstentionGapThreshold` (0.5) is what abstention means. A fall
      would indicate a bug.
- [ ] Capture the before: `cp results/metrics.json /tmp/metrics-before.json`.
- [ ] Flip the constant, run, and **read which goldens moved before regenerating them**.
      Every moved verdict should be a case whose conflict exceeded 0.5, and every move
      should be toward abstention. If any verdict moved from abstain to committed, stop:
      that contradicts the registered expectation and means the rule is applied backwards.
- [ ] `npm run golden:update`, then write `results/fusion-delta.md` with the real
      before-and-after on every headline metric, the list of compounds that switched rule,
      and a plain yes or no on whether the registered expectation held.

**Likely outcome, stated in advance so it is not a disappointment:** across the corpus,
almost every compound has `conflictMass` exactly 0, and Cyclosporine's 0.1215 is the
largest value in the rendered set. A 0.5 threshold may well be reached by **nothing**. If
so, that is the result: write it down plainly. "The alternative rule is registered,
implemented, tested against worked arithmetic, and inert on this corpus" is an honest and
perfectly respectable finding, and far better than lowering the threshold until something
moves.

---

## Definition of done

- [ ] Commit 1 leaves `results/golden` byte-identical.
- [ ] The worked arithmetic above is a passing test.
- [ ] `results/fusion-delta.md` reports the measured effect, including "no case reached
      the threshold" if that is what happened.
- [ ] The registered expected effect was written before the run.

## Traps specific to this task

- **Do not select the rule per combination step.** Aggregate conflict, two passes, or you
  lose order independence and with it the determinism claim.
- **Report Dempster's conflict either way.** The number a reader sees should mean the same
  thing whichever rule produced the interval beside it.
- **Do not lower the threshold to make something happen.** The threshold comes from the
  meaning of the quantity. An inert result is a result.
- **The engine cannot read the policy file.** Constant in the engine, JSON in `rules/`,
  drift guard in the harness.
