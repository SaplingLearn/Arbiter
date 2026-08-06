import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import {
  EvidenceClaimSchema,
  type AssayOperator, type EvidenceClaim, type Rule, type RuleId, type Ruleset,
} from "@arbiter/engine";
import type { LoadedData } from "../data/load.js";
import { BOOT_CASE } from "../data/heroCases.js";
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

/**
 * What a toxicologist may reclassify, DERIVED rather than invented (spec §5.3).
 *
 * It is exactly the set an AssayOperator must declare to synthesise a
 * hypothetical claim (`packages/engine/src/plan.ts:13-16`), a set arrived at
 * independently for that purpose. Typing it this way excludes `assertion`,
 * `strength`, `id`, `compoundId`, `availableFrom` and `provenance` BY
 * CONSTRUCTION: none is a member of `AssayOperator["produces"]`, so there is no
 * deny-list to keep in step with the engine, and adding a rule-consumed field to
 * the planner widens both at once.
 *
 * The exclusions are not arbitrary and belong in the Q&A: changing an assertion
 * is not testing the reasoning, it is choosing the answer, and the system already
 * answers that question read-only through `findCounterfactual`; `strength` has no
 * mediating rule and multiplies straight into mass, so a per-claim dial would
 * reintroduce at the evidence layer exactly the unregistered knob the ruleset
 * does not have; `availableFrom` is the as-of control's job and the hindsight
 * defence.
 *
 * The defensible framing: a toxicologist contests what the evidence IS, and the
 * pre-registered rules - unchanged - recompute what it licenses.
 */
export type ReclassifiableField = keyof AssayOperator["produces"];

/**
 * The same set at runtime, needed to prune a no-op edit in `reclassifyClaim`.
 *
 * Written as a `Record<ReclassifiableField, true>` rather than an array because
 * the compiler then REQUIRES every member and REFUSES any non-member: a field
 * added to `AssayOperator["produces"]` and not added here stops the build, which
 * is the only way a runtime list stays honest about a compile-time type.
 */
const FIELD_SET: Record<ReclassifiableField, true> = {
  system: true,
  stream: true,
  measuresKeyEvent: true,
  exposureRelevant: true,
  inApplicabilityDomain: true,
  klimisch: true,
};
export const RECLASSIFIABLE_FIELDS = Object.keys(FIELD_SET) as ReclassifiableField[];

/** One claim's overlay. Overrides, never a second claim array (§9). */
export type EvidenceEdit = Partial<Pick<EvidenceClaim, ReclassifiableField>>;

export interface AppState {
  data: LoadedData;
  ruleset: Ruleset;                            // editable working copy
  /** The evidence working copy, keyed by claim id. `data.claimsByCompound` and
   *  every hero case's `claims` stay immutable, exactly as `data.ruleset` does. */
  evidenceEdits: Record<string, EvidenceEdit>;
  asOf: string | null;
  selectedCompoundId: string;
  tour: { beat: number; tab: TabId; focus: Region | null };
  positions: ReviewerPosition[];
  motion: boolean;
  /**
   * The anchor the navigator is trying to reach. It cannot be reached in the
   * click that requested it: switching tab means assigning window.location.hash,
   * and hashchange fires asynchronously, so the target element is not mounted on
   * the next statement (spec section 8).
   */
  pendingAnchor: string | null;
}

export type Action =
  | { type: "selectCompound"; compoundId: string }
  | { type: "setAsOf"; asOf: string | null }
  | { type: "setRuleStrength"; id: RuleId; strength: number }
  | { type: "setRuleEnabled"; id: RuleId; enabled: boolean }
  | { type: "resetRuleset" }
  | { type: "reclassifyClaim"; claimId: string; edit: EvidenceEdit }
  | { type: "resetEvidence" }
  | { type: "setTourBeat"; beat: number; tab: TabId; focus: Region | null }
  | { type: "setFocus"; focus: Region | null }
  | { type: "addPosition"; position: ReviewerPosition }
  | { type: "toggleMotion" }
  | { type: "setPendingAnchor"; anchorId: string | null };

export function initialState(
  data: LoadedData,
  initialEvidenceEdits: Record<string, EvidenceEdit> = {},
): AppState {
  return {
    data,
    ruleset: data.ruleset,
    evidenceEdits: initialEvidenceEdits,
    asOf: null,
    selectedCompoundId: BOOT_CASE,
    tour: { beat: 0, tab: "case", focus: null },
    positions: [],
    motion: true,
    pendingAnchor: null,
  };
}

