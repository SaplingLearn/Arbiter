import { useMemo, useState } from "react";
import {
  EvidenceClaimSchema, relevanceDiscount, reasonVerdictOnly,
  type EvidenceClaim, type Reasoning, type RuleId, type Ruleset,
} from "@arbiter/engine";
import {
  useAppState, useDispatch, visibleClaims, workingClaims,
  type Action, type EvidenceEdit,
} from "../../state/store.js";
import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { interpret, type InterpretInput, type Proposal } from "../../ai/interpret.js";
import type { Resolution } from "../../ai/resolve.js";

/**
 * The table region, and Surface 1's mount (design section 5).
 *
 * THE CHANGE IS DISPLAYED BEFORE IT IS APPLIED. That is what makes an interpreter
 * safe to put in front of a toxicologist: a misinterpretation is visible and
 * rejectable, never silent. Apply then dispatches exactly the actions a user could
 * dispatch by hand from the Ruleset tab or the evidence panel, so the interpreted
 * path and the manual path are one code path and the parity guarantee holds.
 *
 * A toxicologist contests what the evidence IS, and the pre-registered rules -
 * unchanged - recompute what it licenses.
 */

/**
 * Claim ids contain colons (`TAK-994:invivo_rodent`), so parse by PREFIX-SLICE,
 * never `split(":")` (design section 8). Exported because the request-body test
 * recomputes it: the label must be a pure function of the id, which is what proves
 * nothing beyond the id leaves the browser.
 */
export function claimLabel(id: string): string {
  const colon = id.indexOf(":");
  return (colon === -1 ? id : id.slice(colon + 1)).replace(/_/g, " ");
}

/** Renders a raw evidence value literally. `null` is a real value here, not missing data. */
function show(v: unknown): string {
  return v === null ? "null" : String(v);
}

/**
 * Half of the last displayed digit. A change smaller than this is one the panel
 * does not render, so announcing movement would be announcing a change the reader
 * cannot see.
 */
const MIN_VISIBLE = 5e-4;

function moved(before: Reasoning, after: Reasoning): boolean {
  return Math.abs(after.belief - before.belief) >= MIN_VISIBLE
    || Math.abs(after.plausibility - before.plausibility) >= MIN_VISIBLE
    || after.verdict !== before.verdict;
}

/**
 * Why the position did not move - COMPUTED from the two runs and the claims in
 * front of us, never canned.
 *
 * Measured on TAK-994: four of the six rules cannot move the number, for two
 * genuinely different reasons, and one string covering both would be wrong half the
 * time. The order of the branches is the order the reasons dominate.
 */
function noMoveReason(after: Reasoning, ruleset: Ruleset, claims: EvidenceClaim[], p: Proposal): string {
  const rule = p.targetRule;
  if (rule === null) return "The change was applied and the fused mass is unchanged to three decimal places.";

  // 1. The rule is acting as a DEFEAT rule. `rules.ts` RULE_PREDICATES read
  //    assertions, systems and exposure flags - never `strength` - so a strength
  //    change cannot reach a defeat. This is the R3 case on TAK-994, where all four
  //    safe claims are removed from fusion outright.
  const defeatSteps = after.trace.filter((s) => s.byRule === rule && s.status === "defeated");
  if (defeatSteps.length > 0 && (p.action === "lower_strength" || p.action === "raise_strength")) {
    return `${rule} is acting here as a defeat rule: it removed ${defeatSteps.length} claim(s) from the `
      + `fusion entirely, and a defeat is licensed by whether the rule is ENABLED, not by its strength. `
      + `Turning ${rule} off would move the position; changing its strength cannot.`;
  }

  // 2. The rule discounts nothing in this evidence set. R4's clause is
  //    `inApplicabilityDomain === false` and R6 is diagnostic only - `rules.ts`
  //    says in terms that concordance is realised inside fuse() and is never
  //    applied to a mass.
  const discounted = claims.filter((c) => relevanceDiscount(c, ruleset).reasons.some((r) => r.byRule === rule));
  if (discounted.length === 0) {
    return `No claim in this evidence set is discounted by ${rule}, and no step in the trace cites it, `
      + `so the change had nothing to act on.`;
  }

  // 3. The rule discounts only claims that commit no mass. This is R2 and R5 on
  //    TAK-994, both of which reach only TAK-994:qsar.
  const committing = discounted.filter((c) => c.assertion !== "ambiguous" && c.strength > 0);
  if (committing.length === 0) {
    const one = discounted.length === 1;
    return `${rule} applies only to ${discounted.map((c) => c.id).join(", ")}, which `
      + `${one ? "asserts" : "assert"} `
      + `${discounted.map((c) => `${c.assertion} at strength ${c.strength.toFixed(2)}`).join("; ")} `
      + `and therefore ${one ? "commits" : "commit"} no mass to either side.`;
  }

  return "The change was applied and the fused mass is unchanged to three decimal places.";
}

