import { caseAgreement, type CaseAgreement } from "./agreement.js";
import type { Inventory } from "./inventory.js";

/**
 * Blind deliberation. Spec §6.
 *
 * Several scientists answer the same case without seeing each other, everything is
 * revealed at once, and only then does anything reason across the positions. This
 * file is the whole of that mechanism except the reasoning step, and it contains no
 * model call - which is why it could be built, and tested, before a key existed.
 *
 * THE ONE PROPERTY EVERYTHING ELSE RESTS ON. Collecting four positions is only worth
 * more than collecting one if the four are independent. The first person to speak in
 * a meeting drags everyone else (§6.2), so blindness is not a courtesy feature; it is
 * the entire reason the exercise produces information. `visibleTo` is where that is
 * enforced, and it is enforced by not returning the data rather than by asking the
 * client not to show it.
 *
 * COUNTS ARE NEVER AN INPUT. §6.4. Nothing here computes a majority, a quorum or a
 * threshold, and `unanimityCheck` exists to say that agreement is not evidence - the
 * opposite of a vote tally. Master spec §7a killed vote counting because if a count
 * decides, the group can outvote the accountable owner and nobody is accountable.
 *
 * TIME IS PASSED IN, NEVER READ. Every function that records a timestamp takes it as
 * an argument. The core stays pure, so a test can assert on an exact log and the same
 * inputs always produce the same hashes.
 */

export type Call = "advance" | "do_not_advance" | "cannot_conclude";

export interface ExternalCitation {
  /** The assertion being made from outside the case documents. */
  claim: string;
  /** A paper, a report, prior work. Optional: an unsourced external claim is still
   *  a legitimate state, and pretending otherwise pushes people to fake a source. */
  source?: string;
}

export interface Position {
  participantId: string;
  call: Call;
  /** Why. Prose, because no structure captures "this assay overcalls for
   *  phenothiazines and the margin is 40x", and that is the part a later reader needs. */
  reasoning: string;
  /** A SELECTION against the approved findings, never free text. §6.5: a selected
   *  citation points at a specific object, so the check below is deterministic. A
   *  typed citation would have to be run through a model to decide whether it
   *  referred to anything real, and then a model is gatekeeping dissent. */
  citedFindingIds: string[];
  external: ExternalCitation[];
  submittedAt: string;
}

/**
 * §6.5's three states, DERIVED rather than declared.
 *
 * Deriving it is what stops the state being a self-assessment. Somebody who cites
 * nothing is `unsupported` whether or not they would have described themselves that
 * way, and somebody citing a real finding cannot be talked out of `cited`.
 *
 * A position may hold both kinds of citation at once, and `cited` wins the label
 * because the checkable part of it is checkable. The three states are a description
 * of what a position RESTS ON, not a partition of people.
 *
 * `unsupported` does not mean deleted, wrong, or overruled. §6.5: dissent is
 * preserved permanently - that is the record's purpose. What changes is that the
 * basis of every position is visible, so the person signing can see three positions
 * citing findings and one citing nothing. They still decide. They can no longer do it
 * without noticing.
 */
export type PositionBasis = "cited" | "external" | "unsupported";

export function positionBasis(p: Position): PositionBasis {
  if (p.citedFindingIds.length > 0) return "cited";
  if (p.external.length > 0) return "external";
  return "unsupported";
}

export type CaseStatus = "open" | "locked" | "adjudicated" | "signed";

export interface Signature {
  by: string;
  at: string;
  /** False when the signer overrode the adjudication. */
  agreesWithAdjudication: boolean;
  /** Required when overriding. An override with no stated reason is the record
   *  failing at the one moment it exists for. */
  reason: string;
}

export interface DeliberationCase {
  caseId: string;
  compoundLabel: string;
  context: string;
  ownerId: string;
  participantIds: string[];
  status: CaseStatus;
  positions: Position[];
  closedEarly: { by: string; at: string; nonResponders: string[] } | null;
  adjudication: unknown | null;
  signature: Signature | null;
}

export type DeliberationErrorKind =
  | "not_open"
  | "not_locked"
  | "not_a_participant"
  | "already_submitted"
  | "unknown_finding_id"
  | "empty_reasoning"
  | "not_all_submitted"
  | "not_the_owner"
  | "no_adjudication"
  | "override_needs_reason"
  | "already_signed"
  | "evidence_frozen"
  | "no_such_finding"
  | "duplicate_finding"
  | "already_a_participant"
  | "not_on_the_case"
  | "has_answered";

