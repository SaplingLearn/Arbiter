# P2-D: Retire every claim the audit invalidated, everywhere it appears

| | |
|---|---|
| **Priority** | P2, but do it last before submission so it catches what the other tasks introduce |
| **Estimated effort** | 2 to 3 hours |
| **Depends on** | P1-A (which fixes the largest class of these). Run this after it. |
| **Touches** | `apps/web/src`, `apps/landing/src`, `README.md`, any deck copy in the repo |
| **Do not touch** | `docs/superpowers/specs/**`, `HANDOVER.md` sections 1 to 13 |

---

## Context you need before starting

This project audited its own headline result, found it invalid, and published the
correction in `HANDOVER.md` section 13. The Evidence-Integrated Playbook lists the claims
that must now disappear from every surface:

> Any phrasing implying superior accuracy, any use of the 0.750 figure, any claim that
> ARBITER beats naive aggregation, and any assertion that the mechanical nonclinical
> and clinical cut guarantees blindness.

The last one has its own measurement behind it. `HANDOVER.md` section 13.4c: the Turalio
**nonclinical** chapter contains the sentence "The liver is a major target organ
clinically". Cutting a review at the chapter boundary moves the pages, not the knowledge.
The document was written by reviewers who already knew the outcome.

**The four claims that survive the audit**, and which every replacement should draw on:

1. **Determinism, measured.** 1000 runs, one hash, verified by test, plus an in-browser
   recomputation of every test-split verdict against a committed manifest.
2. **Calibrated refusal.** 260 of 267 abstain, with a structurally forced subset that
   could not have committed at any evidence values. The system can prove which declines
   were unavoidable.
3. **Mechanism detection is real.** All five Less-concern commitments are genuine BSEP
   inhibitors. The gap is a missing severity axis: specific, nameable and fixable.
4. **Traceable adjudicated decisions.** Rule-cited trace and counterfactual on every
   verdict; hash-chained sign-off; overrides require a stated reason, enforced on both
   client and server.

**Dated documents keep their original wording.** `docs/superpowers/specs/**` and the
existing numbered sections of `HANDOVER.md` are records of what was believed on their
date. Rewriting them destroys the very audit trail that makes the correction credible.
If a spec says something now known to be wrong, that is the point of it. **Do not touch
them.** Only living surfaces get corrected: the two apps, the README, and any deck.

**No em dashes.**

---

## Step by step

- [ ] **Step 1: Find every hit, and write the list down before changing anything**

```bash
echo "--- the retired figure ---"
grep -rn "0\.750\|0\.75\b" apps/web/src apps/landing/src README.md --include=* | grep -v node_modules

echo "--- superiority claims ---"
grep -rniE "beats?|outperform|superior|better than|state.of.the.art|best.in.class" apps/web/src apps/landing/src README.md | grep -v node_modules

echo "--- rule count ---"
grep -rniE "fourteen rules|14 rules|R7|R8|R9|R1[0-4]" apps/web/src apps/landing/src README.md | grep -v node_modules

echo "--- blindness guarantee ---"
grep -rniE "blind|blindness|leakage|holdout|held.out|nonclinical|non-clinical" apps/web/src apps/landing/src README.md | grep -v node_modules

echo "--- banned framings ---"
grep -rniE "regulator.ready|dossier|blockchain|majority|tally|voting|quorum|outvoted" apps/web/src apps/landing/src README.md | grep -v node_modules

echo "--- em dashes ---"
grep -rn "—" apps/web/src apps/landing/src README.md | grep -v node_modules
```

Some of these will be false positives and that is expected. `"majorityVote"` is a literal
baseline-pipeline identifier that appears in `results/metrics.json`, so it is data and not
governance vocabulary. `Result.tsx` contains the heading "It Does Not Beat The Baseline",
which is the honest claim rather than a superiority claim. **Classify every hit as keep or
fix, in writing, before editing.** A sweep that silently deletes a correct sentence is
worse than one that misses a wrong one.

- [ ] **Step 2: Fix the retired figure**

If P1-A has landed, most of these are already handled. What remains is anything the other
prompts introduced. The five known hardcoded sites on the marketing page are
`apps/landing/src/sections/Metrics.tsx:27`, `Result.tsx:19`, `:20`, `:21` and
`RecordSpeaks.tsx:71-72`.

- [ ] **Step 3: Fix the rule count if it appears**

Only six rules are implemented, R1 to R6 in `rules/ruleset-v2.0.json`. Earlier planning
documents describe fourteen. As of this writing the marketing page correctly says six and
carries no fourteen-rule claim; confirm that is still true and fix anything that has
regressed. Ruleset v2.0's own `scopeNote` explains why the additional rules were
deliberately **not** registered: registering rules that no code consumes would put inert
entries into a hashed surface.

- [ ] **Step 4: Fix any blindness guarantee**

As of this writing `apps/landing/src` makes no claim about the nonclinical and clinical
cut at all, which is correct. If one has appeared, the honest replacement is the Q and A
answer from the playbook:

> We assumed a mechanical cut between the nonclinical and clinical sections of a review
> guaranteed blindness, and we measured that false: the Turalio nonclinical chapter
> contains a clinical cross-reference, because it was written by reviewers who already
> knew the outcome. That compound is now a deliberation case and never a prediction case,
> and any future prediction scoring has to grep the nonclinical extract for clinical
> cross-references first. That check does not exist yet.

