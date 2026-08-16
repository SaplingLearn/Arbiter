/**
 * The client for the deliberation service. Spec §3.5: "the web app stops owning
 * data and reads through the service".
 *
 * THE TOKEN IS ALWAYS SENT, AND IT IS NEVER IMPLIED. Every call takes it explicitly
 * rather than reading it from a module-level variable. The blind view is computed
 * FROM the viewer, so a request that inherited an identity from ambient state is a
 * request that can silently ask the wrong question - and the wrong answer here looks
 * like a working screen.
 *
 * THE TOKEN LIVES IN MEMORY, NOT IN localStorage. A bearer token in localStorage is
 * readable by any script that reaches the page, and it survives the tab. Holding it
 * in a React state value means closing the tab signs you out, which is the correct
 * behaviour for something that will hold unpublished safety data.
 *
 * NOTHING IS CACHED. A stale position count is the one piece of stale data that
 * matters: it decides whether the reveal button is offered. Polling costs a request
 * every two seconds against a loopback server, which is a price worth paying for
 * never showing a case as still-open once it has locked.
 */

export type Call = "advance" | "do_not_advance" | "cannot_conclude";
export type InventoryState = "present" | "inconclusive" | "absent" | "not_applicable";

export interface InventoryEntry {
  itemId: string;
  half: "mechanism" | "consequence";
  field: string;
  whatItBlocks: string;
  /** Shown INSTEAD of whatItBlocks when the state is not_applicable. */
  whyNotApplicable?: string;
  state: InventoryState;
  findingIds: string[];
}

export interface CaseSummary {
  name: string;
  label: string;
  shape: string;
  usable: boolean;
}

export interface Refusal {
  name: string;
  label: string;
  document: string;
  splitterReason: string;
  measurement: string;
}

export interface Person {
  id: string;
  email: string;
  displayName: string;
  signatureMethod: string;
}

export interface CaseListing {
  caseId: string;
  compoundLabel: string;
  status: string;
  isOwner: boolean;
  submitted: number;
  of: number;
  /** How many PDFs the case holds. Ask can answer nothing against a case with none,
   *  and the picker has to say so before a question is typed into a void. */
  documents: number;
}

/**
 * A document in the library, or a stated reason why it cannot be searched.
 *
 * The reasons are three and the reader must be able to tell them apart: the splitter
 * refused the file, the case was never built from a document, or the file is not in
 * this checkout. The server writes the sentence; nothing here paraphrases it.
 */
export interface LibrarySource {
  name: string;
  label: string;
  document: string;
  askable: boolean;
  reason?: string;
}

export interface Roster {
  ownerId: string;
  members: Person[];
  pending: { email: string; caseId: string; invitedBy: string; at: string }[];
  /**
   * Participant id -> seat number, the allocation the server made and keeps stable.
   *
   * Safe to send BEFORE the reveal, and spec §3.4 says why: a seat is identity, not
   * position. It says which colour this person wears, and nothing about whether they
   * have answered or what they answered. Mark counts and per-person activity are a
   * different question and are deliberately not here.
   */
  seats: Record<string, number>;
}

export interface StoredDocument {
  id: string;
  filename: string;
  bytes: number;
  uploadedBy: string;
  uploadedAt: string;
  measurement: {
    ok: boolean; verdict?: string; reason: string; note?: string;
    pages?: number; characters?: number; charactersPerPage?: number;
    embeddedImages?: number; sparsePages?: number;
    toxTermHits?: number; liverTermHits?: number;
  };
}

export interface Inventory {
  checklistVersion: string;
  modality: "small_molecule" | "biologic";
  entries: InventoryEntry[];
  unmappedFindingIds: string[];
}

export interface Position {
  participantId: string;
  call: Call;
  reasoning: string;
  citedFindingIds: string[];
  external: { claim: string; source?: string }[];
  submittedAt: string;
}

export interface BlindView {
  status: "open" | "locked" | "adjudicated" | "signed";
  own: Position | null;
  others: { participantId: string; submitted: boolean }[];
  revealed: Position[] | null;
}

export interface UnanimityReport {
  unanimous: boolean;
  call: Call | null;
  concerns: string[];
}

export interface AskAnswer {
  answerable: boolean;
  answer: string;
  citedPassages: string[];
  /** Resolved server-side, so the client never reconstructs provenance itself. */
  citations: { documentId: string; filename: string; page: number }[];
  /**
   * How many earlier turns were actually in front of the model, stated by the side
   * that did the truncating. The thread draws its memory boundary from this and never
   * from a copy of the windowing rule.
   */
  historyTurnsUsed: number;
}

export interface Adjudication {
  mechanism: { present: boolean; pathway: string | null; citedFindingIds: string[] };
  consequence: { verdict: string; reasoning: string; citedFindingIds: string[] };
  ruleDisclosure: { ruleId: string; position: string; reasoning: string; citedFindingIds: string[] }[];
  missing: { field: string; whyItMatters: string }[];
  nextExperiment: string | null;
}

