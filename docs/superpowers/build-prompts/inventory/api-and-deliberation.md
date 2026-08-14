# Inventory: services/api and apps/deliberation

Compiled 2026-08-13 against branch feat/blueprint-design-system (clean tree). Every line number below was read directly from the file on this date. All paths are repo-relative from /Users/josegaelcruzlopez/Desktop/Arbiter.

Stack facts that matter here: services/api is a hand-rolled node:http server (no framework), binds 127.0.0.1, default port 8787, persistence is JSON/JSONL files on disk. apps/deliberation is a Vite + React 18 client depending on react and react-dom ONLY (apps/deliberation/package.json lists exactly those two dependencies). It does NOT depend on @arbiter/engine. In unified dev (`npm run dev`, tools/dev-all.mjs) the deliberation client is served at http://localhost:5173/deliberation/ via internal port 5274 (tools/dev-all.mjs:38-39); standalone dev uses port 5174 with a `/api` proxy to 127.0.0.1:8787 (apps/deliberation/vite.config.ts, `server.port: 5174`, `proxy: { "/api": ... }`).

Root scripts that touch this area (package.json): `api` = `tsx services/api/server.ts`, `seed:demo` = `tsx services/api/seed-demo.ts`, `deliberate:demo` = `tsx services/api/deliberation-demo.ts`, `probe` = `tsx services/api/probe.ts`, `deliberate:dev` / `deliberate:build` for the client.

---

## 1. services/api file map with line counts

| File | Lines | Role |
|---|---|---|
| services/api/server.ts | 561 | The entire HTTP surface. `makeHandler` (line 100), `handleAuth` (390), `handleDemo` (473), `buildDeps` (525), run-as-script guard (549-561) |
| services/api/deliberation.ts | 493 | Pure blind-deliberation state machine. No storage, no clock, no model |
| services/api/deliberation-service.ts | 371 | `DeliberationService`: pure layer joined to the log. Seal-before-store ordering lives here |
| services/api/store.ts | 260 | Hash-chained log, `DeliberationStore` interface, `MemoryStore`, `FileStore` |
| services/api/auth.ts | 358 | `AuthStore`: accounts, scrypt, sessions, reset tokens |
| services/api/access.ts | 97 | Pure per-case access control (`can`, `denial`, `visibleCases`) |
| services/api/adjudicate.ts | 323 | `handleAdjudicate`, request-derived JSON schema, `verifyAdjudication` |
| services/api/interpret.ts | 220 | `handleInterpret` (line 154), `completeFromEnv` (182). NOT MOUNTED as a route |
| services/api/navigate.ts | 114 | `handleNavigate` (line 74), its own `completeFromEnv` (90). NOT IMPORTED by server.ts at all |
| services/api/inventory.ts | 236 | `buildInventory`, checklist types, `absentForAdjudication`, `isChecklist` |
| services/api/cases.ts | 156 | Prepared-case library: `CATALOGUE`, `loadCase`, `refusalFor`, `isCaseName` |
| services/api/documents.ts | 163 | `DocumentStore`: PDF upload, measurement via data/prep/measure_pdf.py, dedup by sha256 |
| services/api/invites.ts | 90 | `InviteStore`: pending invitations claimed at registration |
| services/api/throttle.ts | 116 | `LoginThrottle`: per-address and per-source (spray) delay |
| services/api/probe.ts | 154 | Consistency-probe collection half; `stubComplete`; writes results/probe-runs.json |
| services/api/seed-demo.ts | 74 | `DEMO_TEAM`, `DEMO_PASSWORD` ("arbiter-demo-2026"), `seedDemoTeam` |
| services/api/canonical.ts | 27 | `canonicalJson` - deliberate second spelling of apps/harness/src/preregistration.ts, held by a drift guard |
| services/api/deliberation-demo.ts | 474 | Terminal demo. The ONLY caller of `disagreementReport` outside tests (import at line 4, call at line 365) |

---

## 2. The complete HTTP route table (services/api/server.ts)

`makeHandler` (server.ts:100) parses `url.pathname` into `parts` (105). Everything not under `/api` is 404 (108). Body limit: uploads get `MAX_BYTES` (80 MB, documents.ts:63), everything else 2,000,000 bytes (server.ts:112-118); overflow returns 413 `body_too_large`. Non-upload bodies are JSON-parsed; malformed JSON returns 400 `bad_json` (121-127). Bearer token extracted by `bearer()` (93-98).

### 2.1 Unauthenticated surface: `/api/auth/*` only (dispatch at server.ts:131-134, handler `handleAuth` at 390-471)

| Method | Path | Behaviour | Line |
|---|---|---|---|
| POST | /api/auth/register | `auth.register`, then claims pending invites via `invites.claim` + `service.addParticipant`; 201 with `{...PublicUser, joinedCases}` | 394-407 |
| POST | /api/auth/login | `throttle.retryAfter` checked BEFORE hashing (429 + retry-after header), `auth.login`, throttle record on fail/success; 200 `{token, user}` | 409-433 |
| POST | /api/auth/request-reset | `auth.requestReset`; token printed to server console (442), never mailed; always 202 with the same message whether or not the account exists | 435-449 |
| POST | /api/auth/reset | `auth.resetPassword(token, password)`; drops every live session for the user | 451-455 |
| POST | /api/auth/logout | `auth.logout(token)`; 204 whether or not the token was real | 457-463 |
| GET | /api/auth/me | `auth.resolve(token)`; 200 PublicUser or 401 | 465-468 |
| * | /api/auth/<anything else> | 404 `not_found` | 470 |

### 2.2 Authenticated, non-case routes (session resolved at server.ts:139-143; failures map through `AUTH_STATUS`, server.ts:60-64)

