import { useAppState, useDispatch, type ProvisionalCall, type Region } from "../../state/store.js";
import { useCaseReasoning } from "../../engine/useCaseReasoning.js";
import { CaseHeader } from "./CaseHeader.js";
import { EvidencePanel } from "./EvidencePanel.js";
import { TracePanel } from "./TracePanel.js";
import { TablePanel } from "./TablePanel.js";
import "./case.css";

/**
 * Where asking for the reader's own call first is worth its cost.
 *
 * Buccinca, Malaya & Gajos 2021 measured that the forcing function works AND that
 * it costs effort, so spending it everywhere teaches the reader to click through
 * it, and a reflex click is worse than no gate because it looks like diligence.
 *
 * A GAP THRESHOLD WAS THE OBVIOUS CHOICE AND IT IS WRONG HERE, measured rather
 * than assumed: a 0.25 gap fires on 260 of the 267 scored compounds, because this
 * engine abstains with a wide interval on almost everything. That is a universal
 * gate wearing a condition.
 *
 * The condition that matches the research is whether there is anything to be
 * anchored BY. Over-reliance is deference to a stated recommendation; an
 * abstention with a wide interval recommends nothing and anchors nobody, it says
 * the evidence cannot answer. So the gate falls where the engine commits, or where
 * the streams actively conflict: 7 of 267 on this corpus, which is every case
 * where a reader could defer to an answer instead of forming one.
 */
function worthAsking(r: { verdict: string; contested: boolean }): boolean {
  return r.verdict !== "abstain" || r.contested;
}

export function CaseTab() {
  const { tour, selectedCompoundId, provisionalCall } = useAppState();
  const reasoning = useCaseReasoning();
  const dispatch = useDispatch();

  /**
   * Asked once per compound. There is no un-set action: a reader who could
   * withdraw the call after seeing the verdict could un-commit, and the commitment
   * is the whole mechanism.
   *
   * THE GUIDED WALK IS EXEMPT, and this is a design decision rather than a
   * concession to a failing test. The forcing function exists to stop a READER
   * deferring to a stated answer instead of forming their own. During the narrated
   * tour nobody in the room is forming a call; a presenter is explaining a case,
   * and beat 6 lands on Cyclosporine precisely to show a commitment. Interposing a
   * three-button gate there costs a keystroke on stage and buys no cognitive
   * benefit, because the audience was never going to be asked.
   *
   * `tour.beat > 0` is the signal that the walk is running: the tour dispatches
   * setTourBeat on every step, and a reader who has not touched it sits at 0.
   */
  const guidedWalk = tour.beat > 0;
  const gated = worthAsking(reasoning)
    && !guidedWalk
    && provisionalCall[selectedCompoundId] === undefined;
  const commit = (call: ProvisionalCall) =>
    dispatch({ type: "setProvisionalCall", compoundId: selectedCompoundId, call });
  const focus = tour.focus;
  const toggle = (r: Region) => dispatch({ type: "setFocus", focus: focus === r ? null : r });
  // A region is collapsed when some OTHER region holds the spotlight. The class
  // only trims the padding a 56px rail has no room for; the collapsing itself is
  // the [data-focus] grid transition in case.css.
  const collapsed = (r: Region) => focus !== null && focus !== r;
  const regionClass = (r: Region) => `case-region${collapsed(r) ? " is-rail" : ""}`;

  return (
    <section>
      {/* The verdict lives in TWO places, so both wait: CaseHeader carries the
          verdict label, belief, plausibility and the gap, and TracePanel carries
          the belief track, the mass line, the verdict reason and the counterfactual.
          The evidence and the challenge panel stay visible throughout, because the
          reader cannot form a call without them. */}
      {gated ? null : <CaseHeader />}
      <div className="case-grid" data-focus={focus ?? ""}>
        <div className={regionClass("evidence")}>
          <EvidencePanel collapsed={collapsed("evidence")} onExpand={() => toggle("evidence")} />
        </div>
        {/* The prompt takes the trace region's slot rather than adding a fourth,
            so the [data-focus] grid transition is untouched and the layout never
            changes shape. */}
        <div className={regionClass("trace")}>
          {gated ? (
            <section className="provisional" data-testid="provisional-prompt">
              <h3 className="label">Your call first</h3>
              <p className="small">
                ARBITER reached a conclusion on this compound, which is the situation
                where deferring to it is easiest. Read the evidence, record what you
                would decide, and the verdict and its reasoning appear. Committing
                first is what keeps this a second opinion rather than an anchor.
              </p>
              <button type="button" data-testid="provisional-advance" onClick={() => commit("advance")}>
                Advance
              </button>
              <button type="button" data-testid="provisional-do-not-advance" onClick={() => commit("do_not_advance")}>
                Do not advance
              </button>
              <button type="button" data-testid="provisional-cannot-conclude" onClick={() => commit("cannot_conclude")}>
                Cannot conclude
              </button>
            </section>
          ) : (
            <TracePanel collapsed={collapsed("trace")} onExpand={() => toggle("trace")} />
          )}
        </div>
        <div className={regionClass("table")}>
          <TablePanel collapsed={collapsed("table")} onExpand={() => toggle("table")} />
        </div>
      </div>
    </section>
  );
}
