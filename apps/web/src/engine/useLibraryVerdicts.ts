import { useMemo } from "react";
import { detectConflict, reasonVerdictOnly, type Verdict } from "@arbiter/engine";
import { useAppState } from "../state/store.js";

export interface LibraryRow { verdict: Verdict; conflicting: boolean; error?: string }

/**
 * reasonVerdictOnly across the scored split: no counterfactual, no planner. That
 * is the difference between roughly 150 engine evaluations per compound and one.
 *
 * `conflicting` uses detectConflict on the RAW claims - the pre-registered subset
 * definition from spec section 11, which is a property of the evidence and does
 * not move when rule behaviour changes.
 *
 * ERRORS ARE CONTAINED PER COMPOUND. One bad row must not blank a 267-row table:
 * an uncaught throw here takes the whole tab down and, under presentation
 * conditions, is indistinguishable from a crash.
 */
export function useLibraryVerdicts(): Map<string, LibraryRow> {
  const { data, ruleset } = useAppState();
  return useMemo(() => {
    const out = new Map<string, LibraryRow>();
    for (const id of data.testSplit) {
      const claims = data.claimsByCompound.get(id) ?? [];
      try {
        out.set(id, {
          verdict: reasonVerdictOnly(claims, ruleset).verdict,
          conflicting: detectConflict(claims).conflicting,
        });
      } catch (e) {
        out.set(id, { verdict: "abstain", conflicting: false, error: (e as Error).message });
      }
    }
    return out;
  }, [data, ruleset]);
}
