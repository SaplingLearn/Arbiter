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

/**
 * The deliberation API. Spec §3.3 - "the web app stops owning data and reads
 * through the service".
 *
 * IDENTITY IS A PERSONA HEADER, AND IT IS NOT AUTHENTICATION.
 *
 * `x-arbiter-user` names the actor. Anyone who can reach the port can claim to be
 * anyone. That is the `demo-persona` signature method the record model already
 * carries (§3.3), and it is the honest state of this build - but it means the
 * blindness guarantee holds against the UI and against an honest participant, NOT
 * against someone willing to send a different header. Replacing this with real
 * accounts is a prerequisite for any real sponsor data, and §9 already lists
 * uploaded documents as confidential.
 *
 * Because of that, THIS BINDS TO LOOPBACK ONLY. Not a hardening measure - a refusal
 * to make an unauthenticated service reachable by accident. There is no flag to
 * change it; the day real identity lands, the host becomes a parameter.
 *
 * Every mutating route returns the service's own error kinds. A rejected submission
 * is an ordinary 409, not a 500: submitting twice, or citing something that is not
 * in the case, are things a correct client does occasionally and a user must see.
 */

const HOST = "127.0.0.1";

export interface ServerDeps {
  service: DeliberationService;
  rules: AdjudicateRequest["rules"];
  prompt: { system: string[]; userTemplate: string[] };
}

