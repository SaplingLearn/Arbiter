import { z } from "zod";
import type { EvidenceClaim, EvidenceFile, MetricsDocument, Ruleset } from "./types.js";

export const ProvenanceSchema = z.object({
  kind: z.enum(["database", "literature"]),
  source: z.string().min(1),
  retrieved: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  url: z.string().url().optional(),
});

export const EvidenceClaimSchema = z
  .object({
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
  })
  .refine(
    (c) => !(c.system === "in_silico" || c.stream === "qsar") || c.measuresKeyEvent === null,
    {
      message:
        "A computational prediction cannot MEASURE an AOP key event - it can only predict one. " +
        "Leaving measuresKeyEvent non-null on an in_silico or qsar claim lets it escape R2's " +
        "structural-correlation discount and be weighted like human clinical evidence.",
      path: ["measuresKeyEvent"],
    },
  );

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
    precedenceOrder: z.array(z.enum(["R1", "R2", "R3", "R5"])).length(4),
    precedenceRationale: z.string().min(1),
  })
  .refine((r) => r.rules.length === 6, { message: "A ruleset must declare all six rules R1-R6" })
  .refine((r) => new Set(r.rules.map((x) => x.id)).size === 6, { message: "Rule ids must be unique across all six" })
  .refine((r) => new Set(r.precedenceOrder).size === 4, {
    message: "precedenceOrder must contain each of R1, R2, R3, R5 exactly once",
  });

export const EvidenceFileSchema = z.object({
  generatedAt: z.string(),
  claims: z.array(EvidenceClaimSchema),
});

/* ------------------------------------------------------------------------- *
 * `results/metrics.json` — the harness-to-app contract.
 *
 * Every refine below encodes an identity that already holds by construction in
 * apps/harness/src/metrics.ts. That is the point: the file on disk is the only
 * thing the web app ever sees, and a document whose parts contradict each other
 * is a deck quoting two different numbers for the same thing. See the header on
 * MetricsDocument in types.ts for why these declarations live in the engine.
 * ------------------------------------------------------------------------- */

export const IntervalSchema = z
  .object({
    lo: z.number(),
    hi: z.number(),
  })
  .refine((i) => i.lo <= i.hi, {
    message:
      "A confidence interval must have lo <= hi. Reversed bounds render as '95% CI 0.90-0.51', " +
      "which reads as carelessness rather than as the defect it is.",
    path: ["hi"],
  });

export const ScoredPipelineSchema = z
  .object({
    balancedAccuracy: z.number().min(0).max(1),
    balancedAccuracyCi: IntervalSchema.nullable(),
    rawAccuracyCi: IntervalSchema,
    coverage: z.number().min(0).max(1),
    nCommitted: z.number().int().min(0),
    confusion: z.object({
      tp: z.number().int().min(0),
      fp: z.number().int().min(0),
      tn: z.number().int().min(0),
      fn: z.number().int().min(0),
    }),
    singleClass: z.boolean(),
  })
  .refine((p) => p.confusion.tp + p.confusion.fp + p.confusion.tn + p.confusion.fn === p.nCommitted, {
    message:
      "The confusion counts must sum to nCommitted. If they disagree, the accuracy printed beside " +
      "them was computed over a different set than the one the table shows.",
    path: ["confusion"],
  })
  .refine((p) => p.singleClass === (p.confusion.tp + p.confusion.fn === 0 || p.confusion.tn + p.confusion.fp === 0), {
    message:
      "singleClass must agree with the confusion counts: it is true exactly when one class is absent " +
      "from the committed set. This flag is the only thing on screen telling a reader that half of " +
      "the balanced accuracy beside it is a substituted 0.5 rather than a measurement.",
    path: ["singleClass"],
  })
  .refine((p) => (p.balancedAccuracyCi === null) === p.singleClass, {
    message:
      "balancedAccuracyCi must be null exactly when singleClass is true. A substituted 0.5 is not an " +
      "estimate, so it carries no sampling uncertainty, and borrowing an interval to fill the gap puts " +
      "a precision claim on a placeholder - the defect that had the Validation tab printing the " +
      "RAW-accuracy interval beside a balanced accuracy.",
    path: ["balancedAccuracyCi"],
  });

