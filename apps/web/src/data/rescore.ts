/**
 * The v2.0 re-grade, read as data.
 *
 * `results/rescore-v2.json` is emitted by `tools/rescore_v2.py`, which re-grades
 * the recorded verdicts under a corrected binarisation rather than re-running the
 * engine - verdicts are a function of the evidence and R1-R6, and v2.0 touches
 * neither. The script asserts its own v1.0 column reproduces `results/metrics.json`
 * exactly before it writes anything, so these two files cannot silently disagree
 * about the run they describe.
 *
 * SEPARATE FROM metrics.json ON PURPOSE. metrics.json is not regenerable: the
 * harness hard-fails unless the bundled ruleset hashes to the pre-registered v1.0
 * value, and the labels come from a Python ingest that reads v1.0 too. So the
 * shipped figures stay v1.0 and say so, and the corrected ones are rendered beside
 * them from here.
 *
 * POPULATION IS PART OF EVERY FIGURE'S IDENTITY, which is why it is a level of the
 * document rather than a suffix on a field name. The conflict subset is n=61 and
 * the full scored split is n=267; a balanced accuracy quoted without one of those
 * two words attached is not a number anyone can check.
 */
import { RAW } from "./bundle.js";

export interface RescorePipeline {
  pipeline: string;
  balancedAccuracy: number;
  /** null where one class is absent from the committed set: half the figure is
   *  then a substituted 0.5 rather than an estimate, and a substitution has no
   *  interval. */
  balancedAccuracyCi: { lo: number; hi: number } | null;
  rawAccuracyCi: { lo: number; hi: number } | null;
  coverage: number;
  nCommitted: number;
  confusion: { tp: number; fp: number; tn: number; fn: number };
  singleClass: boolean;
}

export interface RescorePopulation {
  population: "conflictSubset" | "fullSplit";
  n: number;
  positiveRate: number;
  pipelines: RescorePipeline[];
}

export interface RescoreTarget {
  version: "1.0" | "2.0";
  label: string;
  superseded: boolean;
  positive: string[];
  negative: string[];
  populations: RescorePopulation[];
}

export interface RescoreDocument {
  generatedBy: string;
  driftGuard: string;
  qsarCaveat: string;
  targets: RescoreTarget[];
}

export function loadRescore(): RescoreDocument {
  return RAW.rescore as RescoreDocument;
}

export function populationAt(
  doc: RescoreDocument,
  version: "1.0" | "2.0",
  population: "conflictSubset" | "fullSplit",
): RescorePopulation | undefined {
  return doc.targets
    .find((t) => t.version === version)
    ?.populations.find((p) => p.population === population);
}

export function pipelineAt(
  doc: RescoreDocument,
  version: "1.0" | "2.0",
  population: "conflictSubset" | "fullSplit",
  pipeline: string,
): RescorePipeline | undefined {
  return populationAt(doc, version, population)?.pipelines.find((x) => x.pipeline === pipeline);
}

/**
 * The best figure any pipeline reached in one target/population cell.
 *
 * Derived rather than named, because "no pipeline clears 0.601" is a claim about
 * the whole column: naming the winner in prose would leave the sentence asserting
 * a ceiling that a later re-grade had already moved.
 */
export function bestPipeline(pop: RescorePopulation): RescorePipeline | undefined {
  return pop.pipelines.reduce<RescorePipeline | undefined>(
    (best, p) => (best === undefined || p.balancedAccuracy > best.balancedAccuracy ? p : best),
    undefined,
  );
}
