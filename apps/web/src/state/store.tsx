import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import type { EvidenceClaim, Rule, RuleId, Ruleset } from "@arbiter/engine";
import type { LoadedData } from "../data/load.js";
import type { TabId } from "../router.js";

export type Region = "evidence" | "trace" | "table";

/** Master spec section 7a. Hash-chained audit log - never called a blockchain. */
export interface ReviewerPosition {
  reviewerId: string; displayName: string; role: string;
  position: "agree" | "dissent" | "abstain";
  rationale: string | null;
  signedAt: string;
  /**
   * A DIGEST of the ruleset that was on screen, over the pre-registration surface
   * (`browserRulesetHash`) - not `ruleset.version`. A version string is identical
   * across every edit a toxicologist can make, so storing one here made a position
   * signed under an edited ruleset byte-identical to one signed under the
   * registered ruleset.
   */
  rulesetHash: string;
  evidenceSnapshotHash: string;
  asOfDate: string | null;
  signatureMethod: "demo-persona" | "sso";
  prevRecordHash: string;
}

export interface AppState {
  data: LoadedData;
  ruleset: Ruleset;                 // editable working copy
  asOf: string | null;
  selectedCompoundId: string;
  tour: { beat: number; tab: TabId; focus: Region | null };
  positions: ReviewerPosition[];
  motion: boolean;
}

export type Action =
  | { type: "selectCompound"; compoundId: string }
  | { type: "setAsOf"; asOf: string | null }
  | { type: "setRuleStrength"; id: RuleId; strength: number }
  | { type: "setRuleEnabled"; id: RuleId; enabled: boolean }
  | { type: "resetRuleset" }
  | { type: "setTourBeat"; beat: number; tab: TabId; focus: Region | null }
  | { type: "setFocus"; focus: Region | null }
  | { type: "addPosition"; position: ReviewerPosition }
  | { type: "toggleMotion" };

export function initialState(data: LoadedData): AppState {
  return {
    data,
    ruleset: data.ruleset,
    asOf: null,
    selectedCompoundId: data.fixture.compoundId,
    tour: { beat: 0, tab: "case", focus: null },
    positions: [],
    motion: true,
  };
}

/** Claims visible as of a date. The engine has no clock; filtering is the caller's job. */
export function visibleClaims(all: EvidenceClaim[], asOf: string | null): EvidenceClaim[] {
  return asOf === null ? all : all.filter((c) => c.availableFrom <= asOf);
}

function mapRule(rs: Ruleset, id: RuleId, fn: (r: Rule) => Rule): Ruleset {
  return { ...rs, rules: rs.rules.map((r) => (r.id === id ? fn(r) : r)) };
}

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "selectCompound": return { ...s, selectedCompoundId: a.compoundId };
    case "setAsOf": return { ...s, asOf: a.asOf };
    case "setRuleStrength":
      // Reject rather than store an invalid ruleset. The engine clamps
      // defensively, but state should never hold a value the schema refuses.
      if (a.strength < 0 || a.strength > 1) return s;
      return { ...s, ruleset: mapRule(s.ruleset, a.id, (r) => ({ ...r, strength: a.strength })) };
    case "setRuleEnabled":
      return { ...s, ruleset: mapRule(s.ruleset, a.id, (r) => ({ ...r, enabled: a.enabled })) };
    case "resetRuleset": return { ...s, ruleset: s.data.ruleset };
    // Presentation only. Beats that change DATA dispatch the same actions a user
    // would, so the guided and manual paths are one code path.
    case "setTourBeat": return { ...s, tour: { beat: a.beat, tab: a.tab, focus: a.focus } };
    case "setFocus": return { ...s, tour: { ...s.tour, focus: a.focus } };
    case "addPosition": return { ...s, positions: [...s.positions, a.position] };
    case "toggleMotion": return { ...s, motion: !s.motion };
  }
}

const StateCtx = createContext<AppState | null>(null);
const DispatchCtx = createContext<Dispatch<Action> | null>(null);

export function StoreProvider({ data, children }: { data: LoadedData; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, data, initialState);
  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useAppState(): AppState {
  const s = useContext(StateCtx);
  if (!s) throw new Error("useAppState used outside StoreProvider");
  return s;
}

export function useDispatch(): Dispatch<Action> {
  const d = useContext(DispatchCtx);
  if (!d) throw new Error("useDispatch used outside StoreProvider");
  return d;
}