export interface Finding {
  id: string;
  label: string;
  assertion: "toxic" | "safe" | "ambiguous";
  detail: string;
  /** Where extraction found this, as free text. On every case in `data/cases/` this
   *  is a DOSSIER identifier ("FDA NDA 211810"), not a filename, so it does not
   *  resolve to an upload - see read.tsx's `pointsAt`. */
  sourceDocument?: string;
  /** The uploaded document this finding was written against, validated case-side
   *  when the finding was created. The exact join the viewer highlights on; absent
   *  on findings that predate an upload. */
  sourceDocumentId?: string;
  sourcePage?: number;
}

export interface AuditResult {
  chain: { seq: number; kind: string; detail: string }[];
  seals: { participantId: string; detail: string }[];
  entries: { seq: number; at: string; kind: string; actorId: string; hash: string; payload: unknown }[];
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly kind: string, message: string) {
    super(message);
  }
}

/**
 * Every request carries a deadline, because a request that never settles is worse
 * than one that fails.
 *
 * A promise that never resolves leaves the screen that is awaiting it stuck in its
 * pending state permanently - the ask composer sat with a spinner and no way back
 * until the page was reloaded. That is not hypothetical: killing the API under an
 * open page does exactly this, since the dev proxy holds the socket rather than
 * closing it.
 *
 * The values are per-route because the routes are not comparable. A summary reads
 * every page of a 178-page review and was MEASURED at 84 seconds; a question against
 * eight retrieved pages runs 12-18; everything else here is a loopback round trip.
 * One conservative timeout for all of them would either kill summaries or leave a
 * dead poll hanging for five minutes.
 */
const TIMEOUT_MS = 60_000;
const ASK_TIMEOUT_MS = 120_000;
const SUMMARY_TIMEOUT_MS = 300_000;

