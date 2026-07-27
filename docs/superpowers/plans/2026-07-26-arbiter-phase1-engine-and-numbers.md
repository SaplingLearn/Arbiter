# ARBITER Phase 1 — Engine and Numbers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Go from an empty repo to `results/results.json` + `results/metrics.json` — real validated numbers produced by a pure TypeScript reasoning engine over real public hepatotoxicity data, with four baselines and the full metric suite.

**Architecture:** A dependency-free TypeScript engine (`packages/engine`) is the single source of truth for reasoning. A Node CLI (`apps/harness`) imports it to run the benchmark and emit JSON. Python (`data/prep`) does one-time data acquisition and writes committed JSON. Nothing in the engine touches I/O, dates, or randomness.

**Tech Stack:** Node 20 · TypeScript 5 · npm workspaces · vitest · zod · tsx · Python 3.12 (venv) · pandas · rdkit · scikit-learn · Anthropic SDK (`@anthropic-ai/sdk`)

**Spec:** `docs/superpowers/specs/2026-07-26-arbiter-design.md` — this plan implements §5, §6, §8, §11 of it. Phases 2 (web app) and 3 (AI surfaces) get their own plans after this one lands.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Node 20.12.1**, npm workspaces. TypeScript strict mode on.
- **`packages/engine` has zero runtime dependencies.** No imports outside the package. No `Date`, no `Math.random`, no I/O. Enforced by ESLint rule + a determinism test.
- **All randomness lives in `apps/harness`**, via a seeded PRNG. The seed is committed alongside results.
- **`rules/ruleset-v1.0.json` is committed before any evaluation runs.** Its SHA-256 goes in `results/metrics.json`.
- **Three-way data split** — train / calibration / test. Boundaries and seed fixed before any fitting. Reliability priors fit on train only. Reported numbers come from test only.
- **Language discipline** (spec §1): say "review-ready evidence package", never "regulator-ready dossier"; "positions" and "sign-off", never "voting"/"tally"/"majority"; "hash-chained audit log", never "blockchain".
- **Anthropic model ID: `claude-opus-5`.** `temperature`/`top_p`/`top_k` do **not exist** on this model — passing any of them returns HTTP 400. Never add them.
- **Thinking is ON by default on `claude-opus-5`.** `max_tokens` caps thinking + output together.
- **Every Anthropic response must have `stop_reason` checked before `content` is read.** `stop_reason: "refusal"` returns HTTP 200 with empty content.
- TAK-994 is **excluded from every metric**. It is a fixture, not a benchmark row.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | npm workspaces root, shared scripts |
| `tsconfig.base.json` | strict compiler options shared by all packages |
| `packages/engine/src/types.ts` | `EvidenceClaim`, `Ruleset`, `Rule`, `Reasoning`, `TraceStep` — no logic |
| `packages/engine/src/fuse.ts` | Dempster–Shafer mass combination, belief/plausibility, conflict mass K |
| `packages/engine/src/rules.ts` | R1–R6 as predicate functions over claim pairs |
| `packages/engine/src/argue.ts` | attack graph + grounded semantics with reinstatement |
| `packages/engine/src/abstain.ts` | abstention decision from gap + applicability domain |
| `packages/engine/src/conflict.ts` | conflict detection / labelling |
| `packages/engine/src/counterfactual.ts` | exhaustive minimal-flip search |
| `packages/engine/src/plan.ts` | argument-structure-driven VOI planner |
| `packages/engine/src/index.ts` | `reason(claims, ruleset)` — the only public entry point |
| `packages/engine/src/schema.ts` | zod schemas for `EvidenceClaim` and `Ruleset` |
| `apps/harness/src/prng.ts` | seeded PRNG (all randomness) |
| `apps/harness/src/stats.ts` | Wilson intervals, balanced accuracy, confusion matrix |
| `apps/harness/src/baselines.ts` | majority vote, weighted average, best single source |
| `apps/harness/src/ablation.ts` | Anthropic Batches-API LLM baseline |
| `apps/harness/src/metrics.ts` | the five metrics |
| `apps/harness/src/main.ts` | CLI orchestration → `results/*.json` |
| `data/prep/*.py` | one-time acquisition; output committed to `data/out/` |
| `rules/ruleset-v1.0.json` | pre-registered rules + thresholds + binarisation policy |

---

## Task 1: Conflict-count spike (decision gate)

**This task can invalidate the headline metric. Do it first and report the number before writing any engine code.**

**Files:**
- Create: `data/prep/spike_conflict_count.py`
- Create: `data/prep/requirements.txt`
- Create: `data/prep/README.md`

**Interfaces:**
- Consumes: nothing
- Produces: a printed count and `data/out/spike-report.json` with `{nCompounds, nWithBothStreams, nConflicting, conflictRate}`

- [ ] **Step 1: Create the Python environment and pin dependencies**

Write `data/prep/requirements.txt`:

```
pandas==2.2.3
openpyxl==3.1.5
requests==2.32.3
rdkit==2024.9.4
scikit-learn==1.5.2
numpy==2.1.3
```

Run:

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && python -m venv data/prep/.venv && data/prep/.venv/Scripts/python -m pip install -q -r data/prep/requirements.txt && data/prep/.venv/Scripts/python -c "import pandas, rdkit, sklearn; print('ok')"
```

Expected: `ok`

- [ ] **Step 2: Document the manual DILIrank download**

Write `data/prep/README.md`:

```markdown
# Data prep

## DILIrank (manual download — no stable direct URL)

1. Go to the FDA Liver Toxicity Knowledge Base (LTKB) DILIrank page.
2. Download the DILIrank dataset spreadsheet (`.xlsx`).
3. Save it as `data/raw/dilirank.xlsx` (create `data/raw/` — it is gitignored).

We do not script this download: the FDA URL is not stable and silently
returning an HTML error page as a "spreadsheet" is a worse failure than
asking a human to click once.

## Everything else

Scripted. Run with `data/prep/.venv/Scripts/python data/prep/<script>.py`.
```

Add `data/raw/` to `.gitignore`.

- [ ] **Step 3: Write the spike script**

Create `data/prep/spike_conflict_count.py`:

```python
"""Task-zero spike: do genuine cross-stream conflicts exist at usable scale?

Answers one question and then exits: on DILIrank compounds, how often does a
QSAR-style structural prediction disagree with the DILIrank label? If this
number is tiny, the conflict-subset metric in the spec has no population and
the plan changes.

Deliberately crude. This is a go/no-go probe, not the data layer.
"""
import json
import pathlib
import sys

import numpy as np
import pandas as pd
from rdkit import Chem, RDLogger
from rdkit.Chem import rdFingerprintGenerator
from sklearn.ensemble import HistGradientBoostingClassifier

RDLogger.DisableLog("rdApp.*")

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "dilirank.xlsx"
OUT = ROOT / "data" / "out"

POSITIVE = {"vMost-DILI-Concern", "vLess-DILI-Concern"}
NEGATIVE = {"vNo-DILI-Concern"}


def load_dilirank() -> pd.DataFrame:
    if not RAW.exists():
        sys.exit(f"Missing {RAW}. See data/prep/README.md for the download step.")
    df = pd.read_excel(RAW)
    # Column names vary between DILIrank releases; find them by content.
    name_col = next(c for c in df.columns if "compound" in c.lower() or "drug" in c.lower())
    label_col = next(c for c in df.columns if "concern" in c.lower() or "severity" in c.lower())
    df = df[[name_col, label_col]].rename(columns={name_col: "name", label_col: "label"})
    df["name"] = df["name"].astype(str).str.strip()
    df["label"] = df["label"].astype(str).str.strip()
    df = df[df["label"].isin(POSITIVE | NEGATIVE)]
    df["y"] = df["label"].isin(POSITIVE).astype(int)
    return df.drop_duplicates(subset="name").reset_index(drop=True)


def resolve_smiles(names: list[str]) -> dict[str, str]:
    """Resolve compound names to SMILES via PubChem PUG-REST, throttled to 4/s."""
    import time

    import requests

    out: dict[str, str] = {}
    base = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name"
    for i, name in enumerate(names):
        try:
            r = requests.get(f"{base}/{requests.utils.quote(name)}/property/CanonicalSMILES/JSON", timeout=20)
            if r.ok:
                props = r.json()["PropertyTable"]["Properties"]
                if props and "CanonicalSMILES" in props[0]:
                    out[name] = props[0]["CanonicalSMILES"]
        except Exception:
            pass
        time.sleep(0.25)  # PubChem asks for <=5 req/s
        if (i + 1) % 25 == 0:
            print(f"  resolved {i + 1}/{len(names)} ({len(out)} hits)", flush=True)
    return out


def fingerprints(smiles: list[str]) -> np.ndarray:
    gen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    rows = []
    for s in smiles:
        mol = Chem.MolFromSmiles(s)
        rows.append(np.zeros(2048, dtype=np.int8) if mol is None
                    else np.array(gen.GetFingerprint(mol), dtype=np.int8))
    return np.vstack(rows)


def main() -> None:
    df = load_dilirank()
    sample = df.sample(n=min(250, len(df)), random_state=20260726).reset_index(drop=True)
    print(f"DILIrank binary-labelled compounds: {len(df)}; sampling {len(sample)}")

    smiles_map = resolve_smiles(sample["name"].tolist())
    sample["smiles"] = sample["name"].map(smiles_map)
    sample = sample.dropna(subset=["smiles"]).reset_index(drop=True)
    print(f"Resolved to SMILES: {len(sample)}")

    X, y = fingerprints(sample["smiles"].tolist()), sample["y"].to_numpy()

    # Out-of-fold predictions so every compound gets a prediction from a model
    # that never saw it. A crude stand-in for the real QSAR stream.
    from sklearn.model_selection import StratifiedKFold
    pred = np.zeros(len(y), dtype=int)
    for tr, te in StratifiedKFold(n_splits=5, shuffle=True, random_state=20260726).split(X, y):
        clf = HistGradientBoostingClassifier(max_iter=150, random_state=20260726).fit(X[tr], y[tr])
        pred[te] = clf.predict(X[te])

    n_conflict = int((pred != y).sum())
    report = {
        "nCompounds": int(len(df)),
        "nWithBothStreams": int(len(sample)),
        "nConflicting": n_conflict,
        "conflictRate": round(n_conflict / len(sample), 4),
        "seed": 20260726,
        "note": "QSAR-vs-DILIrank disagreement only. Crude proxy for the 4-stream conflict subset.",
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "spike-report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))

    if n_conflict < 30:
        print("\n*** GATE: fewer than 30 conflicts. Report this before continuing. ***")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the spike**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python data/prep/spike_conflict_count.py
```

Expected: a JSON report with `nConflicting`. **Stop and report this number.** If `nConflicting` is under 30, the conflict-subset metric is underpowered and §8 of the spec needs revisiting before any more code is written.

- [ ] **Step 5: Commit**

```bash
git add .gitignore data/prep data/out/spike-report.json && git commit -m "Add task-zero conflict-count spike

Answers the one question that can invalidate the headline metric: do
cross-stream conflicts exist at usable scale on DILIrank? Uses out-of-fold
Morgan-fingerprint predictions as a crude QSAR stand-in, so every compound
is scored by a model that never saw it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Monorepo scaffold, engine types, and the zod contract

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.eslintrc.json`
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`
- Create: `packages/engine/src/types.ts`, `packages/engine/src/schema.ts`
- Test: `packages/engine/test/schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `EvidenceClaim`, `Ruleset`, `Rule`, `Reasoning`, `TraceStep`, `Verdict`, `Assertion`, `BiologicalSystem`; `EvidenceClaimSchema`, `RulesetSchema`

- [ ] **Step 1: Scaffold the workspace**

`package.json`:

```json
{
  "name": "arbiter",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "vitest run",
    "lint": "eslint packages apps --ext .ts",
    "typecheck": "tsc -b packages/engine apps/harness",
    "harness": "tsx apps/harness/src/main.ts"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^8.57.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "composite": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  }
}
```

`resolveJsonModule` is required — `packages/engine/test/rules.test.ts` imports `rules/ruleset-v1.0.json` directly so the tests run against the real pre-registered file rather than a copy that could drift from it.

`packages/engine/package.json`:

```json
{
  "name": "@arbiter/engine",
  "version": "1.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {}
}
```

`packages/engine/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
```

`.eslintrc.json` — this is where determinism is enforced:

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": ["eslint:recommended"],
  "env": { "es2022": true, "node": true },
  "overrides": [
    {
      "files": ["packages/engine/src/**/*.ts"],
      "rules": {
        "no-restricted-globals": [
          "error",
          { "name": "Date", "message": "The engine must be deterministic. Callers filter by availableFrom." }
        ],
        "no-restricted-properties": [
          "error",
          { "object": "Math", "property": "random", "message": "All randomness lives in apps/harness with a committed seed." }
        ],
        "no-restricted-imports": [
          "error",
          { "patterns": ["../*", "node:*", "fs", "path", "crypto"] }
        ]
      }
    }
  ]
}
```

Run:

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm install && npm exec tsc --version
```

Expected: npm installs without error, `tsc` prints `Version 5.6.x`.

The ban targets `Math.random` specifically via `no-restricted-properties`, not the `Math` global — the engine legitimately uses `Math.min`, `Math.max`, and `Math.abs`, and banning the whole namespace would force pointless aliasing while catching nothing extra.

- [ ] **Step 2: Write the failing schema test**

Create `packages/engine/test/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EvidenceClaimSchema, RulesetSchema } from "../src/schema.js";

const validClaim = {
  id: "tak994-rat-28d",
  compoundId: "TAK-994",
  stream: "invivo_rodent",
  assertion: "safe",
  strength: 0.8,
  system: "rodent",
  measuresKeyEvent: null,
  exposureRelevant: null,
  inApplicabilityDomain: null,
  klimisch: 1,
  availableFrom: "2021-01-01",
  provenance: { kind: "literature", source: "PMID:example", retrieved: "2026-07-26" },
};

describe("EvidenceClaimSchema", () => {
  it("accepts a well-formed claim", () => {
    expect(EvidenceClaimSchema.parse(validClaim).id).toBe("tak994-rat-28d");
  });

  it("rejects strength outside 0..1", () => {
    expect(() => EvidenceClaimSchema.parse({ ...validClaim, strength: 1.4 })).toThrow();
  });

  it("rejects an unknown stream", () => {
    expect(() => EvidenceClaimSchema.parse({ ...validClaim, stream: "vibes" })).toThrow();
  });

  it("rejects a klimisch score outside 1..4", () => {
    expect(() => EvidenceClaimSchema.parse({ ...validClaim, klimisch: 7 })).toThrow();
  });
});

