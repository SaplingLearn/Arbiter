/**
 * The correction, on screen, next to the figures it corrects.
 *
 * WHY THIS IS NOT A FOOTNOTE. Every accuracy figure this app renders comes from
 * results/metrics.json, which is graded under target v1.0 - the binarisation this
 * project's own audit invalidated, because it counted Less-DILI-Concern as
 * positive and so scored a system correctly declining to flag amlodipine as
 * wrong. Regenerating metrics.json under v2.0 is not a display change: the
 * harness pins the v1.0 ruleset hash and the labels come from a Python ingest.
 * So the shipped figures stay v1.0 and say so, and the corrected figures are
 * rendered beside them from the re-grade.
 *
 * POPULATIONS ARE NAMED because they differ. The conflict subset is n=61; the
 * full scored split is n=267. HANDOVER section 13.2 puts a v1.0 conflict-subset
 * confusion and a v2.0 full-split one in one table under a single "full scored
 * split" heading; both populations happen to give 0.750 -> 0.500 so its headline
 * survives, but the table is wrong and is not copied here. Every figure below
 * carries the population it was measured on, and the correction is shown twice -
 * once per population - rather than once across them.
 *
 * NUMBERS ARE READ, NOT TYPED. The only literals in the copy are the audit's own
 * class-composition counts, which are a property of DILIrank rather than of a run.
 */
import {
  bestPipeline, loadRescore, pipelineAt, populationAt,
} from "../data/rescore.js";

const ba = (x: number) => x.toFixed(3);
const conf = (c: { tp: number; fp: number; tn: number; fn: number }) =>
  `${c.tp} / ${c.fp} / ${c.tn} / ${c.fn}`;

export function ScoringVersionNotice() {
  const doc = loadRescore();
  const full = populationAt(doc, "2.0", "fullSplit");
  const subset = populationAt(doc, "2.0", "conflictSubset");
  const shippedFull = pipelineAt(doc, "1.0", "fullSplit", "ARBITER");
  const shippedSubset = pipelineAt(doc, "1.0", "conflictSubset", "ARBITER");
  const correctedFull = pipelineAt(doc, "2.0", "fullSplit", "ARBITER");
  const correctedSubset = pipelineAt(doc, "2.0", "conflictSubset", "ARBITER");
  const ceiling = full ? bestPipeline(full) : undefined;

  // Unreachable against the committed artifact, and deliberately not a fallback:
  // a half-populated correction is worse than none. rescore.test.tsx queries the
  // rendered notice by test id, so a document that lost a cell fails the suite
  // rather than quietly dropping the notice off the page.
  if (!full || !subset || !shippedFull || !shippedSubset) return null;
  if (!correctedFull || !correctedSubset || !ceiling) return null;

  return (
    <div className="caveat caveat-warn" data-testid="scoring-version">
      <p>
        <strong>Superseded scoring.</strong> Every accuracy figure on this page is graded
        under target v1.0, which this project&apos;s own audit invalidated: it counted
        Less-DILI-Concern as positive, placing 330 of 536 positives in a class containing
        aspirin, amoxicillin and amlodipine. Under that target a system correctly declining
        to flag amlodipine scores as wrong, and a system that flags everything scores well.
      </p>
      <p>
        Re-graded against the corrected target, ARBITER scores{" "}
        <span className="num">{ba(correctedFull.balancedAccuracy)}</span> balanced accuracy on
        the <strong>full scored split</strong> (n = {full.n}, tp / fp / tn / fn{" "}
        {conf(correctedFull.confusion)}), down from{" "}
        <span className="num">{ba(shippedFull.balancedAccuracy)}</span> on that same split. On
        the <strong>pre-registered conflict subset</strong> (n = {subset.n}) - the population
        every accuracy figure on this page is measured on - the same correction takes{" "}
        <span className="num">{ba(shippedSubset.balancedAccuracy)}</span> to{" "}
        <span className="num">{ba(correctedSubset.balancedAccuracy)}</span>. Two populations,
        stated separately: neither figure transfers to the other set.
      </p>
      <p>
        Under the corrected target no pipeline tested clears{" "}
        <span className="num">{ba(ceiling.balancedAccuracy)}</span> (
        <span className="mono">{ceiling.pipeline}</span>, full scored split), and that includes
        every baseline. The finding is about the target, not about this system.
      </p>
      <p className="small muted">{doc.qsarCaveat}</p>
    </div>
  );
}
