# ARBITER multiple hero cases - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry three demonstrated compounds instead of one, so the demo shows the engine abstaining, committing, and (when the data exists) advancing - without touching the pre-registered ruleset or moving a reported number.

**Architecture:** The singular `LoadedData.fixture` becomes `LoadedData.heroCases: Map<string, HeroCase>`. A hero case is either *fixture-backed* (carries its own hand-authored claims, like TAK-994) or *corpus-backed* (carries `claims: null` and resolves through `data.claimsByCompound`, like Cyclosporine). Corpus-backed cases add no evidence to the repo, so the benchmark cannot move. The tour gains an optional per-beat `compoundId`, and the audit record gains a hashed `compoundId`.

**Tech Stack:** TypeScript, React 18, Vite, Vitest + Testing Library, Playwright, zod. Python 3 (`data/prep`) is **not touched by this plan** - hero case 2 is corpus-backed and authors no new evidence.

**Spec:** `docs/superpowers/specs/2026-08-05-arbiter-multi-case-design.md`. Read §2 and §3 before Task 3; they are why Cyclosporine and not something better-known.

## Global Constraints

- **Never edit `rules/ruleset-v1.0.json`.** Its hash `ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136` is pre-registered and the harness refuses to run if it differs. (HANDOVER §1.1)
- **The engine stays pure.** No `Date`, `Math.random`, `node:*`, `fs`/`path`/`crypto`, dynamic `import`, or parent imports anywhere in `packages/engine/src`. Lint enforces every one. (HANDOVER §1.2)
- **Language discipline**, in code, comments, UI copy and commit messages: write *review-ready evidence package* never "regulator-ready dossier"; *positions / sign-off / decision owner* never "voting / tally / majority"; *hash-chained audit log* never "blockchain". (HANDOVER §1.3)
- **`npm run golden:update` must produce no diff** and `results/verdict-manifest.json` must stay byte-identical, at every commit in this plan.
- **Watch every new test fail before trusting it.** Three patterns that are always wrong: `expect(x).toContain(anyOf(all possible values))`, asserting a value that is `0` under any implementation, and a range check hiding under a guarantee-shaped name. (HANDOVER §5.1)
- **Commit and push after every task.** Not batched. (HANDOVER §5.5)
- Verification command for every task: `npm run lint && npm run typecheck && npm test`.

## File Structure

| file | responsibility | task |
|---|---|---|
| `apps/web/src/data/heroCases.ts` | **new** - the hero-case type and the registry that builds the map | 1, 3 |
| `apps/web/src/data/load.ts` | validate bundled artifacts; build `heroCases`; enforce the exposure gate | 1, 4 |
| `apps/web/src/state/store.tsx` | `registeredClaims` map lookup; `initialState`; `ReviewerPosition.compoundId` | 1, 5 |
| `apps/web/src/tabs/Case/CaseHeader.tsx` | per-case name, subtitle, split disclosure, as-of milestones | 1, 2, 3 |
| `apps/web/src/tabs/Case/EvidencePanel.tsx` | per-case citation status | 1 |
| `apps/web/src/tabs/Case/TablePanel.tsx` | `loadedKeyEvents` over all fixture-backed cases | 1 |
| `apps/web/src/ui/Preflight.tsx` | the evidence check line | 1 |
| `apps/web/src/tabs/Record.tsx` | sign with a compound; render the compound column | 5 |
| `apps/web/src/tour/beats.ts` | `buildBeats(data)`; per-beat `compoundId`; the contrast beat | 6 |
| `apps/web/src/tour/TourFooter.tsx` | dispatch `selectCompound` when a beat names one | 6 |
| `apps/harness/src/load.ts` | expose `fixtureIds` | 7 |
| `apps/harness/src/validate-evidence.ts` | leak check by membership, not string prefix | 7 |

---

### Task 1: The hero-case model

Replaces the singular `fixture` with a map. **Behaviour must not change** - TAK-994 stays the only hero case and the only boot compound. This task is a rename with one new fall-through; if any rendered number moves, something is wrong.

**Files:**
- Create: `apps/web/src/data/heroCases.ts`
- Modify: `apps/web/src/data/load.ts:11-16,18-27,75-99`
- Modify: `apps/web/src/state/store.tsx:119,153-157`
- Modify: `apps/web/src/tabs/Case/CaseHeader.tsx:19-30`
- Modify: `apps/web/src/tabs/Case/EvidencePanel.tsx:14,40-44`
- Modify: `apps/web/src/tabs/Case/TablePanel.tsx:137-145`
- Modify: `apps/web/src/ui/Preflight.tsx:291-294`
- Test: `apps/web/test/heroCases.test.ts` (new)

**Interfaces:**
- Consumes: `LoadedData` from `apps/web/src/data/load.ts`; `EvidenceClaim` from `@arbiter/engine`.
- Produces: `HeroCase`, `CaseSource`, `FixtureExposure`, `buildHeroCases(raw, corpusIds)` from `apps/web/src/data/heroCases.ts`; `LoadedData.heroCases: Map<string, HeroCase>` replacing `LoadedData.fixture`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/heroCases.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadData } from "../src/data/load.js";
import { initialState, workingClaims } from "../src/state/store.js";