| Method | Path | Behaviour | Line |
|---|---|---|---|
| GET | /api/cases-catalogue | Returns `CATALOGUE` (cases.ts:77-84) | 145 |
| GET | /api/people | `deps.auth.list()` - every registered PublicUser, for id-to-name rendering | 149 |
| POST | /api/demo | `handleDemo` (473-523): opens a prepared case as `${loaded.caseId}--${user.id}`; 422 `document_refused` for refused cases, 422 `no_panel` when no participants resolvable, 200 `alreadyOpen: true` if the copy exists, else 201 | 151 |
| POST | /api/cases | Create a case. Resolves `participantEmails` to ids (422 `unknown_participants` listing unknown addresses), requires at least one participant, generates `caseId` from `hashOf` if absent, 409 `case_exists`, then `service.open`; 201 `{case, inventory}` | 156-200 |
| GET | /api/cases | `service.casesFor(user.id)` - only cases the account is named on | 203-205 |

Anything under `/api` that is not `auth`, `cases-catalogue`, `people`, `demo`, or `cases` is 404 (server.ts:153).

### 2.3 Per-case routes `/api/cases/:caseId/...`

The access boundary is checked ONCE before any route runs (server.ts:211-241): unknown case AND unreadable case both return 404 `no_case` (220-221, 237). The action is derived from METHOD AND tail (227-236):

- DELETE + tail `findings`|`participants` -> `adjudicate`; other DELETE -> `read`
- non-POST -> `read`
- POST + tail `findings`|`participants`|`describe` -> `adjudicate`; `positions` -> `submit`; `reveal` -> `reveal`; `adjudicate` -> `adjudicate`; `sign` -> `sign`; anything else -> `read`

Non-read actions run `denial()` and return 403 `{error:"forbidden", action, detail}` (238-241). Domain errors map through `ERROR_STATUS` (server.ts:52-58).

| Method | Path | Handler call | Line |
|---|---|---|---|
| GET | /api/cases/:id/inventory | `service.inventory(caseId)` | 245-248 |
| GET | /api/cases/:id/view | `service.view(caseId, user.id)` - THE blind route, per-viewer | 249-254 |
| GET | /api/cases/:id/unanimity | `service.unanimity(caseId)` | 255-258 |
| GET | /api/cases/:id/audit | `service.audit(caseId)` | 259-260 |
| GET | /api/cases/:id/documents | `deps.documents.forCase(caseId)` | 261-262 |
| GET | /api/cases/:id/participants | `{ownerId, members: PublicUser[], pending: PendingInvite[]}` | 263-268 |
| GET | /api/cases/:id/adjudication-request | `service.adjudicationRequest(caseId, deps.rules)` | 269-272 |
| GET | /api/cases/:id/<other> | 404 (also for GET /api/cases/:id with no tail - there is no plain case-detail GET) | 273-274 |
| POST | /api/cases/:id/documents | Raw PDF body, `x-filename` header; `documents.upload`; 201, or 422 for `unreadable`, 400 otherwise | 280-292 |
| POST | /api/cases/:id/participants | By email; unknown address becomes a pending invite (202 `pending:true`), known -> `service.addParticipant` | 293-310 |
| POST | /api/cases/:id/describe | `service.describe(caseId, compoundLabel, context, user.id, at)` | 311-315 |
| POST | /api/cases/:id/findings | Validates document-on-case, id/label/assertion; `service.addFinding`; 201 Inventory | 316-332 |
| POST | /api/cases/:id/positions | `service.submit(caseId, {...body, participantId: user.id})`; 201 `{sealed:true}` | 333-336 |
| POST | /api/cases/:id/reveal | `{at, mode: "all_in"|"close_early"}`; `service.reveal` then returns `service.view` | 337-341 |
| POST | /api/cases/:id/adjudicate | Builds `adjudicationRequest`, `handleAdjudicate` with `completeFromEnv() ?? stubComplete(request)`, then `service.adjudicate(caseId, out.body, at, "stub"|"model")`; 200 `{adjudication, source: "stub"|"live"}` | 342-354 |
| POST | /api/cases/:id/sign | `service.signOff(caseId, {by: user.id, at, agreesWithAdjudication, reason})` | 355-359 |
| POST | /api/cases/:id/<other> | 404 | 360-361 |
| DELETE | /api/cases/:id/findings/:findingId | `service.removeFinding` | 365-368 |
| DELETE | /api/cases/:id/participants/:idOrEmail | Email (contains "@") -> `invites.revoke`; else `service.removeParticipant` | 370-381 |
| * | anything else on a case | 405 `method_not_allowed` | 383 |

Catch-all: any thrown error is 500 `{error:"internal", detail}` (384-386).

Note a mismatch worth knowing: `service.adjudicate` is called with actor `"stub"` or `"model"` (server.ts:348) but the response body says `source: "stub"|"live"` (352); the deliberation client types it as `"stub"|"live"` (apps/deliberation/src/api.ts:240).

### 2.4 Handlers that exist and are NOT mounted (verified)

- **`handleInterpret` (services/api/interpret.ts:154)**: server.ts imports ONLY `completeFromEnv` from interpret.js (server.ts:10). There is no `parts[1] === "interpret"` branch anywhere in server.ts; the only non-case top-level branches are `auth` (131), `cases-catalogue` (145), `people` (149), `demo` (151), and `cases` (153). Verified by reading the whole 561-line file and by `grep -n "interpret" services/api/server.ts` returning only line 10.
- **`handleNavigate` (services/api/navigate.ts:74)**: navigate.ts is not imported by server.ts at all (no `navigate` string anywhere in server.ts).
- Both are unit-tested in services/api/test/handlers.test.ts (6 tests: 503 no_key, 400 bad_request without spending a token, and request-derived schema enums, for each handler).
- The web app POSTs to those paths: apps/web/src/ai/interpret.ts:325 `postJson<Proposal>("/api/interpret", ...)` and apps/web/src/ai/navigate.ts:158 `postJson<NavResult>("/api/navigate", ...)`. Both currently fall through server.ts to 404 (`parts[1]` is `interpret`/`navigate`, neither matches, line 153 returns 404), and the web app silently degrades to its cache/local rungs. This is the live bug named in the playbook.
- `handleAdjudicate` IS mounted, but only indirectly through POST /api/cases/:id/adjudicate (342-354). There is no standalone POST /api/adjudicate route either, despite the file header comment in adjudicate.ts:4 saying "POST /api/adjudicate".