- [ ] **Step 5: Check the hero mock table on the marketing page**

`apps/landing/src/sections/Hero.tsx:22-25` says verbatim: "These are the run's actual
numbers, not filler." Three of its six rows are not from the scored split:

| row | claim on page | reality |
|---|---|---|
| TAK-994 | belief 0.090, gap 0.910 | fixture case, matches `apps/web/src/data/heroCases.ts` |
| Cyclosporine | 0.886 / 0.098 | correct, `PMATZTZNYRCHOR-CGLBZJNRSA-N` |
| Troglitazone | 0.120 / 0.880 | in the **train** split, absent from `results/results.json` |
| Acetaminophen | 0.210 / 0.790 | in the **calibration** split, absent from results |
| Isoniazid | 0.070 / 0.930, "qsar only", "single claim" | **in the test split**, and its real figures are belief 0.0000, gap 0.8650, with **two** claims. Wrong on three counts. |
| Valproate | 0.160 / 0.840 | no such compound in the corpus |

The table is `aria-hidden="true"` and reads as an illustration, so nothing is announced
to a screen reader. **The defect is the sentence claiming the numbers are real.** Two
honest fixes, pick one: replace the three unsourced rows with real scored compounds and
correct Isoniazid's figures, or keep the illustration and delete the claim that it is
actual data. Do not keep both the claim and the rows.

- [ ] **Step 6: Check two other decorative elements that imply measurements**

- `apps/landing/src/sections/Features.tsx:55-56`: `STREAM_GLYPHS` has ten glyphs with a
  comment calling them "the stream keys". There are **six** streams
  (`packages/engine/src/types.ts:7-13`), and the feature's own copy names four. Either
  cut it to six or drop the comment that presents decoration as a key.
- `apps/landing/src/sections/Features.tsx:43-51`: `FUSION_BARS` carries the comment "R3 is
  the one at full strength; the rest fade by how little they moved the result", with
  widths R1 34%, R2 48%, R3 82%, R4 40%, R5 52%, R6 30%. Those are neither the registered
  strengths (R1 is 0.90, the highest) nor any quantity in `results/`. Remove the comment
  claiming a source, or set the widths to the registered strengths.

- [ ] **Step 7: Add the one thing the page is missing**

No number on the marketing page states its class balance. Searched: `positiveRate`,
`class balance`, `prevalence`, `base rate`, `singleClass`, `confidence interval`. Zero
matches. `HANDOVER.md:1554-1556` calls out that `singleClass: true` and
`balancedAccuracyCi: null` were "exactly the fields nobody read", which is how the 0.750
survived as long as it did.

Add the disclosure beside whichever accuracy figure survives P1-A. One sentence:

```
Conflict subset n = 61, 90.2% positive under the v1.0 target. ARBITER committed on
4 compounds carrying a single label, so half of that balanced accuracy is a
substituted 0.5 rather than an estimate, and there is no honest interval to attach.
```

Adjust the numbers to whichever target the page ends up reporting. **A figure without its
class balance is the exact failure this project corrected. Do not reintroduce it while
cleaning up after it.**

- [ ] **Step 8: Re-run the sweep and verify every remaining hit is classified**

```bash
grep -rn "0\.750" apps/web/src apps/landing/src README.md | grep -v node_modules
```

Every survivor must be labelled with its scoring target or be a deliberate historical
reference.

- [ ] **Step 9: Full verification and commit**

```bash
npm run typecheck && npm run lint && npx vitest run
```

```bash
git add apps/web/src apps/landing/src README.md
git commit -m "Retire the claims the audit invalidated

The 0.750 figure, any implication of superior accuracy, and any assertion that
the mechanical nonclinical and clinical cut guarantees blindness. Section 13.4c
measured that last one false: the Turalio nonclinical chapter contains a clinical
cross-reference, because it was written by reviewers who already knew the outcome.

Also corrected the hero table, which asserted its rows were the run's actual
numbers while three of six were not in the scored split and Isoniazid's real
figures differ on three counts.

Dated documents under docs/superpowers/specs and the numbered HANDOVER sections
are untouched. They are records of what was believed on their date, and
rewriting them would destroy the audit trail that makes the correction credible."
```

---

## Definition of done

- [ ] Every grep in Step 1 returns only hits you have classified in writing as correct.
- [ ] No accuracy figure appears anywhere without its denominator, class balance and
      scoring target.
- [ ] The hero table either contains real numbers or no longer claims to.
- [ ] `docs/superpowers/specs/**` is unmodified: `git diff --stat docs/superpowers/specs`
      is empty.

## Traps specific to this task

- **Do not rewrite history.** The dated specs and the HANDOVER sections are the reason the
  correction is credible. A team that quietly edits its old documents to match its new
  numbers has destroyed the thing that makes this story worth telling.
- **`majorityVote` is a data identifier**, not vote language. It comes from
  `results/metrics.json`. Leave it.
- **"It Does Not Beat The Baseline" is the honest claim**, not a superiority claim. The
  grep will flag it. Keep it.
- **Do this last.** Every other prompt in this folder writes new copy, and this sweep is
  what catches what they introduce.
