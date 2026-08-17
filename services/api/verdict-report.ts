import type { Adjudication, Finding } from "./adjudicate.js";
import {
  disagreementReport,
  type CaseStatus, type DeliberationCase, type DisagreementReport, type Position,
  type Signature, type UnanimityReport,
} from "./deliberation.js";
import type { Inventory } from "./inventory.js";

/**
 * The deliberation record, assembled as one object a person can be handed.
 *
 * WHY THIS EXISTS. Everything this product knows about a closed case lives on four
 * screens behind an authenticated session: the positions on the reveal, the
 * adjudication on the verdict tab, the gaps on the evidence stage, the chain on the
 * record. The people who have to READ a safety decision - a programme lead, a
 * regulator, whoever inherits the compound in two years - are not going to click four
 * tabs, and half of them will never have a session. Until this existed the honest
 * answer to "send me what the panel concluded" was a screenshot, which carries the
 * verdict, drops the dissent, and can be checked against nothing.
 *
 * THIS FILE ASSEMBLES; IT DOES NOT RENDER. It was a server-side HTML template printed
 * through a headless browser, and that was one moving part too many: a browser binary
 * on the server for a document the reader's own browser can print, and a second
 * stylesheet that had to be kept looking like the product without being able to use
 * any of it. The record is now JSON, the preview is a page in the app built from the
 * app's own design system, and printing is Chrome's - which is where "save as PDF"
 * already lives and always worked.
 *
 * EVERY FIGURE COMES FROM THE RECORD, and nothing is summarised. There is no model
 * call on this path and there must never be one: a model condensing four positions
 * into a paragraph would be choosing which dissent to carry, on the artefact most
 * likely to be the only thing anybody reads, in the same fluent voice as the
 * adjudication it sits beside.
 */

/** One person, as the document names them. The seat is what colours them everywhere
 *  in the product, and it travels so the page can wear the same badge. */
export interface ReportPerson {
  id: string;
  displayName: string;
  email: string;
  seat: number | null;
}

export interface CaseReport {
  caseId: string;
  compoundLabel: string;
  context: string;
  status: CaseStatus;
  owner: ReportPerson;
  /** Everyone named on the case, in seat order - the order every other screen shows
   *  them in. Ordering by call would group the room into camps on the page. */
  panel: ReportPerson[];
  /** As revealed, in the order the record holds them. Deliberately not submission
   *  order: first to answer reads as most confident and last as most considered, and
   *  neither is information about the compound. */
  positions: Position[];
  /** Named, not merely absent. A case closed without somebody has to say so, or the
   *  panel reads as unanimous when one member never answered. */
  closedEarly: { by: string; at: string; nonResponders: string[] } | null;
  findings: Finding[];
  inventory: Inventory;
  unanimity: UnanimityReport;
  disagreement: DisagreementReport | null;
  adjudication: Adjudication;
  /** A stub is labelled on the page in the largest warning the document has. An
   *  unlabelled stub is the most dangerous artefact this repo could emit: it looks
   *  exactly like a judgment about a compound. */
  adjudicationSource: "stub" | "live";
  adjudicatedAt: string | null;
  signature: Signature | null;
  audit: {
    chainFailures: number;
    sealFailures: number;
    entries: number;
    headHash: string | null;
  };
  /** Who asked for it. A document that leaves the system says who made it. */
  generatedBy: ReportPerson;
  generatedAt: string;
}

/**
 * Assemble the record. Pure, so every honest detail in it can be enumerated in a test:
 * that a non-responder is named, that a deleted account still prints, that an
 * adjudication whose provenance the log cannot confirm is called a stub.
 */
export function buildCaseReport(args: {
  kase: DeliberationCase;
  positions: Position[];
  inventory: Inventory;
  findings: Finding[];
  unanimity: UnanimityReport;
  adjudication: Adjudication;
  adjudicationSource: "stub" | "live";
  adjudicatedAt: string | null;
  signature: Signature | null;
  audit: { chainFailures: number; sealFailures: number; entries: { hash: string }[] };
  /** Display names live in the auth store, which the deliberation service knows
   *  nothing about. Passed in rather than looked up, so this stays pure. */
  person: (id: string) => { displayName: string; email: string } | null;
  generatedById: string;
  generatedAt: string;
  /**
   * Who the assembled record is for.
   *
   * REDACTION HAPPENS HERE, not in the rendering. A field absent from the page but
   * present in the response body is one devtools tab from being disclosed, and the
   * public path answers to anybody holding a URL - there is no session on that path to
   * gate what the browser already received. So the cut is made while the object is
   * still being built, not by a page that later chooses not to draw a field.
   *
   * THE ADDRESS IS THE ONLY THING CUT. Names and seats stay on the public copy, because
   * attribution IS the record: a position without an author is a rumour, not a
   * deliberation. An email is a way to reach someone outside the product, which a
   * stranger holding a link has no standing to be handed - a display name and a seat
   * are not.
   */
  audience: "case" | "public";
}): CaseReport {
  const { kase } = args;
  const person = (id: string): ReportPerson => {
    const p = args.person(id);
    return {
      id,
      // An account that has been deleted still has positions in the record, and the
      // record must still print. The id is not a name and does not pretend to be.
      displayName: p?.displayName ?? id,
      email: args.audience === "public" ? "" : (p?.email ?? ""),
      seat: kase.seats[id] ?? null,
    };
  };

  return {
    caseId: kase.caseId,
    compoundLabel: kase.compoundLabel,
    context: kase.context,
    status: kase.status,
    owner: person(kase.ownerId),
    panel: [...kase.participantIds]
      .map(person)
      .sort((a, b) => (a.seat ?? Number.MAX_SAFE_INTEGER) - (b.seat ?? Number.MAX_SAFE_INTEGER)),
    positions: args.positions,
    closedEarly: kase.closedEarly,
    findings: args.findings,
    inventory: args.inventory,
    unanimity: args.unanimity,
    disagreement: disagreementReport(kase),
    adjudication: args.adjudication,
    adjudicationSource: args.adjudicationSource,
    adjudicatedAt: args.adjudicatedAt,
    signature: args.signature,
    audit: {
      chainFailures: args.audit.chainFailures,
      sealFailures: args.audit.sealFailures,
      // This case's entries. The chain itself is verified over the WHOLE log - a
      // per-case slice has holes wherever another case interleaved - but the count
      // and the head hash a reader would go and check are this case's.
      entries: args.audit.entries.length,
      headHash: args.audit.entries.at(-1)?.hash ?? null,
    },
    generatedBy: person(args.generatedById),
    generatedAt: args.generatedAt,
  };
}

/**
 * What the printed document is called, for the reader who saves it.
 *
 * NAMED AFTER THE COMPOUND, not the case id: a folder of `case_1174288393.pdf` is a
 * folder nobody can search. Chrome takes its default filename from `document.title`,
 * so the preview page sets this as its title while it is open - which is the only
 * lever any web page has over the name in the save dialog.
 */
export function reportTitle(r: Pick<CaseReport, "compoundLabel" | "caseId" | "generatedAt">): string {
  const slug = r.compoundLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const day = /^\d{4}-\d{2}-\d{2}/.exec(r.generatedAt)?.[0] ?? "undated";
  return `arbiter-${slug === "" ? r.caseId.replace(/[^a-zA-Z0-9]+/g, "-") : slug}-${day}`;
}
