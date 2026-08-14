# P1-B: Show the conflict measure the engine has always computed

| | |
|---|---|
| **Priority** | P1 |
| **Estimated effort** | 2 to 3 hours |
| **Depends on** | nothing |
| **Touches** | `apps/web/src/tabs/Case/TracePanel.tsx`, `apps/web/test/` (new test file) |
| **Do not touch** | `packages/engine/src/**` (no engine change is needed) |

---

## Context you need before starting

ARBITER is a TypeScript monorepo. `apps/web` is a Vite + React app, hash-routed, seven
tabs, that runs `@arbiter/engine` **in the browser** over JSON bundled at build time.
There is no API call on this path. The Case tab is
`apps/web/src/tabs/Case/index.tsx`, which renders `CaseHeader` above a three-region
grid holding `EvidencePanel`, `TracePanel` and `TablePanel`.

The engine fuses evidence with Dempster's rule of combination. Dempster's rule
normalises away the conflict mass K by dividing through by `1 - K`. ARBITER deliberately
does **not** throw K away: `packages/engine/src/fuse.ts:60-69` accumulates it as
`conflictMass = 1 - prod(1 - K_i)` and returns it, and
`packages/engine/src/index.ts:197` puts it on the `Reasoning` object. The type comment
at `packages/engine/src/types.ts:187` calls it "Dempster conflict mass. Surfaced, never
normalised away."

**It is surfaced by the engine and rendered by nobody.** Verify:

```bash
grep -rn "conflictMass" apps/web/src | grep -v node_modules
```

Expected today: no output. Only the derived boolean `contested` reaches the screen.

This matters beyond tidiness. The competitive position the project claims against Lhasa
Derek and Kaptis is, in part, "quantifies the conflict rather than averaging it away".
That claim is currently true of the engine and invisible in the product.

**House rules.** No em dashes anywhere. Keep the existing copy discipline: no
"regulator-ready dossier", no "blockchain", no vote language.

---

## What is true today

`apps/web/src/tabs/Case/TracePanel.tsx:23-27` renders the fused mass split three ways
and a `contested` flag:

```tsx
      <p className="small muted case-mass" data-anchor="trace.mass">
        mass toxic <span className="num">{r.mass.toxic.toFixed(3)}</span> ·
        safe <span className="num">{r.mass.safe.toFixed(3)}</span> ·
        uncommitted <span className="num">{r.mass.uncommitted.toFixed(3)}</span>
        {r.contested && " · contested"}
```

`r` is the reasoning object. `r.conflictMass` is available on it right there and is not
read.

**The corpus values matter for testing.** Across the whole scored split, almost every
compound has `conflictMass` exactly 0. Cyclosporine is the only rendered case with a
non-zero value: **0.1215**, alongside belief 0.8862 and plausibility 0.9846.
TAK-994 has conflict 0.000 with a gap of 0.910. Those two cases are your two test
fixtures, and they are also the two cases the demo walks.

That contrast is the whole point of this feature: **a wide interval with near-zero
conflict means the evidence is missing, and a wide interval with high conflict means the
sources contradict each other.** Those are different problems with different next steps,
and a reader currently cannot tell which one they are looking at.

---

## What to build

A conflict line beside the mass line, plus one sentence of plain-language reading that
distinguishes the two cases above.

## Step by step

- [ ] **Step 1: Read the file you are changing, in full**

```bash
cat apps/web/src/tabs/Case/TracePanel.tsx
```

It is short. Note how `r` is obtained and what `collapsed` does, because the panel
renders a 56px rail when another region holds the spotlight and your new markup must not
appear in the rail.

- [ ] **Step 2: Find the render helper the existing tests use**

```bash
ls apps/web/test/ | head -50
grep -rln "TracePanel\|renderCase\|trace" apps/web/test/
```

Reuse whatever setup those files already use. Do not write a second render helper.

- [ ] **Step 3: Write the failing test**

Create `apps/web/test/conflictMeasure.test.tsx`. Adapt the render call to match the
helper you found in Step 2:

```tsx
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";

describe("the conflict measure", () => {
  it("puts the conflict figure on screen for the one case that has one", () => {
    renderCaseTabFor("cyclosporine");
    expect(screen.getByTestId("conflict-measure").textContent).toContain("0.12");
  });

  it("reads a near-zero conflict as missing evidence, not as agreement", () => {
    renderCaseTabFor("tak994");
    const reading = screen.getByTestId("conflict-reading").textContent ?? "";
    expect(reading).toMatch(/missing/i);
    expect(reading).not.toMatch(/contradict/i);
  });

  it("reads a non-zero conflict as sources disagreeing", () => {
    renderCaseTabFor("cyclosporine");
    expect(screen.getByTestId("conflict-reading").textContent).toMatch(/contradict/i);
  });
});
```