export interface DeliberationError {
  kind: DeliberationErrorKind;
  detail: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DeliberationError };

const fail = <T>(kind: DeliberationErrorKind, detail: string): Result<T> =>
  ({ ok: false, error: { kind, detail } });

export function openCase(init: {
  caseId: string;
  compoundLabel: string;
  context: string;
  ownerId: string;
  participantIds: string[];
}): DeliberationCase {
  // Built field by field, NOT by spreading `init`. Spreading looked equivalent and
  // was not: callers pass a wider object (the service passes findings and a
  // timestamp alongside), TypeScript's excess-property check does not fire through a
  // spread, and the case silently carried fields its own type does not declare -
  // out over the API and into the persisted snapshot. A type that disagrees with the
  // value it describes is worse than no type.
  return {
    caseId: init.caseId,
    compoundLabel: init.compoundLabel,
    context: init.context,
    ownerId: init.ownerId,
    // Deduplicated and sorted: a participant listed twice would make "all have
    // submitted" unreachable, and the case would never lock.
    participantIds: [...new Set(init.participantIds)].sort(),
    status: "open",
    positions: [],
    closedEarly: null,
    adjudication: null,
    signature: null,
  };
}

/**
 * Add somebody to an open case.
 *
 * ONLY BEFORE ANYBODY HAS ANSWERED, and the reason is the same one that freezes the
 * evidence: "everyone has submitted" is the condition that unlocks the reveal, so
 * adding a person afterwards would silently re-open a case that had closed, and
 * removing one would close a case early without the record that `closeEarly` writes.
 * Both are changes to what the eventual reveal MEANS, made after people committed to
 * it.
 */
export function addParticipant(c: DeliberationCase, userId: string): Result<DeliberationCase> {
  if (c.status !== "open") return fail("not_open", `Case ${c.caseId} is ${c.status}.`);
  if (c.positions.length > 0) {
    return fail("has_answered", "Somebody has already answered. Adding a person now would re-open a case that others have already treated as closed.");
  }
  if (c.participantIds.includes(userId)) {
    return fail("already_a_participant", "They are already on this case.");
  }
  return { ok: true, value: { ...c, participantIds: [...c.participantIds, userId].sort() } };
}

export function removeParticipant(c: DeliberationCase, userId: string): Result<DeliberationCase> {
  if (c.status !== "open") return fail("not_open", `Case ${c.caseId} is ${c.status}.`);
  if (c.positions.length > 0) {
    return fail("has_answered", "Somebody has already answered. Removing a person now would close the case early without recording that it happened.");
  }
  if (!c.participantIds.includes(userId)) {
    return fail("not_on_the_case", "They are not on this case.");
  }
  if (c.participantIds.length === 1) {
    return fail("not_on_the_case", "A case needs somebody to answer it. Close it instead of emptying it.");
  }
  return { ok: true, value: { ...c, participantIds: c.participantIds.filter((id) => id !== userId) } };
}

/** Rename, or restate the decision. Permitted while open even after answers, because
 *  neither is evidence - and a case whose title is wrong is worse for a later reader
 *  than one that was corrected. */
export function describeCase(c: DeliberationCase, compoundLabel: string, context: string): Result<DeliberationCase> {
  if (c.status === "signed") return fail("already_signed", "A signed case is closed for editing.");
  if (compoundLabel.trim() === "") return fail("not_open", "A case needs a compound name.");
  return { ok: true, value: { ...c, compoundLabel: compoundLabel.trim(), context } };
}

/**
 * Submit a position. The citation check is here and it is deterministic.
 *
 * `knownFindingIds` is passed in rather than read from the case because the findings
 * live with the documents, not with the deliberation. A citation pointing at
 * something that is not in this case is rejected at the door: unverifiable citations
 * are worse than no citation requirement, because they look like evidence.
 *
 * The reasoning is required even when the call is obvious. A position with a verdict
 * and no argument is exactly the input the AI cannot weigh (§6.4 weighs arguments,
 * never headcount), so allowing it would create positions that can only be counted.
 */
