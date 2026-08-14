# W-1: Finish the website by making it true, then by making it complete

| | |
|---|---|
| **Priority** | The truth pass is P2 and pre-submission. The completion work is post-submission. |
| **Estimated effort** | Truth pass 3 to 4 hours. Completion 1 to 2 days. |
| **Depends on** | P1-A and P2-D cover part of the truth pass. Run those first and this picks up what they leave. |
| **Touches** | `apps/landing/src/sections/**`, `apps/landing/src/links.ts`, `apps/landing/test/landing.test.tsx` |

---

## Context you need before starting

`apps/landing` is a Vite + React marketing site, roughly 2,435 lines of CSS and eleven
numbered sections, and it is **also the unified dev entry**: `npm run dev` runs
`tools/dev-all.mjs`, which serves the landing site at `/` on port 5173 and proxies
`/app/` to `apps/web`, `/deliberation/` to `apps/deliberation` and `/api` to
`services/api`. Everything is one origin. Do not reintroduce separate ports.

The section order is `OpeningScene`, `Header`, `Hero`, `Standards`, then eleven numbered
sections from `Metrics` `[01 of 11]` through `GetStarted` `[11 of 11]`, then `Footer`.
Anchor ids in use: `#method` on `Capabilities`, `#product` on `CaseView`, `#ruleset` on
`HowItWorks`, `#result` on `Result`, `#record` on `GetStarted`.

**The site is in good shape on the things that usually go wrong.** An audit searched
`apps/landing/src` for superiority claims (`beats`, `outperform`, `superior`,
`state-of-the-art`), for a fourteen-rule claim, for any blindness guarantee, for
counts-decide vocabulary, and for em dashes. **All came back clean.** The six rules and
their strengths are quoted byte-identically from the registered ruleset. Do not undo any
of that.

---

## Part 1: the truth pass, before submission

Four defects, in descending severity.

### 1. The retired 0.750 appears in five places

| file | line | text |
|---|---|---|
| `apps/landing/src/sections/Metrics.tsx` | `:27` | `to: 0.75, decimals: 3` renders `0.750`, labelled "Balanced Accuracy" |
| `apps/landing/src/sections/Result.tsx` | `:19` | `{ pipeline: "ARBITER", accuracy: "0.750", coverage: "6.6%", committed: "4", ours: true }` |
| `apps/landing/src/sections/Result.tsx` | `:20` | `single:transporter`, `accuracy: "0.750"` |
| `apps/landing/src/sections/Result.tsx` | `:21` | `majorityVote`, `accuracy: "0.750"` |
| `apps/landing/src/sections/RecordSpeaks.tsx` | `:71-72` | `who: "Balanced acc. 0.750"`, `what: "Conflict subset n=61"` |

All are **hardcoded strings**; this page does not read `metrics.json` at runtime. They are
faithful to the file as it stands and wrong against `HANDOVER.md` section 13.1, which
declares the v1.0 target invalid.

P1-A decides whether the project re-grades or version-labels. **Follow whichever choice
P1-A made** and apply it here identically. The v2.0 conflict-subset replacements are
ARBITER 0.500 (tp1/fp3/tn0/fn0), single:transporter 0.500, majorityVote 0.250,
weightedAverage 0.519, from `results/rescore-v2.txt`.

Note `apps/landing/test/landing.test.tsx:168-188` reads `results/metrics.json` off disk and
asserts these page figures match it. It is your safety net and it will fail if the page and
the file disagree, which is correct behaviour. Update it to assert against whichever source
of truth the project settles on, with a comment saying why it moved.

### 2. The hero table claims to be real and three of six rows are not

`apps/landing/src/sections/Hero.tsx:22-25` says verbatim: "These are the run's actual
numbers, not filler."

| row | page | reality |
|---|---|---|
| TAK-994 | 0.090 / 0.910 | fixture case, supported |
| Cyclosporine | 0.886 / 0.098 | supported |
| Troglitazone | 0.120 / 0.880 | in the **train** split, absent from `results/results.json` |
| Acetaminophen | 0.210 / 0.790 | in the **calibration** split, absent from results |
| Isoniazid | 0.070 / 0.930, "qsar only", "single claim" | **in the test split**, real values belief 0.0000, gap 0.8650, and it carries **two** claims. Wrong on three counts. |
| Valproate | 0.160 / 0.840 | no such compound in the corpus |

