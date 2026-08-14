# R-2: The gate before any real sponsor data touches this system

| | |
|---|---|
| **Priority** | Post-submission, and **blocking before any real study report is uploaded** |
| **Estimated effort** | 3 to 5 days |
| **Depends on** | nothing |
| **Touches** | `services/api/access.ts`, `services/api/documents.ts`, `services/api/store.ts`, deployment config |

---

## Why this exists

The completion plan's Gate 4 says one thing you must not skip:

> **Do not skip the access-control line.** The moment this accepts a sponsor's study
> report it holds unpublished safety data, and the current build binds to loopback
> precisely because it has no answer to that.

The server currently binds `127.0.0.1` only, and `services/api/store.ts` documents that as
a deliberate consequence of having no TLS. That is an honest posture for a demo and an
unacceptable one for a deployment. This prompt is what has to be true before the posture
changes.

---

## What already exists, so you do not rebuild it

More is built here than a first read suggests. Confirm each before treating it as done.

**Authentication is real.** `services/api/auth.ts`: scrypt with per-record parameters so N
can be raised without invalidating old hashes; bearer tokens where only the SHA-256 digest
is stored; a 12-hour session TTL surviving restart; enumeration-safe and timing-safe login
using a decoy scrypt against a zero salt and `timingSafeEqual`; single-use 30-minute reset
tokens that invalidate every session on use. Password policy is length at least 12 with no
composition rules.

Explicitly absent and documented as such: **no email verification, no MFA**.
`signatureMethod` is typed `"password" | "sso"` and only `"password"` is ever set, which is
the seam for SSO.

**Per-case authorisation exists and is centrally enforced.** `services/api/access.ts`
derives roles per case rather than globally: `isOwner`, `isParticipant`, and
`CaseAction = "read" | "submit" | "reveal" | "adjudicate" | "sign"`. Read requires owner or
participant; submit requires participant, so an owner who is not a participant cannot
submit; reveal, adjudicate and sign are owner-only. Default deny. It runs **once,
centrally**, before any handler, keyed on method **and** path.

**Unauthorised read returns 404 `no_case`, never 403**, so a 403 cannot confirm that a case
exists, and denial messages never leak the compound label. That is better than most
production systems and you should not regress it.

**There is no global admin role**, deliberately.

---

## What is missing

- [ ] **1. Transport security.** No TLS. This is the reason for the loopback bind and it is
      the first thing to solve. Terminate TLS at a reverse proxy rather than in the
      hand-rolled `node:http` server, and keep the app bound to loopback behind it.

- [ ] **2. Document-level access control.** Case-level authorisation exists.
      `services/api/documents.ts` stores PDFs at `results/documents/<id>.pdf` with an index
      at `results/documents/index.json`. Confirm whether a document fetch is checked against
      the case's participant list, and whether the bytes are servable at all. If a document
      route is ever added, it must go through the same central check, not a new one.

- [ ] **3. Encryption at rest.** Unpublished safety data sitting as plaintext PDFs and JSON
      on a filesystem is the concrete risk. Decide and document: full-disk, per-object, or
      an object store that provides it.

- [ ] **4. Rate limiting beyond login.** `services/api/throttle.ts` is thoughtful:
      per-address consecutive failures and per-source **distinct addresses** failed against,
      the latter specifically because raw per-source counting throttled everyone behind the
      dev proxy. Delay rather than lockout, 15-minute decay, checked **before** the scrypt
      runs. But it applies to `POST /api/auth/login` **only**. Registration, reset, and the
      80MB document upload path have none.

- [ ] **5. Audit retention and export.** The hash chain is global rather than per case, so
      deleting a case would otherwise leave a hole. Decide retention, and decide what an
      export looks like for a customer who asks for their record. R-7 covers the format.

- [ ] **6. Persistence.** `FileStore` rewrites `.cases.json` in full on every write, with
      no locking and no fsync discipline. It is a correct single-process demo store and it
      is not safe under concurrency. `DeliberationStore` in `services/api/store.ts` is the
      named seam; the hash-chain columns transfer as-is. Postgres is optional per the
      completion plan, and **honest about being optional**: do not migrate for its own sake,
      migrate when concurrency or durability actually demands it.

- [ ] **7. Secrets.** Model credentials now come from `ARBITER_GCP_PROJECT` or
      `GOOGLE_CLOUD_PROJECT` plus `GOOGLE_APPLICATION_CREDENTIALS` or
      `GOOGLE_APPLICATION_CREDENTIALS_JSON`, or `ANTHROPIC_API_KEY` when a non-Gemini model
      is named. None of these belong in a repository or a dashboard screenshot.

---

## Order of work

1. TLS and the reverse proxy, because it is what the loopback bind is waiting on.
2. Document access control, because it is the one gap that leaks the data this system is
   built to hold.
3. Rate limiting on the remaining unauthenticated routes.
4. Encryption at rest.
5. Retention and export.
6. Persistence, only when concurrency demands it.

Take them in that order. Each is independently shippable and each closes a real hole.

---

## Definition of done

- [ ] No route serves document bytes without passing the central per-case check.
- [ ] Every unauthenticated route has a rate limit.
- [ ] TLS terminates in front of a still-loopback-bound app.
- [ ] Data at rest is encrypted, by a documented mechanism.
- [ ] A written retention and export answer exists.
- [ ] Secrets are supplied by the environment and are absent from the repository.

## Traps specific to this task

- **Do not add a second authorisation path.** `access.ts` is centrally enforced before
  handlers run, keyed on method and path because path-only derivation once
  misclassified `GET` and `DELETE` on write-shaped paths. Extend it; do not route around it.
- **Do not regress 404-instead-of-403.** It is deliberate: a 403 confirms a case exists.
- **Do not remove the loopback bind before TLS exists.** The bind is the current mitigation,
  not an oversight.
- **The audit chain is global.** Per-case deletion has to be thought about rather than
  implemented directly.
