// NOTE: `argue` is deliberately NOT imported. An earlier draft derived the
// candidate rules from `argue().attacks`, which is exactly the defect this module
// documents below - the attack list only contains defeat rules that fired, and
// misses every rule acting through the discount path.
import { EvidenceClaimSchema } from "./schema.js";
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
  /**
   * EXPERT-ELICITED confidence a completed result would carry. Per-assay rather
   * than one shared constant: a Klimisch 1 in vivo study and a read-across
   * refinement do not produce equally strong evidence, and an earlier draft hard-
   * coded 0.85 for both inside the engine, which put an undisclosed number in
   * source instead of in the reviewable catalogue.
   */
  resultStrength: number;
}

type ReasonFn = (claims: EvidenceClaim[], ruleset: Ruleset) => Reasoning;

/** Every rule id, in a fixed order so `pivotalRules` output is stable. */
const ALL_RULES: readonly RuleId[] = ["R1", "R2", "R3", "R4", "R5", "R6"] as const;

/**
 * Which rules is the verdict actually resting on?
 *
 * A rule is pivotal when disabling it changes the verdict. That is the whole
 * definition, and it is deliberately applied to ALL SIX RULES rather than only to
 * the rules that produced an attack.
 *
 * WHY THAT DISTINCTION IS LOAD-BEARING. An earlier draft took the candidate set
 * from `argue().attacks`, which only ever contains the four pairwise defeat rules
 * that actually fired. But since Task 7, R1-R5 also act as evidence-quality
 * DISCOUNTS at mass-construction time, and those apply whether or not anything
 * conflicts. The demonstration case is precisely that shape: TAK-994 pass 1 has
 * four non-contradicting safe claims, so NO attack occurs, so an attacks-derived
 * candidate set is EMPTY - and the planner would have had no argument structure
 * to work with in exactly the scenario the spec's beat 5 is built on. Disabling
 * R1 there changes the verdict via the discount path, so R1 is genuinely pivotal
 * and this version finds it.
 *
 * Costs six extra engine evaluations. `reasonFn` must therefore be an
 * extras-free entry point, or this recurses through the counterfactual search.
 */
export function pivotalRules(claims: EvidenceClaim[], ruleset: Ruleset, reasonFn: ReasonFn): RuleId[] {
  const baseline = reasonFn(claims, ruleset).verdict;
  const pivotal: RuleId[] = [];
  for (const id of ALL_RULES) {
    const rule = ruleset.rules.find((r) => r.id === id);
    // A rule already disabled cannot be what the verdict rests on.
    if (!rule || !rule.enabled) continue;
    const without: Ruleset = {
      ...ruleset,
      rules: ruleset.rules.map((r) => (r.id === id ? { ...r, enabled: false } : r)),
    };
    if (reasonFn(claims, without).verdict !== baseline) pivotal.push(id);
  }
  return pivotal;
}

/**
 * Would this assay produce evidence capable of overturning the given rule?
 *
 * Read against each rule's DISCOUNT condition, since that is the form in which a
 * rule most often decides an abstention: an assay "resolves" a rule when the
 * evidence it produces would not be discounted by it.
 */
export function resolvesRule(id: RuleId, assay: AssayOperator): boolean {
  const p = assay.produces;
  switch (id) {
    // R1 discounts non-human systems. Human evidence escapes it.
    case "R1": return p.system === "human";
    // R2 discounts structural-correlation-only evidence. A measured key event escapes it.
    case "R2": return p.measuresKeyEvent !== null;
    // R3 discounts negatives whose exposure margin was never established.
    case "R3": return p.exposureRelevant === true;
    // R4 discounts out-of-domain predictions. Positive evidence of being IN domain
    // resolves it; merely unassessed (null) does not, which is why this is
    // `=== true` and not `!== false`.
    case "R4": return p.inApplicabilityDomain === true;
    // R5 discounts Klimisch 3 and 4. Klimisch 1 OR 2 escapes it - an earlier draft
    // required exactly 1, which wrongly excluded a reliable Klimisch 2 assay that
    // also out-defeats any Klimisch 3 or 4 study.
    case "R5": return p.klimisch !== null && p.klimisch <= 2;
    // R6 has no verdict-path mechanism of its own: concordance is realised by
    // Dempster's rule inside fuse(), so disabling R6 changes no verdict and it can
    // never be pivotal. Returning `true` here (as an earlier draft did) would have
    // made EVERY assay claim to resolve it the moment that changed.
    case "R6": return false;
    default: return false;
  }
}

