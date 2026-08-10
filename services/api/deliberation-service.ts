import {
  addParticipant, attachAdjudication, closeEarly, describeCase, externalClaimsAsGaps,
  lock, openCase, removeParticipant, sign,
  submitPosition, unanimityCheck, visibleTo,
  type BlindView, type DeliberationCase, type Position, type Result, type Signature,
  type UnanimityReport,
} from "./deliberation.js";
import { absentForAdjudication, buildInventory, type CoveringFinding, type EvidenceChecklist, type Inventory, type Modality } from "./inventory.js";
import { commitmentFor, verifyChain, verifySeals, type DeliberationStore, type LogEntry, type LogKind } from "./store.js";
import { visibleCases } from "./access.js";
import type { AdjudicateRequest } from "./adjudicate.js";

/**
 * The deliberation service: the state machine in deliberation.ts, joined to the
 * append-only log in store.ts.
 *
 * SEPARATE FROM BOTH ON PURPOSE. deliberation.ts is pure and knows nothing about
 * storage, so its rules can be tested without a file. store.ts knows nothing about
 * deliberation rules, so a Postgres implementation cannot accidentally acquire an
 * opinion about who may submit. This file is the only place that knows both, and it
 * is where the ordering guarantee lives: THE SEAL IS WRITTEN BEFORE THE POSITION IS
 * STORED. If storage succeeded and sealing failed, a position would exist that no
 * commitment covers, and `verifySeals` would report it as an insertion - so the
 * write that must not be lost goes first.
 *
 * Every mutation returns the same `Result` the pure layer does. Nothing throws for a
 * rule violation, because a rejected submission is an ordinary outcome that the
 * caller renders, not an exception.
 */
export class DeliberationService {
  constructor(
    private readonly store: DeliberationStore,
    private readonly checklist: EvidenceChecklist,
  ) {}

  open(init: {
    caseId: string;
    compoundLabel: string;
    context: string;
    ownerId: string;
    participantIds: string[];
    findings: CoveringFinding[];
    /** Decides which checklist questions apply at all. Defaults to the conservative
     *  case: a small molecule is asked every question. */
    modality?: Modality;
    at: string;
  }): { case: DeliberationCase; inventory: Inventory } {
    const c = openCase(init);
    this.store.append({
      at: init.at, kind: "case_opened", caseId: c.caseId, actorId: c.ownerId,
      // The findings go in WHOLE, not as a list of ids. They are published to every
      // participant anyway - the inventory is built from them - so nothing is
      // disclosed here that the blind phase protects, and it is what lets a case
      // survive a restart. Storing ids only looked tidier and was a defect: on
      // reload the service would have had no findings, every citation would have
      // failed as unknown, and the failure would have looked like the participant's.
      payload: {
        compoundLabel: c.compoundLabel, context: c.context,
        participantIds: c.participantIds, findings: init.findings,
        modality: init.modality ?? "small_molecule",
      },
    });

    const inventory = buildInventory(init.findings, this.checklist, init.modality ?? "small_molecule");
    // The inventory is logged as it was PUBLISHED, not recomputed at read time.
    // Findings can be corrected later, and a position must remain readable against
    // the account of the evidence its author actually saw. Recomputing would let a
    // later correction silently change what somebody was answering.
    this.store.append({
      at: init.at, kind: "inventory_published", caseId: c.caseId, actorId: c.ownerId,
      payload: inventory,
    });

    this.findings.set(c.caseId, init.findings);
    this.inventories.set(c.caseId, inventory);
    this.modalities.set(c.caseId, init.modality ?? "small_molecule");
    this.store.putCase(c);
    return { case: c, inventory };
  }

  private readonly findings = new Map<string, CoveringFinding[]>();
  private readonly inventories = new Map<string, Inventory>();
  private readonly modalities = new Map<string, Modality>();

