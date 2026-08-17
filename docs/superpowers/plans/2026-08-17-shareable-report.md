# Shareable, Site-Native Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deliberation report read as part of Arbiter on screen while still printing as a light document, and let a convener publish it to a revocable tokenised URL reachable by a QR code printed on the page.

**Architecture:** The share token is an HMAC over `(caseId, version)`, so it is recoverable for re-rendering without any secret being stored, and revocation is a version bump that kills already-printed codes. The public page is a **second Vite entry** that does not import the authenticated app shell, so a visitor cannot be signed in by code that is not in their bundle. Screen and print share one DOM and one paginator; only colour differs, enforced by a test over `app.css`.

**Tech Stack:** TypeScript, Node `node:http`, React 18, Vite 5, Vitest, `@testing-library/react`, `qrcode-generator`.

**Spec:** `docs/superpowers/specs/2026-08-17-shareable-report-design.md`

## Global Constraints

- **Node crypto only.** Use `node:crypto` (`createHmac`, `timingSafeEqual`, `randomBytes`). Add no crypto dependency — `auth.ts` sets this precedent deliberately.
- **One new runtime dependency, total:** `qrcode-generator`. It must have zero transitive dependencies. Nothing else may be added.
- **`ARBITER_SHARE_SECRET` minimum length: 32 bytes.** Unset ⇒ publishing disabled (501). Set and shorter than 32 ⇒ process refuses to boot.
- **Redaction is server-side.** No email may appear anywhere in a public response body, not merely hidden in rendering.
- **The `@media print` block may set only:** `color`, `background`, `background-color`, `border-color`, `box-shadow`, `fill`. Never a metric property.
- **Persistence pattern:** in-memory `Map` behind a JSON file, as `AuthStore` and `InviteStore` do. No Postgres on this branch.
- **Comment style:** this codebase explains *why*, in prose, at decision points. Match it. Do not add narration to obvious code.
- **Run the full suite** (`npm test`) before every commit, not just the file you touched.
- **`PYTHON=.venv/bin/python`** must be set for document-upload tests to pass in this worktree.

---

### Task 1: Extract `basisOf` so the public bundle need not import screens

**Files:**
- Create: `apps/deliberation/src/basis.ts`
- Modify: `apps/deliberation/src/screens.tsx` (remove `basisOf`, import it instead)
- Modify: `apps/deliberation/src/report.tsx:7` (import from `./basis.js`)
- Test: `apps/deliberation/test/basis.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `basisOf(p: Position): "cited" | "external" | "unsupported"` from `apps/deliberation/src/basis.ts`.

Task 6 puts `report.tsx` into a bundle that must not contain `screens.tsx`. This is the one import standing in the way.

- [ ] **Step 1: Write the failing test**

Create `apps/deliberation/test/basis.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { basisOf } from "../src/basis.js";
import type { Position } from "../src/api.js";

const position = (over: Partial<Position> = {}): Position => ({
  participantId: "u-a", call: "advance", reasoning: "Because.",
  citedFindingIds: [], external: [], submittedAt: "2026-08-16T09:00:00.000Z", ...over,
});