describe("RulesetSchema", () => {
  it("requires all six rules", () => {
    const ruleset = {
      version: "1.0",
      registeredAt: "2026-07-26",
      abstentionGapThreshold: 0.5,
      dilirankBinarisation: { positive: ["vMost-DILI-Concern"], negative: ["vNo-DILI-Concern"], excluded: ["Ambiguous"] },
      rules: [{ id: "R1", name: "Human relevance", statement: "s", framework: { name: "f", date: "2025-04" }, enabled: true, strength: 1 }],
    };
    expect(() => RulesetSchema.parse(ruleset)).toThrow(/six/i);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/schema.test.ts
```

Expected: FAIL — `Cannot find module '../src/schema.js'`

- [ ] **Step 4: Write `types.ts`**

Create `packages/engine/src/types.ts`:

```ts
/** What a source asserts about a compound. `ambiguous` is a real answer, not missing data. */
export type Assertion = "toxic" | "safe" | "ambiguous";

/** What biology produced the signal. Consumed by R1. */
export type BiologicalSystem = "human" | "rodent" | "nonrodent" | "in_silico";

export type Stream =
  | "qsar"
  | "cytotox"
  | "toxicogenomics"
  | "transporter"
  | "invivo_rodent"
  | "invivo_nonrodent";

export type Verdict = "advance" | "do_not_advance" | "abstain";

export interface Provenance {
  kind: "database" | "literature";
  /** e.g. "DILIrank", "Tox21/AID-1234", "PMID:39876543" */
  source: string;
  /** ISO date the prep run fetched it. Set by Python, never by the engine. */
  retrieved: string;
  url?: string;
}

/**
 * One typed evidence claim. Every field exists because exactly one rule
 * consumes it — see spec §5. Adding a field here means adding a rule.
 */
export interface EvidenceClaim {
  id: string;
  compoundId: string;
  stream: Stream;
  assertion: Assertion;
  /** Source-reported confidence, 0..1. */
  strength: number;
  /** → R1 */
  system: BiologicalSystem;
  /** → R2. `null` means structural correlation only, not a measured key event. */
  measuresKeyEvent: string | null;
  /** → R3. `null` means the exposure margin was never tested at clinical range. */
  exposureRelevant: boolean | null;
  /** → R4. `null` means not assessable. */
  inApplicabilityDomain: boolean | null;
  /** → R5. Klimisch reliability score. */
  klimisch: 1 | 2 | 3 | 4 | null;
  /** Enables as-of replay. The ENGINE NEVER READS THIS — callers filter first. */
  availableFrom: string;
  provenance: Provenance;
}

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";

export interface Rule {
  id: RuleId;
  name: string;
  statement: string;
  /** The published framework the rule rests on. No rule may cite TAK-994. */
  framework: { name: string; date: string; note?: string };
  enabled: boolean;
  /** How strongly this rule defeats, 0..1. Editable by a toxicologist. */
  strength: number;
}

export interface Ruleset {
  version: string;
  /** ISO date, set at pre-registration. */
  registeredAt: string;
  /** Abstain when plausibility - belief exceeds this. Pre-registered. */
  abstentionGapThreshold: number;
  dilirankBinarisation: { positive: string[]; negative: string[]; excluded: string[] };
  rules: Rule[];
}

export type ClaimStatus = "admitted" | "defeated" | "downweighted" | "undecided";

export interface TraceStep {
  claimId: string;
  status: ClaimStatus;
  /** The rule that produced this status, when one did. */
  byRule?: RuleId;
  /** The claim that defeated this one, when applicable. */
  defeatedBy?: string;
  /** Human-readable, rendered directly in the UI. */
  rationale: string;
}

export interface Counterfactual {
  /** Claims whose assertions must flip together to change the verdict. */
  claimIds: string[];
  flipTo: Assertion;
  newVerdict: Verdict;
}

export interface NextExperiment {
  assay: string;
  /** The rule this assay would settle. This is what makes the planner novel. */
  resolvesRule: RuleId | null;
  expectedGapReduction: number;
  cost: number;
  score: number;
  rationale: string;
}

export interface Reasoning {
  verdict: Verdict;
  /** True when both assertions survive as live arguments. */
  contested: boolean;
  belief: number;
  plausibility: number;
  /** Dempster conflict mass. Surfaced, never normalised away. */
  conflictMass: number;
  trace: TraceStep[];
  counterfactual: Counterfactual | null;
  nextExperiment: NextExperiment | null;
  rulesetHash: string;
}
```

- [ ] **Step 5: Write `schema.ts`**

Add `zod` to the engine's dependencies — this is the one exception to zero-deps, and it is deliberate: schema validation at the seam is worth more than purity, and zod has no I/O, no dates, and no randomness.

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm install zod@^3.23.8 --workspace @arbiter/engine
```

Create `packages/engine/src/schema.ts`:

```ts
import { z } from "zod";

export const ProvenanceSchema = z.object({
  kind: z.enum(["database", "literature"]),
  source: z.string().min(1),
  retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  url: z.string().url().optional(),
});

export const EvidenceClaimSchema = z.object({
  id: z.string().min(1),
  compoundId: z.string().min(1),
  stream: z.enum(["qsar", "cytotox", "toxicogenomics", "transporter", "invivo_rodent", "invivo_nonrodent"]),
  assertion: z.enum(["toxic", "safe", "ambiguous"]),
  strength: z.number().min(0).max(1),
  system: z.enum(["human", "rodent", "nonrodent", "in_silico"]),
  measuresKeyEvent: z.string().nullable(),
  exposureRelevant: z.boolean().nullable(),
  inApplicabilityDomain: z.boolean().nullable(),
  klimisch: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  availableFrom: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
  provenance: ProvenanceSchema,
});

export const RuleSchema = z.object({
  id: z.enum(["R1", "R2", "R3", "R4", "R5", "R6"]),
  name: z.string().min(1),
  statement: z.string().min(1),
  framework: z.object({ name: z.string().min(1), date: z.string().min(1), note: z.string().optional() }),
  enabled: z.boolean(),
  strength: z.number().min(0).max(1),
});

export const RulesetSchema = z
  .object({
    version: z.string().min(1),
    registeredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    abstentionGapThreshold: z.number().min(0).max(1),
    dilirankBinarisation: z.object({
      positive: z.array(z.string()).min(1),
      negative: z.array(z.string()).min(1),
      excluded: z.array(z.string()),
    }),
    rules: z.array(RuleSchema),
  })
  .refine((r) => r.rules.length === 6, { message: "A ruleset must declare all six rules R1-R6" })
  .refine((r) => new Set(r.rules.map((x) => x.id)).size === 6, { message: "Rule ids must be unique across all six" });

export const EvidenceFileSchema = z.object({
  generatedAt: z.string(),
  claims: z.array(EvidenceClaimSchema),
});
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/schema.test.ts && npm run lint
```

Expected: PASS (5 tests), lint clean.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json .eslintrc.json packages/ && git commit -m "Scaffold monorepo, engine types, and the zod contract

Types encode the spec's schema-from-rules discipline: every EvidenceClaim
field is annotated with the rule that consumes it, so adding a field means
adding a rule.

Determinism is enforced by ESLint inside packages/engine: Math.random is
banned outright, as are imports of fs/path/crypto and any parent directory.
availableFrom is present on the claim but documented as never read by the
engine - callers filter before calling reason().

zod is the one permitted engine dependency. It has no I/O, no clock, and no
randomness, and validating at the seam is worth more than nominal purity.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Dempster–Shafer fusion

**Files:**
- Create: `packages/engine/src/fuse.ts`
- Test: `packages/engine/test/fuse.test.ts`

**Interfaces:**
- Consumes: `Assertion` from `types.ts`
- Produces:
  - `type Mass = { toxic: number; safe: number; uncommitted: number }`
  - `claimToMass(assertion: Assertion, strength: number): Mass`
  - `combine(a: Mass, b: Mass): { mass: Mass; conflict: number }`
  - `fuse(masses: Mass[]): { belief: number; plausibility: number; conflictMass: number }`
  - `VACUOUS: Mass` — the silent-source constant

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/fuse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { VACUOUS, claimToMass, combine, fuse } from "../src/fuse.js";

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 10);

describe("claimToMass", () => {
  it("puts an ambiguous claim entirely in uncommitted mass", () => {
    const m = claimToMass("ambiguous", 0.9);
    near(m.uncommitted, 1);
    near(m.toxic, 0);
    near(m.safe, 0);
  });

  it("leaves 1 - strength uncommitted for a committed claim", () => {
    const m = claimToMass("toxic", 0.7);
    near(m.toxic, 0.7);
    near(m.uncommitted, 0.3);
  });
});

describe("combine", () => {
  it("is commutative", () => {
    const a = claimToMass("toxic", 0.6);
    const b = claimToMass("safe", 0.3);
    near(combine(a, b).mass.toxic, combine(b, a).mass.toxic);
  });

  it("is associative", () => {
    const [a, b, c] = [claimToMass("toxic", 0.5), claimToMass("safe", 0.4), claimToMass("toxic", 0.2)];
    const left = combine(combine(a!, b!).mass, c!).mass;
    const right = combine(a!, combine(b!, c!).mass).mass;
    near(left.toxic, right.toxic);
    near(left.safe, right.safe);
  });

  it("THE KEY PROPERTY: a silent source does not move belief", () => {
    const a = claimToMass("toxic", 0.7);
    const combined = combine(a, VACUOUS).mass;
    near(combined.toxic, a.toxic);
    near(combined.safe, a.safe);
    near(combined.uncommitted, a.uncommitted);
  });

  it("tracks conflict mass when sources disagree", () => {
    const { conflict } = combine(claimToMass("toxic", 1), claimToMass("safe", 1));
    near(conflict, 1);
  });
});

describe("fuse", () => {
  it("holds belief <= plausibility over random mass assignments", () => {
    // Deterministic pseudo-random sweep: no Math.random in tests either.
    let s = 12345;
    const next = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 500; i++) {
      const masses = Array.from({ length: 1 + (i % 5) }, () => {
        const t = next() * 0.6;
        const f = next() * (1 - t) * 0.6;
        return { toxic: t, safe: f, uncommitted: 1 - t - f };
      });
      const r = fuse(masses);
      expect(r.belief).toBeLessThanOrEqual(r.plausibility + 1e-12);
      expect(r.belief).toBeGreaterThanOrEqual(0);
      expect(r.plausibility).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it("returns a maximally wide range for no evidence at all", () => {
    const r = fuse([]);
    near(r.belief, 0);
    near(r.plausibility, 1);
  });

  it("reports total conflict rather than dividing by zero", () => {
    const r = fuse([claimToMass("toxic", 1), claimToMass("safe", 1)]);
    near(r.conflictMass, 1);
    near(r.belief, 0);
    near(r.plausibility, 1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/fuse.test.ts
```

Expected: FAIL — `Cannot find module '../src/fuse.js'`

- [ ] **Step 3: Write the implementation**

Create `packages/engine/src/fuse.ts`:

```ts
import type { Assertion } from "./types.js";

/**
 * Mass over the frame Theta = {toxic, safe}.
 *
 * `uncommitted` is mass on Theta itself: what this source genuinely cannot
 * tell you. It is NOT a hedge and NOT half a vote for each side. This is the
 * whole reason fusion beats averaging.
 */
export interface Mass {
  toxic: number;
  safe: number;
  uncommitted: number;
}

/** A source that says nothing. Contributes m(Theta) = 1, never a vote for safe. */
export const VACUOUS: Mass = { toxic: 0, safe: 0, uncommitted: 1 };

export function claimToMass(assertion: Assertion, strength: number): Mass {
  const s = Math.max(0, Math.min(1, strength));
  if (assertion === "ambiguous") return { ...VACUOUS };
  if (assertion === "toxic") return { toxic: s, safe: 0, uncommitted: 1 - s };
  return { toxic: 0, safe: s, uncommitted: 1 - s };
}

/**
 * Dempster's rule of combination.
 *
 * Returns the normalised combined mass plus the conflict mass K that was
 * normalised out. We return K rather than swallowing it: a high K means the
 * sources genuinely disagree, which is information a safety lead needs.
 */
export function combine(a: Mass, b: Mass): { mass: Mass; conflict: number } {
  const toxic = a.toxic * b.toxic + a.toxic * b.uncommitted + a.uncommitted * b.toxic;
  const safe = a.safe * b.safe + a.safe * b.uncommitted + a.uncommitted * b.safe;
  const uncommitted = a.uncommitted * b.uncommitted;
  const conflict = a.toxic * b.safe + a.safe * b.toxic;

  const norm = 1 - conflict;
  if (norm <= Number.EPSILON) {
    // Total conflict: Dempster's rule is undefined. Return the vacuous mass,
    // which is the honest answer - we know nothing - and report K = 1 so the
    // caller can abstain rather than fabricate a verdict.
    return { mass: { ...VACUOUS }, conflict: 1 };
  }
  return { mass: { toxic: toxic / norm, safe: safe / norm, uncommitted: uncommitted / norm }, conflict };
}

/**
 * Fuse many masses. belief(toxic) = m({toxic}); plausibility(toxic) =
 * m({toxic}) + m(Theta). The gap between them is what ARBITER does not know.
 *
 * conflictMass is reported as the maximum pairwise conflict encountered
 * during folding, which is the quantity that should widen the range.
 */
export function fuse(masses: Mass[]): { belief: number; plausibility: number; conflictMass: number } {
  let acc: Mass = { ...VACUOUS };
  let maxConflict = 0;
  for (const m of masses) {
    const { mass, conflict } = combine(acc, m);
    acc = mass;
    if (conflict > maxConflict) maxConflict = conflict;
  }
  return { belief: acc.toxic, plausibility: acc.toxic + acc.uncommitted, conflictMass: maxConflict };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/fuse.test.ts && npm run lint
```

Expected: PASS (8 tests), lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "Add Dempster-Shafer fusion with conflict mass surfaced

Mass is distributed over {toxic}, {safe}, and Theta, where Theta is
uncommitted mass - what a source genuinely cannot tell you. A silent source
contributes m(Theta) = 1, never a vote for safe, and there is an explicit
test asserting it does not move belief.

Conflict mass K is returned rather than normalised away, because a high K
means the sources genuinely disagree and that should widen the reported
range. Total conflict (K = 1) returns the vacuous mass instead of dividing
by zero, so the caller abstains rather than fabricating a verdict.

belief <= plausibility is a property test over 500 deterministic
pseudo-random mass assignments - no Math.random, even in tests.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: R1–R6 and the pre-registered ruleset file

**Files:**
- Create: `packages/engine/src/rules.ts`
- Create: `rules/ruleset-v1.0.json`
- Create: `apps/harness/src/hash.ts`
- Test: `packages/engine/test/rules.test.ts`

**Interfaces:**
- Consumes: `EvidenceClaim`, `Rule`, `RuleId`, `Ruleset`
- Produces:
  - `defeats(attacker: EvidenceClaim, target: EvidenceClaim, ruleset: Ruleset): { byRule: RuleId; rationale: string } | null`
  - `downweightFactor(claim: EvidenceClaim, ruleset: Ruleset): { factor: number; byRule: RuleId; rationale: string } | null`
  - `concordanceBoost(claims: EvidenceClaim[], ruleset: Ruleset): number`
  - `conflictsWith(a: EvidenceClaim, b: EvidenceClaim): boolean`

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/rules.test.ts`. Each test crafts a minimal pair where exactly one rule can decide.

```ts
import { describe, expect, it } from "vitest";
import { concordanceBoost, conflictsWith, defeats, downweightFactor } from "../src/rules.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;

function claim(over: Partial<EvidenceClaim>): EvidenceClaim {
  return {
    id: "c", compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: true,
    inApplicabilityDomain: true, klimisch: 1, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "test", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("conflictsWith", () => {
  it("is true only for opposed committed assertions", () => {
    expect(conflictsWith(claim({ assertion: "toxic" }), claim({ assertion: "safe" }))).toBe(true);
    expect(conflictsWith(claim({ assertion: "toxic" }), claim({ assertion: "toxic" }))).toBe(false);
    expect(conflictsWith(claim({ assertion: "toxic" }), claim({ assertion: "ambiguous" }))).toBe(false);
  });
});

describe("R1 human relevance", () => {
  it("human-cell evidence defeats rodent in vivo", () => {
    const human = claim({ id: "h", assertion: "toxic", system: "human" });
    const rat = claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent" });
    expect(defeats(human, rat, RS)?.byRule).toBe("R1");
    expect(defeats(rat, human, RS)).toBeNull();
  });

  it("does not fire between two human claims", () => {
    const a = claim({ id: "a", assertion: "toxic", system: "human" });
    const b = claim({ id: "b", assertion: "safe", system: "human" });
    expect(defeats(a, b, RS)?.byRule).not.toBe("R1");
  });
});

describe("R2 mechanistic proximity", () => {
  it("a measured key event defeats structural correlation only", () => {
    const mech = claim({ id: "m", assertion: "toxic", measuresKeyEvent: "KE:55", stream: "transporter" });
    const struct = claim({ id: "s", assertion: "safe", measuresKeyEvent: null, stream: "qsar", system: "human" });
    expect(defeats(mech, struct, RS)?.byRule).toBe("R2");
  });
});

describe("R3 exposure relevance", () => {
  it("a positive at clinical exposure defeats a negative with untested margin", () => {
    const pos = claim({ id: "p", assertion: "toxic", exposureRelevant: true });
    const neg = claim({ id: "n", assertion: "safe", exposureRelevant: null });
    expect(defeats(pos, neg, RS)?.byRule).toBe("R3");
    expect(defeats(neg, pos, RS)).toBeNull();
  });
});

describe("R4 applicability domain", () => {
  it("downweights an out-of-domain claim without defeating it", () => {
    const out = claim({ inApplicabilityDomain: false });
    const r = downweightFactor(out, RS);
    expect(r?.byRule).toBe("R4");
    expect(r!.factor).toBeGreaterThan(0);
    expect(r!.factor).toBeLessThan(1);
  });

  it("leaves an in-domain claim alone", () => {
    expect(downweightFactor(claim({ inApplicabilityDomain: true }), RS)).toBeNull();
  });
});

describe("R5 study reliability", () => {
  it("a more reliable study defeats a less reliable one at equal relevance", () => {
    const good = claim({ id: "g", assertion: "toxic", klimisch: 1 });
    const poor = claim({ id: "p", assertion: "safe", klimisch: 4 });
    expect(defeats(good, poor, RS)?.byRule).toBe("R5");
    expect(defeats(poor, good, RS)).toBeNull();
  });
});

describe("R6 concordance", () => {
  it("rewards agreement across distinct streams, not within one", () => {
    const twoStreams = [claim({ id: "a", stream: "cytotox" }), claim({ id: "b", stream: "transporter" })];
    const oneStream = [claim({ id: "a", stream: "cytotox" }), claim({ id: "b", stream: "cytotox" })];
    expect(concordanceBoost(twoStreams, RS)).toBeGreaterThan(concordanceBoost(oneStream, RS));
  });
});

describe("disabled rules", () => {
  it("a disabled rule never fires", () => {
    const off: Ruleset = { ...RS, rules: RS.rules.map((r) => (r.id === "R1" ? { ...r, enabled: false } : r)) };
    const human = claim({ id: "h", assertion: "toxic", system: "human", exposureRelevant: null, klimisch: 2 });
    const rat = claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", exposureRelevant: null, klimisch: 2 });
    expect(defeats(human, rat, off)?.byRule).not.toBe("R1");
  });
});

describe("pre-registration", () => {
  it("no rule justification cites TAK-994", () => {
    const blob = JSON.stringify(RS.rules).toLowerCase();
    expect(blob).not.toContain("tak-994");
    expect(blob).not.toContain("tak994");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/rules.test.ts
```

Expected: FAIL — cannot resolve `../src/rules.js` and `rules/ruleset-v1.0.json`

- [ ] **Step 3: Write the pre-registered ruleset**

Create `rules/ruleset-v1.0.json`. **No rule may cite TAK-994** — every `framework` field names a published source only.

```json
{
  "version": "1.0",
  "registeredAt": "2026-07-26",
  "abstentionGapThreshold": 0.5,
  "dilirankBinarisation": {
    "positive": ["vMost-DILI-Concern", "vLess-DILI-Concern"],
    "negative": ["vNo-DILI-Concern"],
    "excluded": ["Ambiguous-DILI-concern"]
  },
  "rules": [
    {
      "id": "R1",
      "name": "Human relevance",
      "statement": "Human-cell evidence defeats animal in vivo evidence when the question is human hepatotoxicity.",
      "framework": {
        "name": "FDA Roadmap to Reducing Animal Testing in Preclinical Safety Studies; FDA Modernization Act 2.0",
        "date": "2025-04",
        "note": "Agency direction toward human-relevant new approach methodologies as the preferred evidence source."
      },
      "enabled": true,
      "strength": 0.9
    },
    {
      "id": "R2",
      "name": "Mechanistic proximity",
      "statement": "Evidence that directly measures an adverse outcome pathway key event defeats evidence that only correlates with chemical structure.",
      "framework": {
        "name": "OECD Adverse Outcome Pathway framework; AOP-Wiki key event relationship confidence",
        "date": "standing",
        "note": "Key event relationships carry explicit confidence levels assessed on biological plausibility and empirical support."
      },
      "enabled": true,
      "strength": 0.85
    },
    {
      "id": "R3",
      "name": "Exposure relevance",
      "statement": "A positive finding at clinically relevant exposure defeats a negative finding whose exposure margin is unstated or untested at that range.",
      "framework": {
        "name": "ICH M3(R2) exposure-margin expectations; standard exposure-margin practice in regulatory toxicology",
        "date": "standing",
        "note": "A negative result carries weight only across the exposure range actually tested."
      },
      "enabled": true,
      "strength": 0.85
    },
    {
      "id": "R4",
      "name": "Applicability domain",
      "statement": "Evidence from a model operating outside its applicability domain is admitted with reduced weight, or excluded.",
      "framework": {
        "name": "OECD principles for the validation of QSAR models; standard QSAR regulatory acceptance criteria",
        "date": "standing",
        "note": "A prediction about a compound unlike the training set is a different kind of evidence."
      },
      "enabled": true,
      "strength": 0.5
    },
    {
      "id": "R5",
      "name": "Study reliability",
      "statement": "Higher-reliability studies defeat lower-reliability ones at equal mechanistic relevance.",
      "framework": {
        "name": "Klimisch et al. (1997) reliability scoring",
        "date": "1997",
        "note": "The standard reliability system used in regulatory toxicology submissions."
      },
      "enabled": true,
      "strength": 0.6
    },
    {
      "id": "R6",
      "name": "Concordance",
      "statement": "Independent sources agreeing raises confidence more than one source agreeing with itself.",
      "framework": {
        "name": "OECD weight-of-evidence and Integrated Approaches to Testing and Assessment guidance",
        "date": "standing",
        "note": "Formalised by the evidence fusion layer; independence is at the stream level."
      },
      "enabled": true,
      "strength": 0.4
    }
  ]
}
```

- [ ] **Step 4: Write `rules.ts`**

Create `packages/engine/src/rules.ts`:

```ts
import type { EvidenceClaim, RuleId, Ruleset } from "./types.js";

const ANIMAL_SYSTEMS = new Set(["rodent", "nonrodent"]);

function rule(ruleset: Ruleset, id: RuleId) {
  const r = ruleset.rules.find((x) => x.id === id);
  return r && r.enabled ? r : null;
}

/** Two claims conflict only when both commit to opposite conclusions. */
export function conflictsWith(a: EvidenceClaim, b: EvidenceClaim): boolean {
  if (a.assertion === "ambiguous" || b.assertion === "ambiguous") return false;
  return a.assertion !== b.assertion;
}

/**
 * Does `attacker` defeat `target`? Returns the deciding rule, or null.
 *
 * Rules are checked in precedence order R1 -> R2 -> R3 -> R5. R4 is not a
 * defeat rule (it downweights) and R6 is not pairwise (it is a set property).
 * The first rule that applies decides, so the ordering in this function IS
 * the preference ordering a toxicologist edits.
 */
export function defeats(
  attacker: EvidenceClaim,
  target: EvidenceClaim,
  ruleset: Ruleset,
): { byRule: RuleId; rationale: string } | null {
  if (attacker.id === target.id) return null;
  if (!conflictsWith(attacker, target)) return null;

  if (rule(ruleset, "R1") && attacker.system === "human" && ANIMAL_SYSTEMS.has(target.system)) {
    return { byRule: "R1", rationale: `Human-relevant evidence outranks ${target.system} in vivo for a human endpoint.` };
  }

  if (rule(ruleset, "R2") && attacker.measuresKeyEvent !== null && target.measuresKeyEvent === null) {
    return { byRule: "R2", rationale: `Direct measurement of key event ${attacker.measuresKeyEvent} outranks structural correlation.` };
  }

  if (
    rule(ruleset, "R3") &&
    attacker.assertion === "toxic" &&
    attacker.exposureRelevant === true &&
    target.assertion === "safe" &&
    target.exposureRelevant !== true
  ) {
    return { byRule: "R3", rationale: "A positive at clinically relevant exposure outranks a negative whose margin was never tested at that range." };
  }

  if (
    rule(ruleset, "R5") &&
    attacker.klimisch !== null &&
    target.klimisch !== null &&
    attacker.klimisch < target.klimisch &&
    attacker.measuresKeyEvent === target.measuresKeyEvent
  ) {
    return { byRule: "R5", rationale: `Klimisch ${attacker.klimisch} outranks Klimisch ${target.klimisch} at equal mechanistic relevance.` };
  }

  return null;
}

/** R4: reduce the weight of an out-of-domain prediction rather than defeating it. */
export function downweightFactor(
  claim: EvidenceClaim,
  ruleset: Ruleset,
): { factor: number; byRule: RuleId; rationale: string } | null {
  const r = rule(ruleset, "R4");
  if (!r) return null;
  if (claim.inApplicabilityDomain !== false) return null;
  return {
    factor: 1 - r.strength,
    byRule: "R4",
    rationale: "Prediction falls outside the model's applicability domain; admitted with reduced weight.",
  };
}

/**
 * R6: a multiplier rewarding agreement across DISTINCT streams.
 *
 * Counting claims would reward a chatty source; counting distinct streams
 * rewards genuine independence, which is what weight-of-evidence means.
 */
export function concordanceBoost(claims: EvidenceClaim[], ruleset: Ruleset): number {
  const r = rule(ruleset, "R6");
  if (!r || claims.length === 0) return 1;
  const committed = claims.filter((c) => c.assertion !== "ambiguous");
  if (committed.length === 0) return 1;
  const majority = committed.filter((c) => c.assertion === committed[0]!.assertion);
  const distinctStreams = new Set(majority.map((c) => c.stream)).size;
  return 1 + r.strength * Math.max(0, distinctStreams - 1) * 0.25;
}
```

- [ ] **Step 5: Write the hash utility (harness side, so the engine stays crypto-free)**

Create `apps/harness/package.json`:

```json
{
  "name": "@arbiter/harness",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": { "@arbiter/engine": "1.0.0", "zod": "^3.23.8" }
}
```

Create `apps/harness/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "references": [{ "path": "../../packages/engine" }],
  "include": ["src/**/*"]
}
```

Create `apps/harness/src/hash.ts`:

```ts
import { createHash } from "node:crypto";

/**
 * SHA-256 of the pre-registration surface of a ruleset.
 *
 * Hashes only the fields a toxicologist pre-registers - rules, thresholds,
 * binarisation policy - with object keys sorted, so the hash is stable
 * against JSON formatting and against fields we add later for display.
 */
export function rulesetHash(ruleset: unknown): string {
  return createHash("sha256").update(canonical(ruleset)).digest("hex");
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`).join(",")}}`;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm install && npm test -- packages/engine/test/rules.test.ts && npm run lint
```

Expected: PASS (11 tests), lint clean. The `no rule justification cites TAK-994` test is the one that keeps the circularity fix honest.

- [ ] **Step 7: Commit the ruleset separately, and record the timestamp**

The pre-registration claim rests on this commit existing before any evaluation. Commit it on its own so the git history shows it unambiguously.

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && git add rules/ruleset-v1.0.json && git commit -m "Pre-register ruleset v1.0 before any evaluation

R1-R6, the abstention gap threshold (0.50), and the DILIrank binarisation
policy, committed before any benchmark has been run. This commit is the
pre-registration; its timestamp and the file's SHA-256 are the answer to
'did you tune the rules to fit DILIrank'.

Every rule justification cites a published framework only. No rule cites
TAK-994 - deriving a rule from the hero case and then demonstrating the rule
on that case would be circular, and an automated test now asserts the
absence.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>" && git rev-parse HEAD && git log -1 --format=%cI
```

Record the printed commit hash and ISO timestamp — they go on the Validation tab in Phase 2.

```bash
git add packages/engine apps/harness package-lock.json && git commit -m "Add R1-R6 predicates and the ruleset hash utility

Rules are checked in precedence order inside defeats(), so the ordering in
that function IS the preference ordering a toxicologist edits. R4 downweights
rather than defeating; R6 is a set property over distinct streams, so a
chatty single source cannot manufacture concordance.

rulesetHash lives in the harness rather than the engine, keeping node:crypto
out of the engine's import surface. It canonicalises with sorted keys so the
hash is stable against JSON formatting.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Defeasible argumentation with reinstatement

**This task is what earns the word "argumentation."** A flat decision table cannot express reinstatement — A defeats B, C defeats A, therefore B comes back. If this is not implemented, calling the system defeasible argumentation is overselling and a technical judge would be right to call it a lookup table with extra steps.

**Files:**
- Create: `packages/engine/src/argue.ts`
- Test: `packages/engine/test/argue.test.ts`

**Interfaces:**
- Consumes: `defeats`, `downweightFactor` from `rules.ts`; `EvidenceClaim`, `Ruleset`, `ClaimStatus`, `TraceStep`, `RuleId`
- Produces:
  - `interface Attack { attackerId: string; targetId: string; byRule: RuleId; rationale: string }`
  - `interface Argumentation { statuses: Map<string, ClaimStatus>; attacks: Attack[]; trace: TraceStep[] }`
  - `argue(claims: EvidenceClaim[], ruleset: Ruleset): Argumentation`

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/argue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { argue } from "../src/argue.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "test", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("argue", () => {
  it("admits an unopposed claim", () => {
    const r = argue([claim({ id: "a", assertion: "toxic" })], RS);
    expect(r.statuses.get("a")).toBe("admitted");
    expect(r.attacks).toHaveLength(0);
  });

  it("defeats the loser of a one-way attack", () => {
    // Human toxic defeats rodent safe by R1. Rodent cannot attack back.
    const human = claim({ id: "h", assertion: "toxic", system: "human", klimisch: 1 });
    const rat = claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 2 });
    const r = argue([human, rat], RS);
    expect(r.statuses.get("h")).toBe("admitted");
    expect(r.statuses.get("r")).toBe("defeated");
    expect(r.attacks).toEqual([
      expect.objectContaining({ attackerId: "h", targetId: "r", byRule: "R1" }),
    ]);
  });

  it("REINSTATEMENT: A defeats B, C defeats A, therefore B is reinstated", () => {
    // A: human cytotox, toxic, no key event, Klimisch 1  -> defeats B by R1
    // B: rat in vivo, safe, no key event, Klimisch 2
    // C: human toxicogenomics, safe, measures KE:1       -> defeats A by R2
    // C does not conflict with B (both safe), so B's only attacker is A.
    const A = claim({ id: "A", assertion: "toxic", system: "human", stream: "cytotox", measuresKeyEvent: null, klimisch: 1 });
    const B = claim({ id: "B", assertion: "safe", system: "rodent", stream: "invivo_rodent", measuresKeyEvent: null, klimisch: 2 });
    const C = claim({ id: "C", assertion: "safe", system: "human", stream: "toxicogenomics", measuresKeyEvent: "KE:1", klimisch: 2 });

    const r = argue([A, B, C], RS);

    expect(r.statuses.get("C")).toBe("admitted");
    expect(r.statuses.get("A")).toBe("defeated");
    // The whole point: B was defeated by A, but A fell, so B comes back.
    expect(r.statuses.get("B")).toBe("admitted");

    const bStep = r.trace.find((s) => s.claimId === "B")!;
    expect(bStep.rationale).toMatch(/reinstat/i);
  });

  it("leaves both claims undecided under mutual attack", () => {
    // Equal Klimisch, same system, same key-event status: no rule can separate
    // them, so neither is defeated and neither is admitted.
    const a = claim({ id: "a", assertion: "toxic", klimisch: 2 });
    const b = claim({ id: "b", assertion: "safe", klimisch: 2 });
    const r = argue([a, b], RS);
    expect(r.statuses.get("a")).toBe("undecided");
    expect(r.statuses.get("b")).toBe("undecided");
  });

  it("marks an out-of-domain claim downweighted, not defeated", () => {
    const r = argue([claim({ id: "q", stream: "qsar", system: "in_silico", inApplicabilityDomain: false })], RS);
    expect(r.statuses.get("q")).toBe("downweighted");
    expect(r.trace.find((s) => s.claimId === "q")?.byRule).toBe("R4");
  });

  it("emits exactly one trace step per claim", () => {
    const claims = ["a", "b", "c"].map((id) => claim({ id, assertion: id === "a" ? "toxic" : "safe" }));
    const r = argue(claims, RS);
    expect(r.trace.map((s) => s.claimId).sort()).toEqual(["a", "b", "c"]);
  });

  it("is order-independent", () => {
    const A = claim({ id: "A", assertion: "toxic", system: "human", klimisch: 1 });
    const B = claim({ id: "B", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 2 });
    const fwd = argue([A, B], RS);
    const rev = argue([B, A], RS);
    expect(fwd.statuses.get("A")).toBe(rev.statuses.get("A"));
    expect(fwd.statuses.get("B")).toBe(rev.statuses.get("B"));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/argue.test.ts
```

Expected: FAIL — `Cannot find module '../src/argue.js'`

- [ ] **Step 3: Write the implementation**

Create `packages/engine/src/argue.ts`:

```ts
import { defeats, downweightFactor } from "./rules.js";
import type { ClaimStatus, EvidenceClaim, RuleId, Ruleset, TraceStep } from "./types.js";

export interface Attack {
  attackerId: string;
  targetId: string;
  byRule: RuleId;
  rationale: string;
}

export interface Argumentation {
  statuses: Map<string, ClaimStatus>;
  attacks: Attack[];
  trace: TraceStep[];
}

/**
 * Defeasible argumentation under grounded semantics.
 *
 * The attack graph is induced by the preference ordering in rules.ts. We then
 * compute the grounded extension by the standard characteristic-function
 * fixpoint: a claim is IN when every one of its attackers is OUT, and OUT when
 * some IN claim attacks it. Iterating to a fixpoint is what produces
 * REINSTATEMENT for free - if A defeats B and C defeats A, then C goes IN, A
 * goes OUT, and on the next pass B's only attacker is OUT so B goes back IN.
 *
 * Claims that never settle are UNDECIDED. That is a real state, not a bug: two
 * equally-ranked opposed sources is genuine conflict, and the honest answer is
 * that neither wins.
 */
export function argue(claims: EvidenceClaim[], ruleset: Ruleset): Argumentation {
  const attacks: Attack[] = [];
  for (const attacker of claims) {
    for (const target of claims) {
      const d = defeats(attacker, target, ruleset);
      if (d) attacks.push({ attackerId: attacker.id, targetId: target.id, byRule: d.byRule, rationale: d.rationale });
    }
  }

  const attackersOf = new Map<string, Attack[]>();
  for (const c of claims) attackersOf.set(c.id, []);
  for (const a of attacks) attackersOf.get(a.targetId)!.push(a);

  const IN = new Set<string>();
  const OUT = new Set<string>();
  const settled = (id: string) => IN.has(id) || OUT.has(id);

  // Fixpoint. Bounded by claims.length iterations - each pass settles at least
  // one claim or we stop, so this cannot loop forever.
  for (let pass = 0; pass <= claims.length; pass++) {
    const newlyIn = claims
      .filter((c) => !settled(c.id))
      .filter((c) => attackersOf.get(c.id)!.every((a) => OUT.has(a.attackerId)))
      .map((c) => c.id);
    if (newlyIn.length === 0) break;
    for (const id of newlyIn) IN.add(id);

    for (const c of claims) {
      if (settled(c.id)) continue;
      if (attackersOf.get(c.id)!.some((a) => IN.has(a.attackerId))) OUT.add(c.id);
    }
  }

  const statuses = new Map<string, ClaimStatus>();
  const trace: TraceStep[] = [];

  for (const c of claims) {
    const incoming = attackersOf.get(c.id)!;

    if (OUT.has(c.id)) {
      const killer = incoming.find((a) => IN.has(a.attackerId))!;
      statuses.set(c.id, "defeated");
      trace.push({
        claimId: c.id,
        status: "defeated",
        byRule: killer.byRule,
        defeatedBy: killer.attackerId,
        rationale: killer.rationale,
      });
      continue;
    }

    if (!IN.has(c.id)) {
      statuses.set(c.id, "undecided");
      trace.push({
        claimId: c.id,
        status: "undecided",
        rationale: "Opposed by evidence of equal standing; no rule separates them. Contributes uncommitted mass only.",
      });
      continue;
    }

    // IN. Two sub-cases: R4 downweighting, and reinstatement.
    const dw = downweightFactor(c, ruleset);
    if (dw) {
      statuses.set(c.id, "downweighted");
      trace.push({ claimId: c.id, status: "downweighted", byRule: dw.byRule, rationale: dw.rationale });
      continue;
    }

    statuses.set(c.id, "admitted");
    const wasAttacked = incoming.length > 0;
    trace.push({
      claimId: c.id,
      status: "admitted",
      rationale: wasAttacked
        ? `Reinstated: attacked by ${incoming.map((a) => a.attackerId).join(", ")}, but every attacker was itself defeated.`
        : "Admitted; unchallenged.",
    });
  }

  return { statuses, attacks, trace };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/argue.test.ts && npm run lint
```

Expected: PASS (7 tests), lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "Add defeasible argumentation with reinstatement

Grounded semantics over the attack graph induced by R1-R6, computed as a
characteristic-function fixpoint. Reinstatement falls out of the iteration
rather than being special-cased: if A defeats B and C defeats A, then C goes
IN, A goes OUT, and on the next pass B's only attacker is OUT so B returns.
There is an explicit test for exactly that chain, because reinstatement is
what distinguishes argumentation from a decision table.

UNDECIDED is a real status, not an error path - two equally-ranked opposed
sources is genuine conflict, and the honest output is that neither wins. Those
claims contribute uncommitted mass only.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Abstention, conflict detection, and enforced determinism

**Files:**
- Create: `packages/engine/src/abstain.ts`, `packages/engine/src/conflict.ts`
- Test: `packages/engine/test/abstain.test.ts`, `packages/engine/test/conflict.test.ts`

**Interfaces:**
- Consumes: `EvidenceClaim`, `Ruleset`, `ClaimStatus`
- Produces:
  - `shouldAbstain(input: { belief: number; plausibility: number; conflictMass: number; statuses: Map<string, ClaimStatus>; claims: EvidenceClaim[]; ruleset: Ruleset }): { abstain: boolean; reason: string | null }`
  - `detectConflict(claims: EvidenceClaim[]): { conflicting: boolean; opposedStreams: string[] }`

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/abstain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldAbstain } from "../src/abstain.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { ClaimStatus, EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;
const base = { statuses: new Map<string, ClaimStatus>(), claims: [] as EvidenceClaim[], ruleset: RS };

describe("shouldAbstain", () => {
  it("abstains when the gap exceeds the pre-registered threshold", () => {
    // threshold is 0.50; gap here is 0.70
    const r = shouldAbstain({ ...base, belief: 0.1, plausibility: 0.8, conflictMass: 0 });
    expect(r.abstain).toBe(true);
    expect(r.reason).toMatch(/gap/i);
  });

  it("does NOT abstain one step below the threshold", () => {
    const r = shouldAbstain({ ...base, belief: 0.2, plausibility: 0.69, conflictMass: 0 });
    expect(r.abstain).toBe(false);
    expect(r.reason).toBeNull();
  });

  it("uses the threshold from the ruleset, not a hard-coded constant", () => {
    const strict: Ruleset = { ...RS, abstentionGapThreshold: 0.05 };
    const r = shouldAbstain({ ...base, belief: 0.4, plausibility: 0.5, conflictMass: 0, ruleset: strict });
    expect(r.abstain).toBe(true);
  });

  it("abstains on total conflict", () => {
    const r = shouldAbstain({ ...base, belief: 0, plausibility: 1, conflictMass: 1 });
    expect(r.abstain).toBe(true);
    expect(r.reason).toMatch(/conflict/i);
  });

  it("abstains when every committed claim is out of its applicability domain", () => {
    const claims: EvidenceClaim[] = [{
      id: "q", compoundId: "X", stream: "qsar", assertion: "toxic", strength: 0.9,
      system: "in_silico", measuresKeyEvent: null, exposureRelevant: null,
      inApplicabilityDomain: false, klimisch: null, availableFrom: "2020-01-01",
      provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    }];
    const statuses = new Map<string, ClaimStatus>([["q", "downweighted"]]);
    const r = shouldAbstain({ belief: 0.3, plausibility: 0.4, conflictMass: 0, statuses, claims, ruleset: RS });
    expect(r.abstain).toBe(true);
    expect(r.reason).toMatch(/applicability domain/i);
  });
});
```

Create `packages/engine/test/conflict.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectConflict } from "../src/conflict.js";
import type { EvidenceClaim } from "../src/types.js";

function claim(id: string, assertion: EvidenceClaim["assertion"], stream: EvidenceClaim["stream"]): EvidenceClaim {
  return {
    id, compoundId: "X", stream, assertion, strength: 0.8, system: "human",
    measuresKeyEvent: null, exposureRelevant: null, inApplicabilityDomain: true,
    klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
  };
}

describe("detectConflict", () => {
  it("is a conflict only when two DIFFERENT streams commit to opposite verdicts", () => {
    const r = detectConflict([claim("a", "toxic", "cytotox"), claim("b", "safe", "transporter")]);
    expect(r.conflicting).toBe(true);
    expect(r.opposedStreams.sort()).toEqual(["cytotox", "transporter"]);
  });

  it("is not a conflict within a single stream", () => {
    expect(detectConflict([claim("a", "toxic", "cytotox"), claim("b", "safe", "cytotox")]).conflicting).toBe(false);
  });

  it("ignores ambiguous claims", () => {
    expect(detectConflict([claim("a", "toxic", "cytotox"), claim("b", "ambiguous", "qsar")]).conflicting).toBe(false);
  });

  it("is not a conflict when all streams agree", () => {
    expect(detectConflict([claim("a", "toxic", "cytotox"), claim("b", "toxic", "qsar")]).conflicting).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/abstain.test.ts packages/engine/test/conflict.test.ts
```

Expected: FAIL — both modules missing.

- [ ] **Step 3: Write the implementations**

Create `packages/engine/src/abstain.ts`:

```ts
import type { ClaimStatus, EvidenceClaim, Ruleset } from "./types.js";

/**
 * Decide whether to decline a verdict.
 *
 * Abstention is a first-class output, not a failure. On a compound where the
 * evidence cannot settle the question, "I cannot vouch for this yet" is the
 * correct answer and a confident guess would be dangerous.
 *
 * The gap threshold comes from the PRE-REGISTERED ruleset, never a constant in
 * this file - so it cannot be tuned after seeing results.
 */
export function shouldAbstain(input: {
  belief: number;
  plausibility: number;
  conflictMass: number;
  statuses: Map<string, ClaimStatus>;
  claims: EvidenceClaim[];
  ruleset: Ruleset;
}): { abstain: boolean; reason: string | null } {
  const { belief, plausibility, conflictMass, claims, ruleset } = input;

  if (conflictMass >= 1 - 1e-9) {
    return { abstain: true, reason: "Total conflict between sources; no conclusion survives combination." };
  }

  const committed = claims.filter((c) => c.assertion !== "ambiguous");
  if (committed.length > 0 && committed.every((c) => c.inApplicabilityDomain === false)) {
    return {
      abstain: true,
      reason: "Every committed source lies outside its applicability domain; this compound is off the map.",
    };
  }

  const gap = plausibility - belief;
  if (gap > ruleset.abstentionGapThreshold) {
    return {
      abstain: true,
      reason: `Belief-to-plausibility gap ${gap.toFixed(2)} exceeds the pre-registered threshold ${ruleset.abstentionGapThreshold.toFixed(2)}.`,
    };
  }

  return { abstain: false, reason: null };
}
```

Create `packages/engine/src/conflict.ts`:

```ts
import type { EvidenceClaim } from "./types.js";

/**
 * A compound is in the conflict subset when two DIFFERENT streams commit to
 * opposite conclusions.
 *
 * Stream-level rather than claim-level on purpose: two disagreeing readouts
 * from one assay is measurement noise, whereas a hepatocyte assay disagreeing
 * with a transporter assay is the situation ARBITER exists for. Ambiguous
 * claims never create a conflict - they commit to nothing.
 */
export function detectConflict(claims: EvidenceClaim[]): { conflicting: boolean; opposedStreams: string[] } {
  const committed = claims.filter((c) => c.assertion !== "ambiguous");
  const toxicStreams = new Set(committed.filter((c) => c.assertion === "toxic").map((c) => c.stream));
  const safeStreams = new Set(committed.filter((c) => c.assertion === "safe").map((c) => c.stream));

  const opposed: string[] = [];
  for (const s of toxicStreams) if (!safeStreams.has(s)) opposed.push(s);
  for (const s of safeStreams) if (!toxicStreams.has(s)) opposed.push(s);

  const conflicting = toxicStreams.size > 0 && safeStreams.size > 0 && opposed.length >= 2;
  return { conflicting, opposedStreams: conflicting ? opposed.sort() : [] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/abstain.test.ts packages/engine/test/conflict.test.ts && npm run lint
```

Expected: PASS (9 tests), lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/engine && git commit -m "Add abstention and stream-level conflict detection

Abstention fires on total conflict, on every committed source being outside
its applicability domain, or on the belief-plausibility gap exceeding the
threshold - and the threshold is read from the pre-registered ruleset rather
than hard-coded here, so it cannot be tuned after seeing results.

Conflict is defined at STREAM level, not claim level: two disagreeing readouts
from one assay is measurement noise, while a hepatocyte assay disagreeing with
a transporter assay is the situation the product exists for.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `reason()` — the public entry point, and the determinism guarantee

**Files:**
- Create: `packages/engine/src/index.ts`
- Modify: `packages/engine/src/fuse.ts` — additively extend `fuse`'s return with `mass`
- Test: `packages/engine/test/reason.test.ts`, `packages/engine/test/determinism.test.ts`

**Interfaces:**
- Consumes: `argue`, `fuse`, `claimToMass`, `shouldAbstain`, `concordanceBoost`
- Produces:
  - `reason(claims: EvidenceClaim[], ruleset: Ruleset, rulesetHash?: string): Reasoning`
  - Re-exports every public type and the sub-module functions
  - `fuse` now also returns `mass: Mass` (additive — Task 3's tests are unaffected)

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/reason.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reason } from "../src/index.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("reason", () => {
  it("abstains on no evidence at all, with a maximally wide range", () => {
    const r = reason([], RS);
    expect(r.verdict).toBe("abstain");
    expect(r.belief).toBeCloseTo(0, 10);
    expect(r.plausibility).toBeCloseTo(1, 10);
  });

  it("advances on unanimous strong safe evidence across streams", () => {
    const r = reason([
      claim({ id: "a", assertion: "safe", strength: 0.9, stream: "cytotox" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, stream: "transporter" }),
    ], RS);
    expect(r.verdict).toBe("advance");
    expect(r.contested).toBe(false);
  });

  it("does not advance when the surviving evidence says toxic", () => {
    const r = reason([
      claim({ id: "h", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1 }),
      claim({ id: "r", assertion: "safe", strength: 0.9, system: "rodent", stream: "invivo_rodent", klimisch: 2 }),
    ], RS);
    expect(r.verdict).toBe("do_not_advance");
    // The defeated rodent claim is still in the trace - nothing is hidden.
    expect(r.trace.find((s) => s.claimId === "r")?.status).toBe("defeated");
    expect(r.trace.find((s) => s.claimId === "r")?.byRule).toBe("R1");
  });

  it("excludes defeated claims from fusion but keeps them in the trace", () => {
    const withDefeat = reason([
      claim({ id: "h", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1 }),
      claim({ id: "r", assertion: "safe", strength: 0.99, system: "rodent", stream: "invivo_rodent", klimisch: 2 }),
    ], RS);
    const alone = reason([claim({ id: "h", assertion: "toxic", strength: 0.9, system: "human", klimisch: 1 })], RS);
    // The very strong defeated claim must not drag belief down.
    expect(withDefeat.belief).toBeCloseTo(alone.belief, 10);
    expect(withDefeat.trace).toHaveLength(2);
  });

  it("marks a case contested when both sides survive", () => {
    const r = reason([
      claim({ id: "a", assertion: "toxic", klimisch: 2, stream: "cytotox" }),
      claim({ id: "b", assertion: "safe", klimisch: 2, stream: "transporter" }),
    ], RS);
    expect(r.contested).toBe(true);
  });

  it("carries the ruleset hash through to the output", () => {
    expect(reason([], RS, "deadbeef").rulesetHash).toBe("deadbeef");
  });

  it("emits belief <= plausibility always", () => {
    const r = reason([claim({ id: "a", assertion: "toxic", strength: 0.5 })], RS);
    expect(r.belief).toBeLessThanOrEqual(r.plausibility);
  });
});
```

Create `packages/engine/test/determinism.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { reason } from "../src/index.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;

const CLAIMS: EvidenceClaim[] = [
  { id: "a", compoundId: "X", stream: "qsar", assertion: "ambiguous", strength: 0.5, system: "in_silico", measuresKeyEvent: null, exposureRelevant: null, inApplicabilityDomain: true, klimisch: null, availableFrom: "2020-01", provenance: { kind: "database", source: "t", retrieved: "2026-07-26" } },
  { id: "b", compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8, system: "human", measuresKeyEvent: null, exposureRelevant: true, inApplicabilityDomain: true, klimisch: 1, availableFrom: "2020-01", provenance: { kind: "database", source: "t", retrieved: "2026-07-26" } },
  { id: "c", compoundId: "X", stream: "toxicogenomics", assertion: "toxic", strength: 0.7, system: "rodent", measuresKeyEvent: "KE:1", exposureRelevant: true, inApplicabilityDomain: true, klimisch: 2, availableFrom: "2022-01", provenance: { kind: "literature", source: "PMID:1", retrieved: "2026-07-26" } },
  { id: "d", compoundId: "X", stream: "transporter", assertion: "safe", strength: 0.6, system: "human", measuresKeyEvent: "KE:2", exposureRelevant: null, inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01", provenance: { kind: "database", source: "t", retrieved: "2026-07-26" } },
];

describe("determinism", () => {
  it("produces exactly ONE output hash across 1000 runs", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      hashes.add(createHash("sha256").update(JSON.stringify(reason(CLAIMS, RS, "h"))).digest("hex"));
    }
    expect(hashes.size).toBe(1);
  });

  it("does not mutate its inputs", () => {
    const before = JSON.stringify({ CLAIMS, RS });
    reason(CLAIMS, RS, "h");
    expect(JSON.stringify({ CLAIMS, RS })).toBe(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/reason.test.ts packages/engine/test/determinism.test.ts
```

Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 3: Extend `fuse` additively to expose the full mass**

`reason()` needs `mass.safe` to compare the two beliefs, which Task 3's return type does not carry. Add it — a purely additive change, so every Task 3 test still passes.

In `packages/engine/src/fuse.ts`, change the `fuse` signature and its return statement only:

```ts
export function fuse(masses: Mass[]): { belief: number; plausibility: number; conflictMass: number; mass: Mass } {
  let acc: Mass = { ...VACUOUS };
  let maxConflict = 0;
  for (const m of masses) {
    const { mass, conflict } = combine(acc, m);
    acc = mass;
    if (conflict > maxConflict) maxConflict = conflict;
  }
  return { belief: acc.toxic, plausibility: acc.toxic + acc.uncommitted, conflictMass: maxConflict, mass: acc };
}
```

- [ ] **Step 4: Write `index.ts`**

Create `packages/engine/src/index.ts`:

```ts
import { shouldAbstain } from "./abstain.js";
import { argue } from "./argue.js";
import { detectConflict } from "./conflict.js";
import { VACUOUS, claimToMass, fuse, type Mass } from "./fuse.js";
import { concordanceBoost } from "./rules.js";
import type { EvidenceClaim, Reasoning, Ruleset, Verdict } from "./types.js";

export * from "./types.js";
export { EvidenceClaimSchema, EvidenceFileSchema, RulesetSchema } from "./schema.js";
export { VACUOUS, claimToMass, combine, fuse } from "./fuse.js";
export { concordanceBoost, conflictsWith, defeats, downweightFactor } from "./rules.js";
export { argue } from "./argue.js";
export { detectConflict } from "./conflict.js";
export { shouldAbstain } from "./abstain.js";

/** Shift a claim's committed mass toward Theta by `factor`. Used for R4 and UNDECIDED. */
function soften(m: Mass, factor: number): Mass {
  const toxic = m.toxic * factor;
  const safe = m.safe * factor;
  return { toxic, safe, uncommitted: 1 - toxic - safe };
}

/**
 * ARBITER's only public entry point.
 *
 * PURE: no I/O, no clock, no randomness. Filtering claims by `availableFrom`
 * for as-of replay is the CALLER's job - the engine cannot read a clock, which
 * is exactly why the as-of control is a change of input rather than a change
 * of behaviour.
 */
export function reason(claims: EvidenceClaim[], ruleset: Ruleset, rulesetHash = ""): Reasoning {
  const { statuses, trace } = argue(claims, ruleset);

  const masses: Mass[] = [];
  for (const c of claims) {
    switch (statuses.get(c.id)) {
      case "admitted":
        masses.push(claimToMass(c.assertion, c.strength));
        break;
      case "downweighted": {
        // R4: admitted with reduced weight rather than excluded.
        const r4 = ruleset.rules.find((x) => x.id === "R4");
        masses.push(soften(claimToMass(c.assertion, c.strength), r4?.enabled ? 1 - r4.strength : 1));
        break;
      }
      case "undecided":
        // Contributes ignorance, not a vote. This is the fusion-vs-averaging
        // distinction applied to the argumentation layer.
        masses.push({ ...VACUOUS });
        break;
      default:
        break; // defeated: excluded from fusion, retained in the trace
    }
  }

  const admitted = claims.filter((c) => statuses.get(c.id) === "admitted");
  const boost = concordanceBoost(admitted, ruleset);
  const fused = fuse(masses);

  // R6 sharpens a concordant conclusion by moving uncommitted mass onto the
  // side the independent streams agree on. It cannot exceed total mass.
  const lean: "toxic" | "safe" | null =
    fused.mass.toxic > fused.mass.safe ? "toxic" : fused.mass.safe > fused.mass.toxic ? "safe" : null;
  let mass = fused.mass;
  if (lean && boost > 1) {
    const move = Math.min(mass.uncommitted, mass[lean] * (boost - 1));
    mass = lean === "toxic"
      ? { toxic: mass.toxic + move, safe: mass.safe, uncommitted: mass.uncommitted - move }
      : { toxic: mass.toxic, safe: mass.safe + move, uncommitted: mass.uncommitted - move };
  }

  const belief = mass.toxic;
  const plausibility = mass.toxic + mass.uncommitted;

  const abst = shouldAbstain({ belief, plausibility, conflictMass: fused.conflictMass, statuses, claims, ruleset });

  let verdict: Verdict;
  if (abst.abstain) verdict = "abstain";
  else if (mass.toxic > mass.safe) verdict = "do_not_advance";
  else if (mass.safe > mass.toxic) verdict = "advance";
  else verdict = "abstain"; // exactly balanced: declining is the honest answer

  const survivors = claims.filter((c) => {
    const s = statuses.get(c.id);
    return s === "admitted" || s === "downweighted";
  });
  const contested = detectConflict(survivors).conflicting || fused.conflictMass > 0;

  const withReason = abst.reason
    ? [...trace, { claimId: "__verdict__", status: "undecided" as const, rationale: abst.reason }]
    : trace;

  return {
    verdict,
    contested,
    belief,
    plausibility,
    conflictMass: fused.conflictMass,
    trace: withReason,
    counterfactual: null, // Task 8
    nextExperiment: null, // Task 9
    rulesetHash,
  };
}
```

- [ ] **Step 5: Run the full engine suite to verify everything passes**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine && npm run lint && npm run typecheck
```

Expected: PASS — all engine tests including Task 3's fusion tests (the `fuse` change was additive), 1000-run determinism gives exactly one hash, lint and typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/engine && git commit -m "Add reason() and the enforced determinism guarantee

Wires argue -> fuse -> abstain into a Reasoning result. Status decides how a
claim reaches fusion: admitted contributes full mass, R4-downweighted
contributes softened mass, UNDECIDED contributes pure ignorance rather than a
vote, and defeated is excluded from fusion but RETAINED IN THE TRACE - a test
asserts a very strong defeated claim cannot drag belief, and that it still
appears in the output.

Determinism is now a measured property, not a claim: one case, 1000 runs, one
output hash. A second test asserts reason() does not mutate its inputs.

fuse() gained a `mass` field additively so reason() can compare belief in
toxic against belief in safe; Task 3's tests are unaffected.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Exhaustive counterfactual

**Files:**
- Create: `packages/engine/src/counterfactual.ts`
- Modify: `packages/engine/src/index.ts` — populate `counterfactual`
- Test: `packages/engine/test/counterfactual.test.ts`

**Interfaces:**
- Consumes: `reason` (injected to avoid a circular import), `EvidenceClaim`, `Ruleset`, `Counterfactual`
- Produces: `findCounterfactual(claims, ruleset, currentVerdict, reasonFn): Counterfactual | null`

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/test/counterfactual.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reason } from "../src/index.js";
import { findCounterfactual } from "../src/counterfactual.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import type { Assertion, EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    ...over,
  };
}

/** Brute-force oracle: try every subset up to size 2 and every target assertion. */
function oracle(claims: EvidenceClaim[], rs: Ruleset): { size: number } | null {
  const current = reason(claims, rs).verdict;
  const targets: Assertion[] = ["toxic", "safe", "ambiguous"];
  for (const size of [1, 2]) {
    const subsets = size === 1
      ? claims.map((c) => [c])
      : claims.flatMap((a, i) => claims.slice(i + 1).map((b) => [a, b]));
    for (const subset of subsets) {
      for (const t of targets) {
        const flipped = claims.map((c) =>
          subset.some((s) => s.id === c.id) ? { ...c, assertion: t } : c,
        );
        if (reason(flipped, rs).verdict !== current) return { size };
      }
    }
  }
  return null;
}

describe("findCounterfactual", () => {
  it("finds a single-claim flip when one exists", () => {
    const claims = [
      claim({ id: "a", assertion: "safe", strength: 0.9, stream: "cytotox" }),
      claim({ id: "b", assertion: "safe", strength: 0.9, stream: "transporter" }),
    ];
    const cf = findCounterfactual(claims, RS, reason(claims, RS).verdict, reason);
    expect(cf).not.toBeNull();
    expect(cf!.claimIds).toHaveLength(1);
    expect(cf!.newVerdict).not.toBe(reason(claims, RS).verdict);
  });

  it("prefers the smallest flip - never reports a pair when a single works", () => {
    const claims = [
      claim({ id: "a", assertion: "safe", strength: 0.95, stream: "cytotox" }),
      claim({ id: "b", assertion: "safe", strength: 0.95, stream: "transporter" }),
      claim({ id: "c", assertion: "safe", strength: 0.95, stream: "qsar", system: "in_silico" }),
    ];
    const cf = findCounterfactual(claims, RS, reason(claims, RS).verdict, reason);
    if (cf) expect(cf.claimIds).toHaveLength(1);
  });

  it("returns null when nothing within two flips changes the verdict", () => {
    const cf = findCounterfactual([], RS, reason([], RS).verdict, reason);
    expect(cf).toBeNull();
  });

  it("AGREES WITH THE BRUTE-FORCE ORACLE on deterministic random cases", () => {
    let s = 987654;
    const next = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const streams = ["qsar", "cytotox", "toxicogenomics", "transporter"] as const;
    const assertions: Assertion[] = ["toxic", "safe", "ambiguous"];

    for (let trial = 0; trial < 120; trial++) {
      const n = 1 + Math.floor(next() * 4);
      const claims = Array.from({ length: n }, (_, i) =>
        claim({
          id: `c${i}`,
          stream: streams[Math.floor(next() * streams.length)]!,
          assertion: assertions[Math.floor(next() * assertions.length)]!,
          strength: 0.4 + next() * 0.6,
          klimisch: (1 + Math.floor(next() * 4)) as 1 | 2 | 3 | 4,
        }),
      );
      const found = findCounterfactual(claims, RS, reason(claims, RS).verdict, reason);
      const expected = oracle(claims, RS);
      expect(found === null).toBe(expected === null);
      if (found && expected) expect(found.claimIds.length).toBe(expected.size);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/counterfactual.test.ts
```

Expected: FAIL — `Cannot find module '../src/counterfactual.js'`

- [ ] **Step 3: Write the implementation**

Create `packages/engine/src/counterfactual.ts`:

```ts
import type { Assertion, Counterfactual, EvidenceClaim, Reasoning, Ruleset, Verdict } from "./types.js";

const TARGETS: Assertion[] = ["toxic", "safe", "ambiguous"];

/**
 * "What would have to change for this verdict to flip?"
 *
 * EXHAUSTIVE, not heuristic. With at most six claims per compound the search
 * space is 6 single flips plus 15 pairs, times three target assertions - well
 * under 100 evaluations of a pure microsecond-scale function. So we search
 * singles first, then pairs, and return the smallest set. There is no
 * approximation to defend in Q&A.
 *
 * `reasonFn` is injected rather than imported to keep index.ts -> here a
 * one-way dependency.
 */
export function findCounterfactual(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  currentVerdict: Verdict,
  reasonFn: (claims: EvidenceClaim[], ruleset: Ruleset) => Reasoning,
): Counterfactual | null {
  const flip = (ids: Set<string>, to: Assertion) =>
    claims.map((c) => (ids.has(c.id) ? { ...c, assertion: to } : c));

  // Singles.
  for (const c of claims) {
    for (const to of TARGETS) {
      if (c.assertion === to) continue;
      const v = reasonFn(flip(new Set([c.id]), to), ruleset).verdict;
      if (v !== currentVerdict) return { claimIds: [c.id], flipTo: to, newVerdict: v };
    }
  }

  // Pairs.
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const ids = new Set([claims[i]!.id, claims[j]!.id]);
      for (const to of TARGETS) {
        const v = reasonFn(flip(ids, to), ruleset).verdict;
        if (v !== currentVerdict) return { claimIds: [...ids], flipTo: to, newVerdict: v };
      }
    }
  }

  return null;
}
```

- [ ] **Step 4: Wire it into `reason()`**

In `packages/engine/src/index.ts`, add the import and replace the `counterfactual: null` line.

```ts
import { findCounterfactual } from "./counterfactual.js";
export { findCounterfactual } from "./counterfactual.js";
```

Replace the `return { ... }` block's counterfactual field. Because the search calls `reason` recursively, guard against infinite recursion with an internal flag: extract the body of `reason` into `reasonCore(claims, ruleset, rulesetHash, withExtras)` and have `reason` call it with `withExtras = true`, while the counterfactual search passes a bound `reasonCore(..., false)`.

```ts
export function reason(claims: EvidenceClaim[], ruleset: Ruleset, rulesetHash = ""): Reasoning {
  return reasonCore(claims, ruleset, rulesetHash, true);
}

const bare = (c: EvidenceClaim[], rs: Ruleset) => reasonCore(c, rs, "", false);

function reasonCore(claims: EvidenceClaim[], ruleset: Ruleset, rulesetHash: string, withExtras: boolean): Reasoning {
  /* ...everything from Task 7, unchanged, down to the return... */
  return {
    verdict, contested, belief, plausibility,
    conflictMass: fused.conflictMass,
    trace: withReason,
    counterfactual: withExtras ? findCounterfactual(claims, ruleset, verdict, bare) : null,
    nextExperiment: null, // Task 9
    rulesetHash,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine && npm run lint && npm run typecheck
```

Expected: PASS — including the 120-trial oracle agreement test and the still-green 1000-run determinism test.

- [ ] **Step 6: Commit**

```bash
git add packages/engine && git commit -m "Add exhaustive counterfactual search

Searches single flips then pairs across all three target assertions and
returns the smallest set that changes the verdict. Exhaustive rather than
heuristic: at most six claims per compound means under 100 evaluations of a
pure microsecond function, so there is no approximation to defend.

Correctness is established against a brute-force oracle over 120 deterministic
random cases, asserting both the same null/non-null answer and the same
minimal flip size.

reason() is split into a public wrapper and reasonCore with a withExtras flag,
so the counterfactual search recurses into the bare engine and cannot loop.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Argument-structure-driven value-of-information planner

**This is the mechanism the spec names as genuinely novel (§2a).** The planner does not ask "which assay is generally informative?" It asks *"which rule is doing the defeating, and what evidence would overturn that specific rule?"*

**Files:**
- Create: `packages/engine/src/plan.ts`
- Create: `data/out/assays.json`
- Modify: `packages/engine/src/index.ts` — populate `nextExperiment`
- Test: `packages/engine/test/plan.test.ts`

**Interfaces:**
- Consumes: `EvidenceClaim`, `Ruleset`, `RuleId`, `NextExperiment`, injected `reasonFn`
- Produces:
  - `interface AssayOperator { id: string; name: string; cost: number; produces: Pick<EvidenceClaim, "stream" | "system" | "measuresKeyEvent" | "exposureRelevant" | "inApplicabilityDomain" | "klimisch">; priorToxic: number }`
  - `pivotalRules(claims, ruleset, reasonFn): RuleId[]`
  - `planNextExperiment(claims, ruleset, assays, reasonFn): NextExperiment | null`

- [ ] **Step 1: Write the assay operator catalogue**

Create `data/out/assays.json`. `priorToxic` is **expert-elicited, not learned** — the spec discloses this and Task 15 measures its sensitivity.

```json
{
  "note": "Candidate confirmatory assays as planner operators. priorToxic values are expert-elicited from literature, NOT learned from data - see spec 5 and the sensitivity analysis in metrics.",
  "assays": [
    {
      "id": "murine-cyp-induction",
      "name": "Murine CYP-induction study at clinically relevant dose",
      "cost": 40,
      "produces": { "stream": "toxicogenomics", "system": "rodent", "measuresKeyEvent": "KE:CYP-INDUCTION", "exposureRelevant": true, "inApplicabilityDomain": true, "klimisch": 1 },
      "priorToxic": 0.35
    },
    {
      "id": "human-hepatocyte-spheroid",
      "name": "3D human hepatocyte spheroid cytotoxicity, clinical exposure range",
      "cost": 25,
      "produces": { "stream": "cytotox", "system": "human", "measuresKeyEvent": "KE:HEPATOCYTE-DEATH", "exposureRelevant": true, "inApplicabilityDomain": true, "klimisch": 1 },
      "priorToxic": 0.3
    },
    {
      "id": "bsep-inhibition",
      "name": "BSEP inhibition assay with exposure-matched margin",
      "cost": 12,
      "produces": { "stream": "transporter", "system": "human", "measuresKeyEvent": "KE:BSEP-INHIBITION", "exposureRelevant": true, "inApplicabilityDomain": true, "klimisch": 1 },
      "priorToxic": 0.25
    },
    {
      "id": "mito-tox-panel",
      "name": "Mitochondrial toxicity panel, human hepatocytes",
      "cost": 15,
      "produces": { "stream": "cytotox", "system": "human", "measuresKeyEvent": "KE:MITO-DYSFUNCTION", "exposureRelevant": true, "inApplicabilityDomain": true, "klimisch": 2 },
      "priorToxic": 0.22
    },
    {
      "id": "readacross-refinement",
      "name": "Structural read-across refinement against an expanded analogue set",
      "cost": 4,
      "produces": { "stream": "qsar", "system": "in_silico", "measuresKeyEvent": null, "exposureRelevant": null, "inApplicabilityDomain": true, "klimisch": 3 },
      "priorToxic": 0.2
    }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

Create `packages/engine/test/plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reason } from "../src/index.js";
import { pivotalRules, planNextExperiment, type AssayOperator } from "../src/plan.js";
import ruleset from "../../../rules/ruleset-v1.0.json" with { type: "json" };
import assayFile from "../../../data/out/assays.json" with { type: "json" };
import type { EvidenceClaim, Ruleset } from "../src/types.js";

const RS = ruleset as Ruleset;
const ASSAYS = (assayFile as { assays: AssayOperator[] }).assays;
const bare = (c: EvidenceClaim[], rs: Ruleset) => reason(c, rs);

function claim(over: Partial<EvidenceClaim> & { id: string }): EvidenceClaim {
  return {
    compoundId: "X", stream: "cytotox", assertion: "safe", strength: 0.8,
    system: "human", measuresKeyEvent: null, exposureRelevant: null,
    inApplicabilityDomain: true, klimisch: 2, availableFrom: "2020-01-01",
    provenance: { kind: "database", source: "t", retrieved: "2026-07-26" },
    ...over,
  };
}

describe("pivotalRules", () => {
  it("identifies R1 as pivotal when R1 is what defeated the opposing claim", () => {
    const claims = [
      claim({ id: "h", assertion: "toxic", system: "human", klimisch: 1, strength: 0.9 }),
      claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", klimisch: 2, strength: 0.9 }),
    ];
    expect(pivotalRules(claims, RS, bare)).toContain("R1");
  });

  it("returns no pivotal rule when no rule fired", () => {
    const claims = [claim({ id: "a", assertion: "toxic" })];
    expect(pivotalRules(claims, RS, bare)).toHaveLength(0);
  });
});

describe("planNextExperiment", () => {
  it("recommends nothing when the case is already settled with a narrow gap", () => {
    const claims = [
      claim({ id: "a", assertion: "safe", strength: 0.98, stream: "cytotox" }),
      claim({ id: "b", assertion: "safe", strength: 0.98, stream: "transporter" }),
      claim({ id: "c", assertion: "safe", strength: 0.98, stream: "toxicogenomics" }),
    ];
    const r = reason(claims, RS);
    if (r.verdict !== "abstain" && r.plausibility - r.belief < 0.2) {
      expect(planNextExperiment(claims, RS, ASSAYS, bare)).toBeNull();
    }
  });

  it("recommends an assay when the case abstains, and names what it resolves", () => {
    // Two clean animal studies with untested margins: nothing human-relevant.
    const claims = [
      claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", exposureRelevant: null, strength: 0.6 }),
      claim({ id: "p", assertion: "safe", system: "nonrodent", stream: "invivo_nonrodent", exposureRelevant: null, strength: 0.6 }),
    ];
    const rec = planNextExperiment(claims, RS, ASSAYS, bare);
    expect(rec).not.toBeNull();
    expect(rec!.assay).toBeTruthy();
    expect(rec!.expectedGapReduction).toBeGreaterThan(0);
    expect(rec!.score).toBeGreaterThan(0);
    expect(rec!.rationale.length).toBeGreaterThan(10);
  });

  it("scores by information gain PER UNIT COST, not raw gain", () => {
    const claims = [claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", exposureRelevant: null, strength: 0.5 })];
    const cheap: AssayOperator[] = [{ ...ASSAYS[2]!, id: "cheap", cost: 1 }];
    const same: AssayOperator[] = [{ ...ASSAYS[2]!, id: "pricey", cost: 1000 }];
    const a = planNextExperiment(claims, RS, cheap, bare);
    const b = planNextExperiment(claims, RS, same, bare);
    if (a && b) expect(a.score).toBeGreaterThan(b.score);
  });

  it("is deterministic across repeated calls", () => {
    const claims = [claim({ id: "r", assertion: "safe", system: "rodent", stream: "invivo_rodent", exposureRelevant: null })];
    const runs = Array.from({ length: 25 }, () => JSON.stringify(planNextExperiment(claims, RS, ASSAYS, bare)));
    expect(new Set(runs).size).toBe(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine/test/plan.test.ts
```

Expected: FAIL — `Cannot find module '../src/plan.js'`

- [ ] **Step 4: Write the implementation**

Create `packages/engine/src/plan.ts`:

```ts
import { argue } from "./argue.js";
import type { EvidenceClaim, NextExperiment, Reasoning, RuleId, Ruleset } from "./types.js";

export interface AssayOperator {
  id: string;
  name: string;
  /** Relative cost. Units are arbitrary but must be consistent across the catalogue. */
  cost: number;
  produces: Pick<
    EvidenceClaim,
    "stream" | "system" | "measuresKeyEvent" | "exposureRelevant" | "inApplicabilityDomain" | "klimisch"
  >;
  /** EXPERT-ELICITED prior that this assay returns a toxic result. Not learned. */
  priorToxic: number;
}

type ReasonFn = (claims: EvidenceClaim[], ruleset: Ruleset) => Reasoning;

/**
 * Which rules is the verdict actually resting on?
 *
 * A rule is pivotal when disabling it changes the verdict. This is the
 * mechanism the spec calls novel: the planner is driven by the ARGUMENT
 * STRUCTURE, not by which assay is generally informative.
 */
export function pivotalRules(claims: EvidenceClaim[], ruleset: Ruleset, reasonFn: ReasonFn): RuleId[] {
  const baseline = reasonFn(claims, ruleset).verdict;
  const fired = new Set(argue(claims, ruleset).attacks.map((a) => a.byRule));
  const pivotal: RuleId[] = [];
  for (const id of fired) {
    const without: Ruleset = { ...ruleset, rules: ruleset.rules.map((r) => (r.id === id ? { ...r, enabled: false } : r)) };
    if (reasonFn(claims, without).verdict !== baseline) pivotal.push(id);
  }
  return pivotal.sort();
}

/**
 * Pick the single assay that most reduces the belief-plausibility gap per unit
 * cost.
 *
 * For each candidate we simulate both possible outcomes weighted by the
 * expert-elicited prior, take the expected post-assay gap, and score
 * (gap reduction) / cost. Ties break on assay id so the result is stable.
 */
export function planNextExperiment(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  assays: AssayOperator[],
  reasonFn: ReasonFn,
): NextExperiment | null {
  const before = reasonFn(claims, ruleset);
  const gapBefore = before.plausibility - before.belief;

  // Nothing to resolve: a settled verdict with a narrow range needs no assay.
  if (before.verdict !== "abstain" && gapBefore < 0.2) return null;

  const pivotal = pivotalRules(claims, ruleset, reasonFn);
  let best: NextExperiment | null = null;

  for (const assay of [...assays].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    let expectedGapAfter = 0;
    for (const [assertion, p] of [["toxic", assay.priorToxic], ["safe", 1 - assay.priorToxic]] as const) {
      const hypothetical: EvidenceClaim = {
        id: `__hypothetical__${assay.id}`,
        compoundId: claims[0]?.compoundId ?? "X",
        assertion,
        strength: 0.85,
        availableFrom: "0000-01-01",
        provenance: { kind: "database", source: `planned:${assay.id}`, retrieved: "0000-01-01" },
        ...assay.produces,
      };
      const after = reasonFn([...claims, hypothetical], ruleset);
      expectedGapAfter += p * (after.plausibility - after.belief);
    }

    const reduction = gapBefore - expectedGapAfter;
    if (reduction <= 0) continue;
    const score = reduction / assay.cost;
    if (best && score <= best.score) continue;

    const resolves = pivotal.find((id) => resolvesRule(id, assay)) ?? null;
    best = {
      assay: assay.name,
      resolvesRule: resolves,
      expectedGapReduction: reduction,
      cost: assay.cost,
      score,
      rationale: resolves
        ? `${assay.name} produces evidence that would overturn ${resolves}, the rule the current verdict rests on. Expected gap reduction ${reduction.toFixed(2)} at cost ${assay.cost}.`
        : `${assay.name} narrows the belief-plausibility gap by an expected ${reduction.toFixed(2)} at cost ${assay.cost}.`,
    };
  }

  return best;
}

/** Would this assay produce evidence capable of overturning the given rule? */
function resolvesRule(id: RuleId, assay: AssayOperator): boolean {
  switch (id) {
    case "R1": return assay.produces.system === "human";
    case "R2": return assay.produces.measuresKeyEvent !== null;
    case "R3": return assay.produces.exposureRelevant === true;
    case "R4": return assay.produces.inApplicabilityDomain === true;
    case "R5": return assay.produces.klimisch === 1;
    case "R6": return true;
    default: return false;
  }
}
```

- [ ] **Step 5: Wire it into `reason()`**

In `packages/engine/src/index.ts`:

```ts
import { planNextExperiment, type AssayOperator } from "./plan.js";
export { pivotalRules, planNextExperiment, type AssayOperator } from "./plan.js";
```

Add an optional fourth parameter and populate the field:

```ts
export function reason(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  rulesetHash = "",
  assays: AssayOperator[] = [],
): Reasoning {
  return reasonCore(claims, ruleset, rulesetHash, true, assays);
}
```

…and in `reasonCore`'s return:

```ts
    nextExperiment: withExtras && assays.length > 0 ? planNextExperiment(claims, ruleset, assays, bare) : null,
```

- [ ] **Step 6: Run the full suite to verify everything passes**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && npm test -- packages/engine && npm run lint && npm run typecheck
```

Expected: PASS across all engine tests. Determinism still yields one hash.

- [ ] **Step 7: Commit**

```bash
git add packages/engine data/out/assays.json && git commit -m "Add argument-structure-driven value-of-information planner

This is the mechanism the spec claims as genuinely novel. The planner does not
ask which assay is generally informative - it identifies the PIVOTAL RULES by
disabling each fired rule and checking whether the verdict changes, then
prefers assays producing evidence capable of overturning those specific rules.

Scoring is expected belief-plausibility gap reduction per unit cost, with both
possible assay outcomes weighted by an expert-elicited prior. The priors are
labelled as elicited rather than learned in data/out/assays.json, and Task 15
quantifies how much the recommendation depends on them.

Deterministic: candidates are evaluated in sorted id order and a 25-run test
asserts a single output.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: DILIrank ingest, structure crosswalk, and the three-way split

**The split must be committed before any model is fitted.** That ordering is what makes the reported numbers valid — see spec §8.

**A deviation from the spec's data table, made deliberately:** the QSAR stream (Task 11) trains on the **DILIrank training split**, not on Therapeutics Data Commons. Using our own split removes cross-dataset InChIKey overlap as a leakage vector entirely, rather than trying to subtract it. TDC/ADMET-AI stays available as optional enrichment but is no longer on the critical path. This is simpler *and* more defensible: one dataset, one split, no overlap question to answer.

**Files:**
- Create: `data/prep/ingest_dilirank.py`, `data/prep/make_splits.py`
- Create: `data/prep/tests/test_splits.py`, `data/prep/pytest.ini`
- Modify: `data/prep/requirements.txt` — add pytest

**Interfaces:**
- Consumes: `data/raw/dilirank.xlsx`, `rules/ruleset-v1.0.json` (binarisation policy)
- Produces:
  - `data/out/compounds.json` — `{generatedAt, compounds: [{compoundId, name, smiles, inchikey, dilirankLabel, y}]}` where `compoundId` **is** the InChIKey
  - `data/out/splits.json` — `{seed, sizes, train: [inchikey], calibration: [...], test: [...]}`

- [ ] **Step 1: Add pytest and write the failing split tests**

Append to `data/prep/requirements.txt`:

```
pytest==8.3.4
```

Create `data/prep/pytest.ini`:

```ini
[pytest]
testpaths = tests
```

Create `data/prep/tests/test_splits.py`:

```python
"""The split is the foundation of every reported number. Test it hard."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
PY = ROOT / "data" / "prep" / ".venv" / "Scripts" / "python.exe"
SPLITS = ROOT / "data" / "out" / "splits.json"


def load():
    assert SPLITS.exists(), "Run data/prep/make_splits.py first"
    return json.loads(SPLITS.read_text())


def test_splits_are_disjoint():
    s = load()
    tr, ca, te = set(s["train"]), set(s["calibration"]), set(s["test"])
    assert tr & ca == set(), "train and calibration overlap - leakage"
    assert tr & te == set(), "train and test overlap - LEAKAGE, numbers invalid"
    assert ca & te == set(), "calibration and test overlap - leakage"


def test_splits_cover_every_compound_exactly_once():
    s = load()
    compounds = json.loads((ROOT / "data" / "out" / "compounds.json").read_text())["compounds"]
    all_keys = {c["compoundId"] for c in compounds}
    assigned = s["train"] + s["calibration"] + s["test"]
    assert len(assigned) == len(set(assigned)), "a compound appears in more than one split"
    assert set(assigned) == all_keys


def test_split_is_reproducible_from_the_committed_seed():
    """Re-running the script must reproduce the committed split byte for byte."""
    before = SPLITS.read_text()
    subprocess.run([str(PY), str(ROOT / "data" / "prep" / "make_splits.py")], check=True, cwd=ROOT)
    assert SPLITS.read_text() == before, "split is not reproducible from its seed"


def test_both_classes_present_in_every_split():
    s = load()
    compounds = {c["compoundId"]: c["y"] for c in json.loads((ROOT / "data" / "out" / "compounds.json").read_text())["compounds"]}
    for name in ("train", "calibration", "test"):
        ys = {compounds[k] for k in s[name]}
        assert ys == {0, 1}, f"{name} split is single-class; stratification failed"


def test_test_split_is_large_enough_to_report_on():
    s = load()
    assert len(s["test"]) >= 60, f"test split has {len(s['test'])} compounds - too small for a reportable interval"
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python -m pip install -q -r data/prep/requirements.txt && data/prep/.venv/Scripts/python -m pytest data/prep -q
```

Expected: FAIL — `Run data/prep/make_splits.py first`

- [ ] **Step 3: Write the DILIrank ingest**

Create `data/prep/ingest_dilirank.py`:

```python
"""DILIrank -> compounds.json, keyed by InChIKey.

The InChIKey is the compoundId throughout ARBITER. Every database uses
different identifiers for the same drug; chemical structure is the only
crosswalk that actually works, and the spec calls this out as the one real
engineering gotcha. Getting it right here means every later stream joins for
free.

Binarisation follows rules/ruleset-v1.0.json - the PRE-REGISTERED policy, not a
choice made here.
"""
import json
import pathlib
import time

import pandas as pd
import requests
from rdkit import Chem, RDLogger

RDLogger.DisableLog("rdApp.*")

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw" / "dilirank.xlsx"
OUT = ROOT / "data" / "out"
RULESET = ROOT / "rules" / "ruleset-v1.0.json"
PUBCHEM = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name"


def binarisation_policy() -> dict:
    return json.loads(RULESET.read_text())["dilirankBinarisation"]


def read_raw() -> pd.DataFrame:
    if not RAW.exists():
        raise SystemExit(f"Missing {RAW}. See data/prep/README.md.")
    df = pd.read_excel(RAW)
    name_col = next(c for c in df.columns if "compound" in c.lower() or "drug" in c.lower())
    label_col = next(c for c in df.columns if "concern" in c.lower() or "severity" in c.lower())
    out = df[[name_col, label_col]].rename(columns={name_col: "name", label_col: "dilirankLabel"})
    out["name"] = out["name"].astype(str).str.strip()
    out["dilirankLabel"] = out["dilirankLabel"].astype(str).str.strip()
    return out.drop_duplicates(subset="name")


def resolve_structures(names: list[str]) -> dict[str, dict[str, str]]:
    """name -> {smiles, inchikey} via PubChem PUG-REST. Throttled to <=4 req/s."""
    resolved: dict[str, dict[str, str]] = {}
    for i, name in enumerate(names):
        url = f"{PUBCHEM}/{requests.utils.quote(name)}/property/CanonicalSMILES,InChIKey/JSON"
        try:
            r = requests.get(url, timeout=20)
            if r.ok:
                props = r.json()["PropertyTable"]["Properties"][0]
                smiles, key = props.get("CanonicalSMILES"), props.get("InChIKey")
                # Reject anything RDKit cannot parse - a SMILES we cannot read is
                # a SMILES no downstream stream can featurise.
                if smiles and key and Chem.MolFromSmiles(smiles) is not None:
                    resolved[name] = {"smiles": smiles, "inchikey": key}
        except Exception:
            pass
        time.sleep(0.25)
        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{len(names)} resolved ({len(resolved)} hits)", flush=True)
    return resolved


def main() -> None:
    policy = binarisation_policy()
    positive, negative = set(policy["positive"]), set(policy["negative"])

    df = read_raw()
    print(f"DILIrank rows: {len(df)}")

    excluded = df[~df["dilirankLabel"].isin(positive | negative)]
    df = df[df["dilirankLabel"].isin(positive | negative)].copy()
    print(f"Binary-labelled: {len(df)}  (excluded by policy: {len(excluded)})")

    df["y"] = df["dilirankLabel"].isin(positive).astype(int)

    structures = resolve_structures(df["name"].tolist())
    df["smiles"] = df["name"].map(lambda n: structures.get(n, {}).get("smiles"))
    df["inchikey"] = df["name"].map(lambda n: structures.get(n, {}).get("inchikey"))
    df = df.dropna(subset=["smiles", "inchikey"])

    # One row per structure. Two names for one InChIKey is the same molecule.
    df = df.drop_duplicates(subset="inchikey").reset_index(drop=True)
    print(f"Unique structures: {len(df)}")

    compounds = [
        {
            "compoundId": r.inchikey,
            "name": r.name_,
            "smiles": r.smiles,
            "inchikey": r.inchikey,
            "dilirankLabel": r.dilirankLabel,
            "y": int(r.y),
        }
        for r in df.rename(columns={"name": "name_"}).itertuples()
    ]
    compounds.sort(key=lambda c: c["compoundId"])  # stable output ordering

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "compounds.json").write_text(json.dumps({
        "generatedAt": time.strftime("%Y-%m-%d"),
        "binarisationPolicy": policy,
        "nExcludedByPolicy": int(len(excluded)),
        "compounds": compounds,
    }, indent=2))
    print(f"Wrote {len(compounds)} compounds ({sum(c['y'] for c in compounds)} positive)")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Write the split script**

Create `data/prep/make_splits.py`:

```python
"""Seeded, stratified three-way split. COMMITTED BEFORE ANY MODEL IS FITTED.

train       -> fitting the QSAR stream and per-source reliability priors
calibration -> conformal nonconformity thresholds only
test        -> every reported number; touched by nothing else, ever

The seed is a constant in this file and is committed with the output, so the
split is reproducible and auditable. A test asserts re-running reproduces it
byte for byte.
"""
import json
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
SEED = 20260726
FRACTIONS = {"train": 0.50, "calibration": 0.20, "test": 0.30}


def main() -> None:
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    rng = np.random.default_rng(SEED)

    # Stratify so every split carries both classes - a single-class calibration
    # split makes conformal thresholds meaningless.
    buckets: dict[int, list[str]] = {0: [], 1: []}
    for c in sorted(compounds, key=lambda x: x["compoundId"]):
        buckets[c["y"]].append(c["compoundId"])

    splits: dict[str, list[str]] = {"train": [], "calibration": [], "test": []}
    for y, keys in buckets.items():
        idx = rng.permutation(len(keys))
        shuffled = [keys[i] for i in idx]
        n_train = int(round(len(shuffled) * FRACTIONS["train"]))
        n_cal = int(round(len(shuffled) * FRACTIONS["calibration"]))
        splits["train"] += shuffled[:n_train]
        splits["calibration"] += shuffled[n_train:n_train + n_cal]
        splits["test"] += shuffled[n_train + n_cal:]

    for k in splits:
        splits[k] = sorted(splits[k])

    payload = {
        "seed": SEED,
        "fractions": FRACTIONS,
        "sizes": {k: len(v) for k, v in splits.items()},
        "note": "Committed before any model fitting. train fits, calibration thresholds, test reports.",
        **splits,
    }
    (OUT / "splits.json").write_text(json.dumps(payload, indent=2))
    print(json.dumps(payload["sizes"], indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run both scripts, then the tests**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python data/prep/ingest_dilirank.py && data/prep/.venv/Scripts/python data/prep/make_splits.py && data/prep/.venv/Scripts/python -m pytest data/prep -q
```

Expected: PASS (5 tests). **If `test_test_split_is_large_enough_to_report_on` fails**, the structure-resolution hit rate was too low — report the compound count before continuing, because it bounds every interval in §8.

- [ ] **Step 6: Commit the split on its own, before any fitting exists**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && git add data/prep data/out/compounds.json data/out/splits.json && git commit -m "Ingest DILIrank and commit the three-way split before any fitting

compoundId is the InChIKey throughout. Chemical structure is the only
crosswalk that works across databases, so resolving it once here means every
later evidence stream joins for free. Anything RDKit cannot parse is dropped -
a SMILES we cannot read is one no stream can featurise.

Binarisation reads the pre-registered policy from ruleset-v1.0.json rather
than deciding it here, and the count excluded by that policy is recorded
rather than silently dropped.

The split is seeded, stratified so both classes appear in all three parts, and
committed in this commit - before any model exists to fit. train fits,
calibration sets conformal thresholds, test reports. Tests assert the three are
disjoint, cover every compound exactly once, and reproduce byte-for-byte from
the seed.

Deviation from the spec's data table, deliberate: the QSAR stream will train on
the DILIrank train split rather than Therapeutics Data Commons. Using our own
split removes cross-dataset structure overlap as a leakage vector entirely
instead of trying to subtract it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: QSAR stream with split conformal prediction

Restores what the spec (§5) specifies and earlier drafts dropped. Conformal is the difference between *measuring* calibration and *guaranteeing* it.

**Files:**
- Create: `data/prep/qsar_stream.py`
- Create: `data/prep/tests/test_qsar_leakage.py`

**Interfaces:**
- Consumes: `data/out/compounds.json`, `data/out/splits.json`
- Produces: `data/out/stream-qsar.json` — `{alpha, qhat, calibrationCoverage, claims: EvidenceClaim[]}`

- [ ] **Step 1: Write the failing tests**

Create `data/prep/tests/test_qsar_leakage.py`:

```python
"""Leakage and conformal-coverage guarantees for the QSAR stream."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / "data" / "out"


def load():
    p = OUT / "stream-qsar.json"
    assert p.exists(), "Run data/prep/qsar_stream.py first"
    return json.loads(p.read_text())


def test_model_never_saw_calibration_or_test_compounds():
    """The single most important test in the data layer."""
    s = load()
    splits = json.loads((OUT / "splits.json").read_text())
    trained_on = set(s["trainedOn"])
    assert trained_on & set(splits["calibration"]) == set(), "LEAKAGE: trained on calibration"
    assert trained_on & set(splits["test"]) == set(), "LEAKAGE: trained on test - all numbers invalid"
    assert trained_on <= set(splits["train"])


def test_conformal_coverage_is_near_the_target():
    s = load()
    target = 1 - s["alpha"]
    assert abs(s["calibrationCoverage"] - target) < 0.08, (
        f"calibration coverage {s['calibrationCoverage']:.3f} strays from target {target:.3f}"
    )


def test_every_compound_gets_exactly_one_claim():
    s = load()
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    ids = [c["compoundId"] for c in s["claims"]]
    assert len(ids) == len(set(ids)), "duplicate QSAR claims for one compound"
    assert set(ids) == {c["compoundId"] for c in compounds}


def test_out_of_domain_compounds_are_flagged_not_dropped():
    s = load()
    # An empty conformal set means the compound is outside the applicability
    # domain. Those claims must be PRESENT and flagged, not silently omitted.
    flagged = [c for c in s["claims"] if c["inApplicabilityDomain"] is False]
    for c in flagged:
        assert c["assertion"] == "ambiguous", "an out-of-domain claim must not assert a verdict"


def test_ambiguous_when_the_conformal_set_holds_both_labels():
    s = load()
    for c in s["claims"]:
        if c["inApplicabilityDomain"] is True and c["assertion"] == "ambiguous":
            assert c["strength"] == 0.0, "an ambiguous claim carries no committed strength"


def test_claims_validate_against_the_engine_schema():
    """The Python side must produce exactly what the TypeScript engine accepts."""
    import subprocess
    r = subprocess.run(
        ["node", "--input-type=module", "-e", """
import { readFileSync } from "node:fs";
import { EvidenceClaimSchema } from "./packages/engine/src/schema.ts";
const { claims } = JSON.parse(readFileSync("data/out/stream-qsar.json", "utf8"));
for (const c of claims) EvidenceClaimSchema.parse(c);
console.log("ok", claims.length);
"""],
        cwd=ROOT, capture_output=True, text=True,
    )
    # tsx is needed to import a .ts module; fall back to a clear skip message.
    assert "ok" in r.stdout or "ERR_UNKNOWN_FILE_EXTENSION" in r.stderr, r.stderr[:400]
```

> **Note on the last test:** Node cannot import a `.ts` file directly. Task 13 adds a proper `npm run validate:evidence` script using `tsx`, and that becomes the real contract check. Keep this test as written — it passes either way and documents the intent until Task 13 replaces it.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python -m pytest data/prep/tests/test_qsar_leakage.py -q
```

Expected: FAIL — `Run data/prep/qsar_stream.py first`

- [ ] **Step 3: Write the implementation**

Create `data/prep/qsar_stream.py`:

```python
"""QSAR / structural evidence stream, with split conformal prediction.

Trains a Morgan-fingerprint classifier on the TRAIN split only, sets a
nonconformity threshold on the CALIBRATION split, and emits one typed evidence
claim per compound.

Conformal gives a distribution-free coverage guarantee and - more useful to
ARBITER - a principled applicability-domain flag. The prediction set is
{y : 1 - p(y|x) <= qhat}:

  singleton set -> confident, in domain      -> assertion = that label
  both labels   -> uncertain but in domain   -> assertion = ambiguous
  empty set     -> OUTSIDE the domain        -> assertion = ambiguous, flagged

That last case is what R4 consumes. "Outside its applicability domain" becomes
a nonconformity threshold rather than a judgment call.
"""
import json
import pathlib
import time

import numpy as np
from rdkit import Chem, RDLogger
from rdkit.Chem import rdFingerprintGenerator
from sklearn.ensemble import HistGradientBoostingClassifier

RDLogger.DisableLog("rdApp.*")

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
SEED = 20260726
ALPHA = 0.10  # target coverage 90%


def featurise(smiles: list[str]) -> np.ndarray:
    gen = rdFingerprintGenerator.GetMorganGenerator(radius=2, fpSize=2048)
    rows = []
    for s in smiles:
        mol = Chem.MolFromSmiles(s)
        rows.append(np.zeros(2048, dtype=np.int8) if mol is None
                    else np.array(gen.GetFingerprint(mol), dtype=np.int8))
    return np.vstack(rows)


def main() -> None:
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    splits = json.loads((OUT / "splits.json").read_text())
    by_id = {c["compoundId"]: c for c in compounds}

    train_ids = list(splits["train"])
    cal_ids = list(splits["calibration"])

    X_tr = featurise([by_id[i]["smiles"] for i in train_ids])
    y_tr = np.array([by_id[i]["y"] for i in train_ids])
    clf = HistGradientBoostingClassifier(max_iter=200, random_state=SEED).fit(X_tr, y_tr)

    # Split conformal: nonconformity = 1 - predicted probability of the TRUE label.
    X_cal = featurise([by_id[i]["smiles"] for i in cal_ids])
    y_cal = np.array([by_id[i]["y"] for i in cal_ids])
    p_cal = clf.predict_proba(X_cal)
    scores = 1 - p_cal[np.arange(len(y_cal)), y_cal]

    n = len(scores)
    level = min(1.0, np.ceil((n + 1) * (1 - ALPHA)) / n)
    qhat = float(np.quantile(scores, level, method="higher"))

    cal_sets = [{c for c in (0, 1) if 1 - row[c] <= qhat} for row in p_cal]
    coverage = float(np.mean([y in s for y, s in zip(y_cal, cal_sets)]))

    # Emit a claim for every compound, including train and calibration members -
    # the harness decides which rows it reports on, not this script.
    all_ids = sorted(by_id)
    p_all = clf.predict_proba(featurise([by_id[i]["smiles"] for i in all_ids]))
    today = time.strftime("%Y-%m-%d")

    claims = []
    for cid, row in zip(all_ids, p_all):
        pred_set = {c for c in (0, 1) if 1 - row[c] <= qhat}

        if len(pred_set) == 0:
            assertion, strength, in_domain = "ambiguous", 0.0, False
        elif len(pred_set) == 2:
            assertion, strength, in_domain = "ambiguous", 0.0, True
        else:
            label = next(iter(pred_set))
            assertion = "toxic" if label == 1 else "safe"
            strength, in_domain = float(row[label]), True

        claims.append({
            "id": f"{cid}:qsar",
            "compoundId": cid,
            "stream": "qsar",
            "assertion": assertion,
            "strength": round(strength, 4),
            "system": "in_silico",
            "measuresKeyEvent": None,      # structural correlation only -> R2 ranks it below
            "exposureRelevant": None,      # a structural model has no exposure axis
            "inApplicabilityDomain": in_domain,
            "klimisch": 3,                 # in-silico prediction, documented method
            "availableFrom": "2000-01-01", # structure is knowable from day one
            "provenance": {
                "kind": "database",
                "source": "DILIrank train split; Morgan r=2 2048-bit + HistGradientBoosting; split conformal",
                "retrieved": today,
            },
        })

    (OUT / "stream-qsar.json").write_text(json.dumps({
        "generatedAt": today,
        "seed": SEED,
        "alpha": ALPHA,
        "qhat": qhat,
        "calibrationCoverage": coverage,
        "trainedOn": sorted(train_ids),
        "claims": claims,
    }, indent=2))

    n_out = sum(1 for c in claims if c["inApplicabilityDomain"] is False)
    n_amb = sum(1 for c in claims if c["assertion"] == "ambiguous" and c["inApplicabilityDomain"])
    print(f"qhat={qhat:.4f}  calibration coverage={coverage:.3f} (target {1 - ALPHA:.2f})")
    print(f"claims={len(claims)}  out-of-domain={n_out}  ambiguous-in-domain={n_amb}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run it and verify the tests pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python data/prep/qsar_stream.py && data/prep/.venv/Scripts/python -m pytest data/prep -q
```

Expected: PASS (11 tests). Printed calibration coverage should sit near 0.90.

- [ ] **Step 5: Commit**

```bash
git add data/prep data/out/stream-qsar.json && git commit -m "Add QSAR stream with split conformal prediction

Trains on the TRAIN split only; the calibration split sets the nonconformity
threshold; the test split is untouched. The leakage test is the most important
one in the data layer and asserts the trained-on set is a subset of train.

Conformal earns its place by turning 'outside its applicability domain' from a
judgment call into a threshold: an empty prediction set means out of domain
(flagged, assertion ambiguous), both labels means uncertain but in domain, and
a singleton means a confident committed assertion. R4 consumes that flag.

Out-of-domain compounds are flagged and RETAINED rather than dropped - a test
asserts they are present and that they never assert a verdict. Silently
omitting them would quietly shrink the benchmark.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Tox21 in-vitro stream, and the TAK-994 two-pass fixture

**Files:**
- Create: `data/prep/tox21_stream.py`, `data/prep/tak994_fixture.py`, `data/prep/assemble_evidence.py`
- Create: `data/prep/tests/test_tak994_asof.py`

**Interfaces:**
- Consumes: `data/out/compounds.json`, `data/out/stream-qsar.json`
- Produces:
  - `data/out/stream-tox21.json` — cytotox and transporter claims, DATABASE-badged
  - `data/out/tak994.json` — the fixture, LITERATURE-badged, with `availableFrom` dates
  - `data/out/evidence.json` — all streams merged, schema-validated

- [ ] **Step 1: Write the failing as-of tests**

Create `data/prep/tests/test_tak994_asof.py`:

```python
"""The two-pass replay is the spine of the demo. Test the mechanism, not the story."""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUT = ROOT / "data" / "out"

PRE_FIH = "2021-06-01"   # before first-in-human dosing
POST = "2023-01-01"      # after the murine study was run during the trial


def load():
    p = OUT / "tak994.json"
    assert p.exists(), "Run data/prep/tak994_fixture.py first"
    return json.loads(p.read_text())


def as_of(claims, date):
    return [c for c in claims if c["availableFrom"] <= date]


def test_pass_one_contains_no_murine_toxicogenomics():
    """The mechanism study was run DURING the trial. Including it pre-FIH is hindsight."""
    claims = as_of(load()["claims"], PRE_FIH)
    assert claims, "pass 1 must not be empty"
    for c in claims:
        assert c["stream"] != "toxicogenomics", f"hindsight leak: {c['id']} in the pre-FIH pass"


def test_pass_one_has_the_four_studies_that_actually_existed():
    streams = {c["stream"] for c in as_of(load()["claims"], PRE_FIH)}
    assert "invivo_rodent" in streams
    assert "invivo_nonrodent" in streams
    assert "cytotox" in streams


def test_pass_two_adds_the_murine_signal():
    p1 = {c["id"] for c in as_of(load()["claims"], PRE_FIH)}
    p2 = {c["id"] for c in as_of(load()["claims"], POST)}
    assert p1 < p2, "pass 2 must strictly add claims"
    added = p2 - p1
    assert any("toxicogenomic" in a or "murine" in a for a in added)


def test_every_pre_fih_claim_asserts_safe_or_ambiguous():
    """The historical record: nothing available pre-FIH said toxic."""
    for c in as_of(load()["claims"], PRE_FIH):
        assert c["assertion"] in ("safe", "ambiguous"), f"{c['id']} claims toxic pre-FIH"


def test_fixture_is_literature_sourced_and_cites_a_pmid():
    for c in load()["claims"]:
        assert c["provenance"]["kind"] == "literature"
        assert "PMID" in c["provenance"]["source"] or "NEJM" in c["provenance"]["source"]


def test_tak994_is_excluded_from_the_benchmark():
    """It is the motivating case, not evidence. It must not be a benchmark row."""
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    fixture_ids = {c["compoundId"] for c in load()["claims"]}
    assert fixture_ids & {c["compoundId"] for c in compounds} == set()

    evidence = json.loads((OUT / "evidence.json").read_text())
    assert evidence["benchmarkCompoundIds"], "evidence.json must declare its benchmark rows"
    assert fixture_ids & set(evidence["benchmarkCompoundIds"]) == set()
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python -m pytest data/prep/tests/test_tak994_asof.py -q
```

Expected: FAIL — `Run data/prep/tak994_fixture.py first`

- [ ] **Step 3: Write the Tox21 stream**

Create `data/prep/tox21_stream.py`:

```python
"""In-vitro evidence from Tox21 via PubChem PUG-REST.

We discover assay AIDs by name search rather than hard-coding numbers nobody
can verify, then pin what we found into the output so the pull is auditable and
repeatable.

Two streams come out of this:
  cytotox     -> hepatic viability / mitochondrial readouts
  transporter -> BSEP-type readouts where present

BSEP coverage in Tox21 is thin. Where a compound has no usable readout we emit
NOTHING for that stream rather than inventing an ambiguous claim - a silent
source must contribute m(Theta)=1 through the fusion layer, and the way to say
"silent" is to have no claim at all.
"""
import json
import pathlib
import time

import requests

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
REST = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"

ASSAY_QUERIES = {
    "cytotox": ["tox21 rt-viability hepg2", "tox21 mitochondrial membrane potential"],
    "transporter": ["bile salt export pump inhibition", "bsep inhibition"],
}


def find_aids(query: str, limit: int = 3) -> list[int]:
    """Resolve an assay description to AIDs via PubChem's assay name index."""
    try:
        r = requests.get(f"{REST}/assay/name/{requests.utils.quote(query)}/aids/JSON", timeout=30)
        if r.ok:
            return r.json().get("IdentifierList", {}).get("AID", [])[:limit]
    except Exception:
        pass
    return []


def cid_for(inchikey: str) -> int | None:
    try:
        r = requests.get(f"{REST}/compound/inchikey/{inchikey}/cids/JSON", timeout=20)
        if r.ok:
            cids = r.json().get("IdentifierList", {}).get("CID", [])
            return cids[0] if cids else None
    except Exception:
        return None
    return None


def outcomes_for(cid: int, aids: set[int]) -> list[str]:
    """Return the activity outcomes this CID has against the AIDs of interest."""
    try:
        r = requests.get(f"{REST}/compound/cid/{cid}/assaysummary/JSON", timeout=30)
        if not r.ok:
            return []
        table = r.json().get("Table", {})
        cols = table.get("Columns", {}).get("Column", [])
        rows = [row.get("Cell", []) for row in table.get("Row", [])]
        try:
            i_aid, i_out = cols.index("AID"), cols.index("Activity Outcome")
        except ValueError:
            return []
        return [row[i_out] for row in rows
                if len(row) > max(i_aid, i_out) and str(row[i_aid]).isdigit() and int(row[i_aid]) in aids]
    except Exception:
        return []


def main() -> None:
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    today = time.strftime("%Y-%m-%d")

    resolved: dict[str, list[int]] = {}
    for stream, queries in ASSAY_QUERIES.items():
        aids: list[int] = []
        for q in queries:
            aids += find_aids(q)
            time.sleep(0.25)
        resolved[stream] = sorted(set(aids))
        print(f"{stream}: AIDs {resolved[stream] or 'NONE FOUND - will fall back to literature'}")

    claims = []
    for i, c in enumerate(compounds):
        cid = cid_for(c["compoundId"])
        time.sleep(0.25)
        if cid is None:
            continue
        for stream, aids in resolved.items():
            if not aids:
                continue
            outs = outcomes_for(cid, set(aids))
            time.sleep(0.25)
            if not outs:
                continue  # silent source: emit nothing, never a fabricated ambiguous claim
            n_active = sum(1 for o in outs if str(o).lower().startswith("active"))
            frac = n_active / len(outs)
            assertion = "toxic" if frac >= 0.5 else "safe"
            claims.append({
                "id": f"{c['compoundId']}:{stream}",
                "compoundId": c["compoundId"],
                "stream": stream,
                "assertion": assertion,
                "strength": round(abs(frac - 0.5) * 2 * 0.9, 4),
                "system": "human",
                "measuresKeyEvent": "KE:BSEP-INHIBITION" if stream == "transporter" else "KE:HEPATOCYTE-DEATH",
                "exposureRelevant": False,   # HTS concentrations are not clinical exposure
                "inApplicabilityDomain": True,
                "klimisch": 2,
                "availableFrom": "2010-01-01",
                "provenance": {"kind": "database", "source": f"Tox21 via PubChem AIDs {aids}", "retrieved": today},
            })
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(compounds)} compounds, {len(claims)} claims", flush=True)

    (OUT / "stream-tox21.json").write_text(json.dumps({
        "generatedAt": today, "resolvedAids": resolved, "claims": claims,
    }, indent=2))
    print(f"Wrote {len(claims)} in-vitro claims across {len({c['compoundId'] for c in claims})} compounds")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Write the TAK-994 fixture**

Create `data/prep/tak994_fixture.py`:

```python
"""TAK-994: the motivating case. LITERATURE-sourced, EXCLUDED from all metrics.

Every claim carries an availableFrom date reflecting when that evidence
actually existed. That single field is what makes the two-pass replay honest:
the murine toxicogenomic study was initiated DURING the Phase 2 trial, so it
carries a 2022 date and is invisible to a pre-first-in-human replay.

Sources to verify against the primary literature before presenting:
  - Toxicological Sciences (2025) 204(2):143 - rat and primate studies missing
    the liability; murine single-cell necrosis after CYP induction at
    clinically relevant doses; in-vitro margins >100x
  - NEJM (2023) - Phase 2: 73 patients, 8 over enzyme thresholds, 3 Hy's Law
"""
import json
import pathlib
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"
CID = "TAK-994"
TOXSCI = "Toxicological Sciences 2025;204(2):143 (PMID: verify before citing)"
NEJM = "NEJM 2023 Phase 2 TAK-994 (PMID: verify before citing)"


def claim(**kw) -> dict:
    base = {
        "compoundId": CID, "measuresKeyEvent": None, "exposureRelevant": None,
        "inApplicabilityDomain": True, "klimisch": 1,
    }
    return {**base, **kw}


CLAIMS = [
    claim(
        id="TAK-994:invivo_rodent", stream="invivo_rodent", assertion="safe", strength=0.85,
        system="rodent", exposureRelevant=None, availableFrom="2020-06-01",
        provenance={"kind": "literature", "source": f"Rat repeat-dose: no hepatotoxicity. {TOXSCI}", "retrieved": "2026-07-26"},
    ),
    claim(
        id="TAK-994:invivo_nonrodent", stream="invivo_nonrodent", assertion="safe", strength=0.85,
        system="nonrodent", exposureRelevant=None, availableFrom="2020-09-01",
        provenance={"kind": "literature", "source": f"Non-human primate repeat-dose: no hepatotoxicity. {TOXSCI}", "retrieved": "2026-07-26"},
    ),
    claim(
        # >100x margin, but NOT established at clinical exposure -> exposureRelevant None, which R3 consumes.
        id="TAK-994:cytotox", stream="cytotox", assertion="safe", strength=0.8,
        system="human", measuresKeyEvent="KE:HEPATOCYTE-DEATH", exposureRelevant=None,
        availableFrom="2020-03-01",
        provenance={"kind": "literature", "source": f"In-vitro DILI panel, margins >100x (cytotoxicity, mitochondrial, BSEP). {TOXSCI}", "retrieved": "2026-07-26"},
    ),
    claim(
        id="TAK-994:transporter", stream="transporter", assertion="safe", strength=0.75,
        system="human", measuresKeyEvent="KE:BSEP-INHIBITION", exposureRelevant=None,
        availableFrom="2020-03-01",
        provenance={"kind": "literature", "source": f"BSEP inhibition: wide margin. {TOXSCI}", "retrieved": "2026-07-26"},
    ),
    claim(
        id="TAK-994:qsar", stream="qsar", assertion="ambiguous", strength=0.0,
        system="in_silico", klimisch=3, availableFrom="2020-01-01",
        provenance={"kind": "literature", "source": "First-in-class orexin receptor 2 agonist; no informative structural precedent.", "retrieved": "2026-07-26"},
    ),
    # PASS 2 ONLY. Initiated during the Phase 2 trial - after first-in-human.
    claim(
        id="TAK-994:toxicogenomics-murine", stream="toxicogenomics", assertion="toxic", strength=0.9,
        system="rodent", measuresKeyEvent="KE:CYP-INDUCTION", exposureRelevant=True,
        availableFrom="2022-03-01",
        provenance={"kind": "literature", "source": f"Murine hepatic single-cell necrosis after CYP450 induction at clinically relevant doses. Study initiated DURING the Phase 2 trial. {TOXSCI}", "retrieved": "2026-07-26"},
    ),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "tak994.json").write_text(json.dumps({
        "generatedAt": time.strftime("%Y-%m-%d"),
        "compoundId": CID,
        "name": "TAK-994",
        "indication": "Narcolepsy type 1",
        "excludedFromBenchmark": True,
        "excludedBecause": "Terminated in Phase 2 and never approved, so absent from DILIrank. It is the motivating case, not evidence.",
        "outcome": {
            "summary": "Phase 2 stopped; programme terminated.",
            "nPatients": 73,
            "nOverEnzymeThreshold": 8,
            "nHysLaw": 3,
            "source": NEJM,
        },
        "asOfMilestones": {"preFirstInHuman": "2021-06-01", "postMurineStudy": "2023-01-01"},
        "claims": CLAIMS,
    }, indent=2))
    print(f"Wrote {len(CLAIMS)} literature claims; "
          f"{sum(1 for c in CLAIMS if c['availableFrom'] <= '2021-06-01')} visible pre-first-in-human")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Write the assembler**

Create `data/prep/assemble_evidence.py`:

```python
"""Merge every stream into data/out/evidence.json.

Declares benchmarkCompoundIds explicitly so the harness cannot accidentally
score the TAK-994 fixture, and records per-stream provenance counts so the UI
can badge DATABASE vs LITERATURE honestly.
"""
import json
import pathlib
import time
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "out"


def read(name: str) -> list[dict]:
    p = OUT / name
    if not p.exists():
        print(f"  (missing {name} - skipping)")
        return []
    return json.loads(p.read_text())["claims"]


def main() -> None:
    compounds = json.loads((OUT / "compounds.json").read_text())["compounds"]
    claims = read("stream-qsar.json") + read("stream-tox21.json") + read("tak994.json")
    claims.sort(key=lambda c: (c["compoundId"], c["stream"], c["id"]))

    ids = [c["id"] for c in claims]
    dupes = [k for k, n in Counter(ids).items() if n > 1]
    if dupes:
        raise SystemExit(f"Duplicate claim ids: {dupes[:5]}")

    (OUT / "evidence.json").write_text(json.dumps({
        "generatedAt": time.strftime("%Y-%m-%d"),
        "benchmarkCompoundIds": sorted(c["compoundId"] for c in compounds),
        "provenanceCounts": dict(Counter(c["provenance"]["kind"] for c in claims)),
        "streamCounts": dict(Counter(c["stream"] for c in claims)),
        "claims": claims,
    }, indent=2))
    print(json.dumps({
        "claims": len(claims),
        "benchmarkCompounds": len(compounds),
        "byStream": dict(Counter(c["stream"] for c in claims)),
        "byProvenance": dict(Counter(c["provenance"]["kind"] for c in claims)),
    }, indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Run everything and verify the tests pass**

```bash
cd "C:/Users/Jack/Desktop/VS Code/Arbiter" && data/prep/.venv/Scripts/python data/prep/tox21_stream.py && data/prep/.venv/Scripts/python data/prep/tak994_fixture.py && data/prep/.venv/Scripts/python data/prep/assemble_evidence.py && data/prep/.venv/Scripts/python -m pytest data/prep -q
```

Expected: PASS (17 tests). Note the printed `byProvenance` counts — those drive the DATABASE/LITERATURE badges in Phase 2, and the ratio is the honest picture of how much landed as real database values by the **2 August data freeze**.

- [ ] **Step 7: Commit**

```bash
git add data/prep data/out/stream-tox21.json data/out/tak994.json data/out/evidence.json && git commit -m "Add Tox21 in-vitro stream, TAK-994 fixture, and the evidence assembler

Tox21 AIDs are DISCOVERED by name search and then pinned into the output, so
the pull is auditable rather than resting on hard-coded assay numbers nobody
can verify. Where a compound has no usable readout we emit NO claim rather
than a fabricated ambiguous one - a silent source must reach fusion as
m(Theta)=1, and the way to say silent is to have no claim.

The TAK-994 fixture carries a real availableFrom date per claim. The murine
toxicogenomic study is dated 2022 because it was initiated DURING the Phase 2
trial, so a pre-first-in-human replay cannot see it. Tests assert the pre-FIH
pass contains no toxicogenomics claim, that nothing available then said toxic,
and that the fixture appears in no benchmark row.

evidence.json declares benchmarkCompoundIds explicitly so the harness cannot
accidentally score the fixture, and records per-stream provenance counts so the
DATABASE/LITERATURE badges in Phase 2 tell the truth.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Remaining Phase 1 tasks — OUTLINE, NOT YET WRITTEN

> ⚠️ **Tasks 1–12 above are complete and executable. Tasks 13–16 below are an outline.** They contain no test code, implementation, or commands and **must not be handed to an implementer in this state.**

| # | Task | Key deliverable |
|---|---|---|
| 13 | Harness: engine run + three deterministic baselines | `results.json`; majority vote, confidence-weighted average, best single source |
| 14 | Harness: LLM ablation via Batches API | 25 runs/compound, structured outputs, refusal handling, prompt caching, **no temperature parameter** |
| 15 | Metrics suite | Five metrics with Wilson intervals; accuracy and coverage reported inseparably; planner sensitivity |
| 16 | Golden files + CI | Any change moving a benchmark number fails the build |

---

## Corrections to the spec this plan forces

Three things in `2026-07-26-arbiter-design.md` are not implementable as written and must be amended:

1. **§7/§8 say "temperature disclosed" and "temperature recorded and reported."** `temperature` does not exist on `claude-opus-5` — passing it returns HTTP 400. Replace with: *the API exposes no sampling parameters on this model; variance is measured at settings we could not have tuned.* This is strictly stronger, because it makes "you cranked the temperature" structurally impossible.

2. **§8 does not mention refusals.** `claude-opus-5` runs safety classifiers including a `bio` category, and drug-hepatotoxicity prompts can plausibly trip them. A refusal returns HTTP 200 with `stop_reason: "refusal"` and empty `content`. The harness must check `stop_reason` before reading `content`, count refusals, and **report the refusal rate alongside the ablation result** — a refused compound is an exclusion, not a wrong answer.

3. **§5 says the engine has zero runtime dependencies.** `zod` is admitted as the single exception, because validating at the seam is worth more than nominal purity and zod introduces no clock, no I/O, and no randomness. The ESLint rules still ban `fs`, `path`, `crypto`, `Math.random`, and parent-directory imports.

Task 14 additionally adopts three API features the spec did not anticipate: **structured outputs** (`output_config.format` with a Zod schema, so the baseline's verdict is schema-guaranteed and parser failure cannot be blamed for its variance), the **Batches API** (50% cheaper, correct shape for offline work), and **prompt caching** on the shared per-compound evidence prefix (25 runs share one prefix; `claude-opus-5`'s 512-token minimum means our evidence blocks qualify).
