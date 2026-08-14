# P2-A: Make the applicability-domain downweight visible on the evidence it downweights

| | |
|---|---|
| **Priority** | P2 |
| **Estimated effort** | 2 to 3 hours |
| **Depends on** | nothing |
| **Touches** | `apps/web/src/tabs/Case/EvidencePanel.tsx`, `apps/web/test/` (new test) |
| **Do not touch** | `packages/engine/src/**`, `rules/*.json` |

---

## Context you need before starting

`apps/web` is a Vite + React app that runs `@arbiter/engine` in the browser. The Case tab
shows evidence as rows in `apps/web/src/tabs/Case/EvidencePanel.tsx`, each carrying the
stream, system, strength, provenance and the trace rationale.

Rule **R4, Applicability domain**, registered in `rules/ruleset-v2.0.json` with strength
`0.5`, states: "Evidence from a model operating outside its applicability domain is
admitted with reduced weight, or excluded." Its framework citation is the OECD principles
for the validation of QSAR models, where applicability domain is a required element.

The engine implements it as a **mass discount**: a claim with
`inApplicabilityDomain === false` has its committed mass multiplied by `1 - 0.5` and the
remainder moved to the uncommitted frame.

**The flag is invisible in the product.** `inApplicabilityDomain` appears in `apps/web`
only as an input control on the Intake form and in one line of About prose. There is no
per-claim badge. Verify:

```bash
git grep -n "inApplicabilityDomain" -- apps/web/src
```

You will see the Intake form input and nothing in `EvidencePanel.tsx`.

So today an R4 downweight is visible only if the trace step's prose rationale happens to
mention it. A reader looking at the evidence list cannot tell that a QSAR prediction was
made about a compound unlike anything in its training set.

**This is a real case in the demo corpus.** Cyclosporine's trace contains a `qsar` claim
marked `downweighted` with the rationale "Prediction falls outside the model's
applicability domain". That is your test fixture.

**House rules.** No em dashes. Keep copy plain.

---

## What to build

A badge on any evidence row whose claim is outside the model's applicability domain,
visually distinct from the existing modification chip, with one sentence explaining what
it means and naming the standard it comes from.

## Step by step

- [ ] **Step 1: Read the panel and find the existing chip**

```bash
cat apps/web/src/tabs/Case/EvidencePanel.tsx
```

There is already a chip reading `MODIFIED - not the registered claim`, shown when a claim
carries a user evidence overlay. **Your badge must not look like that one.** They mean
opposite things: the modification chip is a warning that the reader changed the input, and
the domain badge is a property of the registered evidence itself. Note the chip's class
names so you can pick a different treatment.

- [ ] **Step 2: Confirm the field reaches the component**

The claim objects rendered by this panel come from the loaded evidence. Confirm
`inApplicabilityDomain` is present on them:

```bash
git grep -n "inApplicabilityDomain" -- packages/engine/src/types.ts packages/engine/src/schema.ts
python3 -c "
import json
e=json.load(open('data/out/evidence.json'))
rows = e if isinstance(e, list) else e.get('claims', [])
out = [r for r in rows if r.get('inApplicabilityDomain') is False]
print('claims out of domain:', len(out))
print(out[0] if out else 'none')
"
```

If the field is `null` on most claims, note that: **null means not applicable to this
claim type**, not "in domain". A non-QSAR claim has no applicability domain and must get
no badge at all.

- [ ] **Step 3: Write the failing test**

Create `apps/web/test/applicabilityBadge.test.tsx`, reusing the render helper the
neighbouring Case tests already use:

```tsx
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

describe("applicability domain badge", () => {
  it("marks a claim the model had no business predicting", () => {
    renderCaseTabFor("cyclosporine");
    const badges = screen.getAllByTestId("out-of-domain");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges[0].textContent).toMatch(/outside/i);
  });

  it("does not mark claims that have no applicability domain at all", () => {
    // A null flag means the concept does not apply to this claim type. Badging it
    // would tell the reader a measured assay was an out-of-domain prediction.
    renderCaseTabFor("tak994");
    expect(screen.queryAllByTestId("out-of-domain").length).toBe(0);
  });
});
```

Adjust the second fixture if TAK-994 turns out to carry an out-of-domain claim; pick any
case whose claims are all in domain or null, using the Step 2 query to choose.

- [ ] **Step 4: Run and watch it fail**

```bash
npx vitest run apps/web/test/applicabilityBadge.test.tsx
```

- [ ] **Step 5: Render the badge**

In the row renderer in `apps/web/src/tabs/Case/EvidencePanel.tsx`, beside the stream and
system labels:

```tsx
{claim.inApplicabilityDomain === false && (
  <span className="chip chip-domain" data-testid="out-of-domain" title="OECD QSAR validation principles: applicability domain is a required element of a valid prediction.">
    outside applicability domain
  </span>
)}
```

**The strict `=== false` comparison is load bearing.** `null` means the concept does not
apply to this claim, and a truthiness check would badge every measured assay in the
corpus.

Add one line of explanation under the evidence list, not per row, so it is said once:

```tsx
<p className="small muted">
  A claim marked outside applicability domain is a prediction about a compound unlike
  the model's training set. Rule R4 admits it at reduced weight rather than excluding
  it, following the OECD principles for QSAR validation, where the applicability domain
  is a required element of a valid prediction.
</p>
```

- [ ] **Step 6: Style it so it does not read as an error or as the modification chip**

In the panel's stylesheet (`apps/web/src/tabs/Case/case.css`), give `.chip-domain` a
treatment distinct from the modification chip. This is a property of the registered
evidence, not a warning about tampering, so it should read as a neutral qualifier.

- [ ] **Step 7: Run and watch them pass, then look at it**

```bash
npx vitest run apps/web/test/applicabilityBadge.test.tsx
npm run dev
```

Open `http://localhost:5173/app/#/case` and select **Cyclosporine**. The QSAR row should
carry the badge, and the trace panel's R4 rationale should now agree with something the
reader can see in the evidence list.

- [ ] **Step 8: Full suite and commit**

```bash
npm run typecheck && npx vitest run
```

```bash
git add apps/web/src/tabs/Case/EvidencePanel.tsx apps/web/src/tabs/Case/case.css \
        apps/web/test/applicabilityBadge.test.tsx
git commit -m "Badge evidence a model had no business predicting

R4 discounts a claim whose model was operating outside its applicability domain,
and that discount was visible only when the trace rationale happened to mention
it. The reader could not see it on the evidence itself.

Strict === false rather than a truthiness check: null means the concept does not
apply to that claim type, and badging null would label every measured assay as an
out-of-domain prediction."
```

---

## Definition of done

- [ ] Cyclosporine's QSAR row carries the badge in the running app.
- [ ] No measured-assay row carries it.
- [ ] The badge is visually distinct from the `MODIFIED` chip.
- [ ] `npm run typecheck && npx vitest run` passes.

## Traps specific to this task

- **`null` is not `false`.** This is the whole trap. Use `=== false`.
- **Do not exclude the claim.** R4 as registered admits at reduced weight. The badge
  reports the engine's behaviour; it must not change it, and no engine file is touched
  here.
- **Do not describe it as an error.** An out-of-domain prediction is legitimate evidence
  weighed appropriately. The copy should read as a qualifier, not a defect.