describe("hero cases", () => {
  const data = loadData();

  it("registers TAK-994 as a fixture-backed hero case", () => {
    const hero = data.heroCases.get("TAK-994");
    expect(hero).toBeDefined();
    expect(hero!.source).toBe("fixture");
    expect(hero!.displayName).toBe("TAK-994");
    expect(hero!.claims).not.toBeNull();
    expect(hero!.claims!.length).toBe(6);
    expect(hero!.citationStatus).toBe("UNVERIFIED");
  });

  it("boots on a hero case, not on an arbitrary compound", () => {
    expect(data.heroCases.has(initialState(data).selectedCompoundId)).toBe(true);
  });

  // The fall-through is the whole point of the map: a compound that is not a hero
  // case must still resolve, and must resolve to the CORPUS rather than to nothing.
  it("falls through to the corpus for a non-hero compound", () => {
    const id = data.testSplit[0]!;
    expect(data.heroCases.has(id)).toBe(false);
    expect(workingClaims(initialState(data), id)).toEqual(data.claimsByCompound.get(id));
  });

  it("prefers a fixture-backed case's own claims over the corpus copy", () => {
    const state = initialState(data);
    expect(workingClaims(state, "TAK-994")).toBe(data.heroCases.get("TAK-994")!.claims);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/web/test/heroCases.test.ts`
Expected: FAIL - `data.heroCases` is undefined.

- [ ] **Step 3: Create the hero-case module**

Create `apps/web/src/data/heroCases.ts`:

```ts
import type { EvidenceClaim } from "@arbiter/engine";

/**
 * Where a hero case's evidence comes from, and it is load-bearing rather than
 * descriptive.
 *
 * A `fixture` case carries its own hand-authored literature claims and therefore
 * its own citation risk - TAK-994's are marked UNVERIFIED and rendered as such.
 * A `corpus` case carries NOTHING: `claims` is null and the case resolves through
 * `data.claimsByCompound` like any library row.
 *
 * That asymmetry is deliberate. `store.tsx`'s precedence comment warns that the
 * fixture and corpus copies of one compound may some day stop agreeing, and that
 * the Case tab must not switch source silently when they do. Giving a corpus-backed
 * case no claims of its own means it has nothing to disagree WITH: the Case tab and
 * the Compounds table read one array. It is also why a corpus-backed case adds no
 * evidence to the repo and so cannot move a benchmark number.
 */
export type CaseSource = "fixture" | "corpus";

/** A cited clinical exposure. See load.ts's gate and spec §5 - this type exists so
 *  that `exposureRelevant: true` cannot be asserted without one. */
export interface FixtureExposure {
  cmax: number;
  basis: "free" | "total";
  citation: string;
}

export interface HeroCase {
  compoundId: string;
  /** Rendered in the masthead. Replaces the literal "TAK-994" that CaseHeader
   *  previously substituted whenever the selected compound was the fixture. */
  displayName: string;
  source: CaseSource;
  subtitle: string;
  /** Fixture-backed only. `null` means "resolve through the corpus". */
  claims: EvidenceClaim[] | null;
  /** May be empty. Corpus streams carry availableFrom 2000-01-01 / 2010-01-01, so
   *  the as-of replay is inert on them and they get no milestone buttons. */
  asOfMilestones: Record<string, string>;
  /** Fixture-backed only; null suppresses the citation caveat entirely. */
  citationStatus: string | null;
  /** Set when the compound is not in the test split, so an in-sample QSAR read is
   *  disclosed rather than implied. Null for a test-split compound. */
  splitDisclosure: string | null;
  exposure: FixtureExposure | null;
}
```

- [ ] **Step 4: Build the map in `load.ts`**

In `apps/web/src/data/load.ts`, delete the `FixtureDoc` interface (lines 11-16) and replace the `fixture` field on `LoadedData` (line 25). The imports at the top gain the new module:

```ts
import type { HeroCase } from "./heroCases.js";
```

`LoadedData` becomes:

```ts
export interface LoadedData {
  claimsByCompound: Map<string, EvidenceClaim[]>;
  compounds: Map<string, CompoundRow>;
  testSplit: string[];
  ruleset: Ruleset;
  assays: AssayOperator[];
  metrics: MetricsDocument;
  /** Every demonstrated compound, keyed by compound id. Replaces the singular
   *  `fixture`. TAK-994 is one entry, not a privileged field. */
  heroCases: Map<string, HeroCase>;
  manifest: Map<string, { verdict: Verdict; belief: number }>;
}
```

Replace the fixture block (lines 75-82) and the `fixture:` entry in the return (lines 91-96) with:

```ts
  const fixtureClaims: EvidenceClaim[] = [];
  for (const raw of RAW.fixture.claims as unknown[]) {
    const parsed = EvidenceClaimSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DataLoadError(`data/out/tak994.json: ${parsed.error.issues[0]?.message}`);
    }
    fixtureClaims.push(parsed.data as EvidenceClaim);
  }

  const heroCases = new Map<string, HeroCase>();
  heroCases.set(RAW.fixture.compoundId, {
    compoundId: RAW.fixture.compoundId,
    displayName: RAW.fixture.name,
    source: "fixture",
    subtitle: "Literature fixture · outside the DILIrank benchmark",
    claims: fixtureClaims,
    asOfMilestones: RAW.fixture.asOfMilestones,
    citationStatus: RAW.fixture.citationStatus,
    splitDisclosure: null,
    exposure: null,
  });
```

and in the returned object replace `fixture: {...}` with `heroCases,`.

- [ ] **Step 5: Point the store at the map**

In `apps/web/src/state/store.tsx`, line 119 becomes:

```ts
    selectedCompoundId: BOOT_CASE,
```

with `import { BOOT_CASE } from "../data/heroCases.js";`, and in `heroCases.ts`:

```ts
/**
 * The compound the app opens on. Named rather than taken as the first key of
 * `heroCases`, because Map iteration order is insertion order and that would make
 * the boot case an accident of the order two `set` calls happen to appear in.
 */
export const BOOT_CASE = "TAK-994";
```

and `registeredClaims` (lines 153-157) becomes:

```ts
/**
 * The registered claims for a compound. THE ONE COPY.
 *
 * This lookup was duplicated at `useCaseReasoning.ts:13`, `CaseHeader.tsx:15`,
 * `EvidencePanel.tsx:9` and `Record.tsx:16`. Wired into three of the four, an
 * evidence working copy produces a verdict computed from evidence the panel
 * beside it is not showing - which is why §9 requires the refactor BEFORE the
 * working copy, not alongside it.
 *
 * Deliberately module-private: `workingClaims` is the only exported way to reach
 * a compound's claims, so a fifth call site cannot quietly appear reading the
 * registered map by hand. `useLibraryVerdicts` reads `data.claimsByCompound`
 * directly and that is the correct behaviour, not an oversight - see §9.1 on the
 * polarity below.
 *
 * A FIXTURE-backed hero case wins over the bundled corpus deliberately: TAK-994
 * appears in BOTH `data/out/evidence.json` and `data/out/tak994.json`, and the
 * fixture is the hand-curated literature case the demo runs on. The two copies
 * agree today; the precedence is kept so that they may stop agreeing without the
 * Case tab silently switching source.
 *
 * A CORPUS-backed hero case has `claims: null` and falls straight through to the
 * corpus, so it has no second copy to disagree with. One `??` chain covers both:
 * null claims are indistinguishable from an absent case, which is exactly right.
 */
function registeredClaims(data: LoadedData, compoundId: string): EvidenceClaim[] {
  return data.heroCases.get(compoundId)?.claims
    ?? data.claimsByCompound.get(compoundId)
    ?? [];
}
```

- [ ] **Step 6: Update the four readers**

`apps/web/src/tabs/Case/CaseHeader.tsx`, lines 19-30 become:

```ts
  const hero = data.heroCases.get(selectedCompoundId);
  const all = workingClaims(state, selectedCompoundId);
  const shown = visibleClaims(all, asOf);
  const hidden = all.length - shown.length;
  const compound = data.compounds.get(selectedCompoundId);
  const name = hero?.displayName ?? compound?.name ?? selectedCompoundId;
  const compoundClass = hero?.subtitle
    ?? compound?.dilirankLabel
    ?? "DILIrank class not recorded";
  const milestones = Object.entries(hero?.asOfMilestones ?? {});
```

Delete the now-unused `isFixture` binding.

`apps/web/src/tabs/Case/EvidencePanel.tsx`, line 14 becomes:

```ts
  const citationStatus = data.heroCases.get(selectedCompoundId)?.citationStatus ?? null;
```

and lines 40-44 become:

```tsx
      {citationStatus !== null && (
        <p data-testid="citation-status" data-anchor="evidence.citationStatus" className="caveat case-caveat">
          Literature fixture · citations {citationStatus}
        </p>
      )}
```

`apps/web/src/tabs/Case/TablePanel.tsx`, line 143 (`add(data.fixture.claims);`) becomes:

```ts
  for (const hero of data.heroCases.values()) if (hero.claims !== null) add(hero.claims);
```

and the comment above it (lines 134-135) becomes:

```
 * Fixture-backed hero cases are folded in beside the corpus because `workingClaims`
 * prefers their own claims, so they are part of the loaded evidence in exactly the
 * sense that matters. Corpus-backed cases have `claims: null` and are already
 * covered by the loop above.
```

`apps/web/src/ui/Preflight.tsx`, lines 291-294 become:

```tsx
        <Check id="check-evidence" tone="info">
          Evidence: {data.claimsByCompound.size} compounds with claims, {data.testSplit.length} scored;
          {" "}{[...data.heroCases.values()].filter((h) => h.source === "fixture").length} literature
          {" "}fixture(s), citations{" "}
          {[...new Set([...data.heroCases.values()]
            .map((h) => h.citationStatus)
            .filter((s): s is string => s !== null))].join(", ") || "none"}
        </Check>
```

- [ ] **Step 7: Fix the existing tests that name the old field**

Every `data.fixture.claims` becomes `data.heroCases.get("TAK-994")!.claims!` and every `data.fixture.citationStatus` becomes `data.heroCases.get("TAK-994")!.citationStatus`. Affected files, from `grep -rn "data\.fixture" apps/web`:
`evidencePanel.test.tsx`, `evidenceDigest.test.ts`, `interpretCache.test.ts`, `rung1.test.ts`, `interpret.test.ts`, `preflight.test.tsx`, `anchors.test.tsx`, `beats.test.tsx`, `chain.test.ts`, `store.test.ts`, `load.test.ts`, `tablePanel.test.tsx`.

`apps/web/test/load.test.ts:23-27` asserts `d.fixture.claims.length > 0`; make it `d.heroCases.get("TAK-994")!.claims!.length` and **leave the `d.compounds.has("TAK-994") === false` assertion exactly as it is** - that is the benchmark-exclusion guard and it is still what it was.

- [ ] **Step 8: Run the full suite**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS, and the count is the previous 513 plus the 4 new tests in `heroCases.test.ts`.

- [ ] **Step 9: Prove no reported number moved**

Run: `npm run golden:update && git diff --exit-code results/`
Expected: exit 0, no output. If this diffs, stop - a rename has changed a computation.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src apps/web/test
git commit -m "Make the demonstrated compound a map entry, not a privileged field"
git push
```

---

### Task 2: Per-case as-of milestones

Closes a live defect: `CaseHeader.tsx:30` reads the fixture's milestones unconditionally, so selecting any of the 267 library compounds today offers `preFirstInHuman (2021-06-01)` and `postMurineStudy (2023-01-01)` - TAK-994's dates, on a different drug.

Task 1 already made `milestones` read from the hero case. **This task is the test that proves it**, and it is separated because a behaviour fix deserves its own failing-test-first cycle rather than riding along inside a rename.

**Files:**
- Test: `apps/web/test/caseHeader.test.tsx`

**Interfaces:**
- Consumes: `HeroCase.asOfMilestones` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/caseHeader.test.tsx`:

```tsx
it("offers no as-of milestones on a compound that is not a hero case", async () => {
  const data = loadData();
  const corpusId = data.testSplit.find((id) => !data.heroCases.has(id))!;
  render(
    <StoreProvider data={data}>
      <CaseHeader />
    </StoreProvider>,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /All evidence/ }));
  });
  // The defect this pins: TAK-994's milestone dates rendered on every compound.
  expect(screen.queryByRole("button", { name: /preFirstInHuman/ })).not.toBeNull();

  cleanup();
  const state = { ...initialState(data), selectedCompoundId: corpusId };
  render(
    <StoreProvider data={data} initialState={state}>
      <CaseHeader />
    </StoreProvider>,
  );
  expect(screen.queryByRole("button", { name: /preFirstInHuman/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /postMurineStudy/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /All evidence/ })).not.toBeNull();
});
```

`StoreProvider` currently accepts only `data` and `initialEvidenceEdits`. Add an `initialState` prop alongside them, defaulting to `initialState(data, initialEvidenceEdits)`, in `apps/web/src/state/store.tsx`:

```tsx
export function StoreProvider(
  { data, initialEvidenceEdits, initialState: seed, children }:
    { data: LoadedData; initialEvidenceEdits?: Record<string, EvidenceEdit>;
      initialState?: AppState; children: ReactNode },
) {
  const [state, dispatch] = useReducer(
    reducer, data, (d) => seed ?? initialState(d, initialEvidenceEdits),
  );
  ...
}
```

- [ ] **Step 2: Run it and watch the second half fail**

Run: `npx vitest run apps/web/test/caseHeader.test.tsx`
Expected: FAIL on the `toBeNull()` assertions if Task 1's `CaseHeader` edit was not applied. If it passes immediately, **revert `CaseHeader.tsx:30` to `Object.entries(data.heroCases.get("TAK-994")!.asOfMilestones)` and confirm it then fails** - otherwise the test is not testing anything.

- [ ] **Step 3: Confirm the fix is Task 1's edit**

No new implementation. The `hero?.asOfMilestones ?? {}` from Task 1 Step 6 is what makes this pass.

- [ ] **Step 4: Run the suite**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/state/store.tsx apps/web/test/caseHeader.test.tsx
git commit -m "Stop rendering one compound's milestones on every other compound"
git push
```

