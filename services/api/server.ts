import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, readFileSync, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DeliberationService } from "./deliberation-service.js";
import type { Position } from "./deliberation.js";
import type { CoveringFinding, EvidenceChecklist, Modality } from "./inventory.js";
import { ADJUDICATOR_PROMPT_PATH, type AdjudicateRequest } from "./adjudicate.js";
import { handleAsk } from "./ask.js";
import { handleSummarise } from "./summarise.js";
import { buildIndex, search } from "./retrieval.js";
import { completeFromEnv, providerFor, resolveModel, type CallKind, type Complete } from "./interpret.js";
import { geminiCredentialAdvice, geminiEndpointLabel } from "./gemini.js";
import { stubComplete } from "./probe.js";
import { adjudicateConsensus, runsFrom } from "./consensus.js";
import { CATALOGUE, isCaseName, loadCase, refusalFor } from "./cases.js";
import { normaliseEmail, type PublicUser } from "./auth.js";
import { buildStores, describeStorage } from "./stores.js";
import type { AuthStoreApi } from "./postgres-auth.js";
import type { InviteStoreApi } from "./postgres-invites.js";
import { DEMO_PASSWORD, DEMO_TEAM, seedDemoTeam } from "./seed-demo.js";
import { MAX_BYTES, type DocumentStoreApi } from "./documents.js";
import { LibraryStore } from "./library.js";
import { can, denial, type CaseAction } from "./access.js";
import { LoginThrottle } from "./throttle.js";
import { ModelBudget, budgetFrom } from "./spend.js";
import { envFileInUse, loadEnv } from "./env.js";

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

/**
 * THE BUILT SITE IS SERVED ONLY WHEN ARBITER_STATIC_DIR SAYS SO, AND THE UNSET CASE IS
 * NOT AN OVERSIGHT.
 *
 * `npm run dev` puts apps/landing's Vite server in front of everything and proxies /api
 * back here (tools/dev-all.mjs assigns the ports, apps/landing/vite.config.ts holds the
 * proxy table). Vite therefore owns every path outside /api during development, and it
 * owns it with hot module replacement and the current source. If this process also
 * answered those paths it would answer them from whatever `apps/landing/dist` happened
 * to hold - a build from last week, or nothing at all - and only in the arrangement
 * where a request reached the API directly. Two servers claiming one URL, with the
 * stale one winning some of the time, is worse than the 404 that was there before.
 *
 * Set, this is what puts the site and the API on ONE ORIGIN, which is not a preference
 * either. apps/deliberation calls `/api/...` same-origin and this service sends no CORS
 * headers at all - no `access-control-allow-origin`, no preflight handling - so a client
 * served from anywhere else fails on its first request, which it makes on load. Until
 * now the answer was "put a proxy in front of both"; `npm run site:build` already emits
 * exactly one directory holding the landing page at its root and the client staged at
 * the subpath links.ts names, so pointing this at that directory is the same
 * arrangement with nothing extra to deploy.
 *
 * Read through a function rather than at module load for the same reason `bindHost` is:
 * `.env` is loaded by the entry point, and a module-level read would happen first.
 */
function staticRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const dir = env["ARBITER_STATIC_DIR"];
  if (dir === undefined || dir.trim() === "") return null;
  // Resolved once, here, so every containment check downstream compares two absolute
  // paths. A relative root would be re-resolved against the process's CWD on each
  // request, and `relative()` on a relative root answers a different question.
  return resolve(dir.trim());
}

/**
 * Content types by extension, and this table is load-bearing rather than tidy.
 *
 * A `.js` bundle served as `text/plain` does not degrade gracefully: browsers refuse to
 * execute a module script whose MIME type is not a JavaScript one, so the page loads,
 * renders an empty root element, and reads as a broken BUILD rather than a wrong
 * header - which is a long way to travel from the actual cause. `.css` under strict
 * styling rules is dropped the same way and leaves an unstyled document.
 *
 * The fallback is `application/octet-stream`, deliberately, and not `text/plain`. An
 * unknown type that downloads is a visible bug somebody files; an unknown type the
 * browser is willing to sniff or render is a silent one that behaves differently in
 * each browser.
 *
 * Wider than the four extensions `npm run site:build` currently emits (html, css, js,
 * mjs), because the ones missing here are exactly the ones a future asset import adds
 * without anybody thinking about this file.
 */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".glb": "model/gltf-binary",
  ".hdr": "image/vnd.radiance",
};

