# P2-B: Measure how much the room agreed, without letting the number decide anything

| | |
|---|---|
| **Priority** | P2 |
| **Estimated effort** | Half a day |
| **Depends on** | P1-C (it renders inside the panel P1-C creates) |
| **Touches** | `services/api/agreement.ts` (new), `services/api/deliberation.ts`, `services/api/server.ts`, `apps/deliberation/src/api.ts`, `apps/deliberation/src/screens.tsx`, tests |
| **Do not touch** | anything that computes a verdict |

---

## Context you need before starting

The external research that motivates ARBITER is about **measured expert disagreement**:
expert DILI causality assessment among hepatologists reaches weighted kappa 0.60 with 14%
of cases crossing the threshold on re-adjudication (Hayashi et al. 2015, *Liver
International*); only 27% initial complete agreement among three independent reviewers
across 187 cases (Rockey et al. 2010, *Hepatology*); replicate rodent carcinogenicity
classification concords at roughly 57% (Gottmann et al. 2001, *Environmental Health
Perspectives*).

The deliberation app collects exactly the data those figures are computed from, and
**quantifies none of it**. Verify:

```bash
git grep -rniE "kappa|cohen|krippendorff|fleiss|inter.?rater" -- services apps packages docs
```

Expected today: zero matches anywhere in the repository, including documentation. The
only quantities on screen are "n of m answered" and a boolean `unanimous`.

**The rule that makes this permissible at all**, redesign spec section 6.4:

> Counts are never an input to the verdict, and are shown to a later reader as context only.

An agreement figure is a **measurement of the room**, not evidence about the compound.
Nothing you write here may gate signing, weight the adjudication, reorder a position, or
appear in any code path that produces a verdict. If a future change makes an outcome
depend on a number in this file, that change is the defect. Say so in the module comment.

**No em dashes.** No "majority", "minority" or "outvoted" in any copy.

---

## The statistics, and why there are two functions

This is the part most implementations get wrong, so it is specified rather than left to
judgement.

**Fleiss' kappa on a single case is undefined whenever the room is unanimous.** Kappa is
`(observed - expected) / (1 - expected)`, and with one item the expected agreement is
estimated from the marginal distribution of that same item. Four raters all choosing
`advance` gives observed agreement 1 and expected agreement 1, so kappa is `0/0`. That is
not a small-sample wobble; it is genuinely undefined, and returning 1 there would claim
the raters beat chance when there was no chance to beat.

So:

- **Per case: pairwise percent agreement.** Well defined for two or more raters and
  directly interpretable. `P_o = (sum_j n_j^2 - n) / (n(n-1))`.
- **Across cases: Fleiss' kappa.** This is where kappa is defined, and it is the figure
  comparable to the published literature above.

**Unweighted and nominal.** A weighted kappa needs an ordering over
`advance | do_not_advance | cannot_conclude`, and asserting that "cannot conclude" sits
between the other two is a scientific claim smuggled in as a formatting choice. A case
nobody can call is not half a stop. If an ordering is ever wanted it gets registered with
a rationale, like every other policy in this repository.

**The playbook's warning, which the UI must honour:** kappa on three to five reviewers is
statistically thin. Report `n` beside any kappa and do not over-interpret it.

---

## Step by step

- [ ] **Step 1: Write the failing tests, with the arithmetic worked by hand**

Create `services/api/test/agreement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { caseAgreement, fleissKappa } from "../agreement.js";
import type { Call } from "../deliberation.js";

const A: Call = "advance";
const D: Call = "do_not_advance";
const C: Call = "cannot_conclude";

describe("caseAgreement", () => {
  it("is 1 when everyone made the same call", () => {
    const out = caseAgreement([A, A, A, A]);
    expect(out?.pairwiseAgreement).toBe(1);
    expect(out?.dissenters).toBe(0);
  });

  it("counts agreeing PAIRS, not agreeing people", () => {
    // 4 raters, 3 advance and 1 do_not_advance.
    // agreeing pairs = C(3,2) = 3. total pairs = C(4,2) = 6. so 0.5.
    const out = caseAgreement([A, A, A, D]);
    expect(out?.pairwiseAgreement).toBe(0.5);
    expect(out?.raters).toBe(4);
    expect(out?.dissenters).toBe(1);
  });

  it("is 0 when every rater chose differently", () => {
    expect(caseAgreement([A, D, C])?.pairwiseAgreement).toBe(0);
  });

  it("is null below two raters, because agreement needs two", () => {
    expect(caseAgreement([A])).toBeNull();
    expect(caseAgreement([])).toBeNull();
  });
});

describe("fleissKappa", () => {
  it("is 1 on perfect agreement across items using different categories", () => {
    // item 1: 3x advance -> P_1 = (9-3)/(3*2) = 1. item 2: 3x do_not_advance -> 1.
    // pooled p = 0.5 each -> P_e = 0.5. kappa = (1-0.5)/(1-0.5) = 1.
    const out = fleissKappa([[A, A, A], [D, D, D]]);
    expect(out.kappa).toBeCloseTo(1, 10);
    expect(out.observedAgreement).toBeCloseTo(1, 10);
    expect(out.expectedAgreement).toBeCloseTo(0.5, 10);
    expect(out.items).toBe(2);
  });

  it("is -1 when raters split evenly on every item", () => {
    // P_o = 0, P_e = 0.5 -> (0 - 0.5)/0.5 = -1.
    expect(fleissKappa([[A, D], [A, D]]).kappa).toBeCloseTo(-1, 10);
  });

  it("is null, not 1, when every item is unanimous on the SAME category", () => {
    // expected agreement is also 1, so kappa is 0/0. Reporting 1 would claim the
    // raters beat chance when there was no chance to beat.
    const out = fleissKappa([[A, A], [A, A]]);
    expect(out.kappa).toBeNull();
    expect(out.undefinedReason).toContain("one category");
  });

  it("is null with no usable items", () => {
    expect(fleissKappa([]).kappa).toBeNull();
    expect(fleissKappa([[A]]).kappa).toBeNull();
  });

  it("handles a different number of raters per item", () => {
    const out = fleissKappa([[A, A, A], [D, D]]);
    expect(out.items).toBe(2);
    expect(out.totalAssignments).toBe(5);
    expect(out.kappa).toBeCloseTo(1, 10);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run services/api/test/agreement.test.ts
```

