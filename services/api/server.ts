import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, resolve } from "node:path";
import { DeliberationService } from "./deliberation-service.js";
import { FileStore } from "./store.js";
import type { DeliberationCase, Position } from "./deliberation.js";
import type { CoveringFinding, EvidenceChecklist, Modality } from "./inventory.js";
import { ADJUDICATOR_PROMPT_PATH, type Adjudication, type AdjudicateRequest } from "./adjudicate.js";
import { buildCaseReport } from "./verdict-report.js";
import { handleAsk } from "./ask.js";
import { handleSummarise } from "./summarise.js";
import { buildIndex, search } from "./retrieval.js";
import { completeFromEnv, providerFor, resolveModel, type CallKind, type Complete } from "./interpret.js";
import { geminiCredentialAdvice, geminiEndpointLabel } from "./gemini.js";
import { stubComplete } from "./probe.js";
import { adjudicateConsensus, runsFrom } from "./consensus.js";
import { CATALOGUE, isCaseName, loadCase, refusalFor } from "./cases.js";
import { AuthStore, normaliseEmail, type PublicUser } from "./auth.js";
import { DEMO_PASSWORD, DEMO_TEAM, seedDemoTeam } from "./seed-demo.js";
import { DocumentStore, MAX_BYTES } from "./documents.js";
import { LibraryStore } from "./library.js";
import { can, denial, type CaseAction } from "./access.js";
import { InviteStore } from "./invites.js";
import { LoginThrottle } from "./throttle.js";
import { ModelBudget, budgetFrom } from "./spend.js";
import { envFileInUse, loadEnv } from "./env.js";
import { deriveToken, ShareStore, shareSecret, verifyToken } from "./share.js";

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

/**
 * A base for parsing `req.url`, which arrives as a path and needs an origin to become a
 * `URL`. Nothing is dialled and no header is trusted here - the authority is discarded
 * the moment the pathname is read. It is NOT the bind address; see `bindHost` below,
 * which the two used to share as one constant and should not.
 */
const PARSE_ORIGIN = "http://localhost";

/**
 * LOOPBACK BY DEFAULT, AND ONLY BY DEFAULT.
 *
 * The bind address was a hardcoded `127.0.0.1`, which made the service impossible to
 * deploy: it physically could not accept a connection from anywhere else. It stays
 * loopback unless something says otherwise, because this process terminates no TLS and
 * binding a plaintext service to every interface is not a thing anyone should get by
 * accident. So exposure is always something a person typed - `ARBITER_HOST=0.0.0.0`,
 * behind a proxy that terminates TLS, which is the only arrangement it belongs in.
 *
 * Read at startup rather than at import, because `.env` is loaded by the entry point and
 * a module-level read would happen first and miss it.
 */
function bindHost(env: NodeJS.ProcessEnv = process.env): string {
  return env["ARBITER_HOST"] ?? "127.0.0.1";
}

export interface ServerDeps {
  service: DeliberationService;
  auth: AuthStore;
  documents: DocumentStore;
  library: LibraryStore;
  invites: InviteStore;
  shares: ShareStore;
  /** Null when ARBITER_SHARE_SECRET is unset: publishing is off, everything else works. */
  shareSecret: string | null;
  throttle: LoginThrottle;
  /** Caps the endpoints that cost money. See `spend.ts`. */
  budget: ModelBudget;
  rules: AdjudicateRequest["rules"];
  prompt: { system: string[]; userTemplate: string[] };
  now?: () => number;
  /**
   * How the four paid routes get a completer. Defaults to the process environment,
   * which is what the real server wants and what every caller had hard-coded.
   *
   * INJECTED BECAUSE A TEST SUITE MUST NOT SPEND MONEY, and this one silently did.
   * `completeFromEnv` reads an ambient `GEMINI_API_KEY`, so on any machine with the
   * developer's key exported - which is every machine that can run the product -
   * `server.test.ts` was making three live adjudication calls per run against
   * whichever host the environment implied. Tests never call `loadEnv`, so
   * `ARBITER_GEMINI_HOST` was unset, `apiHost` fell through to its `vertex` default,
   * and the key was rejected with "API keys are not supported by this API". That is
   * the whole of the 502 the suite reported: not the adjudicator, not the quota, and
   * not Google - an environment the test never meant to read.
   *
   * Returning null here is what selects the stub, so a suite that injects `() => null`
   * is deterministic, free, and offline. The seam is the fix; the stub was always the
   * intended test path.
   */
  complete?: (kind: CallKind) => Complete | null;
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
    const url = new URL(req.url ?? "/", PARSE_ORIGIN);
    const parts = url.pathname.split("/").filter((p) => p !== "");
    const method = req.method ?? "GET";
    const remote = req.socket.remoteAddress ?? "unknown";

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
      // ---- auth, the first of two unauthenticated surfaces ----------------------
      if (parts[1] === "auth") {
        return handleAuth(deps, res, parts[2], method, body, bearer(req), now(),
          req.socket.remoteAddress ?? "unknown");
      }