  /**
   * The case's findings, recovered from the log when this process did not open it.
   *
   * The log is the record and the maps above are a cache, so a cache miss reads
   * back rather than returning empty. Returning empty is what a restart used to do,
   * and it turned every citation into `unknown_finding_id` - an error that names
   * the participant for a fault that was the server's.
   */
  private findingsOf(caseId: string): CoveringFinding[] {
    const cached = this.findings.get(caseId);
    if (cached !== undefined) return cached;
    const opened = this.store.entries(caseId).filter((e) => e.kind === "case_opened").at(-1);
    const recovered = ((opened?.payload as { findings?: CoveringFinding[] } | undefined)?.findings) ?? [];
    this.findings.set(caseId, recovered);
    return recovered;
  }

  /** The inventory as published. Never recomputed - see `open`. */
  inventory(caseId: string): Inventory | null {
    const cached = this.inventories.get(caseId);
    if (cached !== undefined) return cached;
    // The LATEST publication, not the first: adding a finding appends a new one, and
    // reading the first would serve an inventory that has since been superseded.
    const published = this.store.entries(caseId).filter((e) => e.kind === "inventory_published");
    const entry = published.at(-1);
    return entry === undefined ? null : (entry.payload as Inventory);
  }

  /**
   * Add a finding to an open case, and republish the inventory.
   *
   * WHY THIS EXISTS AT ALL. Extraction — a model reading a PDF and proposing findings
   * — is not built. Until it is, somebody types them, and when extraction does land
   * it pre-fills exactly this form for a human to approve. The approval step is not
   * scaffolding that gets removed later; §4.4a requires a human signature on the
   * declaration either way.
   *
   * FROZEN THE MOMENT ANYBODY ANSWERS, and that is the load-bearing rule. A position
   * is a judgement about a specific account of the evidence. If the evidence could
   * change afterwards, the record would show someone endorsing an inventory they
   * never saw — the same defect the log's hash chain exists to make impossible for
   * positions. So the error is not "you cannot edit", it is "somebody has already
   * answered against this".
   */
  addFinding(caseId: string, finding: CoveringFinding): Result<Inventory> {
    const guard = this.evidenceGuard(caseId);
    if (!guard.ok) return guard;

    const current = this.findingsOf(caseId);
    if (current.some((f) => f.id === finding.id)) {
      return { ok: false, error: { kind: "duplicate_finding", detail: `This case already has a finding called "${finding.id}".` } };
    }
    return { ok: true, value: this.republish(caseId, [...current, finding], guard.value) };
  }

  removeFinding(caseId: string, findingId: string): Result<Inventory> {
    const guard = this.evidenceGuard(caseId);
    if (!guard.ok) return guard;

    const current = this.findingsOf(caseId);
    if (!current.some((f) => f.id === findingId)) {
      return { ok: false, error: { kind: "no_such_finding", detail: `No finding called "${findingId}" in this case.` } };
    }
    return { ok: true, value: this.republish(caseId, current.filter((f) => f.id !== findingId), guard.value) };
  }