---

## 3. DeliberationService (services/api/deliberation-service.ts)

Class at line 30. Constructor takes `(store: DeliberationStore, checklist: EvidenceChecklist)`.

Public methods, with line numbers:

| Method | Line | Returns | Notes |
|---|---|---|---|
| `open(init)` | 36 | `{case: DeliberationCase; inventory: Inventory}` | Appends `case_opened` (findings stored WHOLE in the payload, 49-62) then `inventory_published` (69-72); caches findings/inventory/modality; `putCase` |
| `inventory(caseId)` | 103 | `Inventory \| null` | Latest `inventory_published` entry, never recomputed |
| `addFinding(caseId, finding)` | 129 | `Result<Inventory>` | Guarded by `evidenceGuard` (open + nobody answered), duplicate id -> `duplicate_finding`, republishes |
| `removeFinding(caseId, findingId)` | 140 | `Result<Inventory>` | `no_such_finding` on miss |
| `submit(caseId, p)` | 197 | `Result<DeliberationCase>` | Citation check against `findingsOf`; SEAL WRITTEN FIRST: `position_sealed` log entry with `commitmentFor(stored)` (210-213), then `putCase` |
| `getCase(caseId)` | 221 | `DeliberationCase \| null` | Raw case for the server's access check |
| `casesFor(userId)` | 228 | `{caseId, compoundLabel, status, isOwner, submitted, of}[]` | Counts of who answered, never what they said |
| `addParticipant(caseId, userId, actorId, at)` | 264 | `Result<DeliberationCase>` | Via `mutate`, logs `participant_added` |
| `removeParticipant(caseId, userId, actorId, at)` | 269 | `Result<DeliberationCase>` | Logs `participant_removed` |
| `describe(caseId, compoundLabel, context, actorId, at)` | 274 | `Result<DeliberationCase>` | Logs `case_described` |
| `view(caseId, viewerId)` | 279 | `BlindView \| null` | Delegates to `visibleTo` |
| `reveal(caseId, by, at, mode)` | 284 | `Result<DeliberationCase>` | `mode: "all_in"` -> `lock`, `"close_early"` -> `closeEarly`; logs `revealed` with full positions in payload |
| `adjudicationRequest(caseId, rules)` | 308 | `AdjudicateRequest \| null` | `absent` = `absentForAdjudication(inv)` + `externalClaimsAsGaps(c)` (322) |
| `adjudicate(caseId, adjudication, at, actorId)` | 326 | `Result<DeliberationCase>` | Logs `adjudicated` |
| `signOff(caseId, s)` | 336 | `Result<DeliberationCase>` | Logs `signed` |
| `unanimity(caseId)` | 346 | `UnanimityReport \| null` | Delegates to `unanimityCheck(c, inv)` |
| `audit(caseId)` | 360 | `{chain: ChainFailure[]; seals: SealBreak[]; entries: LogEntry[]}` | Chain verified over the WHOLE log (366), seals over this case's entries |

Private: `findingsOf` (93, cache with log-recovery), `evidenceGuard` (151), `republish` (169, appends a fresh `case_opened` + `inventory_published` pair with `at: new Date(0).toISOString()`), `modalityOf` (188), `mutate` (251).

**THERE IS NO `disagreement(caseId)` METHOD.** The service never calls `disagreementReport`. The pure function exists at services/api/deliberation.ts:447 (interface `DisagreementReport` at 439-445: `{split: {call, participantIds[]}[]; contested: string[]; oneSided: {findingId, call}[]}`), returns `null` when fewer than two distinct calls. Its callers, verified by repo-wide grep: services/api/deliberation-demo.ts (import line 4, call line 365, console rendering 366-397) and services/api/test/deliberation.test.ts (describe at 359, tests at 362-408). No HTTP route, no service method, no client method, no component.

### 3.1 The pure layer (services/api/deliberation.ts) - the state machine the service wraps

Types: `Call` (28, "advance" | "do_not_advance" | "cannot_conclude"), `ExternalCitation` (30), `Position` (38-51: participantId, call, reasoning, citedFindingIds, external, submittedAt), `PositionBasis` (70) + `positionBasis` (72), `CaseStatus` (78, "open" | "locked" | "adjudicated" | "signed"), `Signature` (80-88: by, at, agreesWithAdjudication, reason), `DeliberationCase` (90-101: caseId, compoundLabel, context, ownerId, participantIds, status, positions, closedEarly, adjudication: unknown | null, signature), `DeliberationErrorKind` (103-120, 17 kinds), `Result<T>` (127).

Functions: `openCase` (132, dedupes and sorts participantIds), `addParticipant` (171, only while open AND before anybody answered - `has_answered` otherwise), `removeParticipant` (182, same guards + never empty the case), `describeCase` (199, allowed while unsigned), `submitPosition` (217, checks open, named participant, not already submitted, non-empty reasoning, citations against `knownFindingIds`; dedupes+sorts cited ids), `visibleTo` (270, `BlindView` at 263-268; while open others get one bit each; after lock `revealed` is sorted by participantId, never by submission time), `allSubmitted` (299), `lock` (305), `closeEarly` (324, owner only, records nonResponders), `attachAdjudication` (333, requires locked), `sign` (350, requires adjudicated, override needs reason), `unanimityCheck` (389, `UnanimityReport` at 383: `{unanimous, call, concerns[]}` - concerns raised only against agreement to advance; returns `{unanimous:false, call:null, concerns:[]}` on any split at line 393), `disagreementReport` (447), `externalClaimsAsGaps` (484).