Expected: FAIL, `../agreement.js` does not exist.

- [ ] **Step 3: Implement**

Create `services/api/agreement.ts`:

```ts
import type { Call } from "./deliberation.js";

/**
 * How much a room agreed.
 *
 * Spec section 6.4 governs what this may be used for: "Counts are never an input to
 * the verdict, and are shown to a later reader as context only." That clause is what
 * makes an agreement figure admissible at all. It is a MEASUREMENT OF THE ROOM, not
 * evidence about the compound. Nothing here may gate signing, weight an adjudication,
 * or reorder a position. If a later change makes any outcome depend on a number in
 * this file, that change is the defect.
 *
 * Why measure it: expert DILI causality assessment reaches weighted kappa 0.60
 * (Hayashi et al. 2015, Liver International), and 27% initial complete agreement
 * among three reviewers across 187 cases (Rockey et al. 2010, Hepatology). Until now
 * this product could describe a disagreement and could not quantify one, so the single
 * number a reader would want to hold against that literature did not exist.
 */

export interface CaseAgreement {
  raters: number;
  /** Proportion of rater PAIRS that made the same call. 1 is unanimity, 0 is all different. */
  pairwiseAgreement: number;
  dissenters: number;
}

function tally(calls: Call[]): Map<Call, number> {
  const counts = new Map<Call, number>();
  for (const c of calls) counts.set(c, (counts.get(c) ?? 0) + 1);
  return counts;
}

/**
 * Pairwise percent agreement for ONE case.
 *
 * Deliberately NOT kappa. On a single item kappa is 0/0 whenever the room is
 * unanimous, because the marginal distribution it needs for expected agreement is
 * estimated from the very item being scored. A chance-corrected figure from one
 * observation is a statistic with no sampling behind it.
 */
export function caseAgreement(calls: Call[]): CaseAgreement | null {
  const n = calls.length;
  if (n < 2) return null;

  const counts = tally(calls);
  let agreeingPairs = 0;
  let largestCamp = 0;
  for (const k of counts.values()) {
    agreeingPairs += (k * (k - 1)) / 2;
    if (k > largestCamp) largestCamp = k;
  }

  return {
    raters: n,
    pairwiseAgreement: agreeingPairs / ((n * (n - 1)) / 2),
    dissenters: n - largestCamp,
  };
}

export interface KappaReport {
  items: number;
  totalAssignments: number;
  observedAgreement: number;
  expectedAgreement: number;
  /** null when the statistic is undefined. Never substitute 0 or 1 for null. */
  kappa: number | null;
  undefinedReason: string | null;
}

/**
 * Fleiss' kappa across several cases. Chance corrected, nominal, UNWEIGHTED.
 *
 * Unweighted on purpose. A weighted kappa needs an ordering over the categories, and
 * asserting that "cannot_conclude" sits between "advance" and "do_not_advance" would
 * be a scientific claim smuggled in as a formatting choice: a case nobody can call is
 * not half a stop.
 *
 * Varying rater counts per item use the per-item n in the observed term and the
 * pooled assignments in the expected term, which is the standard generalisation.
 */
export function fleissKappa(items: Call[][]): KappaReport {
  const usable = items.filter((it) => it.length >= 2);
  const totalAssignments = usable.reduce((s, it) => s + it.length, 0);

  if (usable.length === 0) {
    return {
      items: 0, totalAssignments: 0, observedAgreement: 0, expectedAgreement: 0,
      kappa: null, undefinedReason: "no case had two or more submitted positions",
    };
  }

  let observedSum = 0;
  for (const it of usable) {
    const n = it.length;
    let sq = 0;
    for (const k of tally(it).values()) sq += k * k;
    observedSum += (sq - n) / (n * (n - 1));
  }
  const observedAgreement = observedSum / usable.length;

  const pooled = tally(usable.flat());
  let expectedAgreement = 0;
  for (const k of pooled.values()) expectedAgreement += (k / totalAssignments) ** 2;

  if (1 - expectedAgreement < Number.EPSILON) {
    return {
      items: usable.length, totalAssignments, observedAgreement, expectedAgreement,
      kappa: null,
      undefinedReason:
        "every position across every case used one category, so expected agreement is 1 and there is no chance agreement to correct for",
    };
  }

  return {
    items: usable.length, totalAssignments, observedAgreement, expectedAgreement,
    kappa: (observedAgreement - expectedAgreement) / (1 - expectedAgreement),
    undefinedReason: null,
  };
}
```