export const MetricsProvenanceSchema = z.object({
  rulesetVersion: z.string().min(1),
  rulesetHash: z.string().min(1),
  splitSeed: z.number(),
  perturbationSeed: z.number(),
  scoredSplit: z.string().min(1),
  note: z.string().min(1),
});

export const StreamCoverageSchema = z.object({
  claims: z.number().int().min(0),
  // A stream cannot speak to more compounds than it has claims, and cannot appear
  // in the record at all without one. Both bounds are what make a zero here a
  // loading failure rather than a stream that happens to be quiet.
  compounds: z.number().int().min(1),
});

export const MetricsSampleSizesSchema = z
  .object({
    scored: z.number().int().min(0),
    conflictSubset: z.number().int().min(0),
    streamCoverage: z.record(z.string().min(1), StreamCoverageSchema),
  })
  .refine(
    (s) => Object.values(s.streamCoverage).every((c) => c.compounds <= c.claims),
    {
      message:
        "A stream cannot cover more compounds than it has claims. More compounds than claims means " +
        "the two counters were fed different sets, so neither describes the evidence base.",
      path: ["streamCoverage"],
    },
  )
  .refine(
    (s) => Object.values(s.streamCoverage).every((c) => c.compounds <= s.scored),
    {
      message:
        "A stream cannot cover more compounds than were scored. This is the leakage guard in " +
        "numeric form: coverage counted outside the test split would exceed the split it is " +
        "reported against.",
      path: ["streamCoverage"],
    },
  );

export const ConflictSubsetAccuracySchema = z.object({
  n: z.number().int().min(0),
  positiveRate: z.number().min(0).max(1).nullable(),
  arbiter: ScoredPipelineSchema,
  // z.record, not an enum of keys: baseline names contain colons (`single:qsar`)
  // and the set grows with every stream added.
  baselines: z.record(ScoredPipelineSchema),
});

export const LlmConsistencyPendingSchema = z.object({
  note: z.string().min(1),
});

export const LlmConsistencyMeasuredSchema = z.object({
  config: z.unknown(),
  refusals: z.object({
    refusalRate: z.number().min(0).max(1),
    refused: z.number().int().min(0),
    requests: z.number().int().min(0),
  }),
  meanAgreementRate: z.number(),
  meanConfidenceStdDev: z.number(),
  nCompoundsFullyRefused: z.number().int().min(0),
});

/**
 * Two shapes, both valid, discriminated by whether the ablation has been run.
 *
 * A single object with optional halves would accept an agreement rate with no
 * refusal denominator beside it, and a consistency figure quoted without its
 * refusal rate is the one reading of this metric that actively misleads.
 */
export const LlmConsistencySchema = z.union([LlmConsistencyPendingSchema, LlmConsistencyMeasuredSchema]);

export const ArbiterRobustnessSchema = z.object({
  determinism: z.literal(1),
  determinismNote: z.string().min(1),
  meanHeldFraction: z.number().min(0).max(1),
  worstHeldFraction: z.number().min(0).max(1),
  meanHeldFractionOnCommitted: z.number().min(0).max(1),
  nCommittedCompounds: z.number().int().min(0),
  heldFractionCaveat: z.string().min(1),
  samplesPerCompound: z.number().int().min(0),
  seed: z.number(),
});

export const CalibrationSchema = z.object({
  strictCoverage: z.number().min(0).max(1),
  meanWidth: z.number().min(0).max(1),
  meanWidthOnCorrect: z.number().min(0).max(1),
  meanWidthOnIncorrect: z.number().min(0).max(1),
  widthDiscriminates: z.boolean(),
  widthDiscriminatesIsMeaningful: z.boolean(),
  nCorrect: z.number().int().min(0),
  nIncorrect: z.number().int().min(0),
});

export const AbstentionQualitySchema = z.object({
  declineRate: z.number().min(0).max(1),
  balancedAccuracyOnCommitted: z.number().min(0).max(1),
  ciOnCommitted: IntervalSchema,
  singleClassOnCommitted: z.boolean(),
  nDeclined: z.number().int().min(0),
  nCommitted: z.number().int().min(0),
  nStructurallyForced: z.number().int().min(0),
  structurallyForcedNote: z.string().min(1),
});

