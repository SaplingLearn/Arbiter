import {
  EvidenceClaimSchema, MetricsDocumentSchema, RulesetSchema,
  type AssayOperator, type EvidenceClaim, type MetricsDocument, type Ruleset, type Verdict,
} from "@arbiter/engine";
import { RAW } from "./bundle.js";
import { CYCLOSPORINE, type HeroCase } from "./heroCases.js";

export interface CompoundRow {
  compoundId: string; name: string; smiles: string; dilirankLabel: string; y: number;
}

export interface LoadedData {
  claimsByCompound: Map<string, EvidenceClaim[]>;
  compounds: Map<string, CompoundRow>;
  testSplit: string[];
  ruleset: Ruleset;
  assays: AssayOperator[];
  metrics: MetricsDocument;
  /** Every demonstrated compound, keyed by compound id. Replaces the singular
   *  `fixture`. TAK-994 is one entry, not a privileged field. */
  heroCases: Map<string, HeroCase>;
  manifest: Map<string, { verdict: Verdict; belief: number }>;
}

export class DataLoadError extends Error {}

/**
 * A literature fixture may not claim exposure relevance for a SAFE finding without
 * a cited clinical Cmax.
 *
 * This is HANDOVER §3.1's prohibition, made unrepresentable. Reaching an `advance`
 * verdict requires `exposureRelevant: true` on safe evidence, and the cheapest way
 * to get one is to type `true` — which is precisely the shortcut §3.1 considered and
 * rejected, and precisely the shortcut that is most tempting at 11pm before a
 * submission. A rule that lives in a document is a rule someone has to remember; a
 * rule that fails the build is not.
 *
 * SAFE claims only, deliberately. R3 says a positive finding at clinically relevant
 * exposure defeats a negative one whose margin is unstated — the asymmetry is the
 * rule's whole content. A toxic finding needs no margin to be defensible, and
 * TAK-994's murine claim is exactly that case.
 *
 * Corpus-backed cases are exempt because they author nothing: their claims come from
 * the ingestion pipeline, which sets exposureRelevant from Tox21 metadata.
 */
export function assertExposureBacked(hero: HeroCase): void {
  if (hero.source !== "fixture" || hero.claims === null || hero.exposure !== null) return;
  for (const c of hero.claims) {
    if (c.assertion === "safe" && c.exposureRelevant === true) {
      throw new DataLoadError(
        `${hero.compoundId}: claim ${c.id} asserts exposureRelevant on a safe finding, ` +
        `but the fixture carries no cited clinical Cmax. See HANDOVER §3.1 — this flag ` +
        `may not be set without one.`,
      );
    }
  }
}

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

  const heroCases = new Map<string, HeroCase>();
  heroCases.set(RAW.fixture.compoundId, {
    compoundId: RAW.fixture.compoundId,
    displayName: RAW.fixture.name,
    source: "fixture",
    subtitle: "Literature fixture · outside the DILIrank benchmark",
    claims: fixtureClaims,
    asOfMilestones: RAW.fixture.asOfMilestones,
    citationStatus: RAW.fixture.citationStatus,
    splitDisclosure: null,
    exposure: null,
  });

  // Corpus-backed: no claims, so nothing is added to the evidence base and no
  // reported number can move. `subtitle` comes from the compound row rather than
  // being written here, so it cannot drift from DILIrank.
  const cyclosporine = compounds.get(CYCLOSPORINE);
  if (cyclosporine === undefined) {
    throw new DataLoadError(`hero case ${CYCLOSPORINE} is absent from data/out/compounds.json`);
  }
  heroCases.set(CYCLOSPORINE, {
    compoundId: CYCLOSPORINE,
    displayName: cyclosporine.name,
    source: "corpus",
    subtitle: `${cyclosporine.dilirankLabel} · scored in the benchmark test split`,
    claims: null,
    asOfMilestones: {},
    citationStatus: null,
    splitDisclosure: null,
    exposure: null,
  });

  for (const hero of heroCases.values()) assertExposureBacked(hero);

  return {
    claimsByCompound,
    compounds,
    testSplit: RAW.splits.test as string[],
    ruleset,
    assays: RAW.assays.assays as AssayOperator[],
    metrics: parsedMetrics.data,
    heroCases,
    manifest,
  };
}