The table is `aria-hidden="true"` so nothing is announced to a screen reader. The defect is
the sentence. Either replace the three unsourced rows with real scored compounds and
correct Isoniazid, or keep the illustration and delete the claim. Not both.

### 3. Two decorative elements assert measurements that do not exist

- `Features.tsx:55-56`: `STREAM_GLYPHS` has ten glyphs, commented "the stream keys". There
  are **six** streams (`packages/engine/src/types.ts:7-13`) and the section's own copy
  names four.
- `Features.tsx:43-51`: `FUSION_BARS`, commented "R3 is the one at full strength; the rest
  fade by how little they moved the result", with widths R1 34%, R2 48%, R3 82%, R4 40%,
  R5 52%, R6 30%. Those are neither the registered strengths (R1 is 0.90, the highest) nor
  any quantity in `results/`.

Fix the comment or fix the data. A comment claiming a source is what turns decoration into
a false claim.

### 4. No number on the page states its class balance

Searched `positiveRate`, `class balance`, `prevalence`, `base rate`, `singleClass`,
`confidence interval`: zero matches. The conflict subset is 90.2% positive under v1.0,
`singleClass` is true and `balancedAccuracyCi` is null. `HANDOVER.md:1554-1556` records that
those were "exactly the fields nobody read", which is how 0.750 survived.

Add the disclosure beside whichever accuracy figure survives. A figure without its class
balance is the precise failure this project corrected, and reintroducing it while cleaning
up after it would be the worst available irony.

---

## Part 2: completing the site, after submission

The site currently argues that ARBITER works. The Evidence-Integrated Playbook's narrative
is stronger and the site does not tell it: **the team audited its own headline, found it
invalid, published the correction, and re-graded to a worse number.** A safety tool whose
authors applied it to themselves is the most credible thing in the whole submission, and it
is nowhere on the marketing page.

- [ ] **Add a section: the correction as the credibility asset**

Between `Result` `[06 of 11]` and `UseCases`, a section that states plainly: the first
headline was 0.750; it was checked and it was wrong, because the positive class had
swallowed 62% of its members from the Less-concern grade, so a system correctly declining
to flag amlodipine was scored as mistaken; re-graded honestly it is 0.500; and under that
target nothing tested clears 0.601, including every baseline. Close with the reframe: the
finding is not that one system underperforms, it is that this task is unsolved from public
evidence, which is why a system that abstains 260 times out of 267 is behaving correctly.

- [ ] **Add the competitive position from playbook section 07**

A comparison table against Lhasa Derek Nexus and Kaptis across core method, uncertainty,
sensitivity analysis, multi-party assessment and governance. **Include the honest row:**
predictive accuracy, Lhasa "established commercial validation", ARBITER "not competitive,
we do not contest this axis". A comparison table that loses one row on purpose is read as
credible; one that wins every row is read as marketing.

- [ ] **Point the reader into both applications**

`links.ts` already carries `APP_URL` defaulting to `/app/`. Under the unified server the
deliberation client lives at `/deliberation/` and is the surface the external research
calls the strongest differentiator, and the marketing page barely mentions it. Give the
multi-party workflow its own section and a link.

- [ ] **Check every anchor still resolves**

```bash
grep -rn 'href="#' apps/landing/src | sed 's/.*href="#\([a-z-]*\)".*/\1/' | sort -u
grep -rn 'id="' apps/landing/src | sed 's/.*id="\([a-z-]*\)".*/\1/' | sort -u
```

Every nav target must exist. Two targets in the original design source did not resolve and
were fixed once; regressions here are invisible because a dead anchor fails silently.

---

## Definition of done

- [ ] `grep -rn "0\.750" apps/landing/src` returns only figures carrying their scoring target.
- [ ] The hero table either holds real numbers or no longer claims to.
- [ ] Every accuracy figure on the page states its denominator and class balance.
- [ ] No comment claims a data source the repository cannot produce.
- [ ] `npx vitest run apps/landing` passes.
- [ ] Every `href="#..."` resolves to a real id.

## Traps specific to this task

- **This page does not read `metrics.json`.** Regenerating the file changes nothing here.
- **Do not undo what is already right.** The audit found zero superiority claims, zero
  fourteen-rule claims, zero blindness claims, zero em dashes and a byte-accurate rule
  quotation. Preserve all of it.
- **`majorityVote` is a data identifier**, not vote vocabulary. Leave it.
- **"It Does Not Beat The Baseline" is the honest heading**, and under the corrected target
  it becomes more accurate rather than less. Keep it.
