/**
 * Commit before reveal. Spec: playbook §08 P2-C.
 *
 * WHY A GATE AND NOT A NOTE. Explanations alone measurably increase uncritical
 * acceptance - a plausible rationale invites agreement rather than scrutiny, and
 * human-plus-AI teams frequently underperform the AI alone. What reduces that is a
 * cognitive forcing function: something that compels an analytical judgement
 * before the recommendation is visible (Buçinca, Malaya & Gajos 2021, CSCW). The
 * deliberation app already has the strongest form of this in blind positions; this
 * is the same idea for the single-user app.
 *
 * ONLY ON THE CASES THAT WARRANT IT. A gate on every view is friction that gets
 * clicked through, which is worse than no gate because it manufactures a record of
 * a judgement nobody made. It fires when the belief-plausibility gap exceeds the
 * registered abstention threshold, or when the claims are contested - the two
 * situations where the reader's own reading is worth capturing. Both hero cases
 * trip it, by different clauses: TAK-994 on the gap (0.910 against 0.5),
 * Cyclosporine on contestedness (gap 0.098, conflict mass 0.122).
 *
 * THE PREDICATE IS EXPORTED because the verdict does not leak from one component.
 * `useCaseReasoning()` is called independently by CaseHeader, EvidencePanel,
 * TracePanel and TablePanel; gating the masthead alone leaves the conclusion
 * readable from the trace panel's verdict-reason line and from the
 * counterfactual's `newVerdict`. One predicate, applied at both leaking sites.
 */
import type { Reasoning, Verdict } from "@arbiter/engine";
import { useAppState, useDispatch, type AppState } from "../../state/store.js";

/**
 * True while the verdict must stay hidden.
 *
 * The threshold read is `state.data.ruleset` - the REGISTERED one - not the
 * editable working copy. Whether a reader is asked to commit is a property of the
 * case, and sourcing it from the working copy would let dragging a slider dismiss
 * the gate, which is the one edit that must not be able to reveal an answer.
 */
export function gateHolds(state: AppState, r: Reasoning, compoundId: string): boolean {
  if (state.provisionalCalls[compoundId] !== undefined) return false;
  const gap = r.plausibility - r.belief;
  return gap > state.data.ruleset.abstentionGapThreshold || r.contested;
}

const CALLS: { call: Verdict; testid: string; label: string }[] = [
  { call: "advance", testid: "commit-advance", label: "Advance" },
  { call: "do_not_advance", testid: "commit-do-not-advance", label: "Do not advance" },
  { call: "abstain", testid: "commit-abstain", label: "Abstain" },
];

export function CommitGate({ compoundId }: { compoundId: string }) {
  const dispatch = useDispatch();
  return (
    <div className="commit-gate" data-testid="commit-gate">
      <p className="caveat">
        The evidence on this compound is contested or leaves a wide gap. Before you see
        what ARBITER concluded, record your own call - it is kept beside the verdict so
        you can see where the two differ.
      </p>
      <p className="small muted">
        The evidence and the argument stay on screen. Only the conclusion is held back,
        and only until you answer.
      </p>
      <div className="commit-gate-actions">
        {CALLS.map((c) => (
          <button
            key={c.call}
            type="button"
            className="btn"
            data-testid={c.testid}
            onClick={() => dispatch({ type: "recordProvisionalCall", compoundId, call: c.call })}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ProvisionalCall({ compoundId }: { compoundId: string }) {
  const { provisionalCalls } = useAppState();
  const call = provisionalCalls[compoundId];
  if (call === undefined) return null;
  return (
    <p className="small muted" data-testid="provisional-call">
      You said <strong>{call.replace(/_/g, " ")}</strong> before seeing this.
    </p>
  );
}
