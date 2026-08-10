import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { completeFromEnv, DEFAULT_MODEL, type Complete } from "./interpret.js";
import { adjudicationSchema, userPrompt, verifyAdjudication, type AdjudicateRequest } from "./adjudicate.js";

/**
 * The consistency probe's COLLECTION half. Spec §7.1.
 *
 * Split from the analysis half on purpose. This file spends tokens and writes raw
 * runs to disk; apps/harness/src/consistency-report.ts reads that file and computes
 * the report. Re-analysing therefore costs nothing, and a change to how the flip
 * rate is computed never requires re-running a model - which matters because
 * re-running is exactly what the pass-mark discipline forbids doing casually.
 *
 * It also means the raw runs survive as evidence. A reported flip rate whose
 * underlying answers were thrown away is an assertion, not a measurement.
 *
 * WITH NO KEY THIS STILL RUNS, against `stubComplete`. That is not a fallback in
 * the sense the redesign rejects - a stub answer is worthless as a result and is
 * labelled `stub` in the output so it cannot be mistaken for one. It exists so the
 * whole path is exercised and debugged before a key is present, and so the first
 * real run tests the model rather than this file.
 */

export interface ProbeRun {
  index: number;
  ok: boolean;
  adjudication: unknown;
  verificationFailures: { kind: string; detail: string }[];
  error?: string;
}

export interface ProbeOutput {
  probeVersion: 1;
  source: "live" | "stub";
  model: string | null;
  promptVersion: string;
  /** SHA-256 over the prompt's system + userTemplate. Every result names the prompt that made it. */
  promptHash: string;
  compoundLabel: string;
  requestedRuns: number;
  runs: ProbeRun[];
}

export function promptHash(prompt: { system: string[]; userTemplate: string[] }): string {
  return createHash("sha256")
    .update(JSON.stringify({ system: prompt.system, userTemplate: prompt.userTemplate }))
    .digest("hex");
}

/**
 * A deterministic stand-in that returns a schema-valid adjudication.
 *
 * DELIBERATELY PERFECTLY STABLE. It flips nothing, so a probe run against it
 * reports a flip rate of exactly zero - which is the correct reading, because a
 * stub measures the harness rather than a model. Making it wobble to "look
 * realistic" would produce a number indistinguishable from a real one, and someone
 * would eventually quote it.
 */
export function stubComplete(req: AdjudicateRequest): Complete {
  return async () => ({
    mechanism: {
      present: req.findings.some((f) => f.assertion === "toxic"),
      pathway: null,
      citedFindingIds: req.findings.filter((f) => f.assertion === "toxic").map((f) => f.id),
    },
    consequence: {
      verdict: "cannot_conclude",
      reasoning: "STUB - no model was called. This is not a result.",
      citedFindingIds: req.findings.map((f) => f.id),
    },
    ruleDisclosure: req.rules.map((r) => ({
      ruleId: r.id,
      position: "does_not_apply" as const,
      reasoning: "STUB - no model was called.",
      citedFindingIds: [],
    })),
    missing: req.absent.map((a) => ({ field: a.field, whyItMatters: a.whatItBlocks })),
    nextExperiment: null,
  });
}

export async function runProbe(
  req: AdjudicateRequest,
  prompt: { version: string; system: string[]; userTemplate: string[] },
  runs: number,
  complete: Complete | null,
): Promise<ProbeOutput> {
  const live = complete !== null;
  const call = complete ?? stubComplete(req);
  const schema = adjudicationSchema(req);
  const user = userPrompt(req, prompt.userTemplate);
  const system = prompt.system.join("\n");

  const out: ProbeRun[] = [];
  for (let i = 0; i < runs; i++) {
    try {
      const value = await call(system, user, schema);
      const failures = verifyAdjudication(value as never, req);
      // A verification failure is RECORDED, not retried. Retrying until the model
      // produces something citable would hide exactly the instability the probe
      // exists to measure, and would do it while spending tokens to look better.
      out.push({ index: i, ok: failures.length === 0, adjudication: value, verificationFailures: failures });
    } catch (e) {
      out.push({
        index: i, ok: false, adjudication: null, verificationFailures: [],
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  return {
    probeVersion: 1,
    source: live ? "live" : "stub",
    // Resolved the SAME way completeFromEnv resolves it, from the same constant. A
    // second literal here would let the probe call one model and report another.
    model: live ? (process.env["ARBITER_MODEL"] ?? DEFAULT_MODEL) : null,
    promptVersion: prompt.version,
    promptHash: promptHash(prompt),
    compoundLabel: req.compoundLabel,
    requestedRuns: runs,
    runs: out,
  };
}

async function main(): Promise<void> {
  const runs = Number(process.env["PROBE_RUNS"] ?? "20");
  const casePath = process.env["PROBE_CASE"] ?? "data/probe-case.json";
  const outPath = process.env["PROBE_OUT"] ?? "results/probe-runs.json";

  const prompt = JSON.parse(readFileSync("prompts/adjudicator-v1.0.json", "utf8"));
  const req = JSON.parse(readFileSync(casePath, "utf8")) as AdjudicateRequest;
  const complete = completeFromEnv();

  if (complete === null) {
    console.log("No ANTHROPIC_API_KEY. Running against the STUB - this exercises the");
    console.log("path and produces NO result. Set a key to measure anything.\n");
  }

  const output = await runProbe(req, prompt, runs, complete);
  mkdirSync("results", { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");

  const ok = output.runs.filter((r) => r.ok).length;
  console.log(`source          ${output.source}${output.model === null ? "" : ` (${output.model})`}`);
  console.log(`prompt          v${output.promptVersion} ${output.promptHash.slice(0, 12)}`);
  console.log(`runs            ${output.runs.length} requested ${output.requestedRuns}`);
  console.log(`verified ok     ${ok}/${output.runs.length}`);
  console.log(`written         ${outPath}`);
  console.log("\nNow run:  npm run probe:report");
}

// Only when executed directly, so importing this module in a test never runs a probe.
if (process.argv[1]?.endsWith("probe.js") || process.argv[1]?.endsWith("probe.ts")) {
  void main();
}