      /**
       * THE SECOND UNAUTHENTICATED SURFACE, and the only one that serves case data.
       *
       * Reached before the session is resolved, deliberately: a reader holding a share
       * link has no account, and requiring one would defeat the QR on a printed page.
       * What stands in for a session is the token - unforgeable without the secret,
       * scoped to one case, and revocable - and what stands in for `visibleTo` is the
       * public audience, which cuts the addresses before the body is built.
       *
       * 404, never 403, on every failure below. A 403 would confirm that a case exists
       * and is published, which is the one fact an unauthenticated caller must not be
       * able to probe for.
       */
      if (parts[1] === "public" && parts[2] === "report" && method === "GET") {
        // NEVER CACHED, on every exit from this branch - the 404s as well as the
        // 200. A revoke only changes what THIS process answers; an intermediary that
        // cached the live response keeps serving it regardless, which is exactly the
        // disclosure revocation exists to stop (the `raw` document route further down
        // in this file reasons about the same hazard with its own `private` header,
        // but that route sits behind a session - this one has none, so nothing else
        // tells a cache not to keep it). `no-store`, not just `private`: a `private`
        // browser cache is still a cache, and a link handed to a stranger has no
        // browser whose history the convener can ask to clear. `x-robots-tag: noindex`
        // keeps a token that leaks into a referrer or a proxy log out of a search
        // index, which is a slower version of the same disclosure.
        res.setHeader("cache-control", "private, no-store");
        res.setHeader("x-robots-tag", "noindex");

        const caseId = parts[3] === undefined ? "" : decodeURIComponent(parts[3]);
        const token = parts[4] ?? "";
        if (deps.shareSecret === null) return json(res, 404, { error: "not_found" });

        const link = deps.shares.get(caseId);
        if (!verifyToken(deps.shareSecret, link, token)) return json(res, 404, { error: "not_found" });

        const kase = deps.service.getCase(caseId);
        if (kase === null) return json(res, 404, { error: "not_found" });

        return handleReport(deps, res, kase, link!.createdBy, new Date(now()).toISOString(), "public");
      }

      // The catalogue names no case contents and no positions, so it is readable by
      // anyone signed in - but not by anyone at all, because it describes what this
      // deployment holds.
      const session = deps.auth.resolve(bearer(req), now());
      if (!session.ok) {
        return json(res, AUTH_STATUS[session.error.kind] ?? 401, session.error);
      }
      const user = session.value;

      /**
       * Charge a model call, or refuse it.
       *
       * Called at each of the four endpoints that spend money rather than once up here,
       * because most requests through this handler are free and a budget that counted
       * them would run out reading a case list. Returns true when the caller has been
       * answered with a 429 and the endpoint must stop.
       *
       * Charged on ADMISSION rather than on success: a call that fails upstream has
       * still been paid for in latency and usually in tokens. See `spend.ts`.
       *
       * But NOT charged when there is no model to call. This cap exists to bound a bill,
       * and a deployment holding no credentials has no bill - measured by running it:
       * with a budget of three, the first three Asks were counted and answered 503
       * `no_key`, and the fourth was refused 429. Rate-limiting a surface that is
       * unavailable anyway punishes the reader for the deployment's configuration. So
       * every caller passes `complete` and a null one is free.
       */
      /** The one place a paid route resolves a completer. See `ServerDeps.complete`. */
      const completer = deps.complete ?? ((kind: CallKind) => completeFromEnv(process.env, kind));

      const overBudget = (complete: unknown): boolean => {
        if (complete === null) return false;
        const wait = deps.budget.retryAfter(user.id, remote, now());
        if (wait <= 0) {
          deps.budget.record(user.id, remote, now());
          return false;
        }
        res.setHeader("retry-after", String(Math.ceil(wait / 1000)));
        json(res, 429, {
          error: "rate_limited",
          detail: "This deployment caps how many model calls one account may make. Try again shortly.",
          retryAfterSeconds: Math.ceil(wait / 1000),
        });
        return true;
      };

      if (parts[1] === "cases-catalogue" && method === "GET") return json(res, 200, CATALOGUE);

      // Display names for rendering. Ids are what the record stores; a screen full of
      // `u_9f2a…` is unreadable, and mapping them client-side needs this list.
      if (parts[1] === "people" && method === "GET") return json(res, 200, deps.auth.list());