export function submitPosition(
  c: DeliberationCase,
  p: Position,
  knownFindingIds: ReadonlySet<string>,
): Result<DeliberationCase> {
  if (c.status !== "open") {
    return fail("not_open", `Case ${c.caseId} is ${c.status}; positions are accepted only while it is open.`);
  }
  if (!c.participantIds.includes(p.participantId)) {
    return fail("not_a_participant", `${p.participantId} is not named on case ${c.caseId}.`);
  }
  if (c.positions.some((x) => x.participantId === p.participantId)) {
    return fail("already_submitted", `${p.participantId} has already submitted. A submitted position is sealed and cannot be replaced.`);
  }
  if (p.reasoning.trim() === "") {
    return fail("empty_reasoning", "A position must state why. A call with no argument can only be counted, and counts never decide here.");
  }
  const unknown = p.citedFindingIds.filter((id) => !knownFindingIds.has(id));
  if (unknown.length > 0) {
    return fail("unknown_finding_id", `Cites ${unknown.map((u) => `"${u}"`).join(", ")}, which ${unknown.length === 1 ? "is" : "are"} not in this case.`);
  }

  const cited = [...new Set(p.citedFindingIds)].sort();
  return {
    ok: true,
    value: { ...c, positions: [...c.positions, { ...p, citedFindingIds: cited }] },
  };
}

/**
 * What a given viewer is allowed to see. THE blind-submission enforcement point.
 *
 * While the case is open a viewer gets their own position in full and, for everyone
 * else, one bit: submitted or not. Not the call, not the reasoning, not the
 * citations, not a count of how many have gone each way - a running tally of calls
 * drags exactly as hard as the positions themselves would.
 *
 * Enforced by NOT RETURNING THE DATA. Returning everything and trusting the client
 * to hide it makes blindness a rendering convention, and a rendering convention is
 * one forgotten conditional away from being nothing at all. Everything downstream of
 * this function may assume its output is safe to show.
 *
 * The owner is not privileged. An owner who could read positions early is the senior
 * person in the room reading everyone's answer before speaking, which is the precise
 * dynamic §6.2 exists to break.
 */
export interface BlindView {
  status: CaseStatus;
  own: Position | null;
  others: { participantId: string; submitted: boolean }[];
  revealed: Position[] | null;
}

export function visibleTo(c: DeliberationCase, viewerId: string): BlindView {
  const submitted = new Set(c.positions.map((p) => p.participantId));
  const own = c.positions.find((p) => p.participantId === viewerId) ?? null;

  if (c.status === "open") {
    return {
      status: c.status,
      own,
      others: c.participantIds
        .filter((id) => id !== viewerId)
        .map((id) => ({ participantId: id, submitted: submitted.has(id) })),
      revealed: null,
    };
  }

  return {
    status: c.status,
    own,
    others: c.participantIds
      .filter((id) => id !== viewerId)
      .map((id) => ({ participantId: id, submitted: submitted.has(id) })),
    // Sorted by participant id, NOT by submission time. Submission order is a
    // status signal - first to answer reads as most confident, last as most
    // considered - and neither is information about the compound.
    revealed: [...c.positions].sort((a, b) =>
      a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0),
  };
}

export function allSubmitted(c: DeliberationCase): boolean {
  const submitted = new Set(c.positions.map((p) => p.participantId));
  return c.participantIds.every((id) => submitted.has(id));
}

/** Lock and reveal, the normal path: everyone named has answered. */
export function lock(c: DeliberationCase): Result<DeliberationCase> {
  if (c.status !== "open") return fail("not_open", `Case ${c.caseId} is already ${c.status}.`);
  if (!allSubmitted(c)) {
    const missing = c.participantIds.filter((id) => !c.positions.some((p) => p.participantId === id));
    return fail("not_all_submitted", `Still waiting on ${missing.join(", ")}. Use closeEarly to proceed without them, which records who did not answer.`);
  }
  return { ok: true, value: { ...c, status: "locked" } };
}

/**
 * The decision owner closes without everyone, and WHO DID NOT ANSWER IS RECORDED.
 *
 * §6.1 allows this and the recording is the whole of what makes it safe. Silent
 * early closure lets a case be locked the moment the answers look right, with the
 * dissenter's absence invisible to every later reader. Naming the non-responders
 * costs nothing and makes that move visible instead of impossible - which is the
 * correct treatment, because sometimes the reason really is that someone is on
 * leave.
 */
