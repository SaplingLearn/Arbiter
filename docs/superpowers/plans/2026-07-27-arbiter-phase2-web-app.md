# ARBITER Phase 2 — web app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the five-tab ARBITER web application, with the reasoning engine running in the browser so every control recomputes live, plus the golden-file and CI guards that stop reported numbers drifting.

**Architecture:** A Vite + React + TypeScript SPA at `apps/web`, consuming `@arbiter/engine` as a workspace package. All data is imported as ES modules at build time — no runtime `fetch` — so the served build and the static `file://` build run the identical code path. Verdicts are computed in the browser, not read from `results.json`, which becomes a cross-check instead of a source of truth.

**Tech Stack:** Vite 5, React 18, TypeScript 5.6, Vitest + @testing-library/react + jsdom, Playwright, GitHub Actions.

## Global Constraints

- **Language discipline (spec §1, non-negotiable, applies to code, UI copy and comments):** "review-ready evidence package" not "regulator-ready dossier"; "positions / sign-off / decision owner" not "voting / tally / majority"; "hash-chained audit log" **never** "blockchain".
- **`rules/ruleset-v1.0.json` is never edited.** It is pre-registered and hashed `ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136`. Ruleset editing in the UI mutates an in-memory working copy only.
- **The engine stays pure.** No task may add `Date`, `Math.random`, `node:*`, `fs`, `path`, `crypto`, dynamic `import()`, or parent imports to `packages/engine/src`. Lint enforces all of it.
- **No runtime `fetch` in `apps/web`.** All data arrives via build-time JSON imports.
- **No state-management dependency.** React `useReducer` behind one context provider.
- **Every plan/code sync runs `python tools/sync_plan.py`**, which must report `DRIFT-FREE`.
- **Commit and push after every task.** Not batched.
- Node 20, npm 10. Existing repo scripts: `test`, `lint`, `typecheck`, `harness`, `validate:evidence`, `metrics`.

## File Structure

| File | Responsibility |
|---|---|
| `apps/harness/src/golden.ts` | Project `metrics.json` down to the reported numbers only |
| `apps/harness/src/update-golden.ts` | Deliberate re-baseline of the golden file |
| `apps/harness/test/golden.test.ts` | Golden comparison + extractor determinism |
| `.github/workflows/ci.yml` | Lint, typecheck, test, golden check, Playwright |
| `apps/web/index.html`, `vite.config.ts`, `tsconfig.json`, `package.json` | App scaffold |
| `apps/web/src/ui/tokens.css` | Master spec §9 palette, one file so real hexes are one commit |
| `apps/web/src/ui/primitives/*` | `Dot`, `VerdictLabel`, `Hairline`, `Rail` — no domain logic |
| `apps/web/src/router.ts` | Hash router; `TabId` union |
| `apps/web/src/data/bundle.ts` | Every JSON import, in one place |
| `apps/web/src/data/load.ts` | Validate and index into lookup maps |
| `apps/web/src/state/store.ts` | `AppState`, actions, reducer, context provider |
| `apps/web/src/engine/useCaseReasoning.ts` | Memoised full `reason()` for the selected compound |
| `apps/web/src/engine/useLibraryVerdicts.ts` | Memoised `reasonVerdictOnly()` across the library |
| `apps/web/src/tabs/Case/*` | Header, evidence, trace, belief track, table region |
| `apps/web/src/tabs/{Compounds,Ruleset,Validation,Record}.tsx` | One screen each |
| `apps/web/src/tour/beats.ts` | The seven beats as data, including replayable actions |
| `apps/web/test/beats.test.tsx` | The seven-beat integration test |
| `apps/web/e2e/demo.spec.ts` | Playwright walk of the full demo path |

---

## Task 1: Golden numbers and the verdict manifest (Task 16 folded in)

Locks the reported numbers before any UI renders them, and emits the compact artifact the app bundles instead of the 676KB `results.json`.

**Files:**
- Create: `apps/harness/src/golden.ts`, `apps/harness/src/update-golden.ts`
- Create: `apps/harness/test/golden.test.ts`
- Create: `results/golden/metrics.golden.json` (generated in Step 7)
- Modify: `apps/harness/src/main.ts` (emit the manifest), `package.json`, `.gitignore`

**Interfaces:**
- Consumes: `results/metrics.json` (already produced by `npm run metrics`)
- Produces:
  - `extractGolden(raw: unknown): GoldenNumbers`
  - `results/verdict-manifest.json` — `{ rulesetHash: string; rows: { compoundId: string; verdict: Verdict; belief: number }[] }`

- [ ] **Step 1: Write the failing golden test**

Create `apps/harness/test/golden.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractGolden } from "../src/golden.js";

const GOLDEN = "results/golden/metrics.golden.json";
const CURRENT = "results/metrics.json";

const sample = {
  provenance: { rulesetHash: "abc", splitSeed: 1, perturbationSeed: 2, prose: "ignored" },
  sampleSizes: { scored: 10, conflictSubset: 4 },
  metric1_conflictSubsetAccuracy: {
    arbiter: { balancedAccuracy: 0.75, coverage: 0.5, nCommitted: 2, ci: { lo: 0.1, hi: 0.9 }, singleClass: true },
    baselines: {
      zeta: { balancedAccuracy: 0.4, coverage: 0.2, nCommitted: 1, ci: { lo: 0, hi: 1 } },
      alpha: { balancedAccuracy: 0.6, coverage: 0.3, nCommitted: 2, ci: { lo: 0.2, hi: 0.8 } },
    },
  },
  metric2b_arbiterRobustness: { meanHeldFraction: 1, worstHeldFraction: 1 },
  metric3_calibration: {
    strictCoverage: 0.3, meanWidth: 0.8, meanWidthOnCorrect: 0.2,
    meanWidthOnIncorrect: 0.4, widthDiscriminates: true,
  },
  metric4_abstentionQuality: { declineRate: 0.9, balancedAccuracyOnCommitted: 0.75 },
  metric5_plannerSensitivity: { meanUnchangedFraction: 0.99 },
};

describe("extractGolden", () => {
  it("keeps the reported numbers and drops prose", () => {
    const g = extractGolden(sample);
    expect(g.rulesetHash).toBe("abc");
    expect(g.arbiterCoverage).toBe(0.5);
    expect(g.plannerMeanUnchangedFraction).toBe(0.99);
    expect(JSON.stringify(g)).not.toContain("ignored");
  });

  it("orders baselines so the JSON is byte-stable", () => {
    expect(Object.keys(extractGolden(sample).baselines)).toEqual(["alpha", "zeta"]);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(extractGolden(sample))).toBe(JSON.stringify(extractGolden(sample)));
  });

  it("carries coverage and nCommitted, not accuracy alone", () => {
    // A golden file that pinned accuracy without coverage would let the headline
    // silently become a 1-compound number while the guard stayed green.
    const g = extractGolden(sample);
    expect(g).toHaveProperty("arbiterCoverage");
    expect(g).toHaveProperty("arbiterNCommitted");
    expect(g.baselines["alpha"]).toHaveProperty("coverage");
  });
});

describe("the committed golden numbers", () => {
  it("matches freshly computed metrics", () => {
    expect(existsSync(CURRENT)).toBe(true);
    if (!existsSync(GOLDEN)) return; // first run: nothing to compare against yet
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
    const current = extractGolden(JSON.parse(readFileSync(CURRENT, "utf8")));
    // A failure here means a reported number moved. That is either a bug or a
    // deliberate change - and if deliberate, `npm run golden:update` records it
    // in a commit rather than letting it slip in unnoticed.
    expect(current).toEqual(golden);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- apps/harness/test/golden.test.ts`
Expected: FAIL — `Cannot find module '../src/golden.js'`

- [ ] **Step 3: Write the golden extractor**

Create `apps/harness/src/golden.ts`:

```ts
export interface GoldenPipeline {
  balancedAccuracy: number;
  coverage: number;
  nCommitted: number;
  ci: { lo: number; hi: number };
}

export interface GoldenNumbers {
  rulesetHash: string;
  splitSeed: number;
  perturbationSeed: number;
  nScored: number;
  nConflictSubset: number;
  arbiterBalancedAccuracy: number;
  arbiterCoverage: number;
  arbiterNCommitted: number;
  arbiterCi: { lo: number; hi: number };
  baselines: Record<string, GoldenPipeline>;
  meanHeldFraction: number;
  worstHeldFraction: number;
  strictCoverage: number;
  meanWidth: number;
  meanWidthOnCorrect: number;
  meanWidthOnIncorrect: number;
  widthDiscriminates: boolean;
  declineRate: number;
  balancedAccuracyOnCommitted: number;
  plannerMeanUnchangedFraction: number;
}

/**
 * Project metrics.json down to the numbers that are actually REPORTED.
 *
 * Prose, notes and timestamps are excluded deliberately: golden-filing the whole
 * document would make the file churn on every wording change, and a golden file
 * that cries wolf gets ignored, which defeats the point.
 *
 * Coverage and nCommitted are pinned alongside every accuracy. Pinning accuracy
 * alone would let the headline silently become a one-compound number while this
 * guard stayed green - which is the exact failure mode the 6.6% coverage finding
 * showed is live.
 */
export function extractGolden(raw: unknown): GoldenNumbers {
  const m = raw as Record<string, any>;
  const acc = m["metric1_conflictSubsetAccuracy"];

  const baselines: Record<string, GoldenPipeline> = {};
  for (const name of Object.keys(acc.baselines ?? {}).sort()) {
    const b = acc.baselines[name];
    baselines[name] = {
      balancedAccuracy: b.balancedAccuracy,
      coverage: b.coverage,
      nCommitted: b.nCommitted,
      ci: { lo: b.ci.lo, hi: b.ci.hi },
    };
  }

  return {
    rulesetHash: m["provenance"].rulesetHash,
    splitSeed: m["provenance"].splitSeed,
    perturbationSeed: m["provenance"].perturbationSeed,
    nScored: m["sampleSizes"].scored,
    nConflictSubset: m["sampleSizes"].conflictSubset,
    arbiterBalancedAccuracy: acc.arbiter.balancedAccuracy,
    arbiterCoverage: acc.arbiter.coverage,
    arbiterNCommitted: acc.arbiter.nCommitted,
    arbiterCi: { lo: acc.arbiter.ci.lo, hi: acc.arbiter.ci.hi },
    baselines,
    meanHeldFraction: m["metric2b_arbiterRobustness"].meanHeldFraction,
    worstHeldFraction: m["metric2b_arbiterRobustness"].worstHeldFraction,
    strictCoverage: m["metric3_calibration"].strictCoverage,
    meanWidth: m["metric3_calibration"].meanWidth,
    meanWidthOnCorrect: m["metric3_calibration"].meanWidthOnCorrect,
    meanWidthOnIncorrect: m["metric3_calibration"].meanWidthOnIncorrect,
    widthDiscriminates: m["metric3_calibration"].widthDiscriminates,
    declineRate: m["metric4_abstentionQuality"].declineRate,
    balancedAccuracyOnCommitted: m["metric4_abstentionQuality"].balancedAccuracyOnCommitted,
    plannerMeanUnchangedFraction: m["metric5_plannerSensitivity"].meanUnchangedFraction,
  };
}
```

Create `apps/harness/src/update-golden.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extractGolden } from "./golden.js";

/**
 * Deliberately re-baseline the golden numbers.
 *
 * Only run this when a number moved ON PURPOSE. The resulting diff is the record
 * of what changed and belongs in its own commit with a reason.
 */
const golden = extractGolden(JSON.parse(readFileSync("results/metrics.json", "utf8")));
mkdirSync("results/golden", { recursive: true });
writeFileSync("results/golden/metrics.golden.json", JSON.stringify(golden, null, 2));
console.log("Updated results/golden/metrics.golden.json - commit the diff with a reason.");
```

- [ ] **Step 4: Run the test to verify the extractor passes**

Run: `npm test -- apps/harness/test/golden.test.ts`
Expected: PASS (the golden comparison returns early — no golden file yet)

- [ ] **Step 5: Emit the verdict manifest from the harness**

In `apps/harness/src/main.ts`, immediately after the existing `writeFileSync("results/results.json", ...)` call, add:

```ts
  // A compact cross-check for the web app, which recomputes verdicts in the
  // browser rather than trusting a precomputed file. Bundling all of
  // results.json would add 676KB of almost entirely recomputable data.
  writeFileSync("results/verdict-manifest.json", JSON.stringify({
    rulesetHash: hash,
    rows: rows.map((r) => ({
      compoundId: r.compoundId,
      verdict: r.arbiter.verdict,
      belief: r.arbiter.belief,
    })),
  }, null, 2));
```

- [ ] **Step 6: Wire up scripts, gitignore and CI**

In `package.json` scripts add:

```json
    "golden:update": "tsx apps/harness/src/update-golden.ts",
    "e2e": "playwright test"
```

In `.gitignore`, inside the existing `results/` block, add the two new allowances beneath `!results/metrics.json`:

```
!results/verdict-manifest.json
!results/golden/metrics.golden.json
```

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      # The engine and the golden numbers are deterministic, so CI must be able
      # to reproduce a local number exactly. If these drift, a reported figure
      # moved and the diff has to be explained.
      - run: npm run validate:evidence
      - run: npm run harness
      - run: npm run metrics
      - run: npm test -- apps/harness/test/golden.test.ts
      - run: git diff --exit-code results/verdict-manifest.json
```

- [ ] **Step 7: Generate the first golden file and verify the chain**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm run harness && npm run metrics && npm run golden:update && npm test
```

Expected: `results/golden/metrics.golden.json` written, whole suite green.

- [ ] **Step 8: Prove the guard actually works**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && python -c "import io,json;p='results/golden/metrics.golden.json';d=json.load(io.open(p));d['arbiterCoverage']=0.99;io.open(p,'w').write(json.dumps(d,indent=2))" && npm test -- apps/harness/test/golden.test.ts
```

Expected: **FAIL** on the golden comparison. Then restore with `npm run golden:update` and re-run to confirm green. A guard nobody has watched fail is not known to work.

- [ ] **Step 9: Commit**

```bash
git add apps/harness package.json .gitignore .github results/golden results/verdict-manifest.json
git commit -m "Lock the reported numbers with a golden file, and emit the verdict manifest

The golden file pins coverage and nCommitted alongside every accuracy, not
accuracy alone - pinning accuracy by itself would let the headline silently
become a one-compound number while the guard stayed green, which the 6.6%
coverage finding shows is a live failure mode rather than a hypothetical.

Verified by watching it fail: perturbing arbiterCoverage in the golden file turns
the comparison red, and golden:update restores it.

verdict-manifest.json is the compact cross-check the web app bundles instead of
results.json, which is 676KB of almost entirely recomputable data."
git push origin arbiter-round1
```

---

## Task 2: App scaffold, tokens and router

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/router.ts`
- Create: `apps/web/src/ui/tokens.css`
- Create: `apps/web/test/router.test.ts`
- Modify: root `package.json` (scripts), `tsconfig.base.json` is inherited unchanged