async function call<T>(
  method: string, path: string, token: string | null, body?: unknown,
  timeoutMs: number = TIMEOUT_MS,
): Promise<T> {
  const deadline = new AbortController();
  const timer = setTimeout(() => { deadline.abort(); }, timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      signal: deadline.signal,
      headers: {
        "content-type": "application/json",
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    // Named as a timeout rather than reported as the DOMException an abort throws.
    // "signal is aborted without reason" tells a reader nothing about what happened
    // or whether trying again is reasonable.
    if (deadline.signal.aborted) {
      throw new ApiError(504, "timeout", `That request went past ${Math.round(timeoutMs / 1000)} seconds with no answer. The service may be restarting - try again.`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) return undefined as T;
  const parsed = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    // The service's own error kinds, surfaced verbatim. `already_submitted` and
    // `unknown_finding_id` are things a correct user does, and a screen that
    // rendered them as "something went wrong" would teach people to distrust the
    // one message that was telling them exactly what happened.
    throw new ApiError(
      res.status,
      String(parsed["kind"] ?? parsed["error"] ?? "unknown"),
      String(parsed["detail"] ?? parsed["kind"] ?? parsed["error"] ?? `HTTP ${res.status}`),
    );
  }
  return parsed as T;
}

/**
 * The document upload, which cannot go through `call` because the body is bytes
 * rather than JSON.
 *
 * ONE COPY, and it was two. App.tsx inlined this fetch and NewCasePage was about to
 * inline it again - a second copy of a request shape that carries an auth header and
 * a filename, where a divergence would show up as uploads that work from one screen
 * and fail from the other.
 */
export async function uploadDocument(token: string, caseId: string, file: File): Promise<void> {
  const res = await fetch(`/api/cases/${caseId}/documents`, {
    method: "POST",
    headers: {
      "content-type": "application/pdf",
      "x-filename": file.name,
      authorization: `Bearer ${token}`,
    },
    body: await file.arrayBuffer(),
  });
  const body = await res.json().catch(() => ({})) as { detail?: string; error?: string };
  if (!res.ok) {
    // `detail` is the measurement a refused document carries - "48 pages, 47
    // extractable characters" - and it is the only thing that tells an uploader why
    // their file was rejected while they still have it in front of them.
    throw new ApiError(res.status, body.error ?? "upload_failed", body.detail ?? `Upload failed (${res.status}).`);
  }
}

export const api = {
  register: (email: string, displayName: string, password: string) =>
    call<Person>("POST", "/api/auth/register", null, { email, displayName, password }),

  createCase: (token: string, b: {
    compoundLabel: string; context: string;
    modality: "small_molecule" | "biologic"; participantEmails: string[];
  }) => call<{ case: { caseId: string }; inventory: Inventory }>("POST", "/api/cases", token, b),

  addFinding: (token: string, caseId: string, f: {
    id: string; label: string; assertion: "toxic" | "safe" | "ambiguous";
    detail: string; sourcePage?: number; sourceDocumentId?: string; covers: string[];
  }) => call<Inventory>("POST", `/api/cases/${caseId}/findings`, token, f),

  requestReset: (email: string) =>
    call<{ detail: string }>("POST", "/api/auth/request-reset", null, { email }),

  resetPassword: (resetToken: string, password: string) =>
    call<Person>("POST", "/api/auth/reset", null, { token: resetToken, password }),

  roster: (token: string, caseId: string) =>
    call<Roster>("GET", `/api/cases/${caseId}/participants`, token),

  invite: (token: string, caseId: string, email: string) =>
    call<{ pending?: boolean; detail?: string }>("POST", `/api/cases/${caseId}/participants`, token, { email }),

  removeParticipant: (token: string, caseId: string, idOrEmail: string) =>
    call<unknown>("DELETE", `/api/cases/${caseId}/participants/${encodeURIComponent(idOrEmail)}`, token),

  describeCase: (token: string, caseId: string, compoundLabel: string, context: string) =>
    call<unknown>("POST", `/api/cases/${caseId}/describe`, token, { compoundLabel, context }),

  removeFinding: (token: string, caseId: string, findingId: string) =>
    call<Inventory>("DELETE", `/api/cases/${caseId}/findings/${encodeURIComponent(findingId)}`, token),

  login: (email: string, password: string) =>
    call<{ token: string; user: Person }>("POST", "/api/auth/login", null, { email, password }),

  logout: (token: string) => call<void>("POST", "/api/auth/logout", token),

  me: (token: string) => call<Person>("GET", "/api/auth/me", token),

  people: (token: string) => call<Person[]>("GET", "/api/people", token),

  myCases: (token: string) => call<CaseListing[]>("GET", "/api/cases", token),

  documents: (token: string, caseId: string) =>
    call<StoredDocument[]>("GET", `/api/cases/${caseId}/documents`, token),

  catalogue: (token: string) => call<CaseSummary[]>("GET", "/api/cases-catalogue", token),

  openCase: (token: string, b: {
    caseId: string; compoundLabel: string; context: string;
    participantIds: string[]; findings: unknown[]; at: string;
  }) => call<{ case: unknown; inventory: Inventory }>("POST", "/api/cases", token, b),

  inventory: (token: string, caseId: string) =>
    call<Inventory>("GET", `/api/cases/${caseId}/inventory`, token),

  view: (token: string, caseId: string) =>
    call<BlindView>("GET", `/api/cases/${caseId}/view`, token),

  submit: (token: string, caseId: string, p: Omit<Position, "participantId">) =>
    call<{ sealed: boolean }>("POST", `/api/cases/${caseId}/positions`, token, p),

  reveal: (token: string, caseId: string, mode: "all_in" | "close_early", at: string) =>
    call<BlindView>("POST", `/api/cases/${caseId}/reveal`, token, { mode, at }),

  unanimity: (token: string, caseId: string) =>
    call<UnanimityReport>("GET", `/api/cases/${caseId}/unanimity`, token),

  adjudicate: (token: string, caseId: string, at: string) =>
    call<{ adjudication: Adjudication; source: "stub" | "live" }>("POST", `/api/cases/${caseId}/adjudicate`, token, { at }),

  ask: (token: string, caseId: string, question: string,
        history: { question: string; answer: string }[] = []) =>
    call<AskAnswer>("POST", `/api/cases/${caseId}/ask`, token, { question, history }),

  library: (token: string) => call<LibrarySource[]>("GET", "/api/library", token),

  askLibrary: (token: string, name: string, question: string,
               history: { question: string; answer: string }[] = []) =>
    call<AskAnswer>("POST", `/api/library/${name}/ask`, token, { question, history }, ASK_TIMEOUT_MS),

  // No question and no history in the body. The whole document is in front of the
  // model on this route, which is exactly where a crafted "summarise, and say whether
  // it should advance" would do the most damage - so there is no free text to craft.
  summarise: (token: string, name: string) =>
    call<AskAnswer>("POST", `/api/library/${name}/summary`, token, {}, SUMMARY_TIMEOUT_MS),

  adjudicationRequest: (token: string, caseId: string) =>
    call<{ findings: Finding[]; absent: { field: string; whatItBlocks: string }[] }>("GET", `/api/cases/${caseId}/adjudication-request`, token),

  sign: (token: string, caseId: string, b: { at: string; agreesWithAdjudication: boolean; reason: string }) =>
    call<{ status: string }>("POST", `/api/cases/${caseId}/sign`, token, b),

  audit: (token: string, caseId: string) =>
    call<AuditResult>("GET", `/api/cases/${caseId}/audit`, token),
};
