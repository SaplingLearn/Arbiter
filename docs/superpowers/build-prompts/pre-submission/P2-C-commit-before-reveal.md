# P2-C: Ask the reader for their call before showing them the verdict

| | |
|---|---|
| **Priority** | P2 |
| **Estimated effort** | Half a day |
| **Depends on** | nothing. Better after P1-B, which gives the gate something worth revealing. |
| **Touches** | `apps/web/src/state/store.tsx`, `apps/web/src/tabs/Case/index.tsx`, `apps/web/src/tabs/Case/CaseHeader.tsx`, `apps/web/test/` (new test) |
| **Do not touch** | `apps/deliberation` (it already has the strongest form of this) |

---

## Context you need before starting

Multiple studies show that adding explanations can **increase** uncritical acceptance,
because a plausible-sounding rationale invites agreement rather than scrutiny, and
human-plus-AI teams frequently underperform the AI alone. Cognitive forcing functions,
interventions that compel analytical engagement, measurably reduced over-reliance on
incorrect AI recommendations relative to explanation-only designs, at a cost in user
effort (Buçinca, Malaya and Gajos 2021, *Proc. ACM Hum.-Comput. Interact.* 5, CSCW1,
Article 188).

`apps/deliberation` already embodies this in its strongest available form: an assessor
must commit a reasoned call, citing findings, before seeing anyone else's. **`apps/web`
does not.** The verdict renders unconditionally the moment the Case tab mounts.

Verify:

```bash
git grep -rniE "provisional|before you see|commit to|your call" -- apps/web/src
```

Expected today: no substantive hits.

**The structure you are changing.** `apps/web/src/tabs/Case/index.tsx` is 35 lines.
`CaseTab` takes no props and reads the store. It renders `<CaseHeader />` above a
three-region `case-grid` holding `EvidencePanel`, `TracePanel` and `TablePanel`, with a
spotlight that collapses two regions to 56px rails through a `[data-focus]` CSS
transition. The verdict lives in **two** places: `CaseHeader` (the verdict label, belief,
plausibility and gap) and `TracePanel` (the belief track, mass line, verdict reason and
counterfactual).

So the gate covers `CaseHeader` and the trace region, and **leaves the evidence readable**,
because the reader cannot form a call without it. Put the prompt **into the trace region**
so the grid never changes shape and the CSS transition is untouched.

**House rules.** No em dashes. No vote language.

---

## The design constraint that keeps this from becoming friction

The Evidence-Integrated Playbook says: "Consider triggering it only on high-gap or
contested cases so it does not become friction on every view."

Implement that, do not just mention it. A gate on every compound in a browsing session
is a tax the reader learns to click through without reading, which destroys the effect
the research measures. Gate where the judgement is genuinely contestable:

```ts
/**
 * Where the forcing function earns its cost.
 *
 * Buccinca et al. measured that the intervention works AND that it costs user
 * effort, so spending it on a case with an obvious answer buys nothing and teaches
 * the reader to click through it. A wide belief-to-plausibility interval or an
 * actively contested set is where a considered human call differs from a glance.
 *
 * 0.25 is a judgement, not a measurement, and it is named here rather than inlined
 * so that changing it is a visible decision.
 */
const GATE_GAP_THRESHOLD = 0.25;

function shouldGate(r: Reasoning): boolean {
  return r.contested || r.plausibility - r.belief >= GATE_GAP_THRESHOLD;
}
```

---

## Step by step

- [ ] **Step 1: Read the three files**

```bash
cat apps/web/src/tabs/Case/index.tsx
sed -n '1,60p' apps/web/src/tabs/Case/CaseHeader.tsx
grep -n "selectedCompoundId\|interface AppState\|type Action" apps/web/src/state/store.tsx | head -20
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/test/commitBeforeReveal.test.tsx`, reusing the render helper the other
Case tests use:

