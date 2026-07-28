import { z } from "zod";
import type { EvidenceClaim, EvidenceFile, Ruleset } from "./types.js";

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

/**
 * Forces the three checks above to be evaluated. Without a value site TypeScript
 * would leave them as unused aliases and never report the `never`.
 */
export const SCHEMAS_MATCH_TYPES: [
  ClaimShapeMatchesInterface,
  RulesetShapeMatchesInterface,
  EvidenceFileShapeMatchesInterface,
] = [true, true, true];
