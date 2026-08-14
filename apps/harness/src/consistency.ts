/**
 * The flip-rate probe. Spec §7.1 and §7.2a.
 *
 * WHY THIS IS THE FIRST THING MEASURED. The product's primary claim is that
 * identical evidence yields an identical recommendation - the property human
 * committees demonstrably lack. An AI decider is structurally weakest exactly
 * there. So this is measured before anything is built on top of it, and it is the
 * one result that cannot be argued away by rewriting the prompt: if one prompt
 * gives one case two answers, no wording fixes that. It is a property of the
 * approach.
 *
 * It needs NO answer key, which is why it can run before the target is settled and
 * on any case at all.
 *
 * THE SHAPE IS STRUCTURAL, NOT IMPORTED. services/api is not in this package's
 * build graph, and adding a project reference to pull in one interface would couple
 * the benchmark harness to the HTTP surface. The subset below is what the
 * measurement actually reads; a call site passing a real `Adjudication` typechecks,
 * and a drift in the fields named here fails at that call site rather than silently
 * measuring the wrong thing.
 */

export interface AdjudicationSubset {
  mechanism: { present: boolean };
  consequence: { verdict: string; citedFindingIds: string[] };
  ruleDisclosure: { ruleId: string; position: string }[];
}

export interface RuleStability {
  ruleId: string;
  /** Fraction of runs taking the most common position on this rule. */
  agreement: number;
  positions: Record<string, number>;
}

export interface ConsistencyReport {
  runs: number;
  /** Fraction of runs returning the most common verdict. 1.0 is perfect. */
  verdictAgreement: number;
  /** 1 - verdictAgreement. The headline number. */
  flipRate: number;
  modalVerdict: string | null;
  verdicts: Record<string, number>;
  mechanismAgreement: number;
  /**
   * Per-rule position stability, worst first.
   *
   * Reported because a stable verdict over unstable reasoning is NOT a pass. Spec
   * §7.2a scores a correct verdict on incorrect reasoning as a failure, and the
   * same logic applies here: if the verdict holds while the rules underneath it
   * shuffle, the agreement is a coincidence of a small answer space - three
   * verdicts means chance alone agrees a third of the time - and the reasoning a
   * reviewer would sign is not reproducible at all.
   */
  ruleStability: RuleStability[];
  /** Fraction of runs citing exactly the modal citation set on the verdict. */
  citationAgreement: number;
}

function tally(xs: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const x of xs) counts[x] = (counts[x] ?? 0) + 1;
  return counts;
}

/** Most common value and its count. Ties break on the lexically first key, so the report is stable. */
function modal(counts: Record<string, number>): { value: string | null; count: number } {
  const entries = Object.entries(counts).sort(([a, ca], [b, cb]) => (cb - ca) || (a < b ? -1 : 1));
  const first = entries[0];
  return first === undefined ? { value: null, count: 0 } : { value: first[0], count: first[1] };
}

export function consistencyReport(runs: AdjudicationSubset[]): ConsistencyReport {
  const n = runs.length;
  if (n === 0) {
    return {
      runs: 0, verdictAgreement: 0, flipRate: 1, modalVerdict: null, verdicts: {},
      mechanismAgreement: 0, ruleStability: [], citationAgreement: 0,
    };
  }

  const verdicts = tally(runs.map((r) => r.consequence.verdict));
  const mv = modal(verdicts);

  const mech = tally(runs.map((r) => String(r.mechanism.present)));
  const mm = modal(mech);

  // Citation sets compared as SORTED joins, so ["a","b"] and ["b","a"] are the same
  // answer. Order is a serialisation detail and counting it as a flip would inflate
  // the instability figure with noise the reader does not care about.
  const citations = tally(runs.map((r) => [...r.consequence.citedFindingIds].sort().join("|")));
  const cm = modal(citations);

  const ruleIds = [...new Set(runs.flatMap((r) => r.ruleDisclosure.map((d) => d.ruleId)))].sort();
  const ruleStability: RuleStability[] = ruleIds.map((ruleId) => {
    // A run that omitted the rule entirely counts as its own position rather than
    // being skipped: silently dropping it would report a rule as perfectly stable
    // precisely when the model kept forgetting it.
    const positions = tally(runs.map((r) => r.ruleDisclosure.find((d) => d.ruleId === ruleId)?.position ?? "(absent)"));
    const pm = modal(positions);
    return { ruleId, agreement: pm.count / n, positions };
  }).sort((a, b) => a.agreement - b.agreement || (a.ruleId < b.ruleId ? -1 : 1));

  return {
    runs: n,
    verdictAgreement: mv.count / n,
    flipRate: 1 - mv.count / n,
    modalVerdict: mv.value,
    verdicts,
    mechanismAgreement: mm.count / n,
    ruleStability,
    citationAgreement: cm.count / n,
  };
}

export function formatConsistencyReport(r: ConsistencyReport, passMark: number): string[] {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `runs                 ${r.runs}`,
    `modal verdict        ${r.modalVerdict ?? "(none)"}`,
    `verdict agreement    ${pct(r.verdictAgreement)}`,
    `FLIP RATE            ${pct(r.flipRate)}   (pass mark: at most ${pct(passMark)})`,
    `mechanism agreement  ${pct(r.mechanismAgreement)}`,
    `citation agreement   ${pct(r.citationAgreement)}`,
    "",
    "verdicts seen:",
    ...Object.entries(r.verdicts).sort(([, a], [, b]) => b - a).map(([v, c]) => `  ${c.toString().padStart(3)}  ${v}`),
    "",
    "per-rule position stability (worst first):",
    ...r.ruleStability.map((s) => {
      const spread = Object.entries(s.positions).map(([p, c]) => `${p}:${c}`).join(" ");
      return `  ${s.ruleId}  ${pct(s.agreement).padStart(6)}   ${spread}`;
    }),
    "",
    r.flipRate <= passMark
      ? `PASS - flip rate ${pct(r.flipRate)} is within the pre-committed ${pct(passMark)}.`
      : `FAIL - flip rate ${pct(r.flipRate)} exceeds the pre-committed ${pct(passMark)}. `
        + "Spec section 7.2a: this is a DESIGN defect, not a prompt defect. Do not respond by rewriting the prompt.",
  ];
  return lines;
}

/** The registered fields this needs; the prompt files carry much more. */
export interface PromptRegistration {
  version: string;
  supersedes?: string;
}

/**
 * The prompt currently in force: the one no other registration supersedes.
 *
 * WHY DERIVED RATHER THAN NAMED. A reported flip rate belongs to the prompt it was
 * measured under - the prompt is a model parameter, and §7.2a keeps revisions
 * separable from tuning precisely so a number cannot drift onto a version that did
 * not produce it. Both prompt revisions in this repo say so in as many words: "No
 * result measured under 1.0 or 1.1 is reported under this version." Reading the
 * chain means registering a new prompt makes a stale probe visible on the next
 * report, instead of requiring somebody to remember.
 *
 * Returns null on a forked chain. Two unsuperseded heads is a registration error,
 * and picking one of them would be inventing an answer.
 */
export function currentPromptVersion(prompts: PromptRegistration[]): string | null {
  const superseded = new Set(
    prompts.map((p) => p.supersedes).filter((v): v is string => v !== undefined),
  );
  const heads = prompts.filter((p) => !superseded.has(p.version));
  return heads.length === 1 ? heads[0]!.version : null;
}