/**
 * The proposal, expressed as an action a user could have dispatched themselves.
 *
 * The `as EvidenceEdit` cast is discharged by `validAgainstEvidence`, which ran
 * before this proposal was ever displayed: design section 5.4 validates on ARRIVAL
 * rather than on apply precisely so that by the time Apply is reachable the value
 * is already known to produce a schema-valid claim.
 */
function dispatchable(p: Proposal): Action | null {
  if (p.action === "reclassify_field") {
    if (p.targetClaimId === null || p.field === null) return null;
    return { type: "reclassifyClaim", claimId: p.targetClaimId, edit: { [p.field]: p.newValue } as EvidenceEdit };
  }
  if (p.targetRule === null) return null;
  if (p.action === "disable") return { type: "setRuleEnabled", id: p.targetRule, enabled: false };
  if (typeof p.newValue !== "number") return null;
  return { type: "setRuleStrength", id: p.targetRule, strength: p.newValue };
}

/**
 * Design section 5.4, run here rather than inside the ladder because the ladder is
 * not given the raw values that `schema.ts:26-35`'s cross-field refinement needs.
 * An invalid proposal is a MISS, not an error: the panel falls back to the rule
 * picker and the user never sees a broken proposal.
 */
function validAgainstEvidence(p: Proposal, claims: EvidenceClaim[]): boolean {
  if (p.action !== "reclassify_field" || p.field === null || p.targetClaimId === null) return true;
  const target = claims.find((c) => c.id === p.targetClaimId);
  if (target === undefined) return false;
  return EvidenceClaimSchema.safeParse({ ...target, [p.field]: p.newValue }).success;
}

/** The proposal card's action kind, derived for both the test hook and the CSS. */
function actionKind(p: Proposal): "disable" | "reclassify" | "strength" {
  return p.action === "disable" ? "disable" : p.action === "reclassify_field" ? "reclassify" : "strength";
}

/** The old→new line, resolved LOCALLY: the model never saw the old value. */
function deltaText(p: Proposal, ruleset: Ruleset, claims: EvidenceClaim[]): string {
  if (p.action === "reclassify_field" && p.targetClaimId !== null && p.field !== null) {
    const target = claims.find((c) => c.id === p.targetClaimId);
    return `${claimLabel(p.targetClaimId)} · ${p.field}: ${show(target?.[p.field])} → ${show(p.newValue)}`;
  }
  if (p.action === "disable") return `${p.targetRule ?? ""} enabled: true → false`;
  const current = ruleset.rules.find((r) => r.id === p.targetRule)?.strength ?? 0;
  const next = typeof p.newValue === "number" ? p.newValue.toFixed(2) : show(p.newValue);
  return `${p.targetRule ?? ""} strength: ${current.toFixed(2)} → ${next}`;
}

