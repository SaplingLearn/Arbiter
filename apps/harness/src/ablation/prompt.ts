import { createHash } from "node:crypto";
import { canonicalJson } from "../preregistration.js";
import { VERDICTS } from "./aggregate.js";

/** Where the per-compound evidence is substituted into the user message. */
export const EVIDENCE_PLACEHOLDER = "{{EVIDENCE}}";

export interface RulesetForPrompt {
  rules: { id: string; name: string; statement: string }[];
  abstentionGapThreshold: number;
  precedenceOrder: string[];
}

/**
 * The two halves of the prompt, kept apart because the split is load-bearing.
 *
 * `system` and everything in `user` before the evidence are IDENTICAL across all
 * 1,525 requests, and the per-compound evidence is identical across that
 * compound's 25. That makes the stable content a caching prefix by construction
 * (spec section 5.4) - put the fixed part first and the varying part last.
 * Caching changes cost, never the output distribution, so it is
 * methodologically free.
 */
export interface PromptTemplate {
  system: string;
  user: string;
}

/**
 * The model is given the same claims the engine is given, AND the registered
 * rules (spec section 5).
 *
 * Including the rules is the adversarial choice, and it is deliberate. The
 * strongest form of "why not just ask a model" is *"give the model the same
 * rules and the same evidence and let it apply them itself."* If the model is
 * inconsistent even then, the finding survives the obvious rebuttal. Withholding
 * them produces a cheaper-looking result and invites the one-sentence reply that
 * destroys it: "you never told it the rules."
 *
 * The rule statements are copied VERBATIM from `rules/ruleset-v1.0.json`. The
 * file is read, never edited.
 */
export function buildTemplate(ruleset: RulesetForPrompt): PromptTemplate {
  const rules = ruleset.rules
    .map((r) => `${r.id} (${r.name}): ${r.statement}`)
    .join("\n");

  const system = [
    "You are adjudicating preclinical hepatotoxicity evidence for a single compound.",
    "",
    "Apply these registered rules. They are the same rules the reference system applies:",
    "",
    rules,
    "",
    `Rule precedence, highest first: ${ruleset.precedenceOrder.join(" > ")}.`,
    `Abstain when the belief-plausibility gap exceeds ${ruleset.abstentionGapThreshold}.`,
    "",
    `Answer with exactly one verdict from: ${VERDICTS.join(", ")}.`,
    "Also give your confidence in that verdict, from 0 to 1.",
    "Abstaining is a legitimate answer and is not penalised.",
  ].join("\n");

  const user = [
    "Evidence claims for this compound, as canonical JSON:",
    "",
    EVIDENCE_PLACEHOLDER,
  ].join("\n");

  return { system, user };
}

/**
 * Claims are serialised as canonical JSON of the exact objects the engine reads
 * - not prose (spec section 5.1).
 *
 * Prose serialisation would be a second authored artifact that could be tuned,
 * deliberately or accidentally, to produce a better-looking result, and there
 * would be no way to prove it wasn't. Canonical JSON is verifiable by inspection
 * and is the same bytes on every run.
 */
export function renderUser(template: PromptTemplate, claims: unknown[]): string {
  return template.user.replace(EVIDENCE_PLACEHOLDER, canonicalJson(claims));
}

/**
 * The digest of the TEMPLATE, not of any filled instance.
 *
 * Load-bearing twice over. It is what lets a reviewer confirm the committed
 * numbers came from the committed prompt, so an edited prompt left beside stale
 * numbers is detectable. And it is the key the resume guard matches on: runs
 * recorded under a different prompt are not this run's runs, so they are redone
 * rather than silently reused.
 */
export function promptSha256(template: PromptTemplate): string {
  return createHash("sha256").update(canonicalJson(template)).digest("hex");
}
