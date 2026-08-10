import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { DeliberationService } from "./deliberation-service.js";
import { FileStore } from "./store.js";
import type { Position } from "./deliberation.js";
import type { CoveringFinding, EvidenceChecklist, Modality } from "./inventory.js";
import { handleAdjudicate, type AdjudicateRequest } from "./adjudicate.js";
import { completeFromEnv } from "./interpret.js";
import { stubComplete } from "./probe.js";
import { CATALOGUE, isCaseName, loadCase, refusalFor } from "./cases.js";
import { AuthStore, normaliseEmail, type PublicUser } from "./auth.js";
import { DEMO_TEAM } from "./seed-demo.js";
import { DocumentStore, MAX_BYTES } from "./documents.js";
import { can, denial, type CaseAction } from "./access.js";
import { InviteStore } from "./invites.js";
import { LoginThrottle } from "./throttle.js";

/**
 * The deliberation API.
 *
 * IDENTITY IS A BEARER TOKEN, ISSUED AGAINST A PASSWORD. Until 2026-08-09 it was an
 * `x-arbiter-user` header the server took at its word, which meant blind submission
 * held against the UI and against an honest participant and against nobody else.
 * `auth.ts` closes that; `access.ts` decides what an identified caller may touch.
 *
 * STILL LOOPBACK ONLY, and that is now a smaller claim than it was. Real
 * authentication is in place, but there is no TLS here, so a bearer token would
 * cross the network in clear text. Binding to 127.0.0.1 is what makes that
 * acceptable rather than negligent. Putting this on a network means terminating TLS
 * in front of it first, and that decision belongs to whoever deploys it.
 *
 * Every mutating route returns the service's own error kinds. A rejected submission
 * is an ordinary 409, not a 500: submitting twice, or citing something that is not
 * in the case, are things a correct client does occasionally and a user must see.
 */

const HOST = "127.0.0.1";

export interface ServerDeps {
  service: DeliberationService;
  auth: AuthStore;
  documents: DocumentStore;
  invites: InviteStore;
  throttle: LoginThrottle;
  rules: AdjudicateRequest["rules"];
  prompt: { system: string[]; userTemplate: string[] };
  now?: () => number;
}

const ERROR_STATUS: Record<string, number> = {
  not_open: 409, not_locked: 409, not_a_participant: 403, already_submitted: 409,
  unknown_finding_id: 400, empty_reasoning: 400, not_all_submitted: 409,
  not_the_owner: 403, no_adjudication: 409, override_needs_reason: 400, already_signed: 409,
  evidence_frozen: 409, no_such_finding: 404, duplicate_finding: 409,
  already_a_participant: 409, not_on_the_case: 404, has_answered: 409,
};

const AUTH_STATUS: Record<string, number> = {
  email_taken: 409, invalid_credentials: 401, weak_password: 400,
  bad_email: 400, no_session: 401, session_expired: 401,
  bad_reset_token: 400, rate_limited: 429,
};

/** A small stable hash for generating a case identifier from its own content, so two
 *  cases opened in the same second by the same person do not collide. */
function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    // A body limit, because an unbounded read is a way to take the process down
    // with one request and this listens on a socket.
    if (size > limit) throw new Error("body_too_large");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers["authorization"];
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m === null ? null : m[1]!;
}

