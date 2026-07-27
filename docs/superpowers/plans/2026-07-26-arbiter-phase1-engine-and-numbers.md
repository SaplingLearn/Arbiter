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

## Remaining Phase 1 tasks — OUTLINE ONLY, NOT YET WRITTEN

> ⚠️ **Tasks 1–4 above are complete and executable. Tasks 5–16 below are an outline, not a plan.** They do not yet contain test code, implementation code, or commands, and **must not be handed to an implementer in this state.** They are listed here so the shape and ordering of Phase 1 is agreed before the detail is written. Write them out in full — same structure as tasks 1–4 — before executing past task 4.

Each will follow the same structure: failing test, verify red, minimal implementation, verify green, commit.

| # | Task | Key deliverable |
|---|---|---|
| 5 | Defeasible argumentation with reinstatement | `argue(claims, ruleset)` → grounded extension. **Must include a test where A defeats B, C defeats A, and B is reinstated** — this is what earns the word "argumentation" |
| 6 | Abstention, conflict detection, determinism enforcement | `abstain()`, `detectConflict()`, plus the 1000-run single-hash determinism test |
| 7 | `reason()` — the public entry point | Wires argue → fuse → abstain into `Reasoning`; trace is a first-class output, not a log |
| 8 | Exhaustive counterfactual | Single flips then pairs, checked against a brute-force oracle |
| 9 | Argument-structure-driven VOI planner | Identifies the pivotal rule, scores candidate assays by expected gap reduction per unit cost |
| 10 | Python data layer + three-way split | DILIrank ingest, InChIKey crosswalk, seeded train/calibration/test split committed **before** any fitting |
| 11 | QSAR stream with split conformal | Leakage-safe training (TDC minus calibration/test by InChIKey), conformal prediction sets → `assertion` + `inApplicabilityDomain` |
| 12 | Tox21 in-vitro stream + TAK-994 fixture | PubChem PUG-REST pulls with provenance badges; TAK-994 two-pass fixture with `availableFrom` dates |
| 13 | Harness: engine run + three deterministic baselines | `results.json`; majority vote, weighted average, best single source |
| 14 | Harness: LLM ablation via Batches API | 25 runs/compound, structured outputs, refusal handling, prompt caching, **no temperature parameter** |
| 15 | Metrics suite | Five metrics with Wilson intervals; accuracy and coverage reported inseparably |
| 16 | Golden files + CI | Any change moving a benchmark number fails the build |

---

## Corrections to the spec this plan forces

Three things in `2026-07-26-arbiter-design.md` are not implementable as written and must be amended:

1. **§7/§8 say "temperature disclosed" and "temperature recorded and reported."** `temperature` does not exist on `claude-opus-5` — passing it returns HTTP 400. Replace with: *the API exposes no sampling parameters on this model; variance is measured at settings we could not have tuned.* This is strictly stronger, because it makes "you cranked the temperature" structurally impossible.

2. **§8 does not mention refusals.** `claude-opus-5` runs safety classifiers including a `bio` category, and drug-hepatotoxicity prompts can plausibly trip them. A refusal returns HTTP 200 with `stop_reason: "refusal"` and empty `content`. The harness must check `stop_reason` before reading `content`, count refusals, and **report the refusal rate alongside the ablation result** — a refused compound is an exclusion, not a wrong answer.

3. **§5 says the engine has zero runtime dependencies.** `zod` is admitted as the single exception, because validating at the seam is worth more than nominal purity and zod introduces no clock, no I/O, and no randomness. The ESLint rules still ban `fs`, `path`, `crypto`, `Math.random`, and parent-directory imports.

Task 14 additionally adopts three API features the spec did not anticipate: **structured outputs** (`output_config.format` with a Zod schema, so the baseline's verdict is schema-guaranteed and parser failure cannot be blamed for its variance), the **Batches API** (50% cheaper, correct shape for offline work), and **prompt caching** on the shared per-compound evidence prefix (25 runs share one prefix; `claude-opus-5`'s 512-token minimum means our evidence blocks qualify).
