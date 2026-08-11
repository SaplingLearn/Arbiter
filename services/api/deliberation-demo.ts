import { readFileSync } from "node:fs";
import { DeliberationService } from "./deliberation-service.js";
import { MemoryStore, commitmentFor, verifySeals } from "./store.js";
import { disagreementReport, positionBasis, type Position } from "./deliberation.js";
import type { EvidenceChecklist } from "./inventory.js";
import { CATALOGUE, isCaseName, loadCase, refusalFor, type CaseName } from "./cases.js";
import { handleAdjudicate } from "./adjudicate.js";
import { completeFromEnv } from "./interpret.js";
import { stubComplete } from "./probe.js";

/**
 * A full blind deliberation, played end to end on real evidence.
 *
 * FIVE CASES, THREE THAT RUN AND TWO THAT REFUSE:
 *
 *   npm run deliberate:demo                 TAK-994 - thin package, room agreed
 *   npm run deliberate:demo nipocalimab     rich package, room splits three ways
 *   npm run deliberate:demo slynd           a 505(b)(2) with almost nothing to cite
 *   npm run deliberate:demo tolcapone       REFUSED - scanned images, no text
 *   npm run deliberate:demo troglitazone    REFUSED - labelling supplement, no review
 *
 * The shapes are deliberately different. A demo that only ever ran TAK-994 would be
 * showing that the tool can find gaps, which is the easy half. The two refusals are
 * listed rather than hidden because two of four collected documents being unusable
 * IS the finding (HANDOVER §13.3), and because a refusal you can route around is
 * decorative.
 *
 * WHY THIS EXISTS. Every part of §6 except the adjudication sentence is deterministic
 * code, so the whole mechanism can be demonstrated, and audited, before an API key
 * exists. Run it and you can watch a position get sealed, watch another participant
 * be unable to see it, watch the reveal, and watch the log catch an edit.
 *
 * THE BEAT IT IS BUILT AROUND. Four scientists look at TAK-994's nonclinical package
 * and all four say advance. That is what really happened. The system agrees that
 * nobody disagreed and then says the thing nobody in the room said: the entire
 * consequence half of the checklist is empty, so the agreement is about an untested
 * question. A tool that only reconciled disagreement would have sailed straight
 * through this case, because there was no disagreement in it.
 *
 * The adjudication step is the only part that needs a model. With no key it runs
 * against `stubComplete` and is labelled as a stub everywhere it appears - a stub
 * answer is worthless as a result, and the labelling is what stops it being quoted
 * as one.
 */

const OWNER = "r.okafor (programme lead)";

/** Fixed, because a demo whose output changes run to run cannot be diffed. */
const T = (n: number): string => `2026-08-09T${String(9 + n).padStart(2, "0")}:00:00Z`;

const bar = (t: string): string => `
${"=".repeat(78)}
${t}
${"=".repeat(78)}`;

/**
 * Four positions. Every one is a real reading of the evidence in the case, and
 * between them they exercise all three citation states (§6.5).
 *
 * Nobody here is a strawman. The unsupported position is the one a real programme
 * produces - an experienced person whose read is correct often enough that nobody
 * asks what it rests on - and the point is not that it is wrong. It is that after
 * the reveal, the person signing can see it rests on nothing, and can still choose
 * to follow it.
 */
/** Only the runnable cases have panels. `Partial` rather than `Record`, because a
 *  refused document has no case to hold positions about, and inventing four
 *  opinions about a document nobody can read would be the exact fabrication the
 *  refusal exists to prevent. */
