import type { EvidenceClaim } from "@arbiter/engine";

/**
 * Where a hero case's evidence comes from, and it is load-bearing rather than
 * descriptive.
 *
 * A `fixture` case carries its own hand-authored literature claims and therefore
 * its own citation risk — TAK-994's are marked UNVERIFIED and rendered as such.
 * A `corpus` case carries NOTHING: `claims` is null and the case resolves through
 * `data.claimsByCompound` like any library row.
 *
 * That asymmetry is deliberate. `store.tsx`'s precedence comment warns that the
 * fixture and corpus copies of one compound may some day stop agreeing, and that
 * the Case tab must not switch source silently when they do. Giving a corpus-backed
 * case no claims of its own means it has nothing to disagree WITH: the Case tab and
 * the Compounds table read one array. It is also why a corpus-backed case adds no
 * evidence to the repo and so cannot move a benchmark number.
 */
export type CaseSource = "fixture" | "corpus";

/** A cited clinical exposure. See load.ts's gate and spec §5 — this type exists so
 *  that `exposureRelevant: true` cannot be asserted without one. */
export interface FixtureExposure {
  cmax: number;
  basis: "free" | "total";
  citation: string;
}

export interface HeroCase {
  compoundId: string;
  /** Rendered in the masthead. Replaces the literal "TAK-994" that CaseHeader
   *  previously substituted whenever the selected compound was the fixture. */
  displayName: string;
  source: CaseSource;
  subtitle: string;
  /** Fixture-backed only. `null` means "resolve through the corpus". */
  claims: EvidenceClaim[] | null;
  /** May be empty. Corpus streams carry availableFrom 2000-01-01 / 2010-01-01, so
   *  the as-of replay is inert on them and they get no milestone buttons. */
  asOfMilestones: Record<string, string>;
  /** Fixture-backed only; null suppresses the citation caveat entirely. */
  citationStatus: string | null;
  /** Set when the compound is not in the test split, so an in-sample QSAR read is
   *  disclosed rather than implied. Null for a test-split compound. */
  splitDisclosure: string | null;
  exposure: FixtureExposure | null;
}

/**
 * The compound the app opens on. Named rather than taken as the first key of
 * `heroCases`, because Map iteration order is insertion order and that would make
 * the boot case an accident of the order two `set` calls happen to appear in.
 */
export const BOOT_CASE = "TAK-994";