---

## 4. The store seam (services/api/store.ts)

### 4.1 `DeliberationStore` interface (store.ts:174-181)

```ts
export interface DeliberationStore {
  append(e: { at: string; kind: LogKind; caseId: string; actorId: string; payload: unknown }): LogEntry;
  entries(caseId: string): LogEntry[];
  all(): LogEntry[];
  putCase(c: DeliberationCase): void;
  getCase(caseId: string): DeliberationCase | null;
  allCases(): DeliberationCase[];
}
```

- `MemoryStore` (188-217): arrays/Map in memory; `append` chains via `chainEntry(this.log.at(-1) ?? null, e)`.
- `FileStore extends MemoryStore` (233-260): constructor loads the JSONL log from `path` and case snapshots from `${path}.cases.json`; `append` also `appendFileSync`s one JSON line; `putCase` rewrites the whole cases file. TWO FILES ON PURPOSE (comment 226-231): the log holds commitments only and can be handed out mid-deliberation; the `.cases.json` sibling holds position plaintext.
- Chain primitives in the same file: `LogEntry` (41-50: seq, at, kind, caseId, actorId, payload, prevHash, hash), `LogKind` (52-66, nine kinds: case_opened, inventory_published, participant_added, participant_removed, case_described, position_sealed, revealed, adjudicated, signed), `GENESIS` = 64 zeros (70), `sha256Hex` (72), `commitmentFor(p) = sha256Hex(canonicalJson(p))` whole-object (86-88), `chainEntry` (90-98), `verifyChain` (106-129, `ChainFailure` kinds bad_hash | broken_link | bad_sequence), `verifySeals` (149-172, a revealed position with no seal is a FAILURE, not a skip).

### 4.2 What a Postgres migration would actually have to implement

The doc comment (store.ts:10-25) names `DeliberationStore` as the seam: "a Postgres implementation satisfies it without any caller changing, and the chain columns transfer as-is." Concretely a Postgres store must provide:

1. The six `DeliberationStore` methods above. `append` must compute `seq` and `prevHash` from the GLOBAL last entry (the chain is global, not per-case - store.ts:222-224 - so the table needs a serialized append, e.g. an advisory lock or SERIALIZABLE insert), hash with `sha256Hex(canonicalJson(body))` using services/api/canonical.ts `canonicalJson` (key-sorted at every level; drift-guarded against apps/harness/src/preregistration.ts by the "canonicalJson drift guard" describe in services/api/test/store.test.ts:28 - note there is NO separate canonical.test.ts despite the comment at canonical.ts:14 naming one).
2. `entries(caseId)` filtered by caseId in seq order; `all()` in seq order (verifyChain runs over `all()`).
3. `putCase`/`getCase`/`allCases` for the mutable case snapshot (position plaintext lives here, not in the log).

But `DeliberationStore` is NOT the whole persistence surface. Three more file-backed stores have NO interface seam and are constructed concretely in `buildDeps` (server.ts:525-538):

- `AuthStore` (auth.ts:150) - users, sessions, resets persisted as one JSON file at `${logPath}.users.json` (i.e. results/deliberation-log.jsonl.users.json).
- `DocumentStore` (documents.ts:91) - PDFs under results/documents/ as `${id}.pdf` plus index.json; content-hash dedup; measurement shells out to `data/prep/measure_pdf.py` (documents.ts:71-89).
- `InviteStore` (invites.ts:33) - `${logPath}.invites.json`.

A full DB migration must either extract interfaces for those three or replace their internals. `LoginThrottle` is memory-only and needs nothing.

---

## 5. Access control matrix (services/api/access.ts)

`CaseAction` (access.ts:20-25) = "read" | "submit" | "reveal" | "adjudicate" | "sign".

`can(c, userId, action)` (57-73):

| Action | Owner (not participant) | Participant (not owner) | Owner who is also participant | Stranger |
|---|---|---|---|---|
| read | yes (`canRead`, 44-46: owner OR participant) | yes | yes | no |
| submit | NO (participants only, 62-65) | yes | yes | no |
| reveal | yes (isOwner, 66-69) | no | yes | no |
| adjudicate | yes | no | yes | no |
| sign | yes | no | yes | no |
| (unknown action) | no - deny is the default shape (70-71) | no | no | no |

- `isOwner` (27), `isParticipant` (31), `canRead` (44).
- `denial` (83-89): null when permitted; read/submit denials say "You are not named on this case."; reveal/adjudicate/sign say "Only the decision owner can <action> this case." Never leaks the compound label.
- `visibleCases` (93-97): filter by `canRead`, sorted by caseId.
- Server-side wiring: read is enforced as 404 (server.ts:237), other actions as 403 with the denial payload (238-241). The action-derivation table is at server.ts:227-236 (method AND path, with the comment explaining why).
- Note: `submit` at the access layer allows any participant; the pure layer separately rejects double submission and non-participants (deliberation.ts:225-230). The owner-cannot-submit property holds only when the owner is not in `participantIds`; `handleDemo` filters the opener out of the named panel (server.ts:503) and DEMO seeding keeps the owner off the panel.

---

## 6. Auth surface (services/api/auth.ts)

Constants: `SCRYPT_N` 32768 / `SCRYPT_R` 8 / `SCRYPT_P` 1 / `KEY_LEN` 64 / `SALT_LEN` 16 (34-38), `SESSION_TTL_MS` = 12 h (43), `MIN_PASSWORD` = 12 (144), `RESET_TTL_MS` = 30 min (148), `maxmemFor` derived not constant (99-101).