export function TablePanel({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const state = useAppState();
  const { data, ruleset, asOf, selectedCompoundId } = state;
  const dispatch = useDispatch();

  // The working pass: working evidence through the working ruleset.
  const after = useCaseReasoning();

  const claims = useMemo(
    () => visibleClaims(workingClaims(state, selectedCompoundId), asOf),
    [state, selectedCompoundId, asOf],
  );

  /**
   * The registered baseline, which design section 5.5 notes is cheap because it is
   * still sitting in state - the same trick Preflight.tsx uses for the manifest
   * check. Asking the ONE selector for the registered copy, rather than
   * re-deriving "the claims for this compound" a fifth time, is the point of
   * section 9's refactor.
   *
   * `reasonVerdictOnly` rather than `reason`: the delta reads verdict, belief and
   * plausibility only, and the counterfactual search behind `reason` costs ~130
   * extra engine evaluations for output nothing here looks at. Identical verdict
   * logic by construction - same function, one flag.
   */
  const before = useMemo(
    () => reasonVerdictOnly(
      visibleClaims(workingClaims({ ...state, evidenceEdits: {} }, selectedCompoundId), asOf),
      data.ruleset,
    ),
    [state, selectedCompoundId, asOf, data.ruleset],
  );

  const [challenge, setChallenge] = useState("");
  const [resolution, setResolution] = useState<Resolution<Proposal> | null>(null);
  const [armed, setArmed] = useState(false);
  const [applied, setApplied] = useState<Proposal | null>(null);

  if (collapsed) {
    return (
      <button type="button" className="case-rail" onClick={onExpand} aria-label="Expand the table">
        Table
      </button>
    );
  }

  const submit = async () => {
    // Claim IDS AND LABELS ONLY. The interpreter is never shown what the evidence
    // says, which is exactly why the old->new delta below is resolved here.
    const input: InterpretInput = {
      challenge,
      rules: ruleset.rules.map((r) => ({ id: r.id, enabled: r.enabled, strength: r.strength })),
      claims: claims.map((c) => ({ id: c.id, label: claimLabel(c.id) })),
    };
    const r = await interpret(input);
    const usable = r.value !== null && validAgainstEvidence(r.value, claims);
    // The rung is preserved even when the proposal is dropped, so the pre-flight
    // panel and the tests still see which rung answered.
    setResolution(usable ? r : { value: null, rung: r.rung, source: r.source });
    setApplied(null);
    setArmed(usable && r.value !== null && r.value.confidence === "high");
  };

  /** Rung 5. The USER names the rule; nothing here guesses one. */
  const pick = (id: RuleId) => {
    const rule = ruleset.rules.find((r) => r.id === id);
    if (!rule) return;
    setResolution({
      value: {
        targetRule: id, targetClaimId: null, action: "lower_strength", field: null,
        newValue: Number((Math.round((rule.strength / 2) / 0.05) * 0.05).toFixed(2)),
        paraphrase: `Reduce ${id}, ${rule.name.toLowerCase()}.`, confidence: "low",
      },
      rung: 5,
      source: "none",
    });
    setArmed(false);
  };

  const reject = () => {
    setResolution(null);
    setArmed(false);
  };

  const apply = (p: Proposal) => {
    const a = dispatchable(p);
    if (a === null) return;
    dispatch(a);
    setApplied(p);
    setResolution(null);
  };

  const p = resolution?.value ?? null;
  const kind = p === null ? null : actionKind(p);
  const didMove = applied === null ? false : moved(before, after);

  return (
    <div className="stack">
      <h3 className="label">The table</h3>
      <p className="muted">
        Positions and sign-off are recorded on the Record tab. Contest the reasoning here.
      </p>

      {/* A real <textarea>, not a contenteditable div: ui/isTypingTarget.ts already
          returns true for TEXTAREA, so the global arrow/M/? shortcuts suppress
          themselves and typing "murine" cannot strip the motion out of the demo. */}
      <div className="stack">
        <label className="label" htmlFor="challenge-input">Challenge the reasoning</label>
        <textarea
          id="challenge-input" data-testid="challenge-input" rows={3} className="field field-full"
          value={challenge} onChange={(e) => setChallenge(e.target.value)}
        />
        <button type="button" className="btn" data-testid="challenge-submit" onClick={() => void submit()}>
          Interpret
        </button>
      </div>

      {resolution !== null && (
        <p data-testid="proposal-rung" data-rung={resolution.rung} data-source={resolution.source} className="small muted">
          Read at rung {resolution.rung} ({resolution.source})
        </p>
      )}

      {p !== null && kind !== null && (
        <article data-testid="proposal" data-action-kind={kind} data-confidence={p.confidence} className="panel proposal-card">
          <p data-testid="proposal-paraphrase" data-emphasis={p.confidence === "low" ? "raised" : "normal"}
             className="proposal-paraphrase">
            {p.paraphrase}
          </p>

          {/* The old value never left this browser, so this line can only have been
              computed here. */}
          <p data-testid="proposal-delta" className="small mono">
            {deltaText(p, ruleset, claims)}
          </p>

          {p.confidence === "low" && (
            <label className="control">
              <input type="checkbox" data-testid="proposal-arm" checked={armed}
                     onChange={(e) => setArmed(e.target.checked)} />
              This reading is a low-confidence guess. Confirm it before applying.
            </label>
          )}

          <div className="row">
            <button type="button" className="btn btn-primary" data-testid="proposal-apply"
                    data-armed={String(armed)} disabled={!armed} onClick={() => apply(p)}>
              Apply
            </button>
            <button type="button" className="btn btn-ghost" data-testid="proposal-reject" onClick={reject}>
              Reject
            </button>
          </div>
        </article>
      )}

      {resolution !== null && p === null && (
        <fieldset data-testid="rule-picker" className="panel-flat">
          <legend className="label">Which rule do you want to contest?</legend>
          <div className="row">
            {ruleset.rules.map((r) => (
              <button key={r.id} type="button" className="btn" data-testid={`pick-${r.id}`} onClick={() => pick(r.id)}>
                {r.id} {r.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {applied !== null && (
        <section data-testid="applied-delta" data-moved={String(didMove)} className="panel">
          {/* "Applied - the position did not move, and here is why" is a first-class
              state. Four of the six rules cannot move the number on TAK-994, and a
              panel that renders that as a blank is a panel that looks broken in
              front of a judge. */}
          <h4 className="subtitle">
            {didMove ? "Applied — the position moved" : "Applied — the position did not move"}
          </h4>
          <div className="stack">
            <p data-testid="delta-belief" className="small">
              Belief {before.belief.toFixed(3)} → {after.belief.toFixed(3)}
            </p>
            <p data-testid="delta-plausibility" className="small">
              Plausibility {before.plausibility.toFixed(3)} → {after.plausibility.toFixed(3)}
            </p>
            <p data-testid="delta-gap" className="small">
              Gap {(before.plausibility - before.belief).toFixed(3)} → {(after.plausibility - after.belief).toFixed(3)}
            </p>
            <p data-testid="delta-verdict" className="small">
              Verdict {before.verdict} → {after.verdict}
            </p>
            {!didMove && (
              <p data-testid="delta-why" className="small muted">
                {noMoveReason(after, ruleset, claims, applied)}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