export function closeEarly(c: DeliberationCase, by: string, at: string): Result<DeliberationCase> {
  if (c.status !== "open") return fail("not_open", `Case ${c.caseId} is already ${c.status}.`);
  if (by !== c.ownerId) {
    return fail("not_the_owner", `Only ${c.ownerId} can close case ${c.caseId} early.`);
  }
  const nonResponders = c.participantIds.filter((id) => !c.positions.some((p) => p.participantId === id));
  return { ok: true, value: { ...c, status: "locked", closedEarly: { by, at, nonResponders } } };
}

export function attachAdjudication(c: DeliberationCase, adjudication: unknown): Result<DeliberationCase> {
  if (c.status !== "locked") {
    return fail("not_locked", `Case ${c.caseId} is ${c.status}. Adjudication runs after reveal, never before - a model that answered first would drag the room the way a person would.`);
  }
  return { ok: true, value: { ...c, status: "adjudicated", adjudication } };
}

/**
 * One named person signs, or overrides on the record. §6.7.
 *
 * There is no consensus mechanism, no quorum and no threshold to proceed, on
 * purpose: a committee advises and one individual signs. Every mechanism that would
 * relieve that person of the decision is out of scope.
 *
 * An override is permitted and requires a reason. Forbidding it would make the AI
 * the decider, which is the failure mode this whole redesign is trying not to build.
 */
export function sign(
  c: DeliberationCase,
  s: Signature,
): Result<DeliberationCase> {
  if (c.signature !== null) return fail("already_signed", `Case ${c.caseId} was signed by ${c.signature.by}.`);
  if (c.status !== "adjudicated") {
    return fail("no_adjudication", `Case ${c.caseId} is ${c.status}. Signing records agreement or disagreement with an adjudication, so there must be one.`);
  }
  if (!s.agreesWithAdjudication && s.reason.trim() === "") {
    return fail("override_needs_reason", "Overriding the adjudication requires a stated reason. This is the moment the record exists for.");
  }
  return { ok: true, value: { ...c, status: "signed", signature: s } };
}

/**
 * §6.6 - unanimity is not correctness. The feature that matters most, and it needs
 * no model.
 *
 * THIS IS TAK-994. A room that agreed, a package that looked complete, and a gap
 * nobody named. A system that only reconciled disagreement would have sailed
 * straight through it, because there was no disagreement to reconcile.
 *
 * What makes it computable here is that unanimity plus an unanswered question is a
 * fact about the record, not a judgment about the compound. It is stated as a
 * concern rather than a verdict, and it never blocks anything - the signer is told,
 * and the signer decides.
 *
 * DIRECTIONAL ON PURPOSE. Gaps are raised against agreement to advance, and not
 * against agreement to stop. The asymmetry is the same one rule R3 encodes: an
 * untested question is a reason not to be reassured, and a room that has agreed to
 * stop is not being reassured by anything. Warning there would be inventing a
 * pressure to advance, which is not this system's job.
 */
export interface UnanimityReport {
  unanimous: boolean;
  call: Call | null;
  concerns: string[];
}