const POSITIONS: Partial<Record<CaseName, Position[]>> = {
  tak994: [
  {
    participantId: "a.silva (tox)",
    call: "advance",
    reasoning: "The two human assays are the ones that matter for a human hepatotoxicity question, and both are clean. Rule R1 puts human-cell evidence above the animal work, and here they agree anyway.",
    citedFindingIds: ["TAK-994:cytotox", "TAK-994:transporter"],
    external: [],
    submittedAt: T(1),
  },
  {
    participantId: "b.mehta (dmpk)",
    call: "advance",
    reasoning: "Repeat-dose in rodent and non-rodent are both clean at Klimisch 1. The murine transcriptomic signal is CYP induction, which is a metabolic-liability finding, not liver injury.",
    citedFindingIds: ["TAK-994:invivo_rodent", "TAK-994:invivo_nonrodent", "TAK-994:toxicogenomics-murine"],
    external: [],
    submittedAt: T(2),
  },
  {
    participantId: "c.lindqvist (clinical)",
    call: "advance",
    reasoning: "The QSAR flag is the only structural concern and this chemotype has been benign in the two programmes I have run. I would not hold the programme on an in-silico ambiguity.",
    citedFindingIds: [],
    external: [{ claim: "This chemotype was benign for hepatic endpoints in two prior programmes.", source: "Internal programme experience, unpublished." }],
    submittedAt: T(3),
  },
  {
    participantId: "d.abara (project)",
    call: "advance",
    reasoning: "Package looks complete to me and the team is aligned. No reason to hold.",
    citedFindingIds: [],
    external: [],
    submittedAt: T(4),
  },
  ],

  /**
   * Nipocalimab: a room that does NOT agree, which is the ordinary case and the one
   * TAK-994 cannot demonstrate. The split is real and it is in the document - the
   * applicant claimed a 44x margin, the assessor rejected the NOAEL it rested on and
   * lowered the margin to 6.7x on Cmax. Rule R3 turns on which of those you accept.
   */
  nipocalimab: [
    {
      participantId: "a.silva (tox)",
      call: "advance",
      reasoning: "The NOAEL was set on the absence of clinically relevant serum chemistry and histology changes, and both pivotal studies carried recovery phases of 8 and 9 weeks with IgG returning to baseline. For a liver question that is the shape you want.",
      citedFindingIds: ["IMA:repeat-dose-chemistry", "IMA:reversibility"],
      external: [],
      submittedAt: T(1),
    },
    {
      participantId: "b.mehta (dmpk)",
      call: "cannot_conclude",
      reasoning: "We are being asked to accept two different margins from one document. The applicant proposed 44x; the assessor did not support that NOAEL and lowered it to 100 mg/kg, giving 10.8x on AUC and 6.7x on Cmax. R3 turns entirely on which one we are standing behind, and nobody has said which.",
      citedFindingIds: ["IMA:margin-applicant", "IMA:margin-chmp"],
      external: [],
      submittedAt: T(2),
    },
    {
      participantId: "c.lindqvist (clinical)",
      call: "do_not_advance",
      reasoning: "There are mononuclear cell infiltrates in the liver at every dose down to 20 mg/kg. I accept the argument that foreign biologics raise the background rate in monkeys, but it is an argument, not a measurement, and there is no human-cell work and no characterisation of what an injury would look like if it happened.",
      citedFindingIds: ["IMA:liver-mononuclear-infiltrates"],
      external: [],
      submittedAt: T(3),
    },
    {
      participantId: "d.abara (project)",
      call: "advance",
      reasoning: "Anti-FcRn antibodies have been through this discussion before and the liver has never been the issue for the class. The infiltrate finding reads as background to me.",
      citedFindingIds: [],
      external: [{ claim: "Hepatic findings have not been class-limiting for anti-FcRn antibodies.", source: "Comparator programmes named in the report (efgartigimod, rozanolixizumab); not assessed for liver endpoints in this document." }],
      submittedAt: T(4),
    },
  ],

  /**
   * Slynd: the case where there is almost nothing to cite, which is what spec §6.5
   * needs in order to be tested at all. Three of these four positions cannot rest on
   * a finding because the package contains none - and the three states they land in
   * are exactly the point.
   */
  /**
   * Turalio: the most complete package, and the one where the numbers point the wrong
   * way. Rat liver injury begins at about 0.6x the exposure a patient receives, so
   * rule R3's usual question - was the clean result run at a relevant exposure? -
   * inverts: the POSITIVE result was found below the clinical range.
   *
   * The real drug was approved with a boxed warning and a REMS. Nobody here is
   * arguing it should not have been; they are arguing about what has to be true for
   * that to be the right call.
   */
  turalio: [
    {
      participantId: "a.silva (tox)",
      call: "do_not_advance",
      reasoning: "Necrotizing inflammation and raised AST and ALT in rat liver starting at 0.6 times the clinical exposure. I have never seen an argument for advancing where the animal injury begins below the human dose, and the dog study topped out at 0.3 times, so the second species never tested the range at all.",
      citedFindingIds: ["TUR:liver-histopathology", "TUR:exposure-margin"],
      external: [],
      submittedAt: T(1),
    },
    {
      participantId: "b.mehta (dmpk)",
      call: "cannot_conclude",
      reasoning: "The most abundant human metabolite was never toxicologically evaluated, and it runs at least 60-fold above parent in monkey. The liver signal we are arguing about may not even be the parent compound's. That is answerable, and until it is answered I do not know what we are weighing.",
      citedFindingIds: ["TUR:metabolite-unassessed"],
      external: [],
      submittedAt: T(2),
    },
    {
      participantId: "c.lindqvist (clinical)",
      call: "advance",
      reasoning: "Mixed hepatocellular and biliary, and reversible in the recovery period bar the edema. This is a disabling tumour with no alternative, and a reversible transaminase signal with a defined pattern is monitorable. Advance with hepatic monitoring and a stopping rule, not unconditionally.",
      citedFindingIds: ["TUR:liver-histopathology", "TUR:reversibility", "TUR:dosing-duration"],
      external: [],
      submittedAt: T(3),
    },
    {
      participantId: "d.abara (project)",
      call: "advance",
      reasoning: "Genotox is clean and carcinogenicity is negative in both species. The programme has been through this and I think we are overreading a rat finding.",
      citedFindingIds: ["TUR:genotoxicity"],
      external: [],
      submittedAt: T(4),
    },
  ],

  slynd: [
    {
      participantId: "a.silva (tox)",
      call: "advance",
      reasoning: "The bridge is the argument and it is a legitimate one: exposure at or below an approved comparator, established by a comparative BA study. The Division did not ask for new nonclinical work and I am not going to invent a reason they should have.",
      citedFindingIds: ["SLY:scientific-bridge"],
      external: [],
      submittedAt: T(1),
    },
    {
      participantId: "b.mehta (dmpk)",
      call: "cannot_conclude",
      reasoning: "I cannot answer a liver question from this document. There is nothing in it that measured a liver endpoint - the answers, if they exist, are in NDA 21676, and that is not what we were handed.",
      citedFindingIds: [],
      external: [],
      submittedAt: T(2),
    },
    {
      participantId: "c.lindqvist (clinical)",
      call: "do_not_advance",
      reasoning: "Combined oral contraceptives have a known association with cholestasis and with hepatic adenoma on long exposure. This is chronic dosing in healthy women, which is the least forgiving setting there is.",
      citedFindingIds: [],
      external: [{ claim: "Combined oral contraceptives carry a recognised association with cholestasis and hepatic adenoma at long exposure.", source: "Class literature; not in this package." }],
      submittedAt: T(3),
    },
    {
      participantId: "d.abara (project)",
      call: "advance",
      reasoning: "This has been on the market as Yaz for years. I do not see the problem.",
      citedFindingIds: [],
      external: [],
      submittedAt: T(4),
    },
  ],
};

