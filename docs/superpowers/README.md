# Which document is in force

Read this before acting on anything in `specs/` or `plans/`.

This project changed architecture on **2026-08-09**. An audit found the benchmark could
not support the claims being made on it, and the engine-as-decider design was retired.
Most documents here predate that. **None of them were rewritten**, on the same principle
the repo applies to `rules/ruleset-v1.0.json` and `prompts/adjudicator-v1.0.json`: a
superseded artifact is labelled, never edited, because the correction is worth more than
a tidy record.

So every pre-redesign document now opens with a banner saying what happened to it. The
banner is the current truth; the body is what was believed on its own date.

## The architecture, as of now

| | |
|---|---|
| **`apps/deliberation`** | **The product.** Four case stages - Evidence, Your position, Reveal & verdict, Record. New product surface goes here. |
| **`services/api`** | The backend. Accounts, cases, blind submission, document screening, and the AI adjudicator that produces the verdict. |
| **`packages/engine`** | Kept. Demoted from the decider to the instrument that measures the decider. |
| **`apps/web`** | Predecessor. The seven-tab browser app, still submitted for judging. Keep it working; do not grow it. |
| **`apps/landing`** | Marketing page. Its `APP_URL` points into `apps/deliberation`. |

## In force

| Document | Status |
|---|---|
| `specs/2026-08-09-arbiter-ai-redesign-design.md` | **The current architecture.** Start here. |
| `specs/2026-08-09-arbiter-completion-plan.md` | Supersedes the redesign's own §8 build order. |
| `specs/2026-08-10-model-provider-decision.md` | The recorded provider decision the redesign §9 requires. |
| `specs/2026-08-10-section-4.2-inputs-scope.md` | What the redesign needs and does not yet have. |

## Superseded, kept for the record

| Document | What changed |
|---|---|
| `specs/2026-07-26-arbiter-design.md` | **Partly** superseded. Still authoritative for the problem statement, the language discipline and the record model. No longer authoritative for who decides. |
| `specs/2026-07-27-arbiter-phase2-web-app-design.md` | Designs `apps/web`. Replaced as the product by `apps/deliberation`. |
| `specs/2026-07-28-arbiter-phase3-ai-surfaces-design.md` | The AI became the decider rather than an assistant. Its fallback ladder is now against policy. |
| `specs/2026-08-05-arbiter-llm-ablation-design.md` | Its baseline stopped being the incumbent, and its figures were graded under the retired target. |
| `specs/2026-08-05-arbiter-multi-case-design.md` | Cases moved out of the static bundle and into the service. |
| `specs/2026-08-06-arbiter-cmax-exposure-design.md` | Still relevant - the rules are kept - but the rulebook now versions and the rules no longer decide alone. |
| `specs/2026-08-06-arbiter-custom-compound-intake-design.md` | Designs a tab on the predecessor app. |

## The plans are history, not a queue

Every file in `plans/` **has already been executed and merged.** Each one opens with

> **For agentic workers:** … use superpowers:executing-plans to implement this plan
> task-by-task.

**That instruction is spent in all of them.** It is the most dangerous line in this
directory: an agent that opens `plans/2026-07-27-arbiter-phase2-web-app.md` and follows
it in good faith will rebuild the superseded design, checkbox by checkbox, and every
step will appear to succeed. Each plan now carries a banner above that line saying so.

Checkboxes below those banners record what was done. They are not work outstanding.