The second and third assertions are the ones that matter. A test that only checks a
number is on screen would pass against a component that prints the same sentence for
every case, which is exactly the failure mode here.

- [ ] **Step 4: Run it and watch it fail**

```bash
npx vitest run apps/web/test/conflictMeasure.test.tsx
```

Expected: FAIL, no element with `data-testid="conflict-measure"`.

- [ ] **Step 5: Add the reading function**

At the top of `apps/web/src/tabs/Case/TracePanel.tsx`, above the component:

```tsx
/**
 * The plain-language half of the conflict measure.
 *
 * The number alone invites the wrong reading in both directions, and the two
 * readings have different next steps. A wide belief-to-plausibility interval with
 * near-zero conflict means nobody measured the question, and the answer is the
 * planner's next experiment. The same width with high conflict means the sources
 * contradict each other, and the answer is deciding which source to believe.
 *
 * Threshold at 0.05 rather than at exactly 0: floating-point fusion over many
 * claims can leave a value like 1e-17 on a case where nothing actually opposed
 * anything, and printing "the sources contradict each other" for 1e-17 would be
 * false.
 */
const CONFLICT_FLOOR = 0.05;

function conflictReading(conflictMass: number): string {
  if (conflictMass < CONFLICT_FLOOR) {
    return "The sources barely contradict each other, so a wide interval here is missing evidence rather than disputed evidence. The experiment below is what would narrow it.";
  }
  return "The sources contradict each other, and this is how much of their combined mass was contradiction. Dempster's rule divides that out to renormalise; the figure is reported here rather than absorbed, because an interval derived from only the surviving fraction reads as more confidence than the evidence supports.";
}
```

- [ ] **Step 6: Render it**

Immediately after the closing `</p>` of the mass line at `TracePanel.tsx:27-28`:

```tsx
      <p className="small muted case-conflict" data-testid="conflict-measure" data-anchor="trace.conflict">
        conflict <span className="num">{r.conflictMass.toFixed(3)}</span>
      </p>
      <p className="small muted case-conflict-reading" data-testid="conflict-reading">
        {conflictReading(r.conflictMass)}
      </p>
```

Keep both inside whatever guard already hides detail in the collapsed rail state.

- [ ] **Step 7: Run and watch them pass**

```bash
npx vitest run apps/web/test/conflictMeasure.test.tsx
```

Expected: PASS, all three.

- [ ] **Step 8: Look at it in the running app, on both cases**

```bash
npm run dev
```

That is the unified dev server: everything is one origin on port 5173, with the product
app under `/app/`. Open `http://localhost:5173/app/#/case`.

Check **Cyclosporine** first: conflict should read `0.122` with the contradiction
sentence. Then check **TAK-994**: conflict `0.000` with the missing-evidence sentence.
The zero case is the one that will look broken if the copy is wrong, so read it as a
judge would.

- [ ] **Step 9: Full suite and commit**

```bash
npm run typecheck && npx vitest run
```

```bash
git add apps/web/src/tabs/Case/TracePanel.tsx apps/web/test/conflictMeasure.test.tsx
git commit -m "Show the conflict measure, and say which of two things it means

The engine has computed conflictMass since the beginning and put it on the
reasoning object, and no component read it. Only the derived contested boolean
reached the screen.

The number needs its reading beside it: a wide interval with near-zero conflict
is missing evidence and resolves with an experiment, while the same width with
high conflict is a dispute and resolves by deciding which source to believe.
Cyclosporine at 0.122 is the only rendered case that exercises the second branch."
```

---

## Definition of done

- [ ] `grep -rn "conflictMass" apps/web/src` returns at least one hit in `TracePanel.tsx`.
- [ ] Cyclosporine shows `0.122` with the contradiction reading.
- [ ] TAK-994 shows `0.000` with the missing-evidence reading and does not look broken.
- [ ] `npm run typecheck && npx vitest run` passes.

## Traps specific to this task

- **Almost every compound has conflict exactly 0.** If you test against a randomly
  chosen compound you will only ever exercise one branch. Use Cyclosporine.
- **Do not gate the line on a non-zero value.** Hiding the row when conflict is 0 loses
  the most useful reading in the corpus, which is "these sources did not disagree, so the
  uncertainty you are looking at is absence of evidence".
- **Do not add this to the engine.** `conflictMass` is already computed and already on
  the type. This is a rendering task only, and `packages/engine/src` is lint-restricted
  against the imports a UI change would tempt you toward.
- **The collapsed rail.** The Case grid collapses two of three regions to 56px when the
  third is focused. Verify your markup does not overflow the rail.
