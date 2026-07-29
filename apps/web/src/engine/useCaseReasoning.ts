import { useMemo } from "react";
import { reason, type Reasoning } from "@arbiter/engine";
import { useAppState, visibleClaims, workingClaims } from "../state/store.js";

/**
 * Full reason() - counterfactual and planner included - for the SELECTED compound
 * only. Around 150 engine evaluations, which is fine for one compound and would
 * not be for 267.
 *
 * Call site 1 of the four that §9 unifies. The compound lookup now lives in
 * `workingClaims`, so this hook and the panel beside it read the same evidence by
 * construction rather than by two copies of the same three lines agreeing.
 */
export function useCaseReasoning(): Reasoning {
  const state = useAppState();
  const { data, ruleset, asOf, selectedCompoundId, evidenceEdits } = state;
  return useMemo(
    () => reason(visibleClaims(workingClaims(state, selectedCompoundId), asOf), ruleset, "", data.assays),
    // `state` is read inside, but every field the selector touches - `data` and
    // `evidenceEdits` - is listed, so the memo cannot go stale. Listing `state`
    // itself would instead re-run the engine on the motion toggle and on every
    // tour beat.
    //
    // evidenceEdits is load-bearing: without it a reclassification would leave
    // the verdict stale, which is the exact defect §9 describes with the panels
    // reversed.
    [data, ruleset, asOf, selectedCompoundId, evidenceEdits],
  );
}