- [ ] **Step 4: Run and watch them pass**

```bash
npx vitest run services/api/test/agreement.test.ts
```

Expected: PASS, all ten.

- [ ] **Step 5: Thread the per-case figure onto the disagreement report**

This requires P1-C to have landed. In `services/api/deliberation.ts`, add to the
`DisagreementReport` interface at `:439`:

```ts
  /** How much the room agreed. Context for a later reader; never an input to the
   *  verdict, per spec section 6.4. Null below two positions. */
  agreement: CaseAgreement | null;
```

and in `disagreementReport()` add to the returned object:

```ts
    agreement: caseAgreement(c.positions.map((p) => p.call)),
```

- [ ] **Step 6: Render it inside the split panel, with the literature beside it**

In `apps/deliberation/src/screens.tsx`, inside the `Where the room split` block P1-C
created:

```tsx
          {disagreement.agreement !== null && (
            <p className="small muted">
              <strong>{Math.round(disagreement.agreement.pairwiseAgreement * 100)}%</strong>{" "}
              pairwise agreement across {disagreement.agreement.raters} positions.
              Context for the record: it does not weigh the positions, it does not affect
              the adjudication, and nobody is bound by it. For scale, expert liver-injury
              causality assessment among hepatologists reaches weighted kappa 0.60, and
              one study found 27% initial complete agreement among three independent
              reviewers across 187 cases.
            </p>
          )}
```

- [ ] **Step 7: Add the cross-case route, scoped to what the caller may read**

In `services/api/server.ts`, beside the other top-level authenticated GET routes, add a
handler returning `fleissKappa` over the cases **this account may read**. Scoping is not
optional: every other read route in that file is access controlled, and a kappa computed
over cases the caller cannot see would leak their shape.

Render it wherever the dashboard summarises the account's cases, and **always print `n`
beside it**:

```tsx
{k.kappa === null
  ? <span>Agreement across cases is not yet defined: {k.undefinedReason}.</span>
  : <span>Fleiss kappa {k.kappa.toFixed(2)} across {k.items} cases. Small n; read it as a direction, not a result.</span>}
```

- [ ] **Step 8: Full suite and commit**

```bash
npm run typecheck && npx vitest run
```

```bash
git add services/api/agreement.ts services/api/test/agreement.test.ts \
        services/api/deliberation.ts services/api/server.ts apps/deliberation/src
git commit -m "Measure how much the room agreed

Pairwise agreement per case, Fleiss kappa across cases, as two functions because
they answer different questions: kappa on a single item is 0/0 whenever the room
is unanimous, since expected agreement is estimated from the one item being
scored. Undefined returns null and never 1.

Unweighted and nominal: a weighted kappa needs an ordering over the three calls,
and claiming cannot_conclude sits between advance and do_not_advance would be a
scientific assertion disguised as a formatting choice.

Context for a later reader only. Spec section 6.4 forbids counts from deciding
anything and nothing here is wired to an outcome."
```

---

## Definition of done

- [ ] All ten unit tests pass, including both null cases.
- [ ] The per-case figure renders inside the split panel with its caveat sentence.
- [ ] Any kappa on screen prints `n` beside it.
- [ ] `git grep -n "kappa" services/api | grep -v test | grep -v agreement.ts` returns
      nothing, proving no verdict path consumes it.

## Traps specific to this task

- **Do not report kappa per case.** It is undefined for the unanimous case, which is a
  large fraction of real cases, and a UI that prints "kappa: null" on most cases is worse
  than one that prints a percent agreement everywhere.
- **Do not use this to rank camps.** P1-C's copy discipline still applies inside the same
  panel: describe the split, never rank it by size.
- **`dissenters` is derived from the largest camp** and is a distance from unanimity, not
  a claim that the largest camp is right. If the copy ever implies otherwise, change the
  copy.
- **Three to five raters is thin.** The playbook says so explicitly. The caveat sentence
  is part of the feature, not decoration.