const ERROR_STATUS: Record<string, number> = {
  not_open: 409, not_locked: 409, not_a_participant: 403, already_submitted: 409,
  unknown_finding_id: 400, empty_reasoning: 400, not_all_submitted: 409,
  not_the_owner: 403, no_adjudication: 409, override_needs_reason: 400, already_signed: 409,
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    // A body limit, because an unbounded read is a way to take the process down
    // with one request and this listens on a socket.
    if (size > 2_000_000) throw new Error("body_too_large");
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function makeHandler(deps: ServerDeps) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const actor = String(req.headers["x-arbiter-user"] ?? "");
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    const parts = url.pathname.split("/").filter((p) => p !== "");
    const method = req.method ?? "GET";

    if (parts[0] !== "api") return json(res, 404, { error: "not_found" });

    let body: unknown;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 413, { error: "body_too_large" });
    }

    // Every route below except case creation and the raw adjudicate surface needs
    // to know who is asking - the blind view is computed FROM the viewer, so an
    // unattributed request has no correct answer and must not get a default one.
    const needsActor = !(parts[1] === "adjudicate" || parts[1] === "cases-catalogue");
    if (needsActor && actor.trim() === "") {
      return json(res, 401, { error: "no_actor", detail: "Set x-arbiter-user. A blind view has no meaning without a viewer." });
    }

    try {
      // POST /api/adjudicate - the stateless surface, unchanged.
      if (parts[1] === "adjudicate" && parts.length === 2 && method === "POST") {
        const live = completeFromEnv();
        const r = await handleAdjudicate(body, live ?? stubComplete(body as AdjudicateRequest), deps.prompt);
        return json(res, r.status, r.body);
      }

      // POST /api/demo - seed a named case from the files on disk.
      //
      // The client cannot read data/, and hand-typing findings into a browser to start
      // a demonstration is how a demonstration comes to use findings that are not the
      // ones in the repository. This calls the SAME loader `npm run deliberate:demo`
      // calls, so the screen and the terminal cannot disagree about the evidence.
      // GET /api/cases-catalogue - every case, including the ones that refuse.
      if (parts[1] === "cases-catalogue" && method === "GET") {
        return json(res, 200, CATALOGUE);
      }

      if (parts[1] === "demo" && method === "POST") {
        const b = body as { case?: unknown; participantIds: string[]; at: string };
        if (!isCaseName(b.case)) {
          return json(res, 400, { error: "unknown_case", detail: `case must be one of: ${CATALOGUE.map((c) => c.name).join(", ")}.` });
        }
        // 422, not 404 or 500. The case exists and is named in the catalogue; the
        // DOCUMENT cannot be processed, and the client renders that reason verbatim.
        // Falling back to an empty case would make split_review.py's refusal
        // decorative, which is the one thing it must never be.
        const refused = refusalFor(b.case);
        if (refused !== null) return json(res, 422, { error: "document_refused", ...refused });
        const loaded = loadCase(b.case);
        const existing = deps.service.inventory(loaded.caseId);
        if (existing !== null) {
          return json(res, 200, { caseId: loaded.caseId, alreadyOpen: true, inventory: existing, compoundLabel: loaded.compoundLabel, context: loaded.context, provenance: loaded.provenance, documentScope: loaded.documentScope ?? null });
        }
        const { inventory } = deps.service.open({
          caseId: loaded.caseId, compoundLabel: loaded.compoundLabel, context: loaded.context,
          ownerId: actor, participantIds: b.participantIds,
          findings: loaded.findings, modality: loaded.modality, at: b.at,
        });
        return json(res, 201, { caseId: loaded.caseId, alreadyOpen: false, inventory, compoundLabel: loaded.compoundLabel, context: loaded.context, provenance: loaded.provenance, documentScope: loaded.documentScope ?? null });
      }

      if (parts[1] !== "cases") return json(res, 404, { error: "not_found" });

      // POST /api/cases
      if (parts.length === 2 && method === "POST") {
        const b = body as { caseId: string; compoundLabel: string; context: string; participantIds: string[]; findings: CoveringFinding[]; modality?: Modality; at: string };
        const { case: c, inventory } = deps.service.open({
          caseId: b.caseId, compoundLabel: b.compoundLabel, context: b.context,
          ownerId: actor, participantIds: b.participantIds, findings: b.findings,
          ...(b.modality === undefined ? {} : { modality: b.modality }), at: b.at,
        });
        return json(res, 201, { case: c, inventory });
      }

      const caseId = parts[2];
      if (caseId === undefined) return json(res, 404, { error: "not_found" });
      const tail = parts[3];

      if (method === "GET") {
        switch (tail) {
          case "inventory": {
            const inv = deps.service.inventory(caseId);
            return inv === null ? json(res, 404, { error: "no_case" }) : json(res, 200, inv);
          }
          case "view": {
            // THE blind route. It is computed per viewer, and it is the only route
            // that returns positions before the reveal.
            const v = deps.service.view(caseId, actor);
            return v === null ? json(res, 404, { error: "no_case" }) : json(res, 200, v);
          }
          case "unanimity": {
            const u = deps.service.unanimity(caseId);
            return u === null ? json(res, 404, { error: "no_case" }) : json(res, 200, u);
          }
          case "audit":
            return json(res, 200, deps.service.audit(caseId));
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
          case "positions": {
            const r = deps.service.submit(caseId, { ...(body as Position), participantId: actor });
            return r.ok ? json(res, 201, { sealed: true }) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "reveal": {
            const b = body as { at: string; mode: "all_in" | "close_early" };
            const r = deps.service.reveal(caseId, actor, b.at, b.mode);
            return r.ok ? json(res, 200, deps.service.view(caseId, actor)) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
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
            const r = deps.service.signOff(caseId, { by: actor, at: b.at, agreesWithAdjudication: b.agreesWithAdjudication, reason: b.reason });
            return r.ok ? json(res, 200, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          default:
            return json(res, 404, { error: "not_found" });
        }
      }

      return json(res, 405, { error: "method_not_allowed" });
    } catch (e) {
      return json(res, 500, { error: "internal", detail: e instanceof Error ? e.message : "unknown" });
    }
  };
}

export function buildDeps(logPath: string): ServerDeps {
  const checklist = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;
  const prompt = JSON.parse(readFileSync("prompts/adjudicator-v1.0.json", "utf8")) as { system: string[]; userTemplate: string[] };
  const probe = JSON.parse(readFileSync("data/probe-case.json", "utf8")) as { rules: AdjudicateRequest["rules"] };
  return {
    service: new DeliberationService(new FileStore(logPath), checklist),
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
    console.log("Identity is the x-arbiter-user header. This is NOT authentication and binds to loopback only.");
  });
}
