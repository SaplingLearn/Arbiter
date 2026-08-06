import { EvidenceClaimSchema, type EvidenceClaim } from "@arbiter/engine";

/**
 * The cited clinical exposure a user must supply before claiming exposure
 * relevance on a SAFE finding. Same three fields the hero-case fixtures carry.
 */
export interface ExposureCitation {
  cmax: number;
  basis: string;
  citation: string;
}

export interface IntakeResult {
  claims: EvidenceClaim[];
  errors: string[];
}

/**
 * A user-supplied claim must clear exactly what a bundled one clears.
 *
 * Nothing here is a second, softer schema for data that happens to arrive from a
 * form. `EvidenceClaimSchema` is the contract, and intake reuses it rather than
 * restating it - a parallel validator is a second place for the rules to drift
 * out of, and the one that would drift is the one nobody runs the benchmark
 * through.
 *
 * Two guards ride along, both mirroring behaviour that already exists:
 *
 *  - the schema's own refine, which rejects a qsar or in_silico claim carrying a
 *    non-null `measuresKeyEvent`. That is the highest-consequence extraction
 *    error there is - it would let a structural correlation escape R2's discount
 *    and be weighted like human clinical evidence - and it is already
 *    unrepresentable, so intake inherits it for free;
 *  - the exposure gate below.
 */
export function validateIntake(raw: unknown[], exposure: ExposureCitation | null): IntakeResult {
  const claims: EvidenceClaim[] = [];
  const errors: string[] = [];

  raw.forEach((r, i) => {
    const parsed = EvidenceClaimSchema.safeParse(r);
    if (!parsed.success) {
      // EVERY issue, not just the first. Reporting one at a time makes a user fix
      // a field, resubmit, and be told about the next one - and it hid the defect
      // under test here more than once, because whichever issue zod happened to
      // order first was the only one anybody saw.
      for (const issue of parsed.error.issues) {
        errors.push(`claim ${i + 1}: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      }
      return;
    }
    const claim = parsed.data as EvidenceClaim;
    const gate = exposureGateError(claim, exposure);
    if (gate !== null) {
      errors.push(`claim ${i + 1} (${claim.id}): ${gate}`);
      return;
    }
    claims.push(claim);
  });

  return { claims, errors };
}

/**
 * HANDOVER §3.1's prohibition, applied to user input.
 *
 * SAFE claims only, and the asymmetry is the rule rather than an oversight. R3
 * says a positive finding at clinically relevant exposure defeats a negative one
 * whose margin is unstated, so a toxic finding needs no margin to be defensible.
 * Gating both directions would reject legitimate toxic evidence and would state
 * R3 incorrectly in code.
 *
 * It is also the direction that can be abused: reaching `advance` requires
 * exposure-relevant SAFE evidence, and typing `true` is the cheapest way to
 * manufacture one.
 */
export function exposureGateError(claim: EvidenceClaim, exposure: ExposureCitation | null): string | null {
  if (claim.assertion !== "safe" || claim.exposureRelevant !== true) return null;
  if (exposure !== null) return null;
  return (
    "asserts exposureRelevant on a safe finding, but no cited clinical Cmax was supplied. " +
    "See HANDOVER §3.1 - this flag may not be set without one."
  );
}

/**
 * Custom compound ids that collide with the benchmark.
 *
 * `results/` is the pre-registered benchmark, and a custom compound reaching it
 * would contaminate every reported number invisibly. Deliberately the same shape
 * as `findLeakedFixtures` in the harness, which exists because a fixture id
 * reaching the benchmark is this same failure from a different source.
 *
 * Membership, not a prefix match: the harness had exactly that bug once, where a
 * single hardcoded prefix let every other id leak silently.
 */
export function findBenchmarkCollisions(customIds: string[], benchmarkIds: string[]): string[] {
  const benchmark = new Set(benchmarkIds);
  return [...new Set(customIds)].filter((id) => benchmark.has(id)).sort();
}
