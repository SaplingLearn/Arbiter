import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ShareStoreApi } from "./postgres-share.js";

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
 * Which cases are published. An in-memory map behind a JSON file, the same shape - and
 * the same `open()` split - `AuthStore`, `InviteStore` and `FileStore` use.
 *
 * `PostgresShareStore` is the other implementation of `ShareStoreApi`; `stores.ts`
 * decides which one a process runs on, once.
 */
export class ShareStore implements ShareStoreApi {
  private links = new Map<string, ShareLink>();

  /** Constructed empty, loaded by `open` - the same split, and for the same reason, as
   *  `InviteStore` and `FileStore`. A link list that arrives one tick after the store
   *  does is a store that reports nothing published, and "nobody has published this"
   *  is a plausible answer here rather than an obviously broken one: the convener would
   *  be offered "Publish this record" for a case that already has a printed QR on a
   *  desk, and pressing it would mint a link at a version the paper does not carry. */
  private constructor(private readonly path: string | null = null) {}

  static async open(path: string | null = null): Promise<ShareStore> {
    const store = new ShareStore(path);
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    if (this.path === null) return;
    if (existsSync(this.path)) {
      const raw = JSON.parse(await readFile(this.path, "utf8")) as { links: ShareLink[] };
      for (const l of raw.links) this.links.set(l.caseId, l);
    } else {
      await mkdir(dirname(this.path), { recursive: true });
    }
  }

  /** Synchronous, inside async callers, for the reason set out on `FileStore.putCase`:
   *  it rewrites the whole file, so two writes racing across an await would leave the
   *  older list on disk - and the loser could be a revoke, which is the one write here
   *  whose loss re-animates a link somebody deliberately killed. */
  private persist(): void {
    if (this.path === null) return;
    writeFileSync(this.path, JSON.stringify({ links: [...this.links.values()] }, null, 2), "utf8");
  }

  async get(caseId: string): Promise<ShareLink | null> {
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
  async publish(caseId: string, userId: string, at: string): Promise<ShareLink> {
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

  async revoke(caseId: string, at: string): Promise<ShareLink | null> {
    const existing = this.links.get(caseId);
    if (existing === undefined) return null;
    const revoked: ShareLink = { ...existing, version: existing.version + 1, revokedAt: at };
    this.links.set(caseId, revoked);
    this.persist();
    return revoked;
  }
}
