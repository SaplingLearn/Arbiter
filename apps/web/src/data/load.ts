import {
  EvidenceClaimSchema, MetricsDocumentSchema, RulesetSchema,
  type AssayOperator, type EvidenceClaim, type MetricsDocument, type Ruleset, type Verdict,
} from "@arbiter/engine";
import { RAW } from "./bundle.js";

export interface CompoundRow {
  compoundId: string; name: string; smiles: string; dilirankLabel: string; y: number;
}

export interface FixtureDoc {
  compoundId: string;
  claims: EvidenceClaim[];
  asOfMilestones: Record<string, string>;
  citationStatus: string;
}

export interface LoadedData {
  claimsByCompound: Map<string, EvidenceClaim[]>;
  compounds: Map<string, CompoundRow>;
  testSplit: string[];
  ruleset: Ruleset;
  assays: AssayOperator[];
  metrics: MetricsDocument;
  fixture: FixtureDoc;
  manifest: Map<string, { verdict: Verdict; belief: number }>;
}

export class DataLoadError extends Error {}

/**
 * Validate and index every bundled artifact.
 *
 * A malformed file must fail HERE, naming itself, rather than producing an empty
 * library that looks like a working app with no compounds in it.
 */
export function loadData(): LoadedData {
  let ruleset: Ruleset;
  try {
    ruleset = RulesetSchema.parse(RAW.ruleset) as Ruleset;
  } catch (e) {
    throw new DataLoadError(`rules/ruleset-v1.0.json: ${(e as Error).message}`);
  }

  const claimsByCompound = new Map<string, EvidenceClaim[]>();
  const addClaim = (raw: unknown, source: string) => {
    const parsed = EvidenceClaimSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DataLoadError(`${source}: invalid claim at ${issue?.path.join(".")}: ${issue?.message}`);
    }
    const c = parsed.data as EvidenceClaim;
    claimsByCompound.set(c.compoundId, [...(claimsByCompound.get(c.compoundId) ?? []), c]);
  };
  for (const raw of RAW.evidence.claims) addClaim(raw, "data/out/evidence.json");

  const compounds = new Map<string, CompoundRow>();
  for (const c of RAW.compounds.compounds as CompoundRow[]) compounds.set(c.compoundId, c);

  const manifest = new Map<string, { verdict: Verdict; belief: number }>();
  for (const r of RAW.manifest.rows as { compoundId: string; verdict: Verdict; belief: number }[]) {
    manifest.set(r.compoundId, { verdict: r.verdict, belief: r.belief });
  }

  // The Validation tab is the one surface a judge reads numbers off, and it read
  // this document through `Record<string, any>` - so a metric renamed by the
  // harness reached the screen as `undefined` with the typecheck still green.
  // Parsed here, a drifted field names itself before anything renders.
  const parsedMetrics = MetricsDocumentSchema.safeParse(RAW.metrics);
  if (!parsedMetrics.success) {
    const issue = parsedMetrics.error.issues[0];
    throw new DataLoadError(`results/metrics.json: invalid metric at ${issue?.path.join(".")}: ${issue?.message}`);
  }

  const fixtureClaims: EvidenceClaim[] = [];
  for (const raw of RAW.fixture.claims as unknown[]) {
    const parsed = EvidenceClaimSchema.safeParse(raw);
    if (!parsed.success) {
      throw new DataLoadError(`data/out/tak994.json: ${parsed.error.issues[0]?.message}`);
    }
    fixtureClaims.push(parsed.data as EvidenceClaim);
  }

  return {
    claimsByCompound,
    compounds,
    testSplit: RAW.splits.test as string[],
    ruleset,
    assays: RAW.assays.assays as AssayOperator[],
    metrics: parsedMetrics.data,
    fixture: {
      compoundId: RAW.fixture.compoundId,
      claims: fixtureClaims,
      asOfMilestones: RAW.fixture.asOfMilestones,
      citationStatus: RAW.fixture.citationStatus,
    },
    manifest,
  };
}
