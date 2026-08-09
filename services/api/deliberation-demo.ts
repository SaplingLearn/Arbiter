import { readFileSync } from "node:fs";
import { DeliberationService } from "./deliberation-service.js";
import { MemoryStore, commitmentFor, verifySeals } from "./store.js";
import { positionBasis, type Position } from "./deliberation.js";
import type { CoveringFinding, EvidenceChecklist } from "./inventory.js";
import { handleAdjudicate } from "./adjudicate.js";
import { completeFromEnv } from "./interpret.js";
import { stubComplete } from "./probe.js";
import type { AdjudicateRequest } from "./adjudicate.js";

/**
 * A full blind deliberation, played end to end on the real TAK-994 evidence.
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

const CASE_ID = "demo-tak994";
const OWNER = "r.okafor (programme lead)";

/** Fixed, because a demo whose output changes run to run cannot be diffed. */
const T = (n: number): string => `2026-08-09T${String(9 + n).padStart(2, "0")}:00:00Z`;

interface ProbeCase {
  compoundLabel: string;
  context: string;
  rules: AdjudicateRequest["rules"];
  findings: { id: string; label: string; assertion: "toxic" | "safe" | "ambiguous"; detail: string }[];
}

const bar = (s: string): string => `\n${"=".repeat(78)}\n${s}\n${"=".repeat(78)}`;

function loadFindings(): { findings: CoveringFinding[]; probe: ProbeCase } {
  const probe = JSON.parse(readFileSync("data/probe-case.json", "utf8")) as ProbeCase;
  const cov = JSON.parse(readFileSync("data/probe-case-coverage.json", "utf8")) as {
    checklistVersion: string; coverage: Record<string, string[]>;
  };
  return {
    probe,
    findings: probe.findings.map((f) => ({ ...f, covers: cov.coverage[f.id] ?? [] })),
  };
}

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
const POSITIONS: Position[] = [
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
];

async function main(): Promise<void> {
  const checklist = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;
  const { findings, probe } = loadFindings();
  const store = new MemoryStore();
  const svc = new DeliberationService(store, checklist);

  console.log(bar("ARBITER - blind deliberation, played end to end"));
  console.log(`Case      : ${probe.compoundLabel}`);
  console.log(`Context   : ${probe.context}`);
  console.log(`Owner     : ${OWNER}`);
  console.log(`Panel     : ${POSITIONS.map((p) => p.participantId).join(", ")}`);
  console.log(`Checklist : evidence-checklist v${checklist.version} (${checklist.items.length} questions)`);

  const { inventory } = svc.open({
    caseId: CASE_ID, compoundLabel: probe.compoundLabel, context: probe.context,
    ownerId: OWNER, participantIds: POSITIONS.map((p) => p.participantId),
    findings, at: T(0),
  });

  // ---- 1. The inventory, before anybody speaks -----------------------------
  console.log(bar("1. THE INVENTORY, published to everyone before anybody answers"));
  console.log("Flat, unranked, no verdict. Ordered by checklist id and by nothing else,\n" +
    "because ordering gaps by severity would nudge the room before it has spoken.\n");
  for (const e of inventory.entries) {
    const mark = e.state === "present" ? "[present]     " : e.state === "inconclusive" ? "[inconclusive]" : "[ABSENT]      ";
    console.log(`  ${mark} ${e.itemId}  ${e.field}`);
    if (e.findingIds.length > 0) console.log(`                       from: ${e.findingIds.join(", ")}`);
  }
  const absentCount = inventory.entries.filter((e) => e.state === "absent").length;
  const mechAbsent = inventory.entries.filter((e) => e.state === "absent" && e.half === "mechanism").length;
  console.log(`\n  ${absentCount} of ${inventory.entries.length} questions unanswered - ${mechAbsent} on the mechanism side, ${absentCount - mechAbsent} on the consequence side.`);
  console.log("  That shape is the whole finding. The mechanism half of this package is largely");
  console.log("  answered and the consequence half is empty, which is why 'is there a route to");
  console.log("  liver injury' and 'is it severe enough to stop' had to become two questions.");

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
  submit(POSITIONS[0]!);
  submit(POSITIONS[1]!);

  console.log("\n  Paused here. a.silva has submitted; c.lindqvist and d.abara have not.");
  console.log("  What b.mehta can see at this moment:");
  const midView = svc.view(CASE_ID, "b.mehta (dmpk)")!;
  console.log(`    own       : ${midView.own?.call} - "${midView.own?.reasoning.slice(0, 52)}…"`);
  for (const o of midView.others) console.log(`    ${o.participantId.padEnd(26)}: ${o.submitted ? "submitted" : "not yet"}`);
  console.log(`    revealed  : ${midView.revealed === null ? "null - nothing of anyone else's position is returned at all" : "LEAK"}`);
  console.log("\n  Enforced by not returning the data, not by asking the screen to hide it.");
  console.log("  Not even a running tally of calls: a tally drags as hard as the positions do.");
  console.log("  a.silva's answer is in the store and is not in that object.\n");

  submit(POSITIONS[2]!);
  submit(POSITIONS[3]!);

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

  // ---- 4. The beat ---------------------------------------------------------
  const u = svc.unanimity(CASE_ID)!;
  console.log(bar("4. UNANIMITY IS NOT CORRECTNESS"));
  console.log(`  Unanimous: ${u.unanimous}   Shared call: ${u.call}`);
  console.log("  No model ran to produce what follows. It is a fact about the record.\n");
  for (const c of u.concerns) console.log(`  * ${c}\n`);
  console.log("  This is TAK-994. A room that agreed, a package that looked complete, and a");
  console.log("  gap nobody named. Hepatotoxicity appeared later, in humans.");

  // ---- 5. Adjudication -----------------------------------------------------
  const live = completeFromEnv();
  const req = svc.adjudicationRequest(CASE_ID, probe.rules)!;
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
    console.log("\n  THE TWO LINES ABOVE CAME FROM A STUB AND MEAN NOTHING ABOUT TAK-994. The");
    console.log("  stub is deliberately fixed, so it tells you the wiring works and nothing");
    console.log("  else. Sections 1-4, 6 and 7 are real: deterministic code over real evidence.");
  }

  svc.adjudicate(CASE_ID, res.body, T(6), live === null ? "stub" : "model");

  // ---- 6. Sign -------------------------------------------------------------
  const signed = svc.signOff(CASE_ID, {
    by: OWNER, at: T(7), agreesWithAdjudication: false,
    reason: "Holding for an exposure margin and a reactive-metabolite study before first-in-human. The panel was unanimous and I am overriding it; the four positions and this reason stay on the record.",
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