/** `stat` that answers "no" instead of throwing, because a missing file is the ordinary
 *  case here (every 404 is one) and not an exceptional one. */
async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/**
 * Serve one file out of the built site.
 *
 * PATH TRAVERSAL IS THE ONLY THING HERE THAT CAN LOSE SOMETHING, and it is worth being
 * explicit about what is at stake: this process's CWD is the repo root (the Dockerfile
 * says why it has to be), so an escape reads `.env`, the account store with its password
 * hashes, and `results/deliberation-log.jsonl` - the record itself. Everything below is
 * arranged around not letting that happen.
 */
async function serveStatic(
  root: string, url: URL, req: IncomingMessage, res: ServerResponse,
): Promise<void> {
  const method = req.method ?? "GET";
  // A static file has nothing to POST to. HEAD is served because a health checker or a
  // link checker uses it and answering 405 to one looks like the site is down.
  if (method !== "GET" && method !== "HEAD") return json(res, 405, { error: "method_not_allowed" });

  /**
   * DECODED FIRST, CHECKED SECOND - and that order is the whole vulnerability.
   *
   * `new URL()` resolves literal dot segments while parsing, so `/../../.env` is
   * already `/.env` by the time it reaches here and never looks dangerous. It does NOT
   * percent-decode the pathname, so `/%2e%2e%2f%2e%2e%2f.env` arrives with its escapes
   * intact, survives that normalisation untouched, and turns into `../../.env` the
   * instant anything reads it as a filename. A containment check written against the
   * undecoded string would be checking a path the filesystem never sees.
   */
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    // A `%` that is not a valid escape. There is no filename this could name.
    return json(res, 400, { error: "bad_request" });
  }
  // A NUL byte truncates a path inside libc without truncating the JavaScript string
  // holding it, so `/index.html%00.png` is one filename to the extension lookup below
  // and a different one to the kernel. Node's own fs calls reject it too, but they do
  // so by throwing into `statOrNull`, which would report it as an ordinary missing
  // file - and "that is not here" is the wrong answer to a request that was never a
  // path. Refused before anything constructs a filename from it.
  if (decoded.includes("\0")) return json(res, 400, { error: "bad_request" });

  const target = resolve(root, `.${decoded}`);

  /**
   * CONTAINMENT BY `relative()`, NOT BY `startsWith()` ON THE JOINED STRING.
   *
   * A prefix test is the obvious way to write this and it is wrong twice over: a root
   * of `/srv/site` "contains" `/srv/site-backup/secrets` by prefix, and remembering to
   * append the separator is a correctness detail that has to be got right at every call
   * site forever. `relative()` answers the real question - the target is inside the
   * root exactly when walking from one to the other needs no `..` and does not restart
   * from an absolute path. `resolve()` above has already collapsed every `.`, `..` and
   * duplicate separator, so this compares two normalised absolute paths and nothing
   * else.
   *
   * SYMLINKS ARE NOT FOLLOWED HERE, and that is a stated scope rather than a gap: the
   * directory being served is a build output this repo creates by copying
   * (tools/stage-site.mjs uses `cp`), so there is no link inside it to walk out of. A
   * root assembled some other way - a mount, an unpacked archive - would want a
   * `realpath` on the resolved target and the same check again against the real root.
   *
   * 404 rather than 403, matching what the case routes above do: a 403 confirms that
   * something is there, which is the one fact the request was fishing for.
   */
  const rel = relative(root, target);
  if (rel !== "" && (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    return json(res, 404, { error: "not_found" });
  }

  let info = await statOrNull(target);

  /**
   * A DIRECTORY REDIRECTS TO ITS TRAILING-SLASH FORM BEFORE IT RESOLVES TO index.html,
   * and serving the document straight from `/deliberation` instead would find the right
   * file and still boot the wrong application.
   *
   * apps/deliberation builds with `base: "./"` (its vite.config.ts explains why), so its
   * index.html asks for `./assets/index-<hash>.js`. At `/deliberation` the browser
   * resolves that against `/` and requests `/assets/index-<hash>.js` - which EXISTS,
   * because it is the landing page's own bundle - so the reader gets the overture where
   * the product should be, with no 404 anywhere to explain it. At `/deliberation/` the
   * same reference resolves to `/deliberation/assets/...`, which is what was staged.
   *
   * The query string is carried across because a redirect that drops it silently loses
   * whatever the link was carrying; the fragment never reaches a server at all, which is
   * what makes both apps' hash routing invisible here.
   */
  if (info !== null && info.isDirectory() && !decoded.endsWith("/")) {
    // `content-length: 0` rather than letting Node fall back to chunked encoding for a
    // body that does not exist. A chunked redirect is legal and some intermediaries
    // handle it worse than they handle a declared empty one.
    res.writeHead(301, { location: `${url.pathname}/${url.search}`, "content-length": 0 });
    res.end();
    return;
  }

  /**
   * NO SPA REWRITE TABLE, deliberately. Both apps route on the fragment - `#/case/123`
   * - so every route in either of them is a request for that app's index.html and
   * nothing else. The usual "rewrite any unmatched path to index.html" rule would buy
   * nothing here and would cost the ability to answer 404: a missing asset would come
   * back as an HTML page with status 200, which is how a broken deploy hides.
   */
  let file = target;
  if (info !== null && info.isDirectory()) {
    file = join(target, "index.html");
    info = await statOrNull(file);
  }
  if (info === null || !info.isFile()) return json(res, 404, { error: "not_found" });

  /**
   * TWO CACHE POLICIES, because the two kinds of file fail in opposite directions.
   *
   * Vite writes a content hash into every filename it emits under `assets/`, so one URL
   * there can only ever mean one set of bytes - different bytes get a different name.
   * That is what makes `immutable` correct rather than optimistic: there is no
   * revalidation being skipped, because there is nothing the file could become.
   *
   * index.html has a FIXED name and is the document that NAMES those hashed files, so it
   * is the one thing a redeploy changes in place. Cached for even a minute, a returning
   * reader gets the previous build's asset names - which the new deployment no longer
   * has - and sees a blank page with 404s in the console that heals only on a hard
   * refresh nobody knows to perform. `no-cache` is not "do not cache": it stores the
   * copy and forbids using it without revalidating, which is exactly what the ETag below
   * makes cheap.
   *
   * Keyed off the SERVED path rather than the requested one, so `/deliberation/` getting
   * its index.html is judged as the html it is.
   */
  const served = relative(root, file).split(sep);
  const immutable = served.includes("assets");

  // A weak-ish validator built from size and mtime rather than a hash of the bytes.
  // Hashing every response would mean reading the whole file to answer a request that
  // usually ends in "no change" - the opposite of the streaming this route exists to do.
  // The PDF route above can do better because documents.ts already has a sha256.
  const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  const headers = {
    "content-type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    etag,
  };

  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  res.writeHead(200, { ...headers, "content-length": info.size });
  if (method === "HEAD") {
    res.end();
    return;
  }

  /**
   * STREAMED, NEVER READ WHOLE. This process already peaks near 160 MB on one upload -
   * readRaw() buffers the body and MAX_BYTES is 80 MB, so `Buffer.concat` briefly holds
   * two copies - and the machine is 1 GB (fly.toml does that arithmetic). Adding a few
   * MB of resident bundle per concurrent page load on top of that turns a busy moment
   * into an OOM kill, which presents as a crashed server rather than as a static file
   * handler that was written the lazy way.
   */
  const stream = createReadStream(file);
  // Same reason as the document route above: this fires after the handler has returned,
  // so the try/catch around the caller cannot see it, and an 'error' with no listener is
  // an uncaught exception that takes down every in-flight request rather than this one.
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

export interface ServerDeps {
  service: DeliberationService;
  // THE INTERFACES, NOT THE FILE-BACKED CLASSES. Naming `AuthStore` here would have
  // compiled and then quietly made the file store the only thing this server can hold:
  // every Postgres implementation would be a type error at `buildDeps`, and the obvious
  // way out - widening to a union - grows a new arm per backing. The seam is the point.
  auth: AuthStoreApi;
  documents: DocumentStoreApi;
  library: LibraryStore;
  invites: InviteStoreApi;
  throttle: LoginThrottle;
  /** What the stores are backed by, for the banner. See `stores.ts`. */
  storage: string;
  /** Caps the endpoints that cost money. See `spend.ts`. */
  budget: ModelBudget;
  rules: AdjudicateRequest["rules"];
  prompt: { system: string[]; userTemplate: string[] };
  now?: () => number;
  /**
   * The built site to serve for every path outside /api, already resolved to an
   * absolute path by `staticRoot()`, or absent to answer 404 as this service always
   * has.
   *
   * A DEPENDENCY RATHER THAN A DIRECT READ OF process.env inside the handler, so the
   * test that asserts the unset behaviour and the test that serves a fixture directory
   * can run in the same process without one of them setting a variable the other one
   * reads. `buildDeps` is where the environment is consulted.
   */
  staticDir?: string | null;
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

    // Anything outside /api is the SITE, when there is one to serve. Unset - which is
    // every development run and every test but one - keeps the 404 this line has always
    // returned; see `staticRoot()` for why that is the behaviour to preserve rather than
    // an omission to fix.
    if (parts[0] !== "api") {
      const root = deps.staticDir ?? null;
      if (root === null) return json(res, 404, { error: "not_found" });
      return await serveStatic(root, url, req, res);
    }

    /**
     * GET /api/health - THE ONLY ROUTE THAT NEEDS NO TOKEN AND TOUCHES NO STORE.
     *
     * fly.toml could previously only run a TCP check, because every path outside /api
     * was a 404 and everything inside it that is not /api/auth/* is a 401. An HTTP check
     * configured to accept those as healthy stops distinguishing "the server is up" from
     * "the server is answering nonsense", so a connect was the honest thing to check.
     * This is a route where a 200 means the process parsed a request, ran this handler
     * and wrote a response - which is what "can it serve?" actually asks.
     *
     * ANSWERED BEFORE THE BODY IS READ, above `readRaw`, so a health check can neither
     * be made to allocate nor be delayed by a slow body. Small on purpose and public by
     * definition: `uptimeSeconds` separates "up" from "crash-looping and up again",
     * which is the one thing a check that only ever sees the healthy state cannot tell
     * you. Nothing about the configuration goes in it - not the model, not the account
     * count, not whether a database is attached. This route is reachable by anyone.
     */
    if (parts[1] === "health" && parts.length === 2 && method === "GET") {
      return json(res, 200, {
        ok: true,
        service: "arbiter-api",
        uptimeSeconds: Math.round(process.uptime()),
      });
    }

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
      // ---- auth, the unauthenticated surface that DOES something ------------
      //
      // /api/health above is the other route with no token on it, and the two are not
      // the same kind of thing: this one reads and writes the account store, so it
      // carries a throttle and constant-time failure; that one returns three fields and
      // touches nothing.
      if (parts[1] === "auth") {
        // `return await`, not a bare `return`. These two used to be synchronous, so a
        // throw inside them landed in this function's own catch and became the 500
        // below. Returning the promise unawaited hands the rejection to the caller
        // instead - and the caller is `void makeHandler(deps)(req, res)`, which drops
        // it into an unhandled rejection that takes the whole process down rather
        // than one request.
        return await handleAuth(deps, res, parts[2], method, body, bearer(req), now(),
          req.socket.remoteAddress ?? "unknown");
      }

      // The catalogue names no case contents and no positions, so it is readable by
      // anyone signed in - but not by anyone at all, because it describes what this
      // deployment holds.
      const session = await deps.auth.resolve(bearer(req), now());
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
      if (parts[1] === "people" && method === "GET") return json(res, 200, await deps.auth.list());

      if (parts[1] === "demo" && method === "POST") return await handleDemo(deps, res, body, user, now());

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
          const p = await deps.auth.findByEmail(email);
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
        if (await deps.service.getCase(caseId) !== null) {
          return json(res, 409, { error: "case_exists", detail: "A case with that identifier already exists." });
        }

        const { case: c, inventory } = await deps.service.open({
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
        const mine = await deps.service.casesFor(user.id);
        return json(res, 200, await Promise.all(mine.map(async (c) => ({
          ...c, documents: (await deps.documents.forCase(c.caseId)).length,
        }))));
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
      const kase = await deps.service.getCase(caseId);
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
            const inv = await deps.service.inventory(caseId);
            return inv === null ? json(res, 404, { error: "no_case" }) : json(res, 200, inv);
          }
          case "view": {
            // THE blind route. Computed per viewer, and the only route that returns
            // positions before the reveal.
            const v = await deps.service.view(caseId, user.id);
            return v === null ? json(res, 404, { error: "no_case" }) : json(res, 200, v);
          }
          case "unanimity": {
            const u = await deps.service.unanimity(caseId);
            return u === null ? json(res, 404, { error: "no_case" }) : json(res, 200, u);
          }
          case "audit":
            return json(res, 200, await deps.service.audit(caseId));
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
              const doc = (await deps.documents.forCase(caseId)).find((d) => d.id === parts[4]);
              if (doc === undefined) return json(res, 404, { error: "no_such_document" });

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

              // OPENED BEFORE THE STATUS LINE IS COMMITTED, and opened only after the
              // 304 above has had its chance. Both orderings are load-bearing.
              //
              // Before writeHead: the index and the bytes can drift apart - deleted
              // externally, a migration gap, a bucket typo - and once writeHead(200)
              // has gone out the client has been told this is a successful response,
              // with no way to take it back and turn it into a clean error.
              //
              // After the 304: opening it first would leave an open file handle, or a
              // live Storage download, abandoned on every revalidation - which is the
              // common case for a reader paging through one document, not the rare one.
              //
              // `streamFor` rather than pathFor+createReadStream because the two stores
              // cannot both answer "where is this on disk": Storage-backed documents
              // have no path, and inventing one per request would write an 80 MB temp
              // file per VIEW. See DocumentStore.streamFor.
              const stream = await deps.documents.streamFor(doc.id);
              if (stream === null) {
                return json(res, 500, {
                  error: "document_missing",
                  detail: "The document record exists but its file could not be found.",
                });
              }

              res.writeHead(200, {
                "content-type": "application/pdf",
                "content-length": doc.bytes,
                etag,
                "cache-control": "private, max-age=0, must-revalidate",
              });
              // A failure here is asynchronous and fires AFTER this handler's own
              // try/catch has already returned, so that catch cannot see it. Left
              // unhandled, Node treats an 'error' event with no listener as an
              // uncaught exception - which crashes the whole process, taking down
              // every in-flight request, not just this one.
              stream.on("error", () => res.destroy());
              stream.pipe(res);
              return;
            }
            return json(res, 200, await deps.documents.forCase(caseId));
          }
          case "participants": {
            const members = await Promise.all(kase.participantIds.map((id) => deps.auth.get(id)));
            return json(res, 200, {
              ownerId: kase.ownerId,
              members: members.filter((p) => p !== null),
              pending: await deps.invites.forCase(caseId),
              // Seats, BEFORE the reveal, and that is safe: §3.4 - a seat is identity,
              // not position. It decides which colour a person wears and says nothing
              // about whether they have answered or what they answered. This is the
              // only route that returns the allocation, so without it the seat map
              // never leaves the server and every badge on the client is uncoloured.
              // Nothing count-shaped goes with it; mark counts and per-person activity
              // would leak progress and are deliberately absent.
              seats: kase.seats,
            });
          }
          case "adjudication-request": {
            const r = await deps.service.adjudicationRequest(caseId, deps.rules);
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
            const r = await deps.documents.upload({
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
            const existing = await deps.auth.findByEmail(email);
            if (existing === null) {
              // No account yet: record the intent rather than refusing. Telling a
              // convener "ask them to register, then come back" loses the case, and
              // the person most likely to be left off is the one who disagrees.
              await deps.invites.add({ email, caseId, invitedBy: user.id, at: new Date(now()).toISOString() });
              return json(res, 202, {
                pending: true, email,
                detail: "No account for that address yet. They will join automatically when they register - tell them to, because nothing is emailed from here.",
              });
            }
            const r = await deps.service.addParticipant(caseId, existing.id, user.id, new Date(now()).toISOString());
            return r.ok ? json(res, 200, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "describe": {
            const b = body as { compoundLabel: string; context: string };
            const r = await deps.service.describe(caseId, b?.compoundLabel ?? "", b?.context ?? "", user.id, new Date(now()).toISOString());
            return r.ok ? json(res, 200, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "findings": {
            const f = body as CoveringFinding;
            if (f?.sourceDocumentId !== undefined) {
              const doc = await deps.documents.get(f.sourceDocumentId);
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
            const r = await deps.service.addFinding(caseId, f);
            return r.ok ? json(res, 201, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "positions": {
            const r = await deps.service.submit(caseId, { ...(body as Position), participantId: user.id });
            return r.ok ? json(res, 201, { sealed: true }) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "ask": {
            // A READ, despite being a POST - the body carries a question, and nothing
            // here writes. No position, no adjudication, no log entry, nothing into the
            // hash chain. The action switch above already falls through to "read" for
            // an unrecognised POST tail, so any participant or the owner may ask and
            // nobody gains a way to alter the record by asking.
            const docs = await deps.documents.forCase(caseId);
            const corpus = await Promise.all(docs.map(async (d) => ({
              documentId: d.id,
              filename: d.filename,
              pages: await deps.documents.textFor(d.id),
            })));
            const passages = search(buildIndex(corpus), String((body as { question?: unknown }).question ?? ""));
            const complete = completer("ask");
            if (overBudget(complete)) return;
            const out = await handleAsk(body, passages, complete);
            return json(res, out.status, out.body);
          }
          case "reveal": {
            const b = body as { at: string; mode: "all_in" | "close_early" };
            const r = await deps.service.reveal(caseId, user.id, b.at, b.mode);
            return r.ok ? json(res, 200, await deps.service.view(caseId, user.id)) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          case "adjudicate": {
            const request = await deps.service.adjudicationRequest(caseId, deps.rules);
            if (request === null) return json(res, 404, { error: "no_case" });

            /* ASKED BEFORE ANYTHING IS SPENT. This is three model calls out of a
               daily twenty, and the state check used to happen after them: a case in
               the wrong state cost 15% of a day's budget to be told 409. The check
               inside `attachAdjudication` still runs and is still the one that
               decides - a case can change while the model thinks. This one only
               stops the bill. */
            const ready = await deps.service.readyToAdjudicate(caseId);
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
            const r = await deps.service.adjudicate(caseId, out.body, (body as { at: string }).at, live === null ? "stub" : "model", consensus);
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
            const r = await deps.service.signOff(caseId, { by: user.id, at: b.at, agreesWithAdjudication: b.agreesWithAdjudication, reason: b.reason });
            return r.ok ? json(res, 200, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
          }
          default:
            return json(res, 404, { error: "not_found" });
        }
      }

      if (method === "DELETE" && tail === "findings" && parts[4] !== undefined) {
        const r = await deps.service.removeFinding(caseId, decodeURIComponent(parts[4]));
        return r.ok ? json(res, 200, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
      }

      if (method === "DELETE" && tail === "participants" && parts[4] !== undefined) {
        const target = decodeURIComponent(parts[4]);
        // An address that never registered is a pending invitation, not a member.
        if (target.includes("@")) {
          const revoked = await deps.invites.revoke(target, caseId);
          return revoked
            ? json(res, 200, { revoked: target })
            : json(res, 404, { error: "not_on_the_case", detail: "No pending invitation for that address." });
        }
        const r = await deps.service.removeParticipant(caseId, target, user.id, new Date(now()).toISOString());
        return r.ok ? json(res, 200, r.value) : json(res, ERROR_STATUS[r.error.kind] ?? 400, r.error);
      }

      return json(res, 405, { error: "method_not_allowed" });
    } catch (e) {
      return json(res, 500, { error: "internal", detail: e instanceof Error ? e.message : "unknown" });
    }
  };
}

async function handleAuth(
  deps: ServerDeps, res: ServerResponse, action: string | undefined,
  method: string, body: unknown, token: string | null, now: number, source: string,
): Promise<void> {
  if (action === "register" && method === "POST") {
    const b = body as { email: string; displayName: string; password: string };
    const r = await deps.auth.register({ email: b.email, displayName: b.displayName, password: b.password, now });
    if (!r.ok) return json(res, AUTH_STATUS[r.error.kind] ?? 400, r.error);

    // Standing invitations are claimed at registration: a convener added this address
    // to a case before it had an account, and this is where that lands.
    const claimed: string[] = [];
    // Sequential, not `Promise.all`: each addParticipant appends to the one global
    // hash chain, and the loop reads as the order the cases were joined in.
    for (const caseId of await deps.invites.claim(b.email)) {
      const added = await deps.service.addParticipant(caseId, r.value.id, r.value.id, new Date(now).toISOString());
      if (added.ok) claimed.push(caseId);
    }
    return json(res, 201, { ...r.value, joinedCases: claimed });
  }

  if (action === "login" && method === "POST") {
    await deps.auth.pruneExpired(now);
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

    const r = await deps.auth.login({ email: b.email, password: b.password, now });
    if (!r.ok) {
      deps.throttle.recordFailure(address, source, now);
      return json(res, AUTH_STATUS[r.error.kind] ?? 401, r.error);
    }
    deps.throttle.recordSuccess(address);
    return json(res, 200, r.value);
  }

  if (action === "request-reset" && method === "POST") {
    const b = body as { email: string };
    const issued = await deps.auth.requestReset(b.email, now);
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
    const r = await deps.auth.resetPassword(b.token, b.password, now);
    return r.ok ? json(res, 200, r.value) : json(res, AUTH_STATUS[r.error.kind] ?? 400, r.error);
  }

  if (action === "logout" && method === "POST") {
    if (token !== null) await deps.auth.logout(token);
    // 204 whether or not the token was real. "That token did not exist" is not
    // information a caller needs and is information an attacker would use.
    res.writeHead(204).end();
    return;
  }

  if (action === "me" && method === "GET") {
    const r = await deps.auth.resolve(token, now);
    return r.ok ? json(res, 200, r.value) : json(res, AUTH_STATUS[r.error.kind] ?? 401, r.error);
  }

  return json(res, 404, { error: "not_found" });
}

async function handleDemo(deps: ServerDeps, res: ServerResponse, body: unknown, user: PublicUser, now: number): Promise<void> {
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

  const existing = await deps.service.inventory(caseId);
  if (existing !== null) return json(res, 200, { ...head, alreadyOpen: true, inventory: existing });

  // The panel is whoever the caller named, or the seeded demonstration team if they
  // named nobody. Explicit rather than "the first four accounts in the store", which
  // is how a stranger ends up on a case about somebody else's compound.
  const named = (b.participantIds ?? []).filter((id) => id !== user.id);
  // Written as a branch rather than a ternary so the seeded team is only LOOKED UP
  // when nobody was named. A ternary over an awaited expression would resolve five
  // accounts on every call that already knows its panel.
  let panel = named;
  if (panel.length === 0) {
    const team = await Promise.all(DEMO_TEAM.map((p) => deps.auth.findByEmail(p.email)));
    panel = team.map((p) => p?.id).filter((id): id is string => id !== undefined && id !== user.id);
  }

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
      const r = await deps.documents.upload({
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

  const { inventory } = await deps.service.open({
    caseId, compoundLabel: loaded.compoundLabel, context: loaded.context,
    ownerId: user.id, participantIds: panel,
    findings, modality: loaded.modality,
    at: new Date(now).toISOString(),
  });
  return json(res, 201, { ...head, alreadyOpen: false, inventory });
}

/**
 * ASYNCHRONOUS because every store below is now opened rather than constructed - see
 * `FileStore` in store.ts for why loading cannot happen in a constructor once it can
 * await. Nothing here LOADS configuration - `loadEnv()` has already run by the time a
 * caller gets this far - but it does read it: the spend cap and the static root are both
 * environment, and this is the one place that turns them into dependencies.
 */
export async function buildDeps(logPath: string): Promise<ServerDeps> {
  const checklist = JSON.parse(readFileSync("rules/evidence-checklist-v1.0.json", "utf8")) as EvidenceChecklist;
  const prompt = JSON.parse(readFileSync(ADJUDICATOR_PROMPT_PATH, "utf8")) as { system: string[]; userTemplate: string[] };
  const probe = JSON.parse(readFileSync("data/probe-case.json", "utf8")) as { rules: AdjudicateRequest["rules"] };
  // WHICH BACKING IS LIVE IS DECIDED IN stores.ts, NOT HERE. This function used to name
  // FileStore, AuthStore, DocumentStore and InviteStore directly, which made it the
  // fifth place that would have had to learn about DATABASE_URL. `buildStores` is the
  // one place that asks, so a process cannot come up half on Postgres and half on disk.
  const stores = await buildStores(logPath);
  return {
    service: new DeliberationService(stores.deliberation, checklist),
    auth: stores.auth,
    documents: stores.documents,
    library: new LibraryStore(),
    invites: stores.invites,
    throttle: new LoginThrottle(),
    budget: new ModelBudget(budgetFrom(process.env)),
    rules: probe.rules,
    prompt,
    staticDir: staticRoot(),
    storage: stores.describe,
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
  const deps = await buildDeps("results/deliberation-log.jsonl");

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
  if ((process.env["ARBITER_DEMO_SEED"] ?? "") === "1" && (await deps.auth.list()).length === 0) {
    const report = await seedDemoTeam(deps.auth, Date.now());
    console.log(`Seeded ${String(report.created.length)} demonstration accounts (ARBITER_DEMO_SEED=1). Shared password: ${DEMO_PASSWORD}`);
    // WHERE THE ACCOUNTS ACTUALLY ARE, because this line used to name a file
    // unconditionally and the file is only right on one of the two backings. On a
    // Postgres deployment it sent the reader to delete something that does not hold the
    // accounts - and they would have deleted it, seen the demonstration team still
    // signing in, and had no idea why. A published shared password is exactly the wrong
    // thing to be vague about the location of.
    console.log(deps.storage.startsWith("Postgres")
      ? "Real accounts on the real authentication path. Delete them from auth_users before this holds anything that matters."
      : "Real accounts on the real authentication path. Delete results/deliberation-log.jsonl.users.json before this holds anything that matters.");
  }
  // Counted here rather than inside the banner below, because `listen`'s callback
  // cannot await and an async callback would be a floating promise: the banner would
  // print after the first request had already been served, or not at all if reading
  // the store threw. Nothing can register between this line and the listen anyway.
  const accounts = (await deps.auth.list()).length;

  // Probed BEFORE listen rather than inside the banner callback, which is not async.
  // Doing it here also means a Storage endpoint that hangs delays the banner rather than
  // being reported by a floating promise after the server is already taking requests.
  const documentsLine = await describeStorage();

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
    // SAID OUT LOUD, both ways, because both silences are expensive. A deployment that
    // meant to serve the site and did not answers 404 at `/` - which reads as a broken
    // image rather than an unset variable - and a directory named with a typo fails
    // exactly the same way while looking configured.
    if (deps.staticDir === null || deps.staticDir === undefined) {
      console.log("Site:   not served. ARBITER_STATIC_DIR is unset, so anything outside /api is a 404 (correct under `npm run dev`; wrong in a container).");
    } else if (!existsSync(deps.staticDir)) {
      console.log(`Site:   WARNING - ARBITER_STATIC_DIR points at ${deps.staticDir}, which does not exist. Every page will 404. Run \`npm run site:build\`.`);
    } else {
      console.log(`Site:   ${deps.staticDir} served on this origin for every path outside /api.`);
    }
    // WHICH BACKING HOLDS THE RECORD, printed for the same reason the config file is:
    // an empty product looks identical whether the data was lost or is sitting in the
    // store this process did not open. A deployment that meant to set DATABASE_URL and
    // typo'd it comes up perfectly healthy on local files that vanish with the container.
    console.log(`Record: ${deps.storage}`);
    // Reachability is checked here and not at boot-time-fatal, because a wrong bucket
    // name is permanent and a briefly unreachable endpoint is not - see `describeStorage`.
    // Left unsaid, a typo'd bucket is invisible until somebody's first upload fails.
    console.log(`Docs:   ${documentsLine}`);
    // `accounts`, counted and awaited above - NOT `deps.auth.list().length`, which this
    // line used to be. `list()` returns a promise now, and `.length` on a promise is
    // undefined, so the banner would have said "Accounts: undefined registered".
    console.log(`Accounts: ${accounts} registered. Sign in for a bearer token.`);
    console.log(HOST === "127.0.0.1"
      ? "Bound to loopback. This process terminates no TLS; set ARBITER_HOST only behind a proxy that does."
      : `WARNING: bound to ${HOST}, not loopback. This process terminates no TLS - it must sit behind a proxy that does. Model calls are capped at ${budgetFrom(process.env)} per account per 10 minutes.`);
    if (accounts === 0) console.log("No accounts yet. Run `npm run seed:demo`, or set ARBITER_DEMO_SEED=1, to create the demonstration team.");
  });
}