export const PlannerSensitivitySchema = z.object({
  nCompoundsWithRecommendation: z.number().int().min(0),
  meanUnchangedFraction: z.number().min(0).max(1),
  perturbation: z.string().min(1),
  samplesPerCompound: z.number().int().min(0),
  seed: z.number(),
});

export const MetricsDocumentSchema = z
  .object({
    provenance: MetricsProvenanceSchema,
    sampleSizes: MetricsSampleSizesSchema,
    metric1_conflictSubsetAccuracy: ConflictSubsetAccuracySchema,
    metric2a_llmConsistency: LlmConsistencySchema,
    metric2b_arbiterRobustness: ArbiterRobustnessSchema,
    metric3_calibration: CalibrationSchema,
    metric4_abstentionQuality: AbstentionQualitySchema,
    metric5_plannerSensitivity: PlannerSensitivitySchema,
  })
  .refine((m) => m.sampleSizes.conflictSubset === m.metric1_conflictSubsetAccuracy.n, {
    message:
      "The conflict-subset size in sampleSizes must equal the n the headline was computed over. " +
      "Two different subset sizes in one document means the deck can quote either.",
    path: ["sampleSizes", "conflictSubset"],
  })
  .refine(
    (m) => m.metric4_abstentionQuality.nDeclined + m.metric4_abstentionQuality.nCommitted === m.sampleSizes.scored,
    {
      message:
        "Declined plus committed must account for every scored compound. A shortfall means rows " +
        "vanished between the two figures, and the decline rate reported beside the accuracy is wrong.",
      path: ["metric4_abstentionQuality", "nDeclined"],
    },
  )
  .refine(
    (m) => m.metric4_abstentionQuality.nStructurallyForced <= m.metric4_abstentionQuality.nDeclined,
    {
      message:
        "Structurally forced abstentions are a subset of the declined set. More forced than declined " +
        "means the ceiling is not an upper bound on committed mass, so the field cannot be read as " +
        "\"could never have committed\" and neither can the remainder be read as \"could have\".",
      path: ["metric4_abstentionQuality", "nStructurallyForced"],
    },
  );

/* ------------------------------------------------------------------------- *
 * Drift guards: the hand-written interfaces in types.ts and the zod schemas
 * here declare the same field lists twice, and nothing forced them to agree.
 *
 * The obvious fix - derive the interfaces via `z.infer` - is WRONG HERE, and
 * that is why this was deferred rather than done. types.ts is the leaf module
 * every other engine module imports; making it depend on schema.ts would make it
 * depend on zod and invert the dependency direction the whole package rests on.
 *
 * So the assertion points the other way. These types are erased at build time
 * and cost nothing at runtime, but any field added, removed or retyped on
 * EITHER side fails the typecheck with a message naming the offending property.
 * Bidirectional on purpose: a one-way `extends` check passes happily when one
 * side gains an extra field.
 * ------------------------------------------------------------------------- */

/** Resolves to `true` only when A and B are mutually assignable. */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export type ClaimShapeMatchesInterface = MutuallyAssignable<z.infer<typeof EvidenceClaimSchema>, EvidenceClaim>;
export type RulesetShapeMatchesInterface = MutuallyAssignable<z.infer<typeof RulesetSchema>, Ruleset>;
export type EvidenceFileShapeMatchesInterface = MutuallyAssignable<z.infer<typeof EvidenceFileSchema>, EvidenceFile>;
export type MetricsShapeMatchesInterface = MutuallyAssignable<z.infer<typeof MetricsDocumentSchema>, MetricsDocument>;

/**
 * Forces the four checks above to be evaluated. Without a value site TypeScript
 * would leave them as unused aliases and never report the `never`.
 */
export const SCHEMAS_MATCH_TYPES: [
  ClaimShapeMatchesInterface,
  RulesetShapeMatchesInterface,
  EvidenceFileShapeMatchesInterface,
  MetricsShapeMatchesInterface,
] = [true, true, true, true];
