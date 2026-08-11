import type { LoadedData } from "../data/load.js";
import { CYCLOSPORINE } from "../data/heroCases.js";
import type { Action, Region } from "../state/store.js";
import type { TabId } from "../router.js";

export interface Beat {
  n: number;
  title: string;
  tab: TabId;
  /**
   * The compound this beat narrates. REQUIRED on every beat, not optional.
   *
   * An optional field was tried and is wrong: with only the contrast beat naming a
   * compound, pressing ← from it lands on a beat that names none, which leaves
   * Cyclosporine selected while the record beat narrates TAK-994. Making it required
   * means every beat states its subject and no beat inherits one, so the tour is
   * correct from any entry point and in both directions - including after a judge
   * has clicked a library row, which is the latent bug this closes.
   */
  compoundId: string;
  focus: Region | null;
  /**
   * Data changes a beat performs, expressed as the SAME actions a user could
   * dispatch by hand. The tour holds no data of its own, so the guided path and
   * the manual path cannot disagree.
   *
   * Every beat sets its OWN `setAsOf`, even a beat whose as-of date is unchanged
   * from the one before it. Leaving `actions: []` on such a beat was tried and is
   * wrong, for the same reason `compoundId` is required rather than optional: a
   * beat with no `setAsOf` of its own INHERITS whatever the previous beat left
   * behind, and inheritance is direction-dependent. Beat 5 (the record tab) used
   * to carry `actions: []` - reached forward from beat 4 it inherited
   * `postMurineStudy`, correctly, but reached backward from beat 6 it inherited
   * `null`, because beat 6 sets `null` and nothing restores it. That is not
   * cosmetic on the record beat specifically: `Record.tsx` hashes
   * `visibleClaims(all, asOf)` into the signed evidence snapshot and stores
   * `asOfDate: asOf` on the position, so a presenter who steps backward onto this
   * beat and signs would record a position against a different evidence snapshot
   * than the one the forward path produces - inside the hash-chained audit log.
   * Stating every beat's date explicitly means no beat inherits one, so the tour
   * is correct from any entry point and in both directions.
   */
  actions: Action[];
  /**
   * Already resolved against the data. `buildBeats` receives `LoadedData`, so a
   * beat that quotes a measured figure interpolates it here rather than carrying a
   * thunk the renderer has to call.
   *
   * This replaced a `string | ((d: LoadedData) => string)` union and a `beatLine(b, d)`
   * resolver, which existed only because `BEATS` was a module constant with no
   * access to the data. That constraint is gone; the union's reason for existing
   * went with it. What the union was FOR is kept and is not negotiable - see beat 0.
   */
  line: string;
}

/**
 * Built from `data` rather than declared as a constant, for two reasons that arrived
 * independently and turned out to be the same reason.
 *
 * The milestone dates come from the hero case itself; they were previously duplicated
 * here as literals, which is one edit to `tak994.json` away from a tour that sets an
 * as-of date the as-of bar does not offer. And beat 0's figures come from
 * `metrics.json`, because they used to be a hard-coded "61 of 267" - the one retyped
 * number left in the app, in the first sentence a judge hears, on the screen that
 * shows the hero case was not cherry-picked.
 */
export function buildBeats(data: LoadedData): Beat[] {
  const tak = data.heroCases.get("TAK-994")!;
  const preFih = tak.asOfMilestones["preFirstInHuman"]!;
  const postMurine = tak.asOfMilestones["postMurineStudy"]!;
  const cyclo = data.heroCases.get(CYCLOSPORINE)!;

  const n = data.metrics.sampleSizes;

  return [
    {
      n: 0, title: "The desk, before first-in-human", tab: "compounds",
      compoundId: tak.compoundId, focus: null,
      actions: [{ type: "setAsOf", asOf: preFih }],
      line: `${n.conflictSubset} of ${n.scored} scored compounds have streams in genuine `
        + "conflict. This case is one of them.",
    },
    {
      n: 1, title: "What happens today", tab: "case",
      compoundId: tak.compoundId, focus: "evidence",
      actions: [{ type: "setAsOf", asOf: preFih }],
      line: "Majority vote, weighted average and every single source all say advance.",
    },
    {
      n: 2, title: "ARBITER's argument", tab: "case",
      compoundId: tak.compoundId, focus: "trace",
      actions: [{ type: "setAsOf", asOf: preFih }],
      line: "Nothing is defeated. Nothing contradicts anything. Each source is discounted for what it cannot license, and most of the weight lands on uncommitted.",
    },
    {
      n: 3, title: "The honest gap, and what would flip it", tab: "case",
      compoundId: tak.compoundId, focus: "trace",
      actions: [{ type: "setAsOf", asOf: preFih }],
      line: "The range is the widest in the set. One claim would have to change to move the verdict.",
    },
    {
      n: 4, title: "The experiment it asks for", tab: "case",
      compoundId: tak.compoundId, focus: "trace",
      actions: [{ type: "setAsOf", asOf: postMurine }],
      line: "It asks for a human BSEP assay at matched exposure. Takeda ran a mouse study instead - and even that does not license a conclusion, because it is a mouse.",
    },
    {
      n: 5, title: "The table", tab: "record",
      compoundId: tak.compoundId, focus: null,
      actions: [{ type: "setAsOf", asOf: postMurine }],
      line: "Positions are recorded, including dissent. The named decision owner signs. ARBITER holds no position.",
    },
    {
      n: 6, title: "When it does commit", tab: "case",
      compoundId: cyclo.compoundId, focus: "trace",
      actions: [{ type: "setAsOf", asOf: null }],
      line: `Same rules, same engine. On ${cyclo.displayName} the human streams disagree at the mechanism - and it commits.`,
    },
    {
      // Corpus-wide statistics, so the compound is immaterial to what is rendered.
      // It is still named, because "immaterial here" is not a reason to leave the
      // selection to whatever the previous beat happened to set.
      n: 7, title: "What the numbers say", tab: "validation",
      compoundId: tak.compoundId, focus: null,
      actions: [{ type: "setAsOf", asOf: null }],
      line: "Determinism and robustness. Coverage is the finding. The planner recommendation survives ±50% perturbation of every elicited prior.",
    },
  ];
}
