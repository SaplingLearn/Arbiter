# ARBITER Research Convergence - Implementation Plan

> **SUPERSEDED IN PART, 2026-08-13 (same day).** `ARBITER_Evidence_Integrated_Playbook.pdf` arrived after this plan was written and governs where the two disagree. Three corrections, and the first one matters more than anything in this document:
>
> 1. **This plan missed the blocking task.** `results/metrics.json` carries `provenance.rulesetVersion: "1.0"` and `metric1_conflictSubsetAccuracy.arbiter.balancedAccuracy: 0.75` with `confusion {tp:4, fp:0, tn:0, fn:0}` and `singleClass: true`. The About and Validation tabs render those figures. HANDOVER §13.1 declares that target invalid. **The shipped app displays the number the team published a correction retiring.** Verified directly, not inferred. Fix this before anything else here.
> 2. **Tasks 2 and 3 (Yager's rule) are demoted.** They were justified as closing a false claim in the old PDF's Q&A script. The new playbook rewords that answer to "preserves and displays the conflict measure rather than averaging it away", which is true of the code today. Yager is now a post-submission rigor item, not a credibility fix. **Task 4 (rendering `conflictMass`) is unaffected and rises in priority** - the playbook lists it as P1-B.
> 3. **The playbook forbids four things before 16 August** that nothing here proposes, listed so they stay forbidden: sharing the engine between the two apps, live adjudication against a real model, PDF extraction, and Surface 2's live consistency run.
>
> Tasks 1, 4, 5, 6, 7 and 8 stand as written. Executable prompts for the full programme, including the blocking task, are in `docs/superpowers/build-prompts/`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three gaps between what ARBITER *claims* and what ARBITER *does* - the unmeasured consistency number, the conflict-aware fusion rule the Q&A script promises but the code does not contain, and the absence of any quantitative inter-rater agreement figure - so that every sentence said to a judge on 16 August is backed by something in the repository.

**Architecture:** No new subsystems and no rewrite. Three surgical additions to code that already exists: a second Dempster-Shafer combination rule behind a pre-registered threshold in `packages/engine`, an agreement-statistics module in `services/api`, and a commit-before-reveal gate in `apps/web`. One measurement run that needs no new code at all. The Python/FastAPI/Postgres stack described in the PDF is **not** adopted; see "The PDF is partly superseded" below.

**Tech Stack:** TypeScript 5.6 (ESM, `tsx`, `vitest`) across `packages/engine`, `services/api`, `apps/web`, `apps/deliberation`, `apps/harness`. Python 3.12 under `data/prep` and `tools/` is untouched by this plan.

**Spec:** Three documents, and they disagree with each other. Read all three, in this order:
1. `docs/superpowers/specs/2026-08-09-arbiter-ai-redesign-design.md` - **the governing document.** Written after measurement; retires things the PDF still assumes.
2. `docs/superpowers/specs/2026-08-09-arbiter-completion-plan.md` - the gate sequence this plan slots into.
3. `~/Downloads/ARBITER_Full_System_Specification (1).pdf` - the full-build vision. Authoritative on **claims, framing, and the Q&A script**; superseded on **architecture and stack**.

Plus the research brief supplied 2026-08-13 (reproduced in the gap table below, since it exists only in conversation).

---

## Global Constraints

Copied from HANDOVER §1, `rules/pass-marks-v1.0.json`, and the redesign spec §5-§6. **Every task's requirements implicitly include this section.**

- **`rules/ruleset-v1.0.json` and `rules/ruleset-v2.0.json` are never opened.** No task in this plan edits a registered ruleset. Adding rules R7-R14 from the PDF is explicitly out of scope; see "What this plan does not build".
- **`packages/engine/src` stays pure.** No `Date`, `Math.random`, `node:*`, `fs`/`path`/`crypto`, dynamic `import`, or parent imports. Lint enforces this. A policy the engine needs is a **constant in the engine** plus a registered JSON file the *harness* reads and compares - never a file the engine reads.
- **`abstentionGapThreshold` stays 0.5.** Editing it to improve a headline is forbidden.
- **Pre-registration before measurement.** Any threshold, policy, or pass mark is committed *before* the run it governs. A number chosen after seeing a score is a description, not a pass mark.
- **Counts never decide.** Redesign spec §6.4 and §6.7: no vote tally, no quorum, no consensus mechanism. Tasks 5 and 6 add an agreement *statistic*; it is displayed to a later reader as context and is **never** an input to a verdict, a gate on signing, or a weight in adjudication. Any code that lets κ change an outcome is a defect. Nor may any camp be described by its size: no "majority", no "minority view", no "outvoted".
- **Every reported number names its denominator, its class balance, and the prompt hash that produced it.** The omission of exactly this is what produced the retired 0.750 headline.
- **A correct verdict on incorrect reasoning is a failure.**
- **Language discipline (HANDOVER §1.3):** "review-ready evidence package" not "regulator-ready dossier"; "positions / sign-off / decision owner" not "voting / tally / majority"; "hash-chained audit log" not "blockchain". Applies to code, comments, UI copy, and commit messages. No em dashes anywhere - the last six commits on this branch exist to remove them.
- **Every test must be watched failing before it is trusted.** Assert on discriminating values, never on a string that appears in both the pass and the fail message.
- **Commit after every task.** Not batched. Branch is `feat/blueprint-design-system`.
- **Deadline: 16 August 2026, 23:59 ET.** This plan is written on 13 August. Tasks 1-5 are the committed scope. Tasks 6-7 are the flex, and the plan says so rather than pretending otherwise.

---

## Part A: Verifying the research against what is actually built

This is the analysis the plan rests on. Every "already built" row was confirmed by reading the file named, not inferred.

### A.1 The research brief's recommendations, checked against the repository

| Research recommendation | Status in this repository | Evidence |
|---|---|---|
| **#1 Collaborative multi-reviewer adjudication** - blind independent submission, conflict detection, adjudicator resolution, rationale in the audit chain | **Already built, and it is the strongest thing in the repo.** Blind positions, simultaneous reveal, sealing, one accountable signer, dissent preserved permanently | `services/api/deliberation.ts`; `apps/deliberation`; redesign spec §6 |
| ...its **agreement statistic** (Cohen's / Fleiss' κ) | **ABSENT.** An unfiltered repo-wide search for `kappa\|cohen\|krippendorff\|fleiss\|icc\|inter.?rater` returns **zero matches**, including in docs and results. The only quantities on screen are `n of m answered` and the boolean `unanimous` | `apps/deliberation/src/pages.tsx:253`; `services/api/deliberation.ts:383-387`. **This is Task 5.** |
| ...its **conflict routing** | **Built server-side and unreachable.** `disagreementReport()` computes the camp split, contested findings and one-sided findings - and is **exposed on no HTTP route, absent from the client's `api.ts`, and rendered nowhere.** Its only caller is the terminal demo. When the room splits, the client suppresses the unanimity block and the reader gets raw positions side by side and nothing else | `services/api/deliberation.ts:439-457`; absent from `server.ts:243-364`; only caller `services/api/deliberation-demo.ts:365` |
| ...its **third-reviewer escalation queue** | **Absent, and deliberately.** No quorum, no tie-break, no assignment engine. Conflict resolves through adjudication plus one accountable signer who may override with a required reason | `services/api/deliberation.ts:340-362` |
| **#2 Federated reasoning** ("share the logic, not the data") | **Not built, and correctly so.** Governance-heavy, unproven | Research brief's own caveat: roadmap slide, not MVP |
| **#3a Conflict-aware fusion** - Yager / PCR / Dubois-Prade above a conflict threshold | **ABSENT. Only classic Dempster's rule exists.** Repo-wide search for `yager\|pcr5\|pcr6\|dubois\|prade\|murphy\|smets` returns zero hits. K *is* computed and carried on `Reasoning.conflictMass`, which is half the job | `packages/engine/src/fuse.ts:33-47` is the whole of it. **This is Task 2/3.** |
| ...and **K is never shown to anyone** | **ABSENT in the interface.** `conflictMass` is computed, carried on the reasoning object, and rendered by no component in `apps/web`. Only the derived boolean `contested` reaches the screen. PDF view 5 explicitly promises "the conflict measure" | zero uses of `conflictMass` under `apps/web/src`. **This is Task 4.** |
| **#3b Conformal prediction for applicability domain** | **Not built.** R4 admits out-of-domain claims at reduced weight but the domain flag is not conformal | `rules/ruleset-v2.0.json` R4 |
| **#4 Commit-before-reveal cognitive forcing function** | **Built in `apps/deliberation`** (blind submission *is* the forcing function). **ABSENT in `apps/web`**: the verdict renders the moment the Case tab mounts | `apps/web/src/tabs/Case/CaseHeader.tsx:44`. **This is Task 7.** |
| **#4 Override-as-signal** | **Built in `apps/deliberation`**, where an override requires a stated reason, enforced on both client and server. **Weaker in `apps/web`**: the Record tab offers a `dissent` position with **no required rationale** and no disabled condition on Sign. Nothing aggregates overrides anywhere | `services/api/deliberation.ts:357-359` (strong); `apps/web/src/tabs/Record.tsx:52,96` (weak) |
| **#5 SEND in / QAF / V&V40 / PROV-O out** | **Not built.** The audit log is hash-chained but emits its own shape | Completion plan Gate 4 |
| **Value-of-information planner** | **Already built**, with a hand-authored, contestable assay catalogue | `packages/engine/src/plan.ts`, `packages/engine/test/plan.test.ts`, `data/assays.json` |
| **Counterfactual sensitivity** | **Already built** | `packages/engine/src/counterfactual.ts` |
| **Multi-agent debate** | Not built; research brief itself advises caution | - |

### A.1a One architectural fact that decides which tasks touch which surface

**`services/api` never imports `@arbiter/engine`.** The deliberation flow re-spells the types it needs (`adjudicate.ts:28-43`, `interpret.ts:42-50`) and reaches a verdict through an LLM adjudication plus a human signature. The engine's Dempster-Shafer output is consumed only by `apps/web` (in the browser, over build-time-bundled JSON) and by `apps/harness`.

Consequences for this plan, and they are load-bearing:

- **Tasks 2, 3 and 4 change what `apps/web` and the harness show. They do not touch the deliberation flow at all.**
- **Tasks 5 and 6 change the deliberation flow. They do not touch the engine.**
- The two halves are therefore fully parallelisable across two people with no merge risk beyond `HANDOVER.md`.

**The headline finding: the research brief's number-one recommendation is the thing this repository already does best.** The brief was written without sight of the code and identifies collaborative adjudication as "the biggest gap in the current design". It is not a gap here - blind submission, simultaneous reveal, cited positions with three derived states, preserved dissent and a single accountable signer are all built and tested. What is genuinely missing from that subsystem is one number: **how much the reviewers actually agreed.** That is a half-day of pure-function work, not a new subsystem, and it converts an existing strength into a quotable result.

### A.2 The PDF is partly superseded, and following it literally would undo measured work

Three conflicts, each of which matters:

| PDF says | Repository state | Resolution in this plan |
|---|---|---|
| Python / FastAPI / Postgres / RDKit / NetworkX; `arbiter/core/`, `arbiter/ingest/`... | TypeScript monorepo, `FileStore`, no Postgres. Nothing in the PDF's tree exists under those names | **Ignore the stack section.** A port three days out would ship nothing. The PDF's *architecture* is a description of subsystems, and those subsystems exist in TypeScript |
| Dempster-Shafer fusion is the **verdict path** (Stage D → Stage E) | Measured 2026-08-09: the belief-plausibility gap rule produces **97.4% abstention** and bought no measurable accuracy. Retired as the gate; **retained as a diagnostic** | **Keep it retired.** Task 2/3 improves fusion as an *instrument*, not as a restored decider |
| **Fourteen rules** in five families (R1-R14) | Six implemented. v2.0 deliberately declined to register the other eight: "registering rules no code consumes would put six inert entries into a hashed surface" | **Do not add R7-R14.** The v2.0 scope note is a considered decision with a written rationale. Overturning it in three days, unimplemented, would be exactly the unsourceable padding the PDF's own §11 warns against |
| Four endpoints (hepato, cardio, genotox, nephro) | One (hepatotoxicity) | Out of scope. Endpoint expansion is configuration work with no research risk and no time to do it honestly |

**The PDF remains authoritative on the pitch**, and Part 6 (the 15-minute walk) and Part 5 (TAK-994) should be followed as written. Task 8 exists because two answers in the PDF's Q&A script (§21) are not currently true of the code.

### A.3 The Q&A script contains a claim the code does not support

PDF §21, verbatim:

> **Dempster-Shafer behaves badly under high conflict. How do you handle that?**
> We detect and report the conflict measure rather than normalizing it away, and apply a documented alternative combination beyond a threshold.

The first clause is true: `fuse()` returns `conflictMass`. **The second clause is false.** There is no alternative combination and no threshold. A judge who asks the follow-up ("show me") finds nothing. Tasks 2 and 3 make the sentence true. This is the single highest-value engineering item in the plan, because it is cheap, deterministic, golden-testable, and it removes a live credibility risk in the five minutes the PDF itself says decides the round.

### A.4 What this plan deliberately does not build

Named so nobody re-litigates them mid-execution:

- **Rules R7-R14** - see A.2. The v2.0 scope note governs.
- **SEND ingestion, OECD QAF export, ASME V&V40 packaging, PROV-O emission** - real adoption value, zero chance of being done honestly in three days. Roadmap slide.
- **Conformal prediction** - needs a held-out calibration split and a written coverage claim. Roadmap slide.
- **Federated reasoning** - the research brief's own recommendation is that this is a vision slide.
- **Endpoints 2-4, Postgres, Docker Compose, the remaining PDF views** - post-submission.
- **Multi-agent debate** - explicitly cautioned against.

---

## File Structure

| file | status | responsibility |
|---|---|---|
| `results/probe-runs.json` | create (generated) | The raw 20 runs from Gate 0. Committed as evidence; a flip rate whose answers were discarded is an assertion |
| `results/gate0-consistency.txt` | create (generated) | The formatted report, committed beside the raw runs |
| `packages/engine/src/fuse.ts` | modify | Add Yager's rule, the policy type, and rule selection. The only file that decides how masses combine |
| `packages/engine/test/fuse.test.ts` | modify | Zadeh-style high-conflict case; the behaviour-preservation guard |
| `rules/fusion-policy-v1.0.json` | create | The pre-registered threshold and its rationale. Hashed and drift-guarded like `exposure-policy-v1.0.json` |
| `apps/harness/test/fusionPolicy.test.ts` | create | Drift guard: the engine constant must equal the registered file |
| `results/fusion-delta.md` | create | Before/after on every headline metric when the threshold goes live. The honest record of what the change did |
| `apps/web/src/tabs/Case/TracePanel.tsx` | modify | Render the conflict measure and the rule that produced the interval |
| `apps/web/test/conflictMeasure.test.tsx` | create | The conflict figure and rule label reach the screen |
| `services/api/agreement.ts` | create | Pairwise agreement per case, Fleiss' κ across cases. Pure functions, no I/O |
| `services/api/test/agreement.test.ts` | create | Hand-worked values, including the undefined cases |
| `services/api/deliberation.ts` | modify | Thread the per-case agreement figure onto the disagreement report |
| `services/api/server.ts` | modify | Two routes: the per-case disagreement report (which today reaches no client) and the cross-case κ |
| `apps/deliberation/src/api.ts` | modify | Client methods for both new routes |
| `apps/deliberation/src/screens.tsx` | modify | Render the split and the agreement figure at the reveal |
| `apps/web/src/tabs/Case/index.tsx` | modify | The commit-before-reveal gate |
| `apps/web/src/state/store.tsx` | modify | Hold the provisional call |
| `HANDOVER.md` | modify | A §14 recording what this plan changed and what it measured |

---

## Task 1: Gate 0 - run the consistency probe

**This task is first and it is blocking.** The completion plan's own words: "If only one thing gets done: Gate 0. It is cheap, it needs no answer key, and it is the only measurement that can tell you the architecture is wrong before you build another month on top of it." It has not been run - `results/probe-runs.json` does not exist.

There is **no code to write**. Every piece of tooling exists. This task spends about an hour and one to three dollars, and it produces the number the entire pitch rests on.

**Files:**
- Create: `results/probe-runs.json` (written by the probe)
- Create: `results/gate0-consistency.txt` (the report, redirected)
- Read only: `rules/pass-marks-v1.0.json`, `data/probe-case.json`

**Interfaces:**
- Consumes: nothing from earlier tasks. This is the root.
- Produces: a measured flip rate and per-rule agreement figure. **Task 8 quotes these numbers.** No other task depends on it, so if the key is unavailable, Tasks 2-7 still proceed.

- [ ] **Step 1: Confirm the pass marks before looking at any result**

Read `rules/pass-marks-v1.0.json` and write the three numbers on paper before running anything:
- flip rate ceiling: **0.10** over 20 runs
- per-rule position agreement floor: **0.80**
- hallucinated citations: **0** (enforced by `verifyAdjudication`; any occurrence is a 502)

These are pre-registered and committed. **Do not change them after seeing a result.** If the run fails a mark, that is the finding.

- [ ] **Step 2: Confirm the probe case exists**

```bash
ls -la data/probe-case.json data/probe-case-coverage.json
```

Expected: both present. If `data/probe-case.json` is missing, rebuild it:

```bash
npm run probe:case
```

- [ ] **Step 3: Verify the stub path runs end to end before spending money**

With no key set, the probe runs against `stubComplete` and labels the output `"source": "stub"`. Exercise the whole path first so the paid run tests the model rather than this file:

```bash
unset ANTHROPIC_API_KEY
PROBE_OUT=/tmp/probe-stub.json npm run probe
PROBE_OUT=/tmp/probe-stub.json npm run probe:report
```

Expected: a report prints, and it says `source stub`. If this errors, fix the error before Step 4 - a crash twenty runs into a paid run wastes the budget.

- [ ] **Step 4: Run the live probe**

```bash
export ANTHROPIC_API_KEY=<the key>
npm run probe
```

Expected: `results/probe-runs.json` written, with `"source": "live"` and 20 entries in `runs`.

- [ ] **Step 5: Generate and keep the report**

```bash
npm run probe:report | tee results/gate0-consistency.txt
```

- [ ] **Step 6: Record the result against the pass marks, whatever it says**

Append to `results/gate0-consistency.txt` a two-line verdict naming the pass mark and the measured value, for example:

```
PASS MARK flip rate <= 0.10 over 20 runs (rules/pass-marks-v1.0.json v1.0)
MEASURED  flip rate 0.05 (1 of 20 runs disagreed with the modal verdict)
```

**If the flip rate exceeds 0.10:** stop. Do not rewrite the prompt and re-run. That instruction predates this result and is committed in the pass-marks file. Record the number, tell the team, and treat it as a design finding - the pitch's consistency claim changes, and Task 8 must say so.

- [ ] **Step 7: Commit the evidence**

```bash
git add results/probe-runs.json results/gate0-consistency.txt
git commit -m "Measure Gate 0 consistency on the probe case

Twenty runs of one case against the pre-registered pass marks in
rules/pass-marks-v1.0.json. Raw runs committed alongside the report
because a flip rate whose answers were discarded is an assertion."
```

---

## Task 2: Yager's rule, behind a threshold that is switched off

Adds the capability and proves it changes nothing yet. Task 3 turns it on. Splitting it this way means a reviewer can approve the mathematics and separately approve the behaviour change, and it means Task 2 carries a very strong test: **the golden files must not move.**

**Files:**
- Modify: `packages/engine/src/fuse.ts`
- Modify: `packages/engine/test/fuse.test.ts`
- Create: `rules/fusion-policy-v1.0.json`
- Create: `apps/harness/test/fusionPolicy.test.ts`

**Interfaces:**
- Consumes: the existing `Mass`, `VACUOUS`, `combine`, `fuse` from `packages/engine/src/fuse.ts`.
- Produces, for Task 3 and for `apps/web`:
  - `export type CombinationRule = "dempster" | "yager"`
  - `export interface FusionPolicy { version: string; conflictThreshold: number; ruleAtOrAbove: CombinationRule }`
  - `export const DEFAULT_FUSION_POLICY: FusionPolicy`
  - `export function combineYager(a: Mass, b: Mass): { mass: Mass; conflict: number }`
  - `export function fuse(masses: Mass[], policy?: FusionPolicy): { belief: number; plausibility: number; conflictMass: number; mass: Mass; ruleUsed: CombinationRule }`
  - The `ruleUsed` field is additive; every existing caller keeps working because it reads the four fields it already read.

- [ ] **Step 1: Write the failing test for Yager's rule on the high-conflict case**

The pathology in one case: two sources at 0.99 strength pointing opposite ways. Dempster normalises the conflict away and returns a **narrow** interval, which reads as confidence when the truth is that the sources have destroyed each other. Yager transfers the conflict to `uncommitted`, which is the honest answer: we know nothing.

Add to `packages/engine/test/fuse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { combineYager, fuse, DEFAULT_FUSION_POLICY, type Mass } from "../src/fuse.js";

describe("Yager's rule under near-total conflict", () => {
  const nearlyCertainToxic: Mass = { toxic: 0.99, safe: 0, uncommitted: 0.01 };
  const nearlyCertainSafe: Mass = { toxic: 0, safe: 0.99, uncommitted: 0.01 };

  it("transfers conflict to uncommitted instead of normalising it away", () => {
    const { mass, conflict } = combineYager(nearlyCertainToxic, nearlyCertainSafe);

    // K = 0.99*0.99 = 0.9801, and it lands on uncommitted rather than being divided out.
    expect(conflict).toBeCloseTo(0.9801, 10);
    expect(mass.toxic).toBeCloseTo(0.0099, 10);
    expect(mass.safe).toBeCloseTo(0.0099, 10);
    expect(mass.uncommitted).toBeCloseTo(0.9802, 10);
  });

  it("produces a WIDE interval where Dempster produces a narrow one", () => {
    const dempster = fuse([nearlyCertainToxic, nearlyCertainSafe], {
      version: "test", conflictThreshold: 1.1, ruleAtOrAbove: "yager",
    });
    const yager = fuse([nearlyCertainToxic, nearlyCertainSafe], {
      version: "test", conflictThreshold: 0, ruleAtOrAbove: "yager",
    });

    // Dempster: belief 0.497, plausibility 0.5025. Two sources in total conflict,
    // and the interval is half a percentage point wide. That is the defect.
    expect(dempster.plausibility - dempster.belief).toBeLessThan(0.01);
    expect(dempster.ruleUsed).toBe("dempster");

    // Yager: belief 0.0099, plausibility 0.9901. The width IS the disagreement.
    expect(yager.plausibility - yager.belief).toBeGreaterThan(0.97);
    expect(yager.ruleUsed).toBe("yager");
  });

  it("agrees with Dempster exactly when there is no conflict", () => {
    const a: Mass = { toxic: 0.6, safe: 0, uncommitted: 0.4 };
    const b: Mass = { toxic: 0.5, safe: 0, uncommitted: 0.5 };
    const d = fuse([a, b], { version: "t", conflictThreshold: 1.1, ruleAtOrAbove: "yager" });
    const y = fuse([a, b], { version: "t", conflictThreshold: 0, ruleAtOrAbove: "yager" });
    expect(y.belief).toBeCloseTo(d.belief, 12);
    expect(y.plausibility).toBeCloseTo(d.plausibility, 12);
  });
});

describe("the shipped default policy", () => {
  it("is switched off, so no verdict moves in this task", () => {
    expect(DEFAULT_FUSION_POLICY.conflictThreshold).toBe(1.1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run packages/engine/test/fuse.test.ts
```

Expected: FAIL. `combineYager`, `DEFAULT_FUSION_POLICY` and the `policy` parameter do not exist, so the import itself fails.

- [ ] **Step 3: Implement the rule and the policy**

Replace the `fuse` function in `packages/engine/src/fuse.ts` and add above it:

```ts
/** Which combination rule produced a result. Recorded so the audit log names it. */
export type CombinationRule = "dempster" | "yager";

export interface FusionPolicy {
  version: string;
  /** Cumulative conflict at or above which `ruleAtOrAbove` replaces Dempster. */
  conflictThreshold: number;
  ruleAtOrAbove: CombinationRule;
}

/**
 * The registered default. MUST equal rules/fusion-policy-v1.0.json - the engine
 * cannot read files (it is pure by construction), so the drift guard lives in
 * apps/harness/test/fusionPolicy.test.ts, exactly as the exposure policy does.
 *
 * A threshold above 1 can never be reached, because cumulative conflict is a
 * probability. Shipping it switched off is deliberate: this version adds the
 * capability and proves it moves nothing. Turning it on is a separate, measured,
 * separately reviewable change.
 */
export const DEFAULT_FUSION_POLICY: FusionPolicy = {
  version: "1.0",
  conflictThreshold: 1.1,
  ruleAtOrAbove: "yager",
};

/**
 * Yager's rule of combination.
 *
 * Identical to Dempster's in the numerator; the difference is what happens to the
 * conflict mass K. Dempster divides it out, which rescales the survivors and can
 * turn total disagreement into a confident-looking narrow interval. Yager assigns
 * it to the frame instead - conflict becomes ignorance, which is what it actually
 * is - so the belief-to-plausibility interval widens as the sources disagree.
 *
 * Yager 1987, "On the Dempster-Shafer framework and new combination rules".
 */
export function combineYager(a: Mass, b: Mass): { mass: Mass; conflict: number } {
  const toxic = a.toxic * b.toxic + a.toxic * b.uncommitted + a.uncommitted * b.toxic;
  const safe = a.safe * b.safe + a.safe * b.uncommitted + a.uncommitted * b.safe;
  const conflict = a.toxic * b.safe + a.safe * b.toxic;
  // No normalisation. The conflict joins m(Theta) rather than being divided away.
  const uncommitted = a.uncommitted * b.uncommitted + conflict;
  return { mass: { toxic, safe, uncommitted }, conflict };
}
```

Then replace `fuse` with:

```ts
/**
 * Fuse many masses. belief(toxic) = m({toxic}); plausibility(toxic) =
 * m({toxic}) + m(Theta). The gap between them is what ARBITER does not know.
 *
 * conflictMass is the cumulative conflict removed across all combination steps:
 * 1 - prod(1 - K_i). It is strictly >= max(K_i) and equals max only when at most
 * one step has nonzero conflict.
 *
 * TWO PASSES, on purpose. The rule is selected by the AGGREGATE conflict, which is
 * not known until a full Dempster pass has run. Selecting per step on that step's
 * own K would make the result depend on the order masses arrive in, and order
 * independence is a property this engine's determinism claim rests on.
 */
export function fuse(
  masses: Mass[],
  policy: FusionPolicy = DEFAULT_FUSION_POLICY,
): { belief: number; plausibility: number; conflictMass: number; mass: Mass; ruleUsed: CombinationRule } {
  const run = (
    step: (a: Mass, b: Mass) => { mass: Mass; conflict: number },
  ): { mass: Mass; conflictMass: number } => {
    let acc: Mass = { ...VACUOUS };
    let survival = 1; // prod(1 - K_i)
    for (const m of masses) {
      const { mass, conflict } = step(acc, m);
      acc = mass;
      survival *= 1 - conflict;
    }
    return { mass: acc, conflictMass: 1 - survival };
  };

  const dempster = run(combine);
  if (dempster.conflictMass < policy.conflictThreshold) {
    return {
      belief: dempster.mass.toxic,
      plausibility: dempster.mass.toxic + dempster.mass.uncommitted,
      conflictMass: dempster.conflictMass,
      mass: dempster.mass,
      ruleUsed: "dempster",
    };
  }

  const alt = run(combineYager);
  return {
    belief: alt.mass.toxic,
    plausibility: alt.mass.toxic + alt.mass.uncommitted,
    // The conflict REPORTED is always Dempster's, so the number a reader sees means
    // the same thing whichever rule produced the interval beside it.
    conflictMass: dempster.conflictMass,
    mass: alt.mass,
    ruleUsed: policy.ruleAtOrAbove,
  };
}
```

- [ ] **Step 4: Thread `ruleUsed` onto the reasoning object**

`fuse()` now returns which rule it used, but **nothing downstream can see it**: `reason()` copies only four fields out of the fusion result, and `Reasoning` has no such property. Task 4 renders `reasoning.ruleUsed`, so without this step it has nothing to read.

In `packages/engine/src/types.ts`, beside `conflictMass` (line 187):

```ts
  /** Which combination rule produced the interval above. Recorded rather than
   *  inferred from conflictMass, because the threshold that selects it is a
   *  registered policy that can change without the mass changing. */
  ruleUsed: CombinationRule;
```

Import `CombinationRule` from `./fuse.js` there, and in `packages/engine/src/index.ts` add to the returned object beside `conflictMass: fused.conflictMass` (line 197):

```ts
    ruleUsed: fused.ruleUsed,
```

The typecheck will name every other construction site of a `Reasoning` object; fix each by reading the value from its own `fuse()` result, never by hardcoding `"dempster"`.

- [ ] **Step 5: Run the fusion tests and watch them pass**

```bash
npx vitest run packages/engine/test/fuse.test.ts
npm run typecheck
```

Expected: PASS, all four, and a clean typecheck.

- [ ] **Step 6: Prove nothing else moved**

This is the load-bearing check of the task. The golden files encode every verdict the engine currently produces.

```bash
npx vitest run
git diff --exit-code results/golden
```

Expected: the full suite passes and `git diff --exit-code` returns 0 with no output. **If any golden moved, the default policy is not actually switched off** - stop and fix that before continuing, because a silent verdict change is precisely what the pre-registration discipline exists to prevent.

- [ ] **Step 7: Register the policy as a file**

Create `rules/fusion-policy-v1.0.json`:

```json
{
  "version": "1.0",
  "registeredAt": "2026-08-13",
  "conflictThreshold": 1.1,
  "ruleAtOrAbove": "yager",
  "shippedDisabled": true,
  "rationale": "Dempster's rule normalises conflict away by dividing through (1 - K). Under near-total conflict that rescaling turns two sources which have destroyed each other into a narrow belief-plausibility interval, which reads as confidence. Yager's rule assigns the conflict mass to the frame instead, so the interval widens as the sources disagree, which is what the interval is for. The alternative rule is registered here BEFORE the threshold that activates it is chosen, so the choice of threshold cannot be argued to have been fitted to a result.",
  "thresholdRationale": "1.1 is unreachable: cumulative conflict is a probability and cannot exceed 1. This version therefore ships the capability switched off and is provably behaviour-identical to the version before it - the golden files do not move. A reachable threshold is a separate registration with its own measured effect.",
  "citation": "Yager, R. R. (1987). On the Dempster-Shafer framework and new combination rules. Information Sciences 41(2):93-137.",
  "consideredAndRejected": "PCR5/PCR6 proportional conflict redistribution and Dubois-Prade. Both are defensible and PCR5 is arguably better behaved, but each redistributes conflict across focal elements in a way that needs a paragraph to explain, and an unexplainable rule in a five-minute Q&A is worse than a slightly blunter one. Yager's transfer-to-ignorance is one sentence and it is the conservative direction: it widens uncertainty, never narrows it."
}
```

- [ ] **Step 8: Write the drift guard**

Create `apps/harness/test/fusionPolicy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_FUSION_POLICY } from "@arbiter/engine";

/**
 * The engine cannot read files, so the registered policy and the constant the
 * engine actually uses are two copies of the same numbers. Two copies drift. This
 * is the same guard apps/harness carries for the exposure policy.
 */
describe("fusion policy registration", () => {
  it("matches the constant compiled into the engine", () => {
    const registered = JSON.parse(readFileSync("rules/fusion-policy-v1.0.json", "utf8"));
    expect(DEFAULT_FUSION_POLICY.version).toBe(registered.version);
    expect(DEFAULT_FUSION_POLICY.conflictThreshold).toBe(registered.conflictThreshold);
    expect(DEFAULT_FUSION_POLICY.ruleAtOrAbove).toBe(registered.ruleAtOrAbove);
  });
});
```

- [ ] **Step 9: Run the guard**

```bash
npx vitest run apps/harness/test/fusionPolicy.test.ts
```

Expected: PASS. If the engine does not export `DEFAULT_FUSION_POLICY` from its index, add it to `packages/engine/src/index.ts` alongside the other `fuse` exports and re-run.

- [ ] **Step 10: Typecheck and commit**

```bash
npm run typecheck
git add packages/engine/src/fuse.ts packages/engine/test/fuse.test.ts \
        packages/engine/src/index.ts packages/engine/src/types.ts \
        rules/fusion-policy-v1.0.json apps/harness/test/fusionPolicy.test.ts
git commit -m "Add Yager's rule behind a threshold that is switched off

Dempster's rule divides conflict out, which turns two sources in near-total
conflict into a narrow interval. Yager's assigns it to the frame, so the
interval widens with the disagreement. Registered in rules/fusion-policy-v1.0.json
with an unreachable threshold, so this commit provably moves no verdict: the
golden files are byte-identical."
```

---

## Task 3: Turn the threshold on, and measure what it did

The deliberate behaviour change, separated from Task 2 so it can be rejected on its own.

**Files:**
- Create: `rules/fusion-policy-v1.1.json`
- Modify: `packages/engine/src/fuse.ts` (the constant only)
- Modify: `apps/harness/test/fusionPolicy.test.ts` (point at v1.1)
- Create: `results/fusion-delta.md`
- Regenerate: `results/golden/*`

**Interfaces:**
- Consumes: everything Task 2 produced.
- Produces: a measured before/after that Task 8 quotes.

- [ ] **Step 1: Choose and register the threshold BEFORE running anything**

The number is chosen from what it means, not from what it scores. Create `rules/fusion-policy-v1.1.json` - a new file, because v1.0 is never edited:

```json
{
  "version": "1.1",
  "registeredAt": "2026-08-13",
  "supersedes": "1.0",
  "conflictThreshold": 0.5,
  "ruleAtOrAbove": "yager",
  "shippedDisabled": false,
  "rationale": "Unchanged from v1.0. The only change is that the threshold is now reachable.",
  "thresholdRationale": "0.5 means: switch when more than half of the combined mass was conflict that Dempster would have divided away. Below that, the sources broadly agree and normalisation is uncontroversial. At or above it, the majority of what the sources jointly said was contradiction, and reporting a narrow interval derived from the minority that survived is not defensible. The number is chosen from the meaning of the quantity and NOT from its effect on any metric, which has not been computed at the time this file is written.",
  "expectedEffect": "Abstention should RISE on the conflict subset, because widening the belief-plausibility interval past abstentionGapThreshold (0.5) is what abstention means. That direction is intended: the cases affected are by construction the ones where the sources destroyed each other. A fall in abstention would indicate a bug.",
  "citation": "Yager, R. R. (1987). On the Dempster-Shafer framework and new combination rules. Information Sciences 41(2):93-137."
}
```

- [ ] **Step 2: Capture the before, so the delta is a measurement and not a memory**

```bash
cp results/metrics.json /tmp/metrics-before.json
npm run metrics > /tmp/metrics-before.txt
```

- [ ] **Step 3: Write the failing test for the live threshold**

In `packages/engine/test/fuse.test.ts`, replace the `"is switched off"` test with:

```ts
describe("the shipped default policy", () => {
  it("is live at the registered threshold", () => {
    expect(DEFAULT_FUSION_POLICY.version).toBe("1.1");
    expect(DEFAULT_FUSION_POLICY.conflictThreshold).toBe(0.5);
  });

  it("switches rule on a high-conflict set without being told to", () => {
    const out = fuse([
      { toxic: 0.9, safe: 0, uncommitted: 0.1 },
      { toxic: 0, safe: 0.9, uncommitted: 0.1 },
    ]);
    expect(out.conflictMass).toBeGreaterThan(0.5);
    expect(out.ruleUsed).toBe("yager");
    expect(out.plausibility - out.belief).toBeGreaterThan(0.5);
  });

  it("leaves a low-conflict set on Dempster", () => {
    const out = fuse([
      { toxic: 0.6, safe: 0, uncommitted: 0.4 },
      { toxic: 0.5, safe: 0, uncommitted: 0.5 },
    ]);
    expect(out.conflictMass).toBeLessThan(0.5);
    expect(out.ruleUsed).toBe("dempster");
  });
});
```

- [ ] **Step 4: Run and watch it fail**

```bash
npx vitest run packages/engine/test/fuse.test.ts
```

Expected: FAIL on the version and threshold assertions - the constant still says `1.0` / `1.1`.

- [ ] **Step 5: Flip the constant**

In `packages/engine/src/fuse.ts`:

```ts
export const DEFAULT_FUSION_POLICY: FusionPolicy = {
  version: "1.1",
  conflictThreshold: 0.5,
  ruleAtOrAbove: "yager",
};
```

Update its doc comment to name `rules/fusion-policy-v1.1.json`, and in `apps/harness/test/fusionPolicy.test.ts` change the read path to `rules/fusion-policy-v1.1.json`.

- [ ] **Step 6: Run the tests and see exactly which goldens move**

```bash
npx vitest run packages/engine/test/fuse.test.ts apps/harness/test/fusionPolicy.test.ts
npx vitest run 2>&1 | tail -40
```

Expected: the fusion tests PASS; golden tests **FAIL**, and the failures are the point. Read them. Every moved verdict should be a case whose conflict exceeded 0.5, and every move should be toward abstention. **If any verdict moved from abstain to committed, stop** - that contradicts the registered `expectedEffect` and means the rule is applied in the wrong direction.

- [ ] **Step 7: Regenerate the goldens deliberately**

```bash
npm run golden:update
git diff --stat results/golden
```

- [ ] **Step 8: Measure the after**

```bash
npm run metrics | tee /tmp/metrics-after.txt
```

- [ ] **Step 9: Write the delta down**

Create `results/fusion-delta.md` with the real numbers from the two runs. Structure:

```markdown
# Fusion policy v1.0 -> v1.1: measured effect

Threshold registered 2026-08-13 in `rules/fusion-policy-v1.1.json` BEFORE this run.
Expected direction, registered in that file: abstention rises on the conflict subset.

| metric | v1.0 (Dempster only) | v1.1 (Yager at K >= 0.5) | delta |
|---|---|---|---|
| conflict-subset n | | | |
| positives in subset | | | |
| committed / coverage | | | |
| balanced accuracy (with CI) | | | |
| cases switched to Yager | - | | |

## Which cases switched, and why

[List every compound whose verdict moved, with its conflict mass. If the list is
empty, say so plainly: the threshold was never reached on this corpus, the change
is inert on these data, and that is the result.]

## Was the registered expectation met?

[Yes/no, in one sentence. A no is reported, not fixed by moving the threshold.]
```

**Fill in every cell from the two metric runs.** An empty table is worse than no table.

- [ ] **Step 10: Commit**

```bash
git add rules/fusion-policy-v1.1.json packages/engine/src/fuse.ts \
        packages/engine/test/fuse.test.ts apps/harness/test/fusionPolicy.test.ts \
        results/golden results/fusion-delta.md
git commit -m "Activate Yager's rule at conflict >= 0.5 and measure the effect

Threshold registered before the run. results/fusion-delta.md records what moved
on every headline metric, including the cases that switched rule and whether the
registered expectation held."
```

---

## Task 4: Show the conflict measure, and which rule produced the interval

Tasks 2 and 3 are invisible without this. `conflictMass` has been computed by the engine and carried on `Reasoning` since the beginning, and **no component in `apps/web` renders it** - only the derived boolean `contested` reaches the screen. PDF view 5 promises "the belief-to-plausibility bar with the interval width called out, the conflict measure, and a plain-language reading of what the numbers mean". Two of those three are on screen today.

This is also what makes Task 3 legible: once Yager can fire, a reader looking at a wide interval needs to know whether it is wide because the evidence is thin or because the sources destroyed each other. Those are different problems with different next steps.

**Files:**
- Modify: `apps/web/src/tabs/Case/TracePanel.tsx`
- Create: `apps/web/test/conflictMeasure.test.tsx`

**Interfaces:**
- Consumes: `Reasoning.conflictMass` (already populated, `packages/engine/src/index.ts:197`) and `ruleUsed` from Task 2. **If Task 2 has not landed, render the conflict figure alone and omit the rule label** - the two halves are independent.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/conflictMeasure.test.tsx`. **Read `apps/web/test/tracePanel.test.tsx` first if it exists, or the nearest existing panel test, and reuse its render setup rather than writing a second one.**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("the conflict measure", () => {
  it("puts the conflict figure on screen, not just the contested flag", () => {
    renderTracePanel();
    const el = screen.getByTestId("conflict-measure");
    // Cyclosporine is the one rendered case with non-zero conflict mass: 0.122.
    expect(el.textContent).toContain("0.12");
  });

  it("names the combination rule that produced the interval", () => {
    renderTracePanel();
    expect(screen.getByTestId("combination-rule").textContent).toMatch(/Dempster|Yager/);
  });

  it("says in plain language what a low conflict figure means", () => {
    renderTracePanel();
    expect(screen.getByTestId("conflict-reading").textContent).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run apps/web/test/conflictMeasure.test.tsx
```

Expected: FAIL - no element carries `data-testid="conflict-measure"`.

- [ ] **Step 3: Render it**

In `apps/web/src/tabs/Case/TracePanel.tsx`, beside the existing mass line (`toxic / safe / uncommitted · contested`), add:

```tsx
<p className="conflict" data-testid="conflict-measure">
  Conflict <strong>{reasoning.conflictMass.toFixed(3)}</strong>
  <span data-testid="combination-rule">
    {" "}combined by {reasoning.ruleUsed === "yager" ? "Yager's rule" : "Dempster's rule"}
  </span>
</p>
<p className="conflict-reading" data-testid="conflict-reading">
  {conflictReading(reasoning.conflictMass, reasoning.ruleUsed)}
</p>
```

and above the component:

```tsx
/**
 * The plain-language half of PDF view 5. The number alone invites the wrong
 * reading in both directions: a low conflict figure beside a wide interval is
 * missing evidence, not disagreement, and those have different next steps.
 */
function conflictReading(k: number, rule: "dempster" | "yager"): string {
  if (k < 0.05) return "The sources barely contradict each other. A wide interval here means evidence is missing, not disputed - the planner's experiment is the next step.";
  if (rule === "yager") return "Most of what the sources jointly said was contradiction. The interval is widened rather than normalised, because a narrow interval derived from the fraction that survived would read as confidence this evidence does not support.";
  return "The sources partly contradict each other. Dempster's rule normalises that away; the figure above is what was normalised, and it is reported rather than hidden.";
}
```

If Task 2 has not landed, drop the `ruleUsed` span and the `rule` parameter, and delete the second test.

- [ ] **Step 4: Run and watch them pass**

```bash
npx vitest run apps/web/test/conflictMeasure.test.tsx
```

Expected: PASS, all three.

- [ ] **Step 5: Look at it in the running app**

```bash
npm run dev
```

Open `http://localhost:5173/app/#/case` and select **Cyclosporine** - HANDOVER §11.2 records it as the only rendered case with non-zero conflict mass (0.122), so it is the one case where this panel says something. On TAK-994 the figure will be 0, and the reading should say so without looking broken.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/tabs/Case/TracePanel.tsx apps/web/test/conflictMeasure.test.tsx
git commit -m "Show the conflict measure and the rule that produced the interval

The engine has computed conflictMass from the start and nothing rendered it;
only the derived contested flag reached the screen. A wide interval with low
conflict is missing evidence and a wide interval with high conflict is a
dispute, and the reader could not previously tell which they were looking at."
```

---

## Task 5: Agreement statistics as pure functions

The one number the research brief asks for that this repository genuinely lacks.

**Two different statistics, because one case and many cases are different questions - and conflating them is the error this task exists to avoid.** Fleiss' κ on a *single* item is degenerate: with four raters unanimous, observed agreement is 1, expected agreement is also 1, and κ is 0/0. It is not a small-sample wobble, it is undefined. So:

- **Per case:** pairwise percent agreement. Well defined for two or more raters, and directly interpretable.
- **Across cases:** Fleiss' κ. This is where κ is defined, and it is the figure comparable to the DILIN literature.

**Files:**
- Create: `services/api/agreement.ts`
- Create: `services/api/test/agreement.test.ts`

**Interfaces:**
- Consumes: `Call` from `services/api/deliberation.ts` (`"advance" | "do_not_advance" | "cannot_conclude"`).
- Produces, for Task 6:
  - `export interface CaseAgreement { raters: number; pairwiseAgreement: number; modalCall: Call; dissenters: number }`
  - `export function caseAgreement(calls: Call[]): CaseAgreement | null` - null when fewer than two raters
  - `export interface KappaReport { items: number; totalAssignments: number; observedAgreement: number; expectedAgreement: number; kappa: number | null; undefinedReason: string | null }`
  - `export function fleissKappa(items: Call[][]): KappaReport`

- [ ] **Step 1: Write the failing tests**

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

  it("counts agreeing pairs, not agreeing people", () => {
    // 4 raters, 3 advance and 1 do_not_advance.
    // Agreeing pairs = C(3,2) = 3. Total pairs = C(4,2) = 6. So 0.5.
    const out = caseAgreement([A, A, A, D]);
    expect(out?.pairwiseAgreement).toBe(0.5);
    expect(out?.modalCall).toBe(A);
    expect(out?.dissenters).toBe(1);
  });

  it("is 0 when every rater chose differently", () => {
    expect(caseAgreement([A, D, C])?.pairwiseAgreement).toBe(0);
  });

  it("is null for a single rater, because agreement needs two", () => {
    expect(caseAgreement([A])).toBeNull();
    expect(caseAgreement([])).toBeNull();
  });
});

describe("fleissKappa", () => {
  it("is 1 on perfect agreement across items that use different categories", () => {
    const out = fleissKappa([[A, A, A], [D, D, D]]);
    expect(out.kappa).toBeCloseTo(1, 10);
    expect(out.observedAgreement).toBeCloseTo(1, 10);
    expect(out.expectedAgreement).toBeCloseTo(0.5, 10);
  });

  it("is -1 when raters split evenly on every item", () => {
    // Observed agreement 0, expected 0.5, so (0 - 0.5) / 0.5 = -1.
    const out = fleissKappa([[A, D], [A, D]]);
    expect(out.kappa).toBeCloseTo(-1, 10);
  });

  it("is undefined, not 1, when every item is unanimous on the SAME category", () => {
    // Expected agreement is also 1, so kappa is 0/0. Reporting 1 here would claim
    // the raters beat chance when there was no chance to beat.
    const out = fleissKappa([[A, A], [A, A]]);
    expect(out.kappa).toBeNull();
    expect(out.undefinedReason).toContain("one category");
  });

  it("is undefined with no usable items", () => {
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

Expected: FAIL - `../agreement.js` does not exist.

- [ ] **Step 3: Implement**

Create `services/api/agreement.ts`:

```ts
import type { Call } from "./deliberation.js";

/**
 * How much a room agreed. Spec section 6.4 governs what this may be used for:
 *
 *   "Counts are never an input to the verdict, and are shown to a later reader as
 *    context only."
 *
 * That clause is what makes this admissible at all. An agreement figure is a
 * MEASUREMENT OF THE ROOM, not evidence about the compound. Nothing here may gate
 * signing, weight an adjudication, or reorder a position. If a future change makes
 * any outcome depend on a number in this file, that change is the defect.
 *
 * Why it is worth measuring: the disagreement literature is the reason this product
 * exists. Expert DILI causality assessment in the DILIN network reaches weighted
 * kappa 0.60 (Hayashi et al. 2015, Liver International), with 14% of cases crossing
 * the DILI/not-DILI threshold on re-adjudication. Until now ARBITER could describe
 * disagreement (see disagreementReport) but could not quantify it, which meant the
 * one number a reader would want to compare against that literature did not exist.
 */

export interface CaseAgreement {
  raters: number;
  /** Proportion of rater PAIRS that made the same call. 1 is unanimity, 0 is all-different. */
  pairwiseAgreement: number;
  modalCall: Call;
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
 * estimated from the very item being scored. Reporting a chance-corrected figure
 * from one observation would be a statistic with no sampling behind it.
 */
export function caseAgreement(calls: Call[]): CaseAgreement | null {
  const n = calls.length;
  if (n < 2) return null;

  const counts = tally(calls);
  let agreeingPairs = 0;
  for (const k of counts.values()) agreeingPairs += (k * (k - 1)) / 2;
  const totalPairs = (n * (n - 1)) / 2;

  // Ties broken by the call name so the result is deterministic across runs.
  let modalCall: Call = calls[0]!;
  let best = -1;
  for (const [call, k] of [...counts.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    if (k > best) { best = k; modalCall = call; }
  }

  return { raters: n, pairwiseAgreement: agreeingPairs / totalPairs, modalCall, dissenters: n - best };
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
 * Fleiss' kappa across several cases. Chance-corrected, nominal, UNWEIGHTED.
 *
 * Unweighted on purpose. A weighted kappa needs an ordering over the categories,
 * and asserting that "cannot_conclude" sits between "advance" and "do_not_advance"
 * would be a scientific claim smuggled in as a formatting choice - a case nobody
 * can call is not half a stop. If an ordering is ever wanted it gets registered
 * with a rationale, like every other policy in this repository.
 *
 * Varying rater counts per item are handled with the per-item n in the observed
 * term and the pooled assignments in the expected term, which is the standard
 * generalisation.
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

  // Observed: mean over items of the proportion of agreeing pairs within the item.
  let observedSum = 0;
  for (const it of usable) {
    const n = it.length;
    let sq = 0;
    for (const k of tally(it).values()) sq += k * k;
    observedSum += (sq - n) / (n * (n - 1));
  }
  const observedAgreement = observedSum / usable.length;

  // Expected: sum over categories of the squared pooled proportion.
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

- [ ] **Step 5: Commit**

```bash
git add services/api/agreement.ts services/api/test/agreement.test.ts
git commit -m "Measure how much a room agreed

Pairwise agreement per case and Fleiss' kappa across cases, as two functions
because they answer different questions: kappa on a single item is 0/0 whenever
the room is unanimous. Context for a later reader only - spec section 6.4 forbids
counts from entering any verdict, and nothing here is wired to one."
```

---

## Task 6: Surface the split, and the agreement, at the reveal

**This task is larger than it looks, and the reason is worth stating.** `disagreementReport()` has existed, fully implemented and unit-tested, since the deliberation was built - and it **reaches no user.** It is on no HTTP route, absent from the client's `api.ts`, and rendered by no component; its only caller is `services/api/deliberation-demo.ts`, a terminal script. The consequence today: when the room agrees, the reader gets the unanimity block and its concerns. **When the room splits - the case the entire product is named for - the unanimity block is suppressed and the reader gets raw positions side by side and nothing else.**

So this task ships the split *and* the agreement figure together. The agreement number without the split is a statistic with no story; the split without the number is what exists now.

**Files:**
- Modify: `services/api/deliberation.ts` (extend `DisagreementReport`)
- Modify: `services/api/server.ts` (two routes)
- Modify: `apps/deliberation/src/api.ts` (two client methods)
- Modify: `apps/deliberation/src/screens.tsx` (render it)
- Modify: `services/api/test/deliberation.test.ts`

**Interfaces:**
- Consumes: `caseAgreement`, `fleissKappa`, `CaseAgreement`, `KappaReport` from Task 5; the existing `disagreementReport(c): DisagreementReport | null` at `services/api/deliberation.ts:447`, whose shape is `{ split: {call, participantIds[]}[], contested: string[], oneSided: {findingId, call}[] }`.
- Produces: `DisagreementReport.agreement: CaseAgreement | null`; `GET /api/cases/:id/disagreement`; `GET /api/agreement`.

- [ ] **Step 1: Write the failing test**

Add to `services/api/test/deliberation.test.ts` (match the existing helpers in that file for building a case; do not invent new ones):

```ts
it("reports how much the room agreed, alongside the shape of the split", () => {
  // Three participants: two advance, one do_not_advance.
  // Agreeing pairs = 1 of 3, so 0.333...
  const c = caseWithPositions(["advance", "advance", "do_not_advance"]);
  const report = disagreementReport(c);
  expect(report?.agreement?.raters).toBe(3);
  expect(report?.agreement?.pairwiseAgreement).toBeCloseTo(1 / 3, 10);
  expect(report?.agreement?.dissenters).toBe(1);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run services/api/test/deliberation.test.ts
```

Expected: FAIL - `agreement` is not a property of `DisagreementReport`.

- [ ] **Step 3: Extend the report**

In `services/api/deliberation.ts`, import and extend:

```ts
import { caseAgreement, type CaseAgreement } from "./agreement.js";
```

Add to the `DisagreementReport` interface:

```ts
  /** How much the room agreed. Context for a later reader; never an input to the
   *  verdict, per spec section 6.4. Null when fewer than two positions exist. */
  agreement: CaseAgreement | null;
```

And in `disagreementReport()`, add to the returned object:

```ts
    agreement: caseAgreement(c.positions.map((p) => p.call)),
```

- [ ] **Step 4: Run and watch it pass**

```bash
npx vitest run services/api/test/deliberation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add both routes**

In `services/api/server.ts`, in the authenticated `/api/cases/:id` GET block beside `unanimity` (currently `server.ts:255-258`), add:

```ts
if (parts[3] === "disagreement") return json(res, 200, deps.service.disagreement(caseId));
```

and add a `disagreement(caseId)` method to `DeliberationService` that loads the case and returns `disagreementReport(c)`. It returns `null` when fewer than two distinct calls exist, and `null` is a correct answer meaning "the room did not split" - do not convert it to a 404.

Then, beside `GET /api/people` (`server.ts:149`), add the cross-case route:

```ts
if (parts[1] === "agreement") return json(res, 200, deps.service.agreementAcrossCases(user.id));
```

`agreementAcrossCases` reads the cases this account may read, keeps those with two or more positions, and returns `fleissKappa(cases.map((c) => c.positions.map((p) => p.call)))`.

**Scope it to cases the caller can read.** Every other read route in this file is access-controlled and a κ computed over cases the caller cannot see would leak the shape of those cases. Follow the exact auth and error conventions of the neighbouring GET handlers.

- [ ] **Step 6: Add the client methods**

In `apps/deliberation/src/api.ts`, beside the existing `unanimity` call, add `disagreement(caseId, token)` and `agreementAcrossCases(token)` with the response types mirrored from the server, exactly as the other methods in that file mirror theirs.

- [ ] **Step 7: Render the split and the number at the reveal**

In `apps/deliberation/src/screens.tsx`, in `Reveal` (currently `screens.tsx:528-562`): the unanimity block renders only when unanimous (`:549`). Add the else branch - **this is the half that has never been on screen.**

```tsx
{report === null ? null : (
  <section className="split">
    <h3>Where the room split</h3>

    {report.split.map((camp) => (
      <p key={camp.call} className="split-camp">
        <strong>{callLabel(camp.call)}</strong>
        {": "}
        {camp.participantIds.map(nameOf).join(", ")}
      </p>
    ))}

    {report.contested.length === 0 ? null : (
      <p className="contested">
        Read differently by both sides: {report.contested.map(findingLabel).join("; ")}.
      </p>
    )}

    {report.oneSided.length === 0 ? null : (
      <p className="one-sided">
        Cited by one side and unanswered by the other:{" "}
        {report.oneSided.map((o) => findingLabel(o.findingId)).join("; ")}.
      </p>
    )}

    {report.agreement === null ? null : (
      <p className="agreement">
        <strong>{Math.round(report.agreement.pairwiseAgreement * 100)}%</strong> pairwise
        agreement across {report.agreement.raters} positions,{" "}
        {report.agreement.dissenters} dissenting.
        <span className="agreement-note">
          Context for the record. It does not weigh the positions, it does not
          affect the adjudication, and nobody is outvoted by it.
        </span>
      </p>
    )}
  </section>
)}
```

Reuse the existing `nameOf` / finding-label helpers in that file rather than writing new ones; if none exists for findings, add one small local function beside `basisOf` (`screens.tsx:13-17`).

**The copy discipline matters here.** "Where the room split" is a description. Do not write "the majority held", "the minority view", or anything that ranks a camp by size - spec §6.4 and the language rules in HANDOVER §1.3 both forbid it, and a reader who sees a headcount reads it as a result.

- [ ] **Step 8: Add a client test**

`apps/deliberation/test/screens.test.tsx` is the only test file in that app, and it imports from `screens.tsx` only, so it is the right place. Add a test that renders `Reveal` with a split case and asserts both camps and the agreement percentage appear, and one that asserts the words "majority" and "outvoted" appear nowhere in the rendered output.

- [ ] **Step 9: Typecheck, test, commit**

```bash
npm run typecheck && npx vitest run
git add services/api/deliberation.ts services/api/server.ts \
        services/api/deliberation-service.ts services/api/test/deliberation.test.ts \
        apps/deliberation/src/api.ts apps/deliberation/src/screens.tsx \
        apps/deliberation/test/screens.test.tsx
git commit -m "Show where the room split, and how much it agreed

disagreementReport has been implemented and unit-tested since the deliberation
was built, and reached no user: no route, no client method, no component. A
split room saw raw positions side by side and nothing else. It is now served at
GET /api/cases/:id/disagreement and rendered at the reveal, with pairwise
agreement beside it and Fleiss' kappa across cases on GET /api/agreement.

Labelled as context that does not weigh positions. Spec section 6.4 forbids
counts from deciding anything and no camp is described by its size."
```

---

## Task 7: Commit before reveal in the product app

Buçinca, Malaya & Gajos (2021, *Proc. ACM Hum.-Comput. Interact.* 5, CSCW1, Article 188) measured that explanation-only designs *increase* over-reliance on incorrect AI recommendations, and that interventions compelling analytical engagement reduce it. `apps/deliberation` already embodies this - blind submission is a cognitive forcing function. `apps/web` does not: `CaseHeader` renders `VerdictLabel` the moment the tab mounts.

**The structure to work with.** `CaseTab` (`apps/web/src/tabs/Case/index.tsx`, 35 lines) takes no props and reads the store. It renders `<CaseHeader />` above a three-region `case-grid` holding `EvidencePanel`, `TracePanel` and `TablePanel`, with a spotlight that collapses two regions to 56px rails when the third is focused. The verdict lives in **two** places: `CaseHeader` (VerdictLabel, belief/plausibility, Gap) and `TracePanel` (BeliefTrack, mass line, verdict reason, counterfactual).

So the gate covers `CaseHeader` and the `TracePanel` region, and leaves `EvidencePanel` and `TablePanel` alone. Putting the prompt **into the trace region** keeps the grid intact rather than fighting the `[data-focus]` transition.

**Files:**
- Modify: `apps/web/src/state/store.tsx`
- Modify: `apps/web/src/tabs/Case/index.tsx`
- Create: `apps/web/test/commitBeforeReveal.test.tsx`

**Interfaces:**
- Consumes: the existing store and `CaseTab`. Independent of every other task.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/commitBeforeReveal.test.tsx`, following the render helpers used by the existing tests in `apps/web/test/`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CaseTab } from "../src/tabs/Case/index.js";

describe("commit before reveal", () => {
  it("hides the verdict until the reader has made their own call", () => {
    renderCaseTab();
    expect(screen.queryByTestId("verdict-header")).toBeNull();
    expect(screen.getByTestId("provisional-prompt")).toBeTruthy();
  });

  it("reveals the verdict once a provisional call is recorded", () => {
    renderCaseTab();
    fireEvent.click(screen.getByTestId("provisional-advance"));
    expect(screen.getByTestId("verdict-header")).toBeTruthy();
  });

  it("keeps the evidence readable before the call, because the call needs it", () => {
    renderCaseTab();
    expect(screen.getByTestId("evidence-panel")).toBeTruthy();
  });
});
```

Add a `renderCaseTab()` helper in that file that mounts the tab inside whatever provider `apps/web/test/load.test.ts` already uses. **Read that file first and reuse its setup rather than writing a second one.**

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run apps/web/test/commitBeforeReveal.test.tsx
```

Expected: FAIL - no `provisional-prompt` element exists, and the verdict header renders immediately.

- [ ] **Step 3: Hold the provisional call in the store**

In `apps/web/src/state/store.tsx`, add to the state shape:

```ts
  /** The reader's own call, recorded BEFORE the engine's verdict is shown.
   *
   *  Buccinca et al. 2021 (CSCW): explanations alone increase over-reliance, and a
   *  forcing function that compels an analytical commitment reduces it. Per compound,
   *  because the point is a fresh judgement on each case rather than a mode the
   *  reader switches off once. Not persisted: this is a discipline, not a record,
   *  and the record of a real position lives in the deliberation client. */
  provisionalCall: Record<string, "advance" | "do_not_advance" | "cannot_conclude">;
```

with a `setProvisionalCall(compoundId, call)` action alongside the existing actions.

- [ ] **Step 4: Gate the verdict in the Case tab**

Rewrite `CaseTab` so `CaseHeader` and the trace region are gated on the provisional call. Keep the `case-grid` and the spotlight exactly as they are - the prompt takes the trace region's slot so the three-region layout never changes shape.

```tsx
export function CaseTab() {
  const { tour, selectedCompoundId, provisionalCall } = useAppState();
  const dispatch = useDispatch();
  const focus = tour.focus;
  const toggle = (r: Region) => dispatch({ type: "setFocus", focus: focus === r ? null : r });
  const collapsed = (r: Region) => focus !== null && focus !== r;
  const regionClass = (r: Region) => `case-region${collapsed(r) ? " is-rail" : ""}`;

  // The forcing function. Buccinca et al. 2021: an explanation shown before the
  // reader has committed is an anchor, and the measured effect of explaining
  // without one is MORE over-reliance, not less. So the verdict and the trace
  // wait; the evidence does not, because the call cannot be made without it.
  const committed = provisionalCall[selectedCompoundId] !== undefined;
  const commit = (call: "advance" | "do_not_advance" | "cannot_conclude") =>
    dispatch({ type: "setProvisionalCall", compoundId: selectedCompoundId, call });

  return (
    <section>
      {committed ? <CaseHeader /> : null}
      <div className="case-grid" data-focus={focus ?? ""}>
        <div className={regionClass("evidence")}>
          <EvidencePanel collapsed={collapsed("evidence")} onExpand={() => toggle("evidence")} />
        </div>
        <div className={regionClass("trace")}>
          {committed ? (
            <TracePanel collapsed={collapsed("trace")} onExpand={() => toggle("trace")} />
          ) : (
            <section className="provisional" data-testid="provisional-prompt">
              <h2>Your call first</h2>
              <p>
                Read the evidence, then record what you would decide. ARBITER's
                verdict and its reasoning appear once you have. Committing first is
                what keeps this a second opinion rather than an anchor.
              </p>
              <button data-testid="provisional-advance" onClick={() => commit("advance")}>Advance</button>
              <button data-testid="provisional-do-not-advance" onClick={() => commit("do_not_advance")}>Do not advance</button>
              <button data-testid="provisional-cannot-conclude" onClick={() => commit("cannot_conclude")}>Cannot conclude</button>
            </section>
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

Then in `CaseHeader.tsx`, put `data-testid="verdict-header"` on the element that already wraps `VerdictLabel` (currently around line 44), and beside it render the reader's own call so the comparison is visible - that agreement or disagreement is the whole payoff of having asked:

```tsx
<p className="your-call" data-testid="your-call">
  You said <strong>{callLabel(provisionalCall[selectedCompoundId])}</strong>.
</p>
```

Give `EvidencePanel`'s root `data-testid="evidence-panel"` if it does not already carry one.

- [ ] **Step 5: Run and watch them pass**

```bash
npx vitest run apps/web/test/commitBeforeReveal.test.tsx
```

Expected: PASS, all three.

- [ ] **Step 6: Check the demo path still works from a cold browser**

The PDF's demo walks the Case view. Confirm the gate does not break the walkthrough:

```bash
npm run dev
```

Open `http://localhost:5173/app/#/case`, confirm the prompt appears, click a call, confirm the verdict and the trace render. **If the gate makes the demo awkward under time pressure, the research brief's own fallback applies:** trigger the forcing function only on high-conflict or high-uncertainty cases rather than universally. Make that call now, not on stage.

- [ ] **Step 7: Run everything and commit**

**Also run the e2e suite.** `apps/web/e2e/demo.spec.ts` walks the demo path and will fail if the gate blocks it - which is exactly what you want to find out here rather than on stage.

```bash
npm run typecheck && npx vitest run && npm run e2e
git add apps/web/src/state/store.tsx apps/web/src/tabs/Case/index.tsx \
        apps/web/src/tabs/Case/CaseHeader.tsx apps/web/src/tabs/Case/EvidencePanel.tsx \
        apps/web/test/commitBeforeReveal.test.tsx
git commit -m "Ask the reader for their call before showing the verdict

Buccinca et al. 2021 measured that explanations alone increase over-reliance and
that a forcing function reduces it. The evidence panel stays visible throughout:
the gate is on the answer, not on the reading."
```

---

## Task 8: Make every claim match the code

The PDF's Q&A script (§21) contains an answer that was not true when this plan was written. Tasks 2 and 3 make it true. This task walks the rest of the claim surface and fixes anything else that has drifted, then records what changed.

**Files:**
- Modify: `HANDOVER.md` (new §14)
- Modify: `apps/web/src/tabs/About.tsx` and `apps/landing/src/sections/*` **only where a claim is now wrong**

**Interfaces:**
- Consumes: the measured outputs of Tasks 1, 3, 4.
- Produces: the final claim surface.

- [ ] **Step 1: Check each PDF Q&A answer against the code, and write the verdict beside it**

Work through PDF §21 one answer at a time. For each, name the file that makes it true or note that nothing does:

| answer | check |
|---|---|
| "the expert decides every case ... every override is recorded" | `services/api/deliberation.ts` sign/override path |
| "fourteen rules, each traced to a published framework" | **Only six are implemented.** Either say six, or say "six implemented, eight specified" - never fourteen unqualified |
| "we built that as a baseline and measured it" (LLM ablation) | `apps/harness/src/ablation/` |
| "we detect and report the conflict measure ... apply a documented alternative combination beyond a threshold" | True after Tasks 3 and 4. Cite `rules/fusion-policy-v1.1.json`, and show it on the Case tab |
| "byte-identical traces" | `apps/harness/src/golden.ts` |
| "the rule base has not yet been reviewed by a practising toxicologist" | Still true. Keep it - naming your own gap is the strongest answer in the script |

- [ ] **Step 2: Fix the rule-count claim wherever it appears**

```bash
grep -rn "fourteen rules\|14 rules\|R1-R14\|R14" --include="*.tsx" --include="*.ts" --include="*.md" apps packages services docs HANDOVER.md | grep -v node_modules
```

Every hit outside a spec document that describes an unbuilt future must say six. The specs may keep their own wording; they are dated records of what was believed.

- [ ] **Step 3: Write HANDOVER §14**

Append to `HANDOVER.md`:

```markdown
## 14. Research convergence, 2026-08-13

Plan: `docs/superpowers/plans/2026-08-13-arbiter-research-convergence.md`.

A literature brief supplied on 13 August was checked against this repository. Its
headline recommendation - build a collaborative multi-reviewer adjudication layer -
was already built; see §6 of the redesign spec. Three genuine gaps were found and
three were closed.

| gap | closed by | measured result |
|---|---|---|
| Consistency was claimed and never measured | Gate 0 run | *[flip rate from results/gate0-consistency.txt]* |
| Only Dempster's rule existed, while the Q&A script promised an alternative above a threshold | `rules/fusion-policy-v1.1.json`, `packages/engine/src/fuse.ts` | *[from results/fusion-delta.md]* |
| The conflict measure was computed and shown to nobody | `apps/web/src/tabs/Case/TracePanel.tsx` | on screen, with the rule that produced the interval |
| No quantitative inter-rater agreement figure existed | `services/api/agreement.ts` | pairwise per case, Fleiss' kappa across cases |
| `disagreementReport` had no route, no client method and no renderer, so a split room saw only raw positions | `GET /api/cases/:id/disagreement`, `apps/deliberation/src/screens.tsx` | the split, the contested findings and the one-sided ones, at the reveal |

Not built, and why: rules R7-R14 (the v2.0 scope note stands - unimplemented rules
must not enter a hashed surface), SEND/QAF/V&V40/PROV-O, conformal applicability
domains, federated rule exchange, endpoints two through four. All are roadmap.

**The agreement statistic never decides anything.** Spec §6.4 permits it as context
shown to a later reader and forbids counts from entering a verdict. If a later
change makes any outcome depend on it, that change is the defect.
```

Fill the italicised cells with the real numbers.

- [ ] **Step 4: Full verification**

```bash
npm run typecheck && npm run lint && npx vitest run && npm run e2e
```

Expected: all green. `npm run e2e` needs the dev server; start it first if the config does not.

- [ ] **Step 5: Commit**

```bash
git add HANDOVER.md apps/web/src/tabs/About.tsx apps/landing/src
git commit -m "Reconcile every stated claim with what the code does

Rule count corrected to six wherever it was stated as fourteen outside a dated
spec. HANDOVER section 14 records the three gaps the 13 August research brief
surfaced, what closed them, and what was deliberately left as roadmap."
```

---

## Execution order and the three-day reality

Because `services/api` never imports the engine (§A.1a), the plan splits cleanly into two independent tracks that touch no common file except `HANDOVER.md`.

| day | task | track | owner suggestion | blocked by |
|---|---|---|---|---|
| 13 Aug (tonight) | **Task 1 - Gate 0** | measurement | whoever holds the key | an `ANTHROPIC_API_KEY` |
| 14 Aug | Task 2 → Task 3 → Task 4 | engine + web | Jose | nothing |
| 14 Aug | Task 5 → Task 6 | API + deliberation | Jack | nothing |
| 15 Aug | Task 7 | web | Andres | nothing |
| 15 Aug | Task 8 | all three | all three | Tasks 1, 3, 4, 6 |
| 16 Aug | rehearsal, recorded walkthrough, **submit early** | - | all three | everything |

**Tasks 2-7 have no dependency on Task 1**, so a missing API key delays only the consistency number, not the build. **Task 8 must not start before Tasks 1, 3, 4 and 6 land**, since its whole job is to quote their results.

Within the engine track the order is forced: Task 3 needs Task 2's rule, and Task 4 displays what Task 3 activates. Within the API track, Task 6 needs Task 5's functions. **The two tracks never need to be merged in a particular order.**

**If time compresses, cut in this order:**

1. **Task 7** (commit-before-reveal). `apps/deliberation` already demonstrates the forcing function through blind submission, so the research angle survives intact without the web app change.
2. **Task 6's cross-case κ route** - keep the per-case split and pairwise figure, which is where the story is. The κ comparison to the DILIN literature is the nice-to-have.
3. **Task 4's plain-language reading** - keep the number and the rule label.

**Never cut Task 1, Task 3, or Task 6's split renderer.** Task 1 is the primary claim of the entire product. Task 3 is what makes a scripted Q&A answer true. Task 6's split renderer is the case the product is named for, and it currently shows a reader nothing.