---

### Task 3: Hero case 2 - Cyclosporine

**Read spec §3 and §4 first.** Two properties were measured false while choosing this compound; the reasoning that survives is not the reasoning that was written down first.

Measured on 5 August 2026 - these are the assertion values:

| | value |
|---|---|
| compoundId | `PMATZTZNYRCHOR-CGLBZJNRSA-N` |
| verdict | `do_not_advance` |
| belief | 0.886 |
| plausibility | 0.985 |
| conflict mass | 0.122 |
| `contested` | `true` |

**Files:**
- Modify: `apps/web/src/data/load.ts` (add the second `heroCases.set`)
- Modify: `apps/web/src/tabs/Case/CaseHeader.tsx` (render `splitDisclosure`)
- Test: `apps/web/test/heroCases.test.ts`

**Interfaces:**
- Consumes: `HeroCase` from Task 1.
- Produces: the compound id constant `CYCLOSPORINE` exported from `apps/web/src/data/heroCases.ts`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/heroCases.test.ts`:

```ts
import { reason } from "@arbiter/engine";
import { CYCLOSPORINE } from "../src/data/heroCases.js";

describe("hero case 2 - Cyclosporine", () => {
  const data = loadData();

  it("is corpus-backed and carries no claims of its own", () => {
    const hero = data.heroCases.get(CYCLOSPORINE)!;
    expect(hero.source).toBe("corpus");
    expect(hero.claims).toBeNull();
    expect(hero.citationStatus).toBeNull();
    expect(hero.asOfMilestones).toEqual({});
  });

  // THE test of this task. The Case tab and the Compounds table are different code
  // paths - useCaseReasoning vs useLibraryVerdicts - and the guarantee is that a
  // corpus-backed hero case cannot make them disagree. Comparing one selector to
  // itself would prove nothing, so both are computed independently here.
  it("shows the same verdict on the Case tab as in the library table", () => {
    const viaCase = reason(
      workingClaims(initialState(data), CYCLOSPORINE),
      data.ruleset, "", data.assays,
    );
    const viaLibrary = reason(
      data.claimsByCompound.get(CYCLOSPORINE)!,
      data.ruleset, "", data.assays,
    );
    expect(viaCase.verdict).toBe(viaLibrary.verdict);
    expect(viaCase.belief).toBe(viaLibrary.belief);
  });

  it("commits, is contested, and carries non-zero conflict mass", () => {
    const r = reason(
      workingClaims(initialState(data), CYCLOSPORINE),
      data.ruleset, "", data.assays,
    );
    expect(r.verdict).toBe("do_not_advance");
    expect(r.belief.toFixed(3)).toBe("0.886");
    expect(r.plausibility.toFixed(3)).toBe("0.985");
    expect(r.contested).toBe(true);
    // Every other rendered case has conflictMass exactly 0.000, TAK-994 included.
    // This is the only one where the number on screen means anything.
    expect(r.conflictMass).toBeGreaterThan(0.1);
    expect(r.conflictMass.toFixed(3)).toBe("0.122");
  });

  it("is in the test split, so it needs no in-sample disclosure", () => {
    expect(data.testSplit).toContain(CYCLOSPORINE);
    expect(data.heroCases.get(CYCLOSPORINE)!.splitDisclosure).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/web/test/heroCases.test.ts`
Expected: FAIL - `CYCLOSPORINE` is not exported.

- [ ] **Step 3: Declare the compound**

Append to `apps/web/src/data/heroCases.ts`:

```ts
/**
 * Hero case 2. Corpus-backed, so this constant is the ONLY new data in the repo.
 *
 * Chosen over better-known DILI compounds for reasons recorded in spec §3-4, two of
 * which were measured false on the first pass and corrected. What survives: it
 * COMMITS where TAK-994 abstains (belief 0.886 against 0.090), its gap is 0.098
 * against TAK-994's 0.910 - the contrast an audience reads without being told what
 * it means - it is `contested` with conflict mass 0.122, and it is the only rendered
 * case where Dempster-Shafer conflict is non-zero. It is also in the test split, so
 * nothing needs disclosing.
 *
 * It does NOT show a defeat. The earlier claim that it did was inferred from stream
 * polarity; the trace shows one R4 downweight. TAK-994, by contrast, shows four R3
 * defeats once the murine study is visible. Neither fact is why this compound was
 * picked - see spec §4.
 */
export const CYCLOSPORINE = "PMATZTZNYRCHOR-CGLBZJNRSA-N";
```

- [ ] **Step 4: Register it**

In `apps/web/src/data/load.ts`, after the TAK-994 `heroCases.set(...)` from Task 1:

```ts
  // Corpus-backed: no claims, so nothing is added to the evidence base and no
  // reported number can move. `subtitle` comes from the compound row rather than
  // being written here, so it cannot drift from DILIrank.
  const cyclosporine = compounds.get(CYCLOSPORINE);
  if (cyclosporine === undefined) {
    throw new DataLoadError(`hero case ${CYCLOSPORINE} is absent from data/out/compounds.json`);
  }
  heroCases.set(CYCLOSPORINE, {
    compoundId: CYCLOSPORINE,
    displayName: cyclosporine.name,
    source: "corpus",
    subtitle: `${cyclosporine.dilirankLabel} · scored in the benchmark test split`,
    claims: null,
    asOfMilestones: {},
    citationStatus: null,
    splitDisclosure: null,
    exposure: null,
  });
```

with `import { CYCLOSPORINE, type HeroCase } from "./heroCases.js";` at the top.

The `throw` is not defensive noise: a silent miss here would render an empty Case tab, and HANDOVER §6.4 records that *a silent empty result looks exactly like a working pipeline*.

- [ ] **Step 5: Render the split disclosure**

In `apps/web/src/tabs/Case/CaseHeader.tsx`, after the `<p className="muted case-subtitle">` line:

```tsx
          {hero?.splitDisclosure !== null && hero?.splitDisclosure !== undefined && (
            <p data-testid="split-disclosure" className="caveat">{hero.splitDisclosure}</p>
          )}
```

Cyclosporine sets this to `null`, so nothing renders today. It exists because spec §4 records Troglitazone as the alternate and its only blocker is an in-sample QSAR disclosure - adding it later becomes data, not code. Step 6 tests the mechanism so it is not untested scaffolding.

- [ ] **Step 6: Test the disclosure renders when set**

Append to `apps/web/test/caseHeader.test.tsx`:

```tsx
it("renders a split disclosure when the hero case carries one", () => {
  const data = loadData();
  const hero = data.heroCases.get(CYCLOSPORINE)!;
  const patched = new Map(data.heroCases);
  patched.set(CYCLOSPORINE, { ...hero, splitDisclosure: "QSAR read is in-sample (train split)." });
  const state = {
    ...initialState({ ...data, heroCases: patched }),
    selectedCompoundId: CYCLOSPORINE,
  };
  render(
    <StoreProvider data={{ ...data, heroCases: patched }} initialState={state}>
      <CaseHeader />
    </StoreProvider>,
  );
  expect(screen.getByTestId("split-disclosure").textContent).toMatch(/in-sample/);
});
```

- [ ] **Step 7: Run the suite and prove nothing moved**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS.

Run: `npm run golden:update && git diff --exit-code results/`
Expected: exit 0. A corpus-backed case adds no claims, so this **must** be clean; a diff means the hero case leaked into the evidence base.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src apps/web/test
git commit -m "Add Cyclosporine as the case where the engine commits"
git push
```

---

### Task 4: The exposure gate

HANDOVER §3.1 forbids setting `exposureRelevant: true` without a real clinical Cmax, and reaching an `advance` verdict requires exactly that. This task makes the prohibition a **build failure** rather than a discipline, so hero case 3 cannot be faked under deadline pressure and drops in cleanly the day the data exists.

**Files:**
- Modify: `apps/web/src/data/load.ts`
- Test: `apps/web/test/exposureGate.test.ts` (new)

**Interfaces:**
- Consumes: `FixtureExposure`, `HeroCase` from Task 1.
- Produces: `assertExposureBacked(hero)` exported from `apps/web/src/data/load.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/exposureGate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertExposureBacked, DataLoadError, loadData } from "../src/data/load.js";
import type { HeroCase } from "../src/data/heroCases.js";
import type { EvidenceClaim } from "@arbiter/engine";

const claim = (over: Partial<EvidenceClaim>): EvidenceClaim => ({
  id: "X:cytotox", compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.9,
  system: "human", measuresKeyEvent: "KE:HEPATOCYTE-DEATH", exposureRelevant: false,
  inApplicabilityDomain: true, klimisch: 1, availableFrom: "2020-01-01",
  provenance: { kind: "literature", source: "test", retrieved: "2026-08-05" },
  ...over,
} as EvidenceClaim);

const hero = (over: Partial<HeroCase>): HeroCase => ({
  compoundId: "X", displayName: "X", source: "fixture", subtitle: "",
  claims: [], asOfMilestones: {}, citationStatus: "UNVERIFIED",
  splitDisclosure: null, exposure: null, ...over,
});

describe("the exposure gate", () => {
  it("refuses a safe claim asserting exposure relevance with no cited Cmax", () => {
    const h = hero({ claims: [claim({ exposureRelevant: true })] });
    expect(() => assertExposureBacked(h)).toThrow(DataLoadError);
    // The failure must name the claim, not just complain.
    expect(() => assertExposureBacked(h)).toThrow(/X:cytotox/);
  });

  it("accepts it once a cited Cmax is present", () => {
    const h = hero({
      claims: [claim({ exposureRelevant: true })],
      exposure: { cmax: 120, basis: "free", citation: "a real source" },
    });
    expect(() => assertExposureBacked(h)).not.toThrow();
  });

  // The gate is written against SAFE claims specifically. TAK-994's murine claim is
  // the corpus's only exposureRelevant: true and it is TOXIC - a positive finding at
  // a clinically relevant dose needs no exposure margin to be defensible, which is
  // what R3 says. Widening the gate to every assertion would break the one fixture
  // that already exists.
  it("leaves a toxic exposure-relevant claim alone", () => {
    const h = hero({ claims: [claim({ assertion: "toxic", exposureRelevant: true })] });
    expect(() => assertExposureBacked(h)).not.toThrow();
  });

  it("ignores corpus-backed cases, which author nothing", () => {
    expect(() => assertExposureBacked(hero({ source: "corpus", claims: null }))).not.toThrow();
  });

  it("loads the shipped data with TAK-994's murine claim intact", () => {
    const data = loadData();
    const murine = data.heroCases.get("TAK-994")!.claims!
      .find((c) => c.id === "TAK-994:toxicogenomics-murine")!;
    expect(murine.exposureRelevant).toBe(true);
    expect(murine.assertion).toBe("toxic");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/web/test/exposureGate.test.ts`
Expected: FAIL - `assertExposureBacked` is not exported.

- [ ] **Step 3: Implement the gate**

Add to `apps/web/src/data/load.ts`:

```ts
/**
 * A literature fixture may not claim exposure relevance for a SAFE finding without
 * a cited clinical Cmax.
 *
 * This is HANDOVER §3.1's prohibition, made unrepresentable. Reaching an `advance`
 * verdict requires `exposureRelevant: true` on safe evidence, and the cheapest way
 * to get one is to type `true` - which is precisely the shortcut §3.1 considered and
 * rejected, and precisely the shortcut that is most tempting at 11pm before a
 * submission. A rule that lives in a document is a rule someone has to remember; a
 * rule that fails the build is not.
 *
 * SAFE claims only, deliberately. R3 says a positive finding at clinically relevant
 * exposure defeats a negative one whose margin is unstated - the asymmetry is the
 * rule's whole content. A toxic finding needs no margin to be defensible, and
 * TAK-994's murine claim is exactly that case.
 *
 * Corpus-backed cases are exempt because they author nothing: their claims come from
 * the ingestion pipeline, which sets exposureRelevant from Tox21 metadata.
 */
export function assertExposureBacked(hero: HeroCase): void {
  if (hero.source !== "fixture" || hero.claims === null || hero.exposure !== null) return;
  for (const c of hero.claims) {
    if (c.assertion === "safe" && c.exposureRelevant === true) {
      throw new DataLoadError(
        `${hero.compoundId}: claim ${c.id} asserts exposureRelevant on a safe finding, ` +
        `but the fixture carries no cited clinical Cmax. See HANDOVER §3.1 - this flag ` +
        `may not be set without one.`,
      );
    }
  }
}
```

and call it from `loadData()` immediately before the return:

```ts
  for (const hero of heroCases.values()) assertExposureBacked(hero);
```

- [ ] **Step 4: Run and verify it passes**

Run: `npx vitest run apps/web/test/exposureGate.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the gate can actually fire on real data**

Temporarily edit `data/out/tak994.json` to change `TAK-994:cytotox`'s `exposureRelevant` from `null` to `true`, then run `npx vitest run apps/web/test/heroCases.test.ts`.
Expected: every test in that file FAILS with the message naming `TAK-994:cytotox`.
Then `git checkout -- data/out/tak994.json` and confirm the suite is green again.

This step is the point of the task. A gate nobody has watched fire is a comment.

- [ ] **Step 6: Run the suite and commit**

Run: `npm run lint && npm run typecheck && npm test`

```bash
git add apps/web/src/data/load.ts apps/web/test/exposureGate.test.ts
git commit -m "Make the forbidden exposure shortcut fail the build"
git push
```

---

### Task 5: The audit record gains a compound

`ReviewerPosition` carries no `compoundId`, so signing on two compounds produces one interleaved chain in which no link says what it was about. Adding it to the render alone would reproduce HANDOVER §6.4's `prevRecordHash` defect exactly - a field a reader trusts that tampering does not disturb - so it goes into the hash.

`canonicalRecord` uses `Object.entries`, so a new field is covered automatically. **That is a property to test, not to assume.**

**Files:**
- Modify: `apps/web/src/state/store.tsx:12-29`
- Modify: `apps/web/src/tabs/Record.tsx:42-59,99-115`
- Test: `apps/web/test/chain.test.ts`

**Interfaces:**
- Consumes: `ReviewerPosition` from `apps/web/src/state/store.ts`.
- Produces: `ReviewerPosition.compoundId: string`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/chain.test.ts`:

```ts
it("covers compoundId in the record hash", async () => {
  const base: ReviewerPosition = {
    reviewerId: "jack.he", displayName: "Jack He", role: "Safety reviewer",
    position: "agree", rationale: null, signedAt: "2026-08-05T10:00:00.000Z",
    rulesetHash: "a".repeat(64), evidenceSnapshotHash: "b".repeat(64),
    asOfDate: null, signatureMethod: "demo-persona", prevRecordHash: "0".repeat(64),
    compoundId: "TAK-994",
  };
  const tampered = { ...base, compoundId: CYCLOSPORINE };
  // If compoundId were outside the canonical form, these would be equal and a
  // reviewer's subject could be rewritten without breaking the chain.
  expect(await recordHash(tampered)).not.toBe(await recordHash(base));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/web/test/chain.test.ts`
Expected: FAIL - `compoundId` is not a property of `ReviewerPosition` (typecheck error).

- [ ] **Step 3: Add the field**

In `apps/web/src/state/store.tsx`, inside `ReviewerPosition`, after `role`:

```ts
  /**
   * WHAT was signed on. Absent until 2026-08-05, when a second hero case made one
   * flat chain ambiguous: two positions signed on different compounds were
   * distinguishable only by their evidence snapshot, which is a digest rather than
   * a statement.
   *
   * It is inside `canonicalRecord` - which enumerates with Object.entries, so this
   * is covered by construction - and not merely rendered. Rendering alone would
   * repeat HANDOVER §6.4's defect: a field a reader trusts that tampering does not
   * disturb.
   */
  compoundId: string;
```

- [ ] **Step 4: Sign with it**

In `apps/web/src/tabs/Record.tsx`, inside the dispatched position object, after `role: "Safety reviewer",`:

```ts
        compoundId: selectedCompoundId,
```

- [ ] **Step 5: Render it**

In `apps/web/src/tabs/Record.tsx`, the position row's second `<div>` becomes:

```tsx
            <div className="small muted">
              {p.compoundId} · snapshot <span className="mono">{p.evidenceSnapshotHash.slice(0, 12)}</span>… ·
              prev <span className="mono">{p.prevRecordHash.slice(0, 12)}</span>… ·
              as of {p.asOfDate ?? "all evidence"} · {p.signatureMethod}
            </div>
```

- [ ] **Step 6: Run and verify**

Run: `npx vitest run apps/web/test/chain.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify by ablation**

Temporarily change `canonicalRecord` in `apps/web/src/record/chain.ts` to drop the field:

```ts
  const entries = Object.entries(r as unknown as Record<string, unknown>)
    .filter(([k]) => k !== "compoundId")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
```

Run: `npx vitest run apps/web/test/chain.test.ts`
Expected: FAIL on the new test. Revert the filter.

- [ ] **Step 8: Run the suite and commit**

Run: `npm run lint && npm run typecheck && npm test`

Other tests construct `ReviewerPosition` literals and will not typecheck until they carry `compoundId`. Fix each by adding `compoundId: "TAK-994"` - they all sign on the fixture today.

```bash
git add apps/web/src apps/web/test
git commit -m "Record which compound a position was signed on, inside the hash"
git push
```

---

### Task 6: The tour carries a compound

Two changes: beats are built from `data` so the tour's as-of dates cannot drift from the fixture's, and a beat may name a compound. The second closes a latent bug - **no beat dispatches `selectCompound` today**, so clicking a library row and then pressing `→` narrates TAK-994's script over another compound's numbers.

**Files:**
- Modify: `apps/web/src/tour/beats.ts`
- Modify: `apps/web/src/tour/TourFooter.tsx:11-19,36,44`
- Modify: `apps/web/e2e/demo.spec.ts:8-14`
- Modify: `apps/web/e2e/static-file.spec.ts:45-62`
- Test: `apps/web/test/beats.test.tsx`

**Interfaces:**
- Consumes: `LoadedData.heroCases`, `CYCLOSPORINE`.
- Produces: `buildBeats(data: LoadedData): Beat[]` replacing the exported `BEATS` constant; `Beat.compoundId: string`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/test/beats.test.tsx`:

```tsx
describe("beats carry a compound", () => {
  const data = loadData();
  const beats = buildBeats(data);

  it("reads its as-of dates from the hero case, not from module literals", () => {
    const milestones = Object.values(data.heroCases.get("TAK-994")!.asOfMilestones);
    const asOfActions = beats
      .flatMap((b) => b.actions)
      .filter((a): a is { type: "setAsOf"; asOf: string | null } => a.type === "setAsOf")
      .map((a) => a.asOf)
      .filter((d): d is string => d !== null);
    expect(asOfActions.length).toBeGreaterThan(0);
    for (const d of asOfActions) expect(milestones).toContain(d);
  });

  it("has one beat that selects the second hero case", () => {
    const contrast = beats.filter((b) => b.compoundId === CYCLOSPORINE);
    expect(contrast).toHaveLength(1);
    expect(contrast[0]!.tab).toBe("case");
  });

  it("puts the contrast beat before the validation beat", () => {
    const contrast = beats.findIndex((b) => b.compoundId === CYCLOSPORINE);
    const validation = beats.findIndex((b) => b.tab === "validation");
    // Coverage is named as the finding on the validation tab. An audience that has
    // just watched the engine commit hears "it abstains on 97%" as a calibration
    // claim rather than an admission.
    expect(contrast).toBeGreaterThan(-1);
    expect(contrast).toBeLessThan(validation);
  });

  it("names a compound on every beat, so none inherits one", () => {
    for (const b of beats) expect(data.heroCases.has(b.compoundId)).toBe(true);
  });

  // The defect that made compoundId required rather than optional: with only the
  // contrast beat naming one, stepping BACKWARD off it left Cyclosporine selected
  // while the record beat narrated TAK-994.
  it("restores the first hero case when stepping back off the contrast beat", () => {
    const contrast = beats.findIndex((b) => b.compoundId === CYCLOSPORINE);
    let state = reducer(initialState(data), {
      type: "selectCompound", compoundId: beats[contrast]!.compoundId,
    });
    expect(state.selectedCompoundId).toBe(CYCLOSPORINE);
    state = reducer(state, {
      type: "selectCompound", compoundId: beats[contrast - 1]!.compoundId,
    });
    expect(state.selectedCompoundId).toBe("TAK-994");
  });
});

describe("no beat inherits its as-of date", () => {
  // Beat 5 (the record tab) used to carry `actions: []`. Reached FORWARD from
  // beat 4 it inherited `postMurineStudy`, correctly - but reached BACKWARD from
  // beat 6 it inherited `null`, because beat 6 sets `null` and nothing restored
  // it. That is the same class of bug that made `compoundId` required: a beat
  // with no `setAsOf` of its own inherits whatever the previous beat left behind,
  // and inheritance is direction-dependent. It is not cosmetic on this beat
  // specifically - `Record.tsx` hashes `visibleClaims(all, asOf)` into the signed
  // evidence snapshot and stores `asOfDate: asOf` on the position, so a presenter
  // stepping backward onto the record beat and signing would have recorded a
  // position against a different evidence snapshot than the forward path
  // produces, inside the hash-chained audit log. Beats 1-3 had the identical
  // defect walking backward from beat 4.
  it("reaches the same as-of date walking backward as walking forward, at every beat", () => {
    // Walk all the way forward first, exactly as a presenter does before ever
    // pressing ←.
    let s = initialState(data);
    for (const b of beats) {
      s = reducer(s, { type: "setTourBeat", beat: b.n, tab: b.tab, focus: b.focus });
      for (const a of b.actions) s = reducer(s, a);
    }

    // Then walk backward one beat at a time, and at each beat compare the as-of
    // date the backward walk reached to the one a pure forward walk to that SAME
    // beat produces (stateAtBeat). They must agree at every beat, not just the
    // endpoints.
    for (let i = beats.length - 1; i >= 0; i--) {
      const b = beats[i]!;
      s = reducer(s, { type: "setTourBeat", beat: b.n, tab: b.tab, focus: b.focus });
      for (const a of b.actions) s = reducer(s, a);
      expect(s.asOf).toBe(stateAtBeat(i).asOf);
    }
  });
});
```

The file needs these imports added at the top: `buildBeats` from `../src/tour/beats.js`, `CYCLOSPORINE` from `../src/data/heroCases.js`, and `initialState` plus `reducer` from `../src/state/store.js`.

`apps/web/test/chain.test.ts` (Task 5) likewise needs `CYCLOSPORINE` and the `ReviewerPosition` type imported.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/web/test/beats.test.tsx`
Expected: FAIL - `buildBeats` is not exported.

- [ ] **Step 3: Rewrite `beats.ts`**

Replace the module-level `PRE_FIH`/`POST_MURINE` constants and the `BEATS` array with a builder. The `Beat` interface gains one field:

```ts
import type { LoadedData } from "../data/load.js";
import { CYCLOSPORINE } from "../data/heroCases.js";
import type { Action, Region } from "../state/store.js";
import type { TabId } from "../router.js";

export interface Beat {
  n: number;
  title: string;
  tab: TabId;
  /**
   * The compound this beat narrates. REQUIRED on every beat, not optional.
   *
   * An optional field was tried and is wrong: with only the contrast beat naming a
   * compound, pressing ← from it lands on a beat that names none, which leaves
   * Cyclosporine selected while the record beat narrates TAK-994. Making it required
   * means every beat states its subject and no beat inherits one, so the tour is
   * correct from any entry point and in both directions - including after a judge
   * has clicked a library row, which is the latent bug this closes.
   */
  compoundId: string;
  focus: Region | null;
  /**
   * Data changes a beat performs, expressed as the SAME actions a user could
   * dispatch by hand. The tour holds no data of its own, so the guided path and
   * the manual path cannot disagree.
   *
   * Every beat sets its OWN `setAsOf`, even a beat whose as-of date is unchanged
   * from the one before it. Leaving `actions: []` on such a beat was tried and is
   * wrong, for the same reason `compoundId` is required rather than optional: a
   * beat with no `setAsOf` of its own INHERITS whatever the previous beat left
   * behind, and inheritance is direction-dependent. Beat 5 (the record tab) used
   * to carry `actions: []` - reached forward from beat 4 it inherited
   * `postMurineStudy`, correctly, but reached backward from beat 6 it inherited
   * `null`, because beat 6 sets `null` and nothing restores it. That is not
   * cosmetic on the record beat specifically: `Record.tsx` hashes
   * `visibleClaims(all, asOf)` into the signed evidence snapshot and stores
   * `asOfDate: asOf` on the position, so a presenter who steps backward onto this
   * beat and signs would record a position against a different evidence snapshot
   * than the one the forward path produces - inside the hash-chained audit log.
   * Stating every beat's date explicitly means no beat inherits one, so the tour
   * is correct from any entry point and in both directions.
   */
  actions: Action[];
  line: string;
}

/**
 * Built from `data` rather than declared as a constant so the milestone dates come
 * from the hero case itself. They were previously duplicated here as literals, which
 * is one edit to `tak994.json` away from a tour that sets an as-of date the as-of bar
 * does not offer.
 */
export function buildBeats(data: LoadedData): Beat[] {
  const tak = data.heroCases.get("TAK-994")!;
  const preFih = tak.asOfMilestones["preFirstInHuman"]!;
  const postMurine = tak.asOfMilestones["postMurineStudy"]!;
  const cyclo = data.heroCases.get(CYCLOSPORINE)!;

  return [
    {
      n: 0, title: "The desk, before first-in-human", tab: "compounds",
      compoundId: tak.compoundId, focus: null,
      actions: [{ type: "setAsOf", asOf: preFih }],
      line: "61 of 267 scored compounds have streams in genuine conflict. This case is one of them.",
    },
    {
      n: 1, title: "What happens today", tab: "case",
      compoundId: tak.compoundId, focus: "evidence",
      actions: [{ type: "setAsOf", asOf: preFih }],
      line: "Majority vote, weighted average and every single source all say advance.",
    },
    {
      n: 2, title: "ARBITER's argument", tab: "case",
      compoundId: tak.compoundId, focus: "trace",
      actions: [{ type: "setAsOf", asOf: preFih }],
      line: "Nothing is defeated. Nothing contradicts anything. Each source is discounted for what it cannot license, and most of the weight lands on uncommitted.",
    },
    {
      n: 3, title: "The honest gap, and what would flip it", tab: "case",
      compoundId: tak.compoundId, focus: "trace",
      actions: [{ type: "setAsOf", asOf: preFih }],
      line: "The range is the widest in the set. One claim would have to change to move the verdict.",
    },
    {
      n: 4, title: "The experiment it asks for", tab: "case",
      compoundId: tak.compoundId, focus: "trace",
      actions: [{ type: "setAsOf", asOf: postMurine }],
      line: "It asks for a human BSEP assay at matched exposure. Takeda ran a mouse study instead - and even that does not license a conclusion, because it is a mouse.",
    },
    {
      n: 5, title: "The table", tab: "record",
      compoundId: tak.compoundId, focus: null,
      actions: [{ type: "setAsOf", asOf: postMurine }],
      line: "Positions are recorded, including dissent. The named decision owner signs. ARBITER holds no position.",
    },
    {
      n: 6, title: "When it does commit", tab: "case",
      compoundId: cyclo.compoundId, focus: "trace",
      actions: [{ type: "setAsOf", asOf: null }],
      line: `Same rules, same engine. On ${cyclo.displayName} the human streams disagree at the mechanism - and it commits.`,
    },
    {
      // Corpus-wide statistics, so the compound is immaterial to what is rendered.
      // It is still named, because "immaterial here" is not a reason to leave the
      // selection to whatever the previous beat happened to set.
      n: 7, title: "What the numbers say", tab: "validation",
      compoundId: tak.compoundId, focus: null,
      actions: [{ type: "setAsOf", asOf: null }],
      line: "Determinism and robustness. Coverage is the finding. The planner recommendation survives ±50% perturbation of every elicited prior.",
    },
  ];
}
```

Note beat 6 sets `asOf: null`. Cyclosporine has no milestones, and arriving with beat 4's `postMurineStudy` date still set would filter its evidence against a date that means nothing on it.

- [ ] **Step 4: Wire `TourFooter`**

`apps/web/src/tour/TourFooter.tsx` lines 10-19 become:

```tsx
export function TourFooter() {
  const { data, tour, motion, selectedCompoundId } = useAppState();
  const dispatch = useDispatch();
  const beats = useMemo(() => buildBeats(data), [data]);

  const go = (n: number) => {
    const b = beats[Math.max(0, Math.min(beats.length - 1, n))]!;
    dispatch({ type: "setTourBeat", beat: b.n, tab: b.tab, focus: b.focus });
    // Before the beat's own actions: an as-of date is applied to the compound the
    // beat is about, not to the one that happened to be selected. Guarded on
    // inequality only to avoid a no-op re-render, never to make the field optional.
    if (b.compoundId !== selectedCompoundId) {
      dispatch({ type: "selectCompound", compoundId: b.compoundId });
    }
    for (const a of b.actions) dispatch(a);
    window.location.hash = `#/${b.tab}`;
  };
```

with `import { useEffect, useMemo } from "react";` and `import { buildBeats } from "./beats.js";`. Line 36 becomes `const b = beats[tour.beat]!;` and line 44's `{BEATS.length}` becomes `{beats.length}`.

- [ ] **Step 5: Update the two e2e specs**

`apps/web/e2e/demo.spec.ts:8-14` walks six `ArrowRight` presses; make it seven and keep the terminal-URL assertion on `#/validation`. `apps/web/e2e/static-file.spec.ts:45-62` asserts `Beat n of 7`; make it `Beat n of 8` and extend its walk by one press.

**Leave `static-file.spec.ts:27-28`'s assertion that the body contains `"TAK-994"` exactly as it is.** TAK-994 remains the boot case and its disappearance from the shipped artifact would be a real regression.

- [ ] **Step 6: Run everything**

Run: `npm run lint && npm run typecheck && npm test`
Run: `npm run web:build && npm run e2e`
Expected: PASS. If the static-file spec fails, read HANDOVER §10.2 before touching it - over `file://` the network panel is not evidence, and that spec's console-error listener is load-bearing.

- [ ] **Step 7: Verify the beat actually switches compound**

Temporarily delete the `selectCompound` dispatch from `go()`.
Run: `npx vitest run apps/web/test/beats.test.tsx` and `npm run e2e`.
Expected: the e2e walk still passes (it asserts tabs, not verdicts) but you should see beat 6 render TAK-994's verdict. **Add an e2e assertion that beat 6 shows `do_not_advance`**, confirm it fails with the dispatch removed, then restore the dispatch.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src apps/web/test apps/web/e2e
git commit -m "Let a beat name its compound, and build the tour from the data"
git push
```

---

### Task 7: Generalise the fixture leak check

`validate-evidence.ts:7` checks `id.startsWith("TAK-994")`. A second fixture with any other prefix would not be caught, and the check exists to protect the claim that the motivating case is not benchmark evidence. This is defence for a fixture that does not exist yet, which is why it is last and why it is small.

**Files:**
- Modify: `apps/harness/src/load.ts`
- Modify: `apps/harness/src/validate-evidence.ts:6-8`
- Test: `apps/harness/test/validateEvidence.test.ts` (new)

**Interfaces:**
- Consumes: `loadInputs()` from `apps/harness/src/load.ts`.
- Produces: `fixtureIds: string[]` on `loadInputs()`'s return; `findLeakedFixtures(fixtureIds, benchmarkIds): string[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/harness/test/validateEvidence.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findLeakedFixtures } from "../src/validate-evidence.js";
import { loadInputs } from "../src/load.js";

describe("the fixture leak check", () => {
  it("finds a fixture id that reached the benchmark", () => {
    expect(findLeakedFixtures(["TAK-994", "FOO-1"], ["ABC", "FOO-1"])).toEqual(["FOO-1"]);
  });

  // The defect the old check had: it matched one hardcoded prefix, so any other
  // fixture leaked silently.
  it("catches a fixture whose id does not start with TAK-994", () => {
    expect(findLeakedFixtures(["FASIGLIFAM"], ["FASIGLIFAM"])).toEqual(["FASIGLIFAM"]);
  });

  it("passes on the shipped data", () => {
    const { fixtureIds, benchmarkIds } = loadInputs();
    expect(fixtureIds.length).toBeGreaterThan(0);
    expect(findLeakedFixtures(fixtureIds, benchmarkIds)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/harness/test/validateEvidence.test.ts`
Expected: FAIL - `findLeakedFixtures` is not exported.

- [ ] **Step 3: Expose `fixtureIds`**

In `apps/harness/src/load.ts`, read `fixtureCompoundIds` off `data/out/evidence.json` - it is **already a list** - and add it to `loadInputs()`'s returned object as `fixtureIds: string[]`.

- [ ] **Step 4: Rewrite the check**

`apps/harness/src/validate-evidence.ts` lines 6-8 become:

```ts
/**
 * Fixture ids that reached the benchmark population.
 *
 * Membership, not `startsWith("TAK-994")`. The prefix form was correct for exactly
 * one fixture and silently correct-looking for any other - the failure mode
 * HANDOVER §6.4 names, where a silent empty result looks exactly like a working
 * pipeline. The list comes from `evidence.json`'s `fixtureCompoundIds`, which the
 * Python assembly layer has always emitted as a list.
 */
export function findLeakedFixtures(fixtureIds: string[], benchmarkIds: string[]): string[] {
  const benchmark = new Set(benchmarkIds);
  return fixtureIds.filter((id) => benchmark.has(id));
}

const leaked = findLeakedFixtures(fixtureIds, benchmarkIds);
if (leaked.length > 0) throw new Error(`Fixture leaked into the benchmark: ${leaked.join(", ")}`);
```

with `fixtureIds` added to the destructuring on line 3.

The module runs its check at import time, so the test importing it also runs it. That is intentional - the test file cannot import the function without proving the shipped data passes.

- [ ] **Step 5: Verify by injection**

Temporarily add a real benchmark compound id to `fixtureCompoundIds` in `data/out/evidence.json`.
Run: `npm run validate:evidence`
Expected: throws, naming that id. Then `git checkout -- data/out/evidence.json`.

- [ ] **Step 6: Run everything and commit**

Run: `npm run lint && npm run typecheck && npm test && npm run validate:evidence`
Run: `npm run golden:update && git diff --exit-code results/`

```bash
git add apps/harness
git commit -m "Check the fixture leak by membership, not by one hardcoded prefix"
git push
```

---

## Closing out

- [ ] Update `HANDOVER.md`: add a §11 recording what this work found - that Cyclosporine shows no defeat and TAK-994 shows four, that no test-split compound is both severe-DILI and defeat-bearing, and that hero case 3 is gated in code rather than by discipline. HANDOVER §7 is explicit that conclusions living only in a gitignored ledger are lost; this plan is a tracked file but the *measurements* belong there.
- [ ] Update the master spec's §3 beat table to eight beats.
- [ ] Open the PR against `main`.

**Not in this plan, and deliberately:** hero case 3 itself (blocked on a clinical Cmax - spec §5, HANDOVER §3.1), Troglitazone as a fourth case (spec §14, needs only data once Task 3 ships), and any Python change (no new evidence is authored).