```tsx
import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";

describe("commit before reveal", () => {
  it("hides the verdict on a contested case until the reader has made a call", () => {
    renderCaseTabFor("cyclosporine"); // contested, conflict 0.122
    expect(screen.queryByTestId("verdict-header")).toBeNull();
    expect(screen.getByTestId("provisional-prompt")).toBeTruthy();
  });

  it("keeps the evidence readable before the call, because the call needs it", () => {
    renderCaseTabFor("cyclosporine");
    expect(screen.getByTestId("evidence-panel")).toBeTruthy();
  });

  it("reveals the verdict once a call is recorded, and shows it back", () => {
    renderCaseTabFor("cyclosporine");
    fireEvent.click(screen.getByTestId("provisional-advance"));
    expect(screen.getByTestId("verdict-header")).toBeTruthy();
    expect(screen.getByTestId("your-call").textContent).toMatch(/advance/i);
  });

  it("does not gate a case whose answer is not contestable", () => {
    renderCaseTabForReasoning({ contested: false, belief: 0.02, plausibility: 0.05 });
    expect(screen.getByTestId("verdict-header")).toBeTruthy();
    expect(screen.queryByTestId("provisional-prompt")).toBeNull();
  });
});
```

The fourth test is the one that keeps this from becoming friction. Write it.

- [ ] **Step 3: Run and watch it fail**

```bash
npx vitest run apps/web/test/commitBeforeReveal.test.tsx
```

- [ ] **Step 4: Hold the call in the store**

In `apps/web/src/state/store.tsx`, add to the state shape:

```ts
  /** The reader's own call, recorded BEFORE the engine's verdict is shown.
   *
   *  Buccinca et al. 2021 (CSCW): explanations alone increase over-reliance, and a
   *  forcing function that compels an analytical commitment reduces it. Keyed per
   *  compound, because the point is a fresh judgement on each case rather than a
   *  mode the reader switches off once.
   *
   *  NOT persisted. This is a reading discipline, not a record. The record of a real
   *  position is signed, hash chained, and lives in the deliberation client. Storing
   *  this would create a second, unsigned thing that looks like a position. */
  provisionalCall: Record<string, "advance" | "do_not_advance" | "cannot_conclude">;
```

with a `setProvisionalCall` action alongside the existing actions, following the exact
reducer shape already in that file.

- [ ] **Step 5: Gate the two verdict regions**

Rewrite `apps/web/src/tabs/Case/index.tsx`:

```tsx
export function CaseTab() {
  const { tour, selectedCompoundId, provisionalCall } = useAppState();
  const dispatch = useDispatch();
  const reasoning = useCaseReasoning();
  const focus = tour.focus;
  const toggle = (r: Region) => dispatch({ type: "setFocus", focus: focus === r ? null : r });
  const collapsed = (r: Region) => focus !== null && focus !== r;
  const regionClass = (r: Region) => `case-region${collapsed(r) ? " is-rail" : ""}`;

  const gated = shouldGate(reasoning) && provisionalCall[selectedCompoundId] === undefined;
  const commit = (call: "advance" | "do_not_advance" | "cannot_conclude") =>
    dispatch({ type: "setProvisionalCall", compoundId: selectedCompoundId, call });

  return (
    <section>
      {gated ? null : <CaseHeader />}
      <div className="case-grid" data-focus={focus ?? ""}>
        <div className={regionClass("evidence")}>
          <EvidencePanel collapsed={collapsed("evidence")} onExpand={() => toggle("evidence")} />
        </div>
        <div className={regionClass("trace")}>
          {gated ? (
            <section className="provisional" data-testid="provisional-prompt">
              <h2>Your call first</h2>
              <p>
                The streams on this compound conflict, so this is a case where a
                considered call and a glance differ. Read the evidence, record what you
                would decide, and ARBITER's verdict and its reasoning appear. Committing
                first is what keeps this a second opinion rather than an anchor.
              </p>
              <button data-testid="provisional-advance" onClick={() => commit("advance")}>Advance</button>
              <button data-testid="provisional-do-not-advance" onClick={() => commit("do_not_advance")}>Do not advance</button>
              <button data-testid="provisional-cannot-conclude" onClick={() => commit("cannot_conclude")}>Cannot conclude</button>
            </section>
          ) : (
            <TracePanel collapsed={collapsed("trace")} onExpand={() => toggle("trace")} />
          )}
        </div>
        <div className={regionClass("table")}>
          <TablePanel collapsed={collapsed("table")} onExpand={() => toggle("table")} />
        </div>
      </div>
    </section>
  );
}
```

