import {
  addParticipant, attachAdjudication, canAdjudicate, closeEarly, describeCase, externalClaimsAsGaps,
  lock, openCase, removeParticipant, sign,
  submitPosition, unanimityCheck, visibleTo,
  type BlindView, type DeliberationCase, type Position, type Result, type Signature,
  type UnanimityReport,
} from "./deliberation.js";
import { absentForAdjudication, buildInventory, presentForAdjudication, type CoveringFinding, type EvidenceChecklist, type Inventory, type Modality } from "./inventory.js";
import { commitmentFor, verifyChain, verifySeals, type DeliberationStore, type LogEntry, type LogKind } from "./store.js";
import { visibleCases } from "./access.js";
import type { AdjudicateRequest } from "./adjudicate.js";
import type { DemoFixture } from "./demo-fixture.js";

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
/**
 * What a viewer of a case gets: the blind view, plus what the case has decided.
 *
 * A WIDER TYPE THAN `BlindView`, and the split is the point. `BlindView` is produced
 * by the pure layer and is the thing that must never leak a sealed position; these
 * four fields are all post-reveal by construction, so they hang off it here rather
 * than widening the type whose whole job is that one guarantee.
 */
export interface CaseView extends BlindView {
  adjudication: unknown | null;
  /** `stub` when no model was called. Carried so the screen can say so - the banner
   *  is the difference between a demo and a claim about a compound. */
  adjudicationSource: "stub" | "live" | null;
  consensus: unknown | null;
  signature: Signature | null;
}

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
        // The opening seat allocation, for the same reason participant_added carries
        // one: §3.1 promises the colours are recoverable from the chain alone. The
        // founding participants get their seats here and nowhere else, so a chain
        // without this can only reconstruct the seats of people who joined LATER.
        seats: c.seats,
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
   * WHY THIS EXISTS AT ALL. Extraction - a model reading a PDF and proposing findings
   * - is not built. Until it is, somebody types them, and when extraction does land
   * it pre-fills exactly this form for a human to approve. The approval step is not
   * scaffolding that gets removed later; §4.4a requires a human signature on the
   * declaration either way.
   *
   * FROZEN THE MOMENT ANYBODY ANSWERS, and that is the load-bearing rule. A position
   * is a judgement about a specific account of the evidence. If the evidence could
   * change afterwards, the record would show someone endorsing an inventory they
   * never saw - the same defect the log's hash chain exists to make impossible for
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

  /**
   * Fill a case in from a recognised document: its findings, and one position per
   * participant.
   *
   * BEST EFFORT, AND IT REPORTS WHAT IT DID. Every step is a normal call through the
   * same guards a person's typing goes through - `addFinding` still refuses once
   * somebody has answered, `submit` still refuses a citation to a finding that does
   * not exist - so a case that is already part-way through is topped up rather than
   * overwritten, and a step that is refused is counted rather than thrown. An upload
   * must never fail because the convenience attached to it could not run.
   *
   * THE LOG ENTRY GOES FIRST. If seeding half-succeeds, the record still says a
   * fixture was applied and names it. Writing the entry last would mean a partial
   * seed that crashed looked like hand-typed evidence.
   *
   * ONE SEAT IS LEFT OPEN, AND THAT IS THE WHOLE DESIGN.
   *
   * The point of seeding is not to produce a finished case - it is to remove the wait
   * for colleagues who are not in the room. So every participant except one is given a
   * reading, and the remaining seat stays empty for the person actually driving. They
   * write their own position, and only then does the reveal unlock, because the server
   * still holds it until everybody has answered. A fixture that filled every seat
   * would skip the one stage the product is most about.
   *
   * WHICH SEAT STAYS OPEN: the uploader's, when the uploader is on the panel, since
   * they are the one at the keyboard. When they are not - the case owner is not a
   * participant and cannot be one, the UI filters them out of its own panel list - it
   * is the FIRST seat, which is seat 0 and the top row of the roster everywhere it is
   * drawn. It was briefly the last seat, and that was a worse choice for the only
   * reason that matters here: whoever is running this has to know which account to
   * sign in as, and roster order is not the order the emails were typed in, so "the
   * last one" meant looking it up. "The one at the top of the panel" does not.
   *
   * POSITIONS ARE DEALT IN ROSTER ORDER and cycled if the room is larger than the
   * fixture. They are attributed to the accounts that hold them, because a position
   * has to belong to somebody for the reveal to mean anything - and that attribution
   * is exactly why the `demo_seeded` entry above it is not optional.
   *
   * NOBODY IS GIVEN A SECOND POSITION. `submitPosition` seals on first submit and
   * refuses afterwards, so a participant who has already answered keeps their own
   * answer and the fixture's is dropped.
   */
  seedFromFixture(
    caseId: string, actorId: string, at: string, fixture: DemoFixture,
  ): Result<{ findingsAdded: number; positionsSealed: number; leftOpenFor: string | null; skipped: string[] }> {
    const c = this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "not_open", detail: `No case ${caseId}.` } };

    this.store.append({
      at, kind: "demo_seeded", caseId, actorId,
      payload: {
        fixture: fixture.label, sha256: fixture.sha256,
        findings: fixture.findings.length, positions: fixture.positions.length,
      },
    });

    const skipped: string[] = [];
    let findingsAdded = 0;
    // One publish, not one per finding: the evidence arrived as a single document and
    // the record should say so. See `addFindings`.
    const ev = this.addFindings(caseId, fixture.findings);
    if (ev.ok) {
      findingsAdded = ev.value.added.length;
      for (const id of ev.value.duplicates) skipped.push(`finding ${id}: duplicate_finding`);
    } else {
      skipped.push(`findings: ${ev.error.kind}`);
    }

    const roster = this.store.getCase(caseId)?.participantIds ?? [];
    // The uploader's seat when they hold one, otherwise the first. `?? null` rather
    // than a bare index so an empty roster leaves nothing open rather than undefined.
    const leftOpenFor = roster.includes(actorId) ? actorId : roster[0] ?? null;

    let positionsSealed = 0;
    roster
      .filter((participantId) => participantId !== leftOpenFor)
      .forEach((participantId, i) => {
        const p = fixture.positions[i % fixture.positions.length];
        if (p === undefined) return;
        const r = this.submit(caseId, { ...p, participantId, submittedAt: at });
        if (r.ok) positionsSealed++;
        else skipped.push(`position ${participantId}: ${r.error.kind}`);
      });

    return { ok: true, value: { findingsAdded, positionsSealed, leftOpenFor, skipped } };
  }

  /**
   * Several findings, published ONCE.
   *
   * `addFinding` re-publishes on every call - it appends a fresh `case_opened` (which
   * is where the findings list actually lives) and a fresh `inventory_published` - so
   * adding nine one at a time writes eighteen entries before anybody has said
   * anything. Typed by hand that is a fair record of nine separate edits. Arriving
   * together in one document it is not: it is one act, and the Record stage rendered
   * it as twenty rows of noise above the events a reader came to see.
   *
   * Duplicates are skipped rather than refused, and reported, so a case that already
   * holds some of these findings is topped up instead of rejected wholesale.
   */
  addFindings(caseId: string, findings: CoveringFinding[]): Result<{ inventory: Inventory; added: string[]; duplicates: string[] }> {
    const guard = this.evidenceGuard(caseId);
    if (!guard.ok) return guard;

    const current = this.findingsOf(caseId);
    const seen = new Set(current.map((f) => f.id));
    const added: CoveringFinding[] = [];
    const duplicates: string[] = [];
    for (const f of findings) {
      if (seen.has(f.id)) { duplicates.push(f.id); continue; }
      seen.add(f.id);
      added.push(f);
    }
    if (added.length === 0) {
      return { ok: true, value: { inventory: this.inventory(caseId)!, added: [], duplicates } };
    }
    return {
      ok: true,
      value: {
        inventory: this.republish(caseId, [...current, ...added], guard.value),
        added: added.map((f) => f.id),
        duplicates,
      },
    };
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
      payload: { compoundLabel: c.compoundLabel, context: c.context, participantIds: c.participantIds, seats: c.seats, findings, modality },
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
  /**
   * The payload is built FROM THE RESULTING CASE, not from the arguments. A seat is
   * allocated inside the transition, so an argument-shaped payload could not name it
   * without reimplementing the allocation - the duplicated definition this project
   * keeps refusing.
   */
  private mutate(
    caseId: string, actorId: string, at: string, kind: LogKind,
    payload: (next: DeliberationCase) => unknown,
    f: (c: DeliberationCase) => Result<DeliberationCase>,
  ): Result<DeliberationCase> {
    const c = this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "not_open", detail: `No case ${caseId}.` } };
    const next = f(c);
    if (!next.ok) return next;
    this.store.append({ at, kind, caseId, actorId, payload: payload(next.value) });
    this.store.putCase(next.value);
    return next;
  }

  addParticipant(caseId: string, userId: string, actorId: string, at: string): Result<DeliberationCase> {
    // The SEAT goes in the entry, not just the participant id. Spec §3.1: "the
    // colours are recoverable from the audit chain alone, without needing the
    // database" - which is only true if the chain records which seat was handed out.
    // Without it the log says somebody joined and the projection says what colour
    // they wear, and store.ts is explicit that the projection is a convenience and
    // the LOG is the record. `seat` is null when the case is already full.
    return this.mutate(caseId, actorId, at, "participant_added",
      (next) => ({ participantId: userId, seat: next.seats[userId] ?? null }),
      (c) => addParticipant(c, userId));
  }

  removeParticipant(caseId: string, userId: string, actorId: string, at: string): Result<DeliberationCase> {
    return this.mutate(caseId, actorId, at, "participant_removed", () => ({ participantId: userId }),
      (c) => removeParticipant(c, userId));
  }

  describe(caseId: string, compoundLabel: string, context: string, actorId: string, at: string): Result<DeliberationCase> {
    return this.mutate(caseId, actorId, at, "case_described", () => ({ compoundLabel, context }),
      (c) => describeCase(c, compoundLabel, context));
  }

  /**
   * The blind view, plus the things that only exist AFTER the reveal.
   *
   * COMPOSED HERE RATHER THAN IN `visibleTo`, because the source label is not on the
   * case - it is the actor on the `adjudicated` entry, and deliberation.ts is pure
   * and holds no log. This class is the one place that knows both, which is the
   * reason it exists.
   *
   * SAFE AGAINST THE BLINDNESS RULE by construction rather than by a guard:
   * `attachAdjudication` refuses any case that is not `locked`, and locking IS the
   * reveal. So an adjudication cannot exist while positions are still sealed, and
   * these three fields are null for the entire window that §6.2 protects.
   *
   * They are served to every viewer, not just the owner who ran the adjudication. A
   * participant is being asked to live with the verdict; reading it is the minimum.
   */
  view(caseId: string, viewerId: string): CaseView | null {
    const c = this.store.getCase(caseId);
    if (c === null) return null;
    return {
      ...visibleTo(c, viewerId),
      // `?? null` rather than the bare field: cases persisted before `consensus`
      // existed have no such key, and `undefined` disappears through JSON.stringify -
      // so the API would omit the field entirely rather than report "not recorded".
      adjudication: c.adjudication ?? null,
      adjudicationSource: (c.adjudication ?? null) === null ? null : this.adjudicationSource(caseId),
      consensus: c.consensus ?? null,
      signature: c.signature ?? null,
    };
  }

  /**
   * `stub` or `live`, recovered from the log rather than stored twice.
   *
   * server.ts writes "stub" or "model" as the ACTOR of the adjudicated entry - the
   * adjudicator is who acted - so the fact is already in the record for every
   * adjudication ever written, including the seeded ones. Reading it back costs
   * nothing and cannot drift from the entry it describes.
   *
   * A missing entry reads as `stub`, the cautious way round: labelling a real
   * adjudication as a stub makes a reader trust it less than they should, and
   * labelling a stub as real puts words that are explicitly not a judgment about a
   * compound onto a safety record as though they were one.
   */
  private adjudicationSource(caseId: string): "stub" | "live" {
    const entry = [...this.store.entries(caseId)].reverse().find((e) => e.kind === "adjudicated");
    return entry === undefined || entry.actorId === "stub" ? "stub" : "live";
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
        // The exact document join, and the client's ONLY reliable one. This route is
        // where the web app reads its findings from, so dropping the id here left the
        // reader's viewer matching a dossier identifier against a filename - a join
        // that never succeeded on any real case.
        ...(f.sourceDocumentId === undefined ? {} : { sourceDocumentId: f.sourceDocumentId }),
        ...(f.sourcePage === undefined ? {} : { sourcePage: f.sourcePage }),
        // Travels with the page number for the same reason the page number travels
        // with the document id: this route is where the reader gets its findings, and
        // a quote left behind here is a highlight the viewer cannot draw.
        ...(f.sourceQuote === undefined ? {} : { sourceQuote: f.sourceQuote }),
      })),
      absent: [...absentForAdjudication(inv), ...externalClaimsAsGaps(c)],
      // The other half of the same inventory. Feeds `consequenceBasis`, so a severity
      // verdict has to name measured consequence-half evidence rather than assert a
      // severity nobody established. External claims are deliberately NOT added here:
      // they arrive as gaps above because they are asserted-not-yet-in-evidence (§6.5),
      // and letting one carry a verdict would promote an uncited assertion to evidence.
      present: presentForAdjudication(inv),
    };
  }

  /**
   * Whether adjudicating this case could succeed, asked before anything is spent.
   *
   * Null for a case that does not exist, which the caller already renders as 404.
   */
  readyToAdjudicate(caseId: string): Result<DeliberationCase> | null {
    const c = this.store.getCase(caseId);
    return c === null ? null : canAdjudicate(c);
  }

  /**
   * `consensus` is stored, NOT logged into the entry payload.
   *
   * The `adjudicated` payload stays exactly the adjudication, because every record
   * already written - including the seeded ones - has that shape, and the audit view
   * reads it. Widening the payload would change what a hash covers for new entries
   * and leave old ones needing a second reader. The case snapshot is the projection,
   * so the projection is where a new field belongs.
   */
  adjudicate(caseId: string, adjudication: unknown, at: string, actorId: string, consensus: unknown = null): Result<DeliberationCase> {
    const c = this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "not_locked", detail: `No case ${caseId}.` } };
    const next = attachAdjudication(c, adjudication, consensus);
    if (!next.ok) return next;
    this.store.append({ at, kind: "adjudicated", caseId, actorId, payload: adjudication });
    this.store.putCase(next.value);
    return next;
  }

  /**
   * The adjudication as it was attached, for everybody who was not the person that ran it.
   *
   * WHY THIS IS A ROUTE AND NOT CLIENT STATE. The adjudication used to exist only in
   * the browser of whoever pressed the button: it came back in the POST response, was
   * held in React state, and was never fetched again. So a participant opening the
   * verdict stage saw nothing at all, and the owner lost it on reload - the case said
   * "adjudicated" and the screen for it was blank. Nothing was broken; it had simply
   * never been readable by anyone else.
   *
   * NO NEW DISCLOSURE. The `audit` route already returns the adjudicated entry whole
   * to every reader of the case, so this exposes nothing that was not reachable; it
   * exposes it in the shape a screen can render rather than as a log entry a client
   * would have to dig through.
   *
   * WHERE `source` COMES FROM. The server records the provenance in the log entry's
   * actor - "stub" when no model was called, "model" when one was - so it is recovered
   * from the chain rather than kept beside it. An adjudication whose entry cannot be
   * found is reported as a stub: the two errors are not symmetrical, and labelling a
   * stub as a model's judgment is the one that gets quoted.
   */
  adjudication(caseId: string): {
    adjudication: unknown;
    source: "stub" | "live";
    at: string | null;
    signature: Signature | null;
  } | null {
    const c = this.store.getCase(caseId);
    if (c === null || c.adjudication === null) return null;
    const entry = this.store.entries(caseId).filter((e) => e.kind === "adjudicated").at(-1);
    return {
      adjudication: c.adjudication,
      /* THROUGH `adjudicationSource`, NOT A SECOND RULE. This read `entry?.actorId ===
         "model" ? "live" : "stub"` while `view()` read `actorId === "stub" ? "stub" :
         "live"` - two implementations of one fact with OPPOSITE defaults, arrived at
         independently by two branches and auto-merged without a conflict because they
         sit in different methods. They agree on the two values server.ts writes today
         and disagree on every other, so the day something else writes that entry the
         printed record and the screen would label the same adjudication differently.
         A safety record and the screen it was printed from may not disagree about
         whether a model was called. */
      source: this.adjudicationSource(caseId),
      at: entry?.at ?? null,
      signature: c.signature,
    };
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
