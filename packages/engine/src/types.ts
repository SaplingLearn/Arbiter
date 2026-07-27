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
  url?: string;
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
  /** The published framework the rule rests on. No rule may cite TAK-994. */
  framework: { name: string; date: string; note?: string };
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
  /** Claims whose assertions must flip together to change the verdict. */
  claimIds: string[];
  flipTo: Assertion;
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