Use whatever hook the app already uses to obtain the reasoning object; `useCaseReasoning`
is the memoised one in `apps/web/src/engine/useCaseReasoning.ts`. Read it before wiring.

- [ ] **Step 6: Show the reader their own call back**

In `apps/web/src/tabs/Case/CaseHeader.tsx`, put `data-testid="verdict-header"` on the
element that already wraps the verdict label, and beside it:

```tsx
{mine !== undefined && (
  <p className="your-call" data-testid="your-call">
    You said <strong>{CALL_LABEL[mine]}</strong>.
  </p>
)}
```

That comparison is the entire payoff of having asked. Without it the gate is only a
speed bump.

Also add `data-testid="evidence-panel"` to `EvidencePanel`'s root if it lacks one.

- [ ] **Step 7: Run the unit tests, then the e2e suite**

```bash
npx vitest run apps/web/test/commitBeforeReveal.test.tsx
npm run e2e
```

**The e2e run is not optional.** `apps/web/e2e/demo.spec.ts` walks the demo path against
the preview server, and a gate that blocks it must be discovered now rather than on
stage. If it fails, decide deliberately: either the demo path uses a non-gated compound,
or the spec clicks through the gate as a reader would. Both are legitimate; silently
widening the gate predicate to make a test pass is not.

- [ ] **Step 8: Walk it yourself**

```bash
npm run dev
```

Open `http://localhost:5173/app/#/case`. Cyclosporine should gate. Move to a
non-contested compound with a narrow gap and confirm it does not. Then click through and
confirm your call appears beside the verdict.

- [ ] **Step 9: Full suite and commit**

```bash
npm run typecheck && npx vitest run
```

```bash
git add apps/web/src/state/store.tsx apps/web/src/tabs/Case/index.tsx \
        apps/web/src/tabs/Case/CaseHeader.tsx apps/web/src/tabs/Case/EvidencePanel.tsx \
        apps/web/test/commitBeforeReveal.test.tsx
git commit -m "Ask the reader for their call before showing the verdict

Buccinca et al. 2021 measured that explanations alone increase over-reliance and
that a forcing function reduces it, at a cost in effort. So the gate is spent
only where it buys something: a contested case or a wide belief-to-plausibility
interval, which is where a considered call and a glance differ.

The evidence panel stays visible throughout. The gate is on the answer, not on
the reading. The reader's own call is shown beside the verdict afterwards,
because that comparison is the point of having asked.

Not persisted: this is a reading discipline, and the signed hash-chained record
of a real position lives in the deliberation client."
```

---

## Definition of done

- [ ] A contested case gates; an uncontested one does not.
- [ ] Evidence is readable before the call.
- [ ] The reader's call appears beside the verdict after committing.
- [ ] `npm run e2e` passes, or the demo spec was updated deliberately with a reason.

## Traps specific to this task

- **Do not gate every case.** The fourth test exists to stop that. A universal gate is
  clicked through without reading, which is worse than no gate because it looks like
  diligence.
- **Do not persist the call.** A stored, unsigned judgement that looks like a position
  undermines the one place in this product where a position means something specific.
- **Do not break the grid.** The `[data-focus]` transition collapses regions to rails.
  Replacing the trace region's contents keeps the layout identical; adding a fourth region
  does not.
- **The e2e suite runs against a built preview**, not the dev server. A gate that works in
  `npm run dev` can still break `npm run e2e`.
