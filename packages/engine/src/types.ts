/** What a source asserts about a compound. `ambiguous` is a real answer, not missing data. */
export type Assertion = "toxic" | "safe" | "ambiguous";

/** What biology produced the signal. Consumed by R1. */
export type BiologicalSystem = "human" | "rodent" | "nonrodent" | "in_silico";

export type Stream =
  | "qsar"
  | "cytotox"
  | "toxicogenomics"
  | "transporter"
  | "invivo_rodent"
  | "invivo_nonrodent";

export type Verdict = "advance" | "do_not_advance" | "abstain";

export interface Provenance {
  kind: "database" | "literature";
  /** e.g. "DILIrank", "Tox21/AID-1234", "PMID:39876543" */
  source: string;
  /** ISO date the prep run fetched it. Set by Python, never by the engine. */
  retrieved: string;
  /**
   * `| undefined` is explicit, not redundant. The repo runs
   * `exactOptionalPropertyTypes`, under which `url?: string` means "may be absent
   * but never explicitly undefined" - and zod's `.optional()` infers
   * `string | undefined`, which permits both. Writing the narrower form made the
   * schema's inferred type NOT assignable to this interface, so the drift guard in
   * schema.ts could never pass. This form says what parsing actually produces.
   */
  url?: string | undefined;
}

/**
 * One typed evidence claim. Every field exists because exactly one rule
 * consumes it — see spec §5. Adding a field here means adding a rule.
 */
export interface EvidenceClaim {
  id: string;
  compoundId: string;
  /** → R6. Stream identity lets R6 judge whether agreeing sources are genuinely independent — agreement across distinct streams counts for more than one source agreeing with itself. */
  stream: Stream;
  assertion: Assertion;
  /** Source-reported confidence, 0..1. */
  strength: number;
  /** → R1 */
  system: BiologicalSystem;
  /** → R2. `null` means structural correlation only, not a measured key event. */
  measuresKeyEvent: string | null;
  /** → R3. `null` means the exposure margin was never tested at clinical range. */
  exposureRelevant: boolean | null;
  /** → R4. `null` means not assessable. */
  inApplicabilityDomain: boolean | null;
  /** → R5. Klimisch reliability score. */
  klimisch: 1 | 2 | 3 | 4 | null;
  /** Enables as-of replay. The ENGINE NEVER READS THIS — callers filter first. */
  availableFrom: string;
  provenance: Provenance;
}

/**
 * The on-disk evidence file the Python prep layer writes and the harness reads.
 * Mirrors `EvidenceFileSchema`; schema.ts asserts at compile time that the two
 * cannot drift apart.
 */
export interface EvidenceFile {
  /** ISO timestamp. Set by the Python prep run, never by the engine. */
  generatedAt: string;
  claims: EvidenceClaim[];
}

export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";

/**
 * The four pairwise defeat rules. R4 downweights rather than defeating a
 * claim, and R6 is a property of a set of claims, not a pairwise comparison
 * — neither participates in a precedence ordering between attacker/target.
 */
export type DefeatRuleId = "R1" | "R2" | "R3" | "R5";

export interface Rule {
  id: RuleId;
  name: string;
  statement: string;
  /**
   * The published framework the rule rests on. No rule may cite TAK-994.
   * `note?: string | undefined` for the same exactOptionalPropertyTypes reason as
   * `Provenance.url` - see the note there.
   */
  framework: { name: string; date: string; note?: string | undefined };
  enabled: boolean;
  /** How strongly this rule defeats, 0..1. Editable by a toxicologist. */
  strength: number;
}

export interface Ruleset {
  version: string;
  /** ISO date, set at pre-registration. */
  registeredAt: string;
  /** Abstain when plausibility - belief exceeds this. Pre-registered. */
  abstentionGapThreshold: number;
  dilirankBinarisation: { positive: string[]; negative: string[]; excluded: string[] };
  rules: Rule[];
  /**
   * Precedence order over the four defeat rules: earlier entries outrank
   * later ones when two rules would each license an attack in opposite
   * directions on the same pair of claims. Editable by a toxicologist
   * alongside `rules`.
   */
  precedenceOrder: DefeatRuleId[];
  /** Why this precedence order was chosen. Must not reference the demonstration case — see `rules[].framework`. */
  precedenceRationale: string;
}

export type ClaimStatus = "admitted" | "defeated" | "downweighted" | "undecided";

export interface TraceStep {
  claimId: string;
  status: ClaimStatus;
  /** The rule that produced this status, when one did. */
  byRule?: RuleId;
  /** The claim that defeated this one, when applicable. */
  defeatedBy?: string;
  /**
   * Set only on the synthetic step carrying the verdict's own explanation. Filter
   * on this rather than on `claimId === "__verdict__"`, which a real claim could
   * collide with, or on `status`, which reads as a real undecided claim.
   */
  kind?: "verdict";
  /** Human-readable, rendered directly in the UI. */
  rationale: string;
}