/** Claims visible as of a date. The engine has no clock; filtering is the caller's job. */
export function visibleClaims(all: EvidenceClaim[], asOf: string | null): EvidenceClaim[] {
  return asOf === null ? all : all.filter((c) => c.availableFrom <= asOf);
}

/**
 * The registered claims for a compound. THE ONE COPY.
 *
 * This lookup was duplicated at `useCaseReasoning.ts:13`, `CaseHeader.tsx:15`,
 * `EvidencePanel.tsx:9` and `Record.tsx:16`. Wired into three of the four, an
 * evidence working copy produces a verdict computed from evidence the panel
 * beside it is not showing - which is why §9 requires the refactor BEFORE the
 * working copy, not alongside it.
 *
 * Deliberately module-private: `workingClaims` is the only exported way to reach
 * a compound's claims, so a fifth call site cannot quietly appear reading the
 * registered map by hand. `useLibraryVerdicts` reads `data.claimsByCompound`
 * directly and that is the correct behaviour, not an oversight - see §9.1 on the
 * polarity below.
 *
 * A FIXTURE-backed hero case wins over the bundled corpus deliberately: TAK-994
 * appears in BOTH `data/out/evidence.json` and `data/out/tak994.json`, and the
 * fixture is the hand-curated literature case the demo runs on. The two copies
 * agree today; the precedence is kept so that they may stop agreeing without the
 * Case tab silently switching source.
 *
 * A CORPUS-backed hero case has `claims: null` and falls straight through to the
 * corpus, so it has no second copy to disagree with. One `??` chain covers both:
 * null claims are indistinguishable from an absent case, which is exactly right.
 */
function registeredClaims(data: LoadedData, compoundId: string): EvidenceClaim[] {
  return data.heroCases.get(compoundId)?.claims
    ?? data.claimsByCompound.get(compoundId)
    ?? [];
}

/**
 * A registered claim by id, or null.
 *
 * Claim ids are `${compoundId}:${stream}`, so the compound id is a PREFIX SLICE
 * at the first colon - never `split(":")`. Colons are load-bearing elsewhere in
 * this data (`KE:BSEP-INHIBITION`, the `single:qsar` baseline names), and a
 * delimiter split is one added stream name away from silently indexing the wrong
 * compound (spec §8).
 */
function findClaim(data: LoadedData, claimId: string): EvidenceClaim | null {
  const colon = claimId.indexOf(":");
  if (colon <= 0) return null;
  return registeredClaims(data, claimId.slice(0, colon)).find((c) => c.id === claimId) ?? null;
}

/**
 * The claims for a compound with the evidence working copy applied.
 *
 * §9.1 - THE TWO WORKING COPIES RUN AT OPPOSITE POLARITY, and this selector is
 * where that is enforced. The ruleset working copy already feeds the 267-row
 * library table: `Compounds.tsx` calls `useLibraryVerdicts()` with no override,
 * deliberately, and the pre-flight panel passes the registered ruleset explicitly
 * when it needs a pristine baseline. An evidence working copy must NOT reach that
 * table - evidence edits are per-claim on one compound, and a corpus statistic
 * recomputed over edited evidence is a number computed after seeing a result.
 *
 * So: for the ruleset, working is the default and registered is the opt-in; for
 * evidence, registered is the default and WORKING IS THE OPT-IN. Calling this
 * selector is that opt-in. Anything corpus-shaped keeps reading
 * `data.claimsByCompound` and gets registered evidence for free.
 *
 * The untouched array is returned BY REFERENCE so `useCaseReasoning`'s memo holds
 * across unrelated actions.
 */
export function workingClaims(state: AppState, compoundId: string): EvidenceClaim[] {
  const registered = registeredClaims(state.data, compoundId);
  let touched = false;
  const out = registered.map((c) => {
    const edit = state.evidenceEdits[c.id];
    if (edit === undefined) return c;
    touched = true;
    return { ...c, ...edit };
  });
  return touched ? out : registered;
}

