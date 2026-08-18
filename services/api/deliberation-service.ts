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

/**
 * `stub` or `live`, from the adjudicated log entry, and THE ONLY RULE IN THE CODEBASE
 * THAT DECIDES THIS.
 *
 * `server.ts` records the provenance as the ACTOR of the entry - "stub" when no model was
 * called, "model" when one was - so the fact is already in the chain for every
 * adjudication ever written, including the seeded ones. Reading it back costs nothing and
 * cannot drift from the entry it describes.
 *
 * FAILS TOWARD `stub`, for anything that is not exactly "model" and for a missing entry
 * alike, and the asymmetry is the whole reason this is one function. The two errors are
 * not equivalent: labelling a real adjudication a stub makes a reader trust it less than
 * they should, while labelling a stub as a model's judgment puts words that are explicitly
 * not a finding about a compound onto a safety record as though they were one. Only the
 * second one gets quoted.
 *
 * There were briefly two versions of this - `view`'s treated any unrecognised actor as
 * live, the report's treated only "model" as live - and they arrived from two branches
 * that merged without a conflict. Every writer passes exactly "stub" or "model", so
 * nothing observable differed; what differed was which answer a future third writer would
 * have got, on two screens that both claim to describe the same adjudication.
 */
function sourceOf(entry: LogEntry | undefined): "stub" | "live" {
  return entry?.actorId === "model" ? "live" : "stub";
}

export class DeliberationService {
  constructor(
    private readonly store: DeliberationStore,
    private readonly checklist: EvidenceChecklist,
  ) {}

