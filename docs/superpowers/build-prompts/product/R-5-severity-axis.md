# R-5: Give the ruleset a vocabulary for severity

| | |
|---|---|
| **Priority** | Post-submission. This is the structural finding, and it is the most scientifically interesting thing left to build. |
| **Estimated effort** | 4 to 6 days including re-scoring |
| **Depends on** | nothing |
| **Touches** | `rules/ruleset-v3.0.json` (new), `packages/engine/src/types.ts`, `schema.ts`, `rules.ts`, `apps/harness/src/preregistration.ts`, data assembly |
| **Do not touch** | `rules/ruleset-v1.0.json`, `rules/ruleset-v2.0.json`. Registered rulesets are immutable. |

---

## The finding this fixes

`HANDOVER.md` section 13.1, third finding, is the one no threshold change can address:

> Of 7 commitments, 2 are Most-DILI-Concern and 5 are Less-DILI-Concern, and every one of
> those 5 (prochlorperazine, thioridazine, glyburide, mifepristone, irbesartan) is a
> genuine BSEP inhibitor. The engine found something true and then said *do not advance*
> about approved, widely prescribed drugs. **The ruleset has no vocabulary for severity,
> so this is structural and no threshold moves it.**

This is simultaneously the best and worst result in the project. The mechanism detection
is **right**: those compounds really do inhibit the bile salt export pump. What the system
cannot do is distinguish a real mechanism from a **clinically manageable** one. Irbesartan
inhibits BSEP and is a widely prescribed antihypertensive; both facts are true, and the
ruleset can only express the first.

The playbook's Q and A answer names this as the honest response to the hardest question a
judge can ask, and adds: "The next version needs a severity axis, and we would rather name
that than hide it behind a tuned cutoff." This prompt builds it.

---

## The constraint that shapes everything

**Registered rulesets are immutable.** `rules/ruleset-v1.0.json` and
`rules/ruleset-v2.0.json` are never edited. A change mints
`rules/ruleset-v3.0.json` with its own hash, its own `registeredAt`, a written
`reregistrationReason`, and every result already reported stays attached to the version
that produced it. That is already how `rulesetHash` works throughout the codebase.

**And the trap that v2.0 already warned you about.** From its own `scopeNote`:

> The expanded checklist the 2026-08-09 redesign calls for is deliberately NOT registered
> here. Nothing implements those rules yet, and registering rules no code consumes would
> put six inert entries into a hashed surface.

So: **do not register a severity rule before the engine reads it.** Build the mechanism
first, register second. If you register a rule the code ignores, the hash becomes a
promise the system does not keep, and the pre-registration discipline that makes every
other number in this project credible is the thing you have damaged.

---

## The design question, which is genuine and not settled

Severity is a property of **the adverse outcome**, not of a single claim. A BSEP
inhibition assay result is the same measurement whether the compound turns out to be
irbesartan or troglitazone. So severity cannot simply be a field on `EvidenceClaim` in the
way `klimisch` is.

Three shapes are worth considering, and the prompt does not choose for you because the
choice is a scientific one:

1. **A severity dimension on the conclusion, not the claim.** The engine currently fuses
   toward a binary frame `{toxic, safe}`. A severity axis makes the frame richer:
   `{disqualifying, manageable, safe}`. This is the most honest shape and the most
   invasive: it changes the frame, so it changes `fuse.ts`, every mass, and the meaning of
   belief and plausibility. Golden files move everywhere.
2. **A severity qualifier carried by specific evidence types.** Some findings speak to
   severity directly: Hy's Law cases, dechallenge and rechallenge outcomes, reversibility,
   injury pattern, latency, expected frequency. These are exactly the categories the
   2026-08-09 audit found missing. Under this shape a new rule family reads those fields
   and can defeat a do-not-advance conclusion that rests only on mechanism.
3. **A post-verdict severity report.** The verdict stays as it is and a separate
   computation reports what kind of injury the committed evidence implies. Cheapest,
   least invasive, and it does not fix the false positives; it only explains them.

**Shape 2 is the recommended starting point.** It is the one the redesign spec already
anticipated when it listed the missing categories as "dose magnitude, injury pattern,
reversibility and adaptation, expected frequency, reactive-metabolite formation, latency
and dechallenge", and it does not require changing the fusion frame.

---