async function main(): Promise<void> {
  const arg = process.argv[2] ?? "tak994";
  if (!isCaseName(arg)) {
    console.error(`Unknown case "${arg}". Use one of: ${CATALOGUE.map((c) => c.name).join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  const refused = refusalFor(arg);
  if (refused !== null) {
    console.log(bar(`REFUSED - ${refused.label}`));
    console.log(`  Document   : ${refused.document}`);
    console.log(`  Splitter   : ${refused.splitterReason}`);
    console.log(`  Measured   : ${refused.measurement}`);
    console.log("\n  Listed rather than hidden. Two of the four documents collected cannot");
    console.log("  produce a case, and that ratio IS the finding - it is what killed the plan");
    console.log("  to replay the drugs withdrawn for hepatotoxicity (HANDOVER 13.3). A picker");
    console.log("  showing only what worked would imply every document works.\n");
    return;
  }

  const kase = loadCase(arg);
  const positions = POSITIONS[arg];
  if (positions === undefined) {
    console.error(`No panel is written for "${arg}".`);
    process.exitCode = 1;
    return;
  }
  const CASE_ID = kase.caseId;

  const checklist = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;
  const store = new MemoryStore();
  const svc = new DeliberationService(store, checklist);

  console.log(bar("ARBITER - blind deliberation, played end to end"));
  console.log(`Case      : ${kase.compoundLabel}`);
  console.log(`Context   : ${kase.context}`);
  console.log(`Modality  : ${kase.modality}`);
  console.log(`Evidence  : ${kase.provenance}`);
  console.log(`Owner     : ${OWNER}`);
  console.log(`Panel     : ${positions.map((p) => p.participantId).join(", ")}`);
  console.log(`Checklist : evidence-checklist v${checklist.version} (${checklist.items.length} questions)`);

  const { inventory } = svc.open({
    caseId: CASE_ID, compoundLabel: kase.compoundLabel, context: kase.context,
    ownerId: OWNER, participantIds: positions.map((p) => p.participantId),
    findings: kase.findings, modality: kase.modality, at: T(0),
  });

  // ---- 1. The inventory, before anybody speaks -----------------------------
  console.log(bar("1. THE INVENTORY, published to everyone before anybody answers"));
  if (kase.documentScope !== undefined) {
    console.log(`  ${kase.documentScope}
`);
  }
  console.log("Flat, unranked, no verdict. Ordered by checklist id and by nothing else,\n" +
    "because ordering gaps by severity would nudge the room before it has spoken.\n");
  const MARK: Record<string, string> = {
    present: "[present]      ", inconclusive: "[inconclusive] ",
    absent: "[ABSENT]       ", not_applicable: "[n/a]          ",
  };
  for (const e of inventory.entries) {
    console.log(`  ${MARK[e.state]} ${e.itemId}  ${e.field}`);
    if (e.findingIds.length > 0) console.log(`                        from: ${e.findingIds.join(", ")}`);
  }
  const count = (st: string): number => inventory.entries.filter((e) => e.state === st).length;
  console.log(`\n  present ${count("present")}  |  inconclusive ${count("inconclusive")}  |  ABSENT ${count("absent")}  |  not applicable ${count("not_applicable")}`);
  if (count("not_applicable") > 0) {
    console.log(`  ${count("not_applicable")} questions do not arise for a ${kase.modality.replace("_", " ")}, and are marked n/a rather`);
    console.log("  than missing. A monoclonal antibody is catabolised to amino acids, so it has no");
    console.log("  reactive metabolite; it does not inhibit hepatobiliary transporters; QSAR models");
    console.log("  are built for small molecules. Listing those as gaps is the same false alarm as");
    console.log("  flagging an approved BSEP inhibitor - it fills the missing list with items");
    console.log("  nobody can ever supply, which is how the real gaps stop being read.");
  } else if (kase.documentScope === undefined) {
    // Computed, not asserted. This line used to claim the mechanism half was
    // "largely answered", which was true of TAK-994 and false of every other case -
    // a narration that describes one fixture rather than the data in front of it.
    const gaps = (half: "mechanism" | "consequence"): number =>
      inventory.entries.filter((e) => e.state === "absent" && e.half === half).length;
    const total = (half: "mechanism" | "consequence"): number =>
      inventory.entries.filter((e) => e.half === half && e.state !== "not_applicable").length;
    console.log(`  Mechanism side: ${gaps("mechanism")} of ${total("mechanism")} unanswered. Consequence side: ${gaps("consequence")} of ${total("consequence")}.`);
    if (gaps("consequence") > gaps("mechanism")) {
      console.log("  The consequence half is the emptier one, which is the shape that produced");
      console.log("  the measured defect: a mechanism finding alone was allowed to say 'do not");
      console.log("  advance' about drugs that are approved and prescribed.");
    }
  }

  // ---- 2. The blind phase --------------------------------------------------
  console.log(bar("2. THE BLIND PHASE - positions are sealed as they arrive"));
  const submit = (p: Position): void => {
    const r = svc.submit(CASE_ID, p);
    if (!r.ok) throw new Error(`demo is wrong: ${r.error.detail}`);
    console.log(`  sealed  ${p.participantId.padEnd(24)} commitment ${commitmentFor(r.value.positions.at(-1)!).slice(0, 16)}…`);
  };

  // Deliberately paused halfway. The view below is taken while two people have
  // answered and two have not, because a view taken once everyone is in would
  // demonstrate nothing - the interesting question is what a participant can see
  // about colleagues who HAVE already submitted.
  submit(positions[0]!);
  submit(positions[1]!);

  console.log(`\n  Paused here. ${positions[0]!.participantId} has submitted; ${positions[2]!.participantId} and ${positions[3]!.participantId} have not.`);
  console.log(`  What ${positions[1]!.participantId} can see at this moment:`);
  const midView = svc.view(CASE_ID, positions[1]!.participantId)!;
  console.log(`    own       : ${midView.own?.call} - "${midView.own?.reasoning.slice(0, 52)}…"`);
  for (const o of midView.others) console.log(`    ${o.participantId.padEnd(26)}: ${o.submitted ? "submitted" : "not yet"}`);
  console.log(`    revealed  : ${midView.revealed === null ? "null - nothing of anyone else's position is returned at all" : "LEAK"}`);
  console.log("\n  Enforced by not returning the data, not by asking the screen to hide it.");
  console.log("  Not even a running tally of calls: a tally drags as hard as the positions do.");
  console.log(`  ${positions[0]!.participantId}'s answer is in the store and is not in that object.\n`);

  submit(positions[2]!);
  submit(positions[3]!);

  // ---- 3. Reveal -----------------------------------------------------------
  const revealed = svc.reveal(CASE_ID, OWNER, T(5), "all_in");
  if (!revealed.ok) throw new Error(revealed.error.detail);
  console.log(bar("3. REVEAL - everyone at once"));
  for (const p of revealed.value.positions) {
    console.log(`\n  ${p.participantId}  ->  ${p.call.toUpperCase()}   [basis: ${positionBasis(p)}]`);
    console.log(`    "${p.reasoning}"`);
    if (p.citedFindingIds.length > 0) console.log(`    cites: ${p.citedFindingIds.join(", ")}`);
    for (const e of p.external) console.log(`    external: "${e.claim}"${e.source === undefined ? "" : ` [${e.source}]`}`);
    if (positionBasis(p) === "unsupported") console.log("    cites nothing. Preserved, never deleted and never overruled - the signer can see it.");
  }

  // ---- 4. What the record says about itself --------------------------------
  const u = svc.unanimity(CASE_ID)!;
  const d = disagreementReport(revealed.value);
  console.log(bar(u.unanimous ? "4. UNANIMITY IS NOT CORRECTNESS" : "4. WHERE THE ROOM SPLIT, AND ON WHAT"));
  console.log("  No model ran to produce what follows. It is arithmetic over the record.\n");

  if (u.unanimous) {
    console.log(`  Unanimous: true   Shared call: ${u.call}\n`);
    for (const c of u.concerns) console.log(`  * ${c}\n`);
    console.log("  This is TAK-994. A room that agreed, a package that looked complete, and a");
    console.log("  gap nobody named. Hepatotoxicity appeared later, in humans.");
  } else if (d !== null) {
    for (const g of d.split) console.log(`  ${g.call.toUpperCase().padEnd(17)} ${g.participantIds.join(", ")}`);
    console.log("");
    if (d.contested.length > 0) {
      console.log("  Cited by more than one camp - the same evidence, read two ways:");
      for (const f of d.contested) console.log(`    ${f}`);
    }
    if (d.oneSided.length > 0) {
      console.log("  Cited by one camp only - evidence the other side did not answer:");
      for (const f of d.oneSided) console.log(`    ${f.findingId.padEnd(34)} (${f.call})`);
    }
    console.log("");
    if (d.contested.length > 0) {
      console.log(`  ${d.contested.length === 1 ? "That finding is" : "Those findings are"} what the room actually disagrees about - cited by camps that`);
      console.log("  reached opposite conclusions from it. Everything else on the list is evidence");
      console.log("  one side raised and the other did not answer. An adjudication starts here.");
      console.log("");
    }
    if (d.contested.length === 0) {
      console.log("  NOTHING IS CONTESTED, and that is the finding. Not one piece of evidence is");
      console.log("  cited by two camps - so this is not four people reading the same result two");
      console.log("  ways, it is four people looking at four different parts of the document and");
      console.log("  reporting what they saw. Spec 6.3 calls that talking past each other, and");
      console.log("  says it is usually most of a disagreement. Here it is all of it.");
      console.log("");
    }
    if (arg === "nipocalimab") {
      console.log("  The crux is in the document, not in the room: the applicant proposed a 44x");
      console.log("  margin, the assessor refused the NOAEL it rested on and lowered it to 6.7x on");
      console.log("  Cmax. Rule R3 turns on which of those stands, and no position says which one");
      console.log("  it is using. THAT is the question to settle, and it is answerable.");
    }
  }

  // ---- 5. Adjudication -----------------------------------------------------
  // "adjudication", not the default "short" - same reason as server.ts and probe.ts.
  const live = completeFromEnv(process.env, "adjudication");
  const req = svc.adjudicationRequest(CASE_ID, kase.rules)!;
  console.log(bar(`5. ADJUDICATION  [${live === null ? "STUB - NO API KEY - NOT A RESULT" : "LIVE MODEL"}]`));
  console.log(`  Gaps handed to the adjudicator: ${req.absent.length}`);
  console.log(`  ...of which came from a participant's external claim: ${req.absent.filter((a) => a.field.startsWith("External claim")).length}`);
  console.log("  The model is told the same gaps the humans read, plus every claim made from");
  console.log("  outside the documents. Uncited expertise arrives as an open question rather");
  console.log("  than being dropped.\n");

  const prompt = JSON.parse(readFileSync("prompts/adjudicator-v1.0.json", "utf8")) as { system: string[]; userTemplate: string[] };
  const res = await handleAdjudicate(req, live ?? stubComplete(req), prompt);
  console.log(`  handleAdjudicate -> ${res.status}${res.status === 200 ? " (shape legal AND every citation resolves)" : ""}`);
  if (res.status !== 200) {
    console.log(`  ${JSON.stringify(res.body)}`);
  } else {
    const a = res.body as { mechanism: { present: boolean; pathway: string | null }; consequence: { verdict: string; reasoning: string } };
    console.log(`\n  Mechanism  : ${a.mechanism.present ? "present" : "not established"}${a.mechanism.pathway === null ? "" : ` - ${a.mechanism.pathway}`}`);
    console.log(`  Consequence: ${a.consequence.verdict}`);
    console.log(`               ${a.consequence.reasoning}`);
  }
  if (live === null) {
    console.log(`\n  THE TWO LINES ABOVE CAME FROM A STUB AND SAY NOTHING ABOUT ${kase.compoundLabel.split(" ")[0]!}. The`);
    console.log("  stub is deliberately fixed, so it tells you the wiring works and nothing");
    console.log("  else. Sections 1-4, 6 and 7 are real: deterministic code over real evidence.");
  }

  svc.adjudicate(CASE_ID, res.body, T(6), live === null ? "stub" : "model");

  // ---- 6. Sign -------------------------------------------------------------
  const signed = svc.signOff(CASE_ID, {
    by: OWNER, at: T(7), agreesWithAdjudication: false,
    reason: arg === "tak994"
      ? "Holding for an exposure margin and a reactive-metabolite study before first-in-human. The panel was unanimous and I am overriding it; the four positions and this reason stay on the record."
      : "Proceeding on the assessor's NOAEL of 100 mg/kg, not the applicant's 300. That is the margin this decision rests on and it is now on the record as such. The hepatic infiltrate finding is accepted as background; c.lindqvist dissented, and that dissent stands.",
  });
  console.log(bar("6. ONE NAMED PERSON SIGNS"));
  if (signed.ok) {
    const s = signed.value.signature!;
    console.log(`  ${s.by} - ${s.agreesWithAdjudication ? "agreed with" : "OVERRODE"} the adjudication`);
    console.log(`  Reason: ${s.reason}`);
    console.log("\n  No quorum, no threshold, no consensus mechanism. A committee advises and one");
    console.log("  individual signs, and an override is always available - forbidding it would");
    console.log("  make the model the decider.");
  }

  // ---- 7. The audit --------------------------------------------------------
  const audit = svc.audit(CASE_ID);
  console.log(bar("7. THE AUDIT - what a sceptical participant can check for themselves"));
  console.log(`  Log entries : ${audit.entries.length}  (${audit.entries.map((e) => e.kind).join(" -> ")})`);
  console.log(`  Chain       : ${audit.chain.length === 0 ? "intact" : `${audit.chain.length} FAILURES`}`);
  console.log(`  Seals       : ${audit.seals.length === 0 ? "every revealed position matches what was sealed while the case was blind" : `${audit.seals.length} BROKEN`}`);

  const tampered = revealed.value.positions.map((p, i) =>
    i === 3 ? { ...p, call: "do_not_advance" as const, reasoning: "I always had concerns." } : p);
  const breaks = verifySeals(store.entries(CASE_ID), tampered);
  console.log("\n  Demonstration - rewrite one position after the fact and re-run the check:");
  for (const b of breaks) console.log(`    CAUGHT: ${b.detail}`);
  console.log("\n  What that proves: no position was edited after sealing. What it does NOT");
  console.log("  prove: that the server never read one early. No server-side scheme can, and");
  console.log("  claiming otherwise would be the more dangerous error.\n");
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