export interface Counterfactual {
  /**
   * Every claim that must change, and what it must become, for the verdict to
   * flip — sorted by claimId so the value is stable under input reordering.
   *
   * A per-claim target rather than one shared `flipTo`, because the search is
   * exhaustive over ASSIGNMENTS and a minimal answer can be heterogeneous: "this
   * toxic reading would have to become safe *and* that one would have to become
   * ambiguous". A single `flipTo` field cannot express that, and having one is
   * what let an earlier draft search 3 combinations per pair instead of 9 while
   * still calling itself exhaustive.
   *
   * Every entry is a genuine change: a flip whose target equals the claim's
   * current assertion is never reported, so `flips.length` is the true size of
   * the minimal set.
   */
  flips: { claimId: string; to: Assertion }[];
  newVerdict: Verdict;
}

export interface NextExperiment {
  assay: string;
  /** The rule this assay would settle. This is what makes the planner novel. */
  resolvesRule: RuleId | null;
  expectedGapReduction: number;
  cost: number;
  score: number;
  rationale: string;
}

export interface Reasoning {
  verdict: Verdict;
  /**
   * True when opposed assertions both survive, i.e. neither was defeated.
   * `undecided` counts as surviving — a mutual-defeat cycle is the most contested
   * state there is. Not the pre-registered Task 15 conflict subset, which is a
   * property of the raw claims; this is the per-result display field.
   */
  contested: boolean;
  belief: number;
  plausibility: number;
  /**
   * The fused Dempster-Shafer mass the verdict was read off. Reported so a
   * reviewer can reconcile the verdict against the numbers: `belief` alone is the
   * mass on TOXIC, which cannot explain an "advance". Structurally identical to
   * `Mass` in fuse.ts.
   *
   * Written as an inline structural type ON PURPOSE. Do NOT `import` `Mass` from
   * fuse.ts here - types.ts is the leaf every other module depends on, and making
   * it depend on an implementation module inverts that.
   */
  mass: { toxic: number; safe: number; uncommitted: number };
  /** Dempster conflict mass. Surfaced, never normalised away. */
  conflictMass: number;
  trace: TraceStep[];
  counterfactual: Counterfactual | null;
  nextExperiment: NextExperiment | null;
  rulesetHash: string;
}

/* ------------------------------------------------------------------------- *
 * The validation metrics document — `results/metrics.json`.
 *
 * Written by `apps/harness/src/run-metrics.ts`, read by the Validation tab, by
 * the golden-file guard, and by anything Phase 3 adds. Both ends previously read
 * it through `Record<string, any>`, so `npm run typecheck` stayed green while
 * `Validation.tsx` referenced a field that had been renamed out of existence. The
 * failure surfaces as a blank Validation panel in front of a judge, which is the
 * cost of an untyped contract paid at the worst possible moment.
 *
 * These declarations live in the engine rather than the harness because the web
 * app cannot import from the harness — the harness reads `node:fs` — and
 * `@arbiter/engine` is the web app's only package dependency. They are inert type
 * declarations, so nothing here touches engine purity: no clock, no randomness,
 * no I/O. `EvidenceFile` above is the same kind of citizen, a data-file shape
 * rather than a reasoning concern.
 * ------------------------------------------------------------------------- */

/** The bounds of a confidence interval. `lo <= hi` always; the schema enforces it. */
export interface Interval {
  lo: number;
  hi: number;
}