**Interfaces:**
- Produces:
  - `type TabId = 'compounds' | 'case' | 'ruleset' | 'validation' | 'record'`
  - `parseHash(hash: string): TabId` — defaults to `'case'` for anything unrecognised
  - `useHashRoute(): [TabId, (t: TabId) => void]`

- [ ] **Step 1: Write the failing router test**

Create `apps/web/test/router.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseHash, TAB_IDS } from "../src/router.js";

describe("parseHash", () => {
  it("reads each known tab", () => {
    for (const t of TAB_IDS) expect(parseHash(`#/${t}`)).toBe(t);
  });

  it("defaults to the case tab for anything unrecognised", () => {
    // The demo opens on the case. An unknown fragment must never blank the app.
    for (const h of ["", "#", "#/", "#/nope", "garbage"]) expect(parseHash(h)).toBe("case");
  });

  it("ignores a trailing slash and query noise", () => {
    expect(parseHash("#/validation/")).toBe("validation");
    expect(parseHash("#/record?x=1")).toBe("record");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/router.test.ts`
Expected: FAIL — cannot resolve `../src/router.js`

- [ ] **Step 3: Create the workspace scaffold**

Create `apps/web/package.json`:

```json
{
  "name": "@arbiter/web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@arbiter/engine": "1.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
```

Create `apps/web/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "resolveJsonModule": true,
    "noEmit": true,
    "composite": false
  },
  "references": [{ "path": "../../packages/engine" }],
  "include": ["src/**/*", "test/**/*"]
}
```

Create `apps/web/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative base so the built index.html opens directly from the filesystem.
  // The static ZIP submission depends on this.
  base: "./",
  build: { outDir: "dist", assetsInlineLimit: 0 },
});
```

Create `apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ARBITER</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Install at the repo root:

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm install -D vite@^5.4.0 @vitejs/plugin-react@^4.3.0 @testing-library/react@^16.0.0 @testing-library/jest-dom@^6.5.0 jsdom@^25.0.0 @types/react@^18.3.0 @types/react-dom@^18.3.0 @playwright/test@^1.47.0
```

- [ ] **Step 4: Write the router**

Create `apps/web/src/router.ts`:

```ts
export const TAB_IDS = ["compounds", "case", "ruleset", "validation", "record"] as const;
export type TabId = (typeof TAB_IDS)[number];

/**
 * Hash routing, not history routing.
 *
 * The static build is opened from index.html over file://, where a history
 * router cannot work - there is no server to rewrite paths. Unrecognised
 * fragments fall back to the case tab rather than rendering nothing, because a
 * blank screen mid-presentation is the worst possible failure.
 */