/**
 * Pick the single assay that best advances the case.
 *
 * ARGUMENT STRUCTURE IS PRIMARY, VALUE-OF-INFORMATION BREAKS THE TIE. Candidates
 * that would overturn a rule the verdict actually rests on are preferred outright;
 * only among equals does expected gap reduction per unit cost decide.
 *
 * This ordering is the point of the whole task. Spec section 2a claims the planner
 * "does not ask 'which assay is usually informative?'" but asks "which rule is
 * doing the defeating, and what evidence would overturn that specific rule?". An
 * earlier draft computed the pivotal rules and then ranked purely on gap reduction
 * per cost, using pivotality only to phrase the rationale string - which is
 * exactly the generic-informativeness planner the spec disclaims, wearing the
 * right label. The coupling has to reach the CHOICE or the novelty claim is
 * decorative.
 *
 * Lexicographic rather than weighted on purpose: a weight would be one more
 * unregistered coefficient to defend, and this project has already had to delete
 * one of those. "Prefer evidence that would overturn the deciding rule; among
 * those, take the best value per unit cost" needs no number.
 *
 * WHEN THE PLANNER SPEAKS. Only when the engine is undecided or looking at live
 * disagreement. A committed verdict over unanimous evidence has nothing for an
 * experiment to resolve. Both conditions are engine-computed, so no threshold is
 * invented here - an earlier draft used `gap < 0.2`, a bare constant outside the
 * pre-registered ruleset that decided whether advice was offered at all.
 */
export function planNextExperiment(
  claims: EvidenceClaim[],
  ruleset: Ruleset,
  assays: AssayOperator[],
  reasonFn: ReasonFn,
): NextExperiment | null {
  const before = reasonFn(claims, ruleset);
  const gapBefore = before.plausibility - before.belief;

  if (before.verdict !== "abstain" && !before.contested) return null;

  const pivotal = pivotalRules(claims, ruleset, reasonFn);

  type Candidate = {
    assay: AssayOperator;
    reduction: number;
    score: number;
    resolves: RuleId | null;
  };
  const candidates: Candidate[] = [];

  for (const assay of assays) {
    let expectedGapAfter = 0;
    for (const [assertion, p] of [["toxic", assay.priorToxic], ["safe", 1 - assay.priorToxic]] as const) {
      const hypothetical: EvidenceClaim = {
        id: `__hypothetical__${assay.id}`,
        compoundId: claims[0]?.compoundId ?? "X",
        assertion,
        strength: assay.resultStrength,
        // Inert: the engine never reads availableFrom, callers filter on it. Kept
        // obviously synthetic so a hypothetical can never be mistaken for real
        // evidence if one leaks into a trace.
        availableFrom: "0001-01-01",
        provenance: { kind: "database", source: `planned:${assay.id}`, retrieved: "0001-01-01" },
        ...assay.produces,
      };

      // Validated, not merely constructed. The schema forbids an in_silico or qsar
      // claim from asserting a MEASURED key event, and a claim built outside the
      // validated path escapes every discount clause and gets weighted like human
      // clinical evidence. This is a hand-authored catalogue, so a malformed
      // operator must fail loudly here rather than quietly produce a
      // recommendation computed from a mis-weighted claim.
      const parsed = EvidenceClaimSchema.safeParse(hypothetical);
      if (!parsed.success) {
        throw new Error(
          `Assay operator "${assay.id}" produces an invalid EvidenceClaim: `
          + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        );
      }

      const after = reasonFn([...claims, hypothetical], ruleset);
      expectedGapAfter += p * (after.plausibility - after.belief);
    }

    const reduction = gapBefore - expectedGapAfter;
    if (reduction <= 0) continue;
    candidates.push({
      assay,
      reduction,
      score: reduction / assay.cost,
      resolves: pivotal.find((id) => resolvesRule(id, assay)) ?? null,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    // 1. Resolves a pivotal rule.
    const ap = a.resolves === null ? 1 : 0;
    const bp = b.resolves === null ? 1 : 0;
    if (ap !== bp) return ap - bp;
    // 2. Higher information gain per unit cost.
    if (a.score !== b.score) return b.score - a.score;
    // 3. Assay id, so the output is stable rather than dependent on catalogue order.
    return a.assay.id < b.assay.id ? -1 : a.assay.id > b.assay.id ? 1 : 0;
  });

  const best = candidates[0]!;
  return {
    assay: best.assay.name,
    resolvesRule: best.resolves,
    expectedGapReduction: best.reduction,
    cost: best.assay.cost,
    score: best.score,
    rationale: best.resolves
      ? `${best.assay.name} produces evidence that would overturn ${best.resolves}, the rule the current verdict rests on. `
        + `Expected belief-plausibility gap reduction ${best.reduction.toFixed(2)} at cost ${best.assay.cost}.`
      : `No candidate assay would overturn a rule this verdict rests on, so this is the best available on value alone: `
        + `${best.assay.name} narrows the belief-plausibility gap by an expected ${best.reduction.toFixed(2)} at cost ${best.assay.cost}.`,
  };
}