## Step by step

- [ ] **Step 1: Read the evidence, not the theory**

Look at the five compounds the finding names, in the actual results:

```bash
python3 - <<'EOF'
import json
res = json.load(open('results/results.json'))
comps = json.load(open('data/out/compounds.json'))
names = ["prochlorperazine","thioridazine","glyburide","mifepristone","irbesartan"]
by_key = {c.get('inchikey'): c for c in (comps if isinstance(comps, list) else comps.get('compounds', []))}
rows = res if isinstance(res, list) else res.get('rows', [])
for r in rows:
    c = by_key.get(r.get('compoundId') or r.get('inchikey'), {})
    label = (c.get('name') or '').lower()
    if any(n in label for n in names):
        print(label, r.get('verdict'), r.get('belief'), r.get('conflictMass'))
EOF
```

Adjust the key names to the real shapes if they differ. The point is to look at the five
cases before designing anything, because the design has to be able to say something
different about them.

- [ ] **Step 2: Decide the shape, and write the decision down before coding**

Write `docs/superpowers/specs/<date>-arbiter-severity-design.md` recording which of the
three shapes you chose and why, and what you considered and rejected. This repository's
specs carry rejected alternatives on purpose; a decision without its alternatives cannot
be reviewed later.

- [ ] **Step 3: Add the field to the claim schema, engine-side, with tests**

Whatever shape you chose, the engine change comes before the registration. Extend
`packages/engine/src/types.ts` and `schema.ts` together, because the bidirectional drift
guard in `schema.ts` fails if only one moves. Keep `packages/engine/src` pure: no `Date`,
no `Math.random`, no `node:` imports, no filesystem.

- [ ] **Step 4: Implement the rule, with the defeat or discount behaviour tested directly**

Follow the existing pattern in `packages/engine/src/rules.ts`, where each rule has a
predicate and participates either in the defeat relation or in the mass discount. Write
the test that shows a manageable-severity finding changing the outcome on one of the five
named compounds, and watch it fail before implementing.

- [ ] **Step 5: Pre-register the expected effect, before re-scoring**

This is the step that makes the result credible, and it must happen **before** you run the
re-score. In `rules/ruleset-v3.0.json`, alongside the rules, write an `expectedEffect`
field naming the direction you expect and why. Ruleset v2.0 did exactly this and then
reported a result that made its own headline worse.

The honest expectation here: false positives on the five Less-concern commitments should
fall, and **coverage may fall too**, because a system that can say "real mechanism,
manageable severity" has a new way to decline. If coverage rises and accuracy rises
together on the first attempt, be suspicious of your own test set before you celebrate.

- [ ] **Step 6: Register v3.0 with its hash and rationale**

Mint the new file only now, with the engine already reading every rule in it. Add its hash
to `apps/harness/src/preregistration.ts` beside `PRE_REGISTERED_HASH` and
`PRE_REGISTERED_HASH_V2`.

- [ ] **Step 7: Re-score, report against the pre-registered expectation, and say if it missed**

Report per class, with n and class balance. If the expectation did not hold, that is the
finding and it gets written down, not tuned away.

---

## Definition of done

- [ ] `rules/ruleset-v3.0.json` exists, hashed and registered, and **every rule in it is
      read by code**.
- [ ] `rules/ruleset-v1.0.json` and `rules/ruleset-v2.0.json` are byte-identical to before.
- [ ] The expected effect was registered before the re-score ran.
- [ ] At least one of the five named compounds is now handled differently, and the change
      is explained by a rule a toxicologist could argue with.
- [ ] Every previously reported result is still attached to the ruleset version that
      produced it.

## Traps specific to this task

- **Do not register rules the engine ignores.** v2.0's `scopeNote` explains exactly why,
  and repeating that mistake would damage the pre-registration claim that carries this
  whole project.
- **Do not tune the severity threshold to fix the five compounds.** That is fitting to the
  answer key. The five are the motivation, not the objective.
- **Severity is not a second confidence.** A high-confidence finding of a manageable injury
  and a low-confidence finding of a fatal one are different in kind, and collapsing them
  into one number reintroduces the exact defect that produced the retired headline.
- **Changing the fusion frame is a much larger change than it looks.** Under shape 1,
  belief and plausibility stop meaning what every existing test, golden file and UI label
  assumes they mean.
