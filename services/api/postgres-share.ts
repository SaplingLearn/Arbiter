import type pg from "pg";
import { pool } from "./db.js";
import type { ShareLink } from "./share.js";

/**
 * `ShareStore` backed by Postgres: which cases are published, in `share_links`.
 *
 * THERE IS NO TOKEN COLUMN, AND THAT IS THE WHOLE POINT OF THE TABLE'S SHAPE. The
 * share token is `HMAC-SHA256(ARBITER_SHARE_SECRET, "caseId:version")`, derived on
 * demand from two columns that are not secret - so this table holds no secret material
 * and a stolen database yields no working URL. Anything added here that could be
 * replayed as a capability (a token, a digest of one, the secret itself) would undo
 * that, and undo it silently: every test would still pass. See `share.ts`.
 *
 * WHERE THIS DELIBERATELY DIVERGES FROM `ShareStore`, and why neither is a behaviour
 * change:
 *
 *   - `publish` is one `insert ... on conflict` rather than a read followed by a write.
 *     In memory the check and the write are one synchronous step; across two
 *     connections they interleave, and two simultaneous publishes of the same case
 *     would both see no row and both insert - one of them raising on the primary key,
 *     on a route the convener would read as a 500 for pressing a button twice.
 *
 *   - `revoke` reads its own `returning` rather than fetching first, for the same
 *     reason: the version bump has to be the database's arithmetic, not a value this
 *     process read a moment ago. Two revokes racing on a read-then-write would both
 *     write `version + 1` from the same starting point, leaving the second one's link
 *     dead in this process's memory and ALIVE at a version somebody still holds a QR
 *     for. `version = version + 1` in SQL cannot land twice on the same number.
 */

/** The seam, for the same reason as `AuthStoreApi` and `InviteStoreApi`: two
 *  implementations, one shape, checked by holding both in a variable of this type in
 *  `test/postgres-share.test.ts`.
 *
 *  Declared here rather than in `share.ts` because this file is the second
 *  implementation and the first one did not need a name for its own shape. */
export interface ShareStoreApi {
  get(caseId: string): Promise<ShareLink | null>;
  publish(caseId: string, userId: string, at: string): Promise<ShareLink>;
  revoke(caseId: string, at: string): Promise<ShareLink | null>;
}

interface ShareRow {
  case_id: string;
  version: number;
  created_by: string;
  created_at: string;
  revoked_at: string | null;
}

const RETURNED = "case_id, version, created_by, created_at, revoked_at";

function linkFrom(row: ShareRow): ShareLink {
  return {
    caseId: row.case_id,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export class PostgresShareStore implements ShareStoreApi {
  private constructor(private readonly db: pg.Pool) {}

  static async open(db: pg.Pool = pool()): Promise<PostgresShareStore> {
    return new PostgresShareStore(db);
  }

  async get(caseId: string): Promise<ShareLink | null> {
    const found = await this.db.query<ShareRow>(
      `select ${RETURNED} from share_links where case_id = $1`, [caseId],
    );
    const row = found.rows[0];
    return row === undefined ? null : linkFrom(row);
  }

  /**
   * Publish, or return the link that already exists.
   *
   * `version` IS ABSENT FROM THE `set` LIST, AND THAT ABSENCE IS THE FEATURE. The
   * inserted row's version is 1; assigning `excluded.version` here would reset a
   * revoked case to 1 and re-mint the token that revoke had just killed, which is
   * exactly the resurrection the version bump exists to prevent. Publishing after a
   * revoke has to reuse the already-bumped number, so the only statement that may
   * touch this column is `revoke`.
   *
   * IDEMPOTENT ON A LIVE LINK, so the two `case` expressions. Re-minting on every press
   * would break a QR somebody had already printed, and pressing "publish" twice is not
   * a request to invalidate the paper on a colleague's desk - so a live row keeps its
   * original publisher and timestamp, and only a revoked one is re-attributed to
   * whoever brought it back. `revoked_at` is cleared unconditionally because it is
   * already null in the live case.
   */
  async publish(caseId: string, userId: string, at: string): Promise<ShareLink> {
    const row = await this.db.query<ShareRow>(
      `insert into share_links (case_id, version, created_by, created_at, revoked_at)
       values ($1, 1, $2, $3, null)
       on conflict (case_id) do update set
         created_by = case when share_links.revoked_at is null then share_links.created_by else excluded.created_by end,
         created_at = case when share_links.revoked_at is null then share_links.created_at else excluded.created_at end,
         revoked_at = null
       returning ${RETURNED}`,
      [caseId, userId, at],
    );
    // `returning` on an upsert always produces exactly one row: either the inserted one
    // or the conflicting one it updated in place.
    return linkFrom(row.rows[0]!);
  }

  /** Null for a case nobody published, matching the file store - `server.ts` answers
   *  `{revoked: true}` either way, so this distinction is for the caller that wants it
   *  rather than for the route. */
  async revoke(caseId: string, at: string): Promise<ShareLink | null> {
    const row = await this.db.query<ShareRow>(
      `update share_links set version = version + 1, revoked_at = $2
       where case_id = $1 returning ${RETURNED}`,
      [caseId, at],
    );
    const updated = row.rows[0];
    return updated === undefined ? null : linkFrom(updated);
  }
}