      if (parts[1] === "demo" && method === "POST") return handleDemo(deps, res, body, user, now());

      // ---- the library, which is documents rather than cases --------------------
      //
      // NO CASE BOUNDARY HERE, deliberately. These are the public regulatory reviews
      // the prepared cases were transcribed from - an FDA multi-disciplinary review is
      // not somebody's unpublished safety data, and putting it behind a case would
      // mean opening a deliberation before you may read a document that is on
      // accessdata.fda.gov. A session is still required, because the LIST describes
      // what this deployment holds.
      if (parts[1] === "library" && parts.length === 2 && method === "GET") {
        return json(res, 200, deps.library.list());
      }

      if (parts[1] === "library" && (parts[3] === "ask" || parts[3] === "summary") && method === "POST") {
        const source = deps.library.list().find((s) => s.name === parts[2]);
        if (source === undefined) return json(res, 404, { error: "no_document" });
        // 422 before any model call. The reason a document cannot be searched was
        // decided at ingestion and is worth more than an empty search over it: "this
        // is a scanned document" and "the document does not cover that" are different
        // answers, and only one of them is about the compound.
        if (!source.askable) {
          return json(res, 422, { error: "not_askable", detail: source.reason });
        }

        // A summary reads the WHOLE document, so it does not go through retrieval at
        // all - see summarise.ts for why a document-level question cannot be served by
        // a passage-level one.
        if (parts[3] === "summary") {
          const complete = completer("summary");
          if (overBudget(complete)) return;
          const out = await handleSummarise(
            deps.library.textFor(source.name),
            deps.library.filenameFor(source.name),
            complete,
          );
          return json(res, out.status, out.body);
        }

        const passages = search(
          buildIndex([{
            documentId: source.name,
            filename: deps.library.filenameFor(source.name),
            pages: deps.library.textFor(source.name),
          }]),
          String((body as { question?: unknown }).question ?? ""),
        );
        const complete = completer("ask");
        if (overBudget(complete)) return;
        const out = await handleAsk(body, passages, complete);
        return json(res, out.status, out.body);
      }

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
      //
      // The document count is merged in HERE rather than inside casesFor, because the
      // deliberation service owns positions and the hash chain and knows nothing about
      // uploaded files - handing it the document store to answer one number would tie
      // the record to the folder. A count only: naming the files would put one case's
      // filenames in a list another surface renders without opening the case.
      if (parts.length === 2 && method === "GET") {
        return json(res, 200, deps.service.casesFor(user.id).map((c) => ({
          ...c, documents: deps.documents.forCase(c.caseId).length,
        })));
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
      // "share" gets its own arm in BOTH mutating branches, not just a handler-level
      // check. Any unrecognised tail falls through to "read" here, and a route added
      // beside this one without an arm would be checked against the read rule instead
      // of being denied - which is how a participant would get to publish a case they
      // may only read. `handleShare` re-checks the same rule regardless; this is the
      // gate that stops the request before the route is even reached.
      const action: CaseAction = method === "DELETE"
        ? (tail === "findings" || tail === "participants" ? "adjudicate" : tail === "share" ? "share" : "read")
        : method !== "POST"
          ? "read"
          : tail === "findings" || tail === "participants" || tail === "describe" ? "adjudicate"
            : tail === "positions" ? "submit"
          : tail === "reveal" ? "reveal"
            : tail === "adjudicate" ? "adjudicate"
              : tail === "sign" ? "sign"
                : tail === "share" ? "share"
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
          case "documents": {
            // GET /api/cases/:caseId/documents/:documentId/raw
            //
            // SCOPED THROUGH forCase, NOT through get(). Resolving by id alone would
            // serve any document to anyone holding a case they are on, which quietly
            // admits a library PDF nobody on this case was asked to read. A mark
            // against such a document could not mean what a mark means: in later
            // phases a highlight says "this reviewer, reading the evidence for THIS
            // case, stopped here," and that sentence has no referent for a document
            // that was never on the case.
            if (parts[4] !== undefined && parts[5] === "raw") {
              const doc = deps.documents.forCase(caseId).find((d) => d.id === parts[4]);
              if (doc === undefined) return json(res, 404, { error: "no_such_document" });

              // Existence checked BEFORE the status line is committed. The index and
              // the file on disk can drift apart - deleted externally, a migration
              // gap, a disk issue - and once writeHead(200, ...) has gone out the
              // client has already been told this is a successful response; there is
              // no way to take that back and turn it into a clean error.
              const path = deps.documents.pathFor(doc.id);
              if (!existsSync(path)) {
                return json(res, 500, {
                  error: "document_missing",
                  detail: "The document record exists but its file could not be found.",
                });
              }

              // REVALIDATABLE, and that is not a micro-optimisation. The reader turns
              // pages in a 264-page review; without a validator the browser has no way
              // to ask "still the same file?" and re-downloads every byte on every
              // navigation back to a document. The sha256 is already computed at
              // upload and the store is content-addressed, so it is an exact strong
              // validator - a re-upload of different bytes gets a different id anyway.
              //
              // `private`, never `public`: this is unpublished safety data, and a
              // shared cache holding it is precisely the disclosure the case-scoping
              // above exists to prevent.
              const etag = `"${doc.sha256}"`;
              if (req.headers["if-none-match"] === etag) {
                res.writeHead(304, { etag, "cache-control": "private, max-age=0, must-revalidate" });
                res.end();
                return;
              }

              res.writeHead(200, {
                "content-type": "application/pdf",
                "content-length": doc.bytes,
                etag,
                "cache-control": "private, max-age=0, must-revalidate",
              });
              const stream = createReadStream(path);
              // A failure here is asynchronous and fires AFTER this handler's own
              // try/catch has already returned, so that catch cannot see it. Left
              // unhandled, Node treats an 'error' event with no listener as an
              // uncaught exception - which crashes the whole process, taking down
              // every in-flight request, not just this one.
              stream.on("error", () => res.destroy());
              stream.pipe(res);
              return;
            }
            return json(res, 200, deps.documents.forCase(caseId));
          }
          case "participants":
            return json(res, 200, {
              ownerId: kase.ownerId,
              members: kase.participantIds.map((id) => deps.auth.get(id)).filter((p) => p !== null),
              pending: deps.invites.forCase(caseId),
              // Seats, BEFORE the reveal, and that is safe: §3.4 - a seat is identity,
              // not position. It decides which colour a person wears and says nothing
              // about whether they have answered or what they answered. This is the
              // only route that returns the allocation, so without it the seat map
              // never leaves the server and every badge on the client is uncoloured.
              // Nothing count-shaped goes with it; mark counts and per-person activity
              // would leak progress and are deliberately absent.
              seats: kase.seats,
            });
          case "adjudication-request": {
            const r = deps.service.adjudicationRequest(caseId, deps.rules);
            return r === null ? json(res, 404, { error: "no_case" }) : json(res, 200, r);
          }
          /* NO `adjudication` ROUTE, and it is not an oversight. Two branches fixed the
             same bug - the verdict living only in the tab that pressed Adjudicate - and
             this route was one of the two answers. `view` carries the adjudication, its
             source, the run consensus and the signature, so every reader of the case
             already gets it from a request the verdict stage was making anyway. A second
             endpoint serving the same log entry is a second thing to keep honest.
             `deps.service.adjudication` is still what `view` and the report are built
             from; only the route is gone. */
          /**
           * The whole case as one record, for the preview page to draw. Readable by
           * anyone named on the case - the action switch above resolves a GET to
           * "read", so a participant gets exactly what the convener gets, and nobody
           * has to ask them for a copy.
           */
          case "report":
            return handleReport(deps, res, kase, user.id, new Date(now()).toISOString());
          /**
           * Whether this case is published, and where. Convener only - the
           * action switch above leaves GET resolved to "read" so a
           * participant is not 404'd on the way in, but `handleShare` checks
           * `denial(kase, user.id, "share")` itself before answering.
           */
          case "share":
            return handleShare(deps, req, res, kase, user, method, new Date(now()).toISOString());
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
            // A quote is an instruction to mark a specific place, so it is refused
            // without one. Accepting an unanchored quote would store a passage the
            // viewer can never draw and the reader can never check - the citation
            // equivalent of "page 26" with no document, which this route already
            // refuses one field up.
            if (typeof f?.sourceQuote === "string" && f.sourceQuote.trim() !== ""
              && (f.sourceDocumentId === undefined || f.sourcePage === undefined)) {
              return json(res, 400, {
                error: "bad_request",
                detail: "A quoted passage needs the document and the page it was quoted from.",
              });
            }
            const r = deps.service.addFinding(caseId, f);
            return r.ok ? json(res, 201, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "positions": {
            const r = deps.service.submit(caseId, { ...(body as Position), participantId: user.id });
            return r.ok ? json(res, 201, { sealed: true }) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "ask": {
            // A READ, despite being a POST - the body carries a question, and nothing
            // here writes. No position, no adjudication, no log entry, nothing into the
            // hash chain. The action switch above already falls through to "read" for
            // an unrecognised POST tail, so any participant or the owner may ask and
            // nobody gains a way to alter the record by asking.
            const docs = deps.documents.forCase(caseId);
            const corpus = docs.map((d) => ({
              documentId: d.id,
              filename: d.filename,
              pages: deps.documents.textFor(d.id),
            }));
            const passages = search(buildIndex(corpus), String((body as { question?: unknown }).question ?? ""));
            const complete = completer("ask");
            if (overBudget(complete)) return;
            const out = await handleAsk(body, passages, complete);
            return json(res, out.status, out.body);
          }
          case "reveal": {
            const b = body as { at: string; mode: "all_in" | "close_early" };
            const r = deps.service.reveal(caseId, user.id, b.at, b.mode);
            return r.ok ? json(res, 200, deps.service.view(caseId, user.id)) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "adjudicate": {
            const request = deps.service.adjudicationRequest(caseId, deps.rules);
            if (request === null) return json(res, 404, { error: "no_case" });

            /* ASKED BEFORE ANYTHING IS SPENT. This is three model calls out of a
               daily twenty, and the state check used to happen after them: a case in
               the wrong state cost 15% of a day's budget to be told 409. The check
               inside `attachAdjudication` still runs and is still the one that
               decides - a case can change while the model thinks. This one only
               stops the bill. */
            const ready = deps.service.readyToAdjudicate(caseId);
            if (ready !== null && !ready.ok) {
              return json(res, ERROR_STATUS[ready.error.kind] ?? 400, ready.error);
            }

            // "adjudication", not the default "short". This route was the original
            // site of the shape bug: it handed interpret's 1024-token, thinking-off
            // closure to handleAdjudicate, which produces prose, citations and one
            // disclosure per registered rule.
            const live = completer("adjudication");
            // The stub is free, so it is not charged. `live` is null exactly when the
            // answer will be stubbed and labelled `source: "stub"`.
            if (overBudget(live)) return;

            /* ADJUDICATED MORE THAN ONCE, because it is not deterministic. Measured:
               turalio's package returned do_not_advance three times and cannot_conclude
               twice on byte-identical input at temperature 0. A single call there is a
               coin, and it returns the same confident prose whichever way it lands.
               The stub is deterministic by construction, so it runs once - three
               identical stub answers would report a unanimity that means nothing. */
            const runs = live === null ? 1 : runsFrom(process.env);
            const { response: out, consensus } = await adjudicateConsensus(
              request, live ?? stubComplete(request), deps.prompt, runs);
            if (out.status !== 200) return json(res, out.status, out.body);
            const r = deps.service.adjudicate(caseId, out.body, (body as { at: string }).at, live === null ? "stub" : "model", consensus);
            /* `source` travels with the adjudication so a stub can never be read as
               a result downstream, the same discipline probe.ts applies - and
               `consensus` travels with it for the same reason. A 2-of-3 verdict and a
               3-of-3 verdict are different objects and the reader of a safety record is
               exactly who should be told which one they have. */
            return r.ok
              ? json(res, 200, { adjudication: out.body, source: live === null ? "stub" : "live", consensus })
              : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "sign": {
            const b = body as { at: string; agreesWithAdjudication: boolean; reason: string };
            const r = deps.service.signOff(caseId, { by: user.id, at: b.at, agreesWithAdjudication: b.agreesWithAdjudication, reason: b.reason });
            return r.ok ? json(res, 200, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "share":
            return handleShare(deps, req, res, kase, user, method, new Date(now()).toISOString());
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

      if (method === "DELETE" && tail === "share") {
        return handleShare(deps, req, res, kase, user, method, new Date(now()).toISOString());
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

/**
 * The deliberation record, for whoever on the case asks for it - or, with
 * `audience: "public"`, for a stranger holding a share link and nobody else.
 *
 * IT REFUSES BEFORE IT IS A RECORD. A case with no adjudication has no verdict to
 * report, and a page titled "deliberation record" with a blank verdict is worse than no
 * page: it looks like the panel concluded nothing, when the truth is that nobody has
 * run the adjudication yet. So the refusal names the state and what would fix it, and
 * the verdict screen only offers the control once there is something to show.
 *
 * JSON, NOT A DOCUMENT. This route used to render HTML and print it through a headless
 * browser on the server. The reader's own browser prints better, already has "save as
 * PDF" in it, and needs no binary installed beside the API - so what crosses the wire
 * is the record, and the preview page in the app draws it with the product's own design
 * system rather than a second stylesheet imitating it.
 *
 * TAKES AN ID, NOT A USER. The authenticated route has a session and passes `user.id`;
 * the public route has no session at all, only the share link's `createdBy` - and
 * fabricating a `PublicUser` to satisfy a parameter this function only ever reads the
 * id off of would be a lie sitting where a real session used to be.
 */
function handleReport(
  deps: ServerDeps, res: ServerResponse, kase: DeliberationCase,
  generatedById: string, generatedAt: string, audience: "case" | "public" = "case",
): void {
  const record = deps.service.adjudication(kase.caseId);
  if (record === null) {
    return json(res, 409, {
      error: "no_adjudication",
      detail: kase.status === "open"
        ? "This case is still open. A report is printed from the adjudication, and there is none until every position is in and the case has been closed and adjudicated."
        : "This case has been revealed but not adjudicated. Run the adjudication first - a report with an empty verdict reads as a panel that concluded nothing.",
    });
  }

  const inventory = deps.service.inventory(kase.caseId);
  const unanimity = deps.service.unanimity(kase.caseId);
  if (inventory === null || unanimity === null) return json(res, 404, { error: "no_case" });

  const audit = deps.service.audit(kase.caseId);

  return json(res, 200, buildCaseReport({
    kase,
    // Through the blind view rather than off the case, so this route reads positions
    // by the same gate every other route does. It cannot return null here - the
    // adjudication above only exists on a case that has been revealed - but the empty
    // fallback keeps that an assumption rather than a crash.
    positions: deps.service.view(kase.caseId, generatedById)?.revealed ?? [],
    inventory,
    findings: deps.service.adjudicationRequest(kase.caseId, deps.rules)?.findings ?? [],
    unanimity,
    // Cast, not validated again: this object was checked against the output contract in
    // adjudicate.ts before it was ever attached, and re-deriving that schema here would
    // be a second copy of it to keep in step.
    adjudication: record.adjudication as Adjudication,
    adjudicationSource: record.source,
    adjudicatedAt: record.at,
    signature: record.signature,
    audit: { chainFailures: audit.chain.length, sealFailures: audit.seals.length, entries: audit.entries },
    person: (id) => deps.auth.get(id),
    generatedById,
    generatedAt,
    // "case" unless the caller says otherwise, which is what every route above the
    // public one wants: the reader is already on the case, so the addresses stay. The
    // public route is the one caller that passes "public" - buildCaseReport is what
    // actually cuts the emails, this is only which audience it cuts them for.
    audience,
  }));
}

/**
 * Where a published record lives.
 *
 * Built from the request's own Host so a link works from wherever the reader reached
 * the product - localhost in development, the deployed host in production - rather than
 * from a base URL somebody has to remember to configure per environment and will not.
 *
 * DEFAULTS TO https, NOT http, ONCE THE HOST IS NOT LOCAL. This URL is printed as a QR
 * code onto a sheet that cannot be revised once it exists. A proxy that terminates TLS
 * but forgets to set `x-forwarded-proto` used to fall through to `http`, minting a link
 * that sends the token in clear text for the life of that page - failing toward the
 * insecure scheme is the wrong direction for something unrevisable, so only a bare
 * localhost/127.0.0.1 host, which by construction never crossed a TLS-terminating
 * proxy, gets the `http` default.
 *
 * TAKES THE FIRST VALUE OF THE HEADER. Node joins repeated `x-forwarded-*` headers with
 * ", ", and a legitimate chain - edge terminates TLS, forwards over plain HTTP inside
 * the cluster - sends exactly "https, http". The LAST hop is the origin's own leg; the
 * FIRST is the scheme the reader actually used, and that is the one a link handed back
 * to that reader has to match. Reading the raw value without splitting on it used to
 * produce the malformed `https, http://host/...`.
 */
function shareUrl(req: IncomingMessage, caseId: string, token: string): string {
  const host = req.headers.host ?? "localhost";
  const forwarded = req.headers["x-forwarded-proto"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = first !== undefined && first !== "" ? first : (isLocal ? "http" : "https");
  return `${proto}://${host}/r/${encodeURIComponent(caseId)}/${token}`;
}

/**
 * Publish, revoke, or report the status of a case's share link. One function for all
 * three methods, because they share the one fact that actually matters: only the
 * convener may touch a case's link, checked ONCE here rather than once per method -
 * three copies of the same check are three places for a fourth method to slip past.
 *
 * A SECOND, INDEPENDENT CHECK. The action ternary above the call site already resolves
 * a mutating "share" request to a check against `canShare` before this function is ever
 * reached, so the line below repeats a decision the router already made. It is kept
 * anyway: a route that trusted the router's word for it is exactly the shape of the bug
 * this task exists to close, and a GET on this same route has no ternary arm to protect
 * it at all - this is the only check standing between a participant and the publish
 * state of a case they may merely read.
 */
function handleShare(
  deps: ServerDeps, req: IncomingMessage, res: ServerResponse,
  kase: DeliberationCase, user: PublicUser, method: string, at: string,
): void {
  const denied = denial(kase, user.id, "share");
  if (denied !== null) return json(res, 403, denied);

  if (method === "GET") {
    const link = deps.shares.get(kase.caseId);
    const live = link !== null && link.revokedAt === null && deps.shareSecret !== null;
    return json(res, 200, {
      published: live,
      url: live ? shareUrl(req, kase.caseId, deriveToken(deps.shareSecret!, kase.caseId, link!.version)) : null,
    });
  }

  /* REFUSED BEFORE ANYTHING IS WRITTEN when the deployment has no secret. 501, not
     500: the server is working and this capability is switched off, and the message
     names the variable rather than leaving an operator to guess which of the
     environment's many settings is missing. */
  if (deps.shareSecret === null) {
    return json(res, 501, {
      error: "sharing_disabled",
      detail: "ARBITER_SHARE_SECRET is not set, so this deployment cannot publish records.",
    });
  }

  if (method === "POST") {
    const link = deps.shares.publish(kase.caseId, user.id, at);
    const token = deriveToken(deps.shareSecret, kase.caseId, link.version);
    return json(res, 201, { url: shareUrl(req, kase.caseId, token), token, createdAt: link.createdAt });
  }

  if (method === "DELETE") {
    deps.shares.revoke(kase.caseId, at);
    return json(res, 200, { revoked: true });
  }

  return json(res, 405, { error: "method_not_allowed" });
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

  /**
   * THE CASE OPENS HOLDING THE REVIEW IT WAS TRANSCRIBED FROM.
   *
   * The case file carries findings with the page each came from, and the library
   * manifest knows which document those pages are in. Those two facts never met: a
   * prepared case arrived with findings and no document, so Read & mark said "No
   * documents on this case yet" on every case anybody opened, and the reader - which
   * joins a finding to a page THROUGH a document id - had nothing to join to. Every
   * usable case had to be assembled by hand.
   *
   * THROUGH THE SAME DOOR AS A PERSON'S OWN UPLOAD, deliberately. `documents.upload`
   * measures before it accepts, so a scanned or off-topic source is refused here
   * exactly as it would be on the Evidence stage, by the same code, with the same
   * reason. Nothing about shipping a file with the product makes it readable.
   *
   * A FAILURE HERE DOES NOT LOSE THE CASE. The findings were transcribed by hand and
   * stand on their own; the document is what a reader would like beside them. A
   * missing file - the approval packages are not committed - or a refusal leaves the
   * case exactly as it opened before, which is still a working case.
   */
  const source = deps.library.list().find((s) => s.name === b.case && s.askable);
  let attached: string | null = null;
  if (source !== undefined) {
    try {
      const r = deps.documents.upload({
        caseId, filename: basename(source.document), bytes: readFileSync(source.document),
        uploadedBy: user.id, at: new Date(now).toISOString(),
      });
      if (r.ok) attached = r.document.id;
    } catch {
      // Unreadable on disk between the manifest check and here. The case still opens.
    }
  }

  /* A page number is only a citation once it names the document the page is in, so the
     link is made where BOTH are known. A finding with no page is left alone: there is
     no honest page to put it on, and read.tsx drops those rather than guessing one. */
  const findings = attached === null
    ? loaded.findings
    : loaded.findings.map((f) => (f.sourcePage === undefined ? f : { ...f, sourceDocumentId: attached }));

  const { inventory } = deps.service.open({
    caseId, compoundLabel: loaded.compoundLabel, context: loaded.context,
    ownerId: user.id, participantIds: panel,
    findings, modality: loaded.modality,
    at: new Date(now).toISOString(),
  });
  return json(res, 201, { ...head, alreadyOpen: false, inventory });
}

export function buildDeps(logPath: string): ServerDeps {
  const checklist = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;
  const prompt = JSON.parse(readFileSync(ADJUDICATOR_PROMPT_PATH, "utf8")) as { system: string[]; userTemplate: string[] };
  const probe = JSON.parse(readFileSync("data/probe-case.json", "utf8")) as { rules: AdjudicateRequest["rules"] };
  return {
    service: new DeliberationService(new FileStore(logPath), checklist),
    auth: new AuthStore(`${logPath}.users.json`),
    documents: new DocumentStore("results/documents"),
    library: new LibraryStore(),
    invites: new InviteStore(`${logPath}.invites.json`),
    shares: new ShareStore(`${logPath}.shares.json`),
    // Throws on a short secret, and this runs at boot - a weak secret stops the
    // process starting at all rather than silently producing guessable URLs.
    shareSecret: shareSecret(process.env),
    throttle: new LoginThrottle(),
    budget: new ModelBudget(budgetFrom(process.env)),
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
  // Before anything reads configuration. A missing .env is not an error - every value
  // has a working default and the product runs with none of them set.
  loadEnv();
  const envFile = envFileInUse();
  const HOST = bindHost();
  const port = Number(process.env["PORT"] ?? 8787);
  const deps = buildDeps("results/deliberation-log.jsonl");

  /**
   * Seed the demonstration team on boot, when asked to and only into an EMPTY store.
   *
   * `npm run seed:demo` still exists and does the same thing. This exists because a
   * shared configuration file is handed to someone who has not read the README, and a
   * product that boots to a sign-in screen with no accounts looks broken rather than
   * unseeded. The variable lives in the shared file, so opting in is something the
   * person distributing it did deliberately.
   *
   * TWO GUARDS, because this creates real accounts with a published password. It runs
   * only when the variable is set, and only when there are no accounts at all - so it
   * can never add a demo team beside real users, and never resurrects one that was
   * deliberately deleted while the flag was off.
   */
  if ((process.env["ARBITER_DEMO_SEED"] ?? "") === "1" && deps.auth.list().length === 0) {
    const report = seedDemoTeam(deps.auth, Date.now());
    console.log(`Seeded ${String(report.created.length)} demonstration accounts (ARBITER_DEMO_SEED=1). Shared password: ${DEMO_PASSWORD}`);
    console.log("Real accounts on the real authentication path. Delete results/deliberation-log.jsonl.users.json before this holds anything that matters.");
  }
  createServer((req, res) => { void makeHandler(deps)(req, res); }).listen(port, HOST, () => {
    console.log(`ARBITER deliberation API on http://${HOST}:${port}`);
    const adjudicationModel = resolveModel("adjudication");
    // The PROVIDER is printed beside every model, because that is the fact a
    // misconfiguration hides: "gemini-3.5-flash" and "claude-opus-5" look equally
    // plausible in a banner, and only one of them is the deployment this project
    // measured. A model name alone made the reader infer it.
    const named = (kind: Parameters<typeof resolveModel>[0]): string => {
      const model = resolveModel(kind);
      // The Gemini side names its ENDPOINT, not just the provider: an API key can send
      // a `gemini-` model to either Vertex or the Developer API, and those serve
      // different catalogues, so "Vertex AI" alone would be a guess dressed as a fact.
      return `${model} (${providerFor(model) === "vertex" ? geminiEndpointLabel(process.env) : "Anthropic"})`;
    };
    // The STUB line carries the FIX, not just the diagnosis. A developer handed a
    // configuration file has no way to know which of four credential mechanisms this
    // service wanted, and `{"error":"no_key"}` on the wire cannot tell them either -
    // spec §10 pins that body. So the actionable half is printed here.
    const advice = providerFor(adjudicationModel) === "vertex"
      ? geminiCredentialAdvice(process.env)
      : "set ANTHROPIC_API_KEY";
    console.log(`Adjudication: ${completeFromEnv(process.env, "adjudication") === null ? `STUB (no credentials for ${adjudicationModel}) - responses are labelled source:stub${advice === "" ? "" : `\n              To fix: ${advice}`}` : `LIVE ${named("adjudication")}`}`);
    console.log(`Ask & summary: ${named("ask")}`);
    console.log(`Short calls:  ${named("short")}`);
    // Which file the configuration came from. A shared `.env.share` that was never
    // renamed used to be indistinguishable from no configuration at all.
    // The DIRECTORY as well as the file. Configuration is resolved relative to the
    // working directory, so a service started from a second checkout reads that
    // checkout's `.env` - or none - while the person reading the banner is looking at
    // the first. Both halves are needed to tell those apart.
    console.log(`Config: ${envFile ?? "no .env or .env.share found - defaults only"}  (in ${process.cwd()})`);
    // Configuration that decides whether a capability exists should be visible at
    // boot, the way the storage lines above already are.
    console.log(`Share:  ${deps.shareSecret === null
      ? "off - ARBITER_SHARE_SECRET is unset, so records cannot be published"
      : "on - records can be published to a tokenised URL"}`);
    console.log(`Accounts: ${deps.auth.list().length} registered. Sign in for a bearer token.`);
    console.log(HOST === "127.0.0.1"
      ? "Bound to loopback. This process terminates no TLS; set ARBITER_HOST only behind a proxy that does."
      : `WARNING: bound to ${HOST}, not loopback. This process terminates no TLS - it must sit behind a proxy that does. Model calls are capped at ${budgetFrom(process.env)} per account per 10 minutes.`);
    if (deps.auth.list().length === 0) console.log("No accounts yet. Run `npm run seed:demo`, or set ARBITER_DEMO_SEED=1, to create the demonstration team.");
  });
}
