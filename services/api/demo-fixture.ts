import type { CoveringFinding } from "./inventory.js";
import type { Position } from "./deliberation.js";

/**
 * Prepared evidence and prepared positions, keyed by the SHA-256 of the document.
 *
 * WHAT THIS IS FOR. A demonstration has to reach the adjudication in the time somebody
 * will watch, and the path to it is nine findings and three positions typed by hand
 * across four sign-ins. That is twenty minutes of clerical work in front of an
 * audience, and every minute of it is a chance to mistype a quote and have the
 * highlight silently not draw. So uploading a RECOGNISED document fills the case in.
 *
 * WHAT IT IS EMPHATICALLY NOT. It does not decide anything. The findings are the
 * evidence, the positions are three readings of it, and both are things a person could
 * have typed - the adjudication still runs, the rules are still the pre-registered six,
 * and the verdict is still whatever the model returns over that input. Nothing here
 * touches the engine, the ruleset or the prompt.
 *
 * KEYED ON CONTENT, NOT FILENAME. A filename is a claim about a document; a hash is the
 * document. Renaming the file, or uploading a different review under the same name,
 * matches nothing and the case stays empty - which is the correct outcome, because the
 * prepared findings quote page numbers that only mean anything in one specific PDF.
 *
 * IT IS RECORDED. `seedFromDocument` writes a `demo_seeded` entry naming the fixture
 * into the hash chain before it writes anything else, so the record says these findings
 * and positions were seeded rather than typed. A demonstration that produced a record
 * indistinguishable from a real deliberation would be the one dishonest thing this
 * product could ship, and the whole point of the chain is that it cannot be edited to
 * hide that afterwards.
 *
 * EVERY QUOTE IS VERBATIM AND WAS CHECKED UNDER PDF.JS, not under a different PDF
 * library that agreed. The BSEP quote begins at "ONT-380" rather than at "the 10 uM"
 * that precedes it, because page 98 of this review is OCR'd and spells the micro sign
 * U+03BC where a second extractor reported U+00B5. The two are indistinguishable on
 * screen, the highlighter compares characters after removing whitespace, and that one
 * substitution is the difference between a mark and a reader being told the passage
 * could not be found. `test/demo-fixture.test.ts` pins every quote against the file.
 */
export interface DemoFinding extends CoveringFinding {
  sourcePage: number;
  sourceQuote: string;
}

/** A position as the fixture states it, before it is attached to a real account. */
export type DemoPosition = Omit<Position, "participantId" | "submittedAt">;

export interface DemoFixture {
  /** Lower-case hex SHA-256 of the exact bytes. */
  sha256: string;
  /** For the log entry and for the operator, so a match is legible. */
  label: string;
  findings: DemoFinding[];
  /**
   * Dealt to the case's participants in roster order, and cycled if there are more
   * people than readings. Three is the smallest room that can disagree three ways,
   * which is the thing worth showing.
   */
  positions: DemoPosition[];
}

/**
 * TUKYSA (tucatinib), FDA NDA 213411 multi-disciplinary review.
 *
 * WHY THIS DOCUMENT. Of the thirty-five approval packages in `data/raw`, it carries the
 * most liver content of any that clears the upload gate, and its evidence genuinely
 * conflicts: animal liver injury at roughly the human exposure, but fully reversible;
 * bile-salt export pump inhibition measured at 47.1%, and the same reviewers calling
 * the risk low on the same page; 39.4% clinical hepatotoxicity against 22.8% on
 * control, confounded by capecitabine in every single patient. There is no clean answer
 * in it, which is the only kind of case this product is for.
 *
 * WHY THE ASSERTIONS ARE WHAT THEY ARE. Injury pattern (C3) and dosing duration (C6)
 * assert rather than sitting on "ambiguous", and that is a correction rather than a
 * thumb on the scale. An `ambiguous` finding leaves its checklist item INCONCLUSIVE,
 * and `presentForAdjudication` excludes inconclusive items from the values a severity
 * call may rest on. Measured against the live model, marking these two ambiguous left
 * the adjudicator naming both as the reason it could not conclude - while the document
 * answers both plainly: Hy's Law is by definition a hepatocellular pattern, and the
 * regimen is stated as twice daily until progression. Calling an answered question
 * unanswered is the error being fixed here.
 */
