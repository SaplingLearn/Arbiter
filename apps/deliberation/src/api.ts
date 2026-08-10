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
}

export interface Roster {
  ownerId: string;
  members: Person[];
  pending: { email: string; caseId: string; invitedBy: string; at: string }[];
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

async function call<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
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

  adjudicationRequest: (token: string, caseId: string) =>
    call<{ findings: Finding[]; absent: { field: string; whatItBlocks: string }[] }>("GET", `/api/cases/${caseId}/adjudication-request`, token),

  sign: (token: string, caseId: string, b: { at: string; agreesWithAdjudication: boolean; reason: string }) =>
    call<{ status: string }>("POST", `/api/cases/${caseId}/sign`, token, b),

  audit: (token: string, caseId: string) =>
    call<AuditResult>("GET", `/api/cases/${caseId}/audit`, token),
};