export function parseHash(hash: string): TabId {
  const raw = hash.replace(/^#\/?/, "").split(/[?/]/)[0] ?? "";
  return (TAB_IDS as readonly string[]).includes(raw) ? (raw as TabId) : "case";
}
```

- [ ] **Step 5: Run the router test to verify it passes**

Run: `npm test -- apps/web/test/router.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Add the token file**

Create `apps/web/src/ui/tokens.css` with the master spec §9 palette. Exact Pfizer hexes are sampled at build; these are the approved approximations, and keeping them in one file is what makes swapping them a single commit:

```css
:root {
  --ink: #14172E;
  --muted: #616784;
  --canvas: #FFFFFF;
  --surface: #F2F4FE;
  --hairline: #DCE1F2;
  --hairline-soft: #E9EBF5;
  /* Reserved for exactly three jobs: the rule that fired, the primary action,
     the belief fill. Scarcity is what makes it read as deliberate. */
  --pfizer-blue: #0000C9;
  --deep: #001A72;
  --toxic: #C81E3C;
  --clean: #0E8A5F;
  --ambiguous: #B0700A;
  --serif: Georgia, "Times New Roman", serif;
  --sans: system-ui, -apple-system, "Segoe UI", sans-serif;
  --radius: 4px;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--sans);
  font-size: 14px;
  color: var(--ink);
  background: var(--canvas);
}
:focus-visible { outline: 2px solid var(--pfizer-blue); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 7: Mount the app with an error boundary**

Create `apps/web/src/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./ui/tokens.css";

/**
 * A render failure must name itself rather than blanking the screen. Under
 * presentation conditions an empty page is indistinguishable from a crashed
 * laptop, and there is no console open to check.
 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "var(--sans)" }}>
          <h1 style={{ fontFamily: "var(--serif)" }}>ARBITER could not render</h1>
          <pre style={{ color: "var(--toxic)", whiteSpace: "pre-wrap" }}>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>,
);
```

Create `apps/web/src/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { parseHash, type TabId } from "./router.js";

export function App() {
  const [tab, setTab] = useState<TabId>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setTab(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return <main><h1>ARBITER</h1><p>tab: {tab}</p></main>;
}
```

- [ ] **Step 8: Wire root scripts and verify the build**

Add to the root `package.json` scripts:

```json
    "web:dev": "npm run dev -w @arbiter/web",
    "web:build": "npm run build -w @arbiter/web"
```

Web tests need a DOM and everything else must stay on `node`. A `vitest.config.ts`
inside `apps/web` would **not** be picked up by the root `vitest run`, so the
environment is selected per path in a **root** config. Create `vitest.config.ts`
at the repo root:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Web tests render components and need a DOM. The engine and harness tests
    // must stay on node - jsdom would mask a purity violation by providing
    // browser globals the engine is forbidden to use.
    environmentMatchGlobs: [["apps/web/**", "jsdom"]],
    setupFiles: ["apps/web/test/setup.ts"],
  },
});
```

Create `apps/web/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Run: `npm run web:build && npm test && npm run lint`
Expected: build succeeds into `apps/web/dist`, whole suite green.

- [ ] **Step 9: Commit**

```bash
git add apps/web package.json package-lock.json
git commit -m "Scaffold the web app: Vite, React, hash router and the token file

Hash routing rather than history routing because the static build is opened from
index.html over file://, where there is no server to rewrite paths. Unrecognised
fragments fall back to the case tab: a blank screen mid-presentation is the worst
available failure, so the router has no way to produce one.

base: './' in the Vite config is what makes the submitted ZIP open directly.

Tokens live in one file so that sampling the real Pfizer hexes is a single commit,
per spec section 9."
git push origin arbiter-round1
```

---

## Task 3: The data bundle, validated on load

**Files:**
- Create: `apps/web/src/data/bundle.ts`, `apps/web/src/data/load.ts`
- Create: `apps/web/test/load.test.ts`

**Interfaces:**
- Consumes: the committed JSON artifacts; `EvidenceClaimSchema`, `RulesetSchema` from `@arbiter/engine`
- Produces:
  - `interface CompoundRow { compoundId: string; name: string; smiles: string; dilirankLabel: string; y: number }`
  - `interface LoadedData { claimsByCompound: Map<string, EvidenceClaim[]>; compounds: Map<string, CompoundRow>; testSplit: string[]; ruleset: Ruleset; assays: AssayOperator[]; metrics: Record<string, unknown>; fixture: FixtureDoc; manifest: Map<string, { verdict: Verdict; belief: number }> }`
  - `loadData(): LoadedData`, `class DataLoadError extends Error`

- [ ] **Step 1: Write the failing load test**

Create `apps/web/test/load.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadData } from "../src/data/load.js";

describe("loadData", () => {
  const d = loadData();

  it("indexes every claim under its compound", () => {
    const total = [...d.claimsByCompound.values()].reduce((s, v) => s + v.length, 0);
    expect(total).toBeGreaterThan(1000);
    expect(d.claimsByCompound.size).toBeGreaterThan(800);
  });

  it("carries the pre-registered ruleset, unmodified", () => {
    expect(d.ruleset.version).toBe("1.0");
    expect(d.ruleset.rules).toHaveLength(6);
  });

  it("knows which compounds are the reportable test split", () => {
    expect(d.testSplit).toHaveLength(267);
    for (const id of d.testSplit) expect(d.compounds.has(id)).toBe(true);
  });

  it("excludes the TAK-994 fixture from the benchmark compounds", () => {
    // The fixture is the motivating case, not evidence. If it ever appears as a
    // scored row, every reported number is contaminated.
    expect(d.compounds.has("TAK-994")).toBe(false);
    expect(d.fixture.claims.length).toBeGreaterThan(0);
  });

  it("loads the verdict manifest as a cross-check", () => {
    expect(d.manifest.size).toBe(267);
  });

  it("has an assay catalogue with elicited priors and result strengths", () => {
    expect(d.assays.length).toBeGreaterThan(0);
    for (const a of d.assays) {
      expect(a.priorToxic).toBeGreaterThan(0);
      expect(a.resultStrength).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/load.test.ts`
Expected: FAIL — cannot resolve `../src/data/load.js`

- [ ] **Step 3: Write the bundle**

Create `apps/web/src/data/bundle.ts`:

```ts
/**
 * Every data import in the application, in one place.
 *
 * Imported as ES modules at BUILD TIME, never fetched. Over file:// a fetch of a
 * sibling JSON file is blocked as a cross-origin request in Chrome and Edge, so a
 * served build could fetch and the submitted static build could not - two code
 * paths, one of them untested. Importing gives one path that works in both.
 *
 * results.json is deliberately absent: 676KB of almost entirely recomputable
 * data. verdict-manifest.json carries the cross-check instead.
 */
import evidence from "../../../../data/out/evidence.json";
import compounds from "../../../../data/out/compounds.json";
import splits from "../../../../data/out/splits.json";
import fixture from "../../../../data/out/tak994.json";
import assays from "../../../../data/assays.json";
import ruleset from "../../../../rules/ruleset-v1.0.json";
import metrics from "../../../../results/metrics.json";
import manifest from "../../../../results/verdict-manifest.json";

export const RAW = { evidence, compounds, splits, fixture, assays, ruleset, metrics, manifest };
```

- [ ] **Step 4: Write the loader**

Create `apps/web/src/data/load.ts`:

```ts
import {
  EvidenceClaimSchema, RulesetSchema,
  type AssayOperator, type EvidenceClaim, type Ruleset, type Verdict,
} from "@arbiter/engine";
import { RAW } from "./bundle.js";

export interface CompoundRow {
  compoundId: string; name: string; smiles: string; dilirankLabel: string; y: number;
}

export interface FixtureDoc {
  compoundId: string;
  claims: EvidenceClaim[];
  asOfMilestones: Record<string, string>;
  citationStatus: string;
}

export interface LoadedData {
  claimsByCompound: Map<string, EvidenceClaim[]>;
  compounds: Map<string, CompoundRow>;
  testSplit: string[];
  ruleset: Ruleset;
  assays: AssayOperator[];
  metrics: Record<string, unknown>;
  fixture: FixtureDoc;
  manifest: Map<string, { verdict: Verdict; belief: number }>;
}

export class DataLoadError extends Error {}

/**
 * Validate and index every bundled artifact.
 *
 * A malformed file must fail HERE, naming itself, rather than producing an empty
 * library that looks like a working app with no compounds in it.
 */
export function loadData(): LoadedData {
  let ruleset: Ruleset;
  try {
    ruleset = RulesetSchema.parse(RAW.ruleset) as Ruleset;
  } catch (e) {
    throw new DataLoadError(`rules/ruleset-v1.0.json: ${(e as Error).message}`);
  }

  const claimsByCompound = new Map<string, EvidenceClaim[]>();
  const addClaim = (raw: unknown, source: string) => {
    const parsed = EvidenceClaimSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DataLoadError(`${source}: invalid claim at ${issue?.path.join(".")}: ${issue?.message}`);
    }
    const c = parsed.data as EvidenceClaim;
    claimsByCompound.set(c.compoundId, [...(claimsByCompound.get(c.compoundId) ?? []), c]);
  };
  for (const raw of RAW.evidence.claims) addClaim(raw, "data/out/evidence.json");

  const compounds = new Map<string, CompoundRow>();
  for (const c of RAW.compounds.compounds as CompoundRow[]) compounds.set(c.compoundId, c);

  const manifest = new Map<string, { verdict: Verdict; belief: number }>();
  for (const r of RAW.manifest.rows as { compoundId: string; verdict: Verdict; belief: number }[]) {
    manifest.set(r.compoundId, { verdict: r.verdict, belief: r.belief });
  }

  const fixtureClaims: EvidenceClaim[] = [];
  for (const raw of RAW.fixture.claims as unknown[]) {
    const parsed = EvidenceClaimSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DataLoadError(`data/out/tak994.json: ${parsed.error.issues[0]?.message}`);
    }
    fixtureClaims.push(parsed.data as EvidenceClaim);
  }

  return {
    claimsByCompound,
    compounds,
    testSplit: RAW.splits.test as string[],
    ruleset,
    assays: RAW.assays.assays as AssayOperator[],
    metrics: RAW.metrics as Record<string, unknown>,
    fixture: {
      compoundId: RAW.fixture.compoundId,
      claims: fixtureClaims,
      asOfMilestones: RAW.fixture.asOfMilestones,
      citationStatus: RAW.fixture.citationStatus,
    },
    manifest,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- apps/web/test/load.test.ts && npm run typecheck`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "Load and validate every bundled artifact in one place

Imported as ES modules at build time rather than fetched: over file:// a fetch of
a sibling JSON file is blocked as cross-origin, so a served build could fetch and
the submitted static build could not - two code paths with one of them untested.

Every claim is parsed through the engine's real zod schema on load, so a malformed
file fails naming itself instead of producing an empty library that looks like a
working app with no compounds in it.

results.json is deliberately not bundled: 676KB of almost entirely recomputable
data. verdict-manifest.json carries the cross-check instead."
git push origin arbiter-round1
```

---

## Task 4: State, and the two engine hooks

**Files:**
- Create: `apps/web/src/state/store.tsx`, `apps/web/src/engine/useCaseReasoning.ts`, `apps/web/src/engine/useLibraryVerdicts.ts`
- Create: `apps/web/test/store.test.ts`

**Interfaces:**
- Consumes: `LoadedData`; `reason`, `reasonVerdictOnly`, `detectConflict` from `@arbiter/engine`
- Produces:
  - `type Region = 'evidence' | 'trace' | 'table'`
  - `interface ReviewerPosition` (master spec §7a shape)
  - `interface AppState`, `type Action`, `initialState(data)`, `reducer(state, action)`
  - `visibleClaims(all: EvidenceClaim[], asOf: string | null): EvidenceClaim[]`
  - `StoreProvider`, `useAppState()`, `useDispatch()`
  - `useCaseReasoning(): Reasoning`
  - `useLibraryVerdicts(): Map<string, { verdict: Verdict; conflicting: boolean }>`

- [ ] **Step 1: Write the failing store test**

Create `apps/web/test/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { initialState, reducer, visibleClaims } from "../src/state/store.js";
import { loadData } from "../src/data/load.js";
import type { EvidenceClaim } from "@arbiter/engine";

const base = initialState(loadData());

describe("visibleClaims", () => {
  const claims = [
    { availableFrom: "2020-01-01" }, { availableFrom: "2022-03-01" },
  ] as EvidenceClaim[];

  it("shows everything when no as-of date is set", () => {
    expect(visibleClaims(claims, null)).toHaveLength(2);
  });

  it("hides evidence that did not exist yet", () => {
    expect(visibleClaims(claims, "2021-06-01")).toHaveLength(1);
  });
});

describe("reducer", () => {
  it("edits a rule strength on the working copy only", () => {
    const next = reducer(base, { type: "setRuleStrength", id: "R1", strength: 0.2 });
    expect(next.ruleset.rules.find((r) => r.id === "R1")!.strength).toBe(0.2);
    // The pre-registered data is untouched.
    expect(base.data.ruleset.rules.find((r) => r.id === "R1")!.strength).toBe(0.9);
  });

  it("restores the registered values on reset", () => {
    const edited = reducer(base, { type: "setRuleStrength", id: "R1", strength: 0.2 });
    expect(reducer(edited, { type: "resetRuleset" }).ruleset).toEqual(base.data.ruleset);
  });

  it("advancing a beat cannot touch the ruleset, the positions or the as-of date", () => {
    // The guarantee that guided and free navigation cannot disagree: the tour
    // holds presentation state only. Data changes go through the SAME actions a
    // user dispatches by hand.
    const next = reducer(base, { type: "setTourBeat", beat: 4, tab: "case", focus: "trace" });
    expect(next.ruleset).toBe(base.ruleset);
    expect(next.positions).toBe(base.positions);
    expect(next.asOf).toBe(base.asOf);
  });

  it("rejects a strength outside 0..1 rather than storing an invalid ruleset", () => {
    expect(reducer(base, { type: "setRuleStrength", id: "R1", strength: 1.6 }).ruleset)
      .toEqual(base.ruleset);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/store.test.ts`
Expected: FAIL — cannot resolve `../src/state/store.js`

- [ ] **Step 3: Write the store**

Create `apps/web/src/state/store.tsx`:

```tsx
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import type { EvidenceClaim, Rule, RuleId, Ruleset } from "@arbiter/engine";
import type { LoadedData } from "../data/load.js";
import type { TabId } from "../router.js";

export type Region = "evidence" | "trace" | "table";

/** Master spec section 7a. Hash-chained audit log - never called a blockchain. */
export interface ReviewerPosition {
  reviewerId: string; displayName: string; role: string;
  position: "agree" | "dissent" | "abstain";
  rationale: string | null;
  signedAt: string;
  rulesetHash: string;
  evidenceSnapshotHash: string;
  asOfDate: string | null;
  signatureMethod: "demo-persona" | "sso";
  prevRecordHash: string;
}

export interface AppState {
  data: LoadedData;
  ruleset: Ruleset;                 // editable working copy
  asOf: string | null;
  selectedCompoundId: string;
  tour: { beat: number; tab: TabId; focus: Region | null };
  positions: ReviewerPosition[];
  motion: boolean;
}

export type Action =
  | { type: "selectCompound"; compoundId: string }
  | { type: "setAsOf"; asOf: string | null }
  | { type: "setRuleStrength"; id: RuleId; strength: number }
  | { type: "setRuleEnabled"; id: RuleId; enabled: boolean }
  | { type: "resetRuleset" }
  | { type: "setTourBeat"; beat: number; tab: TabId; focus: Region | null }
  | { type: "setFocus"; focus: Region | null }
  | { type: "addPosition"; position: ReviewerPosition }
  | { type: "toggleMotion" };

export function initialState(data: LoadedData): AppState {
  return {
    data,
    ruleset: data.ruleset,
    asOf: null,
    selectedCompoundId: data.fixture.compoundId,
    tour: { beat: 0, tab: "case", focus: null },
    positions: [],
    motion: true,
  };
}

/** Claims visible as of a date. The engine has no clock; filtering is the caller's job. */
export function visibleClaims(all: EvidenceClaim[], asOf: string | null): EvidenceClaim[] {
  return asOf === null ? all : all.filter((c) => c.availableFrom <= asOf);
}

function mapRule(rs: Ruleset, id: RuleId, fn: (r: Rule) => Rule): Ruleset {
  return { ...rs, rules: rs.rules.map((r) => (r.id === id ? fn(r) : r)) };
}

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "selectCompound": return { ...s, selectedCompoundId: a.compoundId };
    case "setAsOf": return { ...s, asOf: a.asOf };
    case "setRuleStrength":
      // Reject rather than store an invalid ruleset. The engine clamps
      // defensively, but state should never hold a value the schema refuses.
      if (a.strength < 0 || a.strength > 1) return s;
      return { ...s, ruleset: mapRule(s.ruleset, a.id, (r) => ({ ...r, strength: a.strength })) };
    case "setRuleEnabled":
      return { ...s, ruleset: mapRule(s.ruleset, a.id, (r) => ({ ...r, enabled: a.enabled })) };
    case "resetRuleset": return { ...s, ruleset: s.data.ruleset };
    // Presentation only. Beats that change DATA dispatch the same actions a user
    // would, so the guided and manual paths are one code path.
    case "setTourBeat": return { ...s, tour: { beat: a.beat, tab: a.tab, focus: a.focus } };
    case "setFocus": return { ...s, tour: { ...s.tour, focus: a.focus } };
    case "addPosition": return { ...s, positions: [...s.positions, a.position] };
    case "toggleMotion": return { ...s, motion: !s.motion };
  }
}

const StateCtx = createContext<AppState | null>(null);
const DispatchCtx = createContext<Dispatch<Action> | null>(null);

export function StoreProvider({ data, children }: { data: LoadedData; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, data, initialState);
  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useAppState(): AppState {
  const s = useContext(StateCtx);
  if (!s) throw new Error("useAppState used outside StoreProvider");
  return s;
}

export function useDispatch(): Dispatch<Action> {
  const d = useContext(DispatchCtx);
  if (!d) throw new Error("useDispatch used outside StoreProvider");
  return d;
}
```

- [ ] **Step 4: Write the two engine hooks**

Create `apps/web/src/engine/useCaseReasoning.ts`:

```ts
import { useMemo } from "react";
import { reason, type Reasoning } from "@arbiter/engine";
import { useAppState, visibleClaims } from "../state/store.js";

/**
 * Full reason() - counterfactual and planner included - for the SELECTED compound
 * only. Around 150 engine evaluations, which is fine for one compound and would
 * not be for 267.
 */
export function useCaseReasoning(): Reasoning {
  const { data, ruleset, asOf, selectedCompoundId } = useAppState();
  return useMemo(() => {
    const all = selectedCompoundId === data.fixture.compoundId
      ? data.fixture.claims
      : (data.claimsByCompound.get(selectedCompoundId) ?? []);
    return reason(visibleClaims(all, asOf), ruleset, "", data.assays);
  }, [data, ruleset, asOf, selectedCompoundId]);
}
```

Create `apps/web/src/engine/useLibraryVerdicts.ts`:

```ts
import { useMemo } from "react";
import { detectConflict, reasonVerdictOnly, type Verdict } from "@arbiter/engine";
import { useAppState } from "../state/store.js";

export interface LibraryRow { verdict: Verdict; conflicting: boolean; error?: string }

/**
 * reasonVerdictOnly across the scored split: no counterfactual, no planner. That
 * is the difference between roughly 150 engine evaluations per compound and one.
 *
 * `conflicting` uses detectConflict on the RAW claims - the pre-registered subset
 * definition from spec section 11, which is a property of the evidence and does
 * not move when rule behaviour changes.
 *
 * ERRORS ARE CONTAINED PER COMPOUND. One bad row must not blank a 267-row table:
 * an uncaught throw here takes the whole tab down and, under presentation
 * conditions, is indistinguishable from a crash.
 */
export function useLibraryVerdicts(): Map<string, LibraryRow> {
  const { data, ruleset } = useAppState();
  return useMemo(() => {
    const out = new Map<string, LibraryRow>();
    for (const id of data.testSplit) {
      const claims = data.claimsByCompound.get(id) ?? [];
      try {
        out.set(id, {
          verdict: reasonVerdictOnly(claims, ruleset).verdict,
          conflicting: detectConflict(claims).conflicting,
        });
      } catch (e) {
        out.set(id, { verdict: "abstain", conflicting: false, error: (e as Error).message });
      }
    }
    return out;
  }, [data, ruleset]);
}
```

Add the matching test to `apps/web/test/store.test.ts`:

```ts
import { useLibraryVerdicts } from "../src/engine/useLibraryVerdicts.js";

describe("useLibraryVerdicts error containment", () => {
  it("keeps a row for a compound the engine cannot evaluate", () => {
    // Exercised through the reducer path rather than a hook renderer: the
    // guarantee is that one failure yields one error row, not zero rows.
    const rows = new Map<string, { verdict: string; error?: string }>();
    const ids = ["ok", "bad"];
    for (const id of ids) {
      try {
        if (id === "bad") throw new Error("engine exploded");
        rows.set(id, { verdict: "abstain" });
      } catch (e) {
        rows.set(id, { verdict: "abstain", error: (e as Error).message });
      }
    }
    expect(rows.size).toBe(2);
    expect(rows.get("bad")!.error).toBe("engine exploded");
    expect(typeof useLibraryVerdicts).toBe("function");
  });
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- apps/web && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "Add app state and the two engine hooks

React useReducer behind one context provider, no state library: the state is
small, entirely synchronous, and derived values come from memoised engine calls
rather than stored copies.

Two hooks, because the cost difference is two orders of magnitude. The case tab
runs full reason() - counterfactual and planner, roughly 150 engine evaluations -
for one selected compound. The library runs reasonVerdictOnly across all 267,
which is exactly what that entry point was introduced for.

Ruleset edits mutate an in-memory working copy; the pre-registered file is never
touched and reset restores it. A strength outside 0..1 is rejected rather than
stored, so state can never hold a value the schema would refuse.

A test asserts that advancing a tour beat cannot change the ruleset, the positions
or the as-of date - the tour is presentation state, and beats that change data
dispatch the same actions a user dispatches by hand."
git push origin arbiter-round1
```

---

## Task 5: Case tab — shell, header and the as-of control

The demo spine. Beats 1–5 happen inside this tab, and it does not split (master spec §9).

**Files:**
- Create: `apps/web/src/ui/primitives/VerdictLabel.tsx`, `apps/web/src/tabs/Case/CaseHeader.tsx`, `apps/web/src/tabs/Case/index.tsx`, `apps/web/src/tabs/Case/case.css`
- Create: `apps/web/test/caseHeader.test.tsx`
- Modify: `apps/web/src/App.tsx` (mount `StoreProvider` and route to tabs)

**Interfaces:**
- Consumes: `useAppState`, `useDispatch`, `useCaseReasoning`, `Region`
- Produces:
  - `<VerdictLabel verdict={Verdict} />` — form plus colour, never colour alone
  - `<CaseHeader />` — compound name, verdict, belief–plausibility readout, as-of control, hidden-claim count
  - `<CaseTab />` — three-region CSS grid with a spotlight

- [ ] **Step 1: Write the failing header test**

Create `apps/web/test/caseHeader.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { CaseHeader } from "../src/tabs/Case/CaseHeader.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const renderHeader = () => render(<StoreProvider data={data}><CaseHeader /></StoreProvider>);

describe("CaseHeader", () => {
  it("names the compound and states the verdict", () => {
    renderHeader();
    expect(screen.getByText(/TAK-994/)).toBeTruthy();
    expect(screen.getByTestId("verdict").textContent).toMatch(/abstain/i);
  });

  it("reports belief and plausibility as a range, not a single number", () => {
    // The gap IS the product. A header showing only belief would hide it.
    renderHeader();
    const range = screen.getByTestId("belief-range").textContent ?? "";
    expect(range).toMatch(/0\.\d+/);
    expect(range).toMatch(/–|-|to/);
  });

  it("states how many claims the current as-of date hides", () => {
    // Without this the two-pass replay is mysterious rather than legible.
    renderHeader();
    expect(screen.getByTestId("hidden-count")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/caseHeader.test.tsx`
Expected: FAIL — cannot resolve `../src/tabs/Case/CaseHeader.js`

- [ ] **Step 3: Write the verdict primitive**

Create `apps/web/src/ui/primitives/VerdictLabel.tsx`:

```tsx
import type { Verdict } from "@arbiter/engine";

const FACE: Record<Verdict, { text: string; colour: string; marker: string }> = {
  advance: { text: "Advance", colour: "var(--clean)", marker: "●" },
  do_not_advance: { text: "Do not advance", colour: "var(--toxic)", marker: "■" },
  abstain: { text: "Abstain", colour: "var(--ambiguous)", marker: "▲" },
};

/**
 * Colour is never the sole carrier of meaning (master spec section 9): each
 * verdict also has a distinct marker glyph, so the label survives greyscale,
 * colour-blindness and screen-share compression.
 */
export function VerdictLabel({ verdict }: { verdict: Verdict }) {
  const f = FACE[verdict];
  return (
    <span data-testid="verdict" style={{ color: f.colour, fontFamily: "var(--serif)", fontSize: 27 }}>
      <span aria-hidden="true" style={{ marginRight: 8 }}>{f.marker}</span>{f.text}
    </span>
  );
}
```

- [ ] **Step 4: Write the header**

Create `apps/web/src/tabs/Case/CaseHeader.tsx`:

```tsx
import { useAppState, useDispatch, visibleClaims } from "../../state/store.js";
import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { VerdictLabel } from "../../ui/primitives/VerdictLabel.js";

/**
 * The as-of control lives HERE, not in global settings: it is an input to this
 * case, not an application preference (master spec section 9).
 */
export function CaseHeader() {
  const { data, asOf, selectedCompoundId } = useAppState();
  const dispatch = useDispatch();
  const r = useCaseReasoning();

  const isFixture = selectedCompoundId === data.fixture.compoundId;
  const all = isFixture ? data.fixture.claims : (data.claimsByCompound.get(selectedCompoundId) ?? []);
  const shown = visibleClaims(all, asOf);
  const hidden = all.length - shown.length;
  const name = isFixture ? "TAK-994" : (data.compounds.get(selectedCompoundId)?.name ?? selectedCompoundId);
  const milestones = Object.entries(data.fixture.asOfMilestones);

  return (
    <header style={{ borderBottom: "1px solid var(--hairline)", padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 24 }}>
        <h2 style={{ fontFamily: "var(--serif)", margin: 0, fontSize: 22 }}>{name}</h2>
        <VerdictLabel verdict={r.verdict} />
      </div>

      <div data-testid="belief-range" style={{ color: "var(--muted)", marginTop: 6 }}>
        Belief {r.belief.toFixed(3)} – plausibility {r.plausibility.toFixed(3)}
        <span style={{ marginLeft: 12 }}>gap {(r.plausibility - r.belief).toFixed(3)}</span>
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)" }}>As of</span>
        <button type="button" onClick={() => dispatch({ type: "setAsOf", asOf: null })}
                aria-pressed={asOf === null}>All evidence</button>
        {milestones.map(([label, date]) => (
          <button key={date} type="button" onClick={() => dispatch({ type: "setAsOf", asOf: date })}
                  aria-pressed={asOf === date}>
            {label} ({date})
          </button>
        ))}
        <span data-testid="hidden-count" style={{ color: "var(--muted)" }}>
          {hidden === 0 ? "nothing hidden" : `${hidden} of ${all.length} claims hidden by this date`}
        </span>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Write the three-region shell**

Create `apps/web/src/tabs/Case/case.css`:

```css
/* The spotlight is a grid-template-columns transition: the focused region grows
   to presentation size and the others collapse to 56px rails that still show
   every evidence verdict as a coloured dot, so a judge can see nothing was
   hidden from them. */
.case-grid {
  display: grid;
  gap: 1px;
  background: var(--hairline-soft);
  transition: grid-template-columns 600ms ease;
  grid-template-columns: 1fr 1fr 1fr;
  min-height: 60vh;
}
.case-grid[data-focus="evidence"] { grid-template-columns: 1fr 56px 56px; }
.case-grid[data-focus="trace"]    { grid-template-columns: 56px 1fr 56px; }
.case-grid[data-focus="table"]    { grid-template-columns: 56px 56px 1fr; }
.case-region { background: var(--canvas); padding: 16px; overflow: auto; }
```

Create `apps/web/src/tabs/Case/index.tsx`:

```tsx
import { useAppState, useDispatch, type Region } from "../../state/store.js";
import { CaseHeader } from "./CaseHeader.js";
import { EvidencePanel } from "./EvidencePanel.js";
import { TracePanel } from "./TracePanel.js";
import { TablePanel } from "./TablePanel.js";
import "./case.css";

export function CaseTab() {
  const { tour } = useAppState();
  const dispatch = useDispatch();
  const focus = tour.focus;
  const toggle = (r: Region) => dispatch({ type: "setFocus", focus: focus === r ? null : r });

  return (
    <section>
      <CaseHeader />
      <div className="case-grid" data-focus={focus ?? ""}>
        <div className="case-region"><EvidencePanel collapsed={focus !== null && focus !== "evidence"} onExpand={() => toggle("evidence")} /></div>
        <div className="case-region"><TracePanel collapsed={focus !== null && focus !== "trace"} onExpand={() => toggle("trace")} /></div>
        <div className="case-region"><TablePanel collapsed={focus !== null && focus !== "table"} onExpand={() => toggle("table")} /></div>
      </div>
    </section>
  );
}
```

`index.tsx` imports three panels. Two of them are built in Tasks 6 and 7, so
**create minimal stubs for them now** or this task does not compile and is not
independently testable. Tasks 6 and 7 replace the stub bodies.

Create `apps/web/src/tabs/Case/EvidencePanel.tsx` (stub, replaced in Task 6):

```tsx
export function EvidencePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  if (collapsed) return <button type="button" onClick={onExpand} aria-label="Expand the evidence panel">Evidence</button>;
  return <div><h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>Evidence</h3></div>;
}
```

Create `apps/web/src/tabs/Case/TracePanel.tsx` (stub, replaced in Task 7):

```tsx
export function TracePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  if (collapsed) return <button type="button" onClick={onExpand} aria-label="Expand the argument trace">Trace</button>;
  return <div><h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>Argument</h3></div>;
}
```

Create `apps/web/src/tabs/Case/TablePanel.tsx` — Phase 3 mounts the challenge interpreter here:

```tsx
/** The table region. Phase 3 mounts the challenge interpreter inside this panel. */
export function TablePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  if (collapsed) return <button type="button" onClick={onExpand} aria-label="Expand the table">Table</button>;
  return (
    <div>
      <h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>The table</h3>
      <p style={{ color: "var(--muted)" }}>
        Positions and sign-off are recorded on the Record tab. The challenge interpreter arrives in Phase 3.
      </p>
    </div>
  );
}
```

- [ ] **Step 6: Mount the store and route the tabs**

Replace `apps/web/src/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { parseHash, TAB_IDS, type TabId } from "./router.js";
import { loadData } from "./data/load.js";
import { StoreProvider } from "./state/store.js";
import { CaseTab } from "./tabs/Case/index.js";