Entities:
- `User` (47-57): id (`u_` + 18 hex), email (normalised), displayName, passwordHash, salt, params {N,r,p,keyLen} stored per record, signatureMethod ("password" | "sso", 45), createdAt.
- `Session` (68-76): tokenHash (sha256 of the bearer token - token itself never stored), userId, issuedAt, expiresAt. Sessions survive restart deliberately (163-165).
- `ResetToken` (59-66): tokenHash, userId, expiresAt, usedAt.
- `PublicUser` (78-83): id, email, displayName, signatureMethod. `publicUser` (85).
- `AuthErrorKind` (119-127): email_taken, bad_reset_token, rate_limited, invalid_credentials, weak_password, bad_email, no_session, session_expired. `AuthResult<T>` (134).

`AuthStore` (150) methods: `register` (181, permissive email regex, 12-char floor, dedupe by normalised email), `login` (222, decoy hash + timingSafeEqual so unknown-address timing matches wrong-password), `requestReset` (260, returns token or null, caller prints it), `resetPassword` (280, single use, expiry, drops every session for the user), `resolve` (305, the per-request gate), `logout` (325), `findByEmail` (330), `get` (336), `list` (341, sorted by email), `pruneExpired` (347, called on login). Helpers: `tokenHashOf` (109), `normaliseEmail` (115).

Throttle (services/api/throttle.ts): `DECAY_MS` 15 min (36), `SPRAY_THRESHOLD` 12 distinct addresses (40), `delayFor` free for <=3 failures then doubling 1 s to 5 min cap (47-50). `LoginThrottle` (55): `retryAfter` (76), `recordFailure` (82, per-address consecutive count AND per-source distinct-address set counted in excess of threshold), `recordSuccess` (104, clears address only, never the source), test surfaces `failuresFor` (109) and `addressesTriedBy` (113). Wired in `handleAuth` login BEFORE hashing (server.ts:417-424).

Demo team (seed-demo.ts): `DEMO_PASSWORD` = "arbiter-demo-2026" (20), `DEMO_TEAM` five accounts at arbiter.demo (22-28: r.okafor owner, a.silva, b.mehta, c.lindqvist, d.abara panel). `seedDemoTeam` (35). Accounts file: results/deliberation-log.jsonl.users.json.

---

## 7. Shape of every entity (where each is declared)

| Entity | File:line | Fields |
|---|---|---|
| `Position` | deliberation.ts:38 | participantId, call, reasoning, citedFindingIds: string[], external: ExternalCitation[], submittedAt |
| `ExternalCitation` | deliberation.ts:30 | claim, source? |
| `DeliberationCase` | deliberation.ts:90 | caseId, compoundLabel, context, ownerId, participantIds, status, positions, closedEarly: {by,at,nonResponders}\|null, adjudication: unknown\|null, signature: Signature\|null |
| `Signature` | deliberation.ts:80 | by, at, agreesWithAdjudication, reason |
| `BlindView` | deliberation.ts:263 | status, own: Position\|null, others: {participantId, submitted}[], revealed: Position[]\|null |
| `UnanimityReport` | deliberation.ts:383 | unanimous, call: Call\|null, concerns: string[] |
| `DisagreementReport` | deliberation.ts:439 | split: {call, participantIds[]}[], contested: string[], oneSided: {findingId, call}[] |
| `LogEntry` | store.ts:41 | seq, at, kind, caseId, actorId, payload, prevHash, hash |
| `ChainFailure` | store.ts:100 | seq, kind: bad_hash\|broken_link\|bad_sequence, detail |
| `SealBreak` | store.ts:131 | participantId, detail |
| `Inventory` | inventory.ts:98 | checklistVersion, modality, entries: InventoryEntry[], unmappedFindingIds |
| `InventoryEntry` | inventory.ts:85 | itemId, half: mechanism\|consequence, field, whatItBlocks, state, whyNotApplicable?, findingIds |
| `InventoryState` | inventory.ts:83 | present \| inconclusive \| absent \| not_applicable |
| `ChecklistItem` / `EvidenceChecklist` | inventory.ts:27 / 47 | id, half, field, whatItBlocks, appliesTo?: Modality[], whyNotApplicable? / version, items |
| `Modality` | inventory.ts:25 | small_molecule \| biologic |
| `CoveringFinding` | inventory.ts:122 | extends Finding with covers?: string[], sourceDocumentId? |
| `Finding` | adjudicate.ts:46 | id, label, assertion: toxic\|safe\|ambiguous, detail, sourceDocument?, sourcePage? |
| `AdjudicateRequest` | adjudicate.ts:55 | compoundLabel, context, rules: {id,name,statement,enabled,strength}[], findings, absent: {field, whatItBlocks}[] |
| `Adjudication` | adjudicate.ts:67 | mechanism {present, pathway, citedFindingIds}, consequence {verdict: do_not_advance\|advance\|cannot_conclude, reasoning, citedFindingIds}, ruleDisclosure[] {ruleId, position: applies\|does_not_apply, reasoning, citedFindingIds}, missing[] {field, whyItMatters}, nextExperiment: string\|null |
| `VerificationFailure` | adjudicate.ts:202 | kind: unknown_finding_id\|unknown_rule_id\|rule_not_addressed\|rule_addressed_twice, detail |
| `StoredDocument` | documents.ts:25 | id, caseId, filename, sha256, bytes, uploadedBy, uploadedAt, measurement |
| `Measurement` | documents.ts:37 | ok, verdict?, reason, note?, pages?, characters?, charactersPerPage?, embeddedImages?, sparsePages?, toxTermHits?, liverTermHits? |
| `UploadRejection` / `UploadResult` | documents.ts:51 / 56 | not_a_pdf \| too_large \| unreadable(with measurement) / ok+document+duplicateOf? or rejection |
| `PendingInvite` | invites.ts:26 | email, caseId, invitedBy, at |
| `User` / `Session` / `ResetToken` / `PublicUser` | auth.ts:47/68/59/78 | see section 6 |
| `CaseSummary` / `LoadedCase` / `RefusedCase` | cases.ts:28/36/51 | name, label, shape, usable / + caseId, compoundLabel, context, modality, findings, rules, provenance, documentScope? / + document, splitterReason, measurement |
| `ProbeRun` / `ProbeOutput` | probe.ts:25 / 33 | index, ok, adjudication, verificationFailures, error? / probeVersion:1, source: live\|stub, model, promptVersion, promptHash, compoundLabel, requestedRuns, runs |
| `InterpretRequest` | interpret.ts:36 | challenge, rules: {id,enabled,strength}[], claims: {id,label}[] |
| `NavigateRequest` | navigate.ts:20 | question, anchors: {id,label}[] |
| `ServerDeps` | server.ts:41 | service, auth, documents, invites, throttle, rules, prompt, now? |

