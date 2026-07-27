import { z } from "zod";

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