/** Counts over a committed set. `tp + fp + tn + fn` is the size of that set. */
export interface Confusion {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

/** One scored pipeline — ARBITER itself, or one of the baselines it is compared against. */
export interface ScoredPipeline {
  balancedAccuracy: number;
  /**
   * Interval for BALANCED accuracy, or null when one class is absent.
   *
   * Null is not missing data, and it must never be made non-nullable: balanced
   * accuracy substitutes 0.5 for the absent half, and a substitution has no
   * sampling uncertainty, so no honest interval exists. Null in six of the nine
   * pipelines reported today, including ARBITER's own headline.
   *
   * Named for the statistic it describes because the previous field was called
   * plainly `ci` and carried the RAW-accuracy interval, which the Validation tab
   * then printed as "balanced accuracy 0.75 (95% CI 0.51-1.00)".
   */
  balancedAccuracyCi: Interval | null;
  /** Interval for RAW accuracy (correct/committed). A different statistic — see above. */
  rawAccuracyCi: Interval;
  /** Fraction of the subset this pipeline committed to. Travels WITH accuracy, always. */
  coverage: number;
  nCommitted: number;
  confusion: Confusion;
  /**
   * True when the committed set contains only one class, so balancedAccuracy
   * substituted 0.5 for the missing half. The figure is then not interpretable as
   * accuracy and must not be quoted as one.
   */
  singleClass: boolean;
}

/** What the run was scored under. Every number in the document is conditional on this. */
export interface MetricsProvenance {
  rulesetVersion: string;
  /** Must equal the pre-registered hash, or the numbers describe a ruleset nobody registered. */
  rulesetHash: string;
  splitSeed: number;
  perturbationSeed: number;
  /**
   * "test" today. Left a plain string rather than an enum on purpose: reporting on
   * another split would be a change of VALUE, and freezing it into the type would
   * turn a disclosure into a schema error.
   */
  scoredSplit: string;
  note: string;
}

export interface MetricsSampleSizes {
  scored: number;
  conflictSubset: number;
}

/** METRIC 1 (headline): balanced accuracy on the conflict subset only. */
export interface ConflictSubsetAccuracy {
  n: number;
  /** Prevalence of the positive label on the subset; null when the subset is empty. */
  positiveRate: number | null;
  arbiter: ScoredPipeline;
  /**
   * Keyed by baseline name. The names contain colons (`single:qsar`,
   * `single:transporter`), and the set grows whenever a stream is added, so this
   * is an open record rather than a fixed set of keys.
   */
  baselines: Record<string, ScoredPipeline>;
}

/** METRIC 2a before the ablation has been run: the numbers are absent and `note` says why. */
export interface LlmConsistencyPending {
  note: string;
}

/** METRIC 2a once `results/ablation.json` exists. Carries no `note`. */
export interface LlmConsistencyMeasured {
  /**
   * The ablation's own configuration, echoed verbatim. Its shape is owned by the
   * ablation, not by this document, so it is deliberately opaque here. Optional
   * because an ablation file without a `config` key serialises without one.
   */
  config?: unknown;
  refusals: { refusalRate: number; refused: number; requests: number };
  meanAgreementRate: number;
  meanConfidenceStdDev: number;
  nCompoundsFullyRefused: number;
}

/**
 * A genuine union of two shapes, not one shape with optional halves.
 *
 * Declaring the measured fields optional would let a half-written document — an
 * agreement rate with no refusal denominator beside it — validate, and a
 * consistency figure quoted without its refusal rate is the one reading of this
 * metric that is actively misleading. A reader discriminates on `note`.
 */
export type LlmConsistency = LlmConsistencyPending | LlmConsistencyMeasured;

/** METRIC 2b: stability of the verdict under perturbation of evidence and rule strengths. */
export interface ArbiterRobustness {
  /**
   * Trivially 1 — a pure function is a pure function. Pinned to the literal
   * because anything else would mean the engine stopped being deterministic,
   * which is a different and much larger problem than a metric moving.
   */
  determinism: 1;
  determinismNote: string;
  meanHeldFraction: number;
  worstHeldFraction: number;
  /**
   * The figure that carries information. A compound that abstains far from any
   * threshold holds at 1.0 under any perturbation, so the corpus-wide mean is
   * dominated by cases that were never close to deciding.
   */
  meanHeldFractionOnCommitted: number;
  nCommittedCompounds: number;
  heldFractionCaveat: string;
  samplesPerCompound: number;
  seed: number;
}

/** METRIC 3: does the reported uncertainty widen where the verdict was wrong? */
export interface Calibration {
  strictCoverage: number;
  meanWidth: number;
  meanWidthOnCorrect: number;
  meanWidthOnIncorrect: number;
  widthDiscriminates: boolean;
  /** False when either group is too small for the comparison above to mean anything. */
  widthDiscriminatesIsMeaningful: boolean;
  nCorrect: number;
  nIncorrect: number;
}

/** METRIC 4: accuracy on what was committed to, reported inseparably from the decline rate. */
export interface AbstentionQuality {
  declineRate: number;
  balancedAccuracyOnCommitted: number;
  /** Interval for RAW accuracy on the committed set. Never null: `wilson` returns [0,1] at n=0. */
  ciOnCommitted: Interval;
  singleClassOnCommitted: boolean;
  nDeclined: number;
  nCommitted: number;
  /**
   * Of `nDeclined`, how many could not have committed at ANY evidence values.
   *
   * Sum the surviving weight of every live committed claim and grant each one
   * full confidence 1.0; where that ceiling still cannot reach the mass the
   * registered gap threshold demands, the abstention was settled before a single
   * value was read. The remainder — `nDeclined - nStructurallyForced` — abstained
   * on what the evidence actually said.
   *
   * The distinction is the actionable one: the first group says the assay class
   * is the wrong instrument and more of it is wasted money; the second says more
   * of the same might genuinely resolve it.
   */
  nStructurallyForced: number;
  /** Why the number above is a floor rather than a point estimate. */
  structurallyForcedNote: string;
}

/** METRIC 5: how often the planner's top recommendation survives perturbed priors. */
export interface PlannerSensitivity {
  nCompoundsWithRecommendation: number;
  meanUnchangedFraction: number;
  perturbation: string;
  samplesPerCompound: number;
  seed: number;
}

/**
 * The whole of `results/metrics.json`.
 *
 * Mirrors `MetricsDocumentSchema`; schema.ts asserts at compile time that the two
 * cannot drift apart. The harness annotates the object it writes with this type,
 * so a renamed field fails at the WRITER rather than silently at a reader.
 */
export interface MetricsDocument {
  provenance: MetricsProvenance;
  sampleSizes: MetricsSampleSizes;
  metric1_conflictSubsetAccuracy: ConflictSubsetAccuracy;
  metric2a_llmConsistency: LlmConsistency;
  metric2b_arbiterRobustness: ArbiterRobustness;
  metric3_calibration: Calibration;
  metric4_abstentionQuality: AbstentionQuality;
  metric5_plannerSensitivity: PlannerSensitivity;
}