`buildDeps(logPath)` (server.ts:525-538) reads rules/evidence-checklist-v1.0.json, prompts/adjudicator-v1.0.json, data/probe-case.json (for the rules), and constructs FileStore(logPath), AuthStore(`${logPath}.users.json`), DocumentStore("results/documents"), InviteStore(`${logPath}.invites.json`), LoginThrottle. Production logPath is "results/deliberation-log.jsonl" (554).

---

## 8. apps/deliberation - routes, screens, components

### 8.1 Route table (apps/deliberation/src/router.ts)

Hand-rolled hash router, no dependency. `Route` union (router.ts:17-26):

| Hash | Route | Rendered by (App.tsx) |
|---|---|---|
| `#/` or empty | dashboard (DEFAULT_ROUTE, 28) | `Dashboard` (App.tsx:221-222) |
| `#/dashboard` | dashboard | `Dashboard` |
| `#/new` | new | `NewCasePage` (224-228) |
| `#/library` | cases | `LibraryPage` (230-231) |
| `#/method` | method | `MethodPage` (233-234) |
| `#/case/:caseId` | case | Case overview: InventoryPanel + FindingsEditor (owner only) + Documents + RosterPanel (267-308) |
| `#/case/:caseId/position` | position | `Waiting` if already submitted, else `PositionForm` (310-318) |
| `#/case/:caseId/reveal` | reveal | Gate if not revealed (321-329); else `Reveal` + adjudicate button + `Verdict` + signed notice (330-350) |
| `#/case/:caseId/record` | record | `Audit`, or "The record opens once the case is closed." (352-354) |
| unknown case sub-route | falls back to case overview (router.ts:49) | |
| `signin` route exists in the union (18) but nothing parses to it; unauthenticated state renders `AuthPage` regardless (App.tsx:133-135) | | |

Helpers: `parseHash` (30), `href` (56), `navigate` (70), `caseIdOf` (76).

### 8.2 File-by-file component census