/**
 * §9.3 - ONE predicate, applied to BOTH working copies.
 *
 * `Preflight.tsx` tested "edited" by reference (`ruleset !== data.ruleset`) while
 * `Ruleset.tsx` tested it by deep compare, so dragging a strength slider and
 * dragging it back cleared the MODIFIED badge while the pre-flight panel still
 * warned of live edits. It erred safe, so it was a wart rather than a hole - but
 * a second working copy needs the question answered before it is added, not
 * after.
 *
 * The value compare wins. `resetRuleset` restores `data.ruleset` by reference, so
 * reference equality and value equality agree on the reset path; they diverge on
 * the drag-and-return path, where reference equality tells a presenter to press
 * Reset on a ruleset that already IS the registered one. A false alarm is not
 * free in the one panel whose stated rule is that every line is a check computed
 * now rather than a caption.
 *
 * At the evidence copy this is exact because `reclassifyClaim` prunes a field
 * back to its registered value rather than storing it, so `evidenceEdits` holds
 * genuine changes only and comparing it to `{}` is comparing effect to effect.
 */
export function isEdited(working: unknown, registered: unknown): boolean {
  return JSON.stringify(working) !== JSON.stringify(registered);
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

    case "reclassifyClaim": {
      const registered = findClaim(s.data, a.claimId);
      // An edit naming a claim that does not exist is refused, not stored: a
      // stored orphan badges the panel MODIFIED for a change nothing computes.
      if (registered === null) return s;

      const merged: EvidenceClaim = {
        ...registered,
        ...(s.evidenceEdits[a.claimId] ?? {}),
        ...a.edit,
      };

      // §5.4. `schema.ts:26-35` carries a CROSS-FIELD constraint - an in_silico or
      // qsar claim must have `measuresKeyEvent === null` - whose own message
      // states the stakes: leaving it non-null "lets it escape R2's
      // structural-correlation discount and be weighted like human clinical
      // evidence." A field-by-field check cannot see that, so the WHOLE merged
      // claim is parsed, not the edit.
      //
      // The engine's precedent is `plan.ts:174-180`, which validates every
      // synthetic claim it builds and THROWS rather than reason over an
      // unvalidated one. The reducer's equivalent of throwing is refusing the
      // transition: a rejected reclassification must not take the tab down in
      // front of a judge, and returning `s` unchanged means the confirm panel
      // simply does not move.
      if (!EvidenceClaimSchema.safeParse(merged).success) return s;

      // Keep only fields that genuinely differ from the registered claim, so
      // reclassify-and-reclassify-back clears the badge exactly as
      // drag-and-drag-back clears the ruleset badge (§9.3). The single cast is
      // the boundary: the loop above writes only members of
      // RECLASSIFIABLE_FIELDS, which IS EvidenceEdit's key set by construction.
      const kept: Record<string, unknown> = {};
      for (const f of RECLASSIFIABLE_FIELDS) {
        if (merged[f] !== registered[f]) kept[f] = merged[f];
      }

      const evidenceEdits = { ...s.evidenceEdits };
      if (Object.keys(kept).length === 0) delete evidenceEdits[a.claimId];
      else evidenceEdits[a.claimId] = kept as EvidenceEdit;
      return { ...s, evidenceEdits };
    }

    // Mirrors resetRuleset: the registered evidence is never written, so
    // restoring it is dropping the overlay.
    case "resetEvidence": return { ...s, evidenceEdits: {} };

    // Presentation only. Beats that change DATA dispatch the same actions a user
    // would, so the guided and manual paths are one code path.
    case "setTourBeat": return { ...s, tour: { beat: a.beat, tab: a.tab, focus: a.focus } };
    case "setFocus": return { ...s, tour: { ...s.tour, focus: a.focus } };
    case "addPosition": return { ...s, positions: [...s.positions, a.position] };
    case "toggleMotion": return { ...s, motion: !s.motion };
    // Presentational, like setFocus. The hash is still what switches the tab -
    // this only records what to do once it has.
    case "setPendingAnchor": return { ...s, pendingAnchor: a.anchorId };
  }
}

const StateCtx = createContext<AppState | null>(null);
const DispatchCtx = createContext<Dispatch<Action> | null>(null);

export function StoreProvider(
  { data, initialEvidenceEdits, initialState: seed, children }:
    { data: LoadedData; initialEvidenceEdits?: Record<string, EvidenceEdit>;
      initialState?: AppState; children: ReactNode },
) {
  // The seed props exist so a test that wants to render with edited evidence, or
  // a whole state (a different selectedCompoundId, say), already in place can
  // pass it here, rather than dispatching actions through act() in every test
  // that needs one. `initialState` (the whole state) wins over
  // `initialEvidenceEdits` (just the evidence overlay) when both are given.
  const [state, dispatch] = useReducer(
    reducer, data, (d) => seed ?? initialState(d, initialEvidenceEdits),
  );
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