  async open(init: {
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
  }): Promise<{ case: DeliberationCase; inventory: Inventory }> {
    const c = openCase(init);
    await this.store.append({
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
    await this.store.append({
      at: init.at, kind: "inventory_published", caseId: c.caseId, actorId: c.ownerId,
      payload: inventory,
    });

    this.findings.set(c.caseId, init.findings);
    this.inventories.set(c.caseId, inventory);
    this.modalities.set(c.caseId, init.modality ?? "small_molecule");
    await this.store.putCase(c);
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
  private async findingsOf(caseId: string): Promise<CoveringFinding[]> {
    const cached = this.findings.get(caseId);
    if (cached !== undefined) return cached;
    const opened = (await this.store.entries(caseId)).filter((e) => e.kind === "case_opened").at(-1);
    const recovered = ((opened?.payload as { findings?: CoveringFinding[] } | undefined)?.findings) ?? [];
    this.findings.set(caseId, recovered);
    return recovered;
  }

  /** The inventory as published. Never recomputed - see `open`. */
  async inventory(caseId: string): Promise<Inventory | null> {
    const cached = this.inventories.get(caseId);
    if (cached !== undefined) return cached;
    // The LATEST publication, not the first: adding a finding appends a new one, and
    // reading the first would serve an inventory that has since been superseded.
    const published = (await this.store.entries(caseId)).filter((e) => e.kind === "inventory_published");
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
  async addFinding(caseId: string, finding: CoveringFinding): Promise<Result<Inventory>> {
    const guard = await this.evidenceGuard(caseId);
    if (!guard.ok) return guard;

    const current = await this.findingsOf(caseId);
    if (current.some((f) => f.id === finding.id)) {
      return { ok: false, error: { kind: "duplicate_finding", detail: `This case already has a finding called "${finding.id}".` } };
    }
    return { ok: true, value: await this.republish(caseId, [...current, finding], guard.value) };
  }

  async removeFinding(caseId: string, findingId: string): Promise<Result<Inventory>> {
    const guard = await this.evidenceGuard(caseId);
    if (!guard.ok) return guard;

    const current = await this.findingsOf(caseId);
    if (!current.some((f) => f.id === findingId)) {
      return { ok: false, error: { kind: "no_such_finding", detail: `No finding called "${findingId}" in this case.` } };
    }
    return { ok: true, value: await this.republish(caseId, current.filter((f) => f.id !== findingId), guard.value) };
  }

  private async evidenceGuard(caseId: string): Promise<Result<DeliberationCase>> {
    const c = await this.store.getCase(caseId);
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

  private async republish(caseId: string, findings: CoveringFinding[], c: DeliberationCase): Promise<Inventory> {
    const modality = await this.modalityOf(caseId);
    const inventory = buildInventory(findings, this.checklist, modality);
    // Appended, never rewritten: the log keeps every version of the inventory that
    // was ever published, and `inventory()` reads the latest. An edited entry would
    // break the chain, which is the point of the chain.
    await this.store.append({
      at: new Date(0).toISOString(), kind: "case_opened", caseId, actorId: c.ownerId,
      payload: { compoundLabel: c.compoundLabel, context: c.context, participantIds: c.participantIds, seats: c.seats, findings, modality },
    });
    await this.store.append({
      at: new Date(0).toISOString(), kind: "inventory_published", caseId, actorId: c.ownerId,
      payload: inventory,
    });
    this.findings.set(caseId, findings);
    this.inventories.set(caseId, inventory);
    return inventory;
  }

  private async modalityOf(caseId: string): Promise<Modality> {
    const cached = this.modalities.get(caseId);
    if (cached !== undefined) return cached;
    const opened = (await this.store.entries(caseId)).find((e) => e.kind === "case_opened");
    const m = (opened?.payload as { modality?: Modality } | undefined)?.modality ?? "small_molecule";
    this.modalities.set(caseId, m);
    return m;
  }

  async submit(caseId: string, p: Position): Promise<Result<DeliberationCase>> {
    const c = await this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "not_open", detail: `No case ${caseId}.` } };

    const known = new Set((await this.findingsOf(caseId)).map((f) => f.id));
    const next = submitPosition(c, p, known);
    if (!next.ok) return next;

    // Sealed first. The commitment is the only thing that goes in the log while the
    // case is open: the log stays publishable to a participant mid-deliberation
    // without revealing an answer, which is what makes the blindness auditable
    // rather than merely asserted.
    const stored = next.value.positions.find((x) => x.participantId === p.participantId)!;
    await this.store.append({
      at: p.submittedAt, kind: "position_sealed", caseId, actorId: p.participantId,
      payload: { participantId: p.participantId, commitment: commitmentFor(stored) },
    });
    await this.store.putCase(next.value);
    return next;
  }

  /** The raw case, for the access check in the server. Deliberately not a view:
   *  access control asks who is named on the case, which is not a question about
   *  what a given viewer is allowed to see. */
  async getCase(caseId: string): Promise<DeliberationCase | null> {
    return this.store.getCase(caseId);
  }

  /** Cases this account is named on, owner or participant. Nothing else, ever -
   *  a list endpoint that leaked case labels would undo the access boundary in the
   *  one place people go looking. */
  async casesFor(userId: string): Promise<{ caseId: string; compoundLabel: string; status: string; isOwner: boolean; submitted: number; of: number; youSubmitted: boolean }[]> {
    return visibleCases(await this.store.allCases(), userId).map((c) => ({
      caseId: c.caseId,
      compoundLabel: c.compoundLabel,
      status: c.status,
      isOwner: c.ownerId === userId,
      // Counts of WHO HAS ANSWERED, never of what they said. The same rule as the
      // blind view: a tally of calls drags as hard as the positions themselves.
      submitted: c.positions.length,
      of: c.participantIds.length,
      /**
       * WHETHER THIS VIEWER HAS ANSWERED - one bit, about themselves, and the count
       * above cannot substitute for it.
       *
       * `submitted < of` was what the dashboard had to reason from, and it is true of a
       * case where three of four have answered whether or not the viewer is one of the
       * three. So a participant who had already submitted went on being told the case
       * needed their position, on the screen whose entire job is answering "what is
       * waiting on me".
       *
       * DISCLOSING NOTHING THE BLIND SUBMISSION PROTECTS, and the argument is one this
       * codebase already made for the same fact: `Layout.tsx`'s `Steps` shows a reader
       * their own mark count on the grounds that own activity is not an aggregate over
       * other people. Your own submission is the thing you are most certain of. What
       * would be a disclosure - which of the OTHERS have answered - stays out, as it
       * does from `visibleTo` until the reveal.
       *
       * False for the convener, who holds no position at all rather than an unanswered
       * one. `isOwner` beside it is what tells those two apart; overloading this field
       * with a third state would put that distinction in the wrong place.
       */
      youSubmitted: c.positions.some((p) => p.participantId === userId),
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
  private async mutate(
    caseId: string, actorId: string, at: string, kind: LogKind,
    payload: (next: DeliberationCase) => unknown,
    f: (c: DeliberationCase) => Result<DeliberationCase>,
  ): Promise<Result<DeliberationCase>> {
    const c = await this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "not_open", detail: `No case ${caseId}.` } };
    const next = f(c);
    if (!next.ok) return next;
    await this.store.append({ at, kind, caseId, actorId, payload: payload(next.value) });
    await this.store.putCase(next.value);
    return next;
  }

  async addParticipant(caseId: string, userId: string, actorId: string, at: string): Promise<Result<DeliberationCase>> {
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

  async removeParticipant(caseId: string, userId: string, actorId: string, at: string): Promise<Result<DeliberationCase>> {
    return this.mutate(caseId, actorId, at, "participant_removed", () => ({ participantId: userId }),
      (c) => removeParticipant(c, userId));
  }

  async describe(caseId: string, compoundLabel: string, context: string, actorId: string, at: string): Promise<Result<DeliberationCase>> {
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
  async view(caseId: string, viewerId: string): Promise<CaseView | null> {
    const c = await this.store.getCase(caseId);
    if (c === null) return null;
    return {
      ...visibleTo(c, viewerId),
      // `?? null` rather than the bare field: cases persisted before `consensus`
      // existed have no such key, and `undefined` disappears through JSON.stringify -
      // so the API would omit the field entirely rather than report "not recorded".
      adjudication: c.adjudication ?? null,
      adjudicationSource: (c.adjudication ?? null) === null ? null : await this.adjudicationSource(caseId),
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
  private async adjudicationSource(caseId: string): Promise<"stub" | "live"> {
    const entry = [...await this.store.entries(caseId)].reverse().find((e) => e.kind === "adjudicated");
    return sourceOf(entry);
  }

  /* `sourceOf` is a module-level function below rather than another method, because what
     makes it safe is that there is exactly one of it - and a second method beside this
     one is how there came to be two rules in the first place. */

  async reveal(caseId: string, by: string, at: string, mode: "all_in" | "close_early"): Promise<Result<DeliberationCase>> {
    const c = await this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "not_open", detail: `No case ${caseId}.` } };

    const next = mode === "all_in" ? lock(c) : closeEarly(c, by, at);
    if (!next.ok) return next;

    await this.store.append({
      at, kind: "revealed", caseId, actorId: by,
      payload: { positions: next.value.positions, closedEarly: next.value.closedEarly },
    });
    await this.store.putCase(next.value);
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
  async adjudicationRequest(caseId: string, rules: AdjudicateRequest["rules"]): Promise<AdjudicateRequest | null> {
    const c = await this.store.getCase(caseId);
    const inv = await this.inventory(caseId);
    if (c === null || inv === null) return null;
    const findings = await this.findingsOf(caseId);

    return {
      compoundLabel: c.compoundLabel,
      context: c.context,
      rules,
      findings: findings.map((f) => ({
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
  async readyToAdjudicate(caseId: string): Promise<Result<DeliberationCase> | null> {
    const c = await this.store.getCase(caseId);
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
  async adjudicate(caseId: string, adjudication: unknown, at: string, actorId: string, consensus: unknown = null): Promise<Result<DeliberationCase>> {
    const c = await this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "not_locked", detail: `No case ${caseId}.` } };
    const next = attachAdjudication(c, adjudication, consensus);
    if (!next.ok) return next;
    await this.store.append({ at, kind: "adjudicated", caseId, actorId, payload: adjudication });
    await this.store.putCase(next.value);
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
   * WHERE `source` COMES FROM: `sourceOf`, the SAME function `view` reads it through.
   * That shared call is a correction rather than tidiness. Two branches fixed the same
   * bug - the verdict living only in the tab that pressed Adjudicate - and each brought
   * its own provenance rule: `view`'s said anything that is not literally "stub" is live,
   * this one's said only literally "model" is live. Opposite defaults for an unrecognised
   * actor, and they auto-merged without a conflict, so the verdict screen and the printed
   * record could have disagreed about whether a safety adjudication came from a model.
   * One rule, in one place, is the only version of this that cannot drift.
   */
  async adjudication(caseId: string): Promise<{
    adjudication: unknown;
    source: "stub" | "live";
    at: string | null;
    signature: Signature | null;
  } | null> {
    const c = await this.store.getCase(caseId);
    if (c === null || c.adjudication === null) return null;
    const entry = (await this.store.entries(caseId)).filter((e) => e.kind === "adjudicated").at(-1);
    return {
      adjudication: c.adjudication,
      source: sourceOf(entry),
      at: entry?.at ?? null,
      signature: c.signature,
    };
  }

  async signOff(caseId: string, s: Signature): Promise<Result<DeliberationCase>> {
    const c = await this.store.getCase(caseId);
    if (c === null) return { ok: false, error: { kind: "no_adjudication", detail: `No case ${caseId}.` } };
    const next = sign(c, s);
    if (!next.ok) return next;
    await this.store.append({ at: s.at, kind: "signed", caseId, actorId: s.by, payload: s });
    await this.store.putCase(next.value);
    return next;
  }

  async unanimity(caseId: string): Promise<UnanimityReport | null> {
    const c = await this.store.getCase(caseId);
    const inv = await this.inventory(caseId);
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
  async audit(caseId: string): Promise<{ chain: ReturnType<typeof verifyChain>; seals: ReturnType<typeof verifySeals>; entries: LogEntry[] }> {
    const c = await this.store.getCase(caseId);
    const entries = await this.store.entries(caseId);
    return {
      // The WHOLE log, not this case's slice: a per-case slice has holes wherever
      // another case interleaved, and every link across a hole would read as broken.
      chain: verifyChain(await this.store.all()),
      seals: verifySeals(entries, c?.positions ?? []),
      entries,
    };
  }
}