**App.tsx (355 lines)** - shell. Token in React state only (never localStorage). Loads people+catalogue+myCases on sign-in (100-112), loads the case bundle `view/inventory/adjudicationRequest/documents/roster` in parallel (69-94), unanimity+audit only when not open (80-86), polls the case every 3 s (120-124). `openPrepared` posts /api/demo raw-fetch (149-178); `upload` posts the PDF raw-fetch (180-200). Renders `<Reveal view={view} unanimity={unanimity} nameOf={nameOf} />` at line 332. Adjudication result is held in component state only (line 42) - it is NOT reloaded from the server on refresh, because no GET route returns a stored adjudication (the case's `adjudication` field never reaches the client; `BlindView` does not carry it).

**pages.tsx (474 lines)** - `AuthPage` (15, four modes in/up/forgot/reset), `Bucket` + `bucketOf` (167-175), `Dashboard` (184), `CaseCard` (244, module-private), `NewCasePage` (260), `LibraryPage` (369), `MethodPage` (404).

**screens.tsx (687 lines)** - `basisOf` (13), `CALL_LABEL` (19), `RosterPanel` (34), `FindingsEditor` (127), `Documents` (269), `Refused` (319), `InventoryPanel` (343), `PositionForm` (392), `Waiting` (488), `Reveal` (528), `Verdict` (565), `EVENT_LABEL` (628), `Audit` (640).

**Layout.tsx (156 lines)** - `initials` (12), `Layout` (18), `PageHead` (89), `Section` (105), `Steps` (127, the four case-stage tabs: Evidence / Your position / Reveal & verdict / Record).

**api.ts (250 lines)** - types mirrored by hand from the server (Call, InventoryState, InventoryEntry, CaseSummary, Refusal, Person, CaseListing, Roster, StoredDocument, Inventory, Position, BlindView, UnanimityReport, Adjudication, Finding, AuditResult), `ApiError` (137), private `call` (143), and the `api` object (168-250) with 24 methods:

register, createCase, addFinding, requestReset, resetPassword, roster, invite, removeParticipant, describeCase, removeFinding, login, logout, me, people, myCases, documents, catalogue, openCase, inventory, view, submit, reveal, unanimity, adjudicate, adjudicationRequest, sign, audit.

(That is every mounted route EXCEPT /api/demo and POST documents, which App.tsx calls with raw `fetch` at lines 157 and 186, and GET /api/cases/:id/participants which IS covered as `api.roster`.) **There is no `api.disagreement` and no method touching /api/interpret or /api/navigate.**

**router.ts (78)**, **main.tsx (7)**, **app.css (23,952 bytes)**.

### 8.3 What each screen renders and what it is missing

- **Case overview** (`#/case/:id`): inventory states, findings editor (owner, until frozen), documents with measurements, roster. Missing: nothing structural for its own purpose; findings rows show no applicability-domain or reliability badges (those concepts live in apps/web's engine world, not here).
- **Position** (`PositionForm`): call, reasoning, citation checkboxes, external claim + source, live basis label. This IS the commit-before-reveal forcing function.
- **Waiting**: one submitted-bit per person; owner gets Reveal-all (disabled until all in) and Close-without-them.
- **Reveal** (screens.tsx:528-562): all positions sorted by participantId, each with call, basis chip, reasoning, cited ids, external claims. Then ONLY the unanimity block, and only when unanimous. **When the room splits, the reader gets raw positions and nothing else** - no camp summary, no contested/one-sided finding analysis, even though `disagreementReport` computes exactly that server-side. This is playbook item P1-C.
- **Verdict**: stub banner when `source === "stub"`, mechanism/consequence split, per-rule disclosure, missing list, next experiment, sign/override with required reason (client-enforced at 620 `disabled={!agrees && reason.trim() === ""}`; server enforces `override_needs_reason` too, deliberation.ts:358).
- **Audit**: chain + seal verdict line, honest limits paragraph, full event table with roster changes called out.
- **Missing app-wide**: no inter-rater agreement statistic anywhere (verified: `grep -rniE "kappa|cohen|krippendorff|fleiss|inter.?rater|icc" apps/deliberation services/api` excluding node_modules/dist returns nothing, exit 1). No rendering of the case's stored `adjudication` after page reload (state only, App.tsx:42). No `conflictMass` (engine concept; zero hits in apps/deliberation/src).

### 8.4 Precisely where a disagreement panel would mount

`Reveal` component, apps/deliberation/src/screens.tsx lines 528-562, verbatim structure:

```tsx
export function Reveal({ view, unanimity, nameOf }: {          // line 528
  view: BlindView; unanimity: UnanimityReport | null; nameOf: (id: string) => string;
}): ReactElement {
  return (
    <section>
      <h2>Every position, at once</h2>                          // line 533
      {(view.revealed ?? []).map((p) => (                       // line 534
        ...position card: name, CALL_LABEL[p.call], basis chip,
        reasoning, cited ids, external claims...
      ))}                                                       // closes line 547

      {unanimity !== null && unanimity.unanimous && (           // line 549  <- THE GUARD
        <>
          <h2 style={{ marginTop: 32 }}>Everyone agreed. That is not the same as being right.</h2>
          ...
          {unanimity.concerns.map((c, i) => <div className="concern" key={i}>{c}</div>)}   // line 556
          {unanimity.concerns.length === 0 && <p className="ok">No gaps and every position rests on cited evidence.</p>}
        </>
      )}                                                        // line 559
    </section>
  );
}                                                               // line 562
```

The natural mount point is a sibling branch immediately after the unanimous block (between lines 559 and 560), rendered when the room split. Note `unanimityCheck` returns `{unanimous: false, call: null, concerns: []}` for a split room (deliberation.ts:393), so `unanimity.unanimous` being false is the split signal already available to the component - but the DisagreementReport DATA is not: it exists only server-side, on no route. Getting it to this component requires, end to end:

1. A service method (none exists) or direct call: `disagreementReport(this.store.getCase(caseId))` beside `unanimity()` in deliberation-service.ts (~line 346).
2. A route: the natural sibling is the GET switch in server.ts, `case "unanimity"` at 255-258; a `case "disagreement"` would go in the same switch (243-275). Alternatively extend the unanimity payload; note the client types `UnanimityReport` at api.ts:110-114.
3. A client method in the `api` object (apps/deliberation/src/api.ts:168-250) plus the `DisagreementReport` type mirrored into api.ts (the file mirrors every server type by hand; there is no shared types package).
4. State + loading in App.tsx: `loadCase` (69-94) already fetches unanimity when `v.status !== "open"` (84); the disagreement fetch belongs beside it, then a new prop through `<Reveal ... />` at App.tsx:332.
5. Rendering: participant ids in `split[].participantIds` need `nameOf` (already a Reveal prop); finding ids in `contested`/`oneSided[].findingId` are raw ids - the findings list with labels is in App.tsx state (`findings`, line 39, loaded from adjudicationRequest at 77) but is NOT currently passed to Reveal, so labelling contested findings requires passing `findings` (or a lookup) into Reveal as well.

House-rule caution for whoever builds it: the camp split is a description shown to a later reader, never a tally that gates anything; do not use the words "majority", "minority view", or "outvoted" (redesign spec 6.4/6.7; the deliberation-demo's own console rendering at deliberation-demo.ts:366-397 is the approved vocabulary: "where the room split, and on what", "cited by more than one camp", "cited by one camp only").

---

## 9. Test coverage map

Vitest runs from the root config; vitest.config.ts:10 maps `apps/deliberation/**` to the jsdom environment.

### 9.1 services/api/test (12 files, 249 `it(` occurrences)

| Test file | Tests | Covers | Notable describes |
|---|---|---|---|
| access.test.ts | 13 | access.ts | membership, can, denial, visibleCases, canRead against every case status |
| adjudicate.test.ts | 21 | adjudicate.ts + prompts/adjudicator-v1.0.json | adjudicationSchema, verifyAdjudication, POST /api/adjudicate (handler-level), userPrompt, "the registered prompt" |
| auth.test.ts | 19 | auth.ts + seed-demo.ts | register, login, sessions, "the demo team" (line 171) |
| cases.test.ts | 12 | cases.ts + rules/evidence-checklist-v1.0.json | catalogue, "the shipped checklist, after the modality change" |
| deliberation-service.test.ts | 11 | deliberation-service.ts | one describe: "the whole path with no model in it" |
| deliberation.test.ts | 48 | deliberation.ts | openCase, positionBasis, submitPosition, visibleTo, lock/closeEarly, sign, unanimityCheck, **disagreementReport (line 359-408)**, externalClaimsAsGaps |
| handlers.test.ts | 6 | interpret.ts handleInterpret + navigate.ts handleNavigate | the UNMOUNTED handlers are unit-tested; injected fake `complete`, never the SDK |
| inventory.test.ts | 24 | inventory.ts | buildInventory, not_applicable, absentForAdjudication, the shipped checklist |
| invites.test.ts | 17 | invites.ts + registration claim + roster mutations + describeCase | |
| server.test.ts | 31 | server.ts via `makeHandler` (line 7 import) | authentication, cases with access control, catalogue + demo seeding, roster on the record, document upload, routing |
| store.test.ts | 22 | store.ts + canonical.ts | "canonicalJson drift guard" (line 28 - the guard promised by canonical.ts:14; there is NO canonical.test.ts file), chainEntry, verifyChain, verifySeals, MemoryStore, FileStore |
| throttle.test.ts | 15 | throttle.ts | delayFor, per address, per source |

services/api files with NO dedicated test file: **probe.ts** (nothing in services/api/test; the analysis half is tested in apps/harness), **seed-demo.ts** (covered inside auth.test.ts "the demo team"), **documents.ts** (covered only via server.test.ts "document upload" describe at line 312 - `measurePdf`/`DocumentStore` have no direct unit test file), **deliberation-demo.ts** (demo script, untested), **canonical.ts** (covered inside store.test.ts, not its own file), **cases.ts loadCase refusal-throw path** is covered in cases.test.ts.

`completeFromEnv` (both copies) is not exercised by any test - tests always inject `complete`, by design (handlers.test.ts:6-9 comment).

### 9.2 apps/deliberation/test (1 file, 28 tests)

`test/screens.test.tsx` imports ONLY `{ Documents, InventoryPanel, Refused, Reveal, Verdict, Waiting, basisOf }` from `../src/screens.js` plus types from `../src/api.js` (lines 4-5). Describes: InventoryPanel (37), Documents (90), Refused (123), Waiting (144), basisOf (182), Reveal (191), Verdict (227).

NO unit tests exist for:

| File | Lines | Untested surface |
|---|---|---|
| src/App.tsx | 355 | All routing dispatch, data loading, polling, demo-open, upload, error/fatal handling |
| src/pages.tsx | 474 | AuthPage (all four modes), Dashboard + `bucketOf` bucketing logic, NewCasePage, LibraryPage, MethodPage |
| src/Layout.tsx | 156 | Layout, PageHead, Section, Steps (stage gating), `initials` |
| src/api.ts | 250 | `call` error mapping (`ApiError` from kind/error/detail), every method's path/body |
| src/router.ts | 78 | parseHash/href round-trip, unknown-sub-route fallback |
| src/screens.tsx (partial) | - | `RosterPanel`, `FindingsEditor`, `PositionForm`, `Audit` are exported and rendered by App.tsx but appear in no test |

Playwright: the only specs in the repo are apps/web/e2e/{ai-static,demo,static-file}.spec.ts - none touch apps/deliberation or services/api over HTTP end to end.

The SERVER side of the deliberation workflow is heavily covered (deliberation.test.ts 48 + deliberation-service.test.ts 11 + server.test.ts 31 = 90 tests); the CLIENT side has 28 tests over presentational components only.

---

## 10. Absence claims, with the searches that ground them

| Claim | Searches run | Result |
|---|---|---|
| disagreementReport is on no HTTP route and reaches no client | `grep -n "disagreement" services/api/server.ts apps/deliberation/src/api.ts apps/deliberation/src/App.tsx` (exit 1, zero matches); full read of server.ts route switches (243-275, 278-362); repo grep for `disagreementReport\|DisagreementReport` finds only deliberation.ts:439/447, deliberation-demo.ts:4/365, deliberation.test.ts | ABSENT from HTTP and UI; present in pure layer, demo, tests |
| No inter-rater agreement statistic in this cluster | `grep -rniE "kappa|cohen|krippendorff|fleiss|inter.?rater|icc" apps/deliberation services/api` excluding node_modules/dist (exit 1); also searched "agreement stat" case-insensitively | ABSENT |
| /api/interpret and /api/navigate are not mounted | `grep -n "interpret" services/api/server.ts` -> only line 10 (completeFromEnv import); `grep` for "navigate" in server.ts -> nothing; full read of the top-level dispatch (131-153) | Handlers exist (interpret.ts:154, navigate.ts:74), routes ABSENT; web clients POST to them (apps/web/src/ai/interpret.ts:325, apps/web/src/ai/navigate.ts:158) |
| conflictMass never appears in apps/deliberation | `grep -rn "conflictMass\|contested" apps/deliberation/src` (zero matches; "contested" exists only server-side in DisagreementReport) | ABSENT |
| No DeliberationService method for disagreement | Full read of deliberation-service.ts (all 371 lines); method list in section 3 is exhaustive | ABSENT |
| No plain GET /api/cases/:id detail route | Full read of the GET switch (server.ts:243-275): undefined tail hits `default` -> 404 | ABSENT (view/inventory serve the purpose) |
| No dedicated canonical.test.ts despite canonical.ts:14 naming it | `ls services/api/test/` (12 files listed, none named canonical); drift guard found in store.test.ts:28 | File ABSENT; guard EXISTS elsewhere |
| Client never reloads a stored adjudication | api.ts has no GET returning the case's `adjudication` field; BlindView (deliberation.ts:263-268) does not carry it; App.tsx:42 holds it in component state only | Structural gap, verified by type inspection |