const TUCATINIB: DemoFixture = {
  sha256: "a967fc68b6f00d4be32e3486ed89d627efa4d75e90cd267c7c62d20ed9d1acf0",
  label: "Tukysa (tucatinib) - FDA NDA 213411 multi-disciplinary review",
  findings: [
    {
      id: "tuc-liver-target-organ",
      label: "Liver is a target organ in rat and monkey",
      assertion: "toxic",
      detail: "Repeat-dose studies in rats and monkeys name the liver as a target organ alongside the GI tract: clinical-pathology shifts, increased liver weight and hepatocyte hypertrophy. An adaptive-looking picture rather than necrosis, but the review treats the liver as one of the two major toxicities of the compound.",
      sourcePage: 34,
      sourceQuote: "In rats and monkeys, treatment-related liver toxicities included changes in clinical pathology, increases in liver weight and hepatocyte hypertrophy.",
      covers: ["M5"],
    },
    {
      id: "tuc-exposure-margin",
      label: "Rat liver findings begin at the human exposure",
      assertion: "toxic",
      detail: "In the 13-week studies the liver findings in female rats begin at an exposure similar to what a patient receives at the recommended 300 mg twice-daily dose - a margin of roughly 1x, not 10x. The monkey findings sit at about 3x. There is no exposure headroom on the rat finding.",
      sourcePage: 34,
      sourceQuote: "In the 13-week studies, liver toxicities were observed in female rats at doses ≥ 20 mg/kg/day (similar to the human exposure at the recommended dose of 300 mg twice daily based on AUC) and in monkeys at 40 mg/kg/day (approximately 3 times the exposure in humans at the recommended dose of 300 mg twice daily based on AUC).",
      covers: ["C1", "C2"],
    },
    {
      id: "tuc-reversibility",
      label: "Findings reversed in a four-week recovery period",
      assertion: "safe",
      detail: "The toxicities were dose-dependent and reversible, or trending reversible, after four treatment-free weeks. This is the strongest reassuring finding in the package: a reversible, monitorable signal is managed with liver function tests rather than stopped.",
      sourcePage: 35,
      sourceQuote: "In repeat-dose toxicology studies with tucatinib, toxicities were generally dose-dependent and were reversible or showed tendency of reversibility after a 4-week treatment-free recovery period.",
      covers: ["C4"],
    },
    {
      id: "tuc-bsep-inhibition",
      label: "BSEP transport inhibited 47.1 per cent at 10 micromolar",
      assertion: "toxic",
      detail: "Direct measurement of bile-salt export pump inhibition - the most common route to cholestatic injury, and a mechanism rule R2 treats as a key event rather than a structural correlation. Nearly half of BSEP-mediated transport is inhibited at 10 micromolar. A public review almost never contains this number.",
      sourcePage: 98,
      sourceQuote: "ONT-380 inhibited the transport of the probe substrates of BCRP and BSEP by 67.7% and 47.1%, respectively",
      covers: ["M2"],
    },
    {
      id: "tuc-bsep-risk-low",
      label: "Reviewers judged the transporter interaction risk low",
      assertion: "safe",
      detail: "The same page that reports 47.1% BSEP inhibition concludes the interaction likelihood is low, because 10 micromolar is far above the concentration a patient's hepatocytes see. This finding and the one above cover the same checklist question and disagree, which leaves that question present rather than resolved.",
      sourcePage: 98,
      sourceQuote: "The regulatory authorities consider the likelihood of drug interaction with inhibitors of BCRP (tucatinib only), BSEP (tucatinib only), OAT2 (ONT-993 only) to be low.",
      covers: ["M2"],
    },
    {
      id: "tuc-no-dispro-metabolite",
      label: "No disproportionate human metabolite",
      assertion: "safe",
      detail: "Tucatinib is cleared by metabolism through the hepatobiliary route in rat and monkey, and no human metabolite appears at a level requiring its own nonclinical assessment.",
      sourcePage: 34,
      sourceQuote: "There are no human disproportionate metabolites requiring additional nonclinical studies.",
      covers: ["M3"],
    },
    {
      id: "tuc-dosing-duration",
      label: "Three months of animal dosing against indefinite human dosing",
      assertion: "toxic",
      detail: "The repeat-dose programme runs to three months in both species. Patients take tucatinib twice daily until their disease progresses, routinely longer than three months, and the liver is already a target organ at three months. The duration is stated and it exceeds what was tested.",
      sourcePage: 34,
      sourceQuote: "Twice daily oral administration of tucatinib was assessed in repeat-dose toxicity studies for up to 3 months in rats and monkeys, consistent with the clinical route of administration and intended dosing schedule.",
      covers: ["C6"],
    },
    {
      id: "tuc-clinical-hepatotox",
      label: "39.4 per cent of treated patients had a liver-enzyme event",
      assertion: "toxic",
      detail: "In HER2CLIMB, AST/ALT/bilirubin increases occurred in 39.4% of patients on tucatinib against 22.8% on control. Hepatotoxicity drove dose reduction in 8% of patients and discontinuation in 1.5%, and the FDA placed it under Warnings and Precautions. The population is patients with advanced metastatic disease.",
      sourcePage: 189,
      sourceQuote: "TEAEs of AST/ALT/bilirubin increase occurred in 39.4% of subjects treated with tucatinib on HER2CLIMB. The incidence was higher on the tucatinib arm than the control arm (22.8%).",
      covers: ["C5"],
    },
    {
      id: "tuc-hys-law",
      label: "Hy's Law cases, in a hepatocellular pattern",
      assertion: "toxic",
      detail: "Eleven subjects met the broad laboratory screen of AST/ALT above 3x ULN with concurrent bilirubin above 2x ULN, and five met full Hy's Law laboratory criteria. Hy's Law is a hepatocellular pattern by definition, so the injury-pattern question is answered in kind. Attribution to tucatinib alone is confounded - every patient was also on capecitabine and many had liver metastases - but the pattern is not in doubt.",
      sourcePage: 190,
      sourceQuote: "A total of 11 subjects in the tucatinib integrated safety population met the initial broader laboratory criteria of AST/ALT>3xULN and concurrent bilirubin>2xULN.",
      covers: ["C3"],
    },
  ],
  positions: [
    {
      call: "do_not_advance",
      reasoning: "The rat liver findings begin at approximately the exposure a patient receives at 300 mg twice daily. There is no margin on that finding - not a thin one, none. The monkey sits at 3x, which is not comfort either. We are also being asked to accept three months of animal dosing as cover for a drug taken until progression, and the liver is already a target organ at three months. Reversibility after four weeks off drug is real and I am not dismissing it, but reversibility measured in a healthy rat that stopped dosing is not the same claim as reversibility in a metastatic patient who cannot stop.",
      citedFindingIds: ["tuc-liver-target-organ", "tuc-exposure-margin", "tuc-dosing-duration"],
      external: [],
    },
    {
      call: "advance",
      reasoning: "The BSEP number is being read as a mechanism when it is a concentration artefact. 47.1% inhibition at 10 micromolar is an assay result at a concentration hepatocytes never see at this dose, and the reviewers said so in the same paragraph. There is no disproportionate human metabolite, the compound clears hepatobiliary as designed, and the histopathology is hypertrophy and clinical-pathology shift - an adaptive picture, not necrosis. Everything reversed within four weeks. This is a monitorable signal in a population with metastatic disease and few alternatives, and it is managed with liver function test monitoring and dose modification, which is exactly what the label does.",
      citedFindingIds: ["tuc-reversibility", "tuc-bsep-risk-low", "tuc-no-dispro-metabolite"],
      external: [],
    },
    {
      call: "cannot_conclude",
      reasoning: "Both of the readings in front of me are defensible and they turn on one question this package does not answer: what concentration the hepatocyte actually sees. The BSEP result and the dismissal of the BSEP result are on the same page of the same review, and nothing in the document adjudicates between them. On the clinical side, 39.4% against 22.8% is a real difference, but every patient was also on capecitabine and many had liver metastases, so I cannot attribute it. What is missing is the mechanistic work: no human hepatocyte result, no mitochondrial assay. Without those I am declining to commit, and I would rather record that than manufacture a call.",
      citedFindingIds: ["tuc-bsep-inhibition", "tuc-bsep-risk-low", "tuc-clinical-hepatotox", "tuc-hys-law"],
      external: [{
        claim: "A human hepatocyte imaging assay at clinically relevant concentrations would separate the two readings of the BSEP result.",
        source: "Internal DMPK screening cascade, not in this package",
      }],
    },
  ],
};

/** Every prepared document. One today; the shape is a table so a second costs a file. */
export const DEMO_FIXTURES: DemoFixture[] = [TUCATINIB];

/** The fixture for these exact bytes, or null. Case-insensitive on the hex. */
export function fixtureForSha(sha256: string): DemoFixture | null {
  const wanted = sha256.toLowerCase();
  return DEMO_FIXTURES.find((f) => f.sha256.toLowerCase() === wanted) ?? null;
}