  private evidenceGuard(caseId: string): Result<DeliberationCase> {
    const c = this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "not_open", detail: `No case ${caseId}.` } };
    if (c.status !== "open") {
      return { ok: false, error: { kind: "not_open", detail: `Case ${caseId} is ${c.status}. The evidence is fixed once a case closes.` } };
    }
    if (c.positions.length > 0) {
      return {
        ok: false,
        error: {
          kind: "evidence_frozen",
          detail: `${c.positions.length} ${c.positions.length === 1 ? "person has" : "people have"} already answered against this evidence. Changing it now would put a position on the record against an inventory its author never saw.`,
        },
      };
    }
    return { ok: true, value: c };
  }

  private republish(caseId: string, findings: CoveringFinding[], c: DeliberationCase): Inventory {
    const modality = this.modalityOf(caseId);
    const inventory = buildInventory(findings, this.checklist, modality);
    // Appended, never rewritten: the log keeps every version of the inventory that
    // was ever published, and `inventory()` reads the latest. An edited entry would
    // break the chain, which is the point of the chain.
    this.store.append({
      at: new Date(0).toISOString(), kind: "case_opened", caseId, actorId: c.ownerId,
      payload: { compoundLabel: c.compoundLabel, context: c.context, participantIds: c.participantIds, findings, modality },
    });
    this.store.append({
      at: new Date(0).toISOString(), kind: "inventory_published", caseId, actorId: c.ownerId,
      payload: inventory,
    });
    this.findings.set(caseId, findings);
    this.inventories.set(caseId, inventory);
    return inventory;
  }

  private modalityOf(caseId: string): Modality {
    const cached = this.modalities.get(caseId);
    if (cached !== undefined) return cached;
    const opened = this.store.entries(caseId).find((e) => e.kind === "case_opened");
    const m = (opened?.payload as { modality?: Modality } | undefined)?.modality ?? "small_molecule";
    this.modalities.set(caseId, m);
    return m;
  }

  submit(caseId: string, p: Position): Result<DeliberationCase> {
    const c = this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "not_open", detail: `No case ${caseId}.` } };

    const known = new Set(this.findingsOf(caseId).map((f) => f.id));
    const next = submitPosition(c, p, known);
    if (!next.ok) return next;

    // Sealed first. The commitment is the only thing that goes in the log while the
    // case is open: the log stays publishable to a participant mid-deliberation
    // without revealing an answer, which is what makes the blindness auditable
    // rather than merely asserted.
    const stored = next.value.positions.find((x) => x.participantId === p.participantId)!;
    this.store.append({
      at: p.submittedAt, kind: "position_sealed", caseId, actorId: p.participantId,
      payload: { participantId: p.participantId, commitment: commitmentFor(stored) },
    });
    this.store.putCase(next.value);
    return next;
  }

  /** The raw case, for the access check in the server. Deliberately not a view:
   *  access control asks who is named on the case, which is not a question about
   *  what a given viewer is allowed to see. */
  getCase(caseId: string): DeliberationCase | null {
    return this.store.getCase(caseId);
  }

  /** Cases this account is named on, owner or participant. Nothing else, ever -
   *  a list endpoint that leaked case labels would undo the access boundary in the
   *  one place people go looking. */
  casesFor(userId: string): { caseId: string; compoundLabel: string; status: string; isOwner: boolean; submitted: number; of: number }[] {
    return visibleCases(this.store.allCases(), userId).map((c) => ({
      caseId: c.caseId,
      compoundLabel: c.compoundLabel,
      status: c.status,
      isOwner: c.ownerId === userId,
      // Counts of WHO HAS ANSWERED, never of what they said. The same rule as the
      // blind view: a tally of calls drags as hard as the positions themselves.
      submitted: c.positions.length,
      of: c.participantIds.length,
    }));
  }

  /**
   * Roster and description changes. Guarded in the pure layer, LOGGED here.
   *
   * The log entry is not bookkeeping. Choosing who answers is the strongest lever
   * anybody has on the outcome of a deliberation: a convener who can quietly remove
   * the person most likely to dissent has decided the case without ever stating a
   * position. These used to update the case snapshot and leave the chain untouched,
   * which made precisely that move invisible in the record the product exists to
   * produce.
   */
  private mutate(
    caseId: string, actorId: string, at: string, kind: LogKind, payload: unknown,
    f: (c: DeliberationCase) => Result<DeliberationCase>,
  ): Result<DeliberationCase> {
    const c = this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "not_open", detail: `No case ${caseId}.` } };
    const next = f(c);
    if (!next.ok) return next;
    this.store.append({ at, kind, caseId, actorId, payload });
    this.store.putCase(next.value);
    return next;
  }

  addParticipant(caseId: string, userId: string, actorId: string, at: string): Result<DeliberationCase> {
    return this.mutate(caseId, actorId, at, "participant_added", { participantId: userId },
      (c) => addParticipant(c, userId));
  }

  removeParticipant(caseId: string, userId: string, actorId: string, at: string): Result<DeliberationCase> {
    return this.mutate(caseId, actorId, at, "participant_removed", { participantId: userId },
      (c) => removeParticipant(c, userId));
  }

  describe(caseId: string, compoundLabel: string, context: string, actorId: string, at: string): Result<DeliberationCase> {
    return this.mutate(caseId, actorId, at, "case_described", { compoundLabel, context },
      (c) => describeCase(c, compoundLabel, context));
  }

  view(caseId: string, viewerId: string): BlindView | null {
    const c = this.store.getCase(caseId);
    return c === null ? null : visibleTo(c, viewerId);
  }

  reveal(caseId: string, by: string, at: string, mode: "all_in" | "close_early"): Result<DeliberationCase> {
    const c = this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "not_open", detail: `No case ${caseId}.` } };

    const next = mode === "all_in" ? lock(c) : closeEarly(c, by, at);
    if (!next.ok) return next;

    this.store.append({
      at, kind: "revealed", caseId, actorId: by,
      payload: { positions: next.value.positions, closedEarly: next.value.closedEarly },
    });
    this.store.putCase(next.value);
    return next;
  }

  /**
   * The adjudication payload, assembled from the case rather than from a caller.
   *
   * The absences sent to the model are the SAME list the humans read (§3.2 via
   * `absentForAdjudication`), plus every external claim anybody made (§6.5). A
   * scientist's uncited expertise therefore reaches the model as an open question
   * rather than being dropped - which is the difference between a citation
   * requirement people work with and one they route around.
   */
  adjudicationRequest(caseId: string, rules: AdjudicateRequest["rules"]): AdjudicateRequest | null {
    const c = this.store.getCase(caseId);
    const inv = this.inventory(caseId);
    if (c === null || inv === null) return null;

    return {
      compoundLabel: c.compoundLabel,
      context: c.context,
      rules,
      findings: this.findingsOf(caseId).map((f) => ({
        id: f.id, label: f.label, assertion: f.assertion, detail: f.detail,
        ...(f.sourceDocument === undefined ? {} : { sourceDocument: f.sourceDocument }),
        ...(f.sourcePage === undefined ? {} : { sourcePage: f.sourcePage }),
      })),
      absent: [...absentForAdjudication(inv), ...externalClaimsAsGaps(c)],
    };
  }

  adjudicate(caseId: string, adjudication: unknown, at: string, actorId: string): Result<DeliberationCase> {
    const c = this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "not_locked", detail: `No case ${caseId}.` } };
    const next = attachAdjudication(c, adjudication);
    if (!next.ok) return next;
    this.store.append({ at, kind: "adjudicated", caseId, actorId, payload: adjudication });
    this.store.putCase(next.value);
    return next;
  }

  signOff(caseId: string, s: Signature): Result<DeliberationCase> {
    const c = this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "no_adjudication", detail: `No case ${caseId}.` } };
    const next = sign(c, s);
    if (!next.ok) return next;
    this.store.append({ at: s.at, kind: "signed", caseId, actorId: s.by, payload: s });
    this.store.putCase(next.value);
    return next;
  }

  unanimity(caseId: string): UnanimityReport | null {
    const c = this.store.getCase(caseId);
    const inv = this.inventory(caseId);
    return c === null || inv === null ? null : unanimityCheck(c, inv);
  }

  /**
   * The audit a sceptic runs: is this log internally consistent, and does every
   * revealed position match what was sealed while the case was blind?
   *
   * Reported together because they answer one question between them. A valid chain
   * over positions that never matched their commitments proves only that the
   * tampering was done tidily.
   */
  audit(caseId: string): { chain: ReturnType<typeof verifyChain>; seals: ReturnType<typeof verifySeals>; entries: LogEntry[] } {
    const c = this.store.getCase(caseId);
    const entries = this.store.entries(caseId);
    return {
      // The WHOLE log, not this case's slice: a per-case slice has holes wherever
      // another case interleaved, and every link across a hole would read as broken.
      chain: verifyChain(this.store.all()),
      seals: verifySeals(entries, c?.positions ?? []),
      entries,
    };
  }
}