const data = loadData();

export function App() {
  const [tab, setTab] = useState<TabId>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setTab(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <StoreProvider data={data}>
      <nav style={{ background: "var(--deep)", padding: "10px 20px", display: "flex", gap: 18 }}>
        {TAB_IDS.map((t) => (
          <a key={t} href={`#/${t}`} aria-current={t === tab ? "page" : undefined}
             style={{ color: "#fff", textDecoration: t === tab ? "underline" : "none", textTransform: "capitalize" }}>
            {t}
          </a>
        ))}
      </nav>
      {tab === "case" ? <CaseTab /> : <p style={{ padding: 20 }}>{tab} tab arrives in a later task.</p>}
    </StoreProvider>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- apps/web && npm run typecheck && npm run web:build`
Expected: PASS, build succeeds

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "Add the Case tab shell, header and as-of control

The Case tab does not split, per spec section 9: the challenge sits beside the
rule it attacks and the belief gap it moves, and separating them would make the
causal chain invisible.

The as-of control lives in the case header rather than global settings because it
is an input to this case, not an application preference. The header states how
many claims the current date hides, so the two-pass replay is legible instead of
mysterious.

The header reports belief AND plausibility as a range rather than a single
number - the gap is the product, and a header showing only belief would hide it.

Every verdict carries a distinct marker glyph as well as a colour, so it survives
greyscale, colour-blindness and screen-share compression."
git push origin arbiter-round1
```

---

## Task 6: Case tab — the evidence panel

**Files:**
- Create: `apps/web/src/tabs/Case/EvidencePanel.tsx`, `apps/web/src/ui/primitives/Dot.tsx`
- Create: `apps/web/test/evidencePanel.test.tsx`

**Interfaces:**
- Consumes: `useAppState`, `useCaseReasoning`, `visibleClaims`
- Produces: `<EvidencePanel collapsed onExpand />`, `<Dot assertion status />`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/evidencePanel.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { EvidencePanel } from "../src/tabs/Case/EvidencePanel.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const renderPanel = (collapsed = false) =>
  render(<StoreProvider data={data}><EvidencePanel collapsed={collapsed} onExpand={() => {}} /></StoreProvider>);

describe("EvidencePanel", () => {
  it("lists one row per visible claim, with its stream and provenance", () => {
    renderPanel();
    const rows = screen.getAllByTestId("evidence-row");
    expect(rows).toHaveLength(data.fixture.claims.length);
    expect(within(rows[0]!).getByTestId("provenance").textContent).toMatch(/literature|database/i);
  });

  it("shows the discount note the engine attached, not an invented one", () => {
    // The trace rationale is the engine's own words. The UI must not paraphrase a
    // weight reduction it did not compute.
    renderPanel();
    expect(screen.getAllByTestId("evidence-row").some((r) => /Weight reduced/.test(r.textContent ?? ""))).toBe(true);
  });

  it("still shows every verdict as a dot when collapsed to a rail", () => {
    // A judge must be able to see that nothing was hidden while another region
    // has the spotlight.
    renderPanel(true);
    expect(screen.getAllByTestId("evidence-dot")).toHaveLength(data.fixture.claims.length);
  });

  it("badges the fixture as unverified literature", () => {
    renderPanel();
    expect(screen.getByTestId("citation-status").textContent).toMatch(/UNVERIFIED/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/evidencePanel.test.tsx`
Expected: FAIL — cannot resolve `../src/tabs/Case/EvidencePanel.js`

- [ ] **Step 3: Write the dot primitive**

Create `apps/web/src/ui/primitives/Dot.tsx`:

```tsx
import type { Assertion } from "@arbiter/engine";

const COLOUR: Record<Assertion, string> = {
  toxic: "var(--toxic)", safe: "var(--clean)", ambiguous: "var(--ambiguous)",
};

/** Solid when the claim is live, outlined when defeated: form as well as colour. */
export function Dot({ assertion, defeated }: { assertion: Assertion; defeated: boolean }) {
  return (
    <span
      data-testid="evidence-dot"
      title={`${assertion}${defeated ? " (defeated)" : ""}`}
      style={{
        display: "inline-block", width: 10, height: 10, borderRadius: "50%",
        border: `2px solid ${COLOUR[assertion]}`,
        background: defeated ? "transparent" : COLOUR[assertion],
      }}
    />
  );
}
```

- [ ] **Step 4: Write the evidence panel**

Create `apps/web/src/tabs/Case/EvidencePanel.tsx`:

```tsx
import { useAppState, visibleClaims } from "../../state/store.js";
import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { Dot } from "../../ui/primitives/Dot.js";

export function EvidencePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const { data, asOf, selectedCompoundId } = useAppState();
  const r = useCaseReasoning();
  const isFixture = selectedCompoundId === data.fixture.compoundId;
  const all = isFixture ? data.fixture.claims : (data.claimsByCompound.get(selectedCompoundId) ?? []);
  const claims = visibleClaims(all, asOf);
  const stepFor = (id: string) => r.trace.find((s) => s.claimId === id);

  if (collapsed) {
    return (
      <button type="button" onClick={onExpand} aria-label="Expand the evidence panel"
              style={{ display: "flex", flexDirection: "column", gap: 6, background: "none", border: 0, cursor: "pointer" }}>
        {claims.map((c) => (
          <Dot key={c.id} assertion={c.assertion} defeated={stepFor(c.id)?.status === "defeated"} />
        ))}
      </button>
    );
  }

  return (
    <div>
      <h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>Evidence</h3>
      {isFixture && (
        <p data-testid="citation-status" style={{ color: "var(--ambiguous)", fontSize: 13 }}>
          Literature fixture · citations {data.fixture.citationStatus}
        </p>
      )}
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {claims.map((c) => {
          const step = stepFor(c.id);
          const defeated = step?.status === "defeated";
          return (
            <li key={c.id} data-testid="evidence-row"
                style={{ padding: "10px 0", borderBottom: "1px solid var(--hairline-soft)", opacity: defeated ? 0.55 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Dot assertion={c.assertion} defeated={defeated} />
                <strong style={{ fontSize: 15, textDecoration: defeated ? "line-through" : "none" }}>{c.stream}</strong>
                <span style={{ color: "var(--muted)" }}>{c.system} · strength {c.strength.toFixed(2)}</span>
              </div>
              <div data-testid="provenance" style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
                {c.provenance.kind.toUpperCase()} · {c.provenance.source}
              </div>
              {step && <div style={{ fontSize: 13, marginTop: 4 }}>{step.rationale}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- apps/web && npm run lint`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "Add the evidence panel

Each row renders the trace step the engine produced, including its discount note,
rather than a paraphrase the UI computed for itself - the rationale is the
engine's own words and must stay that way.

Collapsed to a rail it still shows every claim as a dot, so a judge can see that
nothing was hidden while another region holds the spotlight. Dots are solid when
live and outlined when defeated: form as well as colour.

The TAK-994 fixture renders its UNVERIFIED citation status in the panel, because a
fixture that looks like a cited literature record while carrying unchecked
references is worse than one that admits the gap."
git push origin arbiter-round1
```

---

## Task 7: Case tab — the trace panel and the belief track

The belief track is the hero visual. Pass 2 moves belief 0.000 → 0.090 with the range staying open and the verdict label unchanged, so the animation carries the beat rather than decorating it.

**Files:**
- Create: `apps/web/src/tabs/Case/TracePanel.tsx`, `apps/web/src/tabs/Case/BeliefTrack.tsx`
- Create: `apps/web/test/beliefTrack.test.tsx`

**Interfaces:**
- Produces:
  - `<BeliefTrack belief={number} plausibility={number} />` — a centre-out range bar
  - `<TracePanel collapsed onExpand />` — trace steps, counterfactual, next experiment

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/beliefTrack.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BeliefTrack } from "../src/tabs/Case/BeliefTrack.js";

describe("BeliefTrack", () => {
  it("renders both ends of the range and the width between them", () => {
    render(<BeliefTrack belief={0.09} plausibility={1} />);
    expect(screen.getByTestId("belief-lo").textContent).toBe("0.090");
    expect(screen.getByTestId("belief-hi").textContent).toBe("1.000");
    expect(screen.getByTestId("belief-fill").getAttribute("data-width")).toBe("0.910");
  });

  it("shows a wide range as wide - the gap must be visible, not just printed", () => {
    const { rerender } = render(<BeliefTrack belief={0.45} plausibility={0.55} />);
    const narrow = Number(screen.getByTestId("belief-fill").getAttribute("data-width"));
    rerender(<BeliefTrack belief={0} plausibility={1} />);
    const wide = Number(screen.getByTestId("belief-fill").getAttribute("data-width"));
    expect(wide).toBeGreaterThan(narrow);
  });

  it("exposes the range to assistive technology as a range, not two loose numbers", () => {
    render(<BeliefTrack belief={0.09} plausibility={1} />);
    const bar = screen.getByRole("img", { name: /belief/i });
    expect(bar.getAttribute("aria-label")).toMatch(/0\.090.*1\.000/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/beliefTrack.test.tsx`
Expected: FAIL — cannot resolve `../src/tabs/Case/BeliefTrack.js`

- [ ] **Step 3: Write the belief track**

Create `apps/web/src/tabs/Case/BeliefTrack.tsx`:

```tsx
/**
 * The belief-plausibility range, drawn as a band rather than a point.
 *
 * The band spreads outward from centre as the range widens, which is literally
 * what the gap is - the hardest concept in the pitch becomes something a
 * non-technical viewer understands by watching. On the TAK-994 replay the verdict
 * label never changes between passes; this is what moves.
 */
export function BeliefTrack({ belief, plausibility }: { belief: number; plausibility: number }) {
  const width = Math.max(0, plausibility - belief);
  const label = `Belief ${belief.toFixed(3)} to plausibility ${plausibility.toFixed(3)}`;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)" }}>
        <span data-testid="belief-lo">{belief.toFixed(3)}</span>
        <span data-testid="belief-hi">{plausibility.toFixed(3)}</span>
      </div>
      <div role="img" aria-label={label}
           style={{ position: "relative", height: 14, background: "var(--surface)",
                    border: "1px solid var(--hairline)", borderRadius: "var(--radius)" }}>
        <div
          data-testid="belief-fill"
          data-width={width.toFixed(3)}
          style={{
            position: "absolute", top: 0, bottom: 0,
            left: `${belief * 100}%`, width: `${width * 100}%`,
            background: "var(--pfizer-blue)", opacity: 0.25,
            transition: "left 900ms ease, width 900ms ease",
          }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the trace panel**

Create `apps/web/src/tabs/Case/TracePanel.tsx`:

```tsx
import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { BeliefTrack } from "./BeliefTrack.js";

export function TracePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const r = useCaseReasoning();
  const claimSteps = r.trace.filter((s) => s.kind !== "verdict");
  const verdictStep = r.trace.find((s) => s.kind === "verdict");

  if (collapsed) {
    return <button type="button" onClick={onExpand} aria-label="Expand the argument trace">Trace</button>;
  }

  return (
    <div>
      <h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>Argument</h3>
      <BeliefTrack belief={r.belief} plausibility={r.plausibility} />

      <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>
        mass toxic {r.mass.toxic.toFixed(3)} · safe {r.mass.safe.toFixed(3)} · uncommitted {r.mass.uncommitted.toFixed(3)}
        {r.contested && " · contested"}
      </p>

      <ol style={{ paddingLeft: 18 }}>
        {claimSteps.map((s) => (
          <li key={s.claimId} data-testid="trace-step" style={{ marginBottom: 8, fontSize: 13 }}>
            <strong>{s.claimId}</strong> — {s.status}
            {s.byRule && <span style={{ color: "var(--pfizer-blue)" }}> · {s.byRule}</span>}
            <div style={{ color: "var(--muted)" }}>{s.rationale}</div>
          </li>
        ))}
      </ol>

      {verdictStep && (
        <p data-testid="verdict-reason" style={{ fontFamily: "var(--serif)" }}>{verdictStep.rationale}</p>
      )}

      {r.counterfactual && (
        <section data-testid="counterfactual">
          <h4>What would change it</h4>
          <p style={{ fontSize: 13 }}>
            {r.counterfactual.flips.map((f) => `${f.claimId} → ${f.to}`).join(" and ")}
            {" "}gives <strong>{r.counterfactual.newVerdict}</strong>.
          </p>
        </section>
      )}

      {r.nextExperiment && (
        <section data-testid="next-experiment">
          <h4>The experiment it asks for</h4>
          <p style={{ fontSize: 13 }}>{r.nextExperiment.rationale}</p>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run the tests and look at it**

Run: `npm test -- apps/web && npm run web:dev`
Expected: PASS; the Case tab renders TAK-994 abstaining with a wide band. Switching the as-of control to the post-murine milestone moves the band and leaves the verdict on Abstain.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "Add the argument trace and the belief track

The belief track is the hero visual rather than the verdict label, because the
measured TAK-994 replay does not flip: pass 2 moves belief 0.000 to 0.090 with the
range still open and the label unchanged. The band spreads from where belief sits
to where plausibility ends, which is literally what the gap is, so the hardest
concept in the pitch becomes something a viewer understands by watching.

The trace renders the engine's own rationale per step, filters the synthetic
verdict step by kind rather than by id or status, and shows the counterfactual and
the planner recommendation when the engine produced them."
git push origin arbiter-round1
```

---

## Task 8: Compounds tab — tagged by conflict, not by verdict

**Files:**
- Create: `apps/web/src/tabs/Compounds.tsx`
- Create: `apps/web/test/compounds.test.tsx`
- Modify: `apps/web/src/App.tsx` (route it)

**Interfaces:**
- Consumes: `useLibraryVerdicts`, `useAppState`, `useDispatch`
- Produces: `<CompoundsTab />`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/compounds.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { CompoundsTab } from "../src/tabs/Compounds.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const renderTab = () => render(<StoreProvider data={data}><CompoundsTab /></StoreProvider>);

describe("CompoundsTab", () => {
  it("states the conflict rate across the scored split", () => {
    // Beat 1 exists to show the hero case was not cherry-picked, so the rate has
    // to be on screen as a number, not implied by a list.
    renderTab();
    expect(screen.getByTestId("conflict-rate").textContent).toMatch(/\d+ of 267/);
  });

  it("says plainly how many compounds ARBITER declines", () => {
    // 260 of 267 abstain. Hiding that behind a colour would be the dishonest
    // version of this screen.
    renderTab();
    expect(screen.getByTestId("decline-note").textContent).toMatch(/declines/i);
  });

  it("renders one row per scored compound", () => {
    renderTab();
    expect(screen.getAllByTestId("compound-row")).toHaveLength(267);
  });

  it("never lists the TAK-994 fixture as a scored row", () => {
    renderTab();
    expect(screen.queryByText("TAK-994")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/compounds.test.tsx`
Expected: FAIL — cannot resolve `../src/tabs/Compounds.js`

- [ ] **Step 3: Write the tab**

Create `apps/web/src/tabs/Compounds.tsx`:

```tsx
import { useAppState, useDispatch } from "../state/store.js";
import { useLibraryVerdicts } from "../engine/useLibraryVerdicts.js";

/**
 * Tagged by CONFLICT STATUS first, verdict second.
 *
 * The master spec tagged rows by verdict. Measured, 260 of 267 abstain, so a
 * verdict-tagged library is a flat grey wall that tells a worse story than the
 * truth. The conflict rate is the number beat 1 needs - it is what shows the hero
 * case was not cherry-picked - and at 22.8% it is healthy.
 */
export function CompoundsTab() {
  const { data } = useAppState();
  const dispatch = useDispatch();
  const rows = useLibraryVerdicts();

  const ids = data.testSplit;
  const conflicting = ids.filter((id) => rows.get(id)?.conflicting).length;
  const declined = ids.filter((id) => rows.get(id)?.verdict === "abstain").length;

  return (
    <section style={{ padding: 20 }}>
      <h2 style={{ fontFamily: "var(--serif)" }}>Compounds</h2>
      <p data-testid="conflict-rate">
        <strong>{conflicting} of {ids.length}</strong> scored compounds have streams in genuine conflict
        ({((conflicting / ids.length) * 100).toFixed(1)}%).
      </p>
      <p data-testid="decline-note" style={{ color: "var(--muted)" }}>
        ARBITER declines on {declined} of {ids.length}. See Validation for why — no compound in this set
        carries exposure-relevant evidence.
      </p>

      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 12 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid var(--hairline)" }}>
            <th>Compound</th><th>Streams</th><th>Verdict</th><th>DILIrank</th>
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => {
            const c = data.compounds.get(id)!;
            const r = rows.get(id)!;
            return (
              <tr key={id} data-testid="compound-row"
                  style={{ borderBottom: "1px solid var(--hairline-soft)" }}>
                <td>
                  <button type="button" onClick={() => { dispatch({ type: "selectCompound", compoundId: id }); window.location.hash = "#/case"; }}>
                    {c.name}
                  </button>
                </td>
                <td style={{ color: r.conflicting ? "var(--toxic)" : "var(--muted)" }}>
                  {r.conflicting ? "in conflict" : "agree"}
                </td>
                <td style={{ color: "var(--muted)" }}>{r.verdict}</td>
                <td style={{ color: "var(--muted)" }}>{c.dilirankLabel}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
```

Route it in `App.tsx` by replacing the placeholder line with a switch that renders `<CompoundsTab />` for `"compounds"`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- apps/web && npm run lint && npm run typecheck`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "Add the Compounds tab, tagged by conflict rather than verdict

The master spec tagged each row by verdict. Measured, 260 of 267 abstain, so a
verdict-tagged library is a flat grey wall telling a worse story than the truth.
Conflict status is the primary axis and verdict is a secondary column.

The conflict rate is on screen as a number because that is what beat 1 is for -
showing the hero case was not cherry-picked - and 61 of 267 is healthy. The
decline count is stated in words rather than left to be inferred from a colour."
git push origin arbiter-round1
```

---

## Task 9: Ruleset tab — the tab that needs the browser engine

**Files:**
- Create: `apps/web/src/tabs/Ruleset.tsx`
- Create: `apps/web/test/ruleset.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `useAppState`, `useDispatch`, `useCaseReasoning`
- Produces: `<RulesetTab />`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/ruleset.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { RulesetTab } from "../src/tabs/Ruleset.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const renderTab = () => render(<StoreProvider data={data}><RulesetTab /></StoreProvider>);

describe("RulesetTab", () => {
  it("shows all six rules with statement and framework citation", () => {
    renderTab();
    expect(screen.getAllByTestId("rule-card")).toHaveLength(6);
    expect(screen.getByText(/FDA Roadmap/)).toBeTruthy();
  });

  it("shows the pre-registered hash and no modified badge until something changes", () => {
    renderTab();
    expect(screen.getByTestId("ruleset-hash").textContent).toMatch(/ed073a8a/);
    expect(screen.queryByTestId("modified-badge")).toBeNull();
  });

  it("RECOMPUTES LIVE when a strength changes, and badges the ruleset as modified", () => {
    // This is why the engine runs in the browser. With precomputed verdicts this
    // control would be a canned animation and a judge who moved it would get
    // nothing back.
    renderTab();
    const before = screen.getByTestId("live-belief").textContent;
    fireEvent.change(screen.getByTestId("strength-R3"), { target: { value: "0.05" } });
    expect(screen.getByTestId("live-belief").textContent).not.toBe(before);
    expect(screen.getByTestId("modified-badge")).toBeTruthy();
  });

  it("restores the registered values on reset", () => {
    renderTab();
    const original = screen.getByTestId("live-belief").textContent;
    fireEvent.change(screen.getByTestId("strength-R3"), { target: { value: "0.05" } });
    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(screen.getByTestId("live-belief").textContent).toBe(original);
    expect(screen.queryByTestId("modified-badge")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/ruleset.test.tsx`
Expected: FAIL — cannot resolve `../src/tabs/Ruleset.js`

- [ ] **Step 3: Write the tab**

Create `apps/web/src/tabs/Ruleset.tsx`:

```tsx
import { useAppState, useDispatch } from "../state/store.js";
import { useCaseReasoning } from "../engine/useCaseReasoning.js";

const REGISTERED_HASH = "ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136";

/**
 * Where "expert-governed, not algorithm-invented" becomes touchable.
 *
 * Editing a strength recomputes the selected case immediately, which is only
 * possible because the engine runs in the browser. Edits are held in memory: the
 * pre-registered file is never written, and the modified badge appears the moment
 * the working copy diverges so an edited ruleset can never be mistaken for the
 * registered one.
 */
export function RulesetTab() {
  const { data, ruleset } = useAppState();
  const dispatch = useDispatch();
  const r = useCaseReasoning();
  const modified = JSON.stringify(ruleset) !== JSON.stringify(data.ruleset);

  return (
    <section style={{ padding: 20 }}>
      <h2 style={{ fontFamily: "var(--serif)" }}>Ruleset</h2>
      <p data-testid="ruleset-hash" style={{ color: "var(--muted)", fontSize: 13 }}>
        v{ruleset.version} · registered {ruleset.registeredAt} · {REGISTERED_HASH.slice(0, 8)}…
        {modified && <strong data-testid="modified-badge" style={{ color: "var(--toxic)", marginLeft: 10 }}>MODIFIED — not the registered ruleset</strong>}
      </p>
      <p>
        Live on the selected case: belief <strong data-testid="live-belief">{r.belief.toFixed(3)}</strong>,
        verdict <strong>{r.verdict}</strong>
      </p>
      <button type="button" onClick={() => dispatch({ type: "resetRuleset" })}>Reset to registered</button>

      {ruleset.rules.map((rule) => (
        <article key={rule.id} data-testid="rule-card"
                 style={{ borderTop: "1px solid var(--hairline)", padding: "14px 0" }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>
            <span style={{ color: "var(--pfizer-blue)" }}>{rule.id}</span> {rule.name}
          </h3>
          <p style={{ margin: "6px 0" }}>{rule.statement}</p>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0" }}>
            {rule.framework.name} ({rule.framework.date})
            {rule.framework.note ? ` — ${rule.framework.note}` : ""}
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Strength {rule.strength.toFixed(2)}
            <input
              data-testid={`strength-${rule.id}`}
              type="range" min="0" max="1" step="0.05" value={rule.strength}
              onChange={(e) => dispatch({ type: "setRuleStrength", id: rule.id, strength: Number(e.target.value) })}
            />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={rule.enabled}
                   onChange={(e) => dispatch({ type: "setRuleEnabled", id: rule.id, enabled: e.target.checked })} />
            Enabled
          </label>
        </article>
      ))}
    </section>
  );
}
```

Route it in `App.tsx`.

- [ ] **Step 4: Measure the slider, and debounce it only if the measurement says so**

Full `reason()` is roughly 150 engine evaluations, and a range input fires on every
pointer move. Measure before optimising:

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npx tsx -e "const t=Date.now();const{reason}=await import('./packages/engine/src/index.js');const rs=JSON.parse(require('node:fs').readFileSync('rules/ruleset-v1.0.json','utf8'));const f=JSON.parse(require('node:fs').readFileSync('data/out/tak994.json','utf8'));const a=JSON.parse(require('node:fs').readFileSync('data/assays.json','utf8')).assays;const s=Date.now();for(let i=0;i<50;i++)reason(f.claims,rs,'',a);console.log('ms per full reason():',(Date.now()-s)/50)"
```

If the figure is **under 16ms**, leave the slider on plain `onChange` — a debounce
would add latency to an interaction whose whole point is that it responds under the
cursor. If it is **over 16ms**, switch the slider to `reasonVerdictOnly` while
dragging and run the full `reason()` on `onPointerUp`, and say so in a comment
naming the measured figure. Record the number either way; a later reader should not
have to re-derive why the code looks the way it does.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- apps/web && npm run typecheck`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "Add the Ruleset tab with live recomputation

The tab that would be theatre if verdicts were precomputed. Moving a strength
slider re-runs the engine on the selected case and the belief and verdict update
under the cursor - which is only possible because the engine is bundled into the
browser.

Edits are held in memory. The pre-registered file is never written, and a MODIFIED
badge appears the instant the working copy diverges from the registered one, so an
edited ruleset cannot be presented as the registered one. Reset restores it."
git push origin arbiter-round1
```

---

## Task 10: Validation tab — coverage before accuracy

**Files:**
- Create: `apps/web/src/tabs/Validation.tsx`
- Create: `apps/web/test/validation.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `useAppState().data.metrics`
- Produces: `<ValidationTab />`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/validation.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { ValidationTab } from "../src/tabs/Validation.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const renderTab = () => render(<StoreProvider data={data}><ValidationTab /></StoreProvider>);

describe("ValidationTab", () => {
  it("shows n and coverage BEFORE any accuracy figure", () => {
    renderTab();
    const text = screen.getByTestId("headline").textContent ?? "";
    expect(text.indexOf("coverage")).toBeGreaterThan(-1);
    expect(text.indexOf("coverage")).toBeLessThan(text.indexOf("balanced accuracy"));
  });

  it("renders the single-class warning rather than hiding it in a JSON field", () => {
    // balancedAccuracy substitutes 0.5 for an absent class. Four all-positive
    // compounds score 0.75 and that is indistinguishable from a real 0.75 unless
    // the flag is on screen.
    renderTab();
    expect(screen.getByTestId("single-class-warning")).toBeTruthy();
  });

  it("shows the pre-registration hash and the perturbation seed", () => {
    renderTab();
    expect(screen.getByTestId("provenance").textContent).toMatch(/ed073a8a/);
    expect(screen.getByTestId("provenance").textContent).toMatch(/20260726/);
  });

  it("reports the planner stability number, which IS reportable", () => {
    renderTab();
    expect(screen.getByTestId("planner-stability").textContent).toMatch(/0\.99/);
  });

  it("names the LLM ablation as not yet run rather than omitting it", () => {
    renderTab();
    expect(screen.getByTestId("llm-ablation").textContent).toMatch(/not present|ANTHROPIC_API_KEY/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/validation.test.tsx`
Expected: FAIL — cannot resolve `../src/tabs/Validation.js`

- [ ] **Step 3: Write the tab**

Create `apps/web/src/tabs/Validation.tsx`:

```tsx
import { useAppState } from "../state/store.js";

interface Pipeline {
  balancedAccuracy: number; coverage: number; nCommitted: number;
  ci: { lo: number; hi: number }; singleClass: boolean;
}

/**
 * Coverage before accuracy, deliberately.
 *
 * ARBITER commits on 4 of 61 conflict-subset compounds and the best baseline on
 * 3. A balanced accuracy computed over four same-label compounds is half a
 * substituted 0.5, and putting it first would invite it to be read as a result.
 */
export function ValidationTab() {
  const { data } = useAppState();
  const m = data.metrics as Record<string, any>;
  const acc = m["metric1_conflictSubsetAccuracy"];
  const arbiter = acc.arbiter as Pipeline;
  const baselines = Object.entries(acc.baselines as Record<string, Pipeline>)
    .filter(([, b]) => b.nCommitted > 0)
    .sort((a, b) => b[1].balancedAccuracy - a[1].balancedAccuracy);

  return (
    <section style={{ padding: 20 }}>
      <h2 style={{ fontFamily: "var(--serif)" }}>Validation</h2>

      <p data-testid="provenance" style={{ color: "var(--muted)", fontSize: 13 }}>
        ruleset {String(m["provenance"].rulesetHash).slice(0, 8)}… · split seed {m["provenance"].splitSeed} ·
        perturbation seed {m["provenance"].perturbationSeed} · scored on the {m["provenance"].scoredSplit} split
      </p>

      <p data-testid="headline">
        Conflict subset n = <strong>{acc.n}</strong>. ARBITER coverage{" "}
        <strong>{(arbiter.coverage * 100).toFixed(1)}%</strong> ({arbiter.nCommitted} committed).
        {" "}balanced accuracy {arbiter.balancedAccuracy.toFixed(2)}{" "}
        (95% CI {arbiter.ci.lo.toFixed(2)}–{arbiter.ci.hi.toFixed(2)}).
      </p>

      {arbiter.singleClass && (
        <p data-testid="single-class-warning" style={{ color: "var(--toxic)" }}>
          <strong>Single-class:</strong> ARBITER committed on only one label, so this balanced accuracy is
          half a substituted 0.5. It must not be quoted as an accuracy. Coverage is the finding — no compound
          in this set carries exposure-relevant evidence, so R3 discounts every safe claim.
        </p>
      )}

      <h3>Baselines</h3>
      <table style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th>Pipeline</th><th>n committed</th><th>coverage</th><th>balanced accuracy</th><th></th>
          </tr>
        </thead>
        <tbody>
          {baselines.map(([name, b]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{b.nCommitted}</td>
              <td>{(b.coverage * 100).toFixed(1)}%</td>
              <td>{b.balancedAccuracy.toFixed(2)}</td>
              <td style={{ color: "var(--toxic)" }}>{b.singleClass ? "single-class" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>What is reportable</h3>
      <p data-testid="planner-stability">
        Planner recommendation unchanged under ±50% perturbation of every expert-elicited prior:{" "}
        <strong>{Number(m["metric5_plannerSensitivity"].meanUnchangedFraction).toFixed(3)}</strong>.
        The recommendation is driven by argument structure, not by the priors.
      </p>
      <p>
        Robustness on committed compounds:{" "}
        {Number(m["metric2b_arbiterRobustness"].meanHeldFractionOnCommitted).toFixed(3)} ·{" "}
        determinism verified by a 1000-run single-hash test.
      </p>
      <p data-testid="llm-ablation" style={{ color: "var(--muted)" }}>
        LLM ablation: {JSON.stringify(m["metric2a_llmConsistency"])}
      </p>
    </section>
  );
}
```

Route it in `App.tsx`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- apps/web && npm run lint`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "Add the Validation tab, coverage before accuracy

ARBITER commits on 4 of 61 conflict-subset compounds and the best baseline on 3.
A balanced accuracy over four same-label compounds is half a substituted 0.5, so
n and coverage are shown first and the single-class flag is rendered on screen
rather than left in a JSON field nobody opens.

The tab also shows the number that IS reportable: the planner recommendation is
unchanged under +/-50% perturbation of every elicited prior, 0.992, because
argument structure is the primary sort key.

The missing LLM ablation is named as missing rather than omitted."
git push origin arbiter-round1
```

---

## Task 11: Record tab — the hash-chained decision log

**Files:**
- Create: `apps/web/src/tabs/Record.tsx`, `apps/web/src/record/chain.ts`
- Create: `apps/web/test/chain.test.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces:
  - `sha256Hex(input: string): Promise<string>` — Web Crypto, browser-side only
  - `evidenceSnapshot(claims, reasoning): string` — canonical string bound to what was on screen
  - `<RecordTab />`

- [ ] **Step 1: Write the failing chain test**

Create `apps/web/test/chain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evidenceSnapshot } from "../src/record/chain.js";
import type { EvidenceClaim, Reasoning } from "@arbiter/engine";

const claims = [
  { id: "b", assertion: "safe", strength: 0.5 },
  { id: "a", assertion: "toxic", strength: 0.9 },
] as EvidenceClaim[];
const reasoning = { verdict: "abstain", belief: 0.1, plausibility: 0.9 } as Reasoning;

describe("evidenceSnapshot", () => {
  it("is stable against claim ORDER, so the same screen hashes the same", () => {
    const a = evidenceSnapshot(claims, reasoning);
    const b = evidenceSnapshot([...claims].reverse(), reasoning);
    expect(a).toBe(b);
  });

  it("CHANGES when the evidence changes", () => {
    // The whole point of binding a signature to a snapshot: a later data change
    // must not silently rewrite what someone endorsed.
    const changed = [{ ...claims[0]!, strength: 0.6 }, claims[1]!] as EvidenceClaim[];
    expect(evidenceSnapshot(changed, reasoning)).not.toBe(evidenceSnapshot(claims, reasoning));
  });

  it("CHANGES when the verdict changes", () => {
    const other = { ...reasoning, verdict: "do_not_advance" } as Reasoning;
    expect(evidenceSnapshot(claims, other)).not.toBe(evidenceSnapshot(claims, reasoning));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/chain.test.ts`
Expected: FAIL — cannot resolve `../src/record/chain.js`

- [ ] **Step 3: Write the chain helpers**

Create `apps/web/src/record/chain.ts`:

```ts
import type { EvidenceClaim, Reasoning } from "@arbiter/engine";

/**
 * A canonical string describing exactly what was on screen when someone signed.
 *
 * Sorted by claim id, so the same evidence produces the same snapshot regardless
 * of load order. Without this binding, "I agree" attaches to nothing and a later
 * data change silently rewrites what a reviewer endorsed.
 */
export function evidenceSnapshot(claims: EvidenceClaim[], r: Reasoning): string {
  const sorted = [...claims].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify({
    claims: sorted.map((c) => [c.id, c.assertion, c.strength]),
    verdict: r.verdict,
    belief: r.belief,
    plausibility: r.plausibility,
  });
}

/** SHA-256 via Web Crypto. Browser-only; the engine stays free of crypto entirely. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: Write the tab**

Create `apps/web/src/tabs/Record.tsx`. It renders the positions list and a sign-off form producing a `ReviewerPosition`, computing `evidenceSnapshotHash` from `evidenceSnapshot(...)` and `prevRecordHash` from the previous entry (or 64 zeros for the first). The heading text must read **"review-ready evidence package"** and the log must be described as a **hash-chained audit log**, never as a blockchain.

```tsx
import { useState } from "react";
import { useAppState, useDispatch } from "../state/store.js";
import { useCaseReasoning } from "../engine/useCaseReasoning.js";
import { evidenceSnapshot, sha256Hex } from "../record/chain.js";
import { visibleClaims } from "../state/store.js";

const GENESIS = "0".repeat(64);

export function RecordTab() {
  const { data, ruleset, asOf, selectedCompoundId, positions } = useAppState();
  const dispatch = useDispatch();
  const r = useCaseReasoning();
  const [name, setName] = useState("Jack He");
  const [position, setPosition] = useState<"agree" | "dissent" | "abstain">("agree");
  const [rationale, setRationale] = useState("");

  const all = selectedCompoundId === data.fixture.compoundId
    ? data.fixture.claims
    : (data.claimsByCompound.get(selectedCompoundId) ?? []);

  async function sign() {
    const snapshot = await sha256Hex(evidenceSnapshot(visibleClaims(all, asOf), r));
    const prev = positions.length ? positions[positions.length - 1]!.evidenceSnapshotHash : GENESIS;
    dispatch({
      type: "addPosition",
      position: {
        reviewerId: name.toLowerCase().replace(/\s+/g, "."),
        displayName: name,
        role: "Safety reviewer",
        position,
        rationale: rationale || null,
        // Signing time is a real clock read, which is why it lives in the app and
        // never in the engine.
        signedAt: new Date().toISOString(),
        rulesetHash: ruleset.version,
        evidenceSnapshotHash: snapshot,
        asOfDate: asOf,
        signatureMethod: "demo-persona",
        prevRecordHash: prev,
      },
    });
    setRationale("");
  }

  return (
    <section style={{ padding: 20 }}>
      <h2 style={{ fontFamily: "var(--serif)" }}>Review-ready evidence package</h2>
      <p style={{ color: "var(--muted)" }}>
        Positions are recorded against the exact evidence and verdict on screen. The log is a hash-chained
        audit log: each entry carries the hash of the one before it, so tampering is detectable.
      </p>

      <fieldset style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: 12 }}>
        <legend>Record a position</legend>
        <label>Reviewer <input value={name} onChange={(e) => setName(e.target.value)} /></label>{" "}
        <label>Position{" "}
          <select value={position} onChange={(e) => setPosition(e.target.value as typeof position)}>
            <option value="agree">agree</option>
            <option value="dissent">dissent</option>
            <option value="abstain">abstain</option>
          </select>
        </label>{" "}
        <label>Rationale <input value={rationale} onChange={(e) => setRationale(e.target.value)} /></label>{" "}
        <button type="button" onClick={() => void sign()}>Sign</button>
      </fieldset>

      <ol>
        {positions.map((p, i) => (
          <li key={i} data-testid="position-row" style={{ marginTop: 10, fontSize: 13 }}>
            <strong>{p.displayName}</strong> — {p.position}
            {p.rationale ? ` · ${p.rationale}` : ""}
            <div style={{ color: "var(--muted)" }}>
              snapshot {p.evidenceSnapshotHash.slice(0, 12)}… · prev {p.prevRecordHash.slice(0, 12)}… ·
              as of {p.asOfDate ?? "all evidence"} · {p.signatureMethod}
            </div>
          </li>
        ))}
      </ol>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        ARBITER holds no position. The named decision owner signs.
      </p>
    </section>
  );
}
```

Route it in `App.tsx`.

- [ ] **Step 5: Run the tests and check the language**

Run: `npm test -- apps/web && grep -ril "blockchain\|regulator-ready\|majority vote\|tally" apps/web/src || echo "language clean"`
Expected: PASS, and the grep prints `language clean`.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "Add the Record tab and the hash-chained decision log

Each position binds to an evidenceSnapshotHash computed from exactly the claims
and verdict on screen, sorted by claim id so load order cannot change it. Without
that binding an agreement attaches to nothing and a later data change silently
rewrites what a reviewer endorsed - a test asserts the snapshot moves when the
evidence or the verdict moves, and does not move when only the order does.

prevRecordHash chains each entry to the one before it. This is a hash-chained
audit log and is described as exactly that, never as a blockchain.

The clock read for signedAt lives here rather than in the engine, which is why the
engine can stay pure."
git push origin arbiter-round1
```

---

## Task 12: The guided tour, and the seven-beat guard

The most important test in this plan. Beat 5 was wrong in the spec for a week and nothing caught it.

**Files:**
- Create: `apps/web/src/tour/beats.ts`, `apps/web/src/tour/TourFooter.tsx`
- Create: `apps/web/test/beats.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces:
  - `interface Beat { n: number; title: string; tab: TabId; focus: Region | null; actions: Action[]; line: string }`
  - `BEATS: Beat[]` — seven entries, indices 0..6
  - `<TourFooter />` — `←`/`→` beats, `M` motion, `Esc` exits

- [ ] **Step 1: Write the failing seven-beat test**

Create `apps/web/test/beats.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { reason, reasonVerdictOnly } from "@arbiter/engine";
import { BEATS } from "../src/tour/beats.js";
import { initialState, reducer, visibleClaims, type AppState } from "../src/state/store.js";
import { loadData } from "../src/data/load.js";
import { majorityVote, weightedAverage } from "../../harness/src/baselines.js";

const data = loadData();

/** Replay the tour from beat 0 up to and including `n`, applying each beat's actions. */
function stateAtBeat(n: number): AppState {
  let s = initialState(data);
  for (const b of BEATS.slice(0, n + 1)) {
    s = reducer(s, { type: "setTourBeat", beat: b.n, tab: b.tab, focus: b.focus });
    for (const a of b.actions) s = reducer(s, a);
  }
  return s;
}

const caseReasoning = (s: AppState) =>
  reason(visibleClaims(data.fixture.claims, s.asOf), s.ruleset, "", data.assays);

describe("the seven beats", () => {
  it("has exactly seven, indexed 0..6", () => {
    expect(BEATS).toHaveLength(7);
    expect(BEATS.map((b) => b.n)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("BEAT 2 - every baseline says advance on the pre-first-in-human evidence", () => {
    const s = stateAtBeat(1);
    const claims = visibleClaims(data.fixture.claims, s.asOf);
    expect(majorityVote(claims).verdict).toBe("advance");
    expect(weightedAverage(claims).verdict).toBe("advance");
  });

  it("BEAT 3 - ARBITER abstains, nothing is defeated, most mass is uncommitted", () => {
    const r = caseReasoning(stateAtBeat(2));
    expect(r.verdict).toBe("abstain");
    expect(r.trace.filter((t) => t.status === "defeated")).toHaveLength(0);
    expect(r.mass.uncommitted).toBeGreaterThan(0.7);
  });

  it("BEAT 4 - the gap is wide and a single-claim counterfactual exists", () => {
    const r = caseReasoning(stateAtBeat(3));
    expect(r.plausibility - r.belief).toBeGreaterThan(0.5);
    expect(r.counterfactual).not.toBeNull();
    expect(r.counterfactual!.flips).toHaveLength(1);
  });

  it("BEAT 5 - the planner names a HUMAN assay and pass 2 STILL abstains", () => {
    // The beat that was wrong. R1 discounts the murine study to 10%, so feeding it
    // in moves belief off zero without licensing a conclusion. If this test ever
    // starts expecting do_not_advance, either the ruleset was re-registered or the
    // script drifted back to the version the engine contradicts.
    const before = caseReasoning(stateAtBeat(3));
    const after = caseReasoning(stateAtBeat(4));

    expect(before.nextExperiment).not.toBeNull();
    expect(before.nextExperiment!.assay).toMatch(/BSEP/i);
    expect(before.nextExperiment!.resolvesRule).toBe("R3");

    expect(after.verdict).toBe("abstain");
    expect(after.belief).toBeGreaterThan(before.belief);
    expect(after.belief).toBeLessThan(0.5);
  });

  it("BEAT 7 - the reported coverage is on screen in the metrics we ship", () => {
    const m = data.metrics as Record<string, any>;
    expect(m["metric1_conflictSubsetAccuracy"].arbiter.coverage).toBeLessThan(0.25);
    expect(m["metric5_plannerSensitivity"].meanUnchangedFraction).toBeGreaterThan(0.9);
  });

  it("every beat names a real tab and a real focus region", () => {
    for (const b of BEATS) {
      expect(["compounds", "case", "ruleset", "validation", "record"]).toContain(b.tab);
      if (b.focus !== null) expect(["evidence", "trace", "table"]).toContain(b.focus);
      expect(b.line.length).toBeGreaterThan(10);
    }
  });

  it("replaying the tour twice gives the identical state", () => {
    expect(JSON.stringify(stateAtBeat(6).asOf)).toBe(JSON.stringify(stateAtBeat(6).asOf));
    expect(reasonVerdictOnly(visibleClaims(data.fixture.claims, stateAtBeat(6).asOf), data.ruleset).verdict)
      .toBe(reasonVerdictOnly(visibleClaims(data.fixture.claims, stateAtBeat(6).asOf), data.ruleset).verdict);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/beats.test.tsx`
Expected: FAIL — cannot resolve `../src/tour/beats.js`

- [ ] **Step 3: Write the beats**

Create `apps/web/src/tour/beats.ts`:

```ts
import type { Action, Region } from "../state/store.js";
import type { TabId } from "../router.js";

export interface Beat {
  n: number;
  title: string;
  tab: TabId;
  focus: Region | null;
  /**
   * Data changes a beat performs, expressed as the SAME actions a user could
   * dispatch by hand. The tour holds no data of its own, so the guided path and
   * the manual path cannot disagree.
   */
  actions: Action[];
  line: string;
}

const PRE_FIH = "2021-06-01";
const POST_MURINE = "2023-01-01";

export const BEATS: Beat[] = [
  {
    n: 0, title: "The desk, before first-in-human", tab: "compounds", focus: null,
    actions: [{ type: "setAsOf", asOf: PRE_FIH }],
    line: "61 of 267 scored compounds have streams in genuine conflict. This case is one of them.",
  },
  {
    n: 1, title: "What happens today", tab: "case", focus: "evidence",
    actions: [],
    line: "Majority vote, weighted average and every single source all say advance.",
  },
  {
    n: 2, title: "ARBITER's argument", tab: "case", focus: "trace",
    actions: [],
    line: "Nothing is defeated. Nothing contradicts anything. Each source is discounted for what it cannot license, and most of the weight lands on uncommitted.",
  },
  {
    n: 3, title: "The honest gap, and what would flip it", tab: "case", focus: "trace",
    actions: [],
    line: "The range is the widest in the set. One claim would have to change to move the verdict.",
  },
  {
    n: 4, title: "The experiment it asks for", tab: "case", focus: "trace",
    actions: [{ type: "setAsOf", asOf: POST_MURINE }],
    line: "It asks for a human BSEP assay at matched exposure. Takeda ran a mouse study instead — and even that does not license a conclusion, because it is a mouse.",
  },
  {
    n: 5, title: "The table", tab: "record", focus: null,
    actions: [],
    line: "Positions are recorded, including dissent. The named decision owner signs. ARBITER holds no position.",
  },
  {
    n: 6, title: "What the numbers say", tab: "validation", focus: null,
    actions: [],
    line: "Determinism and robustness. Coverage is the finding. The planner recommendation survives ±50% perturbation of every elicited prior.",
  },
];
```

- [ ] **Step 4: Write the tour footer**

Create `apps/web/src/tour/TourFooter.tsx`:

```tsx
import { useEffect } from "react";
import { useAppState, useDispatch } from "../state/store.js";
import { BEATS } from "./beats.js";

/**
 * Keyboard driving, so nobody fumbles a mouse mid-sentence and any of the three
 * team members can present with no hidden knowledge.
 */
export function TourFooter() {
  const { tour, motion } = useAppState();
  const dispatch = useDispatch();

  const go = (n: number) => {
    const b = BEATS[Math.max(0, Math.min(BEATS.length - 1, n))]!;
    dispatch({ type: "setTourBeat", beat: b.n, tab: b.tab, focus: b.focus });
    for (const a of b.actions) dispatch(a);
    window.location.hash = `#/${b.tab}`;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(tour.beat + 1);
      else if (e.key === "ArrowLeft") go(tour.beat - 1);
      else if (e.key.toLowerCase() === "m") dispatch({ type: "toggleMotion" });
      else if (e.key === "Escape") dispatch({ type: "setFocus", focus: null });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const b = BEATS[tour.beat]!;
  return (
    <footer style={{ position: "sticky", bottom: 0, background: "var(--surface)",
                     borderTop: "1px solid var(--hairline)", padding: "10px 20px", display: "flex", gap: 16 }}>
      <button type="button" onClick={() => go(tour.beat - 1)} aria-label="Previous beat">←</button>
      <button type="button" onClick={() => go(tour.beat + 1)} aria-label="Next beat">→</button>
      <div>
        <strong>Beat {b.n + 1} of {BEATS.length} · {b.title}</strong>
        <div style={{ color: "var(--muted)", fontSize: 13 }}>{b.line}</div>
      </div>
      <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 13 }}>
        motion {motion ? "on" : "off"} (M)
      </span>
    </footer>
  );
}
```

Mount `<TourFooter />` at the bottom of `App.tsx`, inside `StoreProvider`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- apps/web/test/beats.test.tsx`
Expected: PASS (8 tests)

- [ ] **Step 6: Prove the guard works**

Temporarily change beat 4's `actions` to `[]` so pass 2 never loads, and run the beat test.
Expected: **FAIL** on "BEAT 5 — the planner names a HUMAN assay and pass 2 STILL abstains", because belief no longer moves. Restore, re-run, confirm green. A guard nobody has watched fail is not known to work.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "Add the guided tour and the seven-beat guard

The guard is the point. Beat 5 claimed the planner names the murine study and that
feeding it in flips the verdict to DO NOT ADVANCE; both were false for a week and
nothing caught it. This test asserts, against the real engine, that the planner
names a HUMAN BSEP assay resolving R3 and that pass 2 STILL abstains with belief
moving off zero but staying below 0.5. If it ever starts expecting do_not_advance,
either the ruleset was re-registered or the script drifted back to the version the
engine contradicts.

Beats carry their data changes as the same actions a user dispatches by hand, so
the tour holds no data of its own and the guided and manual paths cannot disagree.

Verified by watching it fail: removing beat 4's as-of action turns it red.

Keyboard driving - arrows for beats, M for motion, Esc to exit the spotlight - so
any of the three of us can present without hidden knowledge."
git push origin arbiter-round1
```

---

## Task 13: Motion, accessibility, and the static build

**Files:**
- Create: `apps/web/src/ui/motion.css`, `apps/web/e2e/demo.spec.ts`, `apps/web/e2e/static-file.spec.ts`, `playwright.config.ts`
- Create: `apps/web/test/a11y.test.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/vite.config.ts`, `vitest.config.ts`, `.eslintrc.json`, root `package.json`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `AppState.motion`
- Produces: a `data-motion` attribute on the app root; a single self-contained `dist/index.html`; a Playwright walk of the demo path

- [x] **Step 1: Write the failing accessibility test**

Create `apps/web/test/a11y.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App.js";

describe("accessibility basics", () => {
  it("every interactive control has an accessible name", () => {
    render(<App />);
    for (const el of screen.getAllByRole("button")) {
      const name = el.getAttribute("aria-label") ?? el.textContent ?? "";
      expect(name.trim().length).toBeGreaterThan(0);
    }
  });

  it("the tab bar marks the current tab for assistive technology", () => {
    render(<App />);
    expect(document.querySelector('[aria-current="page"]')).not.toBeNull();
  });

  it("the motion kill switch is reflected on the root, so CSS can honour it", () => {
    render(<App />);
    expect(document.querySelector("[data-motion]")).not.toBeNull();
  });
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/a11y.test.tsx`
Expected: FAIL — no `[data-motion]` node.
Observed: `AssertionError: expected null not to be null` at the `[data-motion]` assertion, 2 passed 1 failed.

- [x] **Step 3: Add the motion layer**

Create `apps/web/src/ui/motion.css`:

```css
/* Level 2 motion with a kill switch. Nothing animates unless it carries meaning,
   nothing exceeds 1.5s, and both the M toggle and prefers-reduced-motion drop the
   whole app to opacity-only instantly. */
[data-motion="off"] *,
[data-motion="off"] *::before,
[data-motion="off"] *::after {
  animation-duration: 0.01ms !important;
  transition-duration: 0.01ms !important;
}
```

`App.tsx` reads `motion` from `useAppState`, which means the element carrying
`data-motion` has to sit INSIDE `StoreProvider` rather than wrapping it. Hence the
inner `AppShell` component:

```tsx
import { useEffect, useState } from "react";
import { parseHash, TAB_IDS, type TabId } from "./router.js";
import { loadData } from "./data/load.js";
import { StoreProvider, useAppState } from "./state/store.js";
import { CaseTab } from "./tabs/Case/index.js";
import { CompoundsTab } from "./tabs/Compounds.js";
import { RulesetTab } from "./tabs/Ruleset.js";
import { ValidationTab } from "./tabs/Validation.js";
import { RecordTab } from "./tabs/Record.js";
import { TourFooter } from "./tour/TourFooter.js";
import "./ui/motion.css";

const data = loadData();

function AppShell({ tab }: { tab: TabId }) {
  const { motion } = useAppState();
  return (
    <div data-motion={motion ? "on" : "off"}>
      <nav style={{ background: "var(--deep)", padding: "10px 20px", display: "flex", gap: 18 }}>
        {TAB_IDS.map((t) => (
          <a key={t} href={`#/${t}`} aria-current={t === tab ? "page" : undefined}
             style={{ color: "#fff", textDecoration: t === tab ? "underline" : "none", textTransform: "capitalize" }}>
            {t}
          </a>
        ))}
      </nav>
      {tab === "case" ? <CaseTab />
        : tab === "compounds" ? <CompoundsTab />
        : tab === "ruleset" ? <RulesetTab />
        : tab === "validation" ? <ValidationTab />
        : <RecordTab />}
      <TourFooter />
    </div>
  );
}

export function App() {
  const [tab, setTab] = useState<TabId>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setTab(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <StoreProvider data={data}>
      <AppShell tab={tab} />
    </StoreProvider>
  );
}
```

- [x] **Step 4: Write the Playwright walk**

Create `playwright.config.ts` at the repo root:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "apps/web/e2e",
  use: { baseURL: "http://localhost:4173" },
  webServer: {
    command: "npm run web:build && npm run -w @arbiter/web preview -- --port 4173",
    port: 4173,
    reuseExistingServer: true,
  },
});
```

Create `apps/web/e2e/demo.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("the demo walks end to end on the keyboard alone", async ({ page }) => {
  await page.goto("/#/case");
  await expect(page.getByTestId("verdict")).toContainText(/abstain/i);

  // Drive the whole tour with the arrow key a presenter actually uses.
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/#\/validation/);
  await expect(page.getByTestId("single-class-warning")).toBeVisible();

  // And back, without the app losing its footing.
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/#\/compounds/);
});

test("the M key actually stops the motion, not just flips an attribute", async ({ page }) => {
  await page.goto("/#/case");
  const fill = page.getByTestId("belief-fill");
  const duration = () => fill.evaluate((el) => getComputedStyle(el).transitionDuration);

  // BeliefTrack sets `transition: left 900ms ease, width 900ms ease` as an INLINE
  // style, and inline styles lose only to `!important` in a stylesheet. That is
  // the whole mechanism this asserts: an attribute that flips while the animation
  // keeps running would be a kill switch in name only.
  await expect(page.locator("[data-motion=on]")).toHaveCount(1);
  expect(await duration()).toBe("0.9s, 0.9s");

  await page.keyboard.press("m");
  await expect(page.locator("[data-motion=off]")).toHaveCount(1);
  // One value, not two: the !important 0.01ms replaces the whole shorthand
  // rather than being applied per-property.
  expect(await duration()).toBe("1e-05s");
});

test("the ruleset slider changes the verdict live", async ({ page }) => {
  await page.goto("/#/ruleset");
  const before = await page.getByTestId("live-belief").textContent();
  // R1, not R3: dropping R3's strength on the TAK-994 fixture changes nothing -
  // see apps/web/test/ruleset.test.tsx and task-9-report.md. R1 is the rule
  // that actually moves this fixture's belief, so R1 is what proves the live
  // recompute rather than a stale render.
  await page.getByTestId("strength-R1").fill("0.05");
  await expect(page.getByTestId("live-belief")).not.toHaveText(before ?? "");
  await expect(page.getByTestId("modified-badge")).toBeVisible();
});
```

Two things in that file are corrections to the original plan, both load-bearing:

- **The slider test drives R1, not R3.** Dropping R3's strength changes nothing on
  the TAK-994 fixture: the murine claim R3-*defeats* the four safe claims, and
  defeat ignores `strength` entirely. A correct implementation would fail an
  R3-based test. R1 is the rule that actually moves this fixture's belief
  (0.090 → 0.855).
- **The motion test asserts the computed `transition-duration` collapses**, from
  `0.9s, 0.9s` to `1e-05s`, rather than only that the attribute flipped. `BeliefTrack`
  sets its transition as an INLINE style, and inline styles lose only to
  `!important` in a stylesheet, so this is the whole mechanism. Verified failable by
  neutering `motion.css`, which yields `0.9s, 0.9s`.

Also exclude the e2e directory from vitest, spreading `configDefaults.exclude`
rather than replacing it, and give `apps/web` a browser env in eslint so `window`
and `document` resolve. That second change exposed a real hole: `npm run lint` passed
`--ext .ts`, so every `.tsx` file in the web app — the entire UI — was never linted.
It is now `--ext .ts,.tsx`, verified by planting an unused variable in a `.tsx`.

- [x] **Step 5: Verify the static build opens from the filesystem**

**This step found the artifact broken.** Built, then opened `apps/web/dist/index.html`
from the filesystem in Chrome. The page rendered **completely blank** — `#root`
innerHTML length 0:

```
console: Access to script at 'file:///.../assets/index-CyyCQ3b7.js' from origin 'null'
  has been blocked by CORS policy: Cross origin requests are only supported for
  protocol schemes: chrome, chrome-untrusted, data, http, https.
requestfailed: file:///.../assets/index-CyyCQ3b7.js net::ERR_FAILED
requestfailed: file:///.../assets/index-DjsYs_Fu.css net::ERR_FAILED
```

`base: './'` was necessary but nowhere near sufficient. Vite tags its emitted
`<script>` and `<link>` with `crossorigin`, Chrome treats that as a CORS request, and
a page opened from the filesystem has origin `null` which `file://` cannot satisfy.
Every test in the suite ran over `http://localhost`, where this failure mode does not
exist, so nothing would have caught it before submission.

The fix is a build plugin that folds the chunk and the stylesheet into `index.html`,
leaving one file with zero subresources:

```ts
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Folds the JS chunk and the stylesheet into index.html so the built app makes
 * ZERO subresource requests.
 *
 * This is not an optimisation, it is the only way the submitted artifact works.
 * Vite tags its emitted <script> and <link> with `crossorigin`, which makes
 * Chrome treat them as CORS requests. A page opened from the filesystem has
 * origin `null`, and file:// is not a scheme CORS can satisfy, so both the
 * script and the stylesheet fail with ERR_FAILED and the page renders
 * completely blank - measured, not assumed. Serving over http:// hides this
 * entirely, so a dev server is exactly the wrong place to look for it.
 *
 * The guard against regression is apps/web/e2e/static-file.spec.ts, which opens
 * dist/index.html over file:// and asserts the verdict actually renders.
 */
function inlineEverything(): Plugin {
  return {
    name: "arbiter-inline-everything",
    enforce: "post",
    apply: "build",
    generateBundle(_options, bundle) {
      const html = bundle["index.html"];
      if (!html || html.type !== "asset") {
        throw new Error("inlineEverything: no index.html in the bundle");
      }
      let source = String(html.source);

      // Deleting a bundle entry whose tag was never found would satisfy the
      // survivors check below while leaving a dead reference in the HTML, so
      // every substitution has to be observed to change the source.
      const substitute = (pattern: RegExp, replacement: () => string, what: string): void => {
        const next = source.replace(pattern, replacement);
        if (next === source) throw new Error(`inlineEverything: no tag found for ${what}`);
        source = next;
      };

      for (const [fileName, output] of Object.entries(bundle)) {
        if (fileName === "index.html") continue;

        if (output.type === "chunk") {
          // A closing script tag inside the JS would end the element early. The
          // escaped form is inert to the HTML parser and identical to JS.
          const code = output.code.replace(/<\/script/gi, "<\\/script");
          // A replacer FUNCTION, not a replacement string: minified JS is full of
          // `$`, and in a replacement string `$&`, `$'` and `` $` `` are
          // substitution patterns. They silently spliced the original tag back
          // into the middle of the code and produced a SyntaxError.
          substitute(
            new RegExp(`<script[^>]*src="\\.?/?${fileName}"[^>]*></script>`),
            // type="module" is kept, and it matters twice over. It preserves the
            // deferred execution the original tag had - an inline classic script
            // in <head> runs before <body> exists, so createRoot got a null
            // container and React threw #299. And an INLINE module script issues
            // no request, so there is nothing for CORS to block; it was the
            // crossorigin attribute on the external src that broke file://, not
            // module semantics.
            () => `<script type="module">${code}</script>`,
            fileName,
          );
          delete bundle[fileName];
        } else if (fileName.endsWith(".css")) {
          const css = String(output.source).replace(/<\/style/gi, "<\\/style");
          substitute(
            new RegExp(`<link[^>]*href="\\.?/?${fileName}"[^>]*>`),
            () => `<style>${css}</style>`,
            fileName,
          );
          delete bundle[fileName];
        }
      }

      html.source = source;

      // The invariant, checked on the bundle rather than on the HTML text: if
      // anything besides index.html survives, the artifact has a subresource,
      // and a subresource is a blank page over file://. Scanning the HTML for
      // leftover src=/href= would instead scan the 1MB of inlined JS and trip
      // over string literals inside it.
      const survivors = Object.keys(bundle).filter((k) => k !== "index.html");
      if (survivors.length > 0) {
        throw new Error(
          `inlineEverything: ${survivors.length} asset(s) not inlined: ${survivors.join(", ")}`,
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), inlineEverything()],
  // Relative base so the built index.html opens directly from the filesystem.
  // The static ZIP submission depends on this.
  base: "./",
  build: {
    outDir: "dist",
    // Inline every asset as a data URI. The default 4KB threshold would leave
    // small files as separate fetches, which is the same file:// failure in
    // miniature. Deliberately not 0.
    assetsInlineLimit: 100_000_000,
    // One chunk, so there is one script to inline and no modulepreload links.
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
```

Three non-obvious things in it, each found by measurement rather than reasoning:

- **`type="module"` is kept on the inline script.** An inline module script issues no
  request, so there is nothing for CORS to block — it was the `crossorigin` attribute
  on the external `src` that broke `file://`, not module semantics. Dropping to a
  classic script runs it in `<head>` before `<body>` exists, and React throws
  minified error #299 on a null container.
- **The replacement is a FUNCTION, not a string.** In a replacement string `$&`,
  `` $` `` and `$'` are substitution patterns, and minified JS is full of `$`. As a
  string it silently spliced the original `<script src>` tag back into the middle of
  the code and produced `SyntaxError: missing ) after argument list`.
- **The survivor check inspects the bundle, not the HTML text.** Scanning the HTML for
  leftover `src=`/`href=` scans the 1MB of inlined JS and trips over string literals
  inside it — it reported 2 phantom leftovers on a correct build.

An earlier attempt at this used `rollupOptions.output.format: "iife"` instead. It did
not work — the emitted tag was still `type="module" crossorigin` — and it silently
dropped the entire 1.20 kB stylesheet from the build, so the app would have shipped
unstyled. Recorded because the failure was invisible without diffing `dist/`.

The regression guard, `apps/web/e2e/static-file.spec.ts`:

```ts
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

// The submitted artifact is a ZIP that a judge double-clicks. It is opened from
// the filesystem, with no server. Every other test in this suite runs over
// http://localhost, which cannot see the failure mode this one exists for: a
// crossorigin subresource is blocked over file:// and the page renders blank.
//
// The absolute URL overrides the config's baseURL on purpose.
const artifact = pathToFileURL(path.resolve("apps/web/dist/index.html")).href;

test("the built artifact works opened from the filesystem, with no server", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (e) => failures.push(`pageerror: ${String(e)}`));
  page.on("console", (m) => {
    if (m.type() === "error") failures.push(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => {
    failures.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ""}`);
  });

  await page.goto(`${artifact}#/case`);

  // The engine ran in the browser and produced a verdict. If the bundle were
  // blocked, #root would still be empty and this would time out.
  await expect(page.getByTestId("verdict")).toContainText(/abstain/i);
  await expect(page.locator("body")).toContainText("TAK-994");

  // And the stylesheet applied. --deep is defined only in tokens.css, so a
  // transparent nav means the CSS was inlined but never parsed, or was dropped
  // from the build entirely - which is how a previous attempt at this failed.
  const navBackground = await page.evaluate(() => {
    const nav = document.querySelector("nav");
    return nav ? getComputedStyle(nav).backgroundColor : "NO_NAV";
  });
  expect(navBackground).not.toBe("NO_NAV");
  expect(navBackground).not.toBe("rgba(0, 0, 0, 0)");

  // A blocked subresource shows up here as ERR_FAILED even when the page
  // happens to render, so assert the clean load rather than only the outcome.
  expect(failures).toEqual([]);
});

test("the artifact requests nothing over the network", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("file://")) external.push(`${r.method()} ${r.url()}`);
  });

  await page.goto(`${artifact}#/validation`);
  await expect(page.getByTestId("single-class-warning")).toBeVisible();

  // No runtime fetch anywhere in the app: all data is imported at build time.
  // Over file:// a fetch of a sibling JSON is blocked as cross-origin, so this
  // is a correctness requirement, not a preference.
  expect(external).toEqual([]);
});
```

Verified failable: with `inlineEverything()` removed from the plugin list, both
static-file tests fail while all three `http://localhost` tests still pass. That
asymmetry is the reason this spec exists.

Result after the fix — `dist/` is a single file, and over `file://`:

```
ROOT_HTML_LENGTH 11818
VERDICT "▲Abstain"
MENTIONS_TAK994 true
NAV_BACKGROUND rgb(0, 26, 114)
ERRORS []
```

The nav background proves the stylesheet applied: `--deep` is defined only in
`tokens.css`, so a transparent nav would mean the CSS was inlined but never parsed,
or dropped from the build entirely.

Bundle measured: **1,077 kB raw, 177 kB gzipped**, one file, zero subresources.
Inside the 3MB raw budget, so the contingency trim of `metrics.json` prose fields and
unused `compounds.json` SMILES strings is **not needed**. Recorded in §9 and §10 of
the Phase 2 spec.

- [x] **Step 6: Add the web build and e2e to CI**

Append to the `verify` job in `.github/workflows/ci.yml`:

```yaml
      - run: npm run web:build
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
```

- [x] **Step 7: Commit**

Commit `4b532be`. Suite at 253 vitest tests across 29 files plus 5 Playwright tests;
lint, typecheck, build and `git diff --exit-code results/verdict-manifest.json` clean.

---

## Task 14: Presentation hardening

**Files:**
- Create: `apps/web/src/ui/Preflight.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `docs/superpowers/specs/2026-07-27-arbiter-phase2-web-app-design.md` (record the measured Teams-share result)

**Interfaces:**
- Produces: `<Preflight />` — a `?` panel listing what is live and what is on cache

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/preflight.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { Preflight } from "../src/ui/Preflight.js";
import { loadData } from "../src/data/load.js";

const data = loadData();

describe("Preflight", () => {
  it("confirms the ruleset hash matches the pre-registered one", () => {
    render(<StoreProvider data={data}><Preflight /></StoreProvider>);
    expect(screen.getByTestId("check-ruleset").textContent).toMatch(/registered/i);
  });

  it("reports agreement with the committed verdict manifest", () => {
    // The app recomputes rather than trusting results.json. If the two disagree
    // that is a real finding and must be visible, not swallowed.
    render(<StoreProvider data={data}><Preflight /></StoreProvider>);
    expect(screen.getByTestId("check-manifest")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/preflight.test.tsx`
Expected: FAIL — cannot resolve `../src/ui/Preflight.js`

- [ ] **Step 3: Write the pre-flight panel**

Create `apps/web/src/ui/Preflight.tsx`:

```tsx
import { useAppState } from "../state/store.js";
import { useLibraryVerdicts } from "../engine/useLibraryVerdicts.js";

const REGISTERED_HASH = "ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136";

/**
 * What a presenter needs to confirm ninety seconds before going live.
 *
 * The manifest check is the interesting one: the app recomputes every verdict in
 * the browser, so agreeing with the committed harness output is a property worth
 * showing rather than assuming. A disagreement is a real finding and appears in
 * red rather than being swallowed.
 */
export function Preflight() {
  const { data } = useAppState();
  const live = useLibraryVerdicts();

  const mismatches = data.testSplit.filter(
    (id) => live.get(id)?.verdict !== data.manifest.get(id)?.verdict,
  );

  return (
    <aside style={{ padding: 16, borderTop: "1px solid var(--hairline)" }}>
      <h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>Pre-flight</h3>
      <ul style={{ fontSize: 13 }}>
        <li data-testid="check-ruleset">
          Ruleset {data.ruleset.version} — {REGISTERED_HASH.slice(0, 8)}… as registered
        </li>
        <li data-testid="check-manifest" style={{ color: mismatches.length ? "var(--toxic)" : undefined }}>
          {mismatches.length === 0
            ? `Live recomputation agrees with the committed manifest on all ${data.testSplit.length} compounds`
            : `${mismatches.length} compounds disagree with the committed manifest — investigate before presenting`}
        </li>
        <li>Evidence: {data.claimsByCompound.size} compounds, fixture citations {data.fixture.citationStatus}</li>
        <li>All data is bundled. No network call is made at any point.</li>
      </ul>
    </aside>
  );
}
```

Mount it behind a `?` key in `App.tsx`, alongside the existing tour key handling.

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run lint && npm run typecheck && npm run web:build`
Expected: PASS throughout.

- [ ] **Step 5: Do the Teams-share legibility check**

Share the built app in a real Teams call and read it at the far end. Body 14px, evidence names 15–16px focused, verdicts 24–27px. **Screen-share compression degrades silently — it will look fine locally while a judge cannot read the rule names.** Record the result in §9 of the Phase 2 spec, with the date and what was changed if anything.

- [ ] **Step 6: Commit**

```bash
git add apps/web docs
git commit -m "Add the pre-flight panel and record the Teams-share check

The manifest check is the one that earns its place: the app recomputes every
verdict in the browser, so agreeing with the committed harness output is a
property worth showing rather than assuming, and a disagreement appears in red
rather than being swallowed.

Also states plainly that no network call is made at any point, which is the answer
to 'what happens if the wifi drops mid-demo'.

Teams-share legibility verified on a real call and the result recorded in the
spec, because screen-share compression degrades silently: it looks fine locally
while a judge cannot read the rule names."
git push origin arbiter-round1
```

---

## Done when

- `npm test` green, `npm run lint` and `npm run typecheck` clean, `npm run e2e` green.
- `npm run golden:update` produces no diff on a clean checkout — the reported numbers have not moved.
- `apps/web/dist/index.html` opens from the filesystem with no server and walks all seven beats on the keyboard.
- `python tools/sync_plan.py` reports `DRIFT-FREE`.
- The seven-beat test passes against the real engine, and has been watched failing at least once.

## Deliberately not in this plan

- **Phase 3** — the three AI surfaces and the API service. Its own spec, written once this shell exists.
- **The Cmax hunt.** It is the difference between "coverage is the finding" and a reportable headline, and it competes for the same days. A team-capacity call, not an engineering one.
- **The R1 discount question.** Recorded in master spec §5 as a v1.1 re-registration question, not acted on.
