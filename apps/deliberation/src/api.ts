/**
 * The client for the deliberation service. Spec §3.5: "the web app stops owning
 * data and reads through the service".
 *
 * THE ACTOR IS ALWAYS SENT, AND IT IS NEVER IMPLIED. Every call takes the persona
 * explicitly rather than reading it from a module-level variable. The blind view is
 * computed FROM the viewer, so a request that inherited an actor from ambient state
 * is a request that can silently ask the wrong question - and the wrong answer here
 * looks like a working screen.
 *
 * NOTHING IS CACHED. A stale position count is the one piece of stale data that
 * matters: it decides whether the reveal button is offered. Polling costs a request
 * every two seconds against a loopback server, which is a price worth paying for
 * never showing a case as still-open once it has locked.
 */

export type Call = "advance" | "do_not_advance" | "cannot_conclude";
export type InventoryState = "present" | "inconclusive" | "absent";

export interface InventoryEntry {
  itemId: string;
  half: "mechanism" | "consequence";
  field: string;
  whatItBlocks: string;
  state: InventoryState;
  findingIds: string[];
}

export interface Inventory {
  checklistVersion: string;
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

async function call<T>(method: string, path: string, actor: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-arbiter-user": actor },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
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
  openCase: (actor: string, b: {
    caseId: string; compoundLabel: string; context: string;
    participantIds: string[]; findings: unknown[]; at: string;
  }) => call<{ case: unknown; inventory: Inventory }>("POST", "/api/cases", actor, b),

  inventory: (actor: string, caseId: string) =>
    call<Inventory>("GET", `/api/cases/${caseId}/inventory`, actor),

  view: (actor: string, caseId: string) =>
    call<BlindView>("GET", `/api/cases/${caseId}/view`, actor),

  submit: (actor: string, caseId: string, p: Omit<Position, "participantId">) =>
    call<{ sealed: boolean }>("POST", `/api/cases/${caseId}/positions`, actor, p),

  reveal: (actor: string, caseId: string, mode: "all_in" | "close_early", at: string) =>
    call<BlindView>("POST", `/api/cases/${caseId}/reveal`, actor, { mode, at }),

  unanimity: (actor: string, caseId: string) =>
    call<UnanimityReport>("GET", `/api/cases/${caseId}/unanimity`, actor),

  adjudicate: (actor: string, caseId: string, at: string) =>
    call<{ adjudication: Adjudication; source: "stub" | "live" }>("POST", `/api/cases/${caseId}/adjudicate`, actor, { at }),

  adjudicationRequest: (actor: string, caseId: string) =>
    call<{ findings: Finding[]; absent: { field: string; whatItBlocks: string }[] }>("GET", `/api/cases/${caseId}/adjudication-request`, actor),

  sign: (actor: string, caseId: string, b: { at: string; agreesWithAdjudication: boolean; reason: string }) =>
    call<{ status: string }>("POST", `/api/cases/${caseId}/sign`, actor, b),

  audit: (actor: string, caseId: string) =>
    call<AuditResult>("GET", `/api/cases/${caseId}/audit`, actor),
};
