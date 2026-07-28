import { useMemo } from "react";
import { reason, type Reasoning } from "@arbiter/engine";
import { useAppState, visibleClaims } from "../state/store.js";

/**
 * Full reason() - counterfactual and planner included - for the SELECTED compound
 * only. Around 150 engine evaluations, which is fine for one compound and would
 * not be for 267.
 */
export function useCaseReasoning(): Reasoning {
  const { data, ruleset, asOf, selectedCompoundId } = useAppState();
  return useMemo(() => {
    const all = selectedCompoundId === data.fixture.compoundId
      ? data.fixture.claims
      : (data.claimsByCompound.get(selectedCompoundId) ?? []);
    return reason(visibleClaims(all, asOf), ruleset, "", data.assays);
  }, [data, ruleset, asOf, selectedCompoundId]);
}