export function makeHandler(deps: ServerDeps) {
  const now = deps.now ?? ((): number => Date.now());

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    const parts = url.pathname.split("/").filter((p) => p !== "");
    const method = req.method ?? "GET";

    if (parts[0] !== "api") return json(res, 404, { error: "not_found" });

    // Uploads get the document limit; everything else gets a small JSON limit, so a
    // 80 MB body cannot be posted at a route that expects a few hundred bytes.
    const isUpload = parts[3] === "documents" && method === "POST";
    let raw: Buffer;
    try {
      raw = await readRaw(req, isUpload ? MAX_BYTES : 2_000_000);
    } catch {
      return json(res, 413, { error: "body_too_large" });
    }

    let body: unknown;
    if (!isUpload && raw.length > 0) {
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        return json(res, 400, { error: "bad_json" });
      }
    }

    try {
      // ---- auth, the only unauthenticated surface ---------------------------
      if (parts[1] === "auth") {
        return handleAuth(deps, res, parts[2], method, body, bearer(req), now(),
          req.socket.remoteAddress ?? "unknown");
      }

      // The catalogue names no case contents and no positions, so it is readable by
      // anyone signed in - but not by anyone at all, because it describes what this
      // deployment holds.
      const session = deps.auth.resolve(bearer(req), now());
      if (!session.ok) {
        return json(res, AUTH_STATUS[session.error.kind] ?? 401, session.error);
      }
      const user = session.value;

      if (parts[1] === "cases-catalogue" && method === "GET") return json(res, 200, CATALOGUE);

      // Display names for rendering. Ids are what the record stores; a screen full of
      // `u_9f2a…` is unreadable, and mapping them client-side needs this list.
      if (parts[1] === "people" && method === "GET") return json(res, 200, deps.auth.list());

      if (parts[1] === "demo" && method === "POST") return handleDemo(deps, res, body, user, now());

      if (parts[1] !== "cases") return json(res, 404, { error: "not_found" });

      // POST /api/cases
      if (parts.length === 2 && method === "POST") {
        const b = body as {
          caseId?: string; compoundLabel: string; context: string;
          participantEmails?: string[]; participantIds?: string[];
          findings?: CoveringFinding[]; modality?: Modality;
        };
        if (typeof b.compoundLabel !== "string" || b.compoundLabel.trim() === "") {
          return json(res, 400, { error: "bad_request", detail: "A case needs a compound name." });
        }

        // Participants are named by EMAIL, because that is what a person knows about
        // a colleague. Unknown addresses are reported back rather than silently
        // dropped - a case that quietly opened without the one person who disagrees
        // is the failure this whole product exists to prevent.
        const emails = b.participantEmails ?? [];
        const resolved: string[] = [...(b.participantIds ?? [])];
        const unknown: string[] = [];
        for (const email of emails) {
          const p = deps.auth.findByEmail(email);
          if (p === null) unknown.push(email);
          else resolved.push(p.id);
        }
        if (unknown.length > 0) {
          return json(res, 422, {
            error: "unknown_participants", unknown,
            detail: `No account for ${unknown.join(", ")}. They need to register before they can be added.`,
          });
        }
        if (resolved.length === 0) {
          return json(res, 400, { error: "bad_request", detail: "A case needs at least one participant. One person deciding alone does not need this." });
        }

        const caseId = b.caseId ?? `case_${Math.abs(hashOf(`${user.id}:${b.compoundLabel}:${now()}`))}`;
        if (deps.service.getCase(caseId) !== null) {
          return json(res, 409, { error: "case_exists", detail: "A case with that identifier already exists." });
        }

        const { case: c, inventory } = deps.service.open({
          caseId, compoundLabel: b.compoundLabel.trim(), context: b.context ?? "",
          ownerId: user.id, participantIds: resolved, findings: b.findings ?? [],
          ...(b.modality === undefined ? {} : { modality: b.modality }),
          at: new Date(now()).toISOString(),
        });
        return json(res, 201, { case: c, inventory });
      }

      // GET /api/cases - only the ones this account is named on.
      if (parts.length === 2 && method === "GET") {
        return json(res, 200, deps.service.casesFor(user.id));
      }

      const caseId = parts[2];
      if (caseId === undefined) return json(res, 404, { error: "not_found" });
      const tail = parts[3];

      // ---- the access boundary ---------------------------------------------
      //
      // Checked ONCE, here, before any route runs, and against the case rather than
      // against the session. A rule applied inside each handler is a rule that is
      // missing from the handler somebody adds next month.
      //
      // A case that does not exist and a case you may not read both return 404. A
      // 403 would confirm the case exists, which is the one fact an unauthorised
      // caller is asking for.
      const kase = deps.service.getCase(caseId);
      if (kase === null) return json(res, 404, { error: "no_case" });
      // METHOD AND path, not path alone. Deriving the action from the path made
      // `GET /positions` a submit and `DELETE /positions` a submit, so a method the
      // route does not implement was answered with a permission error instead of a
      // 405 - and a read-shaped request on a write-shaped path was checked against
      // the wrong rule. Anything that is not a known write is a read.
      const action: CaseAction = method === "DELETE"
        ? (tail === "findings" || tail === "participants" ? "adjudicate" : "read")
        : method !== "POST"
          ? "read"
          : tail === "findings" || tail === "participants" || tail === "describe" ? "adjudicate"
            : tail === "positions" ? "submit"
          : tail === "reveal" ? "reveal"
            : tail === "adjudicate" ? "adjudicate"
              : tail === "sign" ? "sign"
                : "read";
      if (!can(kase, user.id, "read")) return json(res, 404, { error: "no_case" });
      if (action !== "read") {
        const d = denial(kase, user.id, action);
        if (d !== null) return json(res, 403, { error: "forbidden", ...d });
      }

      if (method === "GET") {
        switch (tail) {
          case "inventory": {
            const inv = deps.service.inventory(caseId);
            return inv === null ? json(res, 404, { error: "no_case" }) : json(res, 200, inv);
          }
          case "view": {
            // THE blind route. Computed per viewer, and the only route that returns
            // positions before the reveal.
            const v = deps.service.view(caseId, user.id);
            return v === null ? json(res, 404, { error: "no_case" }) : json(res, 200, v);
          }
          case "unanimity": {
            const u = deps.service.unanimity(caseId);
            return u === null ? json(res, 404, { error: "no_case" }) : json(res, 200, u);
          }
          case "audit":
            return json(res, 200, deps.service.audit(caseId));
          case "documents":
            return json(res, 200, deps.documents.forCase(caseId));
          case "participants":
            return json(res, 200, {
              ownerId: kase.ownerId,
              members: kase.participantIds.map((id) => deps.auth.get(id)).filter((p) => p !== null),
              pending: deps.invites.forCase(caseId),
            });
          case "adjudication-request": {
            const r = deps.service.adjudicationRequest(caseId, deps.rules);
            return r === null ? json(res, 404, { error: "no_case" }) : json(res, 200, r);
          }
          default:
            return json(res, 404, { error: "not_found" });
        }
      }

      if (method === "POST") {
        switch (tail) {
          case "documents": {
            const filename = String(req.headers["x-filename"] ?? "upload.pdf");
            const r = deps.documents.upload({
              caseId, filename, bytes: raw, uploadedBy: user.id,
              at: new Date(now()).toISOString(),
            });
            // 422, not 400: the request was well-formed and the DOCUMENT is the
            // problem. The measurement travels with the refusal so the uploader can
            // see why while they still have the file in front of them.
            return r.ok
              ? json(res, 201, { document: r.document, duplicateOf: r.duplicateOf ?? null })
              : json(res, r.rejection.kind === "unreadable" ? 422 : 400, { error: r.rejection.kind, ...r.rejection });
          }
          case "participants": {
            const b = body as { email: string };
            const email = normaliseEmail(b?.email ?? "");
            if (email === "") return json(res, 400, { error: "bad_request", detail: "Give an email address." });
            const existing = deps.auth.findByEmail(email);
            if (existing === null) {
              // No account yet: record the intent rather than refusing. Telling a
              // convener "ask them to register, then come back" loses the case, and
              // the person most likely to be left off is the one who disagrees.
              deps.invites.add({ email, caseId, invitedBy: user.id, at: new Date(now()).toISOString() });
              return json(res, 202, {
                pending: true, email,
                detail: "No account for that address yet. They will join automatically when they register - tell them to, because nothing is emailed from here.",
              });
            }
            const r = deps.service.addParticipant(caseId, existing.id, user.id, new Date(now()).toISOString());
            return r.ok ? json(res, 200, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "describe": {
            const b = body as { compoundLabel: string; context: string };
            const r = deps.service.describe(caseId, b?.compoundLabel ?? "", b?.context ?? "", user.id, new Date(now()).toISOString());
            return r.ok ? json(res, 200, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "findings": {
            const f = body as CoveringFinding;
            if (f?.sourceDocumentId !== undefined) {
              const doc = deps.documents.get(f.sourceDocumentId);
              if (doc === null || doc.caseId !== caseId) {
                return json(res, 400, { error: "bad_request", detail: "That document is not on this case." });
              }
            }
            if (typeof f?.id !== "string" || f.id.trim() === "" || typeof f?.label !== "string" || f.label.trim() === "") {
              return json(res, 400, { error: "bad_request", detail: "A finding needs an identifier and a label." });
            }
            if (!["toxic", "safe", "ambiguous"].includes(f.assertion)) {
              return json(res, 400, { error: "bad_request", detail: "A finding must assert toxic, safe or ambiguous." });
            }
            const r = deps.service.addFinding(caseId, f);
            return r.ok ? json(res, 201, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "positions": {
            const r = deps.service.submit(caseId, { ...(body as Position), participantId: user.id });
            return r.ok ? json(res, 201, { sealed: true }) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "reveal": {
            const b = body as { at: string; mode: "all_in" | "close_early" };
            const r = deps.service.reveal(caseId, user.id, b.at, b.mode);
            return r.ok ? json(res, 200, deps.service.view(caseId, user.id)) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "adjudicate": {
            const request = deps.service.adjudicationRequest(caseId, deps.rules);
            if (request === null) return json(res, 404, { error: "no_case" });
            const live = completeFromEnv();
            const out = await handleAdjudicate(request, live ?? stubComplete(request), deps.prompt);
            if (out.status !== 200) return json(res, out.status, out.body);
            const r = deps.service.adjudicate(caseId, out.body, (body as { at: string }).at, live === null ? "stub" : "model");
            // `source` travels with the adjudication so a stub can never be read as
            // a result downstream, the same discipline probe.ts applies.
            return r.ok
              ? json(res, 200, { adjudication: out.body, source: live === null ? "stub" : "live" })
              : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "sign": {
            const b = body as { at: string; agreesWithAdjudication: boolean; reason: string };
            const r = deps.service.signOff(caseId, { by: user.id, at: b.at, agreesWithAdjudication: b.agreesWithAdjudication, reason: b.reason });
            return r.ok ? json(res, 200, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          default:
            return json(res, 404, { error: "not_found" });
        }
      }

      if (method === "DELETE" && tail === "findings" && parts[4] !== undefined) {
        const r = deps.service.removeFinding(caseId, decodeURIComponent(parts[4]));
        return r.ok ? json(res, 200, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
      }

      if (method === "DELETE" && tail === "participants" && parts[4] !== undefined) {
        const target = decodeURIComponent(parts[4]);
        // An address that never registered is a pending invitation, not a member.
        if (target.includes("@")) {
          const revoked = deps.invites.revoke(target, caseId);
          return revoked
            ? json(res, 200, { revoked: target })
            : json(res, 404, { error: "not_on_the_case", detail: "No pending invitation for that address." });
        }
        const r = deps.service.removeParticipant(caseId, target, user.id, new Date(now()).toISOString());
        return r.ok ? json(res, 200, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
      }

      return json(res, 405, { error: "method_not_allowed" });
    } catch (e) {
      return json(res, 500, { error: "internal", detail: e instanceof Error ? e.message : "unknown" });
    }
  };
}

function handleAuth(
  deps: ServerDeps, res: ServerResponse, action: string | undefined,
  method: string, body: unknown, token: string | null, now: number, source: string,
): void {
  if (action === "register" && method === "POST") {
    const b = body as { email: string; displayName: string; password: string };
    const r = deps.auth.register({ email: b.email, displayName: b.displayName, password: b.password, now });
    if (!r.ok) return json(res, AUTH_STATUS[r.error.kind] ?? 400, r.error);

    // Standing invitations are claimed at registration: a convener added this address
    // to a case before it had an account, and this is where that lands.
    const claimed: string[] = [];
    for (const caseId of deps.invites.claim(b.email)) {
      const added = deps.service.addParticipant(caseId, r.value.id, r.value.id, new Date(now).toISOString());
      if (added.ok) claimed.push(caseId);
    }
    return json(res, 201, { ...r.value, joinedCases: claimed });
  }

  if (action === "login" && method === "POST") {
    deps.auth.pruneExpired(now);
    const b = body as { email: string; password: string };
    const address = normaliseEmail(b.email ?? "");

    // Checked BEFORE the password is hashed. Throttling after the expensive step
    // would let an attacker keep the CPU busy at no cost to themselves, which is the
    // opposite of the point.
    const wait = deps.throttle.retryAfter(address, source, now);
    if (wait > 0) {
      res.setHeader("retry-after", String(Math.ceil(wait / 1000)));
      return json(res, 429, {
        kind: "rate_limited",
        detail: `Too many attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`,
      });
    }

    const r = deps.auth.login({ email: b.email, password: b.password, now });
    if (!r.ok) {
      deps.throttle.recordFailure(address, source, now);
      return json(res, AUTH_STATUS[r.error.kind] ?? 401, r.error);
    }
    deps.throttle.recordSuccess(address);
    return json(res, 200, r.value);
  }

  if (action === "request-reset" && method === "POST") {
    const b = body as { email: string };
    const issued = deps.auth.requestReset(b.email, now);
    if (issued !== null) {
      // Printed, not mailed. There is no delivery path here, and pretending otherwise
      // is what turns a reset flow into a hole - the operator hands this to the person
      // whose account it is, having satisfied themselves that it IS that person.
      console.log(`[reset] token for ${normaliseEmail(b.email)}: ${issued}`);
    }
    // The same answer whether or not the account exists, so this form cannot be used
    // to discover which addresses are registered.
    return json(res, 202, {
      detail: "If that address has an account, a reset token has been issued. Nothing is emailed from here - ask whoever runs the server for it.",
    });
  }

  if (action === "reset" && method === "POST") {
    const b = body as { token: string; password: string };
    const r = deps.auth.resetPassword(b.token, b.password, now);
    return r.ok ? json(res, 200, r.value) : json(res, AUTH_STATUS[r.error.kind] ?? 400, r.error);
  }

  if (action === "logout" && method === "POST") {
    if (token !== null) deps.auth.logout(token);
    // 204 whether or not the token was real. "That token did not exist" is not
    // information a caller needs and is information an attacker would use.
    res.writeHead(204).end();
    return;
  }

  if (action === "me" && method === "GET") {
    const r = deps.auth.resolve(token, now);
    return r.ok ? json(res, 200, r.value) : json(res, AUTH_STATUS[r.error.kind] ?? 401, r.error);
  }

  return json(res, 404, { error: "not_found" });
}

function handleDemo(deps: ServerDeps, res: ServerResponse, body: unknown, user: PublicUser, now: number): void {
  const b = body as { case?: unknown; participantIds?: string[]; at?: string };
  if (!isCaseName(b.case)) {
    return json(res, 400, { error: "unknown_case", detail: `case must be one of: ${CATALOGUE.map((c) => c.name).join(", ")}.` });
  }
  // 422, not 404 or 500. The case exists and is named in the catalogue; the DOCUMENT
  // cannot be processed. Falling back to an empty case would make split_review.py's
  // refusal decorative, which is the one thing it must never be.
  const refused = refusalFor(b.case);
  if (refused !== null) return json(res, 422, { error: "document_refused", ...refused });

  const loaded = loadCase(b.case);

  // ONE COPY PER OPENER, and the suffix is what makes that true. A fixed identifier
  // was a real defect once accounts existed: the second person to open a library case
  // was told it already existed, sent to it, and met a 404, because they were not
  // named on the copy the first person opened. A prepared case is a starting point,
  // not a shared room.
  const caseId = `${loaded.caseId}--${user.id}`;
  const head = {
    caseId, compoundLabel: loaded.compoundLabel, context: loaded.context,
    provenance: loaded.provenance, documentScope: loaded.documentScope ?? null,
  };

  const existing = deps.service.inventory(caseId);
  if (existing !== null) return json(res, 200, { ...head, alreadyOpen: true, inventory: existing });

  // The panel is whoever the caller named, or the seeded demonstration team if they
  // named nobody. Explicit rather than "the first four accounts in the store", which
  // is how a stranger ends up on a case about somebody else's compound.
  const named = (b.participantIds ?? []).filter((id) => id !== user.id);
  const panel = named.length > 0
    ? named
    : DEMO_TEAM.map((p) => deps.auth.findByEmail(p.email)?.id)
      .filter((id): id is string => id !== undefined && id !== user.id);

  if (panel.length === 0) {
    return json(res, 422, {
      error: "no_panel",
      detail: "A case needs somebody to answer it. Run `npm run seed:demo` to create the demonstration team, or open your own case and invite colleagues.",
    });
  }

  const { inventory } = deps.service.open({
    caseId, compoundLabel: loaded.compoundLabel, context: loaded.context,
    ownerId: user.id, participantIds: panel,
    findings: loaded.findings, modality: loaded.modality,
    at: new Date(now).toISOString(),
  });
  return json(res, 201, { ...head, alreadyOpen: false, inventory });
}

export function buildDeps(logPath: string): ServerDeps {
  const checklist = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;
  const prompt = JSON.parse(readFileSync("prompts/adjudicator-v1.0.json", "utf8")) as { system: string[]; userTemplate: string[] };
  const probe = JSON.parse(readFileSync("data/probe-case.json", "utf8")) as { rules: AdjudicateRequest["rules"] };
  return {
    service: new DeliberationService(new FileStore(logPath), checklist),
    auth: new AuthStore(`${logPath}.users.json`),
    documents: new DocumentStore("results/documents"),
    invites: new InviteStore(`${logPath}.invites.json`),
    throttle: new LoginThrottle(),
    rules: probe.rules,
    prompt,
  };
}

/**
 * Run-as-script guard.
 *
 * Compared through `fileURLToPath` and `resolve` rather than by string-matching
 * `import.meta.url`. The string form silently failed on this repo's own path: the
 * checkout lives under "VS Code", `import.meta.url` percent-encodes the space as
 * "VS%20Code", and the comparison never matched - so `npm run api` exited zero
 * having started nothing.
 */
const invokedDirectly = process.argv[1] !== undefined
  && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);

if (invokedDirectly) {
  const port = Number(process.env["PORT"] ?? 8787);
  const deps = buildDeps("results/deliberation-log.jsonl");
  createServer((req, res) => { void makeHandler(deps)(req, res); }).listen(port, HOST, () => {
    console.log(`ARBITER deliberation API on http://${HOST}:${port}`);
    console.log(`Adjudication: ${completeFromEnv() === null ? "STUB (no ANTHROPIC_API_KEY) - responses are labelled source:stub" : "LIVE"}`);
    console.log(`Accounts: ${deps.auth.list().length} registered. Sign in for a bearer token; there is no TLS here, which is why this binds to loopback only.`);
    if (deps.auth.list().length === 0) console.log("No accounts yet. Run `npm run seed:demo` to create the demonstration team.");
  });
}
