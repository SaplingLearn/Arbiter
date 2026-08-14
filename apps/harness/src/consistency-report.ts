import { readFileSync, readdirSync } from "node:fs";
import {
  consistencyReport, currentPromptVersion, formatConsistencyReport,
  type AdjudicationSubset, type PromptRegistration,
} from "./consistency.js";

/**
 * The consistency probe's ANALYSIS half. Spec §7.1.
 *
 * Reads the raw runs services/api/probe.ts wrote and computes the report. Kept
 * separate so re-analysing costs no tokens, and so a change to how the flip rate
 * is computed never becomes a reason to call a model again - re-running is
 * precisely what the pass-mark discipline (rules/pass-marks-v1.0.json) forbids
 * doing casually.
 */

interface ProbeFile {
  source: "live" | "stub";
  model: string | null;
  promptVersion: string;
  promptHash: string;
  compoundLabel: string;
  runs: { ok: boolean; adjudication: unknown; error?: string }[];
}

function main(): void {
  const path = process.env["PROBE_OUT"] ?? "results/probe-runs.json";
  const file = JSON.parse(readFileSync(path, "utf8")) as ProbeFile;
  const passMarks = JSON.parse(readFileSync("rules/pass-marks-v1.0.json", "utf8"));
  const maxFlip = passMarks.consistency.maxFlipRate as number;
  const minRule = passMarks.ruleStability.minAgreement as number;

  // Only verified runs enter the report. An unverified run is a different failure -
  // the model cited something that does not exist - and folding it into the flip
  // rate would conflate "changes its mind" with "makes things up". Both are
  // reported; they are not the same number.
  const usable = file.runs.filter((r) => r.ok).map((r) => r.adjudication as AdjudicationSubset);
  const report = consistencyReport(usable);

  console.log(`compound        ${file.compoundLabel}`);
  console.log(`source          ${file.source}${file.model === null ? "" : ` (${file.model})`}`);
  console.log(`prompt          v${file.promptVersion} ${file.promptHash.slice(0, 12)}`);
  console.log(`runs verified   ${usable.length}/${file.runs.length}`);

  // WHICH PROMPT DID THIS MEASURE? The flip rate belongs to the prompt it was run
  // under. Both prompt revisions in prompts/ state outright that no result measured
  // under an earlier version is reported under theirs, so a probe left behind by a
  // superseded prompt is a stale number wearing a current label - the same defect
  // as an accuracy figure graded under a retired target, which is the one this
  // project already had to correct in public.
  const registered = readdirSync("prompts")
    .filter((f) => f.startsWith("adjudicator-v") && f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(`prompts/${f}`, "utf8")) as PromptRegistration);
  const current = currentPromptVersion(registered);
  if (current === null) {
    console.log(`PROMPT CHAIN    unresolved: ${registered.length} registrations, no single head.`);
    console.log(`                Fix the supersedes chain before quoting this figure.`);
  } else if (current !== file.promptVersion) {
    console.log("");
    console.log(`STALE PROBE     measured under prompt v${file.promptVersion}, but v${current} is in force.`);
    console.log(`                This figure does not describe the shipped adjudicator. Re-run the`);
    console.log(`                probe under v${current}, or quote it as a v${file.promptVersion} result and say so.`);
    console.log(`                Do NOT report it as the current consistency number.`);
  }
  const unverified = file.runs.length - usable.length;
  if (unverified > 0) {
    console.log(`UNVERIFIED      ${unverified} run(s) cited something that does not exist, or errored.`);
    console.log(`                Reported separately from the flip rate on purpose: making things up`);
    console.log(`                and changing its mind are different failures.`);
  }
  console.log("");
  for (const line of formatConsistencyReport(report, maxFlip)) console.log(line);

  const worst = report.ruleStability[0];
  if (worst !== undefined && worst.agreement < minRule) {
    console.log("");
    console.log(`RULE STABILITY FAIL - ${worst.ruleId} at ${(worst.agreement * 100).toFixed(1)}% `
      + `is below the pre-committed ${(minRule * 100).toFixed(1)}%.`);
    console.log("A stable verdict over shuffling reasoning is not a pass: the reasoning is what");
    console.log("a reviewer signs, and it is not reproducible.");
  }

  if (file.source === "stub") {
    console.log("");
    console.log("THIS IS A STUB RUN AND IS NOT A RESULT. No model was called. The stub is");
    console.log("perfectly stable by construction, so a 0% flip rate here measures this");
    console.log("harness and says nothing whatever about an AI. Set ANTHROPIC_API_KEY.");
  }
}

main();
