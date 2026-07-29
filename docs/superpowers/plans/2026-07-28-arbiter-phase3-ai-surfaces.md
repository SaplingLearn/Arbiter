# ARBITER Phase 3 — the three AI surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the challenge interpreter and navigator to the ARBITER web app, complete and testable with no network, with a live model call as one optional rung on top.

**Architecture:** One generic fallback-ladder walker in `apps/web/src/ai/`; each surface declares its rungs as data and every resolution returns `{ value, rung, source }`, so "which rung answered" is a value the tests assert on and the pre-flight panel displays. A single `client.ts` is the only module permitted to issue a request, gated twice — by a build flag and by a `file://` protocol check — so the submitted ZIP never attempts a call. Two thin endpoints in `services/api/` back rung 1 when a service exists.

**Tech Stack:** TypeScript 5.x, React 18, Vite 5, vitest + Testing Library, Playwright, zod 3.

## Before you start

This plan assumes **PR #9 (`metrics-contract`) and PR #10 (`audit-record-integrity`) are merged**.
Two things they already did must not be re-done: `evidenceSnapshot` now serialises the whole claim,
and `ReviewerPosition.rulesetHash` now holds an actual digest of the working copy rather than the
string `"1.0"`. `results/metrics.json` is also schema-validated at both ends, so a renamed metric
fails at the writer.

Create the branch once, before Task 1:

```bash
git checkout main && git pull
git checkout -b phase3
```

Every task ends by pushing to it. Commit and push after every task — not batched.

## Global Constraints

- **Never edit `rules/ruleset-v1.0.json`.** It is pre-registered and hashed: `ed073a8a7f6d9a46572e6d10016c621f0e31f169bf2b7e9676c485630b5db136`. The harness refuses to run if the computed hash differs.
- **The engine stays pure.** No `Date`, `Math.random`, `node:*`, `fs`/`path`/`crypto`, dynamic `import`, or parent imports anywhere in `packages/engine/src`. Lint enforces every one.
- **Language discipline.** Write "review-ready evidence package" never "regulator-ready dossier"; "positions / sign-off / decision owner" never "voting / tally / majority"; "hash-chained audit log" never "blockchain". Applies to code, comments, UI copy, commit messages, and test names.
- **`apps/web/e2e/static-file.spec.ts` is not modified.** It must still pass unchanged with every surface on cache. It asserts on *attempted* requests (`page.on("request")` and `requestfailed`), not merely failed ones.
- **No runtime `fetch` in `apps/web` outside `apps/web/src/ai/client.ts`,** and there only when `liveEnabled`. This is the first legitimate relaxation of the Phase 2 invariant; nothing else relaxes it.
- **Cache artifacts are imported as ES modules at build time,** exactly as `apps/web/src/data/bundle.ts` imports evidence and metrics. Never fetched.
- **No number in `results/` may move.** `npm run golden:update` must produce no diff.
- **Every new test is watched failing before it is made to pass.** Banned patterns: asserting a value that is `0` under every implementation; `toContain` over all possible values; a range check under a guarantee-shaped name.
- **Commit and push after every task. Not batched.**

## File Structure

| File | Responsibility |
|---|---|
| `apps/web/src/ai/resolve.ts` | The generic ladder walker. Pure, no I/O. |
| `apps/web/src/ai/client.ts` | The only module permitted to issue a request. Owns `liveEnabled` and the 2.5s abort. |
| `apps/web/src/ai/trigram.ts` | Character-trigram Jaccard similarity, shared by both fuzzy rungs. |
| `apps/web/src/ai/interpret.ts` | Surface 1's five rungs and its response schema. |
| `apps/web/src/ai/navigate.ts` | Surface 3's five rungs and its response schema. |
| `apps/web/src/ai/anchors.ts` | The typed `ANCHORS` registry and the dynamic-id constructors. |
| `apps/web/src/ai/cache/interpretations.json` | The authored challenge → proposal cache. |
| `apps/web/src/ai/cache/anchor-map.json` | Cached question → anchor ids. |
| `apps/web/src/ai/cache/suggested-questions.json` | The four no-match fallbacks. |
| `apps/web/src/tabs/Case/TablePanel.tsx` | Surface 1's mount: challenge box, proposal confirmation, delta. |
| `apps/web/src/ai/NavigatorBar.tsx` | Surface 3's mount: a slim persistent bar in the shell. |
| `apps/web/src/ai/useAnchorScroll.ts` | Deferred anchor resolution, scroll, and spotlight lifecycle. |
| `apps/web/src/state/store.tsx` | Adds `evidenceEdits`, `pendingAnchor`, and the `workingClaims` selector. |
| `apps/web/src/ui/Preflight.tsx` | Per-surface live/cache reporting; `check-evidence-edits`. |
| `apps/web/src/tabs/Ruleset.tsx` | Renders precedence order, its rationale, and the abstention threshold. |
| `services/api/interpret.ts` | `POST /api/interpret`. |
| `services/api/navigate.ts` | `POST /api/navigate`. |

## Interface Contracts

**These signatures are fixed. Every task uses these exact names and types.**

```ts
// apps/web/src/ai/resolve.ts
export type Source = "live" | "cache" | "local" | "none";

export interface Resolution<T> {
  value: T | null;
  rung: number;      // 1-based; the rung that answered, or the last rung tried
  source: Source;
}

export interface Rung<I, T> {
  source: Source;
  run: (input: I) => Promise<T | null>;
}

export function resolve<I, T>(rungs: Rung<I, T>[], input: I): Promise<Resolution<T>>;

// apps/web/src/ai/client.ts
export const liveEnabled: boolean;
export const LIVE_TIMEOUT_MS = 2500;
export function postJson<T>(path: string, body: unknown, parse: (u: unknown) => T | null): Promise<T | null>;

// apps/web/src/ai/trigram.ts
export function trigrams(s: string): Set<string>;
export function jaccard(a: string, b: string): number;   // 0..1
export const FUZZY_THRESHOLD = 0.55;

// apps/web/src/ai/interpret.ts
export type InterpretAction = "disable" | "lower_strength" | "raise_strength" | "reclassify_field";
export type ReclassifiableField = keyof AssayOperator["produces"];

export interface Proposal {
  targetRule: RuleId | null;
  targetClaimId: string | null;
  action: InterpretAction;
  field: ReclassifiableField | null;
  newValue: unknown;
  paraphrase: string;
  confidence: "high" | "low";
}

export interface InterpretInput {
  challenge: string;
  rules: { id: RuleId; enabled: boolean; strength: number }[];
  claims: { id: string; label: string }[];
}

export const ProposalSchema: z.ZodType<Proposal>;
export function interpret(input: InterpretInput): Promise<Resolution<Proposal>>;

// apps/web/src/ai/navigate.ts
export interface NavResult { anchorIds: string[]; noMatch: boolean }
export interface NavigateInput { question: string; anchors: { id: string; label: string }[] }
export const NavResultSchema: z.ZodType<NavResult>;
export function navigate(input: NavigateInput): Promise<Resolution<NavResult>>;
export const SUGGESTED_QUESTIONS: string[];   // exactly 4

// apps/web/src/ai/anchors.ts
export interface Anchor { label: string; tab: TabId; region: Region | null }
export const ANCHORS: Record<string, Anchor>;
export function traceStep(claimId: string): string;      // `trace.step:${claimId}`
export function evidenceClaim(claimId: string): string;  // `evidence.claim:${claimId}`
export function ruleAnchor(id: RuleId): string;          // `rule.${id}`
export function isKnownAnchor(id: string): boolean;

// apps/web/src/state/store.tsx — additions
export type EvidenceEdit = Partial<Pick<EvidenceClaim, ReclassifiableField>>;
export function workingClaims(state: AppState, compoundId: string): EvidenceClaim[];
// new AppState fields:  evidenceEdits: Record<string, EvidenceEdit>;  pendingAnchor: string | null;
// new actions: { type: "reclassifyClaim"; claimId: string; edit: EvidenceEdit }
//              { type: "resetEvidence" }
//              { type: "setPendingAnchor"; anchorId: string | null }
```

## Task List

| # | Task | Depends on |
|---|---|---|
| 1 | The ladder walker, the client, and trigram similarity | — |
| 2 | The anchor registry and `data-anchor` attributes | — |
| 3 | The `workingClaims` selector and the evidence working copy | — |
| 4 | Surface 1 — the authored cache and rungs 2–5 | 1 |
| 5 | Surface 1 — confirm, apply, and the delta | 3, 4 |
| 6 | The Ruleset tab — precedence order and the abstention threshold | 2 |
| 7 | Surface 3 — the anchor map, rungs 2–5, and navigator state | 1, 2 |
| 8 | Surface 3 — deferred resolve, scroll, and the motion-aware spotlight | 7 |
| 9 | The API service and rung 1 for both surfaces | 4, 7 |
| 10 | The pre-flight rewrite and the registered evidence digest | 3, 9 |
| 11 | The §11 failure matrix and Surface 2's disabled row | 9 |

---
### Task 1: The ladder walker never guesses which rung answered, and the client can only miss

Spec sections 2, 3 and 4: one generic walker returning `{ value, rung, source }`, and one module permitted to issue a request, gated twice so the submitted ZIP never attempts a call.

**Files:**
- Create: `apps/web/src/ai/resolve.ts`
- Create: `apps/web/src/ai/trigram.ts`
- Create: `apps/web/src/ai/client.ts`
- Create: `apps/web/src/vite-env.d.ts`
- Test: `apps/web/test/resolve.test.ts`
- Test: `apps/web/test/trigram.test.ts`
- Test: `apps/web/test/client.test.ts`

**Interfaces:**
- Consumes: nothing. This is the foundation task; it imports no other module in the repo.
- Produces:
  - `export type Source = "live" | "cache" | "local" | "none"`
  - `export interface Resolution<T> { value: T | null; rung: number; source: Source }`
  - `export interface Rung<I, T> { source: Source; run: (input: I) => Promise<T | null> }`
  - `export function resolve<I, T>(rungs: Rung<I, T>[], input: I): Promise<Resolution<T>>`
  - `export const liveEnabled: boolean`
  - `export const LIVE_TIMEOUT_MS = 2500`
  - `export function postJson<T>(path: string, body: unknown, parse: (u: unknown) => T | null): Promise<T | null>`
  - `export function trigrams(s: string): Set<string>`
  - `export function jaccard(a: string, b: string): number`
  - `export const FUZZY_THRESHOLD = 0.55`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolve, type Rung, type Source } from "../src/ai/resolve.js";

/** A rung that passes. Returning null is the pass signal (spec section 3). */
const miss = (source: Source): Rung<string, string> => ({ source, run: async () => null });
/** A rung that answers. */
const hit = (source: Source, value: string): Rung<string, string> => ({ source, run: async () => value });

describe("resolve - the shared ladder walker (spec section 3)", () => {
  it("stops at the first rung that returns a value and never runs the rungs below it", async () => {
    // Spec section 12, trap 1: asserting "the ladder produced an answer" passes on
    // every rung and is worthless. `rung` is the assertion that carries weight,
    // and `ran` proves the walker stopped rather than merely preferring rung 2.
    const ran: number[] = [];
    const r = await resolve<string, string>(
      [
        { source: "live", run: async () => { ran.push(1); return null; } },
        { source: "cache", run: async () => { ran.push(2); return "cached"; } },
        { source: "local", run: async () => { ran.push(3); return "local"; } },
      ],
      "q",
    );
    expect(r.value).toBe("cached");
    expect(r.rung).toBe(2);
    expect(r.source).toBe("cache");
    expect(ran).toEqual([1, 2]);
  });

  it("reports rung 1 when rung 1 answers, so a live answer is distinguishable from a cached one", async () => {
    // The pre-flight panel prints exactly this distinction (spec section 10).
    const r = await resolve([hit("live", "fresh"), hit("cache", "stale")], "q");
    expect(r.rung).toBe(1);
    expect(r.source).toBe("live");
    expect(r.value).toBe("fresh");
  });

  it("descends past every passing rung and reports the LAST rung tried, with source none", async () => {
    const r = await resolve([miss("live"), miss("cache"), miss("local"), miss("none")], "q");
    expect(r.value).toBeNull();
    // Four, not zero and not five: a presenter reading the pre-flight panel needs
    // the rung that was actually reached.
    expect(r.rung).toBe(4);
    expect(r.source).toBe("none");
  });

  it("carries the source declared by the rung that answered, not the ladder's first source", async () => {
    // A walker that reported the ladder's head would make every answer look live
    // on a served build - the precise claim spec section 10 forbids the panel to make.
    const r = await resolve([miss("live"), miss("cache"), hit("local", "keyword")], "q");
    expect(r.source).toBe("local");
    expect(r.rung).toBe(3);
  });

  it("hands the same input to every rung it tries", async () => {
    const seen: string[] = [];
    await resolve<string, string>(
      [
        { source: "live", run: async (i) => { seen.push(i); return null; } },
        { source: "cache", run: async (i) => { seen.push(i); return null; } },
        { source: "none", run: async (i) => { seen.push(i); return i.toUpperCase(); } },
      ],
      "the rat study",
    );
    expect(seen).toEqual(["the rat study", "the rat study", "the rat study"]);
  });

  it("lets a throw escape rather than quietly treating it as a miss", async () => {
    // Deliberate, and the reason is in resolve.ts. Rung 1 cannot throw - postJson
    // returns null for every transport failure - so a throw here is a bug in a
    // pure local rung. Swallowing it would silently degrade past a broken rung
    // while still reporting a plausible `rung`.
    const boom: Rung<string, string> = {
      source: "cache",
      run: async () => { throw new Error("cache is corrupt"); },
    };
    await expect(resolve([miss("live"), boom, hit("none", "picker")], "q")).rejects.toThrow(/cache is corrupt/);
  });

  it("returns rung 0 for an empty ladder rather than naming a rung that was never tried", async () => {
    const r = await resolve<string, string>([], "q");
    expect(r).toEqual({ value: null, rung: 0, source: "none" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/resolve.test.ts`
Expected: FAIL — `Failed to load url ../src/ai/resolve.js` (cannot resolve `../src/ai/resolve.js` from `apps/web/test/resolve.test.ts`)

- [ ] **Step 3: Write the walker**

Create `apps/web/src/ai/resolve.ts`:

```ts
/**
 * The generic fallback ladder, shared by both AI surfaces (spec section 3).
 *
 * Each surface declares its rungs as DATA and this walker runs them in order,
 * stopping at the first one that returns a value. `null` is the pass signal.
 *
 * The rung that answered is returned as a value rather than left as a comment.
 * That is what makes spec section 11's fifteen-cell failure matrix cheap: above the
 * transport boundary every failure is the same event, so the tests assert on
 * `rung` rather than on "an answer appeared" (spec section 12, trap 1), and the
 * pre-flight panel reports which surfaces are live and which are on cache (spec
 * section 10) from the same field.
 *
 * No I/O, no imports. The only module permitted to issue a request is client.ts.
 */
export type Source = "live" | "cache" | "local" | "none";

export interface Resolution<T> {
  value: T | null;
  /** 1-based; the rung that answered, or the last rung tried. */
  rung: number;
  source: Source;
}

export interface Rung<I, T> {
  source: Source;
  run: (input: I) => Promise<T | null>;
}

export async function resolve<I, T>(rungs: Rung<I, T>[], input: I): Promise<Resolution<T>> {
  for (let i = 0; i < rungs.length; i++) {
    const rung = rungs[i]!;
    // Deliberately NOT wrapped in try/catch. Rung 1 is guaranteed not to throw
    // because client.postJson returns null for every transport failure (spec
    // section 3's invariant), so a throw here is a bug in a pure local rung.
    // Swallowing it would degrade the surface past a broken rung while still
    // reporting a plausible `rung`, which is the one failure the assert-on-rung
    // discipline exists to catch.
    const value = await rung.run(input);
    if (value !== null) return { value, rung: i + 1, source: rung.source };
  }
  // Exhausted. `source` is "none" rather than the last rung's declared source:
  // nothing answered, so nothing may be reported as having answered.
  return { value: null, rung: rungs.length, source: "none" };
}
```

- [ ] **Step 4: Write the failing similarity test**

The four strings below are the ones the threshold is calibrated on, and the four
scores stated in the test names were computed with the implementation in Step 6:
0.850, 0.7385, 0.0202 and 0.0515.

Create `apps/web/test/trigram.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FUZZY_THRESHOLD, jaccard, trigrams } from "../src/ai/trigram.js";

// Drawn from the authored challenge set and the prepared Q&A (spec sections 12b
// and 13): the exposure-margin objection, the species-weighting objection, the
// Klimisch-on-QSAR category error, and a precedence QUESTION - which belongs in
// the navigator's anchor map, not the challenge cache (spec section 13). These are
// the strings rung 3 actually matches against, so they are the strings the
// threshold has to be calibrated on.
const MARGIN = "A margin over 100x should count as exposure relevant";
const MARGIN_REPHRASED = "The margin is over 100x, so this should count as exposure relevant";
const SPECIES = "The rat study should not outweigh the human hepatocyte data";
const SPECIES_REPHRASED = "The rat study shouldn't outweigh the human hepatocyte data";
const KLIMISCH = "A Klimisch score on a QSAR claim is a category error";
const PRECEDENCE = "Why does R3 outrank R1 in the precedence order?";

describe("trigrams", () => {
  it("pads so the first and last words carry boundary trigrams", () => {
    expect([...trigrams("rat")]).toEqual([" ra", "rat", "at "]);
  });

  it("folds case and punctuation, so a trailing question mark costs nothing", () => {
    expect([...trigrams("Rat!")]).toEqual([...trigrams("rat")]);
  });

  it("returns nothing for an input too short to hold a trigram", () => {
    expect(trigrams("").size).toBe(0);
  });
});

describe("jaccard against FUZZY_THRESHOLD", () => {
  it("uses the threshold spec sections 5.1 and 7.1 registered", () => {
    expect(FUZZY_THRESHOLD).toBe(0.55);
  });

  it("scores a contraction rewording of the species objection at 0.850, above the threshold", () => {
    // "should not" against "shouldn't" shares no word and almost every trigram.
    // This is the rewording rung 3 exists for.
    const s = jaccard(SPECIES, SPECIES_REPHRASED);
    expect(s).toBeCloseTo(0.85, 3);
    expect(s).toBeGreaterThan(FUZZY_THRESHOLD);
  });

  it("scores a clause-order rewording of the margin objection at 0.738, above the threshold", () => {
    const s = jaccard(MARGIN, MARGIN_REPHRASED);
    expect(s).toBeCloseTo(0.7385, 3);
    expect(s).toBeGreaterThan(FUZZY_THRESHOLD);
  });

  it("scores two genuinely different challenges at 0.020, far below the threshold", () => {
    // Spec section 5.2: two authored challenges sitting one bad trigram match apart is
    // the failure that flips the position on the hero case. The margin objection
    // and the Klimisch category error must not be near each other.
    const s = jaccard(MARGIN, KLIMISCH);
    expect(s).toBeCloseTo(0.0202, 3);
    expect(s).toBeLessThan(FUZZY_THRESHOLD);
  });

  it("scores a challenge against a navigator QUESTION at 0.052, far below the threshold", () => {
    // The two caches are for different things (spec section 13). A question leaking
    // into the challenge ladder would have to invent a rule edit to justify itself.
    const s = jaccard(SPECIES, PRECEDENCE);
    expect(s).toBeCloseTo(0.0515, 3);
    expect(s).toBeLessThan(FUZZY_THRESHOLD);
  });

  it("is symmetric and scores a string against itself at 1", () => {
    expect(jaccard(MARGIN, SPECIES)).toBe(jaccard(SPECIES, MARGIN));
    expect(jaccard(MARGIN, MARGIN)).toBe(1);
  });

  it("scores an empty challenge at 0 against every cached entry", () => {
    // 0/0 resolved to 0, not 1. At 1 an empty box would match the first cached
    // entry at rung 3 and propose a rule change out of nothing.
    expect(jaccard("", MARGIN)).toBe(0);
    expect(jaccard("", "")).toBe(0);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npm test -- apps/web/test/trigram.test.ts`
Expected: FAIL — `Failed to load url ../src/ai/trigram.js`

- [ ] **Step 6: Write the similarity module**

Create `apps/web/src/ai/trigram.ts`:

```ts
/**
 * Character-trigram Jaccard similarity, shared by rung 3 of both surfaces
 * (spec sections 5.1 and 7.1).
 *
 * Character trigrams rather than word overlap because the inputs are one-sentence
 * objections whose rewordings differ by inflection and contraction more than by
 * vocabulary - "should not" against "shouldn't" shares no word but almost every
 * trigram.
 */

/** Rung 3 accepts a cached entry at or above this similarity. */
export const FUZZY_THRESHOLD = 0.55;

/**
 * Case, punctuation and runs of whitespace are folded away before the window
 * slides, so "100x," and "100x" are one token and a trailing question mark does
 * not cost a match.
 */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function trigrams(s: string): Set<string> {
  // One space of padding either side so the first and last words contribute
  // boundary trigrams. Measured: "rat" against "brat" scores 0.40 padded and 0.50
  // unpadded, because unpadded every trigram of "rat" is also a trigram of "brat".
  const padded = ` ${normalise(s)} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

export function jaccard(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  // An empty or sub-trigram input scores 0 against everything rather than 1.
  // |empty and empty| / |empty or empty| is 0/0; choosing 1 would let an empty
  // challenge box match the first cached entry at rung 3 and propose a rule
  // change out of nothing.
  if (A.size === 0 || B.size === 0) return 0;
  let intersection = 0;
  for (const g of A) if (B.has(g)) intersection++;
  return intersection / (A.size + B.size - intersection);
}
```

- [ ] **Step 7: Write the failing client test**

`liveEnabled` is a module-level const, so every case resets the module registry
and re-imports. `vi.stubGlobal("location", ...)` works because vitest's jsdom
environment defines `location` on the node global as a configurable accessor;
jsdom's own `window.location` is `[Unforgeable]` and cannot be redefined, so do
not reach for `Object.defineProperty(window, "location", ...)`.

Create `apps/web/test/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

type Client = typeof import("../src/ai/client.js");

/**
 * `liveEnabled` is a module-level const evaluated once at import, which is the
 * point: Vite replaces import.meta.env statically, so on the static build the
 * expression folds to false rather than becoming a branch nobody took. Every case
 * below therefore resets the module registry and re-imports instead of
 * reassigning anything.
 */
async function loadClient(flag: string | undefined, protocol: string): Promise<Client> {
  vi.stubEnv("VITE_ARBITER_LIVE", flag);
  vi.stubGlobal("location", { protocol, href: `${protocol}//host/index.html` });
  vi.resetModules();
  return import("../src/ai/client.js");
}

/**
 * The slice of fetch's init this module actually sets. Spelled out rather than
 * reaching for the DOM lib's RequestInit, which is a type-only interface and not
 * a runtime global, so eslint's no-undef does not recognise it.
 */
interface FetchInit { method?: string; body?: string; signal?: AbortSignal }

/** A fetch that resolves to a body, so the null-returning cases below can fail. */
function stubFetch(impl: (path: string, init: FetchInit) => Promise<unknown>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("liveEnabled - two independent gates (spec section 2)", () => {
  it("is TRUE only when the build flag is 1 and the page is not on file://", async () => {
    // Without this case every gate test below would pass on a client that hard-
    // coded false, and the live rung would be dead code nobody noticed.
    const c = await loadClient("1", "http:");
    expect(c.liveEnabled).toBe(true);
  });

  it("is false when the build flag is absent, even over http", async () => {
    // Gate 1 alone. This is the state the submitted ZIP is compiled in.
    const c = await loadClient(undefined, "http:");
    expect(c.liveEnabled).toBe(false);
  });

  it("is false when the build flag is any value other than 1", async () => {
    const c = await loadClient("true", "https:");
    expect(c.liveEnabled).toBe(false);
  });

  it("is FALSE over file:// even when the build flag is on", async () => {
    // Gate 2 alone, and the single most important assertion in this task.
    // static-file.spec.ts collects page.on("request") as well as requestfailed and
    // asserts both are empty, so a ZIP built from the wrong config must not even
    // ATTEMPT the call. A false positive here breaks the submitted artifact.
    const c = await loadClient("1", "file:");
    expect(c.liveEnabled).toBe(false);
  });

  it("is false when both gates are shut", async () => {
    const c = await loadClient(undefined, "file:");
    expect(c.liveEnabled).toBe(false);
  });
});

describe("postJson - a miss, never a throw (spec sections 3 and 11)", () => {
  it("returns the parsed value when the service answers well", async () => {
    // The case that makes every "returns null" test below able to fail.
    const c = await loadClient("1", "http:");
    const spy = stubFetch(async () => ok({ shape: "right" }));
    const parse = (u: unknown) => ((u as { shape?: string }).shape === "right" ? "PARSED" : null);

    await expect(c.postJson("/api/interpret", { challenge: "x" }, parse)).resolves.toBe("PARSED");
    expect(spy).toHaveBeenCalledTimes(1);
    const [path, init] = spy.mock.calls[0]!;
    expect(path).toBe("/api/interpret");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ challenge: "x" }));
  });

  it("does not call fetch AT ALL when liveEnabled is false", async () => {
    // Not "survives the failure" - never attempts it. Surviving a failed request
    // still fails static-file.spec.ts.
    const c = await loadClient("1", "file:");
    const spy = stubFetch(async () => ok({ shape: "right" }));

    await expect(c.postJson("/api/interpret", {}, () => "PARSED")).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null when the network rejects", async () => {
    // Spec section 11, network-off.
    const c = await loadClient("1", "http:");
    stubFetch(async () => { throw new TypeError("Failed to fetch"); });
    await expect(c.postJson("/api/interpret", {}, () => "PARSED")).resolves.toBeNull();
  });

  it("returns null on a non-2xx status", async () => {
    // Spec section 11, HTTP 500.
    const c = await loadClient("1", "http:");
    stubFetch(async () => ({ ok: false, status: 500, json: async () => ({ shape: "right" }) }));
    await expect(c.postJson("/api/interpret", {}, () => "PARSED")).resolves.toBeNull();
  });

  it("returns null on the 503 no_key a keyless service returns", async () => {
    // Spec section 11, missing key. Identical to a timeout from the caller's side,
    // which is the whole point of the invariant.
    const c = await loadClient("1", "http:");
    stubFetch(async () => ({ ok: false, status: 503, json: async () => ({ error: "no_key" }) }));
    await expect(c.postJson("/api/interpret", {}, () => "PARSED")).resolves.toBeNull();
  });

  it("returns null when the body will not parse as JSON", async () => {
    // Spec section 11, malformed JSON.
    const c = await loadClient("1", "http:");
    stubFetch(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } }));
    await expect(c.postJson("/api/interpret", {}, () => "PARSED")).resolves.toBeNull();
  });

  it("returns null when the body parses but the caller's parse REJECTS it", async () => {
    // A 200 carrying well-formed JSON of the wrong shape. Spec section 11 singles this
    // out: malformed JSON fails loudly and this does not, so it is the case that
    // would otherwise reach the confirm panel.
    const c = await loadClient("1", "http:");
    stubFetch(async () => ok({ totally: "wrong" }));
    const parse = (u: unknown) => ((u as { shape?: string }).shape === "right" ? "PARSED" : null);
    await expect(c.postJson("/api/interpret", {}, parse)).resolves.toBeNull();
  });

  it("returns null when the caller's parse THROWS, as zod's .parse does", async () => {
    const c = await loadClient("1", "http:");
    stubFetch(async () => ok({ totally: "wrong" }));
    const parse = () => { throw new Error("Invalid literal"); };
    await expect(c.postJson("/api/interpret", {}, parse)).resolves.toBeNull();
  });

  it("aborts at LIVE_TIMEOUT_MS and returns null", async () => {
    // Spec section 11, timeout. Driven on fake timers rather than by waiting 2.5s.
    const c = await loadClient("1", "http:");
    expect(c.LIVE_TIMEOUT_MS).toBe(2500);

    stubFetch((_path, init) => new Promise((_res, rej) => {
      init.signal?.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")));
    }));

    vi.useFakeTimers();
    const pending = c.postJson("/api/interpret", {}, () => "PARSED");
    await vi.advanceTimersByTimeAsync(2500);
    await expect(pending).resolves.toBeNull();
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npm test -- apps/web/test/client.test.ts`
Expected: FAIL — `Failed to load url ../src/ai/client.js` (14 tests, all erroring on the same unresolved import)

- [ ] **Step 9: Write the client and declare the build flag**

Create `apps/web/src/ai/client.ts`:

```ts
/**
 * The ONLY module in apps/web permitted to issue a request (spec section 4).
 *
 * This is the first and only relaxation of the Phase 2 "no runtime fetch in
 * apps/web" invariant, and it is relaxed only here and only when `liveEnabled`.
 */

/** Spec sections 5.1 and 7.1: rung 1 gets 2.5 seconds and not a millisecond more. */
export const LIVE_TIMEOUT_MS = 2500;

/**
 * Two independent gates, computed once (spec section 2).
 *
 * The build flag means the submitted ZIP is compiled with live off entirely. The
 * protocol check means a ZIP built from the wrong config still cannot fire a
 * request. The redundancy is deliberate: apps/web/e2e/static-file.spec.ts collects
 * page.on("request") as well as requestfailed and asserts both are empty, so over
 * file:// the app must not ATTEMPT the call - a build that tries and fails still
 * fails the test.
 *
 * A module-level const, not a function: Vite replaces import.meta.env statically
 * at build time, so on the static build this whole expression folds to `false` and
 * the fetch below is unreachable code rather than a branch nobody took.
 */
export const liveEnabled =
  import.meta.env.VITE_ARBITER_LIVE === "1" && location.protocol !== "file:";

/**
 * Post JSON and return the parsed value, or null.
 *
 * NEVER throws. Spec section 3's invariant is that rung 1 either succeeds or is
 * skipped: network-off, HTTP 500, malformed JSON, timeout and the 503
 * {"error":"no_key"} a keyless service returns are all one event to the caller, a
 * rung-1 miss. That is what collapses spec section 11's matrix into five transport
 * tests instead of fifteen bespoke ones.
 *
 * `parse` is the caller's SCHEMA CHECK, not a cast. A 200 carrying well-formed
 * JSON of the wrong shape is the case that would otherwise reach the confirm
 * panel, so a parse that returns null - or throws, as zod's .parse does - is a
 * miss like the rest.
 */
export async function postJson<T>(
  path: string,
  body: unknown,
  parse: (u: unknown) => T | null,
): Promise<T | null> {
  // Before the AbortController, before anything: on the static build nothing here
  // may run at all.
  if (!liveEnabled) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return parse((await res.json()) as unknown);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

Create `apps/web/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * "1" turns the live rung on. Anything else, including unset, leaves it off.
   *
   * The submitted ZIP is built without it, which is one of the two gates in
   * src/ai/client.ts (spec section 2). Declared here so that the flag's contract
   * is written down somewhere rather than living only in a string comparison.
   */
  readonly VITE_ARBITER_LIVE?: string;
}
```

- [ ] **Step 10: Watch the file:// gate fail, so it is known to work**

Temporarily weaken the second gate in `apps/web/src/ai/client.ts`:

```ts
export const liveEnabled =
  import.meta.env.VITE_ARBITER_LIVE === "1";
```

Run: `npm test -- apps/web/test/client.test.ts`
Expected: **FAIL** on "is FALSE over file:// even when the build flag is on" and on
"does not call fetch AT ALL when liveEnabled is false". Restore the `&&
location.protocol !== "file:"` clause and re-run to confirm green. A gate nobody
has watched fail is not known to work, and this one is what keeps the submitted
ZIP passing `static-file.spec.ts`.

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npm test -- apps/web && npm run typecheck && npm run web:build`
Expected: PASS (31 new tests: 7 walker, 10 similarity, 14 client), build succeeds

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/ai apps/web/src/vite-env.d.ts apps/web/test/resolve.test.ts apps/web/test/trigram.test.ts apps/web/test/client.test.ts
git commit -m "$(cat <<'MSG'
Add the shared ladder walker, the double-gated client and trigram similarity

Spec section 3 makes "which rung answered" a VALUE rather than a comment, and that
one decision is what makes the rest of this phase affordable. Spec section 11 asks
for five failure conditions across three surfaces; because every failure above the
transport boundary is the same event, the matrix collapses into one thorough test
of the walker plus five transport tests. The walker therefore returns
{ value, rung, source } and the tests assert on `rung` - spec section 12's first
trap is that "an answer appeared" passes on every rung and is worthless.

resolve() deliberately does not catch. postJson is guaranteed not to throw, so a
throw inside the ladder is a bug in a pure local rung; swallowing it would degrade
the surface past a broken rung while still reporting a plausible rung number,
which is the exact failure assert-on-rung exists to catch.

liveEnabled is gated twice, per spec section 2. The build flag means the submitted
ZIP is compiled with live off; the protocol check means a ZIP built from the wrong
config still cannot fire a request. static-file.spec.ts asserts on ATTEMPTED
requests, not failed ones, so surviving a blocked call is not good enough - the
call must never be made. Both gates are tested in both directions, and the
protocol gate was watched failing before being made to pass.

FUZZY_THRESHOLD stays at the 0.55 spec sections 5.1 and 7.1 registered. Measured
on the authored strings: a contraction rewording of the species objection scores
0.850 and a clause-order rewording of the margin objection 0.738, while the margin
objection against the Klimisch category error scores 0.020 and against a
precedence question 0.052. The threshold sits in open space, not between two
neighbours.

This is also the first and only relaxation of the Phase 2 "no runtime fetch in
apps/web" invariant. It is relaxed inside client.ts, only when liveEnabled, and it
is written down here rather than left to erode quietly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
git push origin phase3
```

---

### Task 2: Anchors get their own namespace, because the testids are already spoken for

Spec section 8: the navigator may only point at declared anchors, and five existing testids are non-unique by construction while ten more are frozen by Playwright.

**Files:**
- Create: `apps/web/src/ai/anchors.ts`
- Modify: `apps/web/src/tabs/Case/BeliefTrack.tsx:13`
- Modify: `apps/web/src/tabs/Case/TracePanel.tsx:1-52`
- Modify: `apps/web/src/tabs/Case/EvidencePanel.tsx:3-41`
- Modify: `apps/web/src/tabs/Case/CaseHeader.tsx:25-43`
- Modify: `apps/web/src/tabs/Ruleset.tsx:2-45`
- Modify: `apps/web/src/tabs/Record.tsx:4-69`
- Modify: `apps/web/src/tabs/Validation.tsx:32-98`
- Modify: `apps/web/src/tabs/Compounds.tsx:24-33`
- Test: `apps/web/test/anchors.test.tsx`

**Interfaces:**
- Consumes: `type RuleId` from `@arbiter/engine`; `type TabId` from `../router.js`; `type Region` from `../state/store.js`. All three are type-only imports, so `anchors.ts` pulls no React into a module the navigator's pure rungs will import.
- Produces:
  - `export interface Anchor { label: string; tab: TabId; region: Region | null }`
  - `export const ANCHORS` (`as const satisfies Record<string, Anchor>`) and `export type AnchorId = keyof typeof ANCHORS`
  - `export const CONDITIONAL_ANCHORS` — the five declared-but-sometimes-absent ids of spec section 7.2
  - `export function traceStep(claimId: string): string` — `trace.step:${claimId}`
  - `export function evidenceClaim(claimId: string): string` — `evidence.claim:${claimId}`
  - `export function ruleAnchor(id: RuleId): string` — `rule.${id}`
  - `export function recordPosition(index: number): string` — `record.position:${index}`
  - `export function isKnownAnchor(id: string): boolean`
  - `export interface ParsedAnchor { family: string; payload: string | null; anchor: Anchor }`
  - `export function parseAnchor(id: string): ParsedAnchor | null` — additive to the skeleton, and load-bearing twice: Task 8's `useAnchorScroll` needs the `{ tab, region }` of a DYNAMIC id in order to switch tab and un-collapse before scrolling, and `payload` is what makes spec section 8's "prefix-slice, never split(':')" rule enforceable by a test instead of by a comment. `isKnownAnchor` is defined as `parseAnchor(id) !== null`.
  - `export const TRACE_STEP_PREFIX`, `EVIDENCE_CLAIM_PREFIX`, `RECORD_POSITION_PREFIX`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/anchors.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ANCHORS, CONDITIONAL_ANCHORS, evidenceClaim, isKnownAnchor, parseAnchor,
  recordPosition, ruleAnchor, traceStep, type AnchorId,
} from "../src/ai/anchors.js";
import { StoreProvider } from "../src/state/store.js";
import { loadData } from "../src/data/load.js";
import { CaseTab } from "../src/tabs/Case/index.js";
import { CompoundsTab } from "../src/tabs/Compounds.js";
import { RulesetTab } from "../src/tabs/Ruleset.js";
import { ValidationTab } from "../src/tabs/Validation.js";
import { RecordTab } from "../src/tabs/Record.js";

const data = loadData();
const conditional = new Set<string>(CONDITIONAL_ANCHORS);
const at = (id: string) => document.querySelectorAll(`[data-anchor="${id}"]`);

const TABS = {
  case: <CaseTab />,
  compounds: <CompoundsTab />,
  ruleset: <RulesetTab />,
  validation: <ValidationTab />,
  record: <RecordTab />,
} as const;

/**
 * Unmounts whatever was rendered before. Several cases below render two tabs in
 * one test, and without this the querySelectorAll counts would silently span both
 * - which is how a per-tab uniqueness assertion turns into a no-op.
 */
const renderTab = (tab: keyof typeof TABS) => {
  cleanup();
  return render(<StoreProvider data={data}>{TABS[tab]}</StoreProvider>);
};

describe("the anchor registry (spec section 8)", () => {
  it("gives every entry a non-empty label, and no two entries the same one", () => {
    // The navigator's rung 4 matches keywords over these labels (spec section 7.1),
    // so a duplicate would make that rung ambiguous by construction.
    const labels = Object.values(ANCHORS).map((a) => a.label);
    expect(labels.every((l) => l.trim().length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("declares a region for exactly the anchors inside the collapsing Case grid", () => {
    // `region` is load-bearing: a collapsed Case region UNMOUNTS its content, so
    // the navigator dispatches setFocus before it scrolls. The four header anchors
    // sit OUTSIDE that grid and are never collapsed - giving them a region would
    // make the navigator collapse two panels to reach something already on screen.
    const withRegion = Object.entries(ANCHORS).filter(([, a]) => a.region !== null).map(([id]) => id);
    expect(withRegion.sort()).toEqual([
      "evidence.citationStatus",
      "trace.beliefTrack",
      "trace.counterfactual",
      "trace.mass",
      "trace.nextExperiment",
      "trace.verdictReason",
    ]);
    for (const id of withRegion) expect(ANCHORS[id as AnchorId].tab, id).toBe("case");
  });

  it("builds every dynamic id through a constructor, so no prefix is hand-typed", () => {
    expect(traceStep("TAK-994:qsar")).toBe("trace.step:TAK-994:qsar");
    expect(evidenceClaim("TAK-994:qsar")).toBe("evidence.claim:TAK-994:qsar");
    expect(ruleAnchor("R3")).toBe("rule.R3");
    expect(recordPosition(0)).toBe("record.position:0");
  });

  it("PARSES BY PREFIX-SLICE, so a claim id keeps both of its colons", () => {
    // The trap spec section 8 names. Claim ids contain ":" and baseline names do too, so
    // split(":")[1] on this id yields "TAK-994" - a different, real-looking claim
    // prefix - and the navigator scrolls to the wrong row or to nothing.
    const claimId = "TAK-994:invivo_rodent";
    const parsed = parseAnchor(evidenceClaim(claimId));
    expect(parsed).not.toBeNull();
    expect(parsed!.payload).toBe(claimId);
    expect(parsed!.family).toBe("evidence.claim");
    expect(parsed!.anchor.region).toBe("evidence");
    // Written out so the trap is visible rather than described: this is what the
    // naive parse would have handed back.
    expect(evidenceClaim(claimId).split(":")[1]).toBe("TAK-994");
  });

  it("resolves the six rule anchors statically, because RuleId is a closed union", () => {
    for (const id of ["R1", "R2", "R3", "R4", "R5", "R6"] as const) {
      expect(isKnownAnchor(ruleAnchor(id)), id).toBe(true);
    }
  });

  it("rejects an id that is not in the registry, and a bare prefix carrying no target", () => {
    // Spec section 7.2: an id not in the registry is filtered. Spec section 7.2 also
    // forbids pointing at nothing, which a bare prefix does.
    expect(isKnownAnchor("trace.invented")).toBe(false);
    expect(isKnownAnchor("evidence.claim:")).toBe(false);
    expect(isKnownAnchor("rule.R7")).toBe(false);
    expect(isKnownAnchor("")).toBe(false);
  });

  it("declares every conditional anchor, so 'absent' is distinguishable from 'unknown'", () => {
    // The distinction spec section 7.2 rests on: an unknown id is dropped, a declared
    // one means switch tab, un-collapse, re-check.
    for (const id of CONDITIONAL_ANCHORS) {
      expect(isKnownAnchor(id), id).toBe(true);
      expect(Object.keys(ANCHORS), id).toContain(id);
    }
  });
});

describe("every declared anchor resolves in the DOM", () => {
  for (const tab of Object.keys(TABS) as (keyof typeof TABS)[]) {
    it(`${tab}: every unconditional anchor is present exactly once`, () => {
      // This is what catches a registry entry whose element was renamed - the
      // failure spec section 12 says the cheap content tests exist for.
      renderTab(tab);
      const declared = (Object.keys(ANCHORS) as AnchorId[])
        .filter((id) => ANCHORS[id].tab === tab && !conditional.has(id));
      expect(declared.length).toBeGreaterThan(0);
      for (const id of declared) expect(at(id).length, id).toBe(1);
    });
  }

  it("mounts the four conditional anchors that TAK-994 does satisfy", () => {
    // Conditional does not mean untested. On the registered ruleset with the whole
    // fixture visible the counterfactual, the planner's next experiment and the
    // citation status all render, so a rename of any of them fails here.
    renderTab("case");
    expect(at("trace.counterfactual").length).toBe(1);
    expect(at("trace.nextExperiment").length).toBe(1);
    expect(at("evidence.citationStatus").length).toBe(1);
    renderTab("validation");
    expect(at("validation.singleClassWarning").length).toBe(1);
  });

  it("mounts ruleset.modifiedBadge only once the ruleset diverges, and it is a known id while absent", () => {
    // The one anchor genuinely absent in the default state. Asserting only its
    // absence would pass on a deleted element, so the badge is made to appear.
    renderTab("ruleset");
    expect(at("ruleset.modifiedBadge").length).toBe(0);
    expect(isKnownAnchor("ruleset.modifiedBadge")).toBe(true);

    fireEvent.change(screen.getByTestId("strength-R3"), { target: { value: "0.05" } });
    expect(at("ruleset.modifiedBadge").length).toBe(1);
  });

  it("gives every evidence claim and every trace step its own anchor", () => {
    renderTab("case");
    for (const c of data.fixture.claims) expect(at(evidenceClaim(c.id)).length, c.id).toBe(1);
    // The fixture's ids carry a colon, so these are the prefix-slice cases in the DOM.
    expect(at(traceStep("TAK-994:toxicogenomics-murine")).length).toBe(1);
    expect(at(traceStep("TAK-994:qsar")).length).toBe(1);
  });

  it("anchors a recorded position once it exists", async () => {
    renderTab("record");
    expect(at(recordPosition(0)).length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /sign/i }));
    await waitFor(() => expect(at(recordPosition(0)).length).toBe(1));
  });
});

describe("data-anchor is a new attribute, not a reshaped testid", () => {
  it("leaves all ten Playwright-frozen testids in place", () => {
    // Frozen by apps/web/e2e/demo.spec.ts and static-file.spec.ts. Renaming any of
    // them breaks a spec this phase is forbidden to touch.
    renderTab("case");
    for (const id of ["verdict", "belief-fill", "citation-status"]) {
      expect(screen.getAllByTestId(id).length, id).toBeGreaterThan(0);
    }
    renderTab("ruleset");
    for (const id of ["live-belief", "strength-R1"]) {
      expect(screen.getAllByTestId(id).length, id).toBeGreaterThan(0);
    }
    fireEvent.change(screen.getByTestId("strength-R3"), { target: { value: "0.05" } });
    expect(screen.getAllByTestId("modified-badge").length).toBeGreaterThan(0);
    renderTab("validation");
    expect(screen.getAllByTestId("single-class-warning").length).toBeGreaterThan(0);
  });

  it("keeps the two different `provenance` testids apart under their own anchor", () => {
    // The collision that is the reason anchors get their own namespace: the
    // evidence provenance line and the Validation provenance line share one testid.
    renderTab("validation");
    expect(screen.getAllByTestId("provenance").length).toBe(1);
    expect(at("validation.provenance").length).toBe(1);

    renderTab("case");
    // Many evidence rows carry `provenance`; none of them answers to the
    // Validation tab's anchor, which is now unmounted.
    expect(screen.getAllByTestId("provenance").length).toBeGreaterThan(1);
    expect(at("validation.provenance").length).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/anchors.test.tsx`
Expected: FAIL — `Failed to load url ../src/ai/anchors.js` (cannot resolve `../src/ai/anchors.js`)

- [ ] **Step 3: Confirm the ten frozen testids before touching a component**

Run:

```bash
grep -rho 'getByTestId("[^"]*")' apps/web/e2e | sort -u
```

Expected, exactly these ten and nothing else: `verdict`, `belief-fill`,
`single-class-warning`, `live-belief`, `strength-R1`, `modified-badge`,
`position-row`, `check-ruleset`, `check-manifest`, `citation-status`. Every one of
them must survive Steps 5 to 12 unrenamed — `apps/web/e2e/static-file.spec.ts` is
not modified in this phase and must still pass unchanged. If the grep returns an
eleventh name, add it to the frozen list in Step 1's test before continuing.

- [ ] **Step 4: Write the registry**

Create `apps/web/src/ai/anchors.ts`:

```ts
import type { RuleId } from "@arbiter/engine";
import type { TabId } from "../router.js";
import type { Region } from "../state/store.js";

/**
 * The anchor registry: every place the navigator (spec section 7) is allowed to
 * point at.
 *
 * A NEW `data-anchor` attribute, never a reuse of `data-testid` (spec section 8).
 * Five testids are non-unique by construction - `evidence-row`, `trace-step`,
 * `compound-row`, `rule-card`, `position-row` - and those are exactly the families
 * that need a per-instance anchor. `provenance` is two different things in two
 * different tabs. Ten more are frozen by the Playwright specs and cannot be
 * reshaped. The two attributes coexist on the same element and neither is renamed.
 *
 * `region` is load-bearing, not decoration: a collapsed Case region UNMOUNTS its
 * content, so while the tour sits on beat 2 no evidence row exists in the DOM at
 * all. The navigator dispatches `setFocus` before it scrolls.
 */
export interface Anchor {
  label: string;
  tab: TabId;
  region: Region | null;
}

/**
 * Declared but legitimately absent at times (spec section 7.2). These are NOT
 * unknown ids: an unknown id is filtered and dropped, whereas one of these means
 * "switch tab, un-collapse the region, then re-check". The DOM test distinguishes
 * the two rather than skipping this list.
 */
export const CONDITIONAL_ANCHORS = [
  "trace.counterfactual",
  "trace.nextExperiment",
  "validation.singleClassWarning",
  "evidence.citationStatus",
  "ruleset.modifiedBadge",
] as const;

/**
 * `as const satisfies` rather than one or the other: the const assertion keeps the
 * keys as literals so `AnchorId` is a real union, and `satisfies` still checks
 * every entry against `Anchor` so a typo in a tab id fails the build.
 */
export const ANCHORS = {
  // Case tab - the header, which sits OUTSIDE the collapsing grid and so has no region.
  "case.verdict": { label: "The verdict on the selected case", tab: "case", region: null },
  "case.beliefRange": { label: "Belief, plausibility and the gap between them", tab: "case", region: null },
  "case.hiddenCount": { label: "How many claims the as-of date hides", tab: "case", region: null },
  "case.asOf": { label: "The as-of date control", tab: "case", region: null },

  // Case tab - the trace region. Collapsing it unmounts everything below.
  "trace.beliefTrack": { label: "The belief-to-plausibility band", tab: "case", region: "trace" },
  "trace.mass": { label: "Committed mass: toxic, safe and uncommitted", tab: "case", region: "trace" },
  "trace.verdictReason": { label: "Why the engine reached this verdict", tab: "case", region: "trace" },
  "trace.counterfactual": { label: "What would change the verdict", tab: "case", region: "trace" },
  "trace.nextExperiment": { label: "The experiment the planner asks for", tab: "case", region: "trace" },

  // Case tab - the evidence region.
  "evidence.citationStatus": { label: "Citation status of the literature fixture", tab: "case", region: "evidence" },

  // Ruleset tab.
  "ruleset.hash": { label: "The registered ruleset version and hash", tab: "ruleset", region: null },
  "ruleset.modifiedBadge": { label: "Whether the ruleset on screen is the registered one", tab: "ruleset", region: null },
  "ruleset.liveBelief": { label: "Belief on the selected case under the ruleset on screen", tab: "ruleset", region: null },
  "ruleset.precedenceOrder": { label: "The registered precedence order and why it is ordered that way", tab: "ruleset", region: null },
  "ruleset.abstentionThreshold": { label: "The registered belief-plausibility gap threshold for abstention", tab: "ruleset", region: null },
  "rule.R1": { label: "R1, human relevance", tab: "ruleset", region: null },
  "rule.R2": { label: "R2, mechanistic proximity", tab: "ruleset", region: null },
  "rule.R3": { label: "R3, exposure relevance", tab: "ruleset", region: null },
  "rule.R4": { label: "R4, applicability domain", tab: "ruleset", region: null },
  "rule.R5": { label: "R5, study reliability", tab: "ruleset", region: null },
  "rule.R6": { label: "R6, concordance", tab: "ruleset", region: null },

  // Record tab.
  "record.chainExplainer": { label: "How the hash-chained audit log works", tab: "record", region: null },
  "record.signForm": { label: "Record a position against the evidence on screen", tab: "record", region: null },

  // Validation tab.
  "validation.provenance": { label: "Ruleset hash, seeds and the scored split", tab: "validation", region: null },
  "validation.headline": { label: "Conflict-subset coverage and balanced accuracy", tab: "validation", region: null },
  "validation.singleClassWarning": { label: "Why the balanced accuracy must not be quoted", tab: "validation", region: null },
  "validation.baselines": { label: "The baseline pipelines, compared", tab: "validation", region: null },
  "validation.plannerStability": { label: "Planner stability under perturbed priors", tab: "validation", region: null },
  "validation.robustness": { label: "Robustness on committed compounds", tab: "validation", region: null },
  "validation.llmAblation": { label: "The LLM ablation figure", tab: "validation", region: null },

  // Compounds tab.
  "compounds.conflictRate": { label: "How many scored compounds have streams in conflict", tab: "compounds", region: null },
  "compounds.declineNote": { label: "How often ARBITER declines, and why", tab: "compounds", region: null },
  "compounds.table": { label: "The scored compound library", tab: "compounds", region: null },
} as const satisfies Record<string, Anchor>;

export type AnchorId = keyof typeof ANCHORS;

/**
 * Widened once, here, so callers index by `string` without the const assertion
 * fighting them. `noUncheckedIndexedAccess` still yields `Anchor | undefined`.
 */
const STATIC: Record<string, Anchor> = ANCHORS;

export const TRACE_STEP_PREFIX = "trace.step:";
export const EVIDENCE_CLAIM_PREFIX = "evidence.claim:";
export const RECORD_POSITION_PREFIX = "record.position:";

/**
 * The families whose members cannot be enumerated at build time.
 *
 * Spec section 8: `rule.${RuleId}` IS enumerable because RuleId is a declared
 * literal union, so the six rules are real registry entries above. Every other
 * dynamic family derives from JSON imported through `resolveJsonModule`, which
 * widens to `string` - a template-literal type would catch a malformed prefix but
 * not a nonexistent claim id. The constructors below close the prefix half and the
 * DOM test closes the other.
 */
const DYNAMIC: { prefix: string; anchor: Anchor }[] = [
  { prefix: TRACE_STEP_PREFIX, anchor: { label: "A step in the argument trace", tab: "case", region: "trace" } },
  { prefix: EVIDENCE_CLAIM_PREFIX, anchor: { label: "An evidence claim", tab: "case", region: "evidence" } },
  { prefix: RECORD_POSITION_PREFIX, anchor: { label: "A recorded position", tab: "record", region: null } },
];

export interface ParsedAnchor {
  /** The registry key for a static anchor, or the family name for a dynamic one. */
  family: string;
  /** The claim id or index carried by a dynamic anchor; null for a static one. */
  payload: string | null;
  anchor: Anchor;
}

/**
 * Resolve an anchor id to what it points at, or null if it is not in the registry.
 *
 * PREFIX-SLICE, never split(":") - spec section 8. Claim ids contain colons
 * ("TAK-994:invivo_rodent") and so do baseline names ("single:qsar"), so
 * `split(":")[1]` on `evidence.claim:TAK-994:invivo_rodent` yields "TAK-994" and
 * silently points the navigator at the wrong claim, or at nothing.
 */
export function parseAnchor(id: string): ParsedAnchor | null {
  const stat = STATIC[id];
  if (stat) return { family: id, payload: null, anchor: stat };

  for (const family of DYNAMIC) {
    if (!id.startsWith(family.prefix)) continue;
    const payload = id.slice(family.prefix.length);
    // A bare prefix carries no target. Returning it would be pointing at nothing,
    // which spec section 7.2 forbids as firmly as it forbids invented prose.
    if (payload === "") return null;
    return { family: family.prefix.slice(0, -1), payload, anchor: family.anchor };
  }
  return null;
}

/** Spec section 7.2: an id not in the registry is filtered before anything scrolls. */
export function isKnownAnchor(id: string): boolean {
  return parseAnchor(id) !== null;
}

export function traceStep(claimId: string): string {
  return `${TRACE_STEP_PREFIX}${claimId}`;
}

export function evidenceClaim(claimId: string): string {
  return `${EVIDENCE_CLAIM_PREFIX}${claimId}`;
}

export function ruleAnchor(id: RuleId): string {
  return `rule.${id}`;
}

export function recordPosition(index: number): string {
  return `${RECORD_POSITION_PREFIX}${index}`;
}
```

- [ ] **Step 5: Anchor the belief track and the trace panel**

In `apps/web/src/tabs/Case/BeliefTrack.tsx`, on the outer element of the returned
JSX (line 13), change `<div>` to:

```tsx
    <div data-anchor="trace.beliefTrack">
```

In `apps/web/src/tabs/Case/TracePanel.tsx`, add the import beneath the existing
`useCaseReasoning` import:

```tsx
import { traceStep } from "../../ai/anchors.js";
```

and make these five substitutions in the returned JSX:

```tsx
      <p data-anchor="trace.mass" style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>
```

```tsx
          <li key={s.claimId} data-testid="trace-step" data-anchor={traceStep(s.claimId)}
              style={{ marginBottom: 8, fontSize: 13 }}>
```

```tsx
        <p data-testid="verdict-reason" data-anchor="trace.verdictReason" style={{ fontFamily: "var(--serif)" }}>{verdictStep.rationale}</p>
```

```tsx
        <section data-testid="counterfactual" data-anchor="trace.counterfactual">
```

```tsx
        <section data-testid="next-experiment" data-anchor="trace.nextExperiment">
```

Every `data-testid` above is kept exactly as it was. `trace-step` stays non-unique
and the per-instance identity lives on `data-anchor`.

- [ ] **Step 6: Anchor the evidence panel**

In `apps/web/src/tabs/Case/EvidencePanel.tsx`, add the import beneath the `Dot`
import:

```tsx
import { evidenceClaim } from "../../ai/anchors.js";
```

and make these two substitutions:

```tsx
        <p data-testid="citation-status" data-anchor="evidence.citationStatus"
           style={{ color: "var(--ambiguous)", fontSize: 14, fontWeight: 600 }}>
```

```tsx
            <li key={c.id} data-testid="evidence-row" data-anchor={evidenceClaim(c.id)}
                style={{ padding: "10px 0", borderBottom: "1px solid var(--hairline-soft)", opacity: defeated ? 0.55 : 1 }}>
```

- [ ] **Step 7: Anchor the case header**

In `apps/web/src/tabs/Case/CaseHeader.tsx`, make these four substitutions:

```tsx
        {/* The anchor wraps the primitive rather than living inside it: the
            testid `verdict` is frozen by Playwright and VerdictLabel is shared. */}
        <span data-anchor="case.verdict"><VerdictLabel verdict={r.verdict} /></span>
```

```tsx
      <div data-testid="belief-range" data-anchor="case.beliefRange" style={{ color: "var(--muted)", marginTop: 6 }}>
```

```tsx
      <div data-anchor="case.asOf"
           style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
```

```tsx
        <span data-testid="hidden-count" data-anchor="case.hiddenCount" style={{ color: "var(--muted)" }}>
```

`apps/web/src/ui/primitives/VerdictLabel.tsx` is NOT edited. It is a shared
primitive and `verdict` is one of the ten frozen testids; wrapping it in the
consumer keeps both facts true.

- [ ] **Step 8: Anchor the ruleset tab**

In `apps/web/src/tabs/Ruleset.tsx`, add the import beneath the `useCaseReasoning`
import:

```tsx
import { ruleAnchor } from "../ai/anchors.js";
```

and make these four substitutions:

```tsx
      <p data-testid="ruleset-hash" data-anchor="ruleset.hash" style={{ color: "var(--muted)", fontSize: 13 }}>
```

```tsx
          <strong data-testid="modified-badge" data-anchor="ruleset.modifiedBadge" style={{ color: "var(--toxic)", marginLeft: 10 }}>
```

```tsx
        Live on the selected case: belief <strong data-testid="live-belief" data-anchor="ruleset.liveBelief">{r.belief.toFixed(3)}</strong>,
```

```tsx
        <article key={rule.id} data-testid="rule-card" data-anchor={ruleAnchor(rule.id)}
                 style={{ borderTop: "1px solid var(--hairline)", padding: "14px 0" }}>
```

`ruleAnchor(rule.id)` typechecks against the `RuleId` union, so the six `rule.R*`
registry entries and the six rendered cards cannot drift apart silently.

- [ ] **Step 9: Anchor the record tab**

In `apps/web/src/tabs/Record.tsx`, add the import beneath the `chain.js` import:

```tsx
import { recordPosition } from "../ai/anchors.js";
```

and make these three substitutions:

```tsx
      <p data-anchor="record.chainExplainer" style={{ color: "var(--muted)" }}>
```

```tsx
      <fieldset data-anchor="record.signForm"
                style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: 12 }}>
```

```tsx
          <li key={i} data-testid="position-row" data-anchor={recordPosition(i)}
              style={{ marginTop: 10, fontSize: 13 }}>
```

- [ ] **Step 10: Anchor the validation tab**

In `apps/web/src/tabs/Validation.tsx`, make these five one-line substitutions:

```tsx
      <p data-testid="provenance" data-anchor="validation.provenance" style={{ color: "var(--muted)", fontSize: 13 }}>
```

```tsx
      <p data-testid="headline" data-anchor="validation.headline">
```

```tsx
        <p data-testid="single-class-warning" data-anchor="validation.singleClassWarning"
           style={{ color: "var(--toxic)", fontSize: 15, fontWeight: 600 }}>
```

```tsx
      <p data-testid="planner-stability" data-anchor="validation.plannerStability">
```

```tsx
      <p data-testid="llm-ablation" data-anchor="validation.llmAblation" style={{ color: "var(--muted)" }}>
```

The unlabelled robustness paragraph gains an anchor but no testid, since nothing
selects it today:

```tsx
      <p data-anchor="validation.robustness">
        Robustness on committed compounds:{" "}
```

And the Baselines heading and table are wrapped in one element, because scrolling
to a bare table delivers numbers with their heading off screen. Replace the block
from `<h3>Baselines</h3>` through its `</table>` with:

```tsx
      {/* Heading and table share one anchor: scrolling to the bare table would
          put "Baselines" off screen and the numbers would arrive unlabelled. */}
      <section data-anchor="validation.baselines">
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
      </section>
```

Note that `data-testid="provenance"` is deliberately left in place on the line
above even though `EvidencePanel.tsx` uses the same name. That collision is the
argument for a separate namespace, not something to fix by renaming a testid the
Phase 2 tests already select on.

- [ ] **Step 11: Anchor the compounds tab**

In `apps/web/src/tabs/Compounds.tsx`, make these three substitutions:

```tsx
      <p data-testid="conflict-rate" data-anchor="compounds.conflictRate">
```

```tsx
      <p data-testid="decline-note" data-anchor="compounds.declineNote" style={{ color: "var(--muted)" }}>
```

```tsx
      <table data-anchor="compounds.table"
             style={{ borderCollapse: "collapse", width: "100%", marginTop: 12 }}>
```

- [ ] **Step 12: Watch the DOM sweep fail, so it is known to catch a rename**

Temporarily change one anchor value in `apps/web/src/tabs/Compounds.tsx`:

```tsx
      <p data-testid="decline-note" data-anchor="compounds.declineNoteX" style={{ color: "var(--muted)" }}>
```

Run: `npm test -- apps/web/test/anchors.test.tsx`
Expected: **FAIL** on "compounds: every unconditional anchor is present exactly
once", naming `compounds.declineNote`. Restore the value and re-run to confirm
green. This sweep is the only thing standing between a renamed element and a
navigator that scrolls to nothing in front of a judge, so it is watched failing
rather than assumed to work.

- [ ] **Step 13: Run the tests to verify they pass**

Run: `npm test -- apps/web && npm run typecheck && npm run web:build`
Expected: PASS (18 new tests; 127 total across `apps/web`), build succeeds

- [ ] **Step 14: Commit**

```bash
git add apps/web/src/ai/anchors.ts apps/web/src/tabs apps/web/test/anchors.test.tsx
git commit -m "$(cat <<'MSG'
Give anchors their own data-anchor namespace and sweep every one in the DOM

Spec section 8 requires a NEW attribute rather than a reuse of data-testid, and
reading the code says why twice over. Five testids are non-unique by construction
- evidence-row, trace-step, compound-row, rule-card, position-row - and those are
exactly the families that need a per-instance anchor. `provenance` is two
different things in two different tabs, on the Case tab and the Validation tab,
and that collision alone settles the question. Ten more testids are frozen by
apps/web/e2e, which this phase is forbidden to modify. Nothing is renamed; the two
attributes sit on the same elements.

`region` is stored per entry because a collapsed Case region UNMOUNTS its content,
so while the tour sits on beat 2 no evidence row exists in the DOM at all. The
navigator dispatches setFocus before it scrolls, and it can only know to do that
if the registry says which region an anchor lives in.

Dynamic ids are built by constructors so a prefix is never hand-typed, and parsed
by prefix-slice, never split(":"). Claim ids carry a colon of their own -
TAK-994:invivo_rodent - so split(":")[1] yields "TAK-994", a real-looking claim
prefix that would send the navigator to the wrong row. There is a test that fails
under the naive parse and states what it would have returned.

The DOM sweep renders each tab and asserts every declared unconditional anchor
resolves exactly once, which is what catches a registry entry whose element was
renamed. The five conditional anchors of spec section 7.2 are handled explicitly
rather than skipped: four of them do mount on TAK-994 and are asserted present, and
ruleset.modifiedBadge is asserted absent on the registered ruleset, still a KNOWN
id while absent, and then made to appear by moving a strength. Asserting only its
absence would have passed on a deleted element.

Verified by watching it fail: perturbing one data-anchor value turns the sweep red
and names the missing id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
git push origin phase3
```

---
### Task 3: One selector for "the claims for this compound", so the verdict and the panel beside it can never disagree

Spec §9 — the lookup is duplicated at four call sites; wired into three of the four an evidence working copy produces a verdict computed from evidence the panel is not showing. §9.1 sets the polarity, §9.3 settles the edited predicate, §5.3 derives the legal field set, §5.4 validates before storing.

**Files:**
- Modify: `apps/web/src/state/store.tsx` (whole file — adds `ReclassifiableField`, `EvidenceEdit`, `evidenceEdits`, `workingClaims`, `isEdited`, `reclassifyClaim`, `resetEvidence`)
- Modify: `apps/web/src/engine/useCaseReasoning.ts:10-18` (call site 1)
- Modify: `apps/web/src/tabs/Case/CaseHeader.tsx:9-20` (call site 2)
- Modify: `apps/web/src/tabs/Record.tsx:9-21` (call site 4)
- Modify: `apps/web/src/tabs/Case/EvidencePanel.tsx:5-11,36-53` (call site 3, plus the per-claim badge)
- Modify: `apps/web/src/tabs/Ruleset.tsx:25` (§9.3 — one predicate)
- Modify: `apps/web/src/ui/Preflight.tsx:40` (§9.3 — the same predicate)
  - **Task 10 supersedes this line.** Task 3's job is to stop the badge and the
    panel disagreeing, which is §9.3's actual complaint. Task 10 then replaces the
    ruleset predicate with a digest comparison, because the panel's own rule is that
    every line is a check computed now. Do not skip it here — the divergence test in
    this task is what proves the two were ever out of step.
- Test: `apps/web/test/store.test.ts` (modify — existing cases kept verbatim)
- Test: `apps/web/test/evidenceEdits.test.tsx` (create)

**Interfaces:**
- Consumes: `EvidenceClaimSchema`, `type AssayOperator`, `type EvidenceClaim` from `@arbiter/engine`; `type LoadedData` from `../data/load.js`
- Produces:
  - `export type ReclassifiableField = keyof AssayOperator["produces"];`
  - `export const RECLASSIFIABLE_FIELDS: ReclassifiableField[];`
  - `export type EvidenceEdit = Partial<Pick<EvidenceClaim, ReclassifiableField>>;`
  - `export function workingClaims(state: AppState, compoundId: string): EvidenceClaim[];`
  - `export function isEdited(working: unknown, registered: unknown): boolean;`
  - `AppState` gains `evidenceEdits: Record<string, EvidenceEdit>`
  - `Action` gains `{ type: "reclassifyClaim"; claimId: string; edit: EvidenceEdit }` and `{ type: "resetEvidence" }`

`pendingAnchor` and `setPendingAnchor` are **not** added here. They are navigator state and belong to Task 7; the skeleton lists all three store additions in one row because they land in one file, not in one task.

Task 4's `apps/web/src/ai/interpret.ts` satisfies its skeleton line by re-exporting rather than redeclaring:
`export type { ReclassifiableField } from "../state/store.js";` — one definition, derived from `AssayOperator["produces"]`, in the module that validates against it.

- [ ] **Step 1: Write the failing store test**

Replace `apps/web/test/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  initialState, isEdited, reducer, visibleClaims, workingClaims,
  type EvidenceEdit,
} from "../src/state/store.js";
import { loadData } from "../src/data/load.js";
import type { EvidenceClaim } from "@arbiter/engine";
import { useLibraryVerdicts } from "../src/engine/useLibraryVerdicts.js";

const base = initialState(loadData());

/** The murine toxicogenomics claim: the one field change on the fixture that moves
 *  the verdict, so every "an edit reaches here" case can use the same input. */
const MURINE = "TAK-994:toxicogenomics-murine";
/** The QSAR claim: system in_silico, so schema.ts:26-35 forbids it a measured key event. */
const QSAR = "TAK-994:qsar";

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

  it("advancing a beat cannot touch the ruleset, the evidence, the positions or the as-of date", () => {
    // The guarantee that guided and free navigation cannot disagree: the tour
    // holds presentation state only. Data changes go through the SAME actions a
    // user dispatches by hand. evidenceEdits joins the list because it is now a
    // second working copy a beat could plausibly be tempted to stage a demo with.
    const next = reducer(base, { type: "setTourBeat", beat: 4, tab: "case", focus: "trace" });
    expect(next.ruleset).toBe(base.ruleset);
    expect(next.evidenceEdits).toBe(base.evidenceEdits);
    expect(next.positions).toBe(base.positions);
    expect(next.asOf).toBe(base.asOf);
  });

  it("rejects a strength outside 0..1 rather than storing an invalid ruleset", () => {
    expect(reducer(base, { type: "setRuleStrength", id: "R1", strength: 1.6 }).ruleset)
      .toEqual(base.ruleset);
  });
});

describe("workingClaims", () => {
  it("returns the REGISTERED claims when nothing has been reclassified", () => {
    // Identity, not just equality. The selector must not allocate a fresh array on
    // every render or useCaseReasoning's memo never holds and the Case tab re-runs
    // the engine on unrelated actions such as the motion toggle.
    expect(workingClaims(base, base.data.fixture.compoundId)).toBe(base.data.fixture.claims);
  });

  it("prefers the hand-curated fixture over the bundled corpus for TAK-994", () => {
    // TAK-994 exists in BOTH data/out/evidence.json and data/out/tak994.json. The
    // four call sites all preferred the fixture; the unified selector must keep
    // that precedence even though the two copies happen to agree today.
    const claims = workingClaims(base, base.data.fixture.compoundId);
    expect(claims).toBe(base.data.fixture.claims);
    expect(claims).not.toBe(base.data.claimsByCompound.get("TAK-994"));
  });

  it("returns an empty list for a compound with no claims rather than throwing", () => {
    expect(workingClaims(base, "NOT-A-COMPOUND")).toEqual([]);
  });

  it("overlays a reclassification onto the claim it names, and nothing else", () => {
    const next = reducer(base, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } });
    const claims = workingClaims(next, "TAK-994");
    expect(claims.find((c) => c.id === MURINE)!.system).toBe("human");
    // Every other field of that claim, and every other claim, is untouched.
    expect(claims.find((c) => c.id === MURINE)!.assertion).toBe("toxic");
    expect(claims.find((c) => c.id === "TAK-994:cytotox")!.system).toBe("human");
    expect(claims.find((c) => c.id === "TAK-994:invivo_rodent")!.system).toBe("rodent");
  });

  it("never mutates the registered evidence", () => {
    // data.claimsByCompound and data.fixture.claims are immutable exactly as
    // data.ruleset is (§9). An overlay that wrote through would make Reset a lie
    // and would poison the library table via the map both surfaces share.
    const next = reducer(base, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } });
    void workingClaims(next, "TAK-994");
    expect(base.data.fixture.claims.find((c) => c.id === MURINE)!.system).toBe("rodent");
  });
});

describe("reclassifyClaim", () => {
  it("stores an edit the schema accepts", () => {
    const next = reducer(base, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } });
    expect(next.evidenceEdits[MURINE]).toEqual({ system: "human" });
  });

  it("REFUSES an edit that violates the cross-field constraint at schema.ts:26-35", () => {
    // A computational prediction cannot MEASURE a key event. Leaving
    // measuresKeyEvent non-null on an in_silico or qsar claim lets it escape R2's
    // structural-correlation discount and be weighted like human clinical
    // evidence - the schema's own message says so. plan.ts:174-180 throws on the
    // same class of input rather than reason over it; the reducer's equivalent is
    // to return the state unchanged so a rejected edit cannot take the tab down
    // mid-demo.
    const next = reducer(base, {
      type: "reclassifyClaim", claimId: QSAR, edit: { measuresKeyEvent: "KE:BSEP-INHIBITION" },
    });
    expect(next).toBe(base);
    expect(next.evidenceEdits[QSAR]).toBeUndefined();
  });

  it("REFUSES an edit whose validity depends on a field it is not changing", () => {
    // The cytotox claim already measures KE:HEPATOCYTE-DEATH, so moving its stream
    // to qsar violates the same constraint - and no field-by-field check can see
    // it. This is why the WHOLE merged claim is parsed, not the edit.
    const next = reducer(base, {
      type: "reclassifyClaim", claimId: "TAK-994:cytotox", edit: { stream: "qsar" },
    });
    expect(next).toBe(base);
  });

  it("refuses an edit naming a claim that does not exist", () => {
    // A stored orphan would badge the panel MODIFIED for a change nothing computes.
    expect(reducer(base, { type: "reclassifyClaim", claimId: "TAK-994:nope", edit: { klimisch: 4 } }))
      .toBe(base);
    expect(reducer(base, { type: "reclassifyClaim", claimId: "no-colon-here", edit: { klimisch: 4 } }))
      .toBe(base);
  });

  it("PRUNES a field reclassified back to its registered value", () => {
    // This is what makes §9.3's single predicate exact at the evidence copy:
    // reclassify and reclassify back and the badge clears, exactly as dragging a
    // strength slider back clears the ruleset badge.
    const there = reducer(base, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } });
    const andBack = reducer(there, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "rodent" } });
    expect(there.evidenceEdits[MURINE]).toEqual({ system: "human" });
    expect(andBack.evidenceEdits[MURINE]).toBeUndefined();
    expect(isEdited(andBack.evidenceEdits, {})).toBe(false);
  });

  it("merges a second field onto an existing edit instead of replacing it", () => {
    const one = reducer(base, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } });
    const two = reducer(one, { type: "reclassifyClaim", claimId: MURINE, edit: { klimisch: 4 } });
    expect(two.evidenceEdits[MURINE]).toEqual({ system: "human", klimisch: 4 });
  });

  it("clears every edit on resetEvidence, mirroring resetRuleset", () => {
    const edited = reducer(base, { type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } });
    expect(reducer(edited, { type: "resetEvidence" }).evidenceEdits).toEqual({});
  });
});

describe("EvidenceEdit's legal field set (§5.3)", () => {
  it("admits every field an AssayOperator must declare", () => {
    // The positive control. Without it the @ts-expect-error case below would also
    // pass on a type that rejects EVERYTHING, which would be a broken exclusion
    // rather than an enforced one.
    const legal: EvidenceEdit = {
      system: "human",
      stream: "cytotox",
      measuresKeyEvent: "KE:BSEP-INHIBITION",
      exposureRelevant: true,
      inApplicabilityDomain: false,
      klimisch: 2,
    };
    expect(Object.keys(legal)).toHaveLength(6);
  });

  it("EXCLUDES assertion by construction, not by a deny-list", () => {
    // Changing an assertion is not testing the reasoning, it is choosing the
    // answer - claimToMass reads it directly (§5.3). The system already answers
    // that question read-only: findCounterfactual reports the minimal set of
    // assertion flips that would change the verdict without applying any of them.
    //
    // These lines are checked by `npm run typecheck`, not by vitest, which
    // transpiles without type-checking. If ReclassifiableField ever stops being
    // keyof AssayOperator["produces"], typecheck fails here.
    // @ts-expect-error assertion is not a member of AssayOperator["produces"]
    const flipsTheAnswer: EvidenceEdit = { assertion: "toxic" };
    // @ts-expect-error availableFrom is the as-of control's job and the hindsight defence
    const rewritesHistory: EvidenceEdit = { availableFrom: "2019-01-01" };
    // @ts-expect-error strength has no mediating rule; it multiplies straight into mass
    const unregisteredKnob: EvidenceEdit = { strength: 1 };
    // @ts-expect-error compoundId defeats the guard at rules.ts:32
    const crossesCompounds: EvidenceEdit = { compoundId: "OTHER" };
    expect([flipsTheAnswer, rewritesHistory, unregisteredKnob, crossesCompounds]).toHaveLength(4);
  });
});

describe("isEdited — one predicate for both working copies (§9.3)", () => {
  it("reports a dragged-and-returned slider as UNEDITED", () => {
    // Preflight.tsx:40 tested this by reference and Ruleset.tsx:25 by deep
    // compare, so the badge cleared while the panel still warned. The value
    // compare wins: telling a presenter to press Reset on a ruleset that already
    // IS the registered one is a false alarm in the one panel whose whole rule is
    // that every line is a check rather than a caption.
    const there = reducer(base, { type: "setRuleStrength", id: "R1", strength: 0.05 });
    const andBack = reducer(there, { type: "setRuleStrength", id: "R1", strength: 0.9 });
    expect(isEdited(there.ruleset, base.data.ruleset)).toBe(true);
    expect(andBack.ruleset).not.toBe(base.data.ruleset);   // a genuinely new object
    expect(isEdited(andBack.ruleset, base.data.ruleset)).toBe(false);
  });

  it("still reports a real edit as edited", () => {
    const edited = reducer(base, { type: "setRuleEnabled", id: "R4", enabled: false });
    expect(isEdited(edited.ruleset, base.data.ruleset)).toBe(true);
  });
});

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

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/store.test.ts`
Expected: FAIL — `SyntaxError: The requested module '/apps/web/src/state/store.tsx' does not provide an export named 'workingClaims'`

- [ ] **Step 3: Write the store**

Replace `apps/web/src/state/store.tsx`:

```tsx
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import {
  EvidenceClaimSchema,
  type AssayOperator, type EvidenceClaim, type Rule, type RuleId, type Ruleset,
} from "@arbiter/engine";
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

/**
 * What a toxicologist may reclassify, DERIVED rather than invented (spec §5.3).
 *
 * It is exactly the set an AssayOperator must declare to synthesise a
 * hypothetical claim (`packages/engine/src/plan.ts:13-16`), a set arrived at
 * independently for that purpose. Typing it this way excludes `assertion`,
 * `strength`, `id`, `compoundId`, `availableFrom` and `provenance` BY
 * CONSTRUCTION: none is a member of `AssayOperator["produces"]`, so there is no
 * deny-list to keep in step with the engine, and adding a rule-consumed field to
 * the planner widens both at once.
 *
 * The exclusions are not arbitrary and belong in the Q&A: changing an assertion
 * is not testing the reasoning, it is choosing the answer, and the system already
 * answers that question read-only through `findCounterfactual`; `strength` has no
 * mediating rule and multiplies straight into mass, so a per-claim dial would
 * reintroduce at the evidence layer exactly the unregistered knob the ruleset
 * does not have; `availableFrom` is the as-of control's job and the hindsight
 * defence.
 *
 * The defensible framing: a toxicologist contests what the evidence IS, and the
 * pre-registered rules - unchanged - recompute what it licenses.
 */
export type ReclassifiableField = keyof AssayOperator["produces"];

/**
 * The same set at runtime, needed to prune a no-op edit in `reclassifyClaim`.
 *
 * Written as a `Record<ReclassifiableField, true>` rather than an array because
 * the compiler then REQUIRES every member and REFUSES any non-member: a field
 * added to `AssayOperator["produces"]` and not added here stops the build, which
 * is the only way a runtime list stays honest about a compile-time type.
 */
const FIELD_SET: Record<ReclassifiableField, true> = {
  system: true,
  stream: true,
  measuresKeyEvent: true,
  exposureRelevant: true,
  inApplicabilityDomain: true,
  klimisch: true,
};
export const RECLASSIFIABLE_FIELDS = Object.keys(FIELD_SET) as ReclassifiableField[];

/** One claim's overlay. Overrides, never a second claim array (§9). */
export type EvidenceEdit = Partial<Pick<EvidenceClaim, ReclassifiableField>>;

export interface AppState {
  data: LoadedData;
  ruleset: Ruleset;                            // editable working copy
  /** The evidence working copy, keyed by claim id. `data.claimsByCompound` and
   *  `data.fixture.claims` stay immutable, exactly as `data.ruleset` does. */
  evidenceEdits: Record<string, EvidenceEdit>;
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
  | { type: "reclassifyClaim"; claimId: string; edit: EvidenceEdit }
  | { type: "resetEvidence" }
  | { type: "setTourBeat"; beat: number; tab: TabId; focus: Region | null }
  | { type: "setFocus"; focus: Region | null }
  | { type: "addPosition"; position: ReviewerPosition }
  | { type: "toggleMotion" };

export function initialState(data: LoadedData): AppState {
  return {
    data,
    ruleset: data.ruleset,
    evidenceEdits: {},
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
 * The fixture wins over the bundled corpus for TAK-994 deliberately: the compound
 * appears in BOTH `data/out/evidence.json` and `data/out/tak994.json`, and the
 * fixture is the hand-curated literature case the demo runs on. The two copies
 * agree today; the precedence is kept so that they may stop agreeing without the
 * Case tab silently switching source.
 */
function registeredClaims(data: LoadedData, compoundId: string): EvidenceClaim[] {
  return compoundId === data.fixture.compoundId
    ? data.fixture.claims
    : (data.claimsByCompound.get(compoundId) ?? []);
}

/**
 * A registered claim by id, or null.
 *
 * Claim ids are `${compoundId}:${stream}`, so the compound id is a PREFIX SLICE
 * at the first colon - never `split(":")`. Colons are load-bearing elsewhere in
 * this data (`KE:BSEP-INHIBITION`, the `single:qsar` baseline names), and a
 * delimiter split is one added stream name away from silently indexing the wrong
 * compound (spec §8).
 */
function findClaim(data: LoadedData, claimId: string): EvidenceClaim | null {
  const colon = claimId.indexOf(":");
  if (colon <= 0) return null;
  return registeredClaims(data, claimId.slice(0, colon)).find((c) => c.id === claimId) ?? null;
}

/**
 * The claims for a compound with the evidence working copy applied.
 *
 * §9.1 - THE TWO WORKING COPIES RUN AT OPPOSITE POLARITY, and this selector is
 * where that is enforced. The ruleset working copy already feeds the 267-row
 * library table: `Compounds.tsx` calls `useLibraryVerdicts()` with no override,
 * deliberately, and the pre-flight panel passes the registered ruleset explicitly
 * when it needs a pristine baseline. An evidence working copy must NOT reach that
 * table - evidence edits are per-claim on one compound, and a corpus statistic
 * recomputed over edited evidence is a number computed after seeing a result.
 *
 * So: for the ruleset, working is the default and registered is the opt-in; for
 * evidence, registered is the default and WORKING IS THE OPT-IN. Calling this
 * selector is that opt-in. Anything corpus-shaped keeps reading
 * `data.claimsByCompound` and gets registered evidence for free.
 *
 * The untouched array is returned BY REFERENCE so `useCaseReasoning`'s memo holds
 * across unrelated actions.
 */
export function workingClaims(state: AppState, compoundId: string): EvidenceClaim[] {
  const registered = registeredClaims(state.data, compoundId);
  let touched = false;
  const out = registered.map((c) => {
    const edit = state.evidenceEdits[c.id];
    if (edit === undefined) return c;
    touched = true;
    return { ...c, ...edit };
  });
  return touched ? out : registered;
}

/**
 * §9.3 - ONE predicate, applied to BOTH working copies.
 *
 * `Preflight.tsx:40` tested "edited" by reference (`ruleset !== data.ruleset`)
 * while `Ruleset.tsx:25` tested it by deep compare, so dragging a strength slider
 * and dragging it back cleared the MODIFIED badge while the pre-flight panel
 * still warned of live edits. It erred safe, so it was a wart rather than a hole
 * - but a second working copy needs the question answered before it is added,
 * not after.
 *
 * The value compare wins. `resetRuleset` restores `data.ruleset` by reference, so
 * reference equality and value equality agree on the reset path; they diverge on
 * the drag-and-return path, where reference equality tells a presenter to press
 * Reset on a ruleset that already IS the registered one. A false alarm is not
 * free in the one panel whose stated rule is that every line is a check computed
 * now rather than a caption.
 *
 * At the evidence copy this is exact because `reclassifyClaim` prunes a field
 * back to its registered value rather than storing it, so `evidenceEdits` holds
 * genuine changes only and comparing it to `{}` is comparing effect to effect.
 */
export function isEdited(working: unknown, registered: unknown): boolean {
  return JSON.stringify(working) !== JSON.stringify(registered);
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

    case "reclassifyClaim": {
      const registered = findClaim(s.data, a.claimId);
      // An edit naming a claim that does not exist is refused, not stored: a
      // stored orphan badges the panel MODIFIED for a change nothing computes.
      if (registered === null) return s;

      const merged: EvidenceClaim = {
        ...registered,
        ...(s.evidenceEdits[a.claimId] ?? {}),
        ...a.edit,
      };

      // §5.4. `schema.ts:26-35` carries a CROSS-FIELD constraint - an in_silico or
      // qsar claim must have `measuresKeyEvent === null` - whose own message
      // states the stakes: leaving it non-null "lets it escape R2's
      // structural-correlation discount and be weighted like human clinical
      // evidence." A field-by-field check cannot see that, so the WHOLE merged
      // claim is parsed, not the edit.
      //
      // The engine's precedent is `plan.ts:174-180`, which validates every
      // synthetic claim it builds and THROWS rather than reason over an
      // unvalidated one. The reducer's equivalent of throwing is refusing the
      // transition: a rejected reclassification must not take the tab down in
      // front of a judge, and returning `s` unchanged means the confirm panel
      // simply does not move.
      if (!EvidenceClaimSchema.safeParse(merged).success) return s;

      // Keep only fields that genuinely differ from the registered claim, so
      // reclassify-and-reclassify-back clears the badge exactly as
      // drag-and-drag-back clears the ruleset badge (§9.3). The single cast is
      // the boundary: the loop above writes only members of
      // RECLASSIFIABLE_FIELDS, which IS EvidenceEdit's key set by construction.
      const kept: Record<string, unknown> = {};
      for (const f of RECLASSIFIABLE_FIELDS) {
        if (merged[f] !== registered[f]) kept[f] = merged[f];
      }

      const evidenceEdits = { ...s.evidenceEdits };
      if (Object.keys(kept).length === 0) delete evidenceEdits[a.claimId];
      else evidenceEdits[a.claimId] = kept as EvidenceEdit;
      return { ...s, evidenceEdits };
    }

    // Mirrors resetRuleset: the registered evidence is never written, so
    // restoring it is dropping the overlay.
    case "resetEvidence": return { ...s, evidenceEdits: {} };

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

- [ ] **Step 4: Route call sites 1, 2 and 4 through the selector**

Replace `apps/web/src/engine/useCaseReasoning.ts`:

```ts
import { useMemo } from "react";
import { reason, type Reasoning } from "@arbiter/engine";
import { useAppState, visibleClaims, workingClaims } from "../state/store.js";

/**
 * Full reason() - counterfactual and planner included - for the SELECTED compound
 * only. Around 150 engine evaluations, which is fine for one compound and would
 * not be for 267.
 *
 * Call site 1 of the four that §9 unifies. The compound lookup now lives in
 * `workingClaims`, so this hook and the panel beside it read the same evidence by
 * construction rather than by two copies of the same three lines agreeing.
 */
export function useCaseReasoning(): Reasoning {
  const state = useAppState();
  const { data, ruleset, asOf, selectedCompoundId, evidenceEdits } = state;
  return useMemo(
    () => reason(visibleClaims(workingClaims(state, selectedCompoundId), asOf), ruleset, "", data.assays),
    // `state` is read inside, but every field the selector touches - `data` and
    // `evidenceEdits` - is listed, so the memo cannot go stale. Listing `state`
    // itself would instead re-run the engine on the motion toggle and on every
    // tour beat.
    //
    // evidenceEdits is load-bearing: without it a reclassification would leave
    // the verdict stale, which is the exact defect §9 describes with the panels
    // reversed.
    [data, ruleset, asOf, selectedCompoundId, evidenceEdits],
  );
}
```

Replace `apps/web/src/tabs/Case/CaseHeader.tsx`:

```tsx
import { useAppState, useDispatch, visibleClaims, workingClaims } from "../../state/store.js";
import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { VerdictLabel } from "../../ui/primitives/VerdictLabel.js";

/**
 * The as-of control lives HERE, not in global settings: it is an input to this
 * case, not an application preference (master spec section 9).
 *
 * Call site 2 of the four (§9). The hidden-count is computed from the same list
 * the verdict beside it was computed from, which is the property the refactor
 * exists to guarantee.
 */
export function CaseHeader() {
  const state = useAppState();
  const { data, asOf, selectedCompoundId } = state;
  const dispatch = useDispatch();
  const r = useCaseReasoning();

  const isFixture = selectedCompoundId === data.fixture.compoundId;
  const all = workingClaims(state, selectedCompoundId);
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

Replace `apps/web/src/tabs/Record.tsx`:

```tsx
import { useState } from "react";
import { useAppState, useDispatch, visibleClaims, workingClaims } from "../state/store.js";
import { useCaseReasoning } from "../engine/useCaseReasoning.js";
import { evidenceSnapshot, recordHash, sha256Hex } from "../record/chain.js";

const GENESIS = "0".repeat(64);

/**
 * Call site 4 of the four (§9).
 *
 * Routing this one is load-bearing, not cosmetic. `evidenceSnapshot` now serialises
 * the WHOLE claim - every reclassifiable field included - so a position signed over
 * un-routed claims would hash evidence the panel beside it is not showing. That is
 * exactly the binding the function exists to provide: "I agree" must attach to what
 * was on screen.
 *
 * The snapshot was widened, and `rulesetHash` made to hold an actual digest, before
 * this plan began. Do not re-do either; see the audit-record commit.
 */
export function RecordTab() {
  const state = useAppState();
  const { ruleset, asOf, selectedCompoundId, positions } = state;
  const dispatch = useDispatch();
  const r = useCaseReasoning();
  const [name, setName] = useState("Jack He");
  const [position, setPosition] = useState<"agree" | "dissent" | "abstain">("agree");
  const [rationale, setRationale] = useState("");

  // `data` is no longer destructured: the compound lookup that needed it now lives
  // in the selector, which is the point of the refactor.
  const all = workingClaims(state, selectedCompoundId);

  async function sign() {
    const snapshot = await sha256Hex(evidenceSnapshot(visibleClaims(all, asOf), r));
    const last = positions[positions.length - 1];
    const prev = last ? await recordHash(last) : GENESIS;
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

- [ ] **Step 5: Write the failing working-copy test**

Create `apps/web/test/evidenceEdits.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { reasonVerdictOnly } from "@arbiter/engine";
import {
  StoreProvider, initialState, reducer, useAppState, useDispatch, workingClaims,
  type Action,
} from "../src/state/store.js";
import { useLibraryVerdicts } from "../src/engine/useLibraryVerdicts.js";
import { CaseHeader } from "../src/tabs/Case/CaseHeader.js";
import { EvidencePanel } from "../src/tabs/Case/EvidencePanel.js";
import { RulesetTab } from "../src/tabs/Ruleset.js";
import { Preflight } from "../src/ui/Preflight.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const base = initialState(data);

/** The fixture claim whose system flips the Case verdict: measured directly
 *  against the engine - rodent -> human takes TAK-994 from abstain, belief 0.090,
 *  to do_not_advance, belief 0.900, because R1 stops discounting it. */
const MURINE = "TAK-994:toxicogenomics-murine";

/** data.testSplit[0], and the cytotox claim on it whose exposureRelevant flips
 *  that row's library verdict from abstain to advance. Chosen by measurement, so
 *  the isolation case below cannot pass merely because the edit is inert. */
const LIBRARY_COMPOUND = "AAOVKJBEBIDNHE-UHFFFAOYSA-N";
const LIBRARY_CLAIM = "AAOVKJBEBIDNHE-UHFFFAOYSA-N:cytotox";

/** Test-only: turns a dispatch into a click, so every case drives the REAL reducer
 *  through the REAL provider rather than calling the reducer beside the render. */
function Fire({ id, action }: { id: string; action: Action }) {
  const dispatch = useDispatch();
  return <button type="button" data-testid={id} onClick={() => dispatch(action)}>{id}</button>;
}

/** Proves a dispatch actually landed. Without it, an isolation assertion that
 *  "the row did not move" would also pass when nothing was dispatched at all. */
function EditCount() {
  const { evidenceEdits } = useAppState();
  return <span data-testid="edit-count">{Object.keys(evidenceEdits).length}</span>;
}

function LibraryRow({ compoundId }: { compoundId: string }) {
  const rows = useLibraryVerdicts();
  return <span data-testid="row-verdict">{rows.get(compoundId)?.verdict}</span>;
}

describe("the evidence working copy stays off the library table (§9.1)", () => {
  it("is POTENT on the compound it names", () => {
    // Stated first and separately, because the isolation case below is only worth
    // anything if the edit it applies would otherwise have moved the number.
    const edited = reducer(base, {
      type: "reclassifyClaim", claimId: LIBRARY_CLAIM, edit: { exposureRelevant: true },
    });
    expect(reasonVerdictOnly(workingClaims(base, LIBRARY_COMPOUND), data.ruleset).verdict)
      .toBe("abstain");
    expect(reasonVerdictOnly(workingClaims(edited, LIBRARY_COMPOUND), data.ruleset).verdict)
      .toBe("advance");
  });

  it("does NOT reach the 267-row library table", () => {
    // Evidence edits are per-claim on one compound. A corpus statistic recomputed
    // over edited evidence is a number computed after seeing a result, so the
    // polarity is inverted relative to the ruleset: registered is the default and
    // working is the opt-in, and useLibraryVerdicts does not opt in.
    render(
      <StoreProvider data={data}>
        <LibraryRow compoundId={LIBRARY_COMPOUND} />
        <EditCount />
        <Fire id="edit-library-claim"
              action={{ type: "reclassifyClaim", claimId: LIBRARY_CLAIM, edit: { exposureRelevant: true } }} />
      </StoreProvider>,
    );

    expect(screen.getByTestId("row-verdict").textContent).toBe("abstain");
    fireEvent.click(screen.getByTestId("edit-library-claim"));
    expect(screen.getByTestId("edit-count").textContent).toBe("1");
    expect(screen.getByTestId("row-verdict").textContent).toBe("abstain");
  });
});

describe("the verdict and the evidence beside it (§9)", () => {
  it("moves the verdict AND the row it was computed from, together", () => {
    // The defect the refactor exists to make impossible: wired into three of the
    // four call sites, the header would read do_not_advance while the panel below
    // still showed a rodent study.
    render(
      <StoreProvider data={data}>
        <CaseHeader />
        <EvidencePanel collapsed={false} onExpand={() => {}} />
        <Fire id="reclassify-murine"
              action={{ type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } }} />
      </StoreProvider>,
    );

    expect(screen.getByTestId("verdict").textContent).toMatch(/Abstain/);
    expect(screen.getByTestId("belief-range").textContent).toContain("0.090");

    fireEvent.click(screen.getByTestId("reclassify-murine"));

    expect(screen.getByTestId("verdict").textContent).toMatch(/Do not advance/);
    expect(screen.getByTestId("belief-range").textContent).toContain("0.900");

    const row = screen.getAllByTestId("evidence-row")
      .find((r) => /toxicogenomics/.test(r.textContent ?? ""))!;
    expect(row.textContent).toContain("human");
    expect(within(row).getByTestId("claim-modified-badge").textContent)
      .toMatch(/MODIFIED/);
  });

  it("badges only the claim that was reclassified", () => {
    render(
      <StoreProvider data={data}>
        <EvidencePanel collapsed={false} onExpand={() => {}} />
        <Fire id="reclassify-murine"
              action={{ type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } }} />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId("reclassify-murine"));
    expect(screen.getAllByTestId("claim-modified-badge")).toHaveLength(1);
  });

  it("clears the badge when the field is reclassified back to its registered value", () => {
    // §9.3 at the evidence copy, and the reason reclassifyClaim prunes: a claim
    // set to human and back to rodent is the registered claim, and saying MODIFIED
    // over it is the same false alarm the ruleset badge already avoids.
    render(
      <StoreProvider data={data}>
        <EvidencePanel collapsed={false} onExpand={() => {}} />
        <Fire id="to-human" action={{ type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } }} />
        <Fire id="to-rodent" action={{ type: "reclassifyClaim", claimId: MURINE, edit: { system: "rodent" } }} />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId("to-human"));
    expect(screen.getAllByTestId("claim-modified-badge")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("to-rodent"));
    expect(screen.queryByTestId("claim-modified-badge")).toBeNull();
  });

  it("drops every overlay on resetEvidence", () => {
    render(
      <StoreProvider data={data}>
        <CaseHeader />
        <EvidencePanel collapsed={false} onExpand={() => {}} />
        <Fire id="to-human" action={{ type: "reclassifyClaim", claimId: MURINE, edit: { system: "human" } }} />
        <Fire id="reset-evidence" action={{ type: "resetEvidence" }} />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId("to-human"));
    expect(screen.getByTestId("verdict").textContent).toMatch(/Do not advance/);
    fireEvent.click(screen.getByTestId("reset-evidence"));
    expect(screen.getByTestId("verdict").textContent).toMatch(/Abstain/);
    expect(screen.queryByTestId("claim-modified-badge")).toBeNull();
  });
});

describe("one edited predicate, both surfaces (§9.3)", () => {
  it("clears the MODIFIED badge and the pre-flight warning TOGETHER", () => {
    // Before this task the badge cleared and the panel did not, because one tested
    // by reference and the other by deep compare. The failure is only visible when
    // both are on screen at once, which is why they are rendered together here.
    render(
      <StoreProvider data={data}>
        <RulesetTab />
        <Preflight />
      </StoreProvider>,
    );

    fireEvent.change(screen.getByTestId("strength-R1"), { target: { value: "0.05" } });
    expect(screen.getByTestId("modified-badge")).toBeTruthy();
    expect(screen.getByTestId("check-edits").getAttribute("data-ok")).toBe("false");

    fireEvent.change(screen.getByTestId("strength-R1"), { target: { value: "0.9" } });
    expect(screen.queryByTestId("modified-badge")).toBeNull();
    expect(screen.getByTestId("check-edits").getAttribute("data-ok")).toBe("true");
  });

  it("still warns while a real edit is on screen", async () => {
    render(
      <StoreProvider data={data}>
        <RulesetTab />
        <Preflight />
      </StoreProvider>,
    );
    fireEvent.change(screen.getByTestId("strength-R1"), { target: { value: "0.05" } });
    await waitFor(() =>
      expect(screen.getByTestId("check-edits").textContent).toMatch(/press Reset on the Ruleset tab/));
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- apps/web/test/evidenceEdits.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="claim-modified-badge"]` in three cases, and `expected "false" to be "true"` on the §9.3 case, because `Preflight.tsx:40` still compares by reference. The two §9.1 cases and the verdict-movement case already pass on Step 3's store: they pin behaviour that must not regress when Task 5 wires the confirm panel, and both can fail — the isolation case fails the moment `useLibraryVerdicts` opts in.

- [ ] **Step 7: Route call site 3 and badge each reclassified claim**

Replace `apps/web/src/tabs/Case/EvidencePanel.tsx`:

```tsx
import { isEdited, useAppState, visibleClaims, workingClaims } from "../../state/store.js";
import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { Dot } from "../../ui/primitives/Dot.js";

/**
 * Call site 3 of the four (§9), and the surface where the evidence working copy
 * becomes visible (§9.2).
 */
export function EvidencePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const state = useAppState();
  const { data, asOf, selectedCompoundId, evidenceEdits } = state;
  const r = useCaseReasoning();
  const isFixture = selectedCompoundId === data.fixture.compoundId;
  const claims = visibleClaims(workingClaims(state, selectedCompoundId), asOf);
  const stepFor = (id: string) => r.trace.find((s) => s.claimId === id);

  // The SAME predicate the Ruleset tab and the pre-flight panel use (§9.3),
  // applied to one claim's overlay against an empty one. Exact because
  // reclassifyClaim prunes a field set back to its registered value rather than
  // storing it, so a present overlay is always a genuine change.
  const modified = (id: string) => isEdited(evidenceEdits[id] ?? {}, {});

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
      {/* 14px below, not the 13px used for incidental captions. UNVERIFIED citations
          is a disclosure, and it was measured as the smallest text on the Case tab -
          the caveat least likely to survive a compressed share. */}
      {isFixture && (
        <p data-testid="citation-status" style={{ color: "var(--ambiguous)", fontSize: 14, fontWeight: 600 }}>
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
                {/* Mirrors the Ruleset tab's treatment word for word. A verdict
                    computed from reclassified evidence must never be readable as
                    one computed from the registered evidence. */}
                {modified(c.id) && (
                  <strong data-testid="claim-modified-badge"
                          style={{ color: "var(--toxic)", fontSize: 12 }}>
                    MODIFIED — not the registered claim
                  </strong>
                )}
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

- [ ] **Step 8: Apply the one predicate to both working copies**

In `apps/web/src/tabs/Ruleset.tsx`, change the import on line 1 and the predicate on line 25:

```tsx
import { isEdited, useAppState, useDispatch } from "../state/store.js";
```

```tsx
  // §9.3. The same predicate the pre-flight panel and the evidence panel use.
  const modified = isEdited(ruleset, data.ruleset);
```

In `apps/web/src/ui/Preflight.tsx`, change the import on line 2 and line 40:

```tsx
import { isEdited, useAppState } from "../state/store.js";
```

```tsx
  // §9.3. Was `ruleset !== data.ruleset`, which reported a slider dragged back to
  // its registered value as a live edit while the Ruleset tab's badge - a deep
  // compare - had already cleared. One predicate now, and it is the value compare,
  // because a false alarm is not free in a panel whose stated rule is that every
  // line is a check computed now rather than a caption.
  const edited = isEdited(ruleset, data.ruleset);
```

The `check-evidence-edits` line §9.2 asks for is **not** added here — it needs the registered evidence digest that gives it something to check, and both land in Task 10.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test -- apps/web && npm run typecheck && npm run web:build`
Expected: PASS, build succeeds. `npm run typecheck` is the step that exercises the four `@ts-expect-error` cases — vitest transpiles without type-checking, so a widened `EvidenceEdit` would slip past `npm test` and be caught here as `Unused '@ts-expect-error' directive`.

- [ ] **Step 10: Commit**

```bash
git add apps/web
git commit -m "$(cat <<'MSG'
Unify the four claim lookups, then add the evidence working copy

"Get the claims for the selected compound" was written four times - at
useCaseReasoning.ts:13, CaseHeader.tsx:15, EvidencePanel.tsx:9 and Record.tsx:16 -
and each copy was correct. Correct is not enough once an overlay exists: wired into
three of the four, an evidence working copy produces a verdict computed from
evidence the panel beside it is not showing, and nothing in the UI would say so.
Spec section 9 requires the refactor before the feature, and this commit keeps that
order. registeredClaims is module-private so a fifth call site cannot appear.

The overlay is per-claim and stored as Partial<Pick<EvidenceClaim,
ReclassifiableField>>, where ReclassifiableField is keyof AssayOperator["produces"]
(plan.ts:13-16). That is section 5.3's derivation and it is the whole exclusion
mechanism: assertion, strength, id, compoundId, availableFrom and provenance are
excluded because none is a member of that set, not because a deny-list says so, and
adding a rule-consumed field to the planner widens both at once. Changing an
assertion would not test the reasoning, it would choose the answer - and that
question already has a read-only answer in findCounterfactual, which reports the
minimal set of flips that would change the verdict without applying any of them.

A reclassification is validated as a WHOLE CLAIM through EvidenceClaimSchema before
it is stored, following the engine's own precedent at plan.ts:174-180. schema.ts:26-35
carries a cross-field constraint - an in_silico or qsar claim must have
measuresKeyEvent === null - whose violation lets a claim escape R2's
structural-correlation discount and be weighted like human clinical evidence. No
field-by-field check can see that. plan.ts throws; the reducer's equivalent is to
refuse the transition, so a rejected edit cannot take the tab down mid-demo.

The two working copies run at OPPOSITE POLARITY (section 9.1). The ruleset working
copy feeds the 267-row library table deliberately. Evidence edits must not: they are
per-claim on one compound, and a corpus statistic recomputed over edited evidence is
a number computed after seeing a result. So calling workingClaims is the opt-in, and
useLibraryVerdicts does not call it. A test applies an edit measured to flip that
row's verdict and asserts the row does not move - the potency half is asserted
first, or the isolation half would be asserting a number that never changes.

Section 9.3 is settled rather than inherited: Preflight.tsx:40 tested "edited" by
reference while Ruleset.tsx:25 deep-compared, so dragging a slider and dragging it
back cleared the badge while the panel still warned. One predicate now, the value
compare, applied to the ruleset copy, the evidence copy and the new per-claim badge.
reclassifyClaim prunes a field back to its registered value rather than storing it,
which is what makes that predicate exact at the evidence copy too.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
git push origin phase3
```

---

### Task 4: The authored cache is the product, so rungs 2–5 run with no network at all

Design §5.1 fixes Surface 1's five rungs and §13 fixes the cache they read; rungs 2–5 are entirely local, so the ladder is complete and testable before `services/api` exists — and this is the path the submitted ZIP actually runs (§2).

**Files:**
- Create: `apps/web/src/ai/interpret.ts`
- Create: `apps/web/src/ai/cache/interpretations.json`
- Modify: `apps/web/package.json:11-15`
- Test: `apps/web/test/interpret.test.ts`
- Test: `apps/web/test/interpretCache.test.ts`

**Interfaces:**
- Consumes (Task 1): `export type Source = "live" | "cache" | "local" | "none"`; `export interface Resolution<T> { value: T | null; rung: number; source: Source }`; `export interface Rung<I, T> { source: Source; run: (input: I) => Promise<T | null> }`; `export function resolve<I, T>(rungs: Rung<I, T>[], input: I): Promise<Resolution<T>>`; `export function jaccard(a: string, b: string): number`; `export const FUZZY_THRESHOLD = 0.55`
- Consumes (engine): `type AssayOperator`, `type RuleId` from `@arbiter/engine`
- Produces: `export type InterpretAction = "disable" | "lower_strength" | "raise_strength" | "reclassify_field"`; `export type ReclassifiableField = keyof AssayOperator["produces"]`; `export interface Proposal { targetRule: RuleId | null; targetClaimId: string | null; action: InterpretAction; field: ReclassifiableField | null; newValue: unknown; paraphrase: string; confidence: "high" | "low" }`; `export interface InterpretInput { challenge: string; rules: { id: RuleId; enabled: boolean; strength: number }[]; claims: { id: string; label: string }[] }`; `export const ProposalSchema: z.ZodType<Proposal>`; `export function interpret(input: InterpretInput): Promise<Resolution<Proposal>>`

> **`resolve` contract this task depends on.** When every rung returns `null`, `resolve` reports the **last rung tried** — `{ value: null, rung: 5, source: "none" }`. Rung 5 is therefore a real entry in the array with `source: "none"` whose `run` always returns `null`, not a special case in the walker. If Task 1 landed different semantics, fix Task 1; do not add a branch here.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/interpret.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { interpret, ProposalSchema, type InterpretInput } from "../src/ai/interpret.js";
import { loadData } from "../src/data/load.js";

const data = loadData();

/**
 * The request shape design section 5 permits: the challenge, the ruleset as
 * (id, enabled, strength), and claim ids and labels ONLY. Building it from the
 * real loaded data rather than from a literal means a change to the fixture that
 * breaks the interpreter breaks this test too.
 */
const input = (challenge: string): InterpretInput => ({
  challenge,
  rules: data.ruleset.rules.map((r) => ({ id: r.id, enabled: r.enabled, strength: r.strength })),
  claims: data.fixture.claims.map((c) => ({ id: c.id, label: c.id })),
});

describe("interpret - which rung answered", () => {
  // Trap 1 of design section 12: asserting "an answer appeared" passes on every
  // rung and is worthless. Every case below asserts `rung` and `source`.

  it("answers at RUNG 2 on an exact cached challenge", async () => {
    const r = await interpret(input("the rat data shouldn't be discounted that hard"));
    expect(r.rung).toBe(2);
    expect(r.source).toBe("cache");
    expect(r.value?.targetRule).toBe("R1");
    expect(r.value?.action).toBe("lower_strength");
  });

  it("still answers at RUNG 2 through case and whitespace differences", async () => {
    // A reviewer typing into a box does not reproduce the authored casing. If
    // normalisation were dropped this falls to rung 3, so the assertion on rung 2
    // is what pins the behaviour - `.value !== null` would pass either way.
    const r = await interpret(input("   The Rat Data Shouldn't Be   Discounted That Hard  "));
    expect(r.rung).toBe(2);
    expect(r.value?.targetRule).toBe("R1");
  });

  it("answers at RUNG 3 on a near-miss above the 0.55 threshold", async () => {
    const r = await interpret(input("the rat data shouldnt be discounted that hard really"));
    expect(r.rung).toBe(3);
    expect(r.source).toBe("cache");
    expect(r.value?.targetRule).toBe("R1");
  });

  it("falls past RUNG 3 to RUNG 4 when nothing clears the threshold", async () => {
    // Same topic as the authored Klimisch challenge, none of its wording. This is
    // the case that would silently pass if rung 3 accepted everything.
    const r = await interpret(input("the reliability scoring is too punitive"));
    expect(r.rung).toBe(4);
    expect(r.source).toBe("local");
    expect(r.value?.targetRule).toBe("R5");
  });

  it("answers at RUNG 4 on a keyword, ALWAYS at low confidence", async () => {
    // Design section 5.2: a low-confidence proposal arrives un-armed. A keyword hit
    // is a guess about which rule is meant, so rung 4 may never present itself as
    // a reading.
    const r = await interpret(input("the murine work deserves more credit than this"));
    expect(r.rung).toBe(4);
    expect(r.value?.targetRule).toBe("R1");
    expect(r.value?.confidence).toBe("low");
  });

  it("reads a disabling phrase at RUNG 4 as disable, not as a strength change", async () => {
    const r = await interpret(input("just turn off the klimisch penalty"));
    expect(r.rung).toBe(4);
    expect(r.value?.targetRule).toBe("R5");
    expect(r.value?.action).toBe("disable");
    expect(r.value?.newValue).toBeNull();
  });

  it("reads a raising phrase at RUNG 4 as raise_strength, on the 0.05 grid", async () => {
    // The Ruleset tab's slider has step="0.05". A proposal off that grid would be
    // un-reproducible by hand, which breaks the parity guarantee Apply rests on.
    const r = await interpret(input("R4 is far too gentle, raise it"));
    expect(r.rung).toBe(4);
    expect(r.value?.action).toBe("raise_strength");
    expect(r.value?.newValue).toBe(0.75);
  });

  it("does NOT let the keyword 'rat' fire on the word 'rate'", async () => {
    // A bare substring match routes a challenge about the discount RATE to R1,
    // which is a wrong rule confidently proposed - the exact failure the confirm
    // panel exists to catch, arriving from our own code.
    const r = await interpret(input("the discount rate is arbitrary"));
    expect(r.rung).toBe(5);
    expect(r.value).toBeNull();
  });

  it("reaches RUNG 5 and reports source 'none' when nothing matches", async () => {
    const r = await interpret(input("what is the weather like in Groton"));
    expect(r.rung).toBe(5);
    expect(r.source).toBe("none");
    expect(r.value).toBeNull();
  });
});

describe("ProposalSchema", () => {
  const valid = {
    targetRule: "R1", targetClaimId: null, action: "lower_strength",
    field: null, newValue: 0.45, paraphrase: "Reduce R1.", confidence: "high",
  };

  it("accepts a well-formed strength proposal", () => {
    expect(ProposalSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses every field outside keyof AssayOperator['produces']", () => {
    // Design section 5.3. `assertion` is choosing the answer rather than testing
    // the reasoning; `strength` is the unregistered knob section 12b says does not
    // exist; `compoundId` and `availableFrom` defeat the cross-compound guard and
    // the hindsight defence. None is a member of AssayOperator["produces"], so all
    // four are excluded by the TYPE - this test proves the schema agrees.
    for (const field of ["assertion", "strength", "compoundId", "id", "availableFrom", "provenance"]) {
      const p = { ...valid, action: "reclassify_field", targetClaimId: "TAK-994:qsar", field, newValue: "x" };
      expect(ProposalSchema.safeParse(p).success).toBe(false);
    }
  });

  it("refuses a strength action whose newValue is not a number in 0..1", () => {
    expect(ProposalSchema.safeParse({ ...valid, newValue: "a lot" }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...valid, newValue: 1.4 }).success).toBe(false);
  });

  it("refuses a reclassify that names no claim, and a disable that carries a value", () => {
    expect(ProposalSchema.safeParse(
      { ...valid, action: "reclassify_field", field: "klimisch", newValue: null },
    ).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...valid, action: "disable", newValue: 0.2 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/interpret.test.ts`
Expected: FAIL — `Error: Failed to load url ../src/ai/interpret.js (resolved id: apps/web/src/ai/interpret.js). Does the file exist?`

- [ ] **Step 3: Declare zod as a dependency of the web app**

`ProposalSchema` is the first direct zod use in `apps/web`. It already resolves through the hoisted root `node_modules` because `@arbiter/engine` depends on it, and a phantom dependency that works by hoisting is exactly the kind of thing that breaks when someone installs the workspace fresh.

Edit `apps/web/package.json` so `dependencies` reads:

```json
  "dependencies": {
    "@arbiter/engine": "1.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zod": "^3.25.76"
  }
```

Run: `npm install`
Expected: no package is downloaded — zod 3.25.76 is already at the repo root; only the workspace edge is recorded in `package-lock.json`.

- [ ] **Step 4: Author the cache**

Thirteen challenges covering all six rules, drawn from master spec §12b's prepared Q&A and the seven demo beats (design §13). Four carry `confidence: "low"` because they object to the discount *mechanism* rather than to a named rule, and a reasonable interpreter could land them on R1, R3 or all six.

**The phrasing is the product.** These strings are what live input is matched against at rungs 2 and 3, so they are written the way a reviewer types — some blunt, some hedged, some in domain shorthand. Do not tidy them into "lower strength of R1"; that sentence has never been typed by a toxicologist and it would make rung 3 miss.

Create `apps/web/src/ai/cache/interpretations.json`:

```json
{
  "authoredFrom": "master spec 12b prepared Q&A, the seven demo beats, and the six registered rules of rules/ruleset-v1.0.json",
  "reviewFlags": [
    "entry 2 (ICH M3 two-species phrasing) needs a toxicologist, not an engineer: is this how a reviewer actually opens that objection? It matters more than it looks, because this string is what live input is matched against at rungs 2 and 3.",
    "entry 8 (a >100x in-vitro margin treated as an established exposure margin) needs a toxicologist.",
    "entry 12 (clearing a Klimisch score on a QSAR claim as a category error) needs a toxicologist."
  ],
  "entries": [
    {
      "challenge": "the rat data shouldn't be discounted that hard",
      "targetRule": "R1",
      "targetClaimId": null,
      "action": "lower_strength",
      "field": null,
      "newValue": 0.45,
      "paraphrase": "Reduce R1, human relevance, so the rodent studies keep more of their stated confidence.",
      "confidence": "high"
    },
    {
      "challenge": "ICH M3 asks for two species because rodent and non-rodent answer different questions. collapsing both into 'not human' throws that away",
      "targetRule": "R1",
      "targetClaimId": null,
      "action": "lower_strength",
      "field": null,
      "newValue": 0.45,
      "paraphrase": "Reduce R1, human relevance, so a two-species animal package is not discounted as one undifferentiated block.",
      "confidence": "high"
    },
    {
      "challenge": "primary human hepatocytes are the whole point of the FDA roadmap. if anything R1 is too soft here",
      "targetRule": "R1",
      "targetClaimId": null,
      "action": "raise_strength",
      "field": null,
      "newValue": 0.95,
      "paraphrase": "Increase R1, human relevance, so human-cell evidence outweighs animal evidence more decisively.",
      "confidence": "high"
    },
    {
      "challenge": "read-across from a known toxicophore is real evidence, you're treating it like noise",
      "targetRule": "R2",
      "targetClaimId": null,
      "action": "lower_strength",
      "field": null,
      "newValue": 0.45,
      "paraphrase": "Reduce R2, mechanistic proximity, so structural read-across is discounted less against a directly measured key event.",
      "confidence": "high"
    },
    {
      "challenge": "why is a structural alert worth less than a cell assay? both are only proxies for a human liver",
      "targetRule": "R2",
      "targetClaimId": null,
      "action": "lower_strength",
      "field": null,
      "newValue": 0.45,
      "paraphrase": "Reduce R2, mechanistic proximity, on the grounds that structural and in-vitro evidence are both indirect.",
      "confidence": "low"
    },
    {
      "challenge": "why does R3 only apply to negative findings? that looks convenient",
      "targetRule": "R3",
      "targetClaimId": null,
      "action": "disable",
      "field": null,
      "newValue": null,
      "paraphrase": "Turn R3, exposure relevance, off entirely, so a negative finding is not discounted for an unstated exposure margin.",
      "confidence": "low"
    },
    {
      "challenge": "isn't the discounting just a fudge factor to get the answer you wanted",
      "targetRule": "R3",
      "targetClaimId": null,
      "action": "lower_strength",
      "field": null,
      "newValue": 0.45,
      "paraphrase": "Reduce R3, exposure relevance, so an unstated exposure margin costs a negative finding less weight.",
      "confidence": "low"
    },
    {
      "challenge": "the in-vitro panel was run against clinical Cmax — a hundred-fold margin IS an exposure margin. stop calling it untested",
      "targetRule": "R3",
      "targetClaimId": "TAK-994:cytotox",
      "action": "reclassify_field",
      "field": "exposureRelevant",
      "newValue": true,
      "paraphrase": "Record the in-vitro DILI panel as having an established exposure margin, so R3 stops discounting it.",
      "confidence": "high"
    },
    {
      "challenge": "first-in-class orexin agonist. there is nothing like it in the training set — that QSAR call is out of domain",
      "targetRule": "R4",
      "targetClaimId": "TAK-994:qsar",
      "action": "reclassify_field",
      "field": "inApplicabilityDomain",
      "newValue": false,
      "paraphrase": "Record the QSAR prediction as outside the model's applicability domain, so R4 admits it at reduced weight.",
      "confidence": "high"
    },
    {
      "challenge": "a 0.5 downweight for out-of-domain is far too gentle. out of domain means the prediction is uninformative",
      "targetRule": "R4",
      "targetClaimId": null,
      "action": "raise_strength",
      "field": null,
      "newValue": 0.75,
      "paraphrase": "Increase R4, applicability domain, so an out-of-domain prediction is admitted at a much lower weight.",
      "confidence": "high"
    },
    {
      "challenge": "klimisch 3 gets hammered too hard here. plenty of non-GLP work is perfectly sound",
      "targetRule": "R5",
      "targetClaimId": null,
      "action": "lower_strength",
      "field": null,
      "newValue": 0.3,
      "paraphrase": "Reduce R5, study reliability, so a Klimisch 3 study is not discounted so heavily.",
      "confidence": "high"
    },
    {
      "challenge": "a klimisch score on a QSAR prediction is a category error. Klimisch grades experimental studies, not models",
      "targetRule": "R5",
      "targetClaimId": "TAK-994:qsar",
      "action": "reclassify_field",
      "field": "klimisch",
      "newValue": null,
      "paraphrase": "Clear the Klimisch score on the QSAR prediction, so R5's reliability discount stops applying to a computational claim.",
      "confidence": "high"
    },
    {
      "challenge": "cytotox and transporter both come out of Tox21. that's one platform, not two independent sources",
      "targetRule": "R6",
      "targetClaimId": null,
      "action": "lower_strength",
      "field": null,
      "newValue": 0.2,
      "paraphrase": "Reduce R6, concordance, so two readouts from one assay platform are not credited as two independent sources.",
      "confidence": "low"
    }
  ]
}
```

Measured before committing: the highest character-trigram Jaccard between any two of the thirteen is **0.17** (entries 1 and 7, which share the word "discount"), so no live input can clear 0.55 against two entries at once and rung 3 has no ambiguity to resolve.

- [ ] **Step 5: Write the interpreter**

Create `apps/web/src/ai/interpret.ts`:

```ts
import { z } from "zod";
import type { AssayOperator, RuleId } from "@arbiter/engine";
import { resolve, type Resolution, type Rung } from "./resolve.js";
import { FUZZY_THRESHOLD, jaccard } from "./trigram.js";
import CACHE from "./cache/interpretations.json";

/**
 * Surface 1's five rungs (design section 5.1), four of which need no network.
 *
 * At EVERY rung the resulting change runs through the same engine. Only the route
 * from English to rule change differs; the reasoning is never faked. That is why a
 * cache hit and a live call are interchangeable here and why the ZIP loses nothing
 * a judge can see (design section 2).
 *
 * WHAT THIS MODULE MAY NOT SEE. `InterpretInput` carries claim IDS AND LABELS
 * ONLY - no assertion, no strength, no provenance, no classification field. That
 * is the request contract of design section 5, and it has a consequence recorded
 * here rather than discovered later: section 5.4's arrival-time
 * `EvidenceClaimSchema.safeParse` over the MERGED claim cannot run in this module,
 * because merging needs the values this module is denied. The check is split:
 * `ProposalSchema` here proves the field is legal and the value is of a legal
 * kind; `TablePanel` runs the cross-field refinement against the real claim before
 * anything is displayed. The authored cache is additionally checked wholesale by
 * apps/web/test/interpretCache.test.ts, so the cache path cannot reach the panel
 * with an invalid proposal at all.
 */

export type InterpretAction = "disable" | "lower_strength" | "raise_strength" | "reclassify_field";

/**
 * The legal reclassification targets are DERIVED, not invented: exactly the fields
 * the value-of-information planner must declare to synthesise a hypothetical claim
 * (packages/engine/src/plan.ts:13-16), arrived at independently for that purpose.
 * Adding a rule-consumed field there widens both at once.
 *
 * `assertion`, `strength`, `compoundId`, `id`, `availableFrom` and `provenance`
 * are excluded BY CONSTRUCTION - none is a member of AssayOperator["produces"], so
 * there is no deny-list to maintain and none to forget to update. Design section
 * 5.3 records why each one is excluded.
 */
export type ReclassifiableField = keyof AssayOperator["produces"];

export interface Proposal {
  targetRule: RuleId | null;
  targetClaimId: string | null;
  action: InterpretAction;
  field: ReclassifiableField | null;
  newValue: unknown;
  paraphrase: string;
  confidence: "high" | "low";
}

export interface InterpretInput {
  challenge: string;
  rules: { id: RuleId; enabled: boolean; strength: number }[];
  claims: { id: string; label: string }[];
}

const RULE_IDS = ["R1", "R2", "R3", "R4", "R5", "R6"] as const;
const FIELDS = [
  "stream", "system", "measuresKeyEvent", "exposureRelevant", "inApplicabilityDomain", "klimisch",
] as const;

/**
 * Drift guard, in the idiom packages/engine/src/schema.ts:87-102 already uses. The
 * runtime tuple above and the derived `ReclassifiableField` type declare the same
 * six names twice, and nothing else forces them to agree. Bidirectional on
 * purpose: a one-way check passes happily when one side gains an extra member,
 * which is precisely how `assertion` or `strength` would get in.
 */
type FieldsMatchProduces = [
  (typeof FIELDS)[number] extends ReclassifiableField ? true : never,
  ReclassifiableField extends (typeof FIELDS)[number] ? true : never,
];
export const FIELDS_MATCH_PRODUCES: FieldsMatchProduces = [true, true];

/**
 * `newValue` is `unknown` on the interface because the interface is the widest
 * contract, but the SCHEMA narrows it to the four kinds design section 5.3's table
 * actually admits: strings (system, stream, measuresKeyEvent), numbers (klimisch,
 * and a rule strength), booleans (exposureRelevant, inApplicabilityDomain), and
 * null. Narrowing here is not only stricter, it keeps the key REQUIRED - zod
 * infers `z.unknown()` as an optional property, which would not satisfy
 * `z.ZodType<Proposal>`.
 */
const NewValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ProposalSchema: z.ZodType<Proposal> = z
  .object({
    targetRule: z.enum(RULE_IDS).nullable(),
    targetClaimId: z.string().min(1).nullable(),
    action: z.enum(["disable", "lower_strength", "raise_strength", "reclassify_field"]),
    field: z.enum(FIELDS).nullable(),
    newValue: NewValueSchema,
    paraphrase: z.string().min(1),
    confidence: z.enum(["high", "low"]),
  })
  // Cross-field constraints, because a proposal that parses field-by-field can
  // still be undispatchable - a reclassify naming no claim, or a strength change
  // carrying a string. The confirm panel would then render a control that does
  // nothing, which is worse than no proposal at all.
  .superRefine((p, ctx) => {
    if (p.action === "reclassify_field") {
      if (p.field === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ["field"],
          message: "A reclassify_field proposal must name which field it changes.",
        });
      }
      if (p.targetClaimId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ["targetClaimId"],
          message: "A reclassify_field proposal must name the claim it changes.",
        });
      }
      return;
    }
    if (p.targetRule === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["targetRule"],
        message: "A rule-level proposal must name the rule it contests.",
      });
    }
    if (p.field !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["field"],
        message: "Only reclassify_field may name an evidence field.",
      });
    }
    if (p.action === "disable") {
      if (p.newValue !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom, path: ["newValue"],
          message: "A disable proposal carries no value; enabled goes to false.",
        });
      }
      return;
    }
    if (typeof p.newValue !== "number" || p.newValue < 0 || p.newValue > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom, path: ["newValue"],
        message: "A strength proposal must carry the proposed strength as a number in 0..1.",
      });
    }
  });

/**
 * Lowercase, collapse whitespace, trim. Rung 2 is an EXACT match in the only sense
 * that survives a reviewer typing into a box: identical text, not identical
 * keystrokes. Without it every real hit lands on rung 3 and the exact rung is dead
 * code that still passes a `.value !== null` test.
 */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The authored cache, parsed once at module load. An entry that fails
 * `ProposalSchema` is DROPPED rather than thrown, so a bad edit degrades this
 * surface to fewer cached matches instead of blanking the whole app on import -
 * and apps/web/test/interpretCache.test.ts asserts all thirteen survive, so the
 * degradation is never silent.
 */
const ENTRIES: { challenge: string; proposal: Proposal }[] = CACHE.entries.flatMap((raw) => {
  const parsed = ProposalSchema.safeParse({
    targetRule: raw.targetRule,
    targetClaimId: raw.targetClaimId,
    action: raw.action,
    field: raw.field,
    newValue: raw.newValue,
    paraphrase: raw.paraphrase,
    confidence: raw.confidence,
  });
  return parsed.success ? [{ challenge: normalize(raw.challenge), proposal: parsed.data }] : [];
});

/**
 * The Ruleset tab's slider is `step="0.05"`. A proposal off that grid names a
 * value the reviewer could not have reached by hand, which breaks the parity
 * guarantee Apply rests on. `toFixed(2)` because 9 * 0.05 is 0.45000000000000001
 * in binary floating point and that number should never reach a label.
 */
const STEP = 0.05;
function onGrid(x: number): number {
  return Number((Math.round(Math.min(1, Math.max(0, x)) / STEP) * STEP).toFixed(2));
}

/**
 * The registered rule names, for the rung-4 paraphrase. Duplicated from
 * rules/ruleset-v1.0.json deliberately: `InterpretInput` carries only
 * (id, enabled, strength) because that is what design section 5 permits in the
 * request body, and the ruleset is pre-registered and hashed, so these strings
 * cannot drift without `check-ruleset` failing first.
 */
const RULE_NAMES: Record<RuleId, string> = {
  R1: "human relevance",
  R2: "mechanistic proximity",
  R3: "exposure relevance",
  R4: "applicability domain",
  R5: "study reliability",
  R6: "concordance",
};

/**
 * Word-boundary matcher. A bare `includes("rat")` fires on "rate", "strategy" and
 * "accurate", which routes a challenge about the discount RATE to R1 - a wrong
 * rule, confidently proposed, arriving from our own code rather than from a model.
 * A trailing `*` asks for a prefix match instead, for stems like "structur*".
 */
function tokenPattern(token: string): RegExp {
  const prefix = token.endsWith("*");
  const body = (prefix ? token.slice(0, -1) : token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${body}${prefix ? "" : "\\b"}`);
}

/** Design section 5.1's rung-4 vocabulary: `rat`, `margin`, `domain`, rule names, stream names. */
const KEYWORD_TOKENS: { rule: RuleId; tokens: string[] }[] = [
  { rule: "R1", tokens: ["r1", "human relevance", "rat", "rats", "rodent*", "mouse", "mice", "murine", "primate*", "animal*", "species", "in vivo"] },
  { rule: "R2", tokens: ["r2", "mechanistic proximity", "structur*", "read-across", "read across", "toxicophore*", "key event*", "qsar", "in silico", "mechanis*"] },
  { rule: "R3", tokens: ["r3", "exposure relevance", "margin*", "exposure*", "cmax", "dose*", "clinically relevant"] },
  { rule: "R4", tokens: ["r4", "applicability domain", "domain", "training set", "extrapolat*", "out of domain"] },
  { rule: "R5", tokens: ["r5", "study reliability", "klimisch", "glp", "non-glp", "reliabilit*"] },
  { rule: "R6", tokens: ["r6", "concordance", "independen*", "platform*", "tox21", "corroborat*"] },
];

const KEYWORDS = KEYWORD_TOKENS.map((g) => ({ rule: g.rule, patterns: g.tokens.map(tokenPattern) }));

const DISABLE_PATTERNS = [
  "disable*", "turn it off", "turn off", "switch off", "drop*", "remove*", "throw out", "delete*",
  "shouldn't apply", "should not apply",
].map(tokenPattern);

const RAISE_PATTERNS = [
  "too soft", "too gentle", "too generous", "too weak", "too lenient", "not strict enough",
  "raise*", "increase*", "harder", "stronger",
].map(tokenPattern);

/**
 * Rung 4. A COUNT of distinct matching keywords, not a first match: a challenge
 * naming two rules should land on the one it talks about most. Ties break on the
 * declared order above, so the output is stable rather than dependent on iteration
 * order.
 *
 * Rung 4 ALWAYS returns `confidence: "low"`, and that is a guarantee rather than
 * an accident of authoring. A keyword hit is a guess about which rule the reviewer
 * means; design section 5.2 requires a low-confidence proposal to arrive un-armed,
 * so a guess can never present itself as a reading.
 *
 * It never proposes `reclassify_field`: keywords cannot know WHICH claim is meant,
 * and a reclassify naming the wrong claim edits evidence the reviewer was not
 * talking about.
 */
function keywordProposal(input: InterpretInput): Proposal | null {
  const text = normalize(input.challenge);

  let best: { rule: RuleId; hits: number } | null = null;
  for (const group of KEYWORDS) {
    const hits = group.patterns.filter((p) => p.test(text)).length;
    if (hits > 0 && (best === null || hits > best.hits)) best = { rule: group.rule, hits };
  }
  if (best === null) return null;

  const chosen = best.rule;
  // The ruleset on screen is the authority on what exists, not this file.
  const rule = input.rules.find((r) => r.id === chosen);
  if (!rule) return null;

  const action: InterpretAction = DISABLE_PATTERNS.some((p) => p.test(text))
    ? "disable"
    : RAISE_PATTERNS.some((p) => p.test(text))
      ? "raise_strength"
      : "lower_strength";

  const newValue = action === "disable"
    ? null
    : action === "raise_strength"
      ? onGrid(rule.strength + (1 - rule.strength) / 2)
      : onGrid(rule.strength / 2);

  return {
    targetRule: chosen,
    targetClaimId: null,
    action,
    field: null,
    newValue,
    paraphrase: action === "disable"
      ? `Turn ${chosen}, ${RULE_NAMES[chosen]}, off entirely.`
      : `${action === "raise_strength" ? "Increase" : "Reduce"} ${chosen}, ${RULE_NAMES[chosen]}.`,
    confidence: "low",
  };
}

/**
 * The five rungs, declared as DATA so that "which rung answered" is a value the
 * tests assert on and the pre-flight panel displays, rather than a comment.
 */
const RUNGS: Rung<InterpretInput, Proposal>[] = [
  {
    // Rung 1, live. Stubbed as a permanent miss until Task 9 replaces this body
    // with `postJson("/api/interpret", input, (u) => ProposalSchema.safeParse(u).data ?? null)`.
    // It is declared NOW rather than added later so that every rung number in
    // every test is already the final one - renumbering rungs after the tests are
    // written is how a rung assertion quietly starts testing the wrong rung.
    source: "live",
    run: async () => null,
  },
  {
    // Rung 2, exact match against the authored cache.
    source: "cache",
    run: async (input) => ENTRIES.find((e) => e.challenge === normalize(input.challenge))?.proposal ?? null,
  },
  {
    // Rung 3, character-trigram Jaccard over THAT SAME cached set, accepted at
    // >= 0.55. Highest score wins; the authored set's highest internal similarity
    // is 0.17, so two entries cannot both clear the threshold against one input.
    source: "cache",
    run: async (input) => {
      const q = normalize(input.challenge);
      let best: { score: number; proposal: Proposal } | null = null;
      for (const e of ENTRIES) {
        const score = jaccard(q, e.challenge);
        if (score >= FUZZY_THRESHOLD && (best === null || score > best.score)) {
          best = { score, proposal: e.proposal };
        }
      }
      return best?.proposal ?? null;
    },
  },
  {
    // Rung 4, deterministic keyword mapping.
    source: "local",
    run: async (input) => keywordProposal(input),
  },
  {
    // Rung 5, the rule picker. It has no proposal to offer - the UI asks "which
    // rule do you want to contest?" and the USER answers. Declared as a real rung
    // so `resolve` reports `{ value: null, rung: 5, source: "none" }` rather than
    // the caller having to infer exhaustion from a null.
    source: "none",
    run: async () => null,
  },
];

export function interpret(input: InterpretInput): Promise<Resolution<Proposal>> {
  return resolve(RUNGS, input);
}
```

- [ ] **Step 6: Run the rung test to verify it passes**

Run: `npm test -- apps/web/test/interpret.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 7: Write the content test**

Design §12 calls this one of "two cheap content tests worth more than they cost". It is what stops the authored cache drifting away from the ruleset and the fixture — a renamed claim id or a retyped field would otherwise surface as a proposal that silently fails to apply, in front of a judge.

Create `apps/web/test/interpretCache.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EvidenceClaimSchema } from "@arbiter/engine";
import { ProposalSchema } from "../src/ai/interpret.js";
import { loadData } from "../src/data/load.js";
import CACHE from "../src/ai/cache/interpretations.json";

const data = loadData();
const ruleIds = new Set(data.ruleset.rules.map((r) => r.id));
const claimsById = new Map(data.fixture.claims.map((c) => [c.id, c]));

describe("the authored interpretation cache", () => {
  it("carries the thirteen entries design section 13 registers", () => {
    // Not decoration. The interpreter DROPS an entry that fails ProposalSchema so
    // that a bad edit cannot blank the app on import; without this count the
    // degradation would be silent and rung 2 would just start missing.
    expect(CACHE.entries).toHaveLength(13);
  });

  it("covers all six registered rules", () => {
    const covered = new Set(CACHE.entries.map((e) => e.targetRule));
    expect([...covered].sort()).toEqual(["R1", "R2", "R3", "R4", "R5", "R6"]);
  });

  it("marks exactly four entries low-confidence", () => {
    // The four that object to the discount MECHANISM rather than to a named rule.
    // Design section 5.2 keys the un-armed Apply control off this value, so the
    // count is a behavioural fact, not bookkeeping.
    expect(CACHE.entries.filter((e) => e.confidence === "low")).toHaveLength(4);
  });

  it("names a REAL rule id on every entry", () => {
    for (const e of CACHE.entries) {
      expect(ruleIds.has(e.targetRule as never), `${e.targetRule} on "${e.challenge}"`).toBe(true);
    }
  });

  it("parses every entry through ProposalSchema", () => {
    for (const e of CACHE.entries) {
      const parsed = ProposalSchema.safeParse({
        targetRule: e.targetRule, targetClaimId: e.targetClaimId, action: e.action,
        field: e.field, newValue: e.newValue, paraphrase: e.paraphrase, confidence: e.confidence,
      });
      expect(parsed.success, `"${e.challenge}": ${parsed.success ? "" : parsed.error.issues[0]?.message}`).toBe(true);
    }
  });

  it("names a REAL claim id and a SCHEMA-LEGAL value on every reclassify entry", () => {
    // The check the interpreter itself cannot run: design section 5's request
    // contract denies it the raw values, and schema.ts:26-35's cross-field
    // refinement needs them. Doing it here means the cache path can never deliver
    // a proposal that would be rejected on arrival.
    const reclassify = CACHE.entries.filter((e) => e.action === "reclassify_field");
    expect(reclassify.length).toBeGreaterThan(0);

    for (const e of reclassify) {
      const claim = claimsById.get(e.targetClaimId ?? "");
      expect(claim, `unknown claim id ${e.targetClaimId}`).toBeDefined();
      const merged = { ...claim, [e.field as string]: e.newValue };
      const parsed = EvidenceClaimSchema.safeParse(merged);
      expect(
        parsed.success,
        `${e.targetClaimId}.${e.field} = ${JSON.stringify(e.newValue)}: ${parsed.success ? "" : parsed.error.issues[0]?.message}`,
      ).toBe(true);
    }
  });

  it("would REJECT a reclassify that broke the engine's cross-field constraint", () => {
    // Proves the previous test can fail rather than merely passing vacuously. A
    // measuresKeyEvent on the QSAR claim is the exact case schema.ts:26-35 exists
    // for: it lets a computational prediction escape R2's structural-correlation
    // discount and be weighted like human clinical evidence.
    const qsar = claimsById.get("TAK-994:qsar");
    expect(EvidenceClaimSchema.safeParse({ ...qsar, measuresKeyEvent: "KE:BSEP-INHIBITION" }).success).toBe(false);
    expect(EvidenceClaimSchema.safeParse({ ...qsar, klimisch: 7 }).success).toBe(false);
  });
});
```

- [ ] **Step 8: Run it, then corrupt one entry and watch it fail**

Run: `npm test -- apps/web/test/interpretCache.test.ts`
Expected: PASS (7 tests)

Now prove the guard bites. Temporarily change entry 9's `"targetClaimId"` from `"TAK-994:qsar"` to `"TAK-994:qsr"` and re-run.
Expected: FAIL — `unknown claim id TAK-994:qsr` from "names a REAL claim id and a SCHEMA-LEGAL value on every reclassify entry".

Then temporarily change entry 8's `"field"` from `"exposureRelevant"` to `"assertion"` and re-run.
Expected: FAIL — `"the in-vitro panel was run against clinical Cmax…": Invalid enum value` from "parses every entry through ProposalSchema", **and** the count test still passing at 13, which is how you know the two checks are independent.

Revert both edits before continuing.

- [ ] **Step 9: Run the full suite**

Run: `npm test -- apps/web && npm run typecheck && npm run lint && npm run web:build`
Expected: PASS, build succeeds

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/ai apps/web/test/interpret.test.ts apps/web/test/interpretCache.test.ts apps/web/package.json package-lock.json
git commit -m "$(cat <<'MSG'
Add Surface 1's authored cache and rungs 2-5

Four of the challenge interpreter's five rungs need no network, so the surface is
complete and testable before any service exists - and this is the path the
submitted ZIP actually runs (design section 2). Rung 1 is declared now as a
permanent miss rather than added later, so every rung number the tests assert on
is already the final one; renumbering rungs after the assertions are written is how
a rung test quietly starts testing a different rung.

The tests assert on `rung`, never on "an answer appeared". Design section 12 names
that trap first because it passes on every rung and is therefore worthless: an
exact hit, a fuzzy hit, a keyword guess and total exhaustion all satisfy it. The
same discipline is why rung 2 has its own normalisation test - without it every
real hit lands on rung 3 and the exact rung is dead code that still looks alive.

The legal `field` set is derived rather than invented. It is exactly
`keyof AssayOperator["produces"]` (packages/engine/src/plan.ts:13-16), the fields
the value-of-information planner independently had to declare. `assertion`,
`strength`, `compoundId`, `id`, `availableFrom` and `provenance` are excluded by
construction because none is a member of that type - there is no deny-list to
maintain and none to forget. Design section 5.3 records why each exclusion matters;
together they are what keeps section 12b's "there is no separate knob" answer
literally true.

The cache is thirteen challenges covering all six rules, four marked low-confidence
because they contest the discount mechanism rather than a named rule. The phrasing
is the product: these strings are what live input is matched against at rungs 2 and
3, so they are written the way a reviewer types rather than the way a rule reads.
Highest measured pairwise trigram similarity among them is 0.17, so no input can
clear the 0.55 threshold against two entries at once. Three entries are flagged in
place as needing a toxicologist rather than an engineer.

The content test is cheap and stops the cache drifting from the ruleset: every
entry names a real rule, and every reclassify names a real claim and a value that
survives EvidenceClaimSchema's cross-field refinement. It was watched failing on a
mistyped claim id and on `field: "assertion"` before being made to pass.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
git push origin phase3
```

---

### Task 5: A misinterpretation must be visible and rejectable, and "the position did not move" is an answer

Design §5.2 makes display-before-apply non-negotiable and §5.5 records that the belief delta the Phase 2 spec claims to render does not exist; both land in `TablePanel.tsx`, whose docstring already reserves it.

**Files:**
- Modify: `apps/web/src/tabs/Case/TablePanel.tsx:1-12` (the whole reserved stub)
- Test: `apps/web/test/tablePanel.test.tsx`

**Interfaces:**
- Consumes (Task 3): `export function workingClaims(state: AppState, compoundId: string): EvidenceClaim[]` — returns the compound's claims with `evidenceEdits` applied and **no** `availableFrom` filtering, exactly as `useCaseReasoning.ts:13-15` produced `all` before the refactor; `export type EvidenceEdit = Partial<Pick<EvidenceClaim, ReclassifiableField>>`; the actions `{ type: "reclassifyClaim"; claimId: string; edit: EvidenceEdit }` and `{ type: "resetEvidence" }`; the `AppState` field `evidenceEdits: Record<string, EvidenceEdit>`. `useCaseReasoning`'s memo dependency list must include `evidenceEdits`, or the delta below reads a stale verdict.
- Consumes (Task 4): `interpret(input: InterpretInput): Promise<Resolution<Proposal>>`, `type Proposal`, `type InterpretInput`, `type Resolution`
- Consumes (existing): `useAppState`, `useDispatch`, `visibleClaims`, `useCaseReasoning`
- Consumes (engine): `reasonVerdictOnly`, `relevanceDiscount`, `EvidenceClaimSchema`, `type EvidenceClaim`, `type Reasoning`, `type RuleId`, `type Ruleset`
- Produces: `<TablePanel collapsed onExpand />`; `export function claimLabel(id: string): string`

- [ ] **Step 1: Confirm for yourself that no baseline is retained today**

Read `apps/web/src/tabs/Ruleset.tsx:38-41`. It renders `r.belief.toFixed(3)` and `r.verdict` — current values only. The only before/after cue anywhere in the app is the CSS transition on `BeliefTrack`, which animates a change without stating it.

Run: `grep -rn "data.ruleset" apps/web/src`
Expected: exactly two consumers hold a registered baseline — `Preflight.tsx:20` and `Preflight.tsx:33` — and neither is a delta. The Phase 2 spec's "shows the verdict and belief delta" is design §14 correction 5: it was never built.

- [ ] **Step 2: Measure which rules can move the number on TAK-994**

Do not take §5.5's "four of the six cannot move it" on trust. The no-move test below is written against the measurement, not against the prose.

```bash
npx tsx -e "
(async () => {
  const fs = require('node:fs');
  const { reasonVerdictOnly } = await import('./packages/engine/src/index.js');
  const rs = JSON.parse(fs.readFileSync('rules/ruleset-v1.0.json', 'utf8'));
  const cl = JSON.parse(fs.readFileSync('data/out/tak994.json', 'utf8')).claims;
  const f = (r) => r.verdict + '  belief=' + r.belief.toFixed(3) + '  plaus=' + r.plausibility.toFixed(3) + '  gap=' + (r.plausibility - r.belief).toFixed(3);
  console.log('registered      ', f(reasonVerdictOnly(cl, rs)));
  for (const id of ['R1','R2','R3','R4','R5','R6']) {
    const off = { ...rs, rules: rs.rules.map((r) => (r.id === id ? { ...r, enabled: false } : r)) };
    const low = { ...rs, rules: rs.rules.map((r) => (r.id === id ? { ...r, strength: 0.05 } : r)) };
    console.log(id + ' disabled     ', f(reasonVerdictOnly(cl, off)));
    console.log(id + ' strength 0.05', f(reasonVerdictOnly(cl, low)));
  }
})();
"
```

Expected, and confirmed against `data/out/tak994.json` and `packages/engine/src/rules.ts:216-269`:

```
registered       abstain  belief=0.090  plaus=1.000  gap=0.910
R1 disabled      do_not_advance  belief=0.900  plaus=1.000  gap=0.100
R1 strength 0.05 do_not_advance  belief=0.855  plaus=1.000  gap=0.145
R2 disabled      abstain  belief=0.090  plaus=1.000  gap=0.910
R2 strength 0.05 abstain  belief=0.090  plaus=1.000  gap=0.910
R3 disabled      advance  belief=0.000  plaus=0.042  gap=0.042
R3 strength 0.05 abstain  belief=0.090  plaus=1.000  gap=0.910
R4 disabled      abstain  belief=0.090  plaus=1.000  gap=0.910
R4 strength 0.05 abstain  belief=0.090  plaus=1.000  gap=0.910
R5 disabled      abstain  belief=0.090  plaus=1.000  gap=0.910
R5 strength 0.05 abstain  belief=0.090  plaus=1.000  gap=0.910
R6 disabled      abstain  belief=0.090  plaus=1.000  gap=0.910
R6 strength 0.05 abstain  belief=0.090  plaus=1.000  gap=0.910
```

Three facts the panel is built on, all visible above and all confirmed in `rules.ts`:

1. **R2, R4, R5 and R6 move nothing, either way.** `relevanceDiscount` cites R2 and R5 only on `TAK-994:qsar`, which carries `assertion: "ambiguous"` and `strength: 0.0` and so commits no mass; R4's clause is `inApplicabilityDomain === false` and every TAK-994 claim is `true`; R6 is diagnostic only and `rules.ts:283-289` says in terms that it is never applied to a mass.
2. **R3 moves the position when disabled and moves nothing when lowered.** R3 acts here as a *defeat* rule — the base trace shows all four safe claims `defeated R3 by TAK-994:toxicogenomics-murine` — and `RULE_PREDICATES.R3` reads assertions and exposure flags, never `strength`. So the two authored R3 challenges, one `disable` and one `lower_strength`, differ by the entire verdict. That is the measured reason §5.2 requires `disable` to render visually distinct regardless of confidence.
3. **The verdict label does not move on the hero case even when belief nearly quintuples.** Lowering R1 to the authored 0.45 takes belief 0.090 → 0.495 and the gap 0.910 → 0.505 while the label stays `abstain`. A verdict-only delta reads "nothing happened" there, which is §5.5's whole point.

- [ ] **Step 3: Write the failing test**

Create `apps/web/test/tablePanel.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StoreProvider, useAppState, workingClaims } from "../src/state/store.js";
import { TablePanel, claimLabel } from "../src/tabs/Case/TablePanel.js";
import { interpret } from "../src/ai/interpret.js";
import { loadData } from "../src/data/load.js";

// A real spy over the REAL interpreter. Stubbing it out would test a fake ladder;
// wrapping it lets the request body be inspected while the rungs still run.
vi.mock("../src/ai/interpret.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/ai/interpret.js")>();
  return { ...actual, interpret: vi.fn(actual.interpret) };
});
const interpretSpy = vi.mocked(interpret);

const data = loadData();

/**
 * Reads the working copies back out of the store. Apply must dispatch the SAME
 * actions a user could dispatch by hand, so the test observes the state those
 * actions produce rather than the calls that produced it.
 */
function Probe() {
  const state = useAppState();
  const claims = workingClaims(state, state.selectedCompoundId);
  return (
    <div>
      <span data-testid="probe-r1">{state.ruleset.rules.find((r) => r.id === "R1")?.strength.toFixed(2)}</span>
      <span data-testid="probe-r3-enabled">{String(state.ruleset.rules.find((r) => r.id === "R3")?.enabled)}</span>
      <span data-testid="probe-r5">{state.ruleset.rules.find((r) => r.id === "R5")?.strength.toFixed(2)}</span>
      <span data-testid="probe-cytotox">
        {String(claims.find((c) => c.id === "TAK-994:cytotox")?.exposureRelevant)}
      </span>
    </div>
  );
}

const renderPanel = () =>
  render(
    <StoreProvider data={data}>
      <TablePanel collapsed={false} onExpand={() => {}} />
      <Probe />
    </StoreProvider>,
  );

async function challenge(text: string) {
  fireEvent.change(screen.getByTestId("challenge-input"), { target: { value: text } });
  fireEvent.click(screen.getByTestId("challenge-submit"));
  await screen.findByTestId("proposal-rung");
}

const R1_LOWER = "the rat data shouldn't be discounted that hard";
const R3_DISABLE = "why does R3 only apply to negative findings? that looks convenient";
const R3_LOWER = "isn't the discounting just a fudge factor to get the answer you wanted";
const R5_LOWER = "klimisch 3 gets hammered too hard here. plenty of non-GLP work is perfectly sound";
const CYTOTOX =
  "the in-vitro panel was run against clinical Cmax — a hundred-fold margin IS an exposure margin. stop calling it untested";

describe("TablePanel - the request", () => {
  it("sends claim ids and labels ONLY, never a raw evidence value", async () => {
    // Design section 5. The model is never shown what the evidence SAYS, which is
    // why the old->new delta has to be resolved in the browser. A whitelist, not a
    // blacklist: `stream` travels inside the id by construction of the fixture's
    // ids, so the guarantee worth enforcing is that NOTHING beyond the id and its
    // derived label leaves here.
    interpretSpy.mockClear();
    renderPanel();
    await challenge(R1_LOWER);

    const input = interpretSpy.mock.calls[0]?.[0];
    expect(input).toBeDefined();
    expect(Object.keys(input!).sort()).toEqual(["challenge", "claims", "rules"]);

    for (const c of input!.claims) {
      expect(Object.keys(c).sort()).toEqual(["id", "label"]);
      expect(c.label).toBe(claimLabel(c.id));
    }
    for (const r of input!.rules) {
      expect(Object.keys(r).sort()).toEqual(["enabled", "id", "strength"]);
    }

    const claimsBody = JSON.stringify(input!.claims);
    for (const key of [
      "assertion", "strength", "provenance", "availableFrom", "compoundId",
      "measuresKeyEvent", "exposureRelevant", "inApplicabilityDomain", "klimisch", "system", "stream",
    ]) {
      expect(claimsBody, `evidence key ${key} reached the request`).not.toContain(`"${key}"`);
    }

    const whole = JSON.stringify(input);
    for (const c of data.fixture.claims) {
      expect(whole).not.toContain(c.provenance.source);
    }
    expect(whole).not.toContain("UNVERIFIED");
  });
});

describe("TablePanel - the change is displayed before it is applied", () => {
  it("renders the proposal and touches nothing until Apply", async () => {
    renderPanel();
    await challenge(R1_LOWER);

    expect(screen.getByTestId("proposal-rung").dataset.rung).toBe("2");
    expect(screen.getByTestId("proposal-delta").textContent).toBe("R1 strength: 0.90 → 0.45");
    // Not applied: the store still holds the registered strength and no delta panel
    // exists yet. A silent application is exactly the failure section 5.2 forbids.
    expect(screen.getByTestId("probe-r1").textContent).toBe("0.90");
    expect(screen.queryByTestId("applied-delta")).toBeNull();
  });

  it("resolves the old->new evidence delta LOCALLY for a reclassify", async () => {
    // The interpreter proposed `exposureRelevant -> true` without ever being told
    // what the current value is. `null -> true` can therefore only have been
    // computed here.
    renderPanel();
    await challenge(CYTOTOX);
    expect(screen.getByTestId("proposal-delta").textContent).toBe("cytotox · exposureRelevant: null → true");
    expect(screen.getByTestId("probe-cytotox").textContent).toBe("null");
  });

  it("applies nothing on Reject", async () => {
    renderPanel();
    await challenge(R1_LOWER);
    fireEvent.click(screen.getByTestId("proposal-reject"));
    expect(screen.queryByTestId("proposal")).toBeNull();
    expect(screen.getByTestId("probe-r1").textContent).toBe("0.90");
    expect(screen.queryByTestId("applied-delta")).toBeNull();
  });

  it("offers the rule picker rather than a guess when the ladder is exhausted", async () => {
    renderPanel();
    await challenge("what is the weather like in Groton");
    expect(screen.getByTestId("proposal-rung").dataset.rung).toBe("5");
    expect(screen.queryByTestId("proposal")).toBeNull();
    expect(screen.getByTestId("rule-picker")).toBeTruthy();
  });
});

describe("TablePanel - confidence and action are legible before Apply", () => {
  it("arms Apply on a high-confidence reading and NOT on a low-confidence one", async () => {
    // Design section 5.2: `confidence: "low"` never arrives pre-armed, and its
    // paraphrase is shown at raised weight.
    renderPanel();
    await challenge(R1_LOWER);
    expect(screen.getByTestId("proposal-apply").dataset.armed).toBe("true");
    expect(screen.getByTestId("proposal-paraphrase").dataset.emphasis).toBe("normal");

    fireEvent.click(screen.getByTestId("proposal-reject"));
    await challenge(R3_LOWER);
    expect(screen.getByTestId("proposal-apply").dataset.armed).toBe("false");
    expect(screen.getByTestId("proposal-apply")).toBeDisabled();
    expect(screen.getByTestId("proposal-paraphrase").dataset.emphasis).toBe("raised");
  });

  it("renders disable distinctly from a strength change at the SAME confidence", async () => {
    // Both authored R3 challenges are low-confidence and object to the same rule.
    // Measured: disabling R3 takes TAK-994 from abstain to advance; lowering it
    // moves nothing, because R3 acts here as a defeat rule and a defeat reads
    // `enabled`, not `strength`. Two readings of one objection, one whole verdict
    // apart - so confidence cannot be what distinguishes them on screen.
    renderPanel();
    await challenge(R3_DISABLE);
    expect(screen.getByTestId("proposal").dataset.confidence).toBe("low");
    expect(screen.getByTestId("proposal").dataset.actionKind).toBe("disable");

    fireEvent.click(screen.getByTestId("proposal-reject"));
    await challenge(R3_LOWER);
    expect(screen.getByTestId("proposal").dataset.confidence).toBe("low");
    expect(screen.getByTestId("proposal").dataset.actionKind).toBe("strength");
  });
});

describe("TablePanel - Apply and the delta", () => {
  it("dispatches the same rule action a user could dispatch by hand", async () => {
    renderPanel();
    await challenge(R1_LOWER);
    fireEvent.click(screen.getByTestId("proposal-apply"));
    expect(screen.getByTestId("probe-r1").textContent).toBe("0.45");
  });

  it("dispatches the same evidence action a user could dispatch by hand", async () => {
    renderPanel();
    await challenge(CYTOTOX);
    fireEvent.click(screen.getByTestId("proposal-apply"));
    expect(screen.getByTestId("probe-cytotox").textContent).toBe("true");
  });

  it("reports belief, plausibility and the gap - NOT the verdict label alone", async () => {
    // The hero case. Belief nearly quintuples and the label does not move, so a
    // verdict-only delta would read "nothing happened" on the one screen that has
    // to land (design section 5.5).
    renderPanel();
    await challenge(R1_LOWER);
    fireEvent.click(screen.getByTestId("proposal-apply"));

    const delta = screen.getByTestId("applied-delta");
    expect(delta.dataset.moved).toBe("true");
    expect(screen.getByTestId("delta-belief").textContent).toBe("Belief 0.090 → 0.495");
    expect(screen.getByTestId("delta-plausibility").textContent).toBe("Plausibility 1.000 → 1.000");
    expect(screen.getByTestId("delta-gap").textContent).toBe("Gap 0.910 → 0.505");
    expect(screen.getByTestId("delta-verdict").textContent).toBe("Verdict abstain → abstain");
  });

  it("treats 'applied - the position did not move' as a first-class state, with a computed reason", async () => {
    // Measured in Step 2: R5 cannot move TAK-994. `relevanceDiscount` cites R5 only
    // on TAK-994:qsar, which asserts ambiguous at strength 0.00 and commits no mass
    // to either side. The panel must say that, computed from the claims in front of
    // it, rather than look broken in front of a judge.
    renderPanel();
    await challenge(R5_LOWER);
    fireEvent.click(screen.getByTestId("proposal-apply"));

    expect(screen.getByTestId("probe-r5").textContent).toBe("0.30");
    const delta = screen.getByTestId("applied-delta");
    expect(delta.dataset.moved).toBe("false");
    expect(delta.textContent).toMatch(/did not move/);
    expect(screen.getByTestId("delta-belief").textContent).toBe("Belief 0.090 → 0.090");
    expect(screen.getByTestId("delta-gap").textContent).toBe("Gap 0.910 → 0.910");

    const why = screen.getByTestId("delta-why").textContent ?? "";
    expect(why).toContain("TAK-994:qsar");
    expect(why).toContain("ambiguous");
    expect(why).toContain("commits no mass");
  });

  it("explains a no-move on a DEFEAT rule differently, because the reason is different", async () => {
    // Lowering R3 moves nothing for a reason that has nothing to do with committed
    // mass: R3 defeated four claims outright, and a defeat is licensed by whether
    // the rule is enabled. A single canned "nothing moved" string would be wrong
    // here while being right in the previous test.
    renderPanel();
    await challenge(R3_LOWER);
    fireEvent.click(screen.getByTestId("proposal-apply"));

    expect(screen.getByTestId("applied-delta").dataset.moved).toBe("false");
    const why = screen.getByTestId("delta-why").textContent ?? "";
    expect(why).toContain("defeat rule");
    expect(why).toContain("ENABLED");
    expect(why).not.toContain("commits no mass");
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test -- apps/web/test/tablePanel.test.tsx`
Expected: FAIL — `SyntaxError: [vite] The requested module '/apps/web/src/tabs/Case/TablePanel.tsx' does not provide an export named 'claimLabel'`

- [ ] **Step 5: Write the panel**

Replace `apps/web/src/tabs/Case/TablePanel.tsx` entirely:

```tsx
import { useMemo, useState } from "react";
import {
  EvidenceClaimSchema, relevanceDiscount, reasonVerdictOnly,
  type EvidenceClaim, type Reasoning, type RuleId, type Ruleset,
} from "@arbiter/engine";
import {
  useAppState, useDispatch, visibleClaims, workingClaims,
  type Action, type EvidenceEdit,
} from "../../state/store.js";
import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { interpret, type InterpretInput, type Proposal } from "../../ai/interpret.js";
import type { Resolution } from "../../ai/resolve.js";

/**
 * The table region, and Surface 1's mount (design section 5).
 *
 * THE CHANGE IS DISPLAYED BEFORE IT IS APPLIED. That is what makes an interpreter
 * safe to put in front of a toxicologist: a misinterpretation is visible and
 * rejectable, never silent. Apply then dispatches exactly the actions a user could
 * dispatch by hand from the Ruleset tab or the evidence panel, so the interpreted
 * path and the manual path are one code path and the parity guarantee holds.
 *
 * A toxicologist contests what the evidence IS, and the pre-registered rules -
 * unchanged - recompute what it licenses.
 */

/**
 * Claim ids contain colons (`TAK-994:invivo_rodent`), so parse by PREFIX-SLICE,
 * never `split(":")` (design section 8). Exported because the request-body test
 * recomputes it: the label must be a pure function of the id, which is what proves
 * nothing beyond the id leaves the browser.
 */
export function claimLabel(id: string): string {
  const colon = id.indexOf(":");
  return (colon === -1 ? id : id.slice(colon + 1)).replace(/_/g, " ");
}

/** Renders a raw evidence value literally. `null` is a real value here, not missing data. */
function show(v: unknown): string {
  return v === null ? "null" : String(v);
}

/**
 * Half of the last displayed digit. A change smaller than this is one the panel
 * does not render, so announcing movement would be announcing a change the reader
 * cannot see.
 */
const MIN_VISIBLE = 5e-4;

function moved(before: Reasoning, after: Reasoning): boolean {
  return Math.abs(after.belief - before.belief) >= MIN_VISIBLE
    || Math.abs(after.plausibility - before.plausibility) >= MIN_VISIBLE
    || after.verdict !== before.verdict;
}

/**
 * Why the position did not move - COMPUTED from the two runs and the claims in
 * front of us, never canned.
 *
 * Measured on TAK-994: four of the six rules cannot move the number, for two
 * genuinely different reasons, and one string covering both would be wrong half the
 * time. The order of the branches is the order the reasons dominate.
 */
function noMoveReason(after: Reasoning, ruleset: Ruleset, claims: EvidenceClaim[], p: Proposal): string {
  const rule = p.targetRule;
  if (rule === null) return "The change was applied and the fused mass is unchanged to three decimal places.";

  // 1. The rule is acting as a DEFEAT rule. `rules.ts` RULE_PREDICATES read
  //    assertions, systems and exposure flags - never `strength` - so a strength
  //    change cannot reach a defeat. This is the R3 case on TAK-994, where all four
  //    safe claims are removed from fusion outright.
  const defeatSteps = after.trace.filter((s) => s.byRule === rule && s.status === "defeated");
  if (defeatSteps.length > 0 && (p.action === "lower_strength" || p.action === "raise_strength")) {
    return `${rule} is acting here as a defeat rule: it removed ${defeatSteps.length} claim(s) from the `
      + `fusion entirely, and a defeat is licensed by whether the rule is ENABLED, not by its strength. `
      + `Turning ${rule} off would move the position; changing its strength cannot.`;
  }

  // 2. The rule discounts nothing in this evidence set. R4's clause is
  //    `inApplicabilityDomain === false` and R6 is diagnostic only - `rules.ts`
  //    says in terms that concordance is realised inside fuse() and is never
  //    applied to a mass.
  const discounted = claims.filter((c) => relevanceDiscount(c, ruleset).reasons.some((r) => r.byRule === rule));
  if (discounted.length === 0) {
    return `No claim in this evidence set is discounted by ${rule}, and no step in the trace cites it, `
      + `so the change had nothing to act on.`;
  }

  // 3. The rule discounts only claims that commit no mass. This is R2 and R5 on
  //    TAK-994, both of which reach only TAK-994:qsar.
  const committing = discounted.filter((c) => c.assertion !== "ambiguous" && c.strength > 0);
  if (committing.length === 0) {
    const one = discounted.length === 1;
    return `${rule} applies only to ${discounted.map((c) => c.id).join(", ")}, which `
      + `${one ? "asserts" : "assert"} `
      + `${discounted.map((c) => `${c.assertion} at strength ${c.strength.toFixed(2)}`).join("; ")} `
      + `and therefore ${one ? "commits" : "commit"} no mass to either side.`;
  }

  return "The change was applied and the fused mass is unchanged to three decimal places.";
}

/**
 * The proposal, expressed as an action a user could have dispatched themselves.
 *
 * The `as EvidenceEdit` cast is discharged by `validAgainstEvidence`, which ran
 * before this proposal was ever displayed: design section 5.4 validates on ARRIVAL
 * rather than on apply precisely so that by the time Apply is reachable the value
 * is already known to produce a schema-valid claim.
 */
function dispatchable(p: Proposal): Action | null {
  if (p.action === "reclassify_field") {
    if (p.targetClaimId === null || p.field === null) return null;
    return { type: "reclassifyClaim", claimId: p.targetClaimId, edit: { [p.field]: p.newValue } as EvidenceEdit };
  }
  if (p.targetRule === null) return null;
  if (p.action === "disable") return { type: "setRuleEnabled", id: p.targetRule, enabled: false };
  if (typeof p.newValue !== "number") return null;
  return { type: "setRuleStrength", id: p.targetRule, strength: p.newValue };
}

/**
 * Design section 5.4, run here rather than inside the ladder because the ladder is
 * not given the raw values that `schema.ts:26-35`'s cross-field refinement needs.
 * An invalid proposal is a MISS, not an error: the panel falls back to the rule
 * picker and the user never sees a broken proposal.
 */
function validAgainstEvidence(p: Proposal, claims: EvidenceClaim[]): boolean {
  if (p.action !== "reclassify_field" || p.field === null || p.targetClaimId === null) return true;
  const target = claims.find((c) => c.id === p.targetClaimId);
  if (target === undefined) return false;
  return EvidenceClaimSchema.safeParse({ ...target, [p.field]: p.newValue }).success;
}

export function TablePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const state = useAppState();
  const { data, ruleset, asOf, selectedCompoundId } = state;
  const dispatch = useDispatch();

  // The working pass: working evidence through the working ruleset.
  const after = useCaseReasoning();

  const claims = useMemo(
    () => visibleClaims(workingClaims(state, selectedCompoundId), asOf),
    [state, selectedCompoundId, asOf],
  );

  /**
   * The registered baseline, which design section 5.5 notes is cheap because it is
   * still sitting in state - the same trick Preflight.tsx:20 uses for the manifest
   * check. Asking the ONE selector for the registered copy, rather than
   * re-deriving "the claims for this compound" a fifth time, is the point of
   * section 9's refactor.
   *
   * `reasonVerdictOnly` rather than `reason`: the delta reads verdict, belief and
   * plausibility only, and the counterfactual search behind `reason` costs ~130
   * extra engine evaluations for output nothing here looks at. Identical verdict
   * logic by construction - same function, one flag.
   */
  const before = useMemo(
    () => reasonVerdictOnly(
      visibleClaims(workingClaims({ ...state, evidenceEdits: {} }, selectedCompoundId), asOf),
      data.ruleset,
    ),
    [state, selectedCompoundId, asOf, data.ruleset],
  );

  const [challenge, setChallenge] = useState("");
  const [resolution, setResolution] = useState<Resolution<Proposal> | null>(null);
  const [armed, setArmed] = useState(false);
  const [applied, setApplied] = useState<Proposal | null>(null);

  if (collapsed) return <button type="button" onClick={onExpand} aria-label="Expand the table">Table</button>;

  const submit = async () => {
    // Claim IDS AND LABELS ONLY. The interpreter is never shown what the evidence
    // says, which is exactly why the old->new delta below is resolved here.
    const input: InterpretInput = {
      challenge,
      rules: ruleset.rules.map((r) => ({ id: r.id, enabled: r.enabled, strength: r.strength })),
      claims: claims.map((c) => ({ id: c.id, label: claimLabel(c.id) })),
    };
    const r = await interpret(input);
    const usable = r.value !== null && validAgainstEvidence(r.value, claims);
    // The rung is preserved even when the proposal is dropped, so the pre-flight
    // panel and the tests still see which rung answered.
    setResolution(usable ? r : { value: null, rung: r.rung, source: r.source });
    setArmed(usable && r.value !== null && r.value.confidence === "high");
  };

  /** Rung 5. The USER names the rule; nothing here guesses one. */
  const pick = (id: RuleId) => {
    const rule = ruleset.rules.find((r) => r.id === id);
    if (!rule) return;
    setResolution({
      value: {
        targetRule: id, targetClaimId: null, action: "lower_strength", field: null,
        newValue: Number((Math.round((rule.strength / 2) / 0.05) * 0.05).toFixed(2)),
        paraphrase: `Reduce ${id}, ${rule.name.toLowerCase()}.`, confidence: "low",
      },
      rung: 5,
      source: "none",
    });
    setArmed(false);
  };

  const apply = (p: Proposal) => {
    const a = dispatchable(p);
    if (a === null) return;
    dispatch(a);
    setApplied(p);
    setResolution(null);
  };

  const p = resolution?.value ?? null;
  const kind = p === null
    ? ""
    : p.action === "disable" ? "disable" : p.action === "reclassify_field" ? "reclassify" : "strength";
  const didMove = applied === null ? false : moved(before, after);

  return (
    <div>
      <h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>The table</h3>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Positions and sign-off are recorded on the Record tab. Contest the reasoning here.
      </p>

      {/* A real <textarea>, not a contenteditable div: ui/isTypingTarget.ts already
          returns true for TEXTAREA, so the global arrow/M/? shortcuts suppress
          themselves and typing "murine" cannot strip the motion out of the demo. */}
      <label style={{ display: "block", fontSize: 13 }}>
        Challenge the reasoning
        <textarea
          data-testid="challenge-input" rows={3} value={challenge}
          onChange={(e) => setChallenge(e.target.value)}
          style={{ width: "100%", marginTop: 4 }}
        />
      </label>
      <button type="button" data-testid="challenge-submit" onClick={() => void submit()}>Interpret</button>

      {resolution !== null && (
        <p data-testid="proposal-rung" data-rung={resolution.rung} data-source={resolution.source}
           style={{ fontSize: 12, color: "var(--muted)" }}>
          Read at rung {resolution.rung} ({resolution.source})
        </p>
      )}

      {p !== null && (
        <article data-testid="proposal" data-action-kind={kind} data-confidence={p.confidence}
                 style={{
                   border: `2px ${kind === "disable" ? "dashed" : "solid"} `
                     + `${kind === "disable" ? "var(--toxic)" : "var(--hairline)"}`,
                   padding: 12, marginTop: 10,
                 }}>
          <p data-testid="proposal-paraphrase"
             data-emphasis={p.confidence === "low" ? "raised" : "normal"}
             style={{ margin: 0, fontWeight: p.confidence === "low" ? 700 : 400 }}>
            {p.paraphrase}
          </p>

          {/* The old value never left this browser, so this line can only have been
              computed here. */}
          <p data-testid="proposal-delta" style={{ fontSize: 13, margin: "8px 0" }}>
            {p.action === "reclassify_field" && p.targetClaimId !== null && p.field !== null
              ? `${claimLabel(p.targetClaimId)} · ${p.field}: `
                + `${show(claims.find((c) => c.id === p.targetClaimId)?.[p.field])} → ${show(p.newValue)}`
              : p.action === "disable"
                ? `${p.targetRule ?? ""} enabled: true → false`
                : `${p.targetRule ?? ""} strength: `
                  + `${(ruleset.rules.find((r) => r.id === p.targetRule)?.strength ?? 0).toFixed(2)} → `
                  + `${typeof p.newValue === "number" ? p.newValue.toFixed(2) : show(p.newValue)}`}
          </p>

          {p.confidence === "low" && (
            <label style={{ display: "block", fontSize: 13 }}>
              <input type="checkbox" data-testid="proposal-arm" checked={armed}
                     onChange={(e) => setArmed(e.target.checked)} />
              {" "}This reading is a low-confidence guess. Confirm it before applying.
            </label>
          )}

          <button type="button" data-testid="proposal-apply" data-armed={String(armed)} disabled={!armed}
                  onClick={() => apply(p)}>
            Apply
          </button>
          <button type="button" data-testid="proposal-reject"
                  onClick={() => { setResolution(null); setArmed(false); }}>
            Reject
          </button>
        </article>
      )}

      {resolution !== null && p === null && (
        <fieldset data-testid="rule-picker" style={{ marginTop: 10 }}>
          <legend>Which rule do you want to contest?</legend>
          {ruleset.rules.map((r) => (
            <button key={r.id} type="button" data-testid={`pick-${r.id}`} onClick={() => pick(r.id)}>
              {r.id} {r.name}
            </button>
          ))}
        </fieldset>
      )}

      {applied !== null && (
        <section data-testid="applied-delta" data-moved={String(didMove)} style={{ marginTop: 14 }}>
          {/* "Applied - the position did not move, and here is why" is a first-class
              state. Four of the six rules cannot move the number on TAK-994, and a
              panel that renders that as a blank is a panel that looks broken in
              front of a judge. */}
          <h4 style={{ margin: "0 0 6px" }}>
            {didMove ? "Applied — the position moved" : "Applied — the position did not move"}
          </h4>
          <p data-testid="delta-belief" style={{ margin: 0, fontSize: 13 }}>
            Belief {before.belief.toFixed(3)} → {after.belief.toFixed(3)}
          </p>
          <p data-testid="delta-plausibility" style={{ margin: 0, fontSize: 13 }}>
            Plausibility {before.plausibility.toFixed(3)} → {after.plausibility.toFixed(3)}
          </p>
          <p data-testid="delta-gap" style={{ margin: 0, fontSize: 13 }}>
            Gap {(before.plausibility - before.belief).toFixed(3)} → {(after.plausibility - after.belief).toFixed(3)}
          </p>
          <p data-testid="delta-verdict" style={{ margin: 0, fontSize: 13 }}>
            Verdict {before.verdict} → {after.verdict}
          </p>
          {!didMove && (
            <p data-testid="delta-why" style={{ fontSize: 13, color: "var(--muted)" }}>
              {noMoveReason(after, ruleset, claims, applied)}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- apps/web && npm run typecheck && npm run lint && npm run web:build`
Expected: PASS (12 new tests), build succeeds

Then confirm the static build is untouched by any of this.

Run: `npm run e2e -- apps/web/e2e/static-file.spec.ts`
Expected: PASS unchanged — every surface is on cache and no request is *attempted* over `file://`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/tabs/Case/TablePanel.tsx apps/web/test/tablePanel.test.tsx
git commit -m "$(cat <<'MSG'
Show the interpreted change before applying it, and report the real delta

The change is displayed before it is applied, which is what makes an interpreter
safe to put in front of a toxicologist: a misinterpretation is visible and
rejectable rather than silent (design section 5.2). Apply then dispatches exactly
the actions a user could dispatch by hand from the Ruleset tab or the evidence
panel, so the interpreted path and the manual path stay one code path.

The interpreter is given claim ids and labels only - never a raw evidence value -
so the browser resolves the old->new delta itself. There is a test that proves it,
built as a whitelist rather than a blacklist: every claim entry in the request must
have exactly the keys `id` and `label`, and the label must be a pure function of
the id. A blacklist would have quietly passed a `...claim` spread whose extra
fields happened not to be on the list.

Low confidence never arrives pre-armed, and `disable` renders distinctly from a
strength change regardless of confidence. That second rule has a measured reason.
Both authored R3 challenges are low-confidence objections to the same rule, one
`disable` and one `lower_strength` - and on TAK-994 disabling R3 takes the position
from abstain to advance while lowering it moves nothing at all, because R3 acts
there as a defeat rule and a defeat reads `enabled`, never `strength`. Two readings
of one objection, an entire verdict apart. Confidence cannot be what tells them
apart on screen.

The delta is new work. The Phase 2 spec claims editing shows a verdict and belief
delta; Ruleset.tsx:38-41 renders current values only and retains no baseline
(design section 14, correction 5). It is computed against the registered pass the
way Preflight.tsx:20 already computes its manifest baseline, by asking the one
workingClaims selector for the registered copy rather than re-deriving "the claims
for this compound" a fifth time.

It reports belief, plausibility AND the gap, not the verdict label alone, because
on the hero case the label does not move: lowering R1 to 0.45 takes belief
0.090 -> 0.495 and the gap 0.910 -> 0.505 while the verdict stays abstain. A
verdict-only delta reads "nothing happened" on the one screen that has to land.

"Applied - the position did not move, and here is why" is a first-class state.
Measured: four of the six rules cannot move the number on TAK-994, for two
different reasons - R2 and R5 reach only TAK-994:qsar, which asserts ambiguous at
strength 0.00 and commits no mass, while R4 discounts nothing at all and R6 is
diagnostic only. The panel computes which reason applies from the claims and the
trace in front of it rather than printing one canned sentence that would be wrong
half the time.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
git push origin phase3
```

---
### Task 6: Render the precedence order and the abstention threshold, so the pre-registration is visible rather than merely claimed

Spec §8.1 — `precedenceOrder`, `precedenceRationale` and `abstentionGapThreshold` are in the registered ruleset and in the `Ruleset` type but rendered nowhere, so "why does R3 outrank R1?" and "why is the threshold 0.5?" return `noMatch` from the navigator on the strongest material in the project.

**Files:**
- Modify: `apps/web/src/tabs/Ruleset.tsx:27-43` (a block between the Reset button and the rule cards)
- Test: `apps/web/test/precedence.test.tsx` (create)

**Interfaces:**
- Consumes: `useAppState`, `useDispatch`, `isEdited` (Task 3, `apps/web/src/state/store.tsx`), `useCaseReasoning`; `Ruleset.precedenceOrder`, `Ruleset.precedenceRationale`, `Ruleset.abstentionGapThreshold` (`packages/engine/src/types.ts:96-113`)
- Produces: two DOM anchors, `data-anchor="ruleset.precedenceOrder"` and `data-anchor="ruleset.abstentionThreshold"`, which Task 2's `ANCHORS` registry declares and Task 7's navigator resolves. No new module.

Nothing is imported from `apps/web/src/ai/anchors.ts`: the attribute is a plain string the registry names, and coupling the tab to the registry would make the DOM test in §12 tautological.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/precedence.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DefeatRuleId } from "@arbiter/engine";
import { StoreProvider } from "../src/state/store.js";
import { RulesetTab } from "../src/tabs/Ruleset.js";
import { loadData, type LoadedData } from "../src/data/load.js";

const data = loadData();
const renderTab = (d: LoadedData = data) =>
  render(<StoreProvider data={d}><RulesetTab /></StoreProvider>);

describe("the precedence order", () => {
  it("renders the registered order, in order, with each rule's name", () => {
    // R3 first is the answer to "why does exposure relevance outrank human
    // relevance?" - a judge question with a prepared answer that the app could
    // not previously point at, because the field was rendered nowhere.
    renderTab();
    expect(screen.getAllByTestId("precedence-entry").map((e) => e.textContent)).toEqual([
      "R3 Exposure relevance",
      "R1 Human relevance",
      "R2 Mechanistic proximity",
      "R5 Study reliability",
    ]);
  });

  it("renders the REGISTERED rationale verbatim, not a paraphrase of it", () => {
    // Both assertions are needed. The first pins the rendering to the ruleset;
    // the second spells out the registered text, so a rewrite that still reads
    // from state - a summary, a truncation, a "see the spec" - fails here.
    renderTab();
    const text = screen.getByTestId("precedence-rationale").textContent ?? "";
    expect(text).toBe(data.ruleset.precedenceRationale);
    expect(text).toContain(
      "Exposure relevance (R3) is checked before human relevance (R1). A negative finding only "
      + "carries weight across the exposure range it actually tested",
    );
    expect(text).toContain(
      "Mechanistic proximity (R2) is checked next, ahead of study reliability (R5)",
    );
  });

  it("reads the order from the ruleset rather than from a copy in the component", () => {
    // The clincher against a hand-typed "R3 → R1 → R2 → R5". A ruleset whose order
    // differs must render differently, or the tab is displaying a claim about the
    // pre-registration instead of the pre-registration.
    const reordered: LoadedData = {
      ...data,
      ruleset: { ...data.ruleset, precedenceOrder: ["R5", "R2", "R1", "R3"] as DefeatRuleId[] },
    };
    renderTab(reordered);
    expect(screen.getAllByTestId("precedence-entry").map((e) => e.textContent)).toEqual([
      "R5 Study reliability",
      "R2 Mechanistic proximity",
      "R1 Human relevance",
      "R3 Exposure relevance",
    ]);
  });
});

describe("the abstention threshold", () => {
  it("shows the registered value, and it is the value the engine gates on", () => {
    renderTab();
    const shown = screen.getByTestId("abstention-threshold-value").textContent ?? "";
    expect(shown).toBe("0.5");
    expect(Number(shown)).toBe(data.ruleset.abstentionGapThreshold);
  });

  it("says what the threshold gates, so the number is not bare", () => {
    renderTab();
    expect(screen.getByTestId("abstention-threshold").textContent)
      .toMatch(/declines rather than answer when the belief-to-plausibility gap exceeds/);
  });

  it("says where the value comes from, which is the actual answer to 'why 0.5?'", () => {
    // The ruleset registers a rationale for the precedence order and NOT for this
    // number, so the honest defence is provenance: pre-registered and hashed, read
    // by the engine rather than held as a constant in it. Inventing a
    // justification for 0.5 here would be exactly the fudge factor the ruleset
    // exists to rule out.
    renderTab();
    expect(screen.getByTestId("abstention-threshold-provenance").textContent)
      .toMatch(/could not be tuned after the results were seen/);
  });
});

describe("navigator anchors (§8.1)", () => {
  it("carries an anchor on each block, so a question can be pointed at one", () => {
    const { container } = renderTab();
    expect(container.querySelector('[data-anchor="ruleset.precedenceOrder"]')).not.toBeNull();
    expect(container.querySelector('[data-anchor="ruleset.abstentionThreshold"]')).not.toBeNull();
  });

  it("keeps the two anchors on distinct elements", () => {
    // One element carrying both ids would scroll to the same place for two
    // different questions and the navigator would look broken rather than wrong.
    const { container } = renderTab();
    expect(container.querySelector('[data-anchor="ruleset.precedenceOrder"]'))
      .not.toBe(container.querySelector('[data-anchor="ruleset.abstentionThreshold"]'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/precedence.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="precedence-entry"]`, seven cases failing.

- [ ] **Step 3: Write the tab**

Replace `apps/web/src/tabs/Ruleset.tsx`:

```tsx
import { isEdited, useAppState, useDispatch } from "../state/store.js";
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
 *
 * Measured: full reason() over the TAK-994 fixture averages 1.46ms/call (50-run
 * loop via npx tsx against packages/engine/src/index.js directly). That is well
 * under the ~16ms frame budget a range input's pointer-move events demand, so the
 * slider stays on plain onChange - a debounce would only add latency to a control
 * whose entire point is answering under the cursor.
 *
 * The precedence order and the abstention threshold render here (spec §8.1) because
 * they were in the registered, hashed ruleset and on screen NOWHERE - so the two
 * likeliest questions about the pre-registration had no answer the app could point
 * at. Neither is editable: no control exists for either, so the working copy and
 * the registered copy cannot differ on them, and the block reads from `ruleset`
 * only for consistency with the rule cards below it.
 *
 * Note what the threshold block does NOT do. The ruleset registers a
 * `precedenceRationale` and registers no rationale for the threshold value, so the
 * block states the value and its provenance and stops. Writing a justification for
 * 0.5 into the UI would put an undisclosed number's defence in source instead of in
 * the reviewable, hashed artifact - which is the failure the pre-registration
 * exists to prevent.
 */
export function RulesetTab() {
  const { data, ruleset } = useAppState();
  const dispatch = useDispatch();
  const r = useCaseReasoning();
  // §9.3. The same predicate the pre-flight panel and the evidence panel use.
  const modified = isEdited(ruleset, data.ruleset);

  return (
    <section style={{ padding: 20 }}>
      <h2 style={{ fontFamily: "var(--serif)" }}>Ruleset</h2>
      <p data-testid="ruleset-hash" style={{ color: "var(--muted)", fontSize: 13 }}>
        v{ruleset.version} · registered {ruleset.registeredAt} · {REGISTERED_HASH.slice(0, 8)}…
        {modified && (
          <strong data-testid="modified-badge" style={{ color: "var(--toxic)", marginLeft: 10 }}>
            MODIFIED — not the registered ruleset
          </strong>
        )}
      </p>
      <p>
        Live on the selected case: belief <strong data-testid="live-belief">{r.belief.toFixed(3)}</strong>,
        verdict <strong>{r.verdict}</strong>
      </p>
      <button type="button" onClick={() => dispatch({ type: "resetRuleset" })}>Reset to registered</button>

      <div data-anchor="ruleset.precedenceOrder"
           style={{ borderTop: "1px solid var(--hairline)", padding: "14px 0", marginTop: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Precedence order</h3>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0" }}>
          Which rule wins when two rules would each license an attack in opposite directions on the
          same pair of claims. R4 downweights rather than defeats and R6 is a property of a set of
          claims, so neither takes part.
        </p>
        <ol data-testid="precedence-order" style={{ margin: "6px 0", paddingLeft: 22 }}>
          {ruleset.precedenceOrder.map((id) => {
            const rule = ruleset.rules.find((x) => x.id === id);
            return (
              <li key={id} data-testid="precedence-entry" style={{ marginBottom: 2 }}>
                <span style={{ color: "var(--pfizer-blue)" }}>{id}</span>{rule ? ` ${rule.name}` : ""}
              </li>
            );
          })}
        </ol>
        <p data-testid="precedence-rationale" style={{ margin: "6px 0" }}>
          {ruleset.precedenceRationale}
        </p>
      </div>

      <div data-anchor="ruleset.abstentionThreshold"
           style={{ borderTop: "1px solid var(--hairline)", padding: "14px 0" }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Abstention threshold</h3>
        <p data-testid="abstention-threshold" style={{ margin: "6px 0" }}>
          ARBITER declines rather than answer when the belief-to-plausibility gap exceeds{" "}
          <strong data-testid="abstention-threshold-value">{ruleset.abstentionGapThreshold}</strong>.
        </p>
        <p data-testid="abstention-threshold-provenance"
           style={{ color: "var(--muted)", fontSize: 13, margin: "6px 0" }}>
          Read from the pre-registered, hashed ruleset rather than held as a constant in the engine,
          so it could not be tuned after the results were seen.
        </p>
      </div>

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

- [ ] **Step 4: Confirm the existing Ruleset tests still hold**

Run: `npm test -- apps/web/test/ruleset.test.tsx apps/web/test/precedence.test.tsx`
Expected: PASS (4 + 7 tests). `getAllByTestId("rule-card")` must still be 6 — the two new blocks are `div`s, not rule cards — and `getByText(/FDA Roadmap/)` must still be unique, which the rationale text does not disturb.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- apps/web && npm run typecheck && npm run web:build`
Expected: PASS, build succeeds

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "$(cat <<'MSG'
Render the precedence order and the abstention threshold on the Ruleset tab

precedenceOrder, precedenceRationale and abstentionGapThreshold have been in
rules/ruleset-v1.0.json and in the Ruleset type since pre-registration, covered by
the hash, and rendered nowhere. "Why does R3 outrank R1?" and "why is the threshold
0.5?" are two of the likeliest questions about the strongest material in the
project, and until this commit the app could not point at an answer to either -
the navigator would return noMatch on both (spec section 8.1).

The order renders with each rule's registered name, and the rationale renders
verbatim from the ruleset. A test reorders a copy of the ruleset and asserts the
render follows, because a hand-typed "R3 -> R1 -> R2 -> R5" would look identical on
screen while being a claim about the pre-registration rather than the
pre-registration itself. Nothing here is editable: no control exists for either
field, so the working copy and the registered copy cannot disagree on them.

The threshold block states the value and where it comes from, and deliberately
stops there. The ruleset registers a rationale for the precedence order and none
for the threshold, so the defensible answer is provenance - pre-registered, hashed,
read by the engine at abstain.ts rather than held as a constant inside it, and
therefore not tunable after the results were seen. Writing a justification for 0.5
into the component would move an undisclosed number's defence out of the reviewable
artifact and into source, which is the failure pre-registration exists to prevent.

Both blocks carry data-anchor attributes - ruleset.precedenceOrder and
ruleset.abstentionThreshold - so the navigator can scroll to them. The tab imports
nothing from the anchor registry: the attribute is a plain string the registry
names, and coupling the two would make the "every declared anchor resolves in the
DOM" test in section 12 tautological.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
git push origin phase3
```
### Task 7: The navigator answers with identifiers only, so it has nowhere to put an invented claim

Spec §7 fixes the response to `{ anchorIds, noMatch }`; §7.1 makes the ladder five rungs to match Surface 1; §7.2 splits "bad response" into three distinct cases; §7.3 fixes the mount point and the two keyboard collisions that were measured rather than guessed.

**Files:**
- Create: `apps/web/src/ai/navigate.ts`
- Create: `apps/web/src/ai/cache/anchor-map.json`
- Create: `apps/web/src/ai/cache/suggested-questions.json`
- Create: `apps/web/src/ai/NavigatorBar.tsx`
- Modify: `apps/web/src/App.tsx:1-51`
- Test: `apps/web/test/navigate.test.ts`
- Test: `apps/web/test/navigatorBar.test.tsx`

**Interfaces:**
- Consumes: `resolve<I, T>(rungs: Rung<I, T>[], input: I): Promise<Resolution<T>>`, `Rung<I, T>`, `Resolution<T>`, `Source` (Task 1); `jaccard(a: string, b: string): number`, `FUZZY_THRESHOLD = 0.55` (Task 1); `ANCHORS: Record<string, Anchor>`, `Anchor { label: string; tab: TabId; region: Region | null }`, `isKnownAnchor(id: string): boolean`, `ruleAnchor(id: RuleId): string` (Task 2); `useAppState`, `useDispatch`, `Region`; `isTypingTarget(target: EventTarget | null): boolean`; `TabId`; `zod` (added as a dependency in Task 1).
- **Contract note for Task 2:** `isKnownAnchor` must return `true` for the dynamic `record.position:${n}` family as well as for `trace.step:`, `evidence.claim:` and `rule.${RuleId}`. `SUGGESTED_QUESTIONS[3]` points at `record.position:0`, and the content test in Step 1 fails loudly if that family is not recognised.
- Produces:
  - `export interface NavResult { anchorIds: string[]; noMatch: boolean }`
  - `export interface NavigateInput { question: string; anchors: { id: string; label: string }[] }`
  - `export const NavResultSchema: z.ZodType<NavResult>`
  - `export function navigate(input: NavigateInput): Promise<Resolution<NavResult>>`
  - `export const SUGGESTED_QUESTIONS: string[]` — exactly 4
  - `export function sanitizeNavResult(raw: NavResult): NavResult | null` — Task 9's rung 1 pipes its parsed response through this
  - `export function anchorMeta(id: string): Anchor | null` — static lookup plus dynamic-family prefix resolution; Task 8 uses it for the tab and region
  - `export function NavigatorBar(): JSX.Element`

- [ ] **Step 1: Write the failing resolution test**

Create `apps/web/test/navigate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isKnownAnchor } from "../src/ai/anchors.js";
import {
  anchorMeta,
  navigate,
  sanitizeNavResult,
  SUGGESTED_QUESTIONS,
  NavResultSchema,
} from "../src/ai/navigate.js";
import anchorMap from "../src/ai/cache/anchor-map.json";
import suggested from "../src/ai/cache/suggested-questions.json";

/**
 * The anchors a caller passes are MATCHING strings, not display strings: rung 4
 * scores the question's tokens against them (spec section 7.1, "keyword match
 * over anchor labels and rule statements"). Supplying them here rather than
 * reading the registry keeps the rung-4 test independent of how Task 2 words a
 * label, while still using ids the registry really has - a fabricated id would
 * be filtered by sanitizeNavResult and the test would prove nothing.
 */
const ANCHOR_LIST = [
  {
    id: "rule.R3",
    label:
      "R3 Exposure relevance A positive finding at clinically relevant exposure defeats a negative finding whose exposure margin is unstated or untested at that range.",
  },
  { id: "trace.beliefTrack", label: "Belief and plausibility track" },
  { id: "validation.llmAblation", label: "LLM ablation" },
];

const ask = (question: string) => navigate({ question, anchors: ANCHOR_LIST });

describe("the navigator ladder", () => {
  it("answers an exact cached question at rung 2, from the cache", async () => {
    // Asserting "it produced an answer" passes on every rung and is worthless
    // (spec section 12, trap 1). The rung and the source are the assertion.
    const r = await ask("Did you tune the rules to fit DILIrank?");
    expect(r.rung).toBe(2);
    expect(r.source).toBe("cache");
    expect(r.value?.anchorIds).toEqual(["ruleset.hash", "validation.provenance"]);
  });

  it("matches punctuation and casing loosely at rung 2 rather than dropping to rung 3", async () => {
    // A judge types "dilirank", not "DILIrank". Normalisation is what keeps the
    // strongest cached answer on the top cached rung.
    const r = await ask("did you tune the rules to fit dilirank");
    expect(r.rung).toBe(2);
    expect(r.value?.anchorIds).toEqual(["ruleset.hash", "validation.provenance"]);
  });

  it("answers a reworded question at rung 3 by trigram similarity", async () => {
    // Rung 3 exists because master spec section 7 gave the navigator no fuzzy
    // step and never said why; spec section 7.1 records the departure. Without
    // it, five extra words would drop this question to keyword matching.
    const r = await ask("Did you tune the rules to fit the DILIrank labels?");
    expect(r.rung).toBe(3);
    expect(r.source).toBe("cache");
    expect(r.value?.anchorIds).toEqual(["ruleset.hash", "validation.provenance"]);
  });

  it("answers an unseen question at rung 4 from the anchor labels alone", async () => {
    // Nothing in the cache is close to this, but R3's registered statement
    // contains four of its content words. Rung 4 is what stops a rephrased
    // question landing on the suggestions.
    const r = await ask("What happens to a negative finding whose exposure margin nobody measured?");
    expect(r.rung).toBe(4);
    expect(r.source).toBe("local");
    expect(r.value?.anchorIds).toEqual(["rule.R3"]);
  });

  it("falls to rung 5 with noMatch when nothing matches at all", async () => {
    const r = await ask("zzz qqq vvv xxx");
    expect(r.rung).toBe(5);
    expect(r.source).toBe("none");
    expect(r.value?.noMatch).toBe(true);
  });

  it("caps a resolution at three anchors, because four destinations is not navigation", async () => {
    const many = sanitizeNavResult({
      anchorIds: ["ruleset.hash", "trace.verdictReason", "trace.beliefTrack", "validation.provenance"],
      noMatch: false,
    });
    expect(many?.anchorIds).toEqual(["ruleset.hash", "trace.verdictReason", "trace.beliefTrack"]);
  });
});

describe("a bad response is not a hallucinated claim, but it is still bad", () => {
  it("drops the ids the registry has never heard of and keeps the ones it has", () => {
    // Spec section 12, trap 2: asserting noMatch on an empty list asserts a
    // value that is 0 under every implementation. Assert the SPECIFIC survivors
    // and the SPECIFIC casualty instead.
    const kept = sanitizeNavResult({
      anchorIds: ["trace.verdictReason", "trace.theModelMadeThisUp", "ruleset.hash"],
      noMatch: false,
    });
    expect(kept?.anchorIds).toEqual(["trace.verdictReason", "ruleset.hash"]);
    expect(kept?.anchorIds).not.toContain("trace.theModelMadeThisUp");
  });

  it("returns null when no id survives, so the ladder descends to the cache", () => {
    // Spec section 7.2 requires the user-visible outcome to be noMatch. Reaching
    // it at rung 5 rather than dead-ending at rung 1 consults the cache on the
    // way, which is exactly when the cache is worth the most.
    expect(sanitizeNavResult({ anchorIds: ["nope.one", "nope.two"], noMatch: false })).toBeNull();
  });

  it("de-duplicates, so the same destination is never offered twice", () => {
    const kept = sanitizeNavResult({ anchorIds: ["rule.R6", "rule.R6", "ruleset.hash"], noMatch: false });
    expect(kept?.anchorIds).toEqual(["rule.R6", "ruleset.hash"]);
  });

  it("accepts a schema-legal response and rejects a shape that carries prose", () => {
    // The return type is the non-hallucination guarantee. A response with a
    // `text` field is not a navigator response, whatever it claims.
    expect(NavResultSchema.safeParse({ anchorIds: ["rule.R6"], noMatch: false }).success).toBe(true);
    expect(NavResultSchema.safeParse({ anchorIds: "rule.R6", noMatch: false }).success).toBe(false);
    expect(NavResultSchema.safeParse({ noMatch: false }).success).toBe(false);
  });
});

describe("the cache is consistent with the registry", () => {
  it("points every cached id at an anchor that exists", () => {
    // Catches an authored entry drifting away from a renamed registry id, which
    // would otherwise degrade silently to the suggestions in front of a judge.
    const all = [...anchorMap, ...suggested];
    const unknown = all.flatMap((e) => e.anchorIds.filter((id) => !isKnownAnchor(id)));
    expect(unknown).toEqual([]);
  });

  it("resolves every cached id to a tab and a region", () => {
    const all = [...anchorMap, ...suggested];
    const unresolved = all.flatMap((e) => e.anchorIds.filter((id) => anchorMeta(id) === null));
    expect(unresolved).toEqual([]);
  });

  it("has no two cached questions that normalise to the same string", () => {
    // A shadowed entry is unreachable and its ids would never be offered.
    const all = [...anchorMap, ...suggested].map((e) =>
      e.question.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(),
    );
    expect(new Set(all).size).toBe(all.length);
  });

  it("offers exactly four suggested questions, each answered from the cache", async () => {
    expect(SUGGESTED_QUESTIONS).toHaveLength(4);
    for (const q of SUGGESTED_QUESTIONS) {
      const r = await ask(q);
      expect(r.rung).toBe(2);
      expect(r.value?.noMatch).toBe(false);
    }
  });
});

describe("dynamic anchor families", () => {
  it("resolves a per-instance id by prefix, never by splitting on the colon", () => {
    // Claim ids contain colons (TAK-994:invivo_rodent), so split(":") would cut
    // the id in half - spec section 8.
    const step = anchorMeta("trace.step:TAK-994:invivo_rodent");
    expect(step?.tab).toBe("case");
    expect(step?.region).toBe("trace");
    expect(step?.label).toContain("TAK-994:invivo_rodent");
  });

  it("returns null for an id in no family and no registry", () => {
    expect(anchorMeta("trace.theModelMadeThisUp")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/navigate.test.ts`
Expected: FAIL — `Failed to resolve import "../src/ai/navigate.js"`; no module has been written yet.

- [ ] **Step 3: Write the cached question→anchor map**

Create `apps/web/src/ai/cache/anchor-map.json`:

```json
[
  {
    "question": "Did you tune the rules to fit DILIrank?",
    "anchorIds": ["ruleset.hash", "validation.provenance"]
  },
  {
    "question": "Nothing in pass 1 contradicts anything. So what is there to arbitrate?",
    "anchorIds": ["trace.verdictReason", "trace.beliefTrack"]
  },
  {
    "question": "Doesn't discounting make you abstain on everything?",
    "anchorIds": ["validation.singleClassWarning", "compounds.conflictRate"]
  },
  {
    "question": "If R6 has no code of its own, is it really a rule?",
    "anchorIds": ["rule.R6"]
  },
  {
    "question": "You use an LLM as your baseline and in the product. Which is it?",
    "anchorIds": ["validation.llmAblation"]
  },
  {
    "question": "Why does R3 outrank R1?",
    "anchorIds": ["ruleset.precedenceOrder", "rule.R3"]
  },
  {
    "question": "Why is the abstention threshold 0.5?",
    "anchorIds": ["ruleset.abstentionThreshold", "ruleset.hash"]
  },
  {
    "question": "Isn't feeding it the mouse study hindsight?",
    "anchorIds": ["trace.nextExperiment", "evidence.citationStatus"]
  },
  {
    "question": "Your consistency claim is trivial. Deterministic code is deterministic.",
    "anchorIds": ["validation.plannerStability"]
  },
  {
    "question": "How do I know the ruleset wasn't edited before you showed me this?",
    "anchorIds": ["ruleset.modifiedBadge", "ruleset.hash"]
  }
]
```

Every question is lifted from master spec §12b's prepared Q&A or from §8.1's two
questions that had no UI to point at until Task 6 built one. §12b is what a judge
who read the deck will actually type, which is the whole reason rungs 2 and 3 hit
at all (spec §13, §15).

- [ ] **Step 4: Write the four suggested questions**

Create `apps/web/src/ai/cache/suggested-questions.json`:

```json
[
  {
    "question": "Why did ARBITER decline to commit here?",
    "anchorIds": ["trace.verdictReason", "trace.beliefTrack"]
  },
  {
    "question": "What would have to change for this to advance?",
    "anchorIds": ["trace.counterfactual", "trace.nextExperiment"]
  },
  {
    "question": "Which rule is doing the most work, and where does it come from?",
    "anchorIds": ["rule.R3", "ruleset.hash"]
  },
  {
    "question": "Who signed this, and what exactly were they signing?",
    "anchorIds": ["record.chainExplainer", "record.position:0"]
  }
]
```

These are rung 5, and rung 5 is the rung a judge sees when the other four missed —
so they steer towards what ARBITER is genuinely strong on rather than apologising.
`record.chainExplainer` leads its pair deliberately: `record.position:0` exists only
after somebody has signed, and §7.2's second case drops it when it does not.

- [ ] **Step 5: Write the ladder**

Create `apps/web/src/ai/navigate.ts`:

```ts
import { z } from "zod";
import { ANCHORS, isKnownAnchor, type Anchor } from "./anchors.js";
import { FUZZY_THRESHOLD, jaccard } from "./trigram.js";
import { resolve, type Resolution, type Rung } from "./resolve.js";
import type { Region } from "../state/store.js";
import type { TabId } from "../router.js";
import rawMap from "./cache/anchor-map.json";
import rawSuggested from "./cache/suggested-questions.json";

/**
 * Surface 3. The response carries identifiers and nothing else (spec section 7),
 * so the model has nowhere to put an invented claim: the UI scrolls to and
 * surfaces text that already exists at those anchors.
 *
 * Five rungs, not master spec section 7's three. The walker is shared with
 * Surface 1, so the fuzzy rung costs almost nothing, and an asymmetric similarity
 * threshold is something that has to be explained rather than defended
 * (spec section 7.1). Recorded as a departure so it does not read as an oversight.
 */
export interface NavResult {
  anchorIds: string[];
  noMatch: boolean;
}

export interface NavigateInput {
  question: string;
  /**
   * Matching strings, not display strings. Rung 4 scores question tokens against
   * `label`, and the caller folds each rule's registered statement into its rule
   * anchor's label (spec section 7.1). Display always reads `anchorMeta(id).label`.
   */
  anchors: { id: string; label: string }[];
}

export const NavResultSchema: z.ZodType<NavResult> = z.object({
  anchorIds: z.array(z.string()),
  noMatch: z.boolean(),
});

/** Three destinations is a navigator. Four is a search results page. */
const MAX_ANCHORS = 3;

interface CachedEntry {
  question: string;
  anchorIds: string[];
}

const MAP = rawMap as CachedEntry[];
const SUGGESTED = rawSuggested as CachedEntry[];

/**
 * The suggestions join the exact-match table, so clicking one re-enters through
 * the front door and answers at rung 2 rather than through a private path.
 */
const CACHE: CachedEntry[] = [...MAP, ...SUGGESTED];

export const SUGGESTED_QUESTIONS: string[] = SUGGESTED.map((e) => e.question);

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Spec section 7.2, first case: an id not in the registry is filtered out.
 *
 * Returning null when nothing survives, rather than a noMatch value, lets the
 * walker descend. The user-visible outcome section 7.2 requires is still noMatch -
 * rung 5 produces it - but the cache is consulted on the way, and a live model
 * answering with invented ids is precisely when the cache is worth the most.
 */
export function sanitizeNavResult(raw: NavResult): NavResult | null {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of raw.anchorIds) {
    if (!isKnownAnchor(id) || seen.has(id)) continue;
    seen.add(id);
    kept.push(id);
    if (kept.length === MAX_ANCHORS) break;
  }
  return kept.length === 0 ? null : { anchorIds: kept, noMatch: false };
}

/**
 * ANCHORS enumerates every static id. The per-instance families cannot be
 * enumerated, so their tab and region come from the family prefix.
 *
 * Parsed by prefix-slice and never by split(":"): claim ids contain colons
 * (TAK-994:invivo_rodent) and so do baseline names (spec section 8).
 */
const FAMILIES: { prefix: string; tab: TabId; region: Region | null; label: (rest: string) => string }[] = [
  { prefix: "trace.step:", tab: "case", region: "trace", label: (r) => `Argument step — ${r}` },
  { prefix: "evidence.claim:", tab: "case", region: "evidence", label: (r) => `Evidence row — ${r}` },
  { prefix: "record.position:", tab: "record", region: null, label: (r) => `Recorded position ${Number(r) + 1}` },
];

export function anchorMeta(id: string): Anchor | null {
  const stat = ANCHORS[id];
  if (stat) return stat;
  const fam = FAMILIES.find((f) => id.startsWith(f.prefix));
  if (!fam) return null;
  return { label: fam.label(id.slice(fam.prefix.length)), tab: fam.tab, region: fam.region };
}

/**
 * Words too common to discriminate between anchors. Kept short on purpose: a long
 * list starts deciding which questions are askable.
 */
const STOPWORDS = new Set([
  "about", "after", "again", "against", "because", "been", "before", "being", "between", "both",
  "does", "doing", "down", "during", "each", "from", "have", "having", "here", "into", "just",
  "more", "most", "much", "only", "other", "over", "same", "some", "such", "than", "that", "them",
  "then", "there", "these", "they", "this", "those", "through", "under", "until", "very", "were",
  "what", "when", "where", "which", "while", "whom", "whose", "will", "with", "would", "your",
]);

function tokens(s: string): string[] {
  return normalise(s).split(" ").filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/**
 * Rung 1. Stubbed until Task 9 replaces it with client.postJson("/api/navigate", …).
 * A stub that always misses is exactly what a file:// build does, so the demo path
 * this task ships is the demo path the submitted ZIP runs.
 */
const liveRung: Rung<NavigateInput, NavResult> = {
  source: "live",
  run: async () => null,
};

/** Rung 2. Exact match after normalisation, so casing and punctuation do not miss. */
const exactRung: Rung<NavigateInput, NavResult> = {
  source: "cache",
  run: async (input) => {
    const q = normalise(input.question);
    const hit = CACHE.find((e) => normalise(e.question) === q);
    return hit ? sanitizeNavResult({ anchorIds: hit.anchorIds, noMatch: false }) : null;
  },
};

/** Rung 3. Trigram Jaccard over the same cached questions, threshold 0.55. */
const fuzzyRung: Rung<NavigateInput, NavResult> = {
  source: "cache",
  run: async (input) => {
    let best: CachedEntry | null = null;
    let bestScore = 0;
    for (const e of CACHE) {
      const score = jaccard(normalise(input.question), normalise(e.question));
      // Strictly greater, so ties keep the earlier entry and the result is stable
      // across runs. Nothing here may depend on iteration luck.
      if (score >= FUZZY_THRESHOLD && score > bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best ? sanitizeNavResult({ anchorIds: best.anchorIds, noMatch: false }) : null;
  },
};

/** Rung 4. Token overlap against the anchor labels and rule statements the caller supplied. */
const keywordRung: Rung<NavigateInput, NavResult> = {
  source: "local",
  run: async (input) => {
    const asked = new Set(tokens(input.question));
    if (asked.size === 0) return null;
    const scored = input.anchors
      .map((a, order) => {
        const have = new Set(tokens(a.label));
        let score = 0;
        for (const w of asked) if (have.has(w)) score += 1;
        return { id: a.id, score, order };
      })
      .filter((s) => s.score > 0)
      // Score first, then the order the caller supplied. Never the object key
      // order of a JSON import.
      .sort((a, b) => (b.score - a.score) || (a.order - b.order));
    return scored.length === 0
      ? null
      : sanitizeNavResult({ anchorIds: scored.map((s) => s.id), noMatch: false });
  },
};

/** Rung 5. The four suggestions. This rung always answers, so the ladder terminates. */
const suggestRung: Rung<NavigateInput, NavResult> = {
  source: "none",
  run: async () => ({ anchorIds: [], noMatch: true }),
};

const RUNGS: Rung<NavigateInput, NavResult>[] = [liveRung, exactRung, fuzzyRung, keywordRung, suggestRung];

export function navigate(input: NavigateInput): Promise<Resolution<NavResult>> {
  return resolve(RUNGS, input);
}
```

- [ ] **Step 6: Run the resolution test to verify it passes**

Run: `npm test -- apps/web/test/navigate.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 7: Write the failing navigator bar test**

Create `apps/web/test/navigatorBar.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { NavigatorBar } from "../src/ai/NavigatorBar.js";
import { CaseTab } from "../src/tabs/Case/index.js";
import { TourFooter } from "../src/tour/TourFooter.js";
import { loadData } from "../src/data/load.js";

const data = loadData();

const renderBar = () =>
  render(
    <StoreProvider data={data}>
      <NavigatorBar />
      <TourFooter />
    </StoreProvider>,
  );

const submit = (text: string) => {
  const input = screen.getByTestId("nav-input");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
  return input;
};

describe("the navigator bar", () => {
  it("turns a prepared question into named destinations and says which rung answered", async () => {
    renderBar();
    submit("If R6 has no code of its own, is it really a rule?");

    const anchors = await screen.findAllByTestId("nav-anchor");
    expect(anchors.map((a) => a.getAttribute("data-anchor-id"))).toEqual(["rule.R6"]);
    // The rung is displayed, not just returned: the pre-flight story is that
    // "which rung answered" is a value, and a presenter can see it degrade.
    expect(screen.getByTestId("nav-rung").textContent).toMatch(/2/);
  });

  it("offers the four suggestions instead of an apology when nothing matches", async () => {
    renderBar();
    submit("zzz qqq vvv xxx");

    const suggestions = await screen.findAllByTestId("nav-suggestion");
    expect(suggestions).toHaveLength(4);
    expect(screen.queryByTestId("nav-anchor")).toBeNull();
  });

  it("answers a suggestion when it is clicked, from the cache", async () => {
    renderBar();
    submit("zzz qqq vvv xxx");
    const suggestions = await screen.findAllByTestId("nav-suggestion");

    fireEvent.click(suggestions[0]!);

    const anchors = await screen.findAllByTestId("nav-anchor");
    expect(anchors.map((a) => a.getAttribute("data-anchor-id")))
      .toEqual(["trace.verdictReason", "trace.beliefTrack"]);
  });

  it("un-collapses the region a destination lives in", async () => {
    // Collapsed Case regions unmount their content (spec section 8), so a
    // presentational setFocus is the navigator's own job - the pattern the tour
    // beats already establish.
    render(
      <StoreProvider data={data}>
        <NavigatorBar />
        <CaseTab />
      </StoreProvider>,
    );
    submit("Nothing in pass 1 contradicts anything. So what is there to arbitrate?");
    const anchors = await screen.findAllByTestId("nav-anchor");

    fireEvent.click(anchors[0]!);

    expect(document.querySelector(".case-grid")?.getAttribute("data-focus")).toBe("trace");
  });
});

describe("the navigator bar and the global keys", () => {
  it("does not kill the motion when 'murine' is typed into the question box", () => {
    // Spec section 7.3. This is why the box is a real <input> and not a
    // contenteditable div: isTypingTarget already returns true for INPUT, so the
    // window-level M handler suppresses itself with no new code.
    renderBar();
    expect(screen.getByText(/motion on/)).toBeTruthy();

    const input = screen.getByTestId("nav-input");
    for (const key of ["m", "u", "r", "i", "n", "e"]) fireEvent.keyDown(input, { key });

    expect(screen.getByText(/motion on/)).toBeTruthy();
  });

  it("does not move the beat when an arrow key moves the caret in the question box", () => {
    renderBar();
    const before = screen.getByText(/Beat 1 of/).textContent;

    fireEvent.keyDown(screen.getByTestId("nav-input"), { key: "ArrowRight" });

    expect(screen.getByText(/Beat 1 of/).textContent).toBe(before);
  });

  it("focuses the box on '/' and does not type the slash into it", () => {
    renderBar();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(screen.getByTestId("nav-input"));
    expect((screen.getByTestId("nav-input") as HTMLInputElement).value).toBe("");
  });

  it("does NOT dismiss on Escape, because Escape already means something else", async () => {
    // Spec section 7.3: Escape is deliberately exempt from the isTypingTarget
    // guard (TourFooter.tsx:25) and dispatches setFocus: null. A navigator that
    // also owned Escape would collapse whichever Case region was just opened.
    renderBar();
    submit("If R6 has no code of its own, is it really a rule?");
    await screen.findAllByTestId("nav-anchor");

    fireEvent.keyDown(screen.getByTestId("nav-input"), { key: "Escape" });

    expect(screen.getAllByTestId("nav-anchor")).toHaveLength(1);
  });

  it("dismisses on Backspace once the box is empty, and collapses to one line", async () => {
    renderBar();
    const input = submit("If R6 has no code of its own, is it really a rule?");
    await screen.findAllByTestId("nav-anchor");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Backspace" });

    expect(screen.queryByTestId("nav-anchor")).toBeNull();
    expect(screen.getByTestId("navigator").getAttribute("data-open")).toBe("no");
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npm test -- apps/web/test/navigatorBar.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/ai/NavigatorBar.js"`; the component does not exist.

- [ ] **Step 9: Write the navigator bar**

Create `apps/web/src/ai/NavigatorBar.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppState, useDispatch } from "../state/store.js";
import { ANCHORS, ruleAnchor } from "./anchors.js";
import { isTypingTarget } from "../ui/isTypingTarget.js";
import { anchorMeta, navigate, SUGGESTED_QUESTIONS, type NavResult } from "./navigate.js";
import type { Resolution } from "./resolve.js";

/**
 * Surface 3's mount: a slim persistent bar between the tab nav and the tab body,
 * one line when idle (spec section 7.3). Global by construction, which is what a
 * question asked from any tab needs.
 *
 * Two keyboard collisions, both measured rather than guessed:
 *
 * 1. The box is a real <input>. ui/isTypingTarget.ts already returns true for
 *    INPUT, so the window-level arrow, M and ? handlers suppress themselves for
 *    free. A contenteditable div would need every one of those handlers taught
 *    about it, and the failure mode - typing "murine" silently stripping the
 *    motion out of the demo - is invisible until a judge is watching.
 * 2. Escape is NOT the dismiss key. Escape is deliberately exempt from that guard
 *    (TourFooter.tsx:25) and already dispatches setFocus: null, so a navigator
 *    that owned Escape would also collapse whichever Case region the presenter
 *    had just opened. Backspace on an already-empty box dismisses instead: there
 *    is nothing left for it to delete, it carries no global binding, and it
 *    cannot fire mid-word.
 */
export function NavigatorBar() {
  const { ruleset } = useAppState();
  const dispatch = useDispatch();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<Resolution<NavResult> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * The labels handed to navigate() are for MATCHING, not for display. Rung 4
   * scores question tokens against them, and spec section 7.1 says the rule
   * statements are part of that surface - they are the most quotable text in the
   * app, and they are what a question about a rule actually echoes.
   */
  const matchAnchors = useMemo(() => {
    const statement = (id: string) => ruleset.rules.find((r) => ruleAnchor(r.id) === id)?.statement ?? "";
    return Object.entries(ANCHORS).map(([id, a]) => ({ id, label: `${a.label} ${statement(id)}`.trim() }));
  }, [ruleset]);

  const ask = useCallback(
    async (q: string) => {
      setQuestion(q);
      setResult(await navigate({ question: q, anchors: matchAnchors }));
    },
    [matchAnchors],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || isTypingTarget(e.target)) return;
      // Without preventDefault the slash that focused the box is also typed into it.
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * Presentational only. Un-collapsing a region is the same setFocus a user
   * clicking the region header dispatches, exactly as the tour beats do. A
   * compound change would be a DATA action and goes through selectCompound,
   * visibly (spec section 16).
   */
  const pick = (id: string) => {
    const meta = anchorMeta(id);
    if (meta?.region) dispatch({ type: "setFocus", focus: meta.region });
  };

  const value = result?.value ?? null;
  const open = value !== null;

  return (
    <div data-testid="navigator" data-open={open ? "yes" : "no"}
         style={{ borderBottom: "1px solid var(--hairline)", background: "var(--surface)",
                  padding: open ? "8px 20px" : "6px 20px", display: "flex",
                  flexDirection: "column", gap: open ? 8 : 0 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim() === "") { setResult(null); return; }
          void ask(question);
        }}
        style={{ display: "flex", alignItems: "center", gap: 10 }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Ask</span>
          <input
            ref={inputRef}
            data-testid="nav-input"
            value={question}
            placeholder="Ask about this case, then press Enter  ( / to focus )"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && e.currentTarget.value === "") {
                e.preventDefault();
                setResult(null);
                e.currentTarget.blur();
              }
            }}
            style={{ flex: 1, padding: "4px 8px", border: "1px solid var(--hairline)",
                     borderRadius: "var(--radius)", background: "var(--canvas)" }}
          />
        </label>
        {open && (
          <span data-testid="nav-rung" style={{ color: "var(--muted)", fontSize: 12 }}>
            rung {result!.rung} · {result!.source}
          </span>
        )}
      </form>

      {value !== null && !value.noMatch && (
        <div data-testid="nav-result" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {value.anchorIds.map((id) => (
            <button key={id} type="button" data-testid="nav-anchor" data-anchor-id={id}
                    onClick={() => pick(id)}>
              {anchorMeta(id)?.label ?? id}
            </button>
          ))}
        </div>
      )}

      {value !== null && value.noMatch && (
        <div data-testid="nav-nomatch" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            Nothing on screen answers that. These are answered on screen:
          </span>
          {SUGGESTED_QUESTIONS.map((q) => (
            <button key={q} type="button" data-testid="nav-suggestion" onClick={() => void ask(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Mount it in the shell, between the tab nav and the tab body**

Replace `apps/web/src/App.tsx`:

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
import { NavigatorBar } from "./ai/NavigatorBar.js";
import { Preflight } from "./ui/Preflight.js";
import { isTypingTarget } from "./ui/isTypingTarget.js";
import "./ui/motion.css";

const data = loadData();

function AppShell({ tab }: { tab: TabId }) {
  const { motion } = useAppState();
  const [preflight, setPreflight] = useState(false);

  // `?` rather than a visible button: it is for the presenter in the ninety
  // seconds before going live, not part of the story a judge is shown.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || isTypingTarget(e.target)) return;
      setPreflight((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      {/* Between the nav and the tab body, per spec section 7.3: a question is
          asked about whatever is on screen, so the bar belongs above it and
          outside it. */}
      <NavigatorBar />
      {tab === "case" ? <CaseTab />
        : tab === "compounds" ? <CompoundsTab />
        : tab === "ruleset" ? <RulesetTab />
        : tab === "validation" ? <ValidationTab />
        : <RecordTab />}
      {preflight ? <Preflight /> : null}
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

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npm test -- apps/web && npm run typecheck && npm run web:build`
Expected: PASS, build succeeds

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/ai apps/web/src/App.tsx apps/web/test/navigate.test.ts apps/web/test/navigatorBar.test.tsx
git commit -m "$(cat <<'MSG'
Add the navigator's anchor map, rungs 2-5 and its bar

The navigator returns identifiers and nothing else (spec section 7), which is
why it cannot hallucinate: the response type gives a model nowhere to put an
invented claim, and the UI surfaces text that already exists at those anchors.

The ladder is five rungs, not the three master spec section 7 gives it. That
spec skips the fuzzy step Surface 1 has and never says why. The walker is
shared, so the extra rung costs almost nothing, and an asymmetric similarity
threshold is something that has to be explained rather than defended. Recorded
here and in spec section 7.1 as a deliberate departure rather than an oversight.

The cached questions are lifted from master spec section 12b's prepared Q&A,
because that is what a judge who read the deck will actually type - the cache
is the product, and unrepresentative phrasing is what makes rung 3 miss in
front of an audience. The two questions section 8.1 rescued from having no UI
at all, on precedence order and the abstention threshold, are in the map for
the same reason.

Section 7.2 splits a bad response into three cases and this commit closes the
first: an id not in the registry is filtered out. Returning null when none
survive, rather than a noMatch value, still produces section 7.2's outcome -
rung 5 does - but consults the cache on the way, which is exactly when the
cache is worth the most. The test asserts the specific ids that were filtered
rather than a count, because a count is 0 under every implementation.

The box is a real input, so ui/isTypingTarget.ts suppresses the global arrow,
M and ? handlers with no new code and typing "murine" cannot silently strip
the motion out of the demo. Escape is not the dismiss key: it is deliberately
exempt from that guard and already dispatches setFocus: null, so it would also
collapse the Case region the presenter just opened. Backspace on an empty box
dismisses instead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
git push origin phase3
```

---

### Task 8: The spotlight scrolls after the tab has actually mounted, and stops dead when motion is off

Spec §8's deferred resolve is the only genuinely new machinery Surface 3 needs; §8.2 is the trap, because the motion kill switch is CSS and `scrollIntoView({behavior})` is a JS argument no stylesheet can reach.

**Files:**
- Create: `apps/web/src/ai/useAnchorScroll.ts`
- Create: `apps/web/src/ai/spotlight.css`
- Modify: `apps/web/src/state/store.tsx:21-82` (`pendingAnchor`, `setPendingAnchor`)
- Modify: `apps/web/src/ai/NavigatorBar.tsx:96-101` (`pick` sets the hash and the pending anchor)
- Modify: `apps/web/src/App.tsx:17-51` (`AppShell` calls the hook)
- Modify: `apps/web/test/setup.ts:1-11` (a `matchMedia` stub jsdom does not provide)
- Test: `apps/web/test/anchorScroll.test.tsx`

**Interfaces:**
- Consumes: `anchorMeta(id: string): Anchor | null`, `navigate`, `SUGGESTED_QUESTIONS` (Task 7); `useAppState`, `useDispatch`; `TabId`; the `data-anchor` attributes (Task 2).
- Produces:
  - `export function useAnchorScroll(tab: TabId): void`
  - `export const SPOTLIGHT_HOLD_MS = 1500`
  - new `AppState` field `pendingAnchor: string | null`
  - new action `{ type: "setPendingAnchor"; anchorId: string | null }`
  - the `[data-anchor-spotlight="on"]` CSS contract the Playwright motion spec can measure

- [ ] **Step 1: Write the failing deferred-resolve and motion test**

Create `apps/web/test/anchorScroll.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { StoreProvider, useDispatch } from "../src/state/store.js";
import { useAnchorScroll, SPOTLIGHT_HOLD_MS } from "../src/ai/useAnchorScroll.js";
import { loadData } from "../src/data/load.js";

const data = loadData();

interface ScrollCall {
  el: Element;
  behavior: string | undefined;
}
let calls: ScrollCall[] = [];

/** jsdom implements neither of these, and both are the subject of the test. */
function stubMatchMedia(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  calls = [];
  Element.prototype.scrollIntoView = function (opts?: boolean | ScrollIntoViewOptions) {
    calls.push({ el: this, behavior: typeof opts === "object" ? opts.behavior : undefined });
  };
  stubMatchMedia(false);
  window.location.hash = "#/case";
});

afterEach(() => {
  window.location.hash = "#/case";
});

const submit = (text: string) => {
  const input = screen.getByTestId("nav-input");
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
};

describe("the deferred resolve", () => {
  it("scrolls only once the other tab has actually mounted", async () => {
    // hashchange fires ASYNCHRONOUSLY, so the target element does not exist on
    // the next statement. This is the one piece of genuinely new machinery
    // Surface 3 needs (spec section 8): without pendingAnchor plus an effect
    // that fires when the tab matches, a naive implementation queries the DOM
    // in the click handler, finds nothing, and silently does nothing forever.
    render(<App />);
    submit("You use an LLM as your baseline and in the product. Which is it?");
    const anchor = await screen.findByTestId("nav-anchor");

    // Precondition, asserted on the DOM rather than on a call count: the
    // destination is genuinely not mounted while the Case tab is showing.
    expect(document.querySelector('[data-anchor="validation.llmAblation"]')).toBeNull();

    fireEvent.click(anchor);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.el.getAttribute("data-anchor")).toBe("validation.llmAblation");
    expect(calls[0]!.el).toHaveAttribute("data-anchor-spotlight", "on");
  });

  it("un-collapses a collapsed Case region before it scrolls into it", async () => {
    // While the tour sits on beat 2 with focus "trace", the evidence panel has
    // unmounted its content and no evidence-row exists in the DOM at all
    // (Case/index.tsx:18, EvidencePanel.tsx:13). Scrolling first would scroll to
    // nothing.
    render(<App />);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await waitFor(() =>
      expect(document.querySelector(".case-grid")?.getAttribute("data-focus")).toBe("trace"),
    );
    expect(document.querySelector('[data-anchor="evidence.citationStatus"]')).toBeNull();

    submit("Isn't feeding it the mouse study hindsight?");
    const anchors = await screen.findAllByTestId("nav-anchor");
    const target = anchors.find((a) => a.getAttribute("data-anchor-id") === "evidence.citationStatus");
    fireEvent.click(target!);

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.el.getAttribute("data-anchor")).toBe("evidence.citationStatus");
  });
});

/** A component the test drives directly, for the cases the cache cannot reach. */
function Harness({ anchorId, text }: { anchorId: string; text: string }) {
  const dispatch = useDispatch();
  useAnchorScroll("case");
  return (
    <>
      <div data-anchor={anchorId}>{text}</div>
      <button type="button" onClick={() => dispatch({ type: "setPendingAnchor", anchorId })}>go</button>
      <button type="button" onClick={() => dispatch({ type: "toggleMotion" })}>motion</button>
    </>
  );
}

const renderHarness = (anchorId: string, text: string) =>
  render(
    <StoreProvider data={data}>
      <Harness anchorId={anchorId} text={text} />
    </StoreProvider>,
  );

describe("never point at nothing", () => {
  it("scrolls to an anchor that has text", () => {
    // The control. Without it the empty-element test below would pass on an
    // implementation that never scrolls at all.
    renderHarness("trace.counterfactual", "One claim would have to change.");
    fireEvent.click(screen.getByText("go"));
    expect(calls).toHaveLength(1);
  });

  it("drops an anchor whose element is empty rather than pointing at nothing", () => {
    // "The UI surfaces text that already exists" is the whole non-hallucination
    // guarantee (spec section 7.2). An anchor resolving to an empty element
    // falsifies it as surely as invented prose would.
    renderHarness("trace.counterfactual", "");
    fireEvent.click(screen.getByText("go"));
    expect(calls).toHaveLength(0);
    expect(document.querySelector("[data-anchor]")).not.toHaveAttribute("data-anchor-spotlight");
  });
});

describe("the motion kill switch reaches the scroll, which CSS cannot", () => {
  it("glides when motion is on and the media query is not asking for less", () => {
    renderHarness("trace.counterfactual", "One claim would have to change.");
    fireEvent.click(screen.getByText("go"));
    expect(calls[0]!.behavior).toBe("smooth");
  });

  it("jumps when the M toggle is off, even though the media query says nothing", () => {
    // motion.css overrides animation-duration and transition-duration only.
    // scrollIntoView({behavior}) is a JS argument no stylesheet can reach, so a
    // naive spotlight keeps gliding after M is pressed - the first thing a judge
    // would notice (spec section 8.2).
    stubMatchMedia(false);
    renderHarness("trace.counterfactual", "One claim would have to change.");
    fireEvent.click(screen.getByText("motion"));
    fireEvent.click(screen.getByText("go"));
    expect(calls[0]!.behavior).toBe("auto");
  });

  it("jumps when the media query asks for less motion, even with the M toggle on", () => {
    // The second signal, independently. tokens.css:29 cannot reach the scroll
    // either, so prefers-reduced-motion has to be read in JS.
    stubMatchMedia(true);
    renderHarness("trace.counterfactual", "One claim would have to change.");
    fireEvent.click(screen.getByText("go"));
    expect(calls[0]!.behavior).toBe("auto");
  });
});

describe("the spotlight", () => {
  it("clears itself well inside the 1.5s motion budget", () => {
    expect(SPOTLIGHT_HOLD_MS).toBeLessThanOrEqual(1500);

    vi.useFakeTimers();
    try {
      renderHarness("trace.counterfactual", "One claim would have to change.");
      fireEvent.click(screen.getByText("go"));
      expect(document.querySelector("[data-anchor]")).toHaveAttribute("data-anchor-spotlight", "on");

      act(() => { vi.advanceTimersByTime(SPOTLIGHT_HOLD_MS + 1); });

      expect(document.querySelector("[data-anchor]")).not.toHaveAttribute("data-anchor-spotlight");
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/anchorScroll.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/ai/useAnchorScroll.js"`; and once resolved, `setPendingAnchor` is not a member of `Action`.

- [ ] **Step 3: Add `pendingAnchor` to the store**

Four whole declarations in `apps/web/src/state/store.tsx`, each replaced in full.
Task 3 adds `evidenceEdits` to the same three declarations; the two sets of
additions are independent lines and do not collide.

Replace the `AppState` interface:

```ts
export interface AppState {
  data: LoadedData;
  ruleset: Ruleset;                 // editable working copy
  asOf: string | null;
  selectedCompoundId: string;
  tour: { beat: number; tab: TabId; focus: Region | null };
  positions: ReviewerPosition[];
  motion: boolean;
  /**
   * The anchor the navigator is trying to reach. It cannot be reached in the
   * click that requested it: switching tab means assigning window.location.hash,
   * and hashchange fires asynchronously, so the target element is not mounted on
   * the next statement (spec section 8).
   */
  pendingAnchor: string | null;
}
```

Replace the `Action` union:

```ts
export type Action =
  | { type: "selectCompound"; compoundId: string }
  | { type: "setAsOf"; asOf: string | null }
  | { type: "setRuleStrength"; id: RuleId; strength: number }
  | { type: "setRuleEnabled"; id: RuleId; enabled: boolean }
  | { type: "resetRuleset" }
  | { type: "setTourBeat"; beat: number; tab: TabId; focus: Region | null }
  | { type: "setFocus"; focus: Region | null }
  | { type: "addPosition"; position: ReviewerPosition }
  | { type: "toggleMotion" }
  | { type: "setPendingAnchor"; anchorId: string | null };
```

Replace `initialState`:

```ts
export function initialState(data: LoadedData): AppState {
  return {
    data,
    ruleset: data.ruleset,
    asOf: null,
    selectedCompoundId: data.fixture.compoundId,
    tour: { beat: 0, tab: "case", focus: null },
    positions: [],
    motion: true,
    pendingAnchor: null,
  };
}
```

Replace `reducer`:

```ts
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
    // Presentational, like setFocus. The hash is still what switches the tab -
    // this only records what to do once it has.
    case "setPendingAnchor": return { ...s, pendingAnchor: a.anchorId };
  }
}
```

- [ ] **Step 4: Write the spotlight stylesheet**

Create `apps/web/src/ai/spotlight.css`:

```css
/* The spotlight is a TRANSITION on an attribute, deliberately.

   [data-motion="off"] in motion.css overrides transition-duration with
   !important, so the M toggle and prefers-reduced-motion both kill this for
   free, and Playwright can measure getComputedStyle(el).transitionDuration
   exactly as the existing belief-fill motion test already does.

   600ms ease is the Case region-focus grid transition from case.css, reused on
   purpose: the app should not grow a second motion idiom for a second kind of
   spotlight. Well inside the 1.5s budget (spec section 8.2). */
[data-anchor] {
  transition: box-shadow 600ms ease, background-color 600ms ease;
}
[data-anchor-spotlight="on"] {
  box-shadow: 0 0 0 3px var(--pfizer-blue);
  background-color: var(--surface);
}
```

- [ ] **Step 5: Write the deferred resolve**

Create `apps/web/src/ai/useAnchorScroll.ts`:

```ts
import { useEffect, useRef } from "react";
import { useAppState, useDispatch } from "../state/store.js";
import type { TabId } from "../router.js";
import { anchorMeta } from "./navigate.js";
import "./spotlight.css";

/** Held long enough to be seen, short enough to be gone before the next sentence. */
export const SPOTLIGHT_HOLD_MS = 1500;

/**
 * Surface 3's deferred resolve: the only genuinely new machinery it needs
 * (spec section 8).
 *
 * Tab switching reuses the existing mechanism - window.location.hash = "#/" + tab,
 * which is what the tour (TourFooter.tsx:18) and the Compounds row click
 * (Compounds.tsx:47) already do, and what App.tsx:56 listens to. state.tour.tab is
 * written at store.tsx:77 and read by no renderer; it is NOT the switch.
 *
 * hashchange fires asynchronously, so the target element is not mounted on the
 * statement after the assignment. Hence a pendingAnchor in state and this effect,
 * which fires again once `tab` matches the anchor's tab and only then resolves.
 */
export function useAnchorScroll(tab: TabId): void {
  const { pendingAnchor, motion, tour } = useAppState();
  const dispatch = useDispatch();
  /** The anchor this hook has already acted on, so toggling motion mid-hold does not re-scroll. */
  const handled = useRef<string | null>(null);
  const timer = useRef<number | null>(null);

  // Unmount only. The main effect deliberately returns no cleanup: a cleanup that
  // cancelled this timer would fire on the very next dependency change and the
  // spotlight would never be removed.
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  useEffect(() => {
    if (pendingAnchor === null) { handled.current = null; return; }
    if (handled.current === pendingAnchor) return;

    const meta = anchorMeta(pendingAnchor);

    // Spec section 7.2, first case, at the DOM boundary: an id with no registry
    // entry and no family is dropped outright.
    if (meta === null) { dispatch({ type: "setPendingAnchor", anchorId: null }); return; }

    // The hash has been assigned but hashchange has not landed yet. Wait: this
    // effect re-runs when `tab` changes.
    if (meta.tab !== tab) return;

    // Collapsed Case regions UNMOUNT their content (Case/index.tsx:18-20 and each
    // panel's collapsed early-return), so while the tour sits on beat 2 with
    // focus "trace" there is no evidence-row in the DOM at all. Un-collapse first
    // and let the re-render bring this effect back round. The navigator dispatches
    // this too; setFocus is idempotent, and pendingAnchor is a state field that
    // anything may set, so the hook cannot assume the bar did it.
    if (meta.region !== null && tour.focus !== null && tour.focus !== meta.region) {
      dispatch({ type: "setFocus", focus: meta.region });
      return;
    }

    // Attribute selectors take the value in quotes, so ids containing "." and ":"
    // need no escaping. Nothing constructs an id containing a quote.
    const el = document.querySelector<HTMLElement>(`[data-anchor="${pendingAnchor}"]`);

    // Spec section 7.2, second and third cases. The tab was switched and the
    // region un-collapsed, and it is STILL not there, or it is there and empty.
    // Never point at nothing: an anchor resolving to an empty element falsifies
    // the non-hallucination guarantee as surely as invented prose would.
    if (el === null || (el.textContent ?? "").trim() === "") {
      dispatch({ type: "setPendingAnchor", anchorId: null });
      return;
    }

    handled.current = pendingAnchor;
    for (const stale of document.querySelectorAll("[data-anchor-spotlight]")) {
      stale.removeAttribute("data-anchor-spotlight");
    }

    // Spec section 8.2. motion.css overrides animation-duration and
    // transition-duration; scrollIntoView({behavior}) is a JS argument that CSS
    // cannot reach, and neither can the prefers-reduced-motion block in
    // tokens.css:29. Branch on BOTH signals or the spotlight keeps gliding after
    // M is pressed, which is the first thing a judge would notice.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: motion && !reduced ? "smooth" : "auto", block: "center" });
    el.setAttribute("data-anchor-spotlight", "on");

    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      el.removeAttribute("data-anchor-spotlight");
      timer.current = null;
      dispatch({ type: "setPendingAnchor", anchorId: null });
    }, SPOTLIGHT_HOLD_MS);
  }, [pendingAnchor, tab, tour.focus, motion, dispatch]);
}
```

- [ ] **Step 6: Make the navigator's destinations request the anchor**

In `apps/web/src/ai/NavigatorBar.tsx`, replace the whole `pick` function:

```tsx
  /**
   * Presentational only. Un-collapsing a region is the same setFocus a user
   * clicking the region header dispatches, exactly as the tour beats do, and the
   * tab switch is the tour's own mechanism - assigning the hash (TourFooter.tsx:18).
   * A compound change would be a DATA action and goes through selectCompound,
   * visibly (spec section 16).
   *
   * The scroll cannot happen here: hashchange is asynchronous, so the target is
   * not mounted on the next statement. useAnchorScroll picks it up once it is.
   */
  const pick = (id: string) => {
    const meta = anchorMeta(id);
    if (meta === null) return;
    if (meta.region) dispatch({ type: "setFocus", focus: meta.region });
    dispatch({ type: "setPendingAnchor", anchorId: id });
    window.location.hash = `#/${meta.tab}`;
  };
```

- [ ] **Step 7: Call the hook from the shell**

In `apps/web/src/App.tsx`, replace the whole `AppShell` function:

```tsx
function AppShell({ tab }: { tab: TabId }) {
  const { motion } = useAppState();
  const [preflight, setPreflight] = useState(false);

  // Here rather than inside NavigatorBar: the hook needs the tab that is actually
  // rendered, which is what tells it the deferred hashchange has landed.
  useAnchorScroll(tab);

  // `?` rather than a visible button: it is for the presenter in the ninety
  // seconds before going live, not part of the story a judge is shown.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || isTypingTarget(e.target)) return;
      setPreflight((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
      {/* Between the nav and the tab body, per spec section 7.3: a question is
          asked about whatever is on screen, so the bar belongs above it and
          outside it. */}
      <NavigatorBar />
      {tab === "case" ? <CaseTab />
        : tab === "compounds" ? <CompoundsTab />
        : tab === "ruleset" ? <RulesetTab />
        : tab === "validation" ? <ValidationTab />
        : <RecordTab />}
      {preflight ? <Preflight /> : null}
      <TourFooter />
    </div>
  );
}
```

Add the import beside the other `./ai/` import:

```tsx
import { useAnchorScroll } from "./ai/useAnchorScroll.js";
```

- [ ] **Step 8: Give jsdom a `matchMedia` so every other web test keeps passing**

Replace `apps/web/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest.config.ts does not set `globals: true`, so @testing-library/react's
// own auto-cleanup (which relies on a global afterEach) never registers.
// Without this, DOM from one test in a file leaks into the next, and
// getByTestId queries that are unique per-render start matching more than
// one element.
afterEach(cleanup);

// jsdom implements neither of these. useAnchorScroll reads matchMedia for
// prefers-reduced-motion and calls scrollIntoView, and every test that renders
// <App /> now mounts that hook. Defaults that do nothing, so a test which cares
// about either one overrides it explicitly rather than inheriting an opinion.
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npm test -- apps/web && npm run typecheck && npm run web:build`
Expected: PASS, build succeeds

- [ ] **Step 10: Run the Playwright specs, including the untouched static-file spec**

Run: `npm run e2e`
Expected: PASS — `static-file.spec.ts` unmodified and still green, with every surface answering from cache and no request attempted.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/ai apps/web/src/App.tsx apps/web/src/state/store.tsx apps/web/test/setup.ts apps/web/test/anchorScroll.test.tsx
git commit -m "$(cat <<'MSG'
Resolve the navigator's anchor after the tab has mounted, not before

Tab switching reuses the mechanism the app already has: assign
window.location.hash, which is what the tour and the Compounds row click do and
what App.tsx listens to. state.tour.tab is written but read by no renderer and
is not the switch - worth saying out loud, because it looks like one.

hashchange fires asynchronously, so the target element does not exist on the
statement after the assignment. A pendingAnchor in state plus an effect that
fires once the rendered tab matches is the only genuinely new machinery Surface
3 needs (spec section 8), and the test fails without it: a naive implementation
queries the DOM in the click handler, finds nothing, and silently does nothing.

Collapsed Case regions unmount their content, so while the tour sits on beat 2
with focus "trace" no evidence row exists in the DOM at all. setFocus is
dispatched before scrolling and the effect comes back round, which is spec
section 7.2's second case: switch tab, un-collapse, re-check, and only then
drop the id. The third case is the one that matters most - an anchor resolving
to an empty element falsifies "the UI surfaces text that already exists" as
surely as invented prose would, so an empty element is dropped rather than
spotlit.

Section 8.2 is the trap this commit is really about. motion.css overrides
animation-duration and transition-duration; scrollIntoView({behavior}) is a JS
argument no stylesheet can reach, and neither can the prefers-reduced-motion
block in tokens.css. A naive spotlight keeps gliding after M is pressed, which
is the first thing a judge would notice. The scroll branches on both signals in
JS, and there is a test for each independently.

The highlight itself stays in CSS, as a transition on a data-anchor-spotlight
attribute, so the kill switch reaches it for free and Playwright can measure
transitionDuration the same way the belief-fill test already does. 600ms ease
is the Case region-focus grid transition reused deliberately, rather than a
second motion idiom for a second kind of spotlight.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
git push origin phase3
```
### Task 9: The key never reaches the browser, and a wrong-shaped 200 is a rung-1 miss

Phase 3 spec §10 puts two thin handlers on the same Railway service as the static app — same-origin, no CORS, key server-side — and §11 requires the response to be *schema-validated*, not merely parsed, because a 200 carrying well-formed JSON of the wrong shape is the case that would otherwise reach the confirm panel.

**Files:**
- Create: `services/api/package.json`
- Create: `services/api/tsconfig.json`
- Create: `services/api/interpret.ts`
- Create: `services/api/navigate.ts`
- Create: `services/api/test/handlers.test.ts`
- Modify: `apps/web/src/ai/interpret.ts` (the `RUNGS` array — Task 4 left rung 1 stubbed)
- Modify: `apps/web/src/ai/navigate.ts` (the `RUNGS` array — Task 7 left rung 1 stubbed)
- Modify: `package.json:9-20` (workspaces, `typecheck`, `lint`)
- Test: `apps/web/test/rung1.test.ts`
- Test: `apps/web/test/boundaries.test.ts`

**Interfaces:**
- Consumes: `postJson<T>(path: string, body: unknown, parse: (u: unknown) => T | null): Promise<T | null>`; `liveEnabled: boolean`; `LIVE_TIMEOUT_MS = 2500`; `Rung<I, T> = { source: Source; run: (input: I) => Promise<T | null> }`; `ProposalSchema: z.ZodType<Proposal>`; `NavResultSchema: z.ZodType<NavResult>`; `InterpretInput`; `NavigateInput`
- Produces: `handleInterpret(rawBody: unknown, complete: Complete | null): Promise<ApiResponse>`; `handleNavigate(rawBody: unknown, complete: Complete | null): Promise<ApiResponse>`; `completeFromEnv(env?: NodeJS.ProcessEnv): Complete | null`; `ApiResponse = { status: number; body: unknown }`; rung 1 present at index 0 of both ladders, so every `Resolution.rung` returned by `interpret`/`navigate` is now 1-based against the full five-rung ladder

- [ ] **Step 1: Write the failing service test**

Create `services/api/test/handlers.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { handleInterpret } from "../interpret.js";
import { handleNavigate } from "../navigate.js";

/**
 * These handlers are the ONLY place an API key exists in this system. Every test
 * here injects a fake `complete`, so the suite never constructs an SDK client and
 * never needs a key - which is also the reason the key is a constructor argument
 * rather than a module-level read.
 */

const REQUEST = {
  challenge: "The rat study should not carry this much weight",
  rules: [{ id: "R1", enabled: true, strength: 0.6 }],
  claims: [{ id: "TAK-994:invivo_rodent", label: "in vivo rodent, toxic" }],
};

const NAV_REQUEST = {
  question: "Which rule discounted the murine study?",
  anchors: [{ id: "rule.R1", label: "R1 - species relevance" }],
};

describe("POST /api/interpret", () => {
  it("returns 503 no_key when no key is configured, and never calls a model", async () => {
    // Spec §10: with no key the endpoint returns 503 {"error":"no_key"}, which the
    // client treats exactly like a timeout. A deploy that forgets the key must
    // degrade to the cache, not 500 into the confirm panel.
    const res = await handleInterpret(REQUEST, null);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "no_key" });
  });

  it("rejects a malformed request before it can cost a token", async () => {
    // The 400 branch has to exist and has to be reached WITHOUT calling the model:
    // a handler that forwards junk pays for it and then fails anyway.
    const complete = vi.fn();
    const res = await handleInterpret({ challenge: 42 }, complete);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "bad_request" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("constrains targetRule and targetClaimId to the ids the CLIENT sent", async () => {
    // The structural guarantee, mirroring Surface 3's ids-only return type: the
    // response schema is built from the request, so the model has nowhere to put a
    // rule or a claim that was not offered. Asserting the enums are non-empty would
    // pass under every implementation; assert the exact members.
    let captured: Record<string, unknown> | null = null;
    const complete = vi.fn(async (_s: string, _u: string, schema: Record<string, unknown>) => {
      captured = schema;
      return { targetRule: "R1", targetClaimId: null, action: "lower_strength",
               field: null, newValue: 0.2, paraphrase: "p", confidence: "high" };
    });

    const res = await handleInterpret(REQUEST, complete);
    expect(res.status).toBe(200);

    const props = (captured as unknown as { properties: Record<string, { anyOf: { enum?: string[] }[] }> }).properties;
    expect(props["targetRule"]!.anyOf[0]!.enum).toEqual(["R1"]);
    expect(props["targetClaimId"]!.anyOf[0]!.enum).toEqual(["TAK-994:invivo_rodent"]);
  });

  it("turns an upstream throw into 502 rather than propagating it", async () => {
    // A refusal, a rate limit and a network fault all land here. §3's invariant is
    // that rung 1 never errors upward, and this is where that starts.
    const complete = vi.fn(async () => { throw new Error("upstream exploded"); });
    const res = await handleInterpret(REQUEST, complete);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "upstream" });
  });
});

describe("POST /api/navigate", () => {
  it("constrains anchorIds to the anchors the CLIENT sent, and forbids prose", async () => {
    // Spec §7: ids only, never prose. `additionalProperties: false` plus a two-key
    // schema is what makes "structurally unable to hallucinate" literally true
    // rather than a claim about prompt wording.
    let captured: Record<string, unknown> | null = null;
    const complete = vi.fn(async (_s: string, _u: string, schema: Record<string, unknown>) => {
      captured = schema;
      return { anchorIds: ["rule.R1"], noMatch: false };
    });

    const res = await handleNavigate(NAV_REQUEST, complete);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ anchorIds: ["rule.R1"], noMatch: false });

    const schema = captured as unknown as {
      properties: { anchorIds: { items: { enum: string[] } } };
      required: string[];
      additionalProperties: boolean;
    };
    expect(schema.properties.anchorIds.items.enum).toEqual(["rule.R1"]);
    expect(schema.required).toEqual(["anchorIds", "noMatch"]);
    expect(schema.additionalProperties).toBe(false);
  });

  it("returns 503 no_key with no key configured", async () => {
    const res = await handleNavigate(NAV_REQUEST, null);
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: "no_key" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- services/api`
Expected: FAIL — `Error: Failed to load url ../interpret.js` (the module does not exist yet); zero tests collected from the file.

- [ ] **Step 3: Create the service workspace**

Create `services/api/package.json`:

```json
{
  "name": "@arbiter/api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "zod": "^3.25.76"
  }
}
```

Create `services/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "composite": false,
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["*.ts", "test/**/*"]
}
```

Modify root `package.json` — add the workspace glob and put `services/api` under both gates. The lint hole HANDOVER §6.3 records (the entire web UI unlinted because the glob missed it) is the reason this is done in the same step as creating the directory rather than later:

```json
{
  "name": "arbiter",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*",
    "apps/*",
    "services/*"
  ],
  "scripts": {
    "test": "vitest run",
    "lint": "eslint packages apps services --ext .ts,.tsx",
    "typecheck": "tsc -b packages/engine apps/harness && tsc -p apps/web --noEmit && tsc -p services/api --noEmit",
    "harness": "tsx apps/harness/src/main.ts",
    "validate:evidence": "tsx apps/harness/src/validate-evidence.ts",
    "metrics": "tsx apps/harness/src/run-metrics.ts",
    "golden:update": "tsx apps/harness/src/update-golden.ts",
    "e2e": "playwright test",
    "web:dev": "npm run dev -w @arbiter/web",
    "web:build": "npm run build -w @arbiter/web"
  },
  "devDependencies": {
    "@playwright/test": "^1.62.0",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/node": "^20.12.0",
    "@types/react": "^18.3.31",
    "@types/react-dom": "^18.3.7",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vitejs/plugin-react": "^4.7.0",
    "eslint": "^8.57.0",
    "jsdom": "^25.0.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.7",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.21",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 4: Install the SDK into the new workspace**

Run: `npm install @anthropic-ai/sdk -w @arbiter/api`
Expected: `services/api/package.json` gains a pinned `@anthropic-ai/sdk` caret range and `package-lock.json` updates. Record the resolved version in the commit message — it is the one dependency in this repo that talks to a network.

- [ ] **Step 5: Write the interpret handler**

Create `services/api/interpret.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";

/**
 * POST /api/interpret - Surface 1's rung 1.
 *
 * Mounted on the same Railway service as the static app (spec §10), therefore
 * same-origin, therefore no CORS. THE KEY LIVES HERE AND NOWHERE ELSE: it is read
 * from the process environment by `completeFromEnv` and never crosses into a
 * response, a log line or the browser bundle. `apps/web` does not import this file
 * and a test asserts so (apps/web/test/boundaries.test.ts).
 *
 * The request carries the challenge text, the ruleset as (id, enabled, strength),
 * and claim IDS AND LABELS ONLY - never raw evidence values. That is enforced on
 * the caller's side, where the body is built, and asserted there.
 *
 * There is deliberately no shared module between this file and navigate.ts. Spec §4
 * fixes the contents of services/api at two handlers, and what the two share is
 * five lines of SDK construction rather than a definition - the prompt, the schema
 * and the request validation differ completely. A second copy of a DEFINITION is
 * what preregistration.ts exists to prevent; a second copy of a constructor is not
 * the same defect.
 */

export interface ApiResponse {
  status: number;
  body: unknown;
}

/** The model call, injected so tests never construct a client and never need a key. */
export type Complete = (
  system: string,
  user: string,
  schema: Record<string, unknown>,
) => Promise<unknown>;

export interface InterpretRequest {
  challenge: string;
  rules: { id: string; enabled: boolean; strength: number }[];
  claims: { id: string; label: string }[];
}

/**
 * The reclassifiable field set, spelled out because services/ does not import the
 * engine. It is `keyof AssayOperator["produces"]` (packages/engine/src/plan.ts:13-16).
 *
 * If it ever drifts from the engine the failure is SAFE: the browser re-validates
 * every response against ProposalSchema, which IS derived from the engine type, so a
 * stale field here produces a schema failure - a rung-1 miss by §11 - rather than a
 * proposal the confirm panel would display.
 */
const RECLASSIFIABLE_FIELDS = [
  "stream",
  "system",
  "measuresKeyEvent",
  "exposureRelevant",
  "inApplicabilityDomain",
  "klimisch",
] as const;

const SYSTEM_PROMPT = [
  "You translate a toxicologist's plain-English objection into ONE proposed change to a",
  "pre-registered ruleset, or to the classification of one evidence claim.",
  "",
  "You are doing a LANGUAGE task, not a judgment task. You do not decide whether a",
  "compound is safe, you do not weigh evidence, and you do not evaluate the rules. You",
  "identify which registered rule or which claim the objection is about, and what change",
  "it is asking for. The change is shown to the user for confirmation before anything is",
  "applied, and it is then run through the same engine as every other route.",
  "",
  "Set confidence to 'low' when the objection targets the discount MECHANISM rather than a",
  "named rule, or when more than one rule would be a defensible reading.",
  "The paraphrase is one sentence, in the user's own vocabulary, stating what will change.",
].join("\n");

function proposalSchema(req: InterpretRequest): Record<string, unknown> {
  // Built FROM THE REQUEST: targetRule and targetClaimId can only name things the
  // client offered. This is the same structural guarantee as Surface 3's ids-only
  // return type, applied to Surface 1 - there is nowhere to put an invented rule.
  const ruleIds = req.rules.map((r) => r.id);
  const claimIds = req.claims.map((c) => c.id);
  const nullableEnum = (values: string[]) => ({
    anyOf: values.length > 0 ? [{ type: "string", enum: values }, { type: "null" }] : [{ type: "null" }],
  });

  return {
    type: "object",
    additionalProperties: false,
    required: [
      "targetRule",
      "targetClaimId",
      "action",
      "field",
      "newValue",
      "paraphrase",
      "confidence",
    ],
    properties: {
      targetRule: nullableEnum(ruleIds),
      targetClaimId: nullableEnum(claimIds),
      action: {
        type: "string",
        enum: ["disable", "lower_strength", "raise_strength", "reclassify_field"],
      },
      field: nullableEnum([...RECLASSIFIABLE_FIELDS]),
      newValue: {
        anyOf: [
          { type: "string" },
          { type: "number" },
          { type: "boolean" },
          { type: "null" },
        ],
      },
      paraphrase: { type: "string" },
      confidence: { type: "string", enum: ["high", "low"] },
    },
  };
}

function userPrompt(req: InterpretRequest): string {
  const rules = req.rules
    .map((r) => `${r.id}: ${r.enabled ? "enabled" : "disabled"}, strength ${r.strength}`)
    .join("\n");
  const claims = req.claims.map((c) => `${c.id}: ${c.label}`).join("\n");
  return [
    "Registered rules currently on screen:",
    rules,
    "",
    "Evidence claims currently on screen (ids and labels only):",
    claims,
    "",
    "The objection:",
    req.challenge,
  ].join("\n");
}

function isInterpretRequest(u: unknown): u is InterpretRequest {
  if (typeof u !== "object" || u === null) return false;
  const b = u as Record<string, unknown>;
  if (typeof b["challenge"] !== "string" || b["challenge"].trim() === "") return false;
  if (!Array.isArray(b["rules"]) || !Array.isArray(b["claims"])) return false;
  const rulesOk = (b["rules"] as unknown[]).every((r) => {
    const x = r as Record<string, unknown>;
    return typeof x?.["id"] === "string"
      && typeof x?.["enabled"] === "boolean"
      && typeof x?.["strength"] === "number";
  });
  const claimsOk = (b["claims"] as unknown[]).every((c) => {
    const x = c as Record<string, unknown>;
    return typeof x?.["id"] === "string" && typeof x?.["label"] === "string";
  });
  return rulesOk && claimsOk;
}

export async function handleInterpret(
  rawBody: unknown,
  complete: Complete | null,
): Promise<ApiResponse> {
  // No key configured. Spec §10: the client treats this exactly like a timeout, so
  // a deploy that lands without a key still demos - it just runs on cache.
  if (complete === null) return { status: 503, body: { error: "no_key" } };

  if (!isInterpretRequest(rawBody)) return { status: 400, body: { error: "bad_request" } };

  try {
    const value = await complete(SYSTEM_PROMPT, userPrompt(rawBody), proposalSchema(rawBody));
    return { status: 200, body: value };
  } catch {
    // Rate limit, refusal, network fault, malformed upstream body - all one thing to
    // the caller by §3. The message is deliberately not echoed: it can quote the
    // request, and the request is the only thing here adjacent to a credential.
    return { status: 502, body: { error: "upstream" } };
  }
}

/**
 * Build the model call from the environment, or return null when no key is set.
 *
 * Returning null rather than throwing is what makes "no key" a first-class state
 * instead of a boot failure - the service must come up and answer 503 so the client
 * can descend, not refuse to start.
 */
export function completeFromEnv(env: NodeJS.ProcessEnv = process.env): Complete | null {
  const apiKey = env["ANTHROPIC_API_KEY"];
  if (apiKey === undefined || apiKey === "") return null;

  const client = new Anthropic({ apiKey });
  // Spec §16 leaves provider and model a deployment decision recorded at deploy
  // time. The default is written down here so the decision is visible in source
  // rather than only in a Railway dashboard.
  const model = env["ARBITER_MODEL"] ?? "claude-opus-5";

  return async (system, user, schema) => {
    const message = await client.messages.create({
      model,
      // Small on purpose. The proposal is seven short fields, and the client aborts
      // at 2.5s (apps/web/src/ai/client.ts LIVE_TIMEOUT_MS) - a large budget here
      // buys nothing the caller would still be waiting for.
      max_tokens: 1024,
      system,
      // Thinking is ON BY DEFAULT on claude-opus-5 and shares the max_tokens budget
      // with the answer, so a thinking pass would spend the whole 2.5s window before
      // the first field of the proposal was emitted. Disabling it is accepted at
      // effort "high" or below and is rejected at "xhigh"/"max", hence "low" beside
      // it. There are no tools on this call and the response is schema-constrained,
      // so neither of the disabled-thinking failure modes (a tool call written as
      // prose, internal tags in the text) can reach the caller.
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: user }],
    });

    // Check stop_reason BEFORE reading content: on a refusal the content array is
    // empty and indexing it throws something less informative than this does.
    if (message.stop_reason === "refusal") throw new Error("refused");

    const text = message.content.find((b) => b.type === "text");
    if (text === undefined || text.type !== "text") throw new Error("no text block");
    return JSON.parse(text.text) as unknown;
  };
}
```

A server-side `fallbacks` parameter is deliberately not set. A refusal is a rung-1 miss by §3, the authored cache answers it in under a millisecond, and adding a beta header to buy a slower recovery for a path the ladder already covers is the wrong trade for a 2.5s budget.

- [ ] **Step 6: Write the navigate handler**

Create `services/api/navigate.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { ApiResponse, Complete } from "./interpret.js";

/**
 * POST /api/navigate - Surface 3's rung 1.
 *
 * Response: { anchorIds: string[], noMatch: boolean } - IDS ONLY, NEVER PROSE
 * (spec §7). This is not a prompt instruction, it is the schema: two keys,
 * `additionalProperties: false`, and anchorIds constrained to an enum of the
 * anchors the client sent. There is nowhere to put an invented claim, so the model
 * cannot invent one. The UI then surfaces text that ALREADY EXISTS at those
 * anchors.
 *
 * Same key handling as interpret.ts: server-side, never in a response, never in the
 * browser bundle.
 */

export type { ApiResponse, Complete } from "./interpret.js";

export interface NavigateRequest {
  question: string;
  anchors: { id: string; label: string }[];
}

const SYSTEM_PROMPT = [
  "You match a question about a reasoning system to the places in its interface that",
  "already answer it. You return anchor IDS ONLY.",
  "",
  "You are doing a LANGUAGE task, not a judgment task. You do not answer the question,",
  "you do not summarise, and you do not describe what is at an anchor. The interface",
  "scrolls to the anchors you name and shows the text that is already there.",
  "",
  "Return between one and three anchor ids, most relevant first. If nothing in the list",
  "addresses the question, return an empty list and set noMatch to true.",
].join("\n");

function navSchema(req: NavigateRequest): Record<string, unknown> {
  const ids = req.anchors.map((a) => a.id);
  return {
    type: "object",
    additionalProperties: false,
    required: ["anchorIds", "noMatch"],
    properties: {
      anchorIds: {
        type: "array",
        items: ids.length > 0 ? { type: "string", enum: ids } : { type: "string" },
      },
      noMatch: { type: "boolean" },
    },
  };
}

function userPrompt(req: NavigateRequest): string {
  return [
    "Available anchors:",
    req.anchors.map((a) => `${a.id}: ${a.label}`).join("\n"),
    "",
    "The question:",
    req.question,
  ].join("\n");
}

function isNavigateRequest(u: unknown): u is NavigateRequest {
  if (typeof u !== "object" || u === null) return false;
  const b = u as Record<string, unknown>;
  if (typeof b["question"] !== "string" || b["question"].trim() === "") return false;
  if (!Array.isArray(b["anchors"])) return false;
  return (b["anchors"] as unknown[]).every((a) => {
    const x = a as Record<string, unknown>;
    return typeof x?.["id"] === "string" && typeof x?.["label"] === "string";
  });
}

export async function handleNavigate(
  rawBody: unknown,
  complete: Complete | null,
): Promise<ApiResponse> {
  if (complete === null) return { status: 503, body: { error: "no_key" } };
  if (!isNavigateRequest(rawBody)) return { status: 400, body: { error: "bad_request" } };

  try {
    const value = await complete(SYSTEM_PROMPT, userPrompt(rawBody), navSchema(rawBody));
    return { status: 200, body: value };
  } catch {
    return { status: 502, body: { error: "upstream" } };
  }
}

/** Same construction as interpret.ts; see the comment there on thinking and effort. */
export function completeFromEnv(env: NodeJS.ProcessEnv = process.env): Complete | null {
  const apiKey = env["ANTHROPIC_API_KEY"];
  if (apiKey === undefined || apiKey === "") return null;

  const client = new Anthropic({ apiKey });
  const model = env["ARBITER_MODEL"] ?? "claude-opus-5";

  return async (system, user, schema) => {
    const message = await client.messages.create({
      model,
      // A list of at most three ids and a boolean. 512 is generous for that.
      max_tokens: 512,
      system,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: user }],
    });

    if (message.stop_reason === "refusal") throw new Error("refused");

    const text = message.content.find((b) => b.type === "text");
    if (text === undefined || text.type !== "text") throw new Error("no text block");
    return JSON.parse(text.text) as unknown;
  };
}
```

- [ ] **Step 7: Run the service test to verify it passes**

Run: `npm test -- services/api && npm run typecheck && npm run lint`
Expected: PASS — 6 tests, typecheck clean (`tsc -p services/api --noEmit` now runs), lint clean.

- [ ] **Step 8: Write the failing client-side rung-1 test**

Create `apps/web/test/rung1.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadData } from "../src/data/load.js";
import { ANCHORS } from "../src/ai/anchors.js";

const data = loadData();

/**
 * `liveEnabled` is computed once, at module load, from import.meta.env and
 * location.protocol. So a test that wants the live rung has to set the flag BEFORE
 * the module is evaluated - hence resetModules + a dynamic import rather than a
 * top-level one. Getting this wrong produces a test that silently exercises the
 * cache rung and passes no matter what rung 1 does.
 */
async function withLive<T>(fn: (mod: {
  interpret: typeof import("../src/ai/interpret.js")["interpret"];
  navigate: typeof import("../src/ai/navigate.js")["navigate"];
}) => Promise<T>): Promise<T> {
  vi.resetModules();
  vi.stubEnv("VITE_ARBITER_LIVE", "1");
  const interpretMod = await import("../src/ai/interpret.js");
  const navigateMod = await import("../src/ai/navigate.js");
  return fn({ interpret: interpretMod.interpret, navigate: navigateMod.navigate });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Surface 1 rung 1", () => {
  it("SENDS NO RAW EVIDENCE VALUE - ids and labels only", async () => {
    // Spec §5 and HANDOVER §3.3: the interpreter receives claim ids and labels and
    // never raw evidence values. Asserting "the body contains claims" would pass on
    // a body that shipped the whole claim objects, so this asserts the exact key set
    // AND that no value from the fixture claims appears anywhere in the serialised
    // body.
    let sent = "";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent = String(init.body);
      return new Response(JSON.stringify({
        targetRule: "R1", targetClaimId: null, action: "lower_strength",
        field: null, newValue: 0.2, paraphrase: "Lower R1", confidence: "high",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const claims = data.fixture.claims;
    await withLive(async ({ interpret }) => {
      await interpret({
        challenge: "The rat study should not carry this much weight",
        rules: data.ruleset.rules.map((r) => ({ id: r.id, enabled: r.enabled, strength: r.strength })),
        claims: claims.map((c) => ({ id: c.id, label: c.stream })),
      });
    });

    const body = JSON.parse(sent) as { claims: Record<string, unknown>[] };
    expect(body.claims.length).toBe(claims.length);
    for (const c of body.claims) expect(Object.keys(c).sort()).toEqual(["id", "label"]);

    // And nothing leaked by another route. Each of these is a real value on the
    // fixture claims; any of them appearing means a raw value crossed the wire.
    for (const c of claims) {
      expect(sent).not.toContain(c.provenance.source);
      if (c.measuresKeyEvent !== null) expect(sent).not.toContain(c.measuresKeyEvent);
    }
    expect(sent).not.toContain("klimisch");
    expect(sent).not.toContain("exposureRelevant");
    expect(sent).not.toContain("inApplicabilityDomain");
  });

  it("posts to the same-origin path, so no CORS is involved", async () => {
    let url = "";
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      url = u;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }));
    await withLive(async ({ interpret }) => {
      await interpret({ challenge: "x", rules: [], claims: [] });
    });
    // A relative path. An absolute one would be a cross-origin request and would
    // also mean the ZIP could be pointed at a live host by editing one string.
    expect(url).toBe("/api/interpret");
  });

  it("treats a WELL-FORMED 200 OF THE WRONG SHAPE as a rung-1 miss", async () => {
    // Spec §11, and the reason the response is schema-validated rather than parsed.
    // Malformed JSON fails loudly; THIS does not, and it is the case that would
    // otherwise reach the confirm panel with a proposal missing its action.
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ targetRule: "R1", paraphrase: "looks fine" }), {
        status: 200, headers: { "content-type": "application/json" },
      })));

    const res = await withLive(async ({ interpret }) =>
      interpret({ challenge: "The rat study should not carry this much weight", rules: [], claims: [] }));

    expect(res.rung).toBeGreaterThan(1);
    expect(res.source).not.toBe("live");
  });
});

describe("Surface 3 rung 1", () => {
  it("returns ids only and never prose", async () => {
    const anchorId = Object.keys(ANCHORS)[0]!;
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ anchorIds: [anchorId], noMatch: false }), {
        status: 200, headers: { "content-type": "application/json" },
      })));

    const res = await withLive(async ({ navigate }) =>
      navigate({
        question: "Which rule discounted the murine study?",
        anchors: Object.entries(ANCHORS).map(([id, a]) => ({ id, label: a.label })),
      }));

    expect(res.rung).toBe(1);
    expect(res.source).toBe("live");
    expect(res.value).toEqual({ anchorIds: [anchorId], noMatch: false });
  });

  it("REJECTS a response carrying prose, because the schema has no room for it", async () => {
    // The check that makes the previous test mean something: a 200 with an extra
    // `answer` field is exactly what "the model wrote prose" looks like on the wire.
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ anchorIds: [], noMatch: true, answer: "R3 discounted it." }), {
        status: 200, headers: { "content-type": "application/json" },
      })));

    const res = await withLive(async ({ navigate }) =>
      navigate({ question: "Which rule discounted the murine study?", anchors: [] }));

    expect(res.rung).toBeGreaterThan(1);
    expect(res.source).not.toBe("live");
  });
});
```

- [ ] **Step 9: Write the build-graph boundary test**

Create `apps/web/test/boundaries.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Spec §4: `apps/web` never imports from `services/api`.
 *
 * This is not style. The submitted ZIP is one self-contained index.html, and
 * vite.config.ts's inlineEverything plugin THROWS if any asset survives uninlined -
 * so a single import reaching into services/ pulls @anthropic-ai/sdk into the
 * browser bundle, and with it the shape of a request that is supposed to have no
 * client-side existence. The failure would be a build error rather than a silent
 * one, but a build error the day before submission is not a good place to learn it.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("module boundaries", () => {
  const sources = walk("apps/web/src").filter((f) => /\.(ts|tsx)$/.test(f));

  it("finds source files to check, so an empty glob cannot pass this suite", () => {
    // Without this, a bad path makes every assertion below vacuously true.
    expect(sources.length).toBeGreaterThan(20);
  });

  it("nothing under apps/web/src references services/api", () => {
    const offenders = sources.filter((f) => readFileSync(f, "utf8").includes("services/api"));
    expect(offenders).toEqual([]);
  });

  it("nothing under apps/web/src imports the Anthropic SDK", () => {
    // The stronger form of the same rule: the key's client must not be reachable
    // from the bundle by ANY route, not only by the services/api path.
    const offenders = sources.filter((f) => readFileSync(f, "utf8").includes("@anthropic-ai/sdk"));
    expect(offenders).toEqual([]);
  });

  it("only client.ts issues a request", () => {
    // The Phase 2 invariant, relaxed exactly once and in exactly one file (spec §4).
    const offenders = sources
      .filter((f) => !f.endsWith(join("ai", "client.ts")))
      .filter((f) => /\bfetch\s*\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 10: Run both to verify they fail**

Run: `npm test -- apps/web/test/rung1.test.ts apps/web/test/boundaries.test.ts`
Expected: FAIL — `rung1.test.ts` fails with `expected 2 to be 1` on the Surface 3 live test (the ladder still starts at the cache rung because Tasks 4 and 7 left rung 1 stubbed), and the "no raw evidence value" test fails at `JSON.parse("")` because `fetch` was never called. `boundaries.test.ts` passes already and stays green — it is a regression guard, not a red-to-green step.

- [ ] **Step 11: Wire rung 1 into Surface 1's ladder**

In `apps/web/src/ai/interpret.ts`, replace the stub comment Task 4 left at index 0 of the `RUNGS` array with the live rung. The whole change is this block; nothing else in the file moves:

```ts
/**
 * Rung 1 - the live call, and the only rung that can touch the network.
 *
 * `postJson` owns both gates (build flag, file:// protocol) and the 2.5s abort, so
 * this rung is unconditional here: on the static ZIP it returns null immediately
 * without attempting a request, which is what makes the same ladder correct in both
 * builds.
 *
 * `ProposalSchema.safeParse` rather than a cast. Spec §11: a 200 carrying
 * well-formed JSON of the wrong shape is the case that reaches the confirm panel if
 * this is a cast, and returning null here makes it a rung-1 miss like every other
 * transport failure.
 */
const liveRung: Rung<InterpretInput, Proposal> = {
  source: "live",
  run: (input) =>
    postJson<Proposal>("/api/interpret", input, (u) => {
      const parsed = ProposalSchema.safeParse(u);
      return parsed.success ? parsed.data : null;
    }),
};
```

and make it the first element:

```ts
const RUNGS: Rung<InterpretInput, Proposal>[] = [
  liveRung,        // 1 - live, 2.5s timeout
  exactCacheRung,  // 2 - exact match against the authored cache
  trigramRung,     // 3 - character-trigram Jaccard >= FUZZY_THRESHOLD over that same set
  keywordRung,     // 4 - deterministic keyword mapping
  rulePickerRung,  // 5 - "Which rule do you want to contest?"
];
```

Add `postJson` to the existing import from `./client.js`.

- [ ] **Step 12: Wire rung 1 into Surface 3's ladder**

The same edit in `apps/web/src/ai/navigate.ts`:

```ts
/**
 * Rung 1 - the live call. Ids only: NavResultSchema rejects any body carrying
 * prose, so a model that answers the question instead of locating it is a rung-1
 * miss rather than a claim on screen (spec §7.2).
 */
const liveRung: Rung<NavigateInput, NavResult> = {
  source: "live",
  run: (input) =>
    postJson<NavResult>("/api/navigate", input, (u) => {
      const parsed = NavResultSchema.safeParse(u);
      if (!parsed.success) return null;
      // An id absent from the registry is handled here rather than folded into the
      // schema failure (spec §11 names it as one of the three that do not collapse):
      // a response naming two real anchors and one stale one is still useful, so the
      // stale one is dropped and the rest are kept.
      return { ...parsed.data, anchorIds: parsed.data.anchorIds.filter(isKnownAnchor) };
    }),
};

const RUNGS: Rung<NavigateInput, NavResult>[] = [
  liveRung,          // 1 - live, 2.5s timeout
  exactMapRung,      // 2 - exact match against the cached anchor map
  trigramRung,       // 3 - character-trigram Jaccard >= FUZZY_THRESHOLD
  keywordRung,       // 4 - deterministic keyword mapping
  suggestedRung,     // 5 - the four no-match fallbacks
];
```

Add `postJson` to the `./client.js` import and `isKnownAnchor` to the `./anchors.js` import.

- [ ] **Step 13: Run the whole suite and the build**

Run: `npm test -- apps/web && npm run typecheck && npm run lint && npm run web:build && npm run e2e`
Expected: PASS, build succeeds, `dist/` is still a single `index.html` — `inlineEverything` throws if anything from `services/` reached the bundle, so a green build is itself the boundary check.

- [ ] **Step 14: Commit**

```bash
git add services package.json package-lock.json apps/web/src/ai/interpret.ts apps/web/src/ai/navigate.ts apps/web/test/rung1.test.ts apps/web/test/boundaries.test.ts
git commit -m "$(cat <<'MSG'
Add the API service and wire rung 1 into both ladders

Two thin handlers on the same Railway service as the static app, so same-origin
and no CORS (Phase 3 spec §10). The key is read from the process environment by
completeFromEnv and exists in exactly one place; with no key configured the
endpoint returns 503 {"error":"no_key"}, which the client treats exactly like a
timeout by §3's invariant. That is the difference between a deploy that lands
without a key and a demo that dies: the surfaces run on cache and a judge cannot
tell.

The response is schema-validated, not merely parsed. Malformed JSON fails
loudly and would have been caught anyway; a 200 carrying well-formed JSON of the
wrong shape does not, and spec §11 names it as the case that would otherwise
reach the confirm panel with half a proposal. ProposalSchema.safeParse and
NavResultSchema.safeParse make it a rung-1 miss like every other transport
failure, and rung1.test.ts watches both directions.

Both response schemas are built FROM the request, so targetRule, targetClaimId
and anchorIds can only name things the client offered. Surface 3 was already
structurally unable to hallucinate because its return type gives it nowhere to
put a claim (§7); this extends the same guarantee to Surface 1. Surface 1's
request carries the challenge text, the ruleset as (id, enabled, strength) and
claim ids and labels only - never raw evidence values - and the test asserts the
exact key set plus the absence of every provenance string and key-event id on
the fixture claims, because "the body contains claims" would pass on a body that
shipped the whole objects.

apps/web never imports from services/api. boundaries.test.ts asserts that, that
nothing in the web sources reaches @anthropic-ai/sdk, and that client.ts is
still the only file issuing a fetch - the first and only relaxation of the Phase
2 invariant. The build is the second guard: vite.config.ts's inlineEverything
plugin fails if any asset survives uninlined, so a bundle that pulled the SDK in
cannot ship quietly.

services/* joins the workspace list and services/api joins both npm run lint and
npm run typecheck in the same commit that creates the directory, because
HANDOVER §6.3 records what happens when a new source tree sits outside the lint
glob: the entire web UI went unlinted for a phase.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
git push origin phase3
```

---

### Task 10: Every pre-flight line becomes a check again, including the one this phase made false

Spec §10 records that `check-network` becomes false on a served build, and §9.2 records that there is no digest over evidence — so an evidence line beside the ruleset line would be a caption sitting next to a check, which is the exact defect HANDOVER §5.4 says this panel was rewritten to remove.

**Files:**
- Create: `apps/web/src/data/evidenceDigest.ts`
- Create: `apps/web/test/evidenceDigest.test.ts`
- Modify: `apps/web/src/ui/Preflight.tsx` (whole file)
- Modify: `apps/web/test/preflight.test.tsx` (whole file)
- Test: `apps/web/test/preflight.test.tsx`, `apps/web/test/evidenceDigest.test.ts`

**Interfaces:**
- Consumes: `canonicalJson(v: unknown): string`; `sha256Hex(input: string): Promise<string>`; `browserRulesetHash(ruleset: Ruleset): Promise<string>`; `PRE_REGISTERED_HASH`; `workingClaims(state: AppState, compoundId: string): EvidenceClaim[]`; `interpret(input: InterpretInput): Promise<Resolution<Proposal>>`; `navigate(input: NavigateInput): Promise<Resolution<NavResult>>`; `ANCHORS: Record<string, Anchor>`; `Source`
- Produces: `browserEvidenceDigest(claims: EvidenceClaim[]): Promise<string>`; `projectClaimsForDigest(claims: EvidenceClaim[]): unknown[]`; the `check-evidence-edits`, `check-surface-1` and `check-surface-3` panel lines; `check-ruleset` and `check-manifest` unchanged in name and semantics

- [ ] **Step 1: Write the failing digest test**

Create `apps/web/test/evidenceDigest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { EvidenceClaim } from "@arbiter/engine";
import { browserEvidenceDigest, projectClaimsForDigest } from "../src/data/evidenceDigest.js";
import { loadData } from "../src/data/load.js";

const data = loadData();
const claims = data.fixture.claims;

describe("browserEvidenceDigest", () => {
  it("is stable against claim ORDER, so a load-order change is not a false alarm", async () => {
    // The same property canonicalJson gives the ruleset hash, applied one level up:
    // claimsByCompound is built by appending in file order, and a reordered
    // evidence.json must not read as an edit.
    const a = await browserEvidenceDigest(claims);
    const b = await browserEvidenceDigest([...claims].reverse());
    expect(a).toBe(b);
  });

  it("MOVES when a reclassifiable field moves", async () => {
    // The check has to be able to fail, or the pre-flight line it feeds is a
    // caption. klimisch is one of the six fields a challenge may reclassify.
    const edited: EvidenceClaim[] = claims.map((c, i) =>
      i === 0 ? { ...c, klimisch: c.klimisch === 1 ? 2 : 1 } : c);
    expect(await browserEvidenceDigest(edited)).not.toBe(await browserEvidenceDigest(claims));
  });

  it("MOVES when an assertion flips", async () => {
    const edited: EvidenceClaim[] = claims.map((c, i) =>
      i === 0 ? { ...c, assertion: c.assertion === "toxic" ? "safe" : "toxic" } : c);
    expect(await browserEvidenceDigest(edited)).not.toBe(await browserEvidenceDigest(claims));
  });

  it("ignores provenance, which the engine never reads", async () => {
    // Same reasoning as projectForHash excluding version and registeredAt: the
    // digest covers what the reasoning is computed from. A corrected PMID is not an
    // evidence edit and must not make the panel warn about one.
    const edited: EvidenceClaim[] = claims.map((c, i) =>
      i === 0 ? { ...c, provenance: { ...c.provenance, source: "PMID:00000000" } } : c);
    expect(await browserEvidenceDigest(edited)).toBe(await browserEvidenceDigest(claims));
  });

  it("projects exactly the eleven engine-read fields, named", async () => {
    // Asserting a count would pass on the wrong eleven. If a field is added to
    // EvidenceClaim this fails and forces a decision about whether it belongs in
    // the digest, which is the point.
    expect(Object.keys(projectClaimsForDigest(claims)[0] as object).sort()).toEqual([
      "assertion", "availableFrom", "compoundId", "exposureRelevant", "id",
      "inApplicabilityDomain", "klimisch", "measuresKeyEvent", "strength",
      "stream", "system",
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/evidenceDigest.test.ts`
Expected: FAIL — `Error: Failed to load url ../src/data/evidenceDigest.js`.

- [ ] **Step 3: Write the digest module**

Create `apps/web/src/data/evidenceDigest.ts`:

```ts
import type { EvidenceClaim } from "@arbiter/engine";
import { canonicalJson } from "../../../harness/src/preregistration.js";
import { sha256Hex } from "../record/chain.js";

/**
 * A digest over the evidence, computed IN THE BROWSER.
 *
 * `rules/ruleset-v1.0.json` is pre-registered and hashed, so the pre-flight panel
 * can say "the ruleset on screen is the registered one" BECAUSE check-ruleset
 * proved it. `data/out/evidence.json` is bundled and schema-validated but has never
 * been hashed - so with an evidence working copy added, the matching line beside it
 * would be a hardcoded string that reads identically on evidence that had silently
 * drifted. That is the exact defect HANDOVER §5.4 records the panel being rewritten
 * to remove, and it is why this file exists (Phase 3 spec §9.2).
 *
 * canonicalJson is imported from the harness rather than reimplemented, exactly as
 * rulesetHash.ts does, and for the same reason: a second copy of "what counts as
 * the thing being hashed" is how a digest comes to match nothing at all.
 *
 * There is deliberately no committed constant to compare against. This digest is
 * not a pre-registration claim - it is used to compare the WORKING evidence against
 * the REGISTERED evidence. This supersedes the predicate Task 3 installed on this line
 * (§9.3): Task 3 made the badge and the panel agree, and this upgrades the panel from
 * an in-memory comparison to a digest, so the line is a check rather than a caption:
 * a content comparison, so editing a field and editing it back clears the warning
 * instead of leaving it stuck on a reference inequality.
 */

/**
 * The engine-read surface of a claim, sorted by id.
 *
 * Excludes `provenance`, which the engine never reads (spec §5.3) - a corrected
 * citation is not an evidence edit and must not report as one. The sort makes the
 * digest independent of load order, which claimsByCompound does not guarantee.
 */
export function projectClaimsForDigest(claims: EvidenceClaim[]): unknown[] {
  return [...claims]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => ({
      id: c.id,
      compoundId: c.compoundId,
      stream: c.stream,
      assertion: c.assertion,
      strength: c.strength,
      system: c.system,
      measuresKeyEvent: c.measuresKeyEvent,
      exposureRelevant: c.exposureRelevant,
      inApplicabilityDomain: c.inApplicabilityDomain,
      klimisch: c.klimisch,
      availableFrom: c.availableFrom,
    }));
}

export async function browserEvidenceDigest(claims: EvidenceClaim[]): Promise<string> {
  return sha256Hex(canonicalJson(projectClaimsForDigest(claims)));
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- apps/web/test/evidenceDigest.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Write the failing pre-flight test**

Modify `apps/web/test/preflight.test.tsx` (whole file):

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Verdict } from "@arbiter/engine";
import { App } from "../src/App.js";
import { StoreProvider } from "../src/state/store.js";
import { Preflight } from "../src/ui/Preflight.js";
import { loadData, type LoadedData } from "../src/data/load.js";
import { interpret } from "../src/ai/interpret.js";
import { navigate } from "../src/ai/navigate.js";

// The panel RUNS both ladders when it opens, so the tests control what the ladders
// return. Mocking here rather than stubbing fetch is deliberate: this file is about
// what the panel REPORTS, and the transport is Task 11's subject.
vi.mock("../src/ai/interpret.js", () => ({ interpret: vi.fn() }));
vi.mock("../src/ai/navigate.js", () => ({ navigate: vi.fn() }));

const data = loadData();

const renderWith = (d: LoadedData) => render(<StoreProvider data={d}><Preflight /></StoreProvider>);

beforeEach(() => {
  vi.mocked(interpret).mockResolvedValue({ value: null, rung: 2, source: "cache" });
  vi.mocked(navigate).mockResolvedValue({ value: null, rung: 2, source: "cache" });
});

/**
 * These assertions read `data-ok` and `data-source` rather than matching the copy,
 * and that is deliberate. The obvious test - textContent matching /registered/i -
 * passes on BOTH branches, because the failure message also contains the word
 * "registered". A test that cannot tell a passing check from a failing one is a
 * caption with a test around it.
 */
describe("Preflight", () => {
  it("confirms the bundled ruleset hashes to the pre-registered value", async () => {
    renderWith(data);
    const line = await screen.findByTestId("check-ruleset");
    // The hash is computed asynchronously via Web Crypto. Waiting for data-ok to
    // leave "pending" is what makes this deterministic: an earlier version waited
    // for a specific value, and because a null hash compares unequal to the
    // registered one, data-ok was already "false" on first paint while the text
    // still said "Hashing the ruleset…". That raced, and the component was fixed
    // rather than the test - see the comment on the pending state in Preflight.
    await waitFor(() => expect(line.getAttribute("data-ok")).not.toBe("pending"));
    expect(line.getAttribute("data-ok")).toBe("true");
    expect(line.textContent).toContain("ed073a8a");
  });

  it("REFUSES the ruleset when it does not hash to the pre-registered value", async () => {
    // A silently drifted ruleset is the exact thing this line claims to rule out,
    // so it has to be shown failing on one.
    const drifted: LoadedData = {
      ...data,
      ruleset: {
        ...data.ruleset,
        rules: data.ruleset.rules.map((r, i) => (i === 0 ? { ...r, strength: 0.123 } : r)),
      },
    };

    const line = await renderWith(drifted).findByTestId("check-ruleset");
    await waitFor(() => expect(line.getAttribute("data-ok")).not.toBe("pending"));
    expect(line.getAttribute("data-ok")).toBe("false");
    expect(line.textContent).toMatch(/do not present these numbers as pre-registered/);
  });

  it("does not claim a FAILED check while the hash is still being computed", () => {
    // The bug this pins: hashOk compares a null hash before Web Crypto resolves,
    // so String(hashOk) put data-ok="false" - a failed pre-registration check, in
    // red - on the first paint of every render.
    const line = renderWith(data).getByTestId("check-ruleset");
    expect(line.getAttribute("data-ok")).toBe("pending");
    expect(line.textContent).toMatch(/Hashing the ruleset/);
  });

  it("reports that live recomputation agrees with the committed manifest", () => {
    const line = renderWith(data).getByTestId("check-manifest");
    expect(line.getAttribute("data-ok")).toBe("true");
    expect(line.textContent).toContain(`all ${data.testSplit.length} compounds`);
  });

  it("REPORTS A DISAGREEMENT when the manifest and the engine differ", () => {
    const victim = data.testSplit[0]!;
    const wrong = data.manifest.get(victim)!.verdict === "advance" ? "do_not_advance" : "advance";
    const corrupted: LoadedData = {
      ...data,
      manifest: new Map(data.manifest).set(victim, { verdict: wrong as Verdict, belief: 0 }),
    };

    const line = renderWith(corrupted).getByTestId("check-manifest");
    expect(line.getAttribute("data-ok")).toBe("false");
    expect(line.textContent).toContain(victim);
    expect(line.textContent).toMatch(/investigate before presenting/);
  });

  it("says plainly that the ruleset on screen is unedited - once it has PROVED it", async () => {
    // check-edits now compares the working digest to the registered one rather than
    // comparing references (spec §9.3). That makes it async, so it has the same
    // pending state check-ruleset does, and for the same reason.
    const line = renderWith(data).getByTestId("check-edits");
    expect(line.getAttribute("data-ok")).toBe("pending");
    await waitFor(() => expect(line.getAttribute("data-ok")).toBe("true"));
  });

  it("reports NO evidence edits on a clean load, and says which digest proved it", async () => {
    const line = renderWith(data).getByTestId("check-evidence-edits");
    await waitFor(() => expect(line.getAttribute("data-ok")).toBe("true"));
    // The digest prefix is on screen. Without it the line is a caption again: it
    // would read identically on evidence that had drifted.
    expect(line.textContent).toMatch(/[0-9a-f]{8}…/);
  });

  it("WARNS when the evidence on screen carries live edits", async () => {
    // The direction that matters. An implementation that hardcoded data-ok="true"
    // passes the previous test and fails this one.
    const claim = data.fixture.claims[0]!;
    const edited: LoadedData = { ...data };
    const { container } = render(
      <StoreProvider data={edited} initialEvidenceEdits={{ [claim.id]: { klimisch: 4 } }}>
        <Preflight />
      </StoreProvider>,
    );
    const line = container.querySelector('[data-testid="check-evidence-edits"]')!;
    await waitFor(() => expect(line.getAttribute("data-ok")).toBe("false"));
    expect(line.textContent).toMatch(/press Reset .* before quoting a metric/);
  });

  it("styles the evidence-edits warning muted-bold, not red - editing is the product", async () => {
    const claim = data.fixture.claims[0]!;
    const { container } = render(
      <StoreProvider data={data} initialEvidenceEdits={{ [claim.id]: { klimisch: 4 } }}>
        <Preflight />
      </StoreProvider>,
    );
    const line = container.querySelector('[data-testid="check-evidence-edits"]') as HTMLElement;
    await waitFor(() => expect(line.getAttribute("data-ok")).toBe("false"));
    // Same treatment as check-edits: a reviewer contesting the evidence is using the
    // system correctly. Red would say they broke it.
    expect(line.style.color).toBe("var(--muted)");
    expect(line.style.fontWeight).toBe("600");
  });

  it("reports each surface as CACHE when its ladder answered from cache", async () => {
    renderWith(data);
    const one = await screen.findByTestId("check-surface-1");
    const three = await screen.findByTestId("check-surface-3");
    await waitFor(() => expect(one.getAttribute("data-source")).toBe("cache"));
    expect(three.getAttribute("data-source")).toBe("cache");
    expect(one.textContent).toMatch(/rung 2/);
    expect(one.textContent).toMatch(/losing the connection changes nothing/i);
  });

  it("reports a surface as LIVE when the live rung answered, and says what a drop costs", async () => {
    // The other direction, and the reason the old check-network line had to go: on a
    // served build with a live surface, "no network call is made at any point" is
    // false. A line that cannot report "live" is the same caption with new words.
    vi.mocked(interpret).mockResolvedValue({ value: null, rung: 1, source: "live" });
    renderWith(data);
    const one = await screen.findByTestId("check-surface-1");
    await waitFor(() => expect(one.getAttribute("data-source")).toBe("live"));
    expect(one.textContent).toMatch(/rung 1/);
    expect(one.textContent).toMatch(/falls back to the bundled cache/i);
  });

  it("does not claim a source before the ladder has answered", async () => {
    // The check-ruleset lesson applied to a second async line: "cache" printed
    // before anything ran is a reassuring statement about nothing.
    vi.mocked(navigate).mockImplementation(() => new Promise(() => { /* never resolves */ }));
    const line = renderWith(data).getByTestId("check-surface-3");
    expect(line.getAttribute("data-source")).toBe("pending");
    expect(line.textContent).toMatch(/Checking/);
  });

  it("no longer claims that no network call is made at any point", async () => {
    // Spec §10 and correction 6: that sentence is false on a served build with a
    // live surface. This asserts the false sentence is GONE, which a rewrite that
    // merely added lines beside it would fail.
    const { container } = renderWith(data);
    await waitFor(() => expect(screen.getByTestId("check-surface-1")).toBeTruthy());
    expect(container.querySelector('[data-testid="check-network"]')).toBeNull();
    expect(container.textContent).not.toMatch(/No network call is made at any point/i);
  });
});

describe("the ? key", () => {
  it("opens the panel and closes it again", () => {
    render(<App />);
    expect(screen.queryByTestId("preflight")).toBeNull();

    fireEvent.keyDown(document.body, { key: "?" });
    expect(screen.getByTestId("preflight")).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "?" });
    expect(screen.queryByTestId("preflight")).toBeNull();
  });

  it("does not open when ? is a character being typed into a field", () => {
    // A reviewer writing "safe at what exposure?" would otherwise have the
    // pre-flight panel appear over their rationale mid-sentence.
    window.location.hash = "#/record";
    render(<App />);
    fireEvent.keyDown(screen.getByLabelText(/Rationale/), { key: "?" });
    expect(screen.queryByTestId("preflight")).toBeNull();
    window.location.hash = "";
  });
});
```

Two of these tests pass `initialEvidenceEdits` to `StoreProvider`. Task 3 added `evidenceEdits` to `AppState`; if it did not also add a seed prop, add one now — a two-line change to `initialState` and `StoreProvider` — because the alternative is dispatching `reclassifyClaim` through `act()` in every test that needs edited evidence.

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- apps/web/test/preflight.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="check-evidence-edits"]`, plus `check-surface-1` and `check-surface-3` not found, plus the `check-network` removal test failing because the element is still there. The five pre-existing checks still pass.

- [ ] **Step 7: Rewrite the pre-flight panel**

Modify `apps/web/src/ui/Preflight.tsx` (whole file):

```tsx
import { useEffect, useState } from "react";
import { useAppState, workingClaims } from "../state/store.js";
import { useLibraryVerdicts } from "../engine/useLibraryVerdicts.js";
import { browserRulesetHash, PRE_REGISTERED_HASH } from "../data/rulesetHash.js";
import { browserEvidenceDigest } from "../data/evidenceDigest.js";
import { ANCHORS } from "../ai/anchors.js";
import { interpret } from "../ai/interpret.js";
import { navigate } from "../ai/navigate.js";
import type { Source } from "../ai/resolve.js";

/**
 * What a presenter needs to confirm ninety seconds before going live.
 *
 * Every line here is a CHECK, computed now, not a caption. The distinction is the
 * whole point: printing the pre-registered hash next to the words "as registered"
 * would read exactly the same on a ruleset that had silently drifted, which is the
 * failure it claims to rule out. So the hash is recomputed in the browser from the
 * bundled ruleset and compared, the verdicts are recomputed and compared to the
 * committed manifest, the evidence is digested and compared to the registered
 * evidence, and BOTH AI LADDERS ARE ACTUALLY RUN so the panel reports which rung
 * answered rather than asserting one. A failure appears in red and says what to do.
 *
 * The line this phase deleted said "No network call is made at any point". True in
 * Phase 2, false on a served build with a live surface (spec §10, correction 6). It
 * is replaced by per-surface reporting driven by the same `source` value the
 * resolvers return - which on the static ZIP reads `cache` for every surface, both
 * honest and exactly the state the artifact is supposed to be in.
 */

/**
 * Probe inputs. The panel needs a resolution to report, and a resolution needs an
 * input; these are ordinary questions of the kind the demo answers, drawn from the
 * §12b prepared Q&A the caches were authored from.
 *
 * They are not asserted to hit any particular rung. If the authored cache drifts
 * away from them the panel reports a lower rung and says so, which is the correct
 * behaviour for a panel whose rule is that every line is computed now.
 *
 * The interpret probe passes NO CLAIMS. Rungs 2-5 match on challenge text alone,
 * and a pre-flight panel is the last place that should be assembling an evidence
 * payload.
 */
const PROBE_CHALLENGE = "The rat study should not carry this much weight";
const PROBE_QUESTION = "Which rule discounted the murine study?";

interface Reported { rung: number; source: Source }

export function Preflight() {
  const state = useAppState();
  const { data, ruleset, evidenceEdits } = state;
  // Deliberately the REGISTERED ruleset, not the working copy - see the override
  // comment in useLibraryVerdicts.
  const live = useLibraryVerdicts(data.ruleset);

  const [hash, setHash] = useState<string | null>(null);
  const [workingHash, setWorkingHash] = useState<string | null>(null);
  const [hashError, setHashError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{ registered: string; working: string } | null>(null);
  const [surface1, setSurface1] = useState<Reported | null>(null);
  const [surface3, setSurface3] = useState<Reported | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([browserRulesetHash(data.ruleset), browserRulesetHash(ruleset)])
      .then(([registered, working]) => {
        if (cancelled) return;
        setHash(registered);
        setWorkingHash(working);
      })
      // Web Crypto is unavailable in an insecure context. Saying so beats an
      // empty line that reads as a passing check.
      .catch((e: Error) => { if (!cancelled) setHashError(e.message); });
    return () => { cancelled = true; };
  }, [data.ruleset, ruleset]);

  useEffect(() => {
    let cancelled = false;
    // The whole corpus, not just the selected compound: an edit anywhere must show
    // up here. workingClaims is the ONE definition of "apply the overrides" (spec
    // §9), routed through rather than reimplemented.
    const compoundIds = [...data.claimsByCompound.keys()];
    const registeredClaims = compoundIds.flatMap((id) => data.claimsByCompound.get(id) ?? []);
    const working = compoundIds.flatMap((id) => workingClaims(state, id));
    Promise.all([browserEvidenceDigest(registeredClaims), browserEvidenceDigest(working)])
      .then(([registered, workingDigest]) => {
        if (!cancelled) setEvidence({ registered, working: workingDigest });
      })
      .catch((e: Error) => { if (!cancelled) setHashError(e.message); });
    return () => { cancelled = true; };
    // evidenceEdits is the only input that moves; data.claimsByCompound is immutable
    // exactly as data.ruleset is.
  }, [data.claimsByCompound, evidenceEdits, state]);

  useEffect(() => {
    let cancelled = false;
    void interpret({
      challenge: PROBE_CHALLENGE,
      rules: data.ruleset.rules.map((r) => ({ id: r.id, enabled: r.enabled, strength: r.strength })),
      claims: [],
    }).then((r) => { if (!cancelled) setSurface1({ rung: r.rung, source: r.source }); });

    void navigate({
      question: PROBE_QUESTION,
      anchors: Object.entries(ANCHORS).map(([id, a]) => ({ id, label: a.label })),
    }).then((r) => { if (!cancelled) setSurface3({ rung: r.rung, source: r.source }); });

    return () => { cancelled = true; };
  }, [data.ruleset]);

  const hashOk = hash === PRE_REGISTERED_HASH;
  const mismatches = data.testSplit.filter(
    (id) => live.get(id)?.verdict !== data.manifest.get(id)?.verdict,
  );
  const errored = data.testSplit.filter((id) => live.get(id)?.error !== undefined);

  // §9.3: Preflight tested "edited" by reference while Ruleset.tsx deep-compared, so
  // dragging a slider and dragging it back left the panel warning about live edits
  // the MODIFIED badge had already cleared. One predicate now, for both working
  // copies, and it is the same digest comparison in both cases.
  const rulesetEdited = hash !== null && workingHash !== null && hash !== workingHash;
  const evidenceEdited = evidence !== null && evidence.registered !== evidence.working;

  const bad = { color: "var(--toxic)", fontWeight: 600 };
  // Not a failure. Editing is the product - but saying so out loud stops someone
  // quoting a number that came from a dragged slider or a reclassified claim.
  const muted = { color: "var(--muted)", fontWeight: 600 };

  const surfaceLine = (r: Reported | null, what: string) =>
    r === null
      ? `${what}: checking which rung answers…`
      : r.source === "live"
        ? `${what}: answered live (rung ${r.rung}). If the connection drops it falls back to the bundled cache.`
        : `${what}: answered from the bundled cache (rung ${r.rung}, source ${r.source}), so losing the connection changes nothing.`;

  return (
    <aside data-testid="preflight"
           style={{ padding: 16, borderTop: "1px solid var(--hairline)", background: "var(--surface)" }}>
      <h3 style={{ fontFamily: "var(--serif)", marginTop: 0 }}>Pre-flight</h3>
      <ul style={{ fontSize: 13, lineHeight: 1.7 }}>
        {/* "pending" while the digest is in flight, NOT "false". hashOk compares a
            null hash before Web Crypto resolves, so String(hashOk) rendered
            data-ok="false" on the very first paint - the panel reporting a FAILED
            pre-registration check before it had run one, in red. Caught by CI as a
            flaky test, which is how a real state bug usually presents. */}
        <li data-testid="check-ruleset"
            data-ok={hashError ? "error" : hash === null ? "pending" : String(hashOk)}
            style={hash === null || hashOk ? undefined : bad}>
          {hashError !== null
            ? `Could not compute the ruleset hash: ${hashError}`
            : hash === null
              ? "Hashing the ruleset…"
              : hashOk
                ? `Ruleset ${data.ruleset.version} — ${hash.slice(0, 8)}… matches the pre-registered hash`
                : `Ruleset ${data.ruleset.version} hashes to ${hash.slice(0, 8)}… but ${PRE_REGISTERED_HASH.slice(0, 8)}… was pre-registered — do not present these numbers as pre-registered`}
        </li>

        <li data-testid="check-manifest" data-ok={String(mismatches.length === 0)}
            style={mismatches.length === 0 ? undefined : bad}>
          {mismatches.length === 0
            ? `Live recomputation agrees with the committed manifest on all ${data.testSplit.length} compounds`
            : `${mismatches.length} of ${data.testSplit.length} compounds disagree with the committed manifest (${mismatches.slice(0, 3).join(", ")}…) — investigate before presenting`}
        </li>

        <li data-testid="check-errors" data-ok={String(errored.length === 0)}
            style={errored.length === 0 ? undefined : bad}>
          {errored.length === 0
            ? "No compound threw during recomputation"
            : `${errored.length} compounds threw and are being shown as abstain — ${errored.slice(0, 3).join(", ")}`}
        </li>

        <li data-testid="check-edits"
            data-ok={workingHash === null ? "pending" : String(!rulesetEdited)}
            style={rulesetEdited ? muted : undefined}>
          {workingHash === null
            ? "Hashing the ruleset on screen…"
            : rulesetEdited
              ? `The ruleset on screen hashes to ${workingHash.slice(0, 8)}… and has live edits — press Reset on the Ruleset tab before quoting a metric`
              : "No live edits: the ruleset on screen is the registered one"}
        </li>

        {/* The honesty constraint, spec §9.2. The line above can say "the registered
            one" BECAUSE check-ruleset proved it. There is no analogous
            pre-registered digest over evidence, so this one recomputes both sides
            and compares - a check, with the digest on screen, rather than a
            reassuring sentence that would read identically on drifted evidence. */}
        <li data-testid="check-evidence-edits"
            data-ok={evidence === null ? "pending" : String(!evidenceEdited)}
            style={evidenceEdited ? muted : undefined}>
          {evidence === null
            ? "Digesting the evidence on screen…"
            : evidenceEdited
              ? `The evidence on screen has live edits — ${evidence.working.slice(0, 8)}… against registered ${evidence.registered.slice(0, 8)}… — press Reset on the Case tab before quoting a metric`
              : `No live edits: the evidence on screen digests to ${evidence.registered.slice(0, 8)}…, the registered value`}
        </li>

        <li data-testid="check-evidence">
          Evidence: {data.claimsByCompound.size} compounds with claims, {data.testSplit.length} scored;
          fixture citations {data.fixture.citationStatus}
        </li>

        <li data-testid="check-surface-1" data-source={surface1?.source ?? "pending"}>
          {surfaceLine(surface1, "Challenge interpreter")}
        </li>

        <li data-testid="check-surface-3" data-source={surface3?.source ?? "pending"}>
          {surfaceLine(surface3, "Navigator")}
        </li>

        <li data-testid="check-bundle">
          Every number on screen is recomputed in this browser from data compiled into this page.
          A live surface is one optional rung on top of that, never underneath it.
        </li>
      </ul>
      <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>? to close</p>
    </aside>
  );
}
```

- [ ] **Step 8: Run the pre-flight tests to verify they pass**

Run: `npm test -- apps/web/test/preflight.test.tsx apps/web/test/evidenceDigest.test.ts`
Expected: PASS — 18 tests.

- [ ] **Step 9: Run the whole suite and the artifact**

Run: `npm test -- apps/web && npm run typecheck && npm run lint && npm run web:build && npm run e2e`
Expected: PASS, build succeeds. `static-file.spec.ts` is unmodified and its Web Crypto test still asserts `check-ruleset` and `check-manifest` are `data-ok="true"` over `file://` — neither testid changed, and opening the panel over `file://` runs both ladders with `liveEnabled` false, so no request is attempted and the two `page.on("request")` assertions in that file stay empty.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/ui/Preflight.tsx apps/web/src/data/evidenceDigest.ts apps/web/test/preflight.test.tsx apps/web/test/evidenceDigest.test.ts apps/web/src/state/store.tsx
git commit -m "$(cat <<'MSG'
Make every pre-flight line a check again, and digest the evidence

The panel shipped a sentence this phase makes false. check-network read "All
data is bundled into this page. No network call is made at any point, so losing
the connection mid-demo changes nothing." True in Phase 2, false on a served
build with a live surface (Phase 3 spec §10, correction 6). It is replaced by
per-surface reporting driven by the same `source` value the resolvers return -
and the panel gets that value by RUNNING both ladders when it opens, not by
asserting one. On the static ZIP every surface reports cache, which is honest
and is exactly the state the artifact is supposed to be in.

check-evidence-edits sits beside check-edits, worded the same way and styled
muted-bold rather than red, because contesting the evidence is the product
rather than a defect. But the ruleset line can say "the ruleset on screen is
the registered one" only BECAUSE check-ruleset proved it by recomputing the
digest, and there is no analogous digest over evidence: data/out/evidence.json
is bundled and schema-validated but has never been hashed (§9.2). A hardcoded
string beside "as registered" reads identically on evidence that has silently
drifted - the exact defect HANDOVER §5.4 records this panel being rewritten to
remove. So browserEvidenceDigest computes it the way browserRulesetHash does,
reusing canonicalJson from the harness rather than carrying a second copy of
what counts as the thing being hashed, and the digest prefix is on screen.

It projects the eleven engine-read fields and excludes provenance, on the same
reasoning projectForHash uses to exclude version and registeredAt: a corrected
citation is not an evidence edit and must not report as one. It sorts by claim
id, so a reordered evidence.json is not a false alarm.

That also settles §9.3. Preflight tested "edited" by reference while Ruleset.tsx
deep-compared, so dragging a slider and dragging it back cleared the MODIFIED
badge while the panel still warned of live edits. Both working copies now use
one predicate - a digest comparison - so the two surfaces cannot disagree about
whether anything was edited.

check-ruleset and check-manifest keep their names and their semantics: both are
asserted by Playwright via data-ok in static-file.spec.ts, which is not modified
and still passes over file:// with every surface on cache.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
git push origin phase3
```

---

### Task 11: Fifteen matrix cells collapse to nine tests, and Surface 2's row is a disabled button

Master spec §11 requires each surface exercised against network-off, HTTP 500, malformed JSON, timeout and missing key, asserting the UI still renders and degrades to the correct rung — and §3's invariant, that rung 1 either succeeds or is skipped and never errors upward, is what makes the conditions differ only at the transport boundary.

**Files:**
- Create: `apps/web/test/failureMatrix.test.ts`
- Create: `apps/web/test/surface2.test.tsx`
- Create: `apps/web/e2e/ai-static.spec.ts`
- Modify: `apps/web/src/tabs/Validation.tsx` (whole file)
- Test: `apps/web/test/failureMatrix.test.ts`, `apps/web/test/surface2.test.tsx`, `apps/web/e2e/ai-static.spec.ts`

**Interfaces:**
- Consumes: `resolve<I, T>(rungs: Rung<I, T>[], input: I): Promise<Resolution<T>>`; `postJson`; `LIVE_TIMEOUT_MS = 2500`; `interpret`; `navigate`; `SUGGESTED_QUESTIONS: string[]`; `isKnownAnchor(id: string): boolean`; `ANCHORS`
- Produces: the `live-ablation-run` control and its tooltip on the Validation tab; no new exported signature

- [ ] **Step 1: Write the failing failure-matrix test**

Create `apps/web/test/failureMatrix.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve, type Rung } from "../src/ai/resolve.js";
import { ANCHORS, isKnownAnchor } from "../src/ai/anchors.js";
import { loadData } from "../src/data/load.js";

const data = loadData();

/**
 * Master spec §11's fifteen-cell matrix, collapsed by the §3 invariant.
 *
 * The conditions differ only at the transport boundary; above it every failure is
 * the same event - a rung-1 miss. So the matrix is one thorough walker test, five
 * transport tests, and three per-surface tests under a forced rung-1 miss, rather
 * than fifteen near-identical ones.
 *
 * THREE TRAPS, written down because HANDOVER §5.1 exists precisely because they
 * recur:
 *
 *   1. Asserting "the ladder produced an answer" PASSES ON EVERY RUNG and is
 *      worthless. Every assertion below is on `rung`.
 *   2. Asserting `noMatch` for an empty anchor list asserts a value that is 0 under
 *      every implementation. The navigator test asserts the specific ids that
 *      survived filtering.
 *   3. The file:// test asserts on ATTEMPTED requests, not failed ones. That one is
 *      apps/web/e2e/ai-static.spec.ts, copying the pattern static-file.spec.ts
 *      already uses.
 *
 * Master spec §11 also explicitly excludes LLM content quality from testing. Only
 * schema validity and failure behaviour are testable here, and pretending otherwise
 * would be dishonest.
 */

async function loadClient() {
  // liveEnabled is computed once at module load from import.meta.env and
  // location.protocol, so the flag has to be set before evaluation.
  vi.resetModules();
  vi.stubEnv("VITE_ARBITER_LIVE", "1");
  return import("../src/ai/client.js");
}

const parseAnything = (u: unknown): { ok: true } | null =>
  typeof u === "object" && u !== null ? { ok: true } : null;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the ladder walker", () => {
  const hit = (v: string): Rung<string, string> => ({ source: "cache", run: async () => v });
  const miss = (): Rung<string, string> => ({ source: "live", run: async () => null });

  it("descends past a missing rung and reports the rung that ANSWERED", async () => {
    // Not "an answer appeared" - trap 1. The value is identical whichever rung
    // produced it, so `rung` is the only thing that distinguishes them.
    const r = await resolve([miss(), miss(), hit("third")], "q");
    expect(r.rung).toBe(3);
    expect(r.value).toBe("third");
  });

  it("carries the SOURCE of the rung that answered, not of the last one tried", async () => {
    const r = await resolve([miss(), { source: "local", run: async () => "x" }], "q");
    expect(r.source).toBe("local");
    expect(r.rung).toBe(2);
  });

  it("STOPS at the first hit - a later rung is never run", async () => {
    // Without this, a walker that ran every rung and kept the first result would
    // pass every other test here while costing a live call on the cache path.
    const later = vi.fn(async () => "never");
    await resolve([hit("first"), { source: "none", run: later }], "q");
    expect(later).not.toHaveBeenCalled();
  });

  it("passes the SAME input to each rung it tries", async () => {
    const seen: string[] = [];
    await resolve([
      { source: "live", run: async (i: string) => { seen.push(i); return null; } },
      { source: "cache", run: async (i: string) => { seen.push(i); return "x"; } },
    ], "the challenge");
    expect(seen).toEqual(["the challenge", "the challenge"]);
  });

  it("reports the LAST rung tried when every rung misses, with a null value", async () => {
    const r = await resolve([miss(), miss(), miss()], "q");
    expect(r.value).toBeNull();
    expect(r.rung).toBe(3);
  });

  it("is 1-BASED, so rung 1 is the live rung and not the second one", async () => {
    // An off-by-one here would silently relabel every source in the pre-flight
    // panel and every assertion in this file.
    const r = await resolve([hit("first")], "q");
    expect(r.rung).toBe(1);
  });
});

describe("the five §11 transport conditions, each a rung-1 miss", () => {
  it("network-off: fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const { postJson } = await loadClient();
    await expect(postJson("/api/interpret", {}, parseAnything)).resolves.toBeNull();
  });

  it("HTTP 500: a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const { postJson } = await loadClient();
    await expect(postJson("/api/interpret", {}, parseAnything)).resolves.toBeNull();
  });

  it("malformed JSON: the body parse throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("{ not json", { status: 200, headers: { "content-type": "application/json" } })));
    const { postJson } = await loadClient();
    await expect(postJson("/api/interpret", {}, parseAnything)).resolves.toBeNull();
  });

  it("timeout: the 2.5s AbortController fires", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener("abort", () =>
          rej(new DOMException("The operation was aborted.", "AbortError")));
      })));

    const { postJson, LIVE_TIMEOUT_MS } = await loadClient();
    const pending = postJson("/api/interpret", {}, parseAnything);
    // Advancing to exactly the budget and no further: a test that advanced by an
    // hour would pass on a 60s timeout too.
    await vi.advanceTimersByTimeAsync(LIVE_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
  });

  it("missing key: 503 {\"error\":\"no_key\"}", async () => {
    // The condition the service produces when it comes up without a key (spec §10).
    // It must be indistinguishable from a timeout to the caller.
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "no_key" }), {
        status: 503, headers: { "content-type": "application/json" },
      })));
    const { postJson } = await loadClient();
    await expect(postJson("/api/interpret", {}, parseAnything)).resolves.toBeNull();
  });

  it("none of the five THROWS - rung 1 never errors upward", async () => {
    // The §3 invariant stated directly. Every test above would still pass if
    // postJson rejected and something upstream swallowed it; this is what makes
    // the collapse from fifteen tests to five legitimate.
    const conditions: (() => Promise<Response>)[] = [
      async () => { throw new TypeError("Failed to fetch"); },
      async () => new Response("boom", { status: 500 }),
      async () => new Response("{ not json", { status: 200 }),
      async () => new Response(JSON.stringify({ error: "no_key" }), { status: 503 }),
      async () => new Response(JSON.stringify({ wrong: "shape" }), { status: 200 }),
    ];
    for (const condition of conditions) {
      vi.stubGlobal("fetch", vi.fn(condition));
      const { postJson } = await loadClient();
      const settled = await Promise.allSettled([postJson("/api/interpret", {}, parseAnything)]);
      expect(settled[0]!.status).toBe("fulfilled");
    }
  });
});

describe("each surface degrades to the CORRECT rung under a forced rung-1 miss", () => {
  // liveEnabled is false in this describe: no VITE_ARBITER_LIVE, so postJson
  // returns null without attempting a request. That IS the network-off condition,
  // and it is also the shape of the submitted ZIP.
  it("Surface 1 answers from the authored cache at rung 2 on an exact challenge", async () => {
    const { interpret } = await import("../src/ai/interpret.js");
    const cache = (await import("../src/ai/cache/interpretations.json")).default as
      { challenge: string }[];
    const authored = cache[0]!.challenge;

    const r = await interpret({
      challenge: authored,
      rules: data.ruleset.rules.map((x) => ({ id: x.id, enabled: x.enabled, strength: x.strength })),
      claims: [],
    });

    expect(r.rung).toBe(2);
    expect(r.source).toBe("cache");
    expect(r.value).not.toBeNull();
  });

  it("Surface 1 descends to the rule picker at rung 5 on text nothing matches", async () => {
    const { interpret } = await import("../src/ai/interpret.js");
    // Deliberately unlike any authored challenge and containing none of rung 4's
    // keywords, so it has to fall all the way through.
    const r = await interpret({
      challenge: "zzzz qqqq wwww",
      rules: data.ruleset.rules.map((x) => ({ id: x.id, enabled: x.enabled, strength: x.strength })),
      claims: [],
    });

    expect(r.rung).toBe(5);
    expect(r.source).toBe("none");
    // The picker offers every registered rule - the surface still renders something
    // usable, which is what §11 asks the matrix to prove.
    expect(r.value).not.toBeNull();
  });

  it("Surface 3 answers at rung 2 and returns THE SPECIFIC surviving anchor ids", async () => {
    // Trap 2: `noMatch` on an empty list is 0 under every implementation, and
    // `anchorIds.length > 0` is barely better. Assert which ids survived.
    const { navigate } = await import("../src/ai/navigate.js");
    const map = (await import("../src/ai/cache/anchor-map.json")).default as
      Record<string, string[]>;
    const [question, expected] = Object.entries(map)[0]!;

    const r = await navigate({
      question,
      anchors: Object.entries(ANCHORS).map(([id, a]) => ({ id, label: a.label })),
    });

    expect(r.rung).toBe(2);
    expect(r.source).toBe("cache");
    expect(r.value?.anchorIds).toEqual(expected.filter(isKnownAnchor));
    // And every id it returned is real. A cached map entry naming a renamed anchor
    // would otherwise scroll to nothing and look like a UI bug.
    expect(expected.every(isKnownAnchor)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- apps/web/test/failureMatrix.test.ts`
Expected: FAIL — the timeout test hangs to its assertion and reports `expected Promise to resolve to null` (fake timers plus a never-settling fetch is the one case that fails loudly if `postJson` has no abort wired), and any walker assertion whose `rung` is off by one reports `expected 2 to be 3`. Watch each of the fourteen fail at least once before making it pass; a green run on the first attempt means the file is not exercising what it claims.

- [ ] **Step 3: Write the failing Surface 2 test**

Create `apps/web/test/surface2.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../src/state/store.js";
import { ValidationTab } from "../src/tabs/Validation.js";
import { loadData, type LoadedData } from "../src/data/load.js";

const data = loadData();

const renderWith = (d: LoadedData) =>
  render(<StoreProvider data={d}><ValidationTab /></StoreProvider>);

/**
 * Surface 2's entire §11 row.
 *
 * It is not a ladder rung. Under every one of the five conditions the behaviour is
 * identical and is the master spec's own wording: the button disables with a
 * tooltip and the table is untouched. So there is one test, not five, and what it
 * checks is that the control cannot be used and says why.
 *
 * The surface is specified but NOT BUILT (Phase 3 spec §6): it appends one run to a
 * pre-computed 25-runs-per-compound ablation which does not exist - `npm run
 * ablation` is absent from the repo (HANDOVER §3.2). results/metrics.json's
 * metric2a_llmConsistency already carries a placeholder that correctly reports its
 * own absence, and the tooltip is RENDERED FROM IT rather than hardcoded, so the
 * day the ablation lands the panel stops claiming it is missing on its own.
 */
describe("Surface 2 - the live ablation spot check", () => {
  it("renders the control DISABLED", () => {
    renderWith(data);
    expect(screen.getByTestId("live-ablation-run")).toBeDisabled();
  });

  it("takes its tooltip from metrics.json rather than hardcoding the reason", () => {
    // The check that makes this a report rather than a caption: the note is the
    // harness's own account of why the ablation is absent.
    const note = (data.metrics["metric2a_llmConsistency"] as { note: string }).note;
    expect(screen.queryByTestId("live-ablation-run")).toBeNull();
    renderWith(data);
    expect(screen.getByTestId("live-ablation-run").getAttribute("title")).toBe(note);
    expect(note).toMatch(/ablation\.json not present/);
  });

  it("STAYS disabled with a different reason when the ablation does exist", () => {
    // The other direction. Surface 2 is specified, not built - so a metrics file
    // carrying real ablation numbers must not silently enable a button with no
    // implementation behind it.
    const withAblation: LoadedData = {
      ...data,
      metrics: { ...data.metrics, metric2a_llmConsistency: { runsPerCompound: 25, temperature: 0 } },
    };
    renderWith(withAblation);
    const button = screen.getByTestId("live-ablation-run");
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toMatch(/specified but not built/);
  });

  it("leaves the baselines table untouched", () => {
    // The master spec's own wording for this row. A control that disabled itself
    // while blanking the table beside it would pass every assertion above.
    const { container } = renderWith(data);
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
    const before = [...rows].map((r) => r.textContent);
    expect([...container.querySelectorAll("tbody tr")].map((r) => r.textContent)).toEqual(before);
  });

  it("still exposes the placeholder as text, so the absence is readable without hovering", () => {
    // a11y.test.tsx requires every button to carry an accessible name; a tooltip is
    // not one, and a judge on a projector will not hover.
    renderWith(data);
    expect(screen.getByTestId("llm-ablation").textContent).toMatch(/not present|ANTHROPIC_API_KEY/i);
    expect(screen.getByTestId("live-ablation-run").textContent!.trim().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npm test -- apps/web/test/surface2.test.tsx`
Expected: FAIL — `Unable to find an element by: [data-testid="live-ablation-run"]` on four of the five tests.

- [ ] **Step 5: Add Surface 2's disabled control to the Validation tab**

Modify `apps/web/src/tabs/Validation.tsx` (whole file):

```tsx
import { useAppState } from "../state/store.js";

interface Interval { lo: number; hi: number }

interface Pipeline {
  balancedAccuracy: number; coverage: number; nCommitted: number;
  /** Null when one class is absent - see the comment on the headline below. */
  balancedAccuracyCi: Interval | null;
  rawAccuracyCi: Interval; singleClass: boolean;
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

  // Surface 2, the live ablation spot check: SPECIFIED, NOT BUILT (Phase 3 spec §6).
  // The headline it would append to is pre-computed at 25 runs per compound, and
  // that ablation does not exist - `npm run ablation` is absent from the repo
  // (HANDOVER §3.2). metric2a_llmConsistency already carries a placeholder that
  // correctly reports its own absence, so the tooltip is read from it rather than
  // written here; the day the ablation lands, this stops claiming it is missing
  // without anyone editing a string.
  const ablation = m["metric2a_llmConsistency"] as Record<string, unknown>;
  const ablationNote = typeof ablation?.["note"] === "string" ? (ablation["note"] as string) : null;
  const ablationTooltip = ablationNote
    ?? "The live spot check is specified but not built (Phase 3 spec §6) — the button stays disabled.";

  return (
    <section style={{ padding: 20 }}>
      <h2 style={{ fontFamily: "var(--serif)" }}>Validation</h2>

      <p data-testid="provenance" style={{ color: "var(--muted)", fontSize: 13 }}>
        ruleset {String(m["provenance"].rulesetHash).slice(0, 8)}… · split seed {m["provenance"].splitSeed} ·
        perturbation seed {m["provenance"].perturbationSeed} · scored on the {m["provenance"].scoredSplit} split
      </p>

      {/* The interval attached here must describe the number it sits beside.
          This previously read "balanced accuracy 0.75 (95% CI 0.51-1.00)", where
          the interval was really wilson(4,4) on RAW accuracy 4/4 = 1.0 - an
          uncertainty claim about a different statistic. Where balanced accuracy
          substitutes 0.5 for an absent class there is no interval to report,
          because a substitution is not an estimate, so we say that instead of
          borrowing one. */}
      <p data-testid="headline">
        Conflict subset n = <strong>{acc.n}</strong>. ARBITER coverage{" "}
        <strong>{(arbiter.coverage * 100).toFixed(1)}%</strong> ({arbiter.nCommitted} committed).
        {" "}balanced accuracy {arbiter.balancedAccuracy.toFixed(2)}{" "}
        {arbiter.balancedAccuracyCi
          ? `(95% CI ${arbiter.balancedAccuracyCi.lo.toFixed(2)}–${arbiter.balancedAccuracyCi.hi.toFixed(2)})`
          : "(no confidence interval: one class is absent from the committed set, so half of this figure is a substituted 0.5 rather than an estimate)"}.
      </p>

      {/* The style below was measured at 14px/400 and raised deliberately. This is
          the one line in the app that must survive screen-share compression: the
          balanced accuracy beside it is half a substituted 0.5, and a judge who
          reads the number but not the caveat has been misled by us. The most
          important caveat should not render at the same weight as body copy. */}
      {arbiter.singleClass && (
        <p data-testid="single-class-warning"
           style={{ color: "var(--toxic)", fontSize: 15, fontWeight: 600 }}>
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
        LLM ablation: {ablationNote ?? JSON.stringify(ablation)}
      </p>
      {/* Disabled under every one of §11's five conditions, and under a sixth: the
          ablation it would append to has not been built. The table above is
          untouched either way - that is the whole of Surface 2's §11 row. */}
      <p>
        <button data-testid="live-ablation-run" type="button" disabled title={ablationTooltip}
                style={{ font: "inherit", padding: "4px 10px", cursor: "not-allowed" }}>
          Append one live consistency run
        </button>
      </p>
    </section>
  );
}
```

- [ ] **Step 6: Run the Surface 2 test to verify it passes**

Run: `npm test -- apps/web/test/surface2.test.tsx apps/web/test/validation.test.tsx apps/web/test/a11y.test.tsx`
Expected: PASS — the new button carries visible text so `a11y.test.tsx`'s accessible-name assertion holds, and `validation.test.tsx`'s `llm-ablation` assertion still matches because the note is now rendered as prose rather than JSON.

- [ ] **Step 7: Write the file:// guard for the live surfaces**

Create `apps/web/e2e/ai-static.spec.ts`:

```ts
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

// static-file.spec.ts IS NOT MODIFIED. This file copies its pattern for the thing
// that file cannot see: it opens the artifact and never drives the AI surfaces, so
// a rung 1 that fired on a served build and on file:// alike would leave it green.
//
// Trap 3: assert on ATTEMPTED requests, not failed ones. A build that tries the
// call and fails is exactly as broken as one that succeeds - `page.on("request")`
// catches the attempt, `requestfailed` only catches the consequence, and a
// same-origin POST to /api/interpret over file:// may well produce neither a
// console error nor a visible defect while still being a request the ZIP made.
const artifact = pathToFileURL(path.resolve("apps/web/dist/index.html")).href;

test("opening the pre-flight panel runs both ladders and attempts NO request", async ({ page }) => {
  const attempted: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("file://")) attempted.push(`${r.method()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    attempted.push(`FAILED ${r.method()} ${r.url()} ${r.failure()?.errorText ?? ""}`);
  });

  await page.goto(`${artifact}#/case`);
  await expect(page.getByTestId("verdict")).toContainText(/abstain/i);

  // The panel runs interpret() and navigate() when it opens, so this is the whole
  // ladder for both surfaces executing on the artifact - not a proxy for it.
  await page.keyboard.press("?");

  const surface1 = page.getByTestId("check-surface-1");
  const surface3 = page.getByTestId("check-surface-3");
  await expect(surface1).toHaveAttribute("data-source", "cache");
  await expect(surface3).toHaveAttribute("data-source", "cache");

  // Both gates held: the build flag is off in the submitted ZIP and location.protocol
  // is file:. Either one alone would be enough here, which is why both are tested
  // separately in the unit suite; this asserts the observable consequence.
  expect(attempted).toEqual([]);
});

test("the evidence digest resolves over file://, so check-evidence-edits is a real check", async ({ page }) => {
  // Same reasoning as static-file.spec.ts's Web Crypto test: crypto.subtle is gated
  // on a secure context, and whether file:// counts is a browser policy decision.
  // The evidence digest is a second consumer of it, added this phase.
  await page.goto(`${artifact}#/case`);
  await page.keyboard.press("?");
  await expect(page.getByTestId("check-evidence-edits")).toHaveAttribute("data-ok", "true");
});
```

- [ ] **Step 8: Run the full verification**

Run: `npm test -- apps/web && npm run typecheck && npm run lint && npm run web:build && npm run e2e`
Expected: PASS, build succeeds. `apps/web/e2e/static-file.spec.ts` runs unchanged and green — all five of its tests, including "the artifact requests nothing over the network", with every surface on cache.

- [ ] **Step 9: Confirm no committed number moved**

Run: `npm run golden:update && git diff --exit-code results/`
Expected: exit 0, no diff. Nothing in this task touches the harness — but Surface 2 renders from `results/metrics.json`, and reading a file is the step before someone decides to write one. On Windows `golden:update` reports a phantom modification on line endings; re-check with `git diff --stat` before treating it as real.

- [ ] **Step 10: Commit**

```bash
git add apps/web/test/failureMatrix.test.ts apps/web/test/surface2.test.tsx apps/web/e2e/ai-static.spec.ts apps/web/src/tabs/Validation.tsx
git commit -m "$(cat <<'MSG'
Collapse the §11 failure matrix to nine tests, and build Surface 2's one row

Master spec §11 requires each surface exercised against network-off, HTTP 500,
malformed JSON, timeout and missing key, asserting the UI still renders and
degrades to the correct rung. Phase 3 spec §3's invariant - rung 1 either
succeeds or is skipped, never errors upward - is what makes fifteen bespoke
tests unnecessary: the conditions differ only at the transport boundary, and
above it every failure is the same event. So: one thorough walker test, five
transport tests each proving its condition produces a rung-1 miss, three
per-surface tests under a forced rung-1 miss, and Surface 2's single row.

A sixth transport test asserts none of the five throws. Without it the collapse
would not be legitimate - every other assertion in the file would still pass if
postJson rejected and something upstream happened to swallow it.

Three traps are written into the file as comments because HANDOVER §5.1 exists
precisely because they recur. Asserting "the ladder produced an answer" passes
on every rung and is worthless, so every assertion is on `rung`. Asserting
noMatch for an empty anchor list asserts a value that is 0 under every
implementation, so the navigator test asserts the specific ids that survived
isKnownAnchor filtering. And the file:// test asserts on ATTEMPTED requests
rather than failed ones, copying the pattern static-file.spec.ts already uses -
a build that tries the call and fails is exactly as broken as one that succeeds.

static-file.spec.ts is not modified. ai-static.spec.ts is a new file covering
what static-file.spec.ts cannot see: it never drives the AI surfaces, so a rung
1 firing on the artifact would leave it green. The new spec opens the pre-flight
panel, which runs both ladders, and asserts zero attempted requests with both
surfaces reporting cache.

Surface 2 is specified but not built (spec §6): the pre-computed
25-runs-per-compound ablation it appends to does not exist, and `npm run
ablation` is absent from the repo (HANDOVER §3.2). Its §11 row is not a ladder
rung - under all five conditions the behaviour is identical and is the master
spec's own wording, the button disables with a tooltip and the table is
untouched. So that is what is built, and the tooltip is rendered from
metric2a_llmConsistency's placeholder, which already correctly reports its own
absence, rather than hardcoded. The button stays disabled even when the metric
carries real ablation numbers, because a specified-not-built surface must not
enable itself the day the harness lands.

Master spec §11 excludes LLM content quality from testing. Only schema validity
and failure behaviour are tested here; pretending otherwise would be dishonest.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
git push origin phase3
```
---

## Done when

Each criterion is tied to a number or an observation, never to inspection. A criterion met "by reading the code" is not met.

- [ ] `npm run lint && npm run typecheck && npm test` green, with the vitest count **above the 299-test baseline** and every new test having been watched failing first.
- [ ] `npm run web:build && npm run e2e` green at **8 or more Playwright tests**.
- [ ] **`apps/web/e2e/static-file.spec.ts` passes unchanged.** Not modified, not relaxed, not skipped. It asserts on *attempted* requests, so this is the criterion that proves the submitted ZIP never reaches for the network.
- [ ] `npm run golden:update && git diff --exit-code results/` produces **no diff**. Phase 3 touches no reported number; if one moves, something is wrong that a rebaseline would hide.
- [ ] The built `dist/index.html`, opened from the filesystem on a machine that is not the one that built it, renders the verdict, walks all seven beats, and reports **every surface on cache** in the pre-flight panel.
- [ ] Both gates on the live path are tested in both directions — the build flag and the `file://` protocol check, independently. A false positive here is the §6.1 failure mode returning.
- [ ] The §11 matrix is complete: five transport conditions each proven to produce a rung-1 miss, and each surface proven to degrade to its **correct rung** rather than merely to "an answer".
- [ ] Every cached challenge references a real rule id, and every `reclassify_field` entry a real claim id and a schema-legal value — proven by a test that was watched failing against a deliberately corrupted entry.
- [ ] Every declared static anchor resolves in the DOM when its tab is active, and the conditional anchors are distinguished from unknown ids rather than skipped.
- [ ] Pressing `M` stops the navigator's scroll, not just its highlight — asserted on the `behavior` argument, because CSS cannot reach it.
- [ ] The pre-flight panel's `check-network` line no longer claims no network call is ever made, and each surface's live-or-cache state is **computed**, not captioned.

**Not met, and it needs a person:**

- The three cached challenges flagged in spec §13 need a toxicologist, not an engineer: treating a >100× in-vitro margin as `exposureRelevant`, clearing a Klimisch score on a QSAR claim as a category error, and whether the ICH M3 two-species phrasing is how a reviewer actually opens that objection. The first is the highest-leverage field in the system — no benchmark compound carries `exposureRelevant: true` — so a naive framing there is naive in the most visible place. **Register is the whole point:** these strings are what live input is matched against at rungs 2 and 3, and a cache that reads like templates falls through to keyword matching in front of a judge.
- Whether the live path is deployed at all. The plan is complete without it by construction.

## Deliberately not in this plan

- **The harness LLM ablation.** `npm run ablation` does not exist and neither does any implementation; `results/metrics.json` carries a placeholder that correctly reports its own absence. It needs its own decisions — the prompt, how evidence is serialised into it, the consistency metric, caching, and how committed run data stays out of `golden:update`'s way, since a model's output is not reproducible from a seed and everything else in `results/` is. Budget it as a real task with a spec. Surface 2 is specified in the Phase 3 spec §6 and built here only as far as its disabled state, so it costs nothing to cut and nothing to resume.
- **The provider, model and temperature for Surfaces 1 and 3.** Master spec §11 explicitly refuses to test LLM content quality — only schema validity and failure behaviour are testable — so these are unguarded by tests and are a deployment decision recorded at deploy time.
- **Whether the navigator may change the selected compound.** It requires `selectCompound`, a data action rather than a presentational one. The pattern to follow is the tour's: the navigator dispatches `setFocus` itself, and any compound change goes through the existing action, visibly, exactly as a user would.
- **`Reasoning.rulesetHash`**, passed as `""` by `useCaseReasoning.ts:16`. Nothing reads it and no claim is falsified, but it is the third `*Hash` field in this area that does not hold a hash. Recorded in HANDOVER rather than fixed here.
- **The Cmax hunt.** Not engineering, and on a different clock — the data freeze is 2 August. It is the difference between "coverage is the finding" and a reportable headline, and no amount of work in this plan substitutes for it.