describe("basisOf", () => {
  it("calls a position cited when it rests on a finding in the case", () => {
    expect(basisOf(position({ citedFindingIds: ["TUR:exposure-margin"] }))).toBe("cited");
  });

  it("calls a position external when it rests only on a claim from outside", () => {
    expect(basisOf(position({ external: [{ claim: "Class experience." }] }))).toBe("external");
  });

  it("calls a position unsupported when it rests on nothing at all", () => {
    expect(basisOf(position())).toBe("unsupported");
  });

  it("prefers cited when a position has both a finding and an outside claim", () => {
    expect(basisOf(position({
      citedFindingIds: ["TUR:reversibility"],
      external: [{ claim: "Class experience." }],
    }))).toBe("cited");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/deliberation/test/basis.test.ts`
Expected: FAIL — cannot resolve `../src/basis.js`.

- [ ] **Step 3: Create the module**

Read the existing `basisOf` at `apps/deliberation/src/screens.tsx:15` and move it verbatim into `apps/deliberation/src/basis.ts`:

```ts
import type { Position } from "./api.js";

/**
 * What a position actually rests on.
 *
 * ITS OWN MODULE, not part of `screens.tsx`, because the printable record needs it and
 * the public bundle must not contain the authenticated screens. This is a fact about a
 * position, not about any screen that draws one, so the split is along the seam that
 * was already there.
 *
 * Cited outranks external: a position that names a finding IS resting on the case's
 * evidence, whatever else its author also mentioned.
 */
export function basisOf(p: Position): "cited" | "external" | "unsupported" {
  if (p.citedFindingIds.length > 0) return "cited";
  if (p.external.length > 0) return "external";
  return "unsupported";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/deliberation/test/basis.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Rewire the two consumers**

In `apps/deliberation/src/screens.tsx`, delete the `basisOf` function and add to the imports:

```ts
import { basisOf } from "./basis.js";
```

Keep `screens.tsx` re-exporting nothing new. In `apps/deliberation/src/report.tsx`, change:

```ts
import { basisOf } from "./screens.js";
```

to:

```ts
import { basisOf } from "./basis.js";
```

- [ ] **Step 6: Verify nothing else imported it from screens**

Run: `grep -rn "basisOf" apps/deliberation/src apps/deliberation/test`
Expected: imports only from `./basis.js` / `../src/basis.js`; the only definition is in `basis.ts`.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `PYTHON=.venv/bin/python npm test && npm run typecheck`
Expected: all pass (1032 + 4 new).

- [ ] **Step 8: Commit**

```bash
git add apps/deliberation/src/basis.ts apps/deliberation/test/basis.test.ts apps/deliberation/src/screens.tsx apps/deliberation/src/report.tsx
git commit -m "Move basisOf out of screens, so the record can travel without them"
```

---

### Task 2: The share token — derive, verify, revoke

**Files:**
- Create: `services/api/share.ts`
- Test: `services/api/test/share.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ShareLink { caseId: string; version: number; createdBy: string; createdAt: string; revokedAt: string | null }`
  - `shareSecret(env: NodeJS.ProcessEnv): string | null` — null when unset; **throws** when set and under 32 bytes.
  - `deriveToken(secret: string, caseId: string, version: number): string`
  - `verifyToken(secret: string, link: ShareLink | null, token: string): boolean`
  - `class ShareStore` with `get(caseId): ShareLink | null`, `publish(caseId, userId, at): ShareLink`, `revoke(caseId, at): ShareLink | null`

- [ ] **Step 1: Write the failing test**

Create `services/api/test/share.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveToken, shareSecret, verifyToken, ShareStore, type ShareLink } from "../share.js";

const SECRET = "0123456789abcdef0123456789abcdef";

const link = (over: Partial<ShareLink> = {}): ShareLink => ({
  caseId: "c1", version: 1, createdBy: "u-own",
  createdAt: "2026-08-17T10:00:00.000Z", revokedAt: null, ...over,
});

describe("the share secret", () => {
  it("is absent rather than an error when nothing is configured", () => {
    expect(shareSecret({})).toBeNull();
  });

  it("refuses a secret too short to be unguessable, naming the variable", () => {
    expect(() => shareSecret({ ARBITER_SHARE_SECRET: "short" }))
      .toThrow(/ARBITER_SHARE_SECRET/);
  });

  it("accepts a secret at the floor", () => {
    expect(shareSecret({ ARBITER_SHARE_SECRET: SECRET })).toBe(SECRET);
  });
});

describe("deriving a token", () => {
  it("is stable, so the QR can be re-rendered without storing anything", () => {
    expect(deriveToken(SECRET, "c1", 1)).toBe(deriveToken(SECRET, "c1", 1));
  });

  it("differs per case, so one link cannot open another record", () => {
    expect(deriveToken(SECRET, "c1", 1)).not.toBe(deriveToken(SECRET, "c2", 1));
  });

  it("differs per version, which is what makes revocation reach printed paper", () => {
    expect(deriveToken(SECRET, "c1", 1)).not.toBe(deriveToken(SECRET, "c1", 2));
  });

  it("is URL-safe, because it travels in a path segment and a QR", () => {
    expect(deriveToken(SECRET, "c1", 1)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("verifying a token", () => {
  it("accepts the token derived for the link's current version", () => {
    expect(verifyToken(SECRET, link(), deriveToken(SECRET, "c1", 1))).toBe(true);
  });

  it("rejects a token from a previous version", () => {
    expect(verifyToken(SECRET, link({ version: 2 }), deriveToken(SECRET, "c1", 1))).toBe(false);
  });

  it("rejects every token when there is no link at all", () => {
    expect(verifyToken(SECRET, null, deriveToken(SECRET, "c1", 1))).toBe(false);
  });

  // revokedAt is checked BEFORE the token, so a revoked row rejects even its own token.
  it("rejects a revoked link holding its own live token", () => {
    const revoked = link({ revokedAt: "2026-08-17T11:00:00.000Z" });
    expect(verifyToken(SECRET, revoked, deriveToken(SECRET, "c1", 1))).toBe(false);
  });

  it("rejects a malformed token without throwing", () => {
    expect(verifyToken(SECRET, link(), "!!!!")).toBe(false);
    expect(verifyToken(SECRET, link(), "")).toBe(false);
  });
});

describe("the share store", () => {
  it("has no link for a case nobody published", () => {
    expect(new ShareStore().get("c1")).toBeNull();
  });

  it("publishes at version 1", () => {
    const s = new ShareStore();
    const l = s.publish("c1", "u-own", "2026-08-17T10:00:00.000Z");
    expect(l.version).toBe(1);
    expect(l.revokedAt).toBeNull();
    expect(l.createdBy).toBe("u-own");
  });

  it("returns the same link when publishing an already-published case, so the printed QR keeps working", () => {
    const s = new ShareStore();
    const first = s.publish("c1", "u-own", "2026-08-17T10:00:00.000Z");
    const again = s.publish("c1", "u-own", "2026-08-17T12:00:00.000Z");
    expect(again.version).toBe(first.version);
    expect(again.createdAt).toBe(first.createdAt);
  });

  it("revoking bumps the version and stamps the time", () => {
    const s = new ShareStore();
    s.publish("c1", "u-own", "2026-08-17T10:00:00.000Z");
    const revoked = s.revoke("c1", "2026-08-17T11:00:00.000Z");
    expect(revoked?.version).toBe(2);
    expect(revoked?.revokedAt).toBe("2026-08-17T11:00:00.000Z");
  });

  it("republishing after a revoke mints a different token, and the dead one stays dead", () => {
    const s = new ShareStore();
    s.publish("c1", "u-own", "2026-08-17T10:00:00.000Z");
    const dead = deriveToken(SECRET, "c1", 1);
    s.revoke("c1", "2026-08-17T11:00:00.000Z");
    const fresh = s.publish("c1", "u-own", "2026-08-17T12:00:00.000Z");

    expect(fresh.revokedAt).toBeNull();
    expect(fresh.version).toBe(2);
    expect(verifyToken(SECRET, fresh, dead)).toBe(false);
    expect(verifyToken(SECRET, fresh, deriveToken(SECRET, "c1", 2))).toBe(true);
  });

  it("revoking a case nobody published is not an error", () => {
    expect(new ShareStore().revoke("c1", "2026-08-17T11:00:00.000Z")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run services/api/test/share.test.ts`
Expected: FAIL — cannot resolve `../share.js`.

- [ ] **Step 3: Write the implementation**

Create `services/api/share.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Publishing a record to a URL a stranger can open.
 *
 * THE TOKEN IS DERIVED, NOT STORED, and that is the whole design. `auth.ts` keeps only
 * the digest of a session token, which is right for a session: nothing ever needs the
 * plaintext again. A share link is the opposite - a QR code printed onto a sheet has to
 * be re-rendered every time the convener opens the report, and a digest does not turn
 * back into a URL. The remaining option, storing the plaintext, puts working capability
 * URLs in a file.
 *
 * An HMAC over (caseId, version) is recoverable from a row that holds no secret
 * material at all, so a stolen store yields nothing without ARBITER_SHARE_SECRET.
 *
 * REVOCATION IS A VERSION BUMP, because that is the only kind of revocation that
 * reaches paper. Deleting a row would strand a printed code pointing at a URL that
 * might be re-minted identically later; changing the input to the HMAC cannot.
 */

/** The floor is 32 bytes because below it the token stops being unguessable while
 *  still LOOKING unguessable, which is the failure nothing downstream would reveal. */
const MIN_SECRET_BYTES = 32;

export interface ShareLink {
  caseId: string;
  /** Bumped on revoke, so a later publish mints a different token. */
  version: number;
  createdBy: string;
  createdAt: string;
  /** Non-null means there is no active link right now. Distinct from `version`:
   *  this says WHETHER a link is live, that says WHICH token it is. */
  revokedAt: string | null;
}

/**
 * The configured secret, or null.
 *
 * TWO FAILURES, HANDLED DIFFERENTLY ON PURPOSE. Unset is a deployment that has not
 * turned sharing on: publishing is refused and the rest of the product is untouched.
 * Set-but-weak is a misconfiguration that would silently produce guessable URLs, so it
 * throws and the process does not start.
 */
export function shareSecret(env: NodeJS.ProcessEnv): string | null {
  const raw = env["ARBITER_SHARE_SECRET"];
  if (raw === undefined || raw === "") return null;
  if (Buffer.byteLength(raw, "utf8") < MIN_SECRET_BYTES) {
    throw new Error(
      `ARBITER_SHARE_SECRET is ${String(Buffer.byteLength(raw, "utf8"))} bytes; it must be at least ${String(MIN_SECRET_BYTES)}. ` +
      "A short secret produces share URLs that look unguessable and are not.",
    );
  }
  return raw;
}

/** base64url, because this travels in a path segment and inside a QR code, and both
 *  are worse off for '+', '/' and '='. */
export function deriveToken(secret: string, caseId: string, version: number): string {
  return createHmac("sha256", secret)
    .update(`${caseId}:${String(version)}`)
    .digest("base64url");
}

/**
 * Constant-time, and revocation is checked first.
 *
 * The order matters: a revoked link must reject its OWN still-derivable token, so the
 * cheap boolean has to win before the comparison is reached.
 */
export function verifyToken(secret: string, link: ShareLink | null, token: string): boolean {
  if (link === null || link.revokedAt !== null) return false;
  const expected = Buffer.from(deriveToken(secret, link.caseId, link.version), "utf8");
  const given = Buffer.from(token, "utf8");
  // Compared only when the lengths match: timingSafeEqual throws on a length mismatch,
  // and a thrown exception is a louder oracle than the comparison it was protecting.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * Which cases are published. An in-memory map behind a JSON file, the same shape
 * `AuthStore` and `InviteStore` use on this branch.
 */
export class ShareStore {
  private links = new Map<string, ShareLink>();

  constructor(private readonly path: string | null = null) {
    if (path !== null && existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as { links: ShareLink[] };
      for (const l of raw.links) this.links.set(l.caseId, l);
    } else if (path !== null) {
      mkdirSync(dirname(path), { recursive: true });
    }
  }

  private persist(): void {
    if (this.path === null) return;
    writeFileSync(this.path, JSON.stringify({ links: [...this.links.values()] }, null, 2), "utf8");
  }

  get(caseId: string): ShareLink | null {
    return this.links.get(caseId) ?? null;
  }

  /**
   * Publish, or return the link that already exists.
   *
   * IDEMPOTENT ON A LIVE LINK, deliberately. Re-minting on every press would break a
   * QR somebody had already printed, and pressing "publish" twice is not a request to
   * invalidate the paper on a colleague's desk. Re-issuing is what revoke-then-publish
   * is for, and it is a separate, deliberate act.
   */
  publish(caseId: string, userId: string, at: string): ShareLink {
    const existing = this.links.get(caseId);
    if (existing !== undefined && existing.revokedAt === null) return existing;

    const link: ShareLink = {
      caseId,
      // Keeps climbing across a revoke, so the dead token can never be re-minted.
      version: existing === undefined ? 1 : existing.version,
      createdBy: userId,
      createdAt: at,
      revokedAt: null,
    };
    this.links.set(caseId, link);
    this.persist();
    return link;
  }

  revoke(caseId: string, at: string): ShareLink | null {
    const existing = this.links.get(caseId);
    if (existing === undefined) return null;
    const revoked: ShareLink = { ...existing, version: existing.version + 1, revokedAt: at };
    this.links.set(caseId, revoked);
    this.persist();
    return revoked;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run services/api/test/share.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `PYTHON=.venv/bin/python npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add services/api/share.ts services/api/test/share.test.ts
git commit -m "Derive the share token, so revoking it reaches the printed page"
```

---

### Task 3: `canShare` — the convener publishes, nobody else

**Files:**
- Modify: `services/api/access.ts:20-25` (`CaseAction`), and add `canShare`
- Modify: `services/api/access.ts:57` (`can`), `services/api/access.ts:83` (`denial`)
- Test: `services/api/test/access.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `canShare(c: DeliberationCase, userId: string): boolean`; `"share"` is a member of `CaseAction`.

- [ ] **Step 1: Write the failing test**

Append to `services/api/test/access.test.ts` (match the existing fixture helpers in that file — read it first and reuse its case builder rather than inventing one):

```ts
describe("publishing a record", () => {
  it("is the convener's to do, because publishing is not reading", () => {
    expect(canShare(kase(), "u-own")).toBe(true);
  });

  it("is refused to a participant, who may read the record but not publish it", () => {
    expect(canShare(kase(), "u-a")).toBe(false);
  });

  it("is refused to an account with nothing to do with the case", () => {
    expect(canShare(kase(), "u-outsider")).toBe(false);
  });

  it("is routed the same way through `can`", () => {
    expect(can(kase(), "u-own", "share")).toBe(true);
    expect(can(kase(), "u-a", "share")).toBe(false);
  });

  it("denies a participant with the owner-only wording, never naming the case", () => {
    const d = denial(kase(), "u-a", "share");
    expect(d?.detail).toContain("Only the decision owner");
    expect(d?.detail).not.toContain("TAK-994");
  });
});
```

Adjust `kase()`, `"u-own"`, `"u-a"` and the compound label to the names the existing file already uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run services/api/test/access.test.ts`
Expected: FAIL — `canShare` is not exported.

- [ ] **Step 3: Implement**

In `services/api/access.ts`, add `"share"` to the union:

```ts
export type CaseAction =
  | "read"
  | "submit"
  | "reveal"
  | "adjudicate"
  | "sign"
  | "share";
```

Add the predicate beside `canRead`:

```ts
/**
 * Publishing the record to a URL anybody holding it can open.
 *
 * THE CONVENER'S, not every reader's. Reading a case and publishing it are different
 * acts: §6.7 puts one named individual behind the decision, and letting any participant
 * disclose a record that person never agreed to publish would move that accountability
 * without anybody deciding to. Deny-by-default is kept - this returns false unless it
 * finds the one reason to return true.
 */
export function canShare(c: DeliberationCase, userId: string): boolean {
  return isOwner(c, userId);
}
```

Add the arm to `can`:

```ts
    case "share":
      return canShare(c, userId);
```

`denial` needs no change: `"share"` is not `"read"` or `"submit"`, so it already falls through to the owner-only wording, which reads correctly as "Only the decision owner can share this case."

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run services/api/test/access.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `PYTHON=.venv/bin/python npm test && npm run typecheck`
Expected: pass. If a `switch` exhaustiveness error appears anywhere over `CaseAction`, fix that call site — it is the type system finding a real gap.

- [ ] **Step 6: Commit**

```bash
git add services/api/access.ts services/api/test/access.test.ts
git commit -m "Let the convener publish a record, and nobody else"
```

---

### Task 4: Strip emails on the public path

**Files:**
- Modify: `services/api/verdict-report.ts` (`buildCaseReport`)
- Test: `services/api/test/verdict-report.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildCaseReport` gains a required `audience: "case" | "public"` field in its argument object. All existing callers must pass `"case"`.

- [ ] **Step 1: Write the failing test**

Append to `services/api/test/verdict-report.test.ts`:

```ts
describe("the public audience", () => {
  it("carries no email address anywhere in the document", () => {
    const r = buildCaseReport({ ...args(), audience: "public" });
    // Over the serialised body, not field by field: a field added later that carries an
    // address would slip past a per-field assertion, and the response is what leaks.
    expect(JSON.stringify(r)).not.toContain("@");
  });

  it("keeps every name and seat, because a position without an author is a rumour", () => {
    const r = buildCaseReport({ ...args(), audience: "public" });
    expect(r.panel.map((p) => p.displayName)).toContain("Ann");
    expect(r.panel.every((p) => p.email === "")).toBe(true);
    expect(r.owner.displayName).not.toBe("");
    expect(r.generatedBy.displayName).not.toBe("");
  });

  it("keeps every position in full, since the dissent is the record", () => {
    const pub = buildCaseReport({ ...args(), audience: "public" });
    const priv = buildCaseReport({ ...args(), audience: "case" });
    expect(pub.positions).toEqual(priv.positions);
    expect(pub.adjudication).toEqual(priv.adjudication);
    expect(pub.inventory).toEqual(priv.inventory);
  });

  it("leaves the case audience holding the addresses", () => {
    const r = buildCaseReport({ ...args(), audience: "case" });
    expect(r.panel.some((p) => p.email !== "")).toBe(true);
  });
});
```

Read the existing file first and reuse its fixture builder. If it has no `args()` helper, extract one from the existing tests' shared setup so this block and the existing blocks share it. Ensure the fixture's `person()` returns addresses containing `@` and a panellist named `Ann`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run services/api/test/verdict-report.test.ts`
Expected: FAIL — `audience` is not a known property / emails still present.

- [ ] **Step 3: Implement**

In `services/api/verdict-report.ts`, add to the `buildCaseReport` argument type:

```ts
  /**
   * Who the assembled record is for.
   *
   * REDACTION HAPPENS HERE, not in the rendering. A field absent from the page but
   * present in the response body is one devtools tab from being disclosed, and the
   * public path answers to anybody holding a URL. The address is the only field cut:
   * names and seats stay, because attribution IS the record and a position without an
   * author is a rumour.
   */
  audience: "case" | "public";
```

In the `person` helper inside the function:

```ts
  const person = (id: string): ReportPerson => {
    const p = args.person(id);
    return {
      id,
      displayName: p?.displayName ?? id,
      email: args.audience === "public" ? "" : (p?.email ?? ""),
      seat: kase.seats[id] ?? null,
    };
  };
```

- [ ] **Step 4: Update the existing caller**

In `services/api/server.ts`, the `handleReport` call to `buildCaseReport` gains `audience: "case",`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run services/api/test/verdict-report.test.ts && npm run typecheck`
Expected: PASS; typecheck clean (it will have caught any caller that forgot `audience`).

- [ ] **Step 6: Run the full suite**

Run: `PYTHON=.venv/bin/python npm test`
Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add services/api/verdict-report.ts services/api/test/verdict-report.test.ts services/api/server.ts
git commit -m "Cut the addresses where the record is assembled, not where it is drawn"
```

---

### Task 5: The three routes

**Files:**
- Modify: `services/api/server.ts` — `ServerDeps`, `buildDeps`, the case sub-route switch, a new unauthenticated branch, the boot banner
- Modify: `.env.example`
- Test: `services/api/test/server.test.ts`

**Interfaces:**
- Consumes: `ShareStore`, `shareSecret`, `deriveToken`, `verifyToken`, `ShareLink` (Task 2); `canShare` via `can(c, u, "share")` (Task 3); `audience` (Task 4).
- Produces:
  - `POST /api/cases/:id/share` → `201 { url, token, createdAt }`, `403`, `501`
  - `DELETE /api/cases/:id/share` → `200 { revoked: true }`, `403`
  - `GET /api/cases/:id/share` → `200 { published: boolean, url: string | null }` (convener only; the report page needs to know whether to draw the QR)
  - `GET /api/public/report/:caseId/:token` → `200 CaseReport`, `404`, `409`
  - `ServerDeps.shares: ShareStore`, `ServerDeps.shareSecret: string | null`

- [ ] **Step 1: Write the failing test**

Append to `services/api/test/server.test.ts`, inside the describe block that already builds `c1` as an adjudicated, signed case:

```ts
describe("publishing a record", () => {
  it("refuses a participant, who may read it but not publish it", async () => {
    const r = await call("POST", "/api/cases/c1/share", "bea", {});
    expect(r.status).toBe(403);
  });

  it("publishes for the convener and hands back a URL carrying the token", async () => {
    const r = await call("POST", "/api/cases/c1/share", "owner", {});
    expect(r.status).toBe(201);
    expect(r.body.url).toContain("/r/c1/");
    expect(r.body.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns the same URL on a second press, so a printed QR keeps working", async () => {
    const first = await call("POST", "/api/cases/c1/share", "owner", {});
    const again = await call("POST", "/api/cases/c1/share", "owner", {});
    expect(again.body.url).toBe(first.body.url);
  });

  it("serves the record to a stranger holding the token", async () => {
    const pub = await call("POST", "/api/cases/c1/share", "owner", {});
    const r = await fetchPublic(`/api/public/report/c1/${pub.body.token as string}`);
    expect(r.status).toBe(200);
    expect(r.body.compoundLabel).toBe("TAK-994");
    expect(r.body.positions.length).toBeGreaterThan(0);
  });

  it("puts no email address anywhere in the public body", async () => {
    const pub = await call("POST", "/api/cases/c1/share", "owner", {});
    const r = await fetchPublic(`/api/public/report/c1/${pub.body.token as string}`);
    expect(JSON.stringify(r.body)).not.toContain("@");
  });

  it("refuses a token that does not match", async () => {
    await call("POST", "/api/cases/c1/share", "owner", {});
    const r = await fetchPublic("/api/public/report/c1/not-the-token");
    expect(r.status).toBe(404);
  });

  it("refuses every token once the link is revoked, which is what reaches printed paper", async () => {
    const pub = await call("POST", "/api/cases/c1/share", "owner", {});
    const token = pub.body.token as string;
    expect((await fetchPublic(`/api/public/report/c1/${token}`)).status).toBe(200);

    const gone = await call("DELETE", "/api/cases/c1/share", "owner");
    expect(gone.status).toBe(200);
    expect((await fetchPublic(`/api/public/report/c1/${token}`)).status).toBe(404);
  });

  it("mints a different token when republished, leaving the revoked one dead", async () => {
    const first = await call("POST", "/api/cases/c1/share", "owner", {});
    await call("DELETE", "/api/cases/c1/share", "owner");
    const second = await call("POST", "/api/cases/c1/share", "owner", {});

    expect(second.body.token).not.toBe(first.body.token);
    expect((await fetchPublic(`/api/public/report/c1/${first.body.token as string}`)).status).toBe(404);
    expect((await fetchPublic(`/api/public/report/c1/${second.body.token as string}`)).status).toBe(200);
  });

  it("refuses a case nobody published", async () => {
    const r = await fetchPublic("/api/public/report/c1/anything");
    expect(r.status).toBe(404);
  });

  it("tells the convener whether a link exists, so the page knows to draw the QR", async () => {
    const before = await call("GET", "/api/cases/c1/share", "owner");
    expect(before.body.published).toBe(false);
    await call("POST", "/api/cases/c1/share", "owner", {});
    const after = await call("GET", "/api/cases/c1/share", "owner");
    expect(after.body.published).toBe(true);
    expect(after.body.url).toContain("/r/c1/");
  });
});
```

Add a `fetchPublic` helper beside the existing `call` helper — same base URL, **no `authorization` header**, since the whole point is that it works without one:

```ts
const fetchPublic = async (path: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await res.text();
  return { status: res.status, body: text === "" ? null : JSON.parse(text) };
};
```

Match `port` to whatever the existing suite already uses for its server.

The suite's server must be built with a secret. Where the test constructs deps, pass `ARBITER_SHARE_SECRET` — read how the existing file builds `makeHandler(deps)` and give `deps.shareSecret` the 32-byte constant, `deps.shares` a fresh `new ShareStore()` (no path, so it stays in memory).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run services/api/test/server.test.ts`
Expected: FAIL — 404s on the new routes.

- [ ] **Step 3: Add the dependencies**

In `services/api/server.ts`, import:

```ts
import { deriveToken, ShareStore, shareSecret, verifyToken } from "./share.js";
```

Add to `ServerDeps`:

```ts
  shares: ShareStore;
  /** Null when ARBITER_SHARE_SECRET is unset: publishing is off, everything else works. */
  shareSecret: string | null;
```

In `buildDeps`, beside `invites`:

```ts
    shares: new ShareStore(`${logPath}.shares.json`),
    shareSecret: shareSecret(process.env),
```

`shareSecret` throws on a short secret, and `buildDeps` runs at boot, so a weak secret stops the process exactly as the spec requires — no extra guard needed.

- [ ] **Step 4: Add the authenticated share routes**

In the case sub-route switch (beside `"report"`), add:

```ts
          case "share": {
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

            /* REFUSED BEFORE ANYTHING IS WRITTEN when the deployment has no secret.
               501, not 500: the server is working and this capability is switched off,
               and the message names the variable rather than leaving an operator to
               guess which of the environment's many settings is missing. */
            if (deps.shareSecret === null) {
              return json(res, 501, {
                error: "sharing_disabled",
                detail: "ARBITER_SHARE_SECRET is not set, so this deployment cannot publish records.",
              });
            }

            if (method === "POST") {
              const link = deps.shares.publish(kase.caseId, user.id, new Date(now()).toISOString());
              const token = deriveToken(deps.shareSecret, kase.caseId, link.version);
              return json(res, 201, {
                url: shareUrl(req, kase.caseId, token), token, createdAt: link.createdAt,
              });
            }

            if (method === "DELETE") {
              deps.shares.revoke(kase.caseId, new Date(now()).toISOString());
              return json(res, 200, { revoked: true });
            }

            return json(res, 405, { error: "method_not_allowed" });
          }
```

Add the URL helper near the other module-level helpers:

```ts
/**
 * Where a published record lives.
 *
 * Built from the request's own Host so a link works from wherever the reader reached
 * the product - localhost in development, the deployed host in production - rather than
 * from a base URL somebody has to remember to configure per environment and will not.
 */
function shareUrl(req: IncomingMessage, caseId: string, token: string): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  const host = req.headers.host ?? "localhost";
  return `${proto}://${host}/r/${encodeURIComponent(caseId)}/${token}`;
}
```

- [ ] **Step 5: Add the unauthenticated public route**

This must sit with the auth routes — **before** the bearer-token resolution at `services/api/server.ts:499`, in the branch the file's comment calls "the only unauthenticated surface". Extend that comment to name this second one.

```ts
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
      if (parts[0] === "public" && parts[1] === "report" && method === "GET") {
        const caseId = parts[2] === undefined ? "" : decodeURIComponent(parts[2]);
        const token = parts[3] ?? "";
        if (deps.shareSecret === null) return json(res, 404, { error: "not_found" });

        const link = deps.shares.get(caseId);
        if (!verifyToken(deps.shareSecret, link, token)) return json(res, 404, { error: "not_found" });

        const kase = deps.service.caseOf(caseId);
        if (kase === null) return json(res, 404, { error: "not_found" });

        return handleReport(deps, res, kase, { id: link!.createdBy } as PublicUser,
          new Date(now()).toISOString(), "public");
      }
```

Read how `handleReport` currently obtains the case (it is handed a `DeliberationCase`) and use the same accessor the case routes use; if `deps.service` exposes no `caseOf`, use whatever the authenticated path already calls and keep the name consistent.

- [ ] **Step 6: Teach `handleReport` about audience**

Give it a fifth parameter, defaulted so no existing call changes shape beyond Task 4's:

```ts
function handleReport(
  deps: ServerDeps, res: ServerResponse, kase: DeliberationCase,
  user: PublicUser, at: string, audience: "case" | "public" = "case",
): void {
```

and pass `audience` through to `buildCaseReport`. The `generatedBy` on a public render resolves to the convener who published it — the document says who put it into the world, which is the honest answer for a page nobody signed in to fetch.

- [ ] **Step 7: Announce sharing in the boot banner**

Beside the existing `Record:` and `Docs:` lines:

```ts
  console.log(`Share:  ${deps.shareSecret === null
    ? "off - ARBITER_SHARE_SECRET is unset, so records cannot be published"
    : "on - records can be published to a tokenised URL"}`);
```

Configuration that decides whether a capability exists should be visible at boot, the way the storage lines already are.

- [ ] **Step 8: Document the variable**

In `.env.example`, near the other server settings:

```bash
# Publishing a record to a URL anybody holding it can open, reachable by the QR code
# printed on the document. Unset means records cannot be published and the control does
# not appear; the rest of the product is unaffected.
#
# At least 32 bytes. Generate one with:  openssl rand -base64 48
#
# ROTATING THIS INVALIDATES EVERY PUBLISHED LINK AT ONCE, including QR codes already
# printed onto paper. That is the point of it - it is what makes a token unforgeable -
# but it is not reversible, so rotate deliberately.
# ARBITER_SHARE_SECRET=
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run services/api/test/server.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the full suite**

Run: `PYTHON=.venv/bin/python npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add services/api/server.ts services/api/test/server.test.ts .env.example
git commit -m "Publish a record to a URL, and let revoking it reach the paper"
```

---

### Task 6: The QR component

**Files:**
- Create: `apps/deliberation/src/qr.tsx`
- Test: `apps/deliberation/test/qr.test.tsx`
- Modify: `package.json` (add `qrcode-generator`)

**Interfaces:**
- Consumes: nothing.
- Produces: `<QrCode value={string} size={number} />` rendering inline `<svg>`.

- [ ] **Step 1: Add the dependency**

Run: `npm install qrcode-generator`

Then verify it brought nothing with it:

Run: `npm ls qrcode-generator`
Expected: a single entry with no children. If it has transitive dependencies, **stop** and report — the Global Constraints forbid it.

- [ ] **Step 2: Write the failing test**

Create `apps/deliberation/test/qr.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { QrCode } from "../src/qr.js";

describe("the QR code", () => {
  it("draws as SVG, so it stays sharp at print resolution", () => {
    const { container } = render(<QrCode value="https://example.test/r/c1/tok" size={120} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("scales by viewBox rather than by redrawing, so one encoding serves every size", () => {
    const { container } = render(<QrCode value="https://example.test/r/c1/tok" size={120} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toMatch(/^0 0 \d+ \d+$/);
    expect(svg.getAttribute("width")).toBe("120");
  });

  it("encodes a longer URL without throwing, since case ids are not short", () => {
    const long = `https://arbiter.example/r/${"turalio-pexidartinib--u_1e1a1bc16a48c9d440"}/${"x".repeat(43)}`;
    const { container } = render(<QrCode value={long} size={120} />);
    expect(container.querySelectorAll("rect").length).toBeGreaterThan(1);
  });

  it("carries the URL as its accessible name, so it is not a blank image to a screen reader", () => {
    const { container } = render(<QrCode value="https://example.test/r/c1/tok" size={120} />);
    expect(container.querySelector("svg")?.getAttribute("role")).toBe("img");
    expect(container.querySelector("title")?.textContent).toContain("example.test");
  });

  it("changes its drawing when the value changes", () => {
    const a = render(<QrCode value="https://example.test/a" size={120} />).container.innerHTML;
    const b = render(<QrCode value="https://example.test/b" size={120} />).container.innerHTML;
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run apps/deliberation/test/qr.test.tsx`
Expected: FAIL — cannot resolve `../src/qr.js`.

- [ ] **Step 4: Implement**

Create `apps/deliberation/src/qr.tsx`:

```tsx
import { useMemo, type ReactElement } from "react";
import qrcode from "qrcode-generator";

/**
 * A QR code, as vectors.
 *
 * SVG AND NOT CANVAS, because this is printed. A canvas is a bitmap at one resolution
 * and a printer works at another; a code that scans on screen and blurs on paper is a
 * code that fails in the only place it was added for.
 *
 * ERROR CORRECTION AT "M". The code is printed onto a page that will be folded, copied
 * and marked up, so the lowest level is wrong; "H" would survive more damage and makes
 * the code denser, which costs more than it buys on a URL this long.
 *
 * ONE DEPENDENCY, chosen for having none of its own - `router.ts` objects to transitive
 * trees rather than to libraries, and a QR encoder is Reed-Solomon and mask evaluation
 * rather than the thirty lines that argument permits us to write ourselves. A wrong
 * implementation here also fails loudly: the code simply does not scan.
 */
export function QrCode({ value, size }: { value: string; size: number }): ReactElement {
  const { modules, count } = useMemo(() => {
    // Type 0 lets the library pick the smallest version the data fits in.
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const dark: { x: number; y: number }[] = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) if (qr.isDark(y, x)) dark.push({ x, y });
    }
    return { modules: dark, count: n };
  }, [value]);

  return (
    <svg
      className="rep-qr"
      role="img"
      width={size}
      height={size}
      /* The viewBox is in MODULES, so the same drawing serves the 120px preview and a
         600dpi print without re-encoding and without rounding modules to whole pixels. */
      viewBox={`0 0 ${String(count)} ${String(count)}`}
      shapeRendering="crispEdges"
    >
      <title>{value}</title>
      {/* The quiet zone is the white background; the spec requires four modules of it,
          which the printed block provides as padding around this element. */}
      <rect width={count} height={count} fill="#fff" />
      {modules.map((m) => (
        <rect key={`${String(m.x)}-${String(m.y)}`} x={m.x} y={m.y} width={1} height={1} fill="#000" />
      ))}
    </svg>
  );
}
```

If `qrcode-generator`'s default export is not callable under this repo's `moduleResolution`, import it as `import qrcode from "qrcode-generator";` and, if TypeScript objects, add a `declare module` shim in `apps/deliberation/src/qr.tsx` rather than changing the tsconfig.

**The QR is always black-on-white, in both themes.** Scanners expect dark-on-light, and inverting it is a code that many readers refuse. It is the one element of the sheet that does not follow the palette, and Task 7's print-invariant test must not be written in a way that flags it.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run apps/deliberation/test/qr.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the full suite**

Run: `PYTHON=.venv/bin/python npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/deliberation/src/qr.tsx apps/deliberation/test/qr.test.tsx package.json package-lock.json
git commit -m "Draw a QR code as vectors, because it is going onto paper"
```

---

### Task 7: The palette — dark on screen, light on paper

**Files:**
- Modify: `apps/deliberation/src/app.css` (the `.report-doc` block and the `@media print` block)
- Modify: `apps/deliberation/src/report.tsx` (the file's opening doc comment)
- Test: `apps/deliberation/test/print-invariant.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: no code interface; a CSS invariant later tasks must not break.

- [ ] **Step 1: Write the failing test**

Create `apps/deliberation/test/print-invariant.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The preview and the print must break pages in the same places.
 *
 * They share one DOM and one paginator, so the only way they can disagree is if the
 * print stylesheet changes a metric - a size, a spacing, a width - because those are
 * what the measurement pass reads. Colour cannot move a page break. This test is the
 * difference between that being true and it merely being intended.
 */
const COLOUR_ONLY = new Set([
  "color", "background", "background-color", "background-image",
  "border-color", "box-shadow", "fill", "stroke", "opacity",
  "-webkit-print-color-adjust", "print-color-adjust", "filter",
]);

/** Rules that exist to REMOVE things from the printed page rather than to restyle the
 *  document: hiding the app's chrome is the whole job of the print block, and `display`
 *  on those is not a metric of the sheet. */
const STRUCTURAL = new Set(["display", "break-before", "break-after", "break-inside", "margin-top"]);
const STRUCTURAL_SELECTORS = /\.no-print|\.rep-page|\.rep-page-foot|\.rep-section|\.rep-position|\.rep-decision|\.rep-stub|\.rep-meta|tr/;

describe("the print stylesheet", () => {
  const css = readFileSync("apps/deliberation/src/app.css", "utf8");

  const printBlock = (): string => {
    const start = css.indexOf("@media print");
    expect(start, "app.css must contain an @media print block").toBeGreaterThan(-1);
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}") { depth--; if (depth === 0) return css.slice(start, i + 1); }
    }
    throw new Error("unbalanced @media print block");
  };

  it("changes no metric on the document's own elements", () => {
    const block = printBlock();
    const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].slice(1);

    const offenders: string[] = [];
    for (const [, selector, body] of rules) {
      if (!selector.includes(".rep-")) continue;
      for (const decl of body.split(";")) {
        const prop = decl.split(":")[0]?.trim();
        if (prop === undefined || prop === "") continue;
        if (COLOUR_ONLY.has(prop)) continue;
        if (STRUCTURAL.has(prop) && STRUCTURAL_SELECTORS.test(selector)) continue;
        offenders.push(`${selector.trim()} { ${prop} }`);
      }
    }

    expect(offenders, "the print block may change colour, not metrics - these would move a page break").toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/deliberation/test/print-invariant.test.ts`
Expected: FAIL — the current print block sets metrics on `.rep-*`, or the assertions do not yet match the file. Read the failures and confirm each offender is genuinely a metric before changing anything: if the existing print block legitimately needs one, widen `STRUCTURAL` **and say why in a comment**, rather than deleting the check.

- [ ] **Step 3: Move the document's colours onto tokens**

In `apps/deliberation/src/app.css`, at the top of the printable-record section, replace the hard-coded light values on `.report-doc` and its `.rep-*` descendants with custom properties, defined dark:

```css
/* ---- the printable record ------------------------------------------------ */

/* THE SAME DOCUMENT IN TWO PALETTES.
   On screen this belongs to the product, so it is dark like everything else - a light
   sheet glowing in a dark app reads as a foreign object, and the reader is still IN
   Arbiter while they check it. On paper it is a document: paper is white, and a
   near-black page with knocked-out type is a photocopier's worst case and a toner bill.

   ONLY THESE TOKENS CHANGE BETWEEN THE TWO. Not one size, spacing or width - those feed
   the measurement pass in `Paginate`, and a print stylesheet that moved one would make
   the preview lie about where the pages break, which is the failure the paginator was
   written to prevent. apps/deliberation/test/print-invariant.test.ts enforces it. */
.report-doc {
  --rep-paper: var(--surface);
  --rep-ink: var(--fg);
  --rep-ink-soft: var(--muted);
  --rep-rule: var(--line);
  --rep-panel: var(--surface-2);
}
```

Then rewrite every `.rep-*` colour declaration to use those tokens. Read the current values before replacing them and map light→token so the *printed* result is unchanged. Use the product's existing variable names as they appear elsewhere in this file — do not invent new global ones.

- [ ] **Step 4: Re-light the tokens for print**

Inside the existing `@media print` block:

```css
  /* The document goes back to being paper. Tokens only - see the note above. */
  .report-doc {
    --rep-paper: #fff;
    --rep-ink: #111;
    --rep-ink-soft: #555;
    --rep-rule: #ccc;
    --rep-panel: #f4f4f4;
  }

  /* Backgrounds are dropped by default in print; the sheet's panels and rules carry
     meaning, so they are asked for explicitly. */
  .report-doc, .report-doc * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run apps/deliberation/test/print-invariant.test.ts`
Expected: PASS.

- [ ] **Step 6: Rewrite the now-wrong doc comment**

`apps/deliberation/src/report.tsx` opens with a paragraph arguing the sheet is light on purpose. It is no longer true. Replace that paragraph with:

```
 * LIGHT ON PAPER, DARK ON SCREEN, one document either way. The sheet used to be light
 * in both places, on the argument that it exists to be printed - which is right about
 * paper and wrong about the screen, where a white page floating in a dark product reads
 * as something that already left the building. The reader checking it has not left yet.
 *
 * The two differ by COLOUR AND NOTHING ELSE. Same blocks, same paginator, same breaks,
 * so "what you scroll is what comes out" survives the change - see the token note in
 * app.css, and the test that keeps it honest.
```

- [ ] **Step 7: Run the full suite**

Run: `PYTHON=.venv/bin/python npm test && npm run typecheck && npm run lint && npm run deliberate:build`
Expected: all pass.

- [ ] **Step 8: Look at it**

Start the servers (`PORT=8790 ARBITER_GEMINI_HOST=developer PYTHON=.venv/bin/python npm run api` and `API_PORT=8790 npm run dev -w @arbiter/deliberation -- --host 127.0.0.1 --port 5282 --strictPort --base /`), open a signed case's report, and confirm: the sheet is dark and matches the product, the pager still says the same number of sheets as before this task, and Chrome's print preview shows a white document. **If the sheet count changed, a metric leaked — go back to Step 4.**

- [ ] **Step 9: Commit**

```bash
git add apps/deliberation/src/app.css apps/deliberation/src/report.tsx apps/deliberation/test/print-invariant.test.ts
git commit -m "Put the record in the product's palette, and give paper back its own"
```

---

### Task 8: The share control and the printed QR block

**Files:**
- Modify: `apps/deliberation/src/api.ts` (three client calls)
- Modify: `apps/deliberation/src/report.tsx` (the share control, the QR block)
- Modify: `apps/deliberation/src/App.tsx` (fetch share state on the report route)
- Modify: `apps/deliberation/src/app.css` (`.rep-qr`, `.rep-share`)
- Test: `apps/deliberation/test/report.test.tsx`

**Interfaces:**
- Consumes: `QrCode` (Task 6); the three routes (Task 5).
- Produces:
  - `api.shareState(token, caseId): Promise<{ published: boolean; url: string | null }>`
  - `api.publish(token, caseId): Promise<{ url: string; token: string; createdAt: string }>`
  - `api.revoke(token, caseId): Promise<{ revoked: boolean }>`
  - `ReportPage` gains `share?: { url: string | null; onPublish: () => void; onRevoke: () => void } | undefined` — **absent on the public page**, which is what removes the controls there.

- [ ] **Step 1: Write the failing test**

Append to `apps/deliberation/test/report.test.tsx` (reuse the file's existing `report` fixture builder):

```tsx
describe("publishing from the report", () => {
  it("prints no QR and no URL when the record was never published", () => {
    const { container } = render(
      <ReportPage report={reportFixture()} share={{ url: null, onPublish: () => {}, onRevoke: () => {} }} />,
    );
    expect(container.querySelector(".rep-qr")).toBeNull();
    // A printed link that never worked is worse than no link at all.
    expect(container.textContent).not.toContain("/r/");
  });

  it("prints the QR and the URL beside it once published", () => {
    const { container } = render(
      <ReportPage report={reportFixture()}
        share={{ url: "https://arbiter.test/r/c1/tok", onPublish: () => {}, onRevoke: () => {} }} />,
    );
    expect(container.querySelector(".rep-qr")).not.toBeNull();
    // Readable beside the code, for anyone who cannot scan it.
    expect(container.textContent).toContain("https://arbiter.test/r/c1/tok");
  });

  it("keeps the QR whole, so the paginator can never split it across a sheet", () => {
    const { container } = render(
      <ReportPage report={reportFixture()}
        share={{ url: "https://arbiter.test/r/c1/tok", onPublish: () => {}, onRevoke: () => {} }} />,
    );
    const qr = container.querySelector(".rep-qr")!;
    expect(qr.closest(".rep-block")).not.toBeNull();
  });

  it("keeps the controls off the paper", () => {
    const { container } = render(
      <ReportPage report={reportFixture()} share={{ url: null, onPublish: () => {}, onRevoke: () => {} }} />,
    );
    expect(container.querySelector(".rep-share")?.classList.contains("no-print")).toBe(true);
  });

  it("shows no controls at all with no share prop, which is how the public page renders", () => {
    const { container } = render(<ReportPage report={reportFixture()} />);
    expect(container.querySelector(".rep-share")).toBeNull();
  });

  it("still prints the QR on the public page, where there is a URL but no controls", () => {
    const { container } = render(
      <ReportPage report={reportFixture()} publishedUrl="https://arbiter.test/r/c1/tok" />,
    );
    expect(container.querySelector(".rep-qr")).not.toBeNull();
    expect(container.querySelector(".rep-share")).toBeNull();
  });

  it("says plainly that revoking cannot reach a page already printed", () => {
    const { container } = render(
      <ReportPage report={reportFixture()}
        share={{ url: "https://arbiter.test/r/c1/tok", onPublish: () => {}, onRevoke: () => {} }} />,
    );
    expect(container.textContent).toMatch(/already printed|already saved/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/deliberation/test/report.test.tsx`
Expected: FAIL — `share` and `publishedUrl` are not props of `ReportPage`.

- [ ] **Step 3: Add the client calls**

In `apps/deliberation/src/api.ts`, beside the report call:

```ts
  shareState: (token: string, caseId: string) =>
    call<{ published: boolean; url: string | null }>("GET", `/api/cases/${caseId}/share`, token),

  publish: (token: string, caseId: string) =>
    call<{ url: string; token: string; createdAt: string }>("POST", `/api/cases/${caseId}/share`, token, {}),

  revoke: (token: string, caseId: string) =>
    call<{ revoked: boolean }>("DELETE", `/api/cases/${caseId}/share`, token),
```

- [ ] **Step 4: Add the props and the QR block to `ReportPage`**

`ReportPage` gains:

```tsx
  /** The convener's controls. Absent on the public page - which is what removes them
   *  there, rather than a flag the public entry has to remember to pass. */
  share?: { url: string | null; onPublish: () => void; onRevoke: () => void };
  /** The published URL when there are no controls to go with it: the public page draws
   *  the same QR the convener printed, so a scanned page and a shared link agree. */
  publishedUrl?: string;
```

The effective URL is `share?.url ?? publishedUrl ?? null`.

In `documentBlocks`, when that URL is non-null, append **one** block onto the **first** sheet, immediately after the decision block, so paper on a desk leads back to the record without anybody turning a page:

```tsx
  if (url !== null) {
    blocks.push(block("qr", (
      <div className="rep-qr-block">
        <QrCode value={url} size={132} />
        <div>
          <div className="rep-label">The live record</div>
          <p className="rep-tiny">
            This document is a snapshot. Scan for the record as it stands now, including
            anything signed after this was printed.
          </p>
          <p className="rep-mono rep-tiny">{url}</p>
        </div>
      </div>
    )));
  }
```

Because it is a `Block`, the paginator treats it as indivisible for free — no extra rule.

The control, outside the sheet and marked `.no-print`:

```tsx
{share !== undefined && (
  <section className="rep-share no-print">
    {share.url === null
      ? <>
          <p>Publish this record to a link anyone can open, and print a QR code for it onto the document.</p>
          <button className="primary" onClick={share.onPublish}>Publish this record</button>
        </>
      : <>
          <p className="rep-mono">{share.url}</p>
          <p className="small muted">
            Anyone holding this link can read the record, without an account. Revoking it
            stops the link - it cannot reach a copy already printed or saved.
          </p>
          <button className="ghost" onClick={share.onRevoke}>Revoke this link</button>
        </>}
  </section>
)}
```

- [ ] **Step 5: Wire it in `App.tsx`**

Add `const [share, setShare] = useState<{ published: boolean; url: string | null } | null>(null);`

Fetch it when the report route opens, beside the existing report fetch — **only for the owner**, since the route 403s for anybody else and a failed request would show a console error on every participant's report:

```tsx
  useEffect(() => {
    if (token === null || route.name !== "report" || caseId === null || !isOwner) return;
    void (async () => {
      try { setShare(await api.shareState(token, caseId)); } catch { setShare(null); }
    })();
  }, [token, route, caseId, isOwner]);
```

Pass to `ReportPage`:

```tsx
{...(isOwner && share !== null ? {
  share: {
    url: share.url,
    onPublish: () => act(async () => { const r = await api.publish(token, caseId); setShare({ published: true, url: r.url }); }),
    onRevoke: () => act(async () => { await api.revoke(token, caseId); setShare({ published: false, url: null }); }),
  },
} : {})}
{...(!isOwner && share?.url != null ? { publishedUrl: share.url } : {})}
```

Note `isOwner` must be in scope at the report route — it is computed above the case routes in `App.tsx`; confirm the report branch sits below that computation and move the fetch if not.

- [ ] **Step 6: Style the two new blocks**

In `app.css`, using the tokens from Task 7 and **no metric inside `@media print`**:

```css
.rep-qr-block { display: flex; gap: 16px; align-items: flex-start; margin-top: 18px;
  padding: 14px; border: 1px solid var(--rep-rule); background: var(--rep-panel); }
/* Always dark-on-light, in both palettes: scanners expect it, and an inverted code is
   one many readers refuse. The one part of the sheet that does not follow the theme. */
.rep-qr { background: #fff; flex: 0 0 auto; }
.rep-share { margin-top: 24px; padding: 16px; border: 1px solid var(--line); }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run apps/deliberation/test/report.test.tsx apps/deliberation/test/print-invariant.test.ts`
Expected: PASS both — the second confirms the new CSS did not break Task 7's invariant.

- [ ] **Step 8: Run the full suite**

Run: `PYTHON=.venv/bin/python npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add apps/deliberation/src/api.ts apps/deliberation/src/report.tsx apps/deliberation/src/App.tsx apps/deliberation/src/app.css apps/deliberation/test/report.test.tsx
git commit -m "Let the convener publish the record, and print the way back onto it"
```

---

### Task 9: The public page

**Files:**
- Create: `apps/deliberation/public.html`
- Create: `apps/deliberation/src/public.tsx`
- Modify: `apps/deliberation/vite.config.ts` (second entry, dev rewrite)
- Modify: `services/api/server.ts` (serve `/r/*` from the static handler)
- Test: `apps/deliberation/test/public.test.tsx`

**Interfaces:**
- Consumes: `ReportPage` with `publishedUrl` (Task 8); `GET /api/public/report/:caseId/:token` (Task 5).
- Produces: the `/r/:caseId/:token` surface.

- [ ] **Step 1: Write the failing test**

Create `apps/deliberation/test/public.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PublicReport, parsePublicPath } from "../src/public.js";

describe("the public path", () => {
  it("reads the case and the token out of the URL", () => {
    expect(parsePublicPath("/r/c1/tok123")).toEqual({ caseId: "c1", token: "tok123" });
  });

  it("decodes a case id that needed encoding", () => {
    expect(parsePublicPath("/r/turalio%2Fa/tok")).toEqual({ caseId: "turalio/a", token: "tok" });
  });

  it("is null on a path that is not a share link", () => {
    expect(parsePublicPath("/r/c1")).toBeNull();
    expect(parsePublicPath("/")).toBeNull();
  });
});

describe("the public report", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("draws the record for a good link", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: true, status: 200, text: async () => JSON.stringify(reportFixture()),
    });
    render(<PublicReport caseId="c1" token="tok" />);
    await waitFor(() => expect(screen.getByText(/TAK-994/)).toBeInTheDocument());
  });

  it("says the link is not valid rather than leaking whether the case exists", async () => {
    (globalThis.fetch as any).mockResolvedValue({
      ok: false, status: 404, text: async () => JSON.stringify({ error: "not_found" }),
    });
    render(<PublicReport caseId="c1" token="bad" />);
    await waitFor(() => expect(screen.getByText(/no longer available|not valid/i)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/revoked|exists/i);
  });
});
```

Build `reportFixture()` by importing the same helper `report.test.tsx` uses; if it is local to that file, lift it into `apps/deliberation/test/fixtures/report.ts` and have both import it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/deliberation/test/public.test.tsx`
Expected: FAIL — cannot resolve `../src/public.js`.

- [ ] **Step 3: Write the public entry**

Create `apps/deliberation/src/public.tsx`:

```tsx
import { StrictMode, useEffect, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { ReportPage } from "./report.js";
import type { CaseReport } from "./api.js";
import "./app.css";

/**
 * The record, to somebody who is not signed in.
 *
 * ITS OWN ENTRY POINT, and that is the security design rather than a build convenience.
 * `App.tsx` authenticates on load from AUTO_EMAIL, so a public route inside that shell
 * would sign its visitor in, and the only thing preventing it would be a condition
 * somebody has to keep remembering. This bundle cannot sign anybody in because the code
 * that does it is not in it - the same argument `access.ts` makes for writing rules that
 * fail closed instead of open.
 *
 * NOTHING AUTHENTICATED IS IMPORTED HERE. Not App, not the bearer-token api client, not
 * the case screens. If a future change needs one of them on this page, that is the
 * signal to ask why, not to add the import.
 */

export function parsePublicPath(path: string): { caseId: string; token: string } | null {
  const parts = path.split("/").filter((p) => p !== "");
  if (parts.length !== 3 || parts[0] !== "r") return null;
  return { caseId: decodeURIComponent(parts[1]!), token: parts[2]! };
}

export function PublicReport({ caseId, token }: { caseId: string; token: string }): ReactElement {
  const [report, setReport] = useState<CaseReport | null>(null);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/public/report/${encodeURIComponent(caseId)}/${token}`);
        if (!res.ok) { setDead(true); return; }
        setReport(JSON.parse(await res.text()) as CaseReport);
      } catch { setDead(true); }
    })();
  }, [caseId, token]);

  /* ONE MESSAGE FOR EVERY FAILURE. Never published, wrong token, revoked and no such
     case all read the same, because telling them apart is exactly the probe the 404 on
     the server exists to refuse. */
  if (dead) {
    return (
      <div className="empty">
        <h3>This link is not valid</h3>
        <p className="muted">
          It may have been revoked by the person who shared it, or it may never have been
          a link at all. Ask whoever sent it for a current one.
        </p>
      </div>
    );
  }

  if (report === null) return <p className="muted">Opening the record…</p>;

  useEffect(() => { document.title = `${report.compoundLabel} - deliberation record`; }, [report]);

  return <ReportPage report={report} publishedUrl={window.location.href} />;
}

function Boot(): ReactElement {
  const at = parsePublicPath(window.location.pathname);
  if (at === null) {
    return <div className="empty"><h3>This link is not valid</h3></div>;
  }
  return <PublicReport caseId={at.caseId} token={at.token} />;
}

const host = document.getElementById("root");
if (host !== null) createRoot(host).render(<StrictMode><Boot /></StrictMode>);
```

Move the `document.title` effect above the early returns — React forbids a hook after a conditional return, and the code above is deliberately shown in reading order rather than legal order. Fix it when you write the file: keep both `useEffect` calls at the top of the component and guard their bodies on `report !== null`.

- [ ] **Step 4: Write the HTML entry**

Create `apps/deliberation/public.html`, mirroring `apps/deliberation/index.html` but pointing at the public module:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!-- Not indexed: a published record is for whoever holds the link, and a search
         engine is not that. This is courtesy rather than a control - the token is the
         control - but a record that turns up in results is a surprise nobody wanted. -->
    <meta name="robots" content="noindex, nofollow" />
    <title>Deliberation record</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/public.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Add the second Vite entry**

In `apps/deliberation/vite.config.ts`, add to `build`:

```ts
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        // Two entries, two bundles. The public one must not contain the app shell -
        // see the note at the top of src/public.tsx.
        main: resolve(__dirname, "index.html"),
        public: resolve(__dirname, "public.html"),
      },
    },
  },
```

Import `resolve` from `node:path` and derive `__dirname` via `fileURLToPath(new URL(".", import.meta.url))`, since this config is ESM.

For development, serve `public.html` on `/r/*`:

```ts
    /* `/r/:caseId/:token` is a real path, not a hash route, because it is what a QR code
       carries and what somebody pastes into a chat. In dev Vite must be told which HTML
       answers it; in production the API's static handler does the same job. */
    {
      name: "arbiter-public-report",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url?.startsWith("/r/") === true) req.url = "/public.html";
          next();
        });
      },
    },
```

- [ ] **Step 6: Serve it in production**

In `services/api/server.ts`, where `ARBITER_STATIC_DIR` is served, resolve any `/r/*` request to `public.html` rather than `index.html`, with a comment saying why the two entries must not be swapped.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run apps/deliberation/test/public.test.tsx`
Expected: PASS.

- [ ] **Step 8: Prove the public bundle has no authenticated code**

Run: `npm run deliberate:build`

Then:

```bash
grep -l "AUTO_PASSWORD\|/api/auth/login" apps/deliberation/dist/assets/*.js
```

Expected: the main entry's chunk may appear; **the public entry's chunk must not**. Identify which chunk `public.html` loads by reading `apps/deliberation/dist/public.html`. If the public chunk contains either string, the import graph still reaches `App.tsx` — find the import and break it. **This check is the whole point of Task 9; do not skip it.**

- [ ] **Step 9: Run the full suite**

Run: `PYTHON=.venv/bin/python npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add apps/deliberation/public.html apps/deliberation/src/public.tsx apps/deliberation/vite.config.ts apps/deliberation/test/public.test.tsx services/api/server.ts
git commit -m "Give the published record a page that cannot sign anybody in"
```

---

### Task 10: End to end, in a real browser

**Files:**
- Modify: `README.md` (document `ARBITER_SHARE_SECRET` and the sharing flow)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing. This task exists because the suite cannot tell you whether a phone can read the code.

- [ ] **Step 1: Start the product with sharing on**

```bash
PORT=8790 ARBITER_GEMINI_HOST=developer PYTHON=.venv/bin/python \
  ARBITER_SHARE_SECRET="$(openssl rand -base64 48)" npm run api
```

```bash
API_PORT=8790 npm run dev -w @arbiter/deliberation -- --host 127.0.0.1 --port 5282 --strictPort --base /
```

Confirm the boot banner prints `Share:  on`.

- [ ] **Step 2: Walk it**

On a signed case's report page: publish, confirm the QR appears on sheet 1 and the controls are on screen but absent from Chrome's print preview. Open the URL **in a private window** — that window has no session, which is the condition being tested — and confirm the record renders and shows no email addresses anywhere.

- [ ] **Step 3: Scan it**

Print or save the PDF, then scan the QR from the page with a phone. Confirm it opens the record.

- [ ] **Step 4: Revoke and re-scan**

Revoke the link, then scan the same printed code again. Confirm it now says the link is not valid. **This is the property the whole derived-token design exists for; verify it rather than assuming it.**

- [ ] **Step 5: Confirm it fails closed**

Restart the API with no `ARBITER_SHARE_SECRET`. Confirm the banner says `Share:  off`, the control is gone from the report page, and a previously working share URL now 404s.

Then restart with `ARBITER_SHARE_SECRET=tooshort` and confirm the process refuses to boot naming the variable.

- [ ] **Step 6: Document it**

Add a short section to `README.md` covering: what publishing does, that any holder of the link can read the record without an account, that emails are stripped, that revoking cannot reach printed copies, and that rotating the secret invalidates every link at once.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "Say what publishing a record does, and what revoking it cannot undo"
```

---

## Self-Review

**Spec coverage.** Derived token → Task 2. Two config failures → Tasks 2, 5, 10. `canShare` → Task 3. Three routes plus the public one → Task 5. Email redaction in the builder → Task 4. Separate public entry → Task 9, with the bundle grep as its proof. `basisOf` extraction → Task 1. Palette tokens and the print-metric invariant → Task 7. QR as SVG on the cover sheet → Tasks 6, 8. Share control with the "cannot reach printed copies" wording → Task 8. Every test named in the spec's Testing section appears in a task.

**Deviation from the spec, recorded here.** The spec lists two share routes; the plan has three. `GET /api/cases/:id/share` was added in Task 5 because the report page cannot know whether to draw the QR without asking, and deriving the URL client-side would require the secret in the browser.

**Ordering.** Task 1 unblocks Task 9. Tasks 2–4 are independent of each other and all precede Task 5. Task 6 precedes Task 8. Task 7 precedes Task 8 (the QR styling uses its tokens). Tasks 8 and 9 both precede Task 10.

**Known gap, deliberately out of scope.** Nothing rate-limits `GET /api/public/report/:caseId/:token`, so the token is brute-forceable in principle. It is a 256-bit HMAC, which makes that uninteresting, and `throttle.ts` guards login rather than arbitrary routes. Worth a follow-up if these links are ever handed to the public internet at scale; not worth blocking this on.