export function unanimityCheck(c: DeliberationCase, inv: Inventory): UnanimityReport {
  if (c.positions.length === 0) return { unanimous: false, call: null, concerns: [] };

  const calls = new Set(c.positions.map((p) => p.call));
  if (calls.size > 1) return { unanimous: false, call: null, concerns: [] };

  const call = c.positions[0]!.call;
  const concerns: string[] = [];

  const uncited = c.positions.filter((p) => positionBasis(p) === "unsupported").map((p) => p.participantId);
  if (uncited.length === c.positions.length) {
    concerns.push(`Every position cites nothing from the case documents (${uncited.join(", ")}). The agreement records a shared expectation, not a shared reading of the evidence.`);
  } else if (uncited.length > 0) {
    concerns.push(`${uncited.join(", ")} cited nothing from the case documents. Agreement is not evidence that those positions were reached the same way.`);
  }

  if (call === "advance") {
    const gaps = inv.entries.filter((e) => e.state === "absent");
    if (gaps.length > 0) {
      concerns.push(`Everyone agreed to advance, and ${gaps.length} question${gaps.length === 1 ? " was" : "s were"} never answered: ${gaps.map((g) => g.field).join("; ")}. The agreement is not evidence; nobody tested ${gaps.length === 1 ? "it" : "them"}.`);
    }
    const inconclusive = inv.entries.filter((e) => e.state === "inconclusive");
    if (inconclusive.length > 0) {
      concerns.push(`Tested but unresolved, and agreed past: ${inconclusive.map((g) => g.field).join("; ")}.`);
    }
  }

  const everCited = new Set(c.positions.flatMap((p) => p.citedFindingIds));
  const uncitedPresent = inv.entries
    .filter((e) => e.state === "present" && !e.findingIds.some((id) => everCited.has(id)));
  if (uncitedPresent.length > 0 && call === "advance") {
    concerns.push(`Present in the documents and cited by nobody: ${uncitedPresent.map((e) => e.field).join("; ")}. Evidence that was available and went unmentioned is worth a second look before signing.`);
  }

  return { unanimous: true, call, concerns };
}

/**
 * Where the room actually split, and on what. §6.3's "the one disagreement that
 * changes the answer", in the part that needs no model.
 *
 * Plain arithmetic over the positions: who called what, and which findings only one
 * side is resting on. It is deliberately NOT a judgment about who is right - it
 * reports the shape of the disagreement and stops, because deciding which reading of
 * a finding is correct is exactly the work the adjudication and the signer do.
 *
 * `contested` is the useful column. A finding both sides cite is common ground being
 * read two ways; a finding only one side cites is evidence the other side has not
 * engaged with, and those are different conversations.
 */
export interface DisagreementReport {
  split: { call: Call; participantIds: string[] }[];
  /** Cited by more than one camp - the same evidence, read differently. */
  contested: string[];
  /** Cited by exactly one camp - evidence the others did not answer. */
  oneSided: { findingId: string; call: Call }[];
  /** How much the room agreed. Context for a later reader and nothing else: §6.4
   *  forbids a count from entering a verdict, and this is measured after the fact
   *  rather than consulted during one. Null below two positions. */
  agreement: CaseAgreement | null;
}

export function disagreementReport(c: DeliberationCase): DisagreementReport | null {
  const calls = [...new Set(c.positions.map((p) => p.call))].sort();
  if (calls.length < 2) return null;

  const split = calls.map((call) => ({
    call,
    participantIds: c.positions.filter((p) => p.call === call).map((p) => p.participantId).sort(),
  }));

  const campsByFinding = new Map<string, Set<Call>>();
  for (const p of c.positions) {
    for (const id of p.citedFindingIds) {
      const set = campsByFinding.get(id) ?? new Set<Call>();
      set.add(p.call);
      campsByFinding.set(id, set);
    }
  }

  const contested: string[] = [];
  const oneSided: { findingId: string; call: Call }[] = [];
  for (const [findingId, camps] of [...campsByFinding].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (camps.size > 1) contested.push(findingId);
    else oneSided.push({ findingId, call: [...camps][0]! });
  }

  return { split, contested, oneSided, agreement: caseAgreement(c.positions.map((p) => p.call)) };
}

/**
 * External claims become missing evidence rather than evaporating. §6.5.
 *
 * "This assay overcalls for phenothiazines" is not a weaker citation; it is a claim
 * that is asserted and not yet in evidence, and it is useful precisely because
 * someone can go and check it. Routing it onto the missing list is what makes it
 * testable instead of rhetorical, and attaching a source is what promotes it to a
 * finding.
 */
export function externalClaimsAsGaps(c: DeliberationCase): { field: string; whatItBlocks: string }[] {
  return c.positions
    .flatMap((p) => p.external.map((e) => ({ participantId: p.participantId, ...e })))
    .map((e) => ({
      field: `External claim (${e.participantId}): ${e.claim}`,
      whatItBlocks: e.source === undefined || e.source.trim() === ""
        ? "Asserted from outside the case documents with no source attached. Nothing in this case tests it."
        : `Asserted from outside the case documents, sourced to ${e.source}. Not yet extracted as a finding, so no rule has been applied to it.`,
    }));
}
