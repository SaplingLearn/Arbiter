import type pg from "pg";
import { pool } from "./db.js";
import { normaliseEmail } from "./auth.js";
import type { PendingInvite } from "./invites.js";

/**
 * `InviteStore` backed by Postgres: pending invitations in the `invites` table.
 *
 * THE PRIMARY KEY IS THE IDEMPOTENCE, AND THAT IS WHERE THIS GOT INTERESTING.
 * `InviteStore.add` returns the EXISTING invitation when there already is one - it
 * does not raise, and it does not overwrite. A plain `insert` against the
 * `(email, case_id)` primary key raises instead, and a caller that has never had to
 * handle an exception from `add` would turn a re-invitation into a 500 on the roster
 * screen. So the insert has to absorb the conflict and still hand back the row that
 * was already there, with the original `invited_by` and `at` intact - who invited
 * somebody, and when, is a record the log also carries, and quietly rewriting it to
 * the second inviter would put two different answers in the deployment.
 *
 * `on conflict do update set email = invites.email` rather than `do nothing` plus a
 * follow-up select, because `do nothing` returns no row and the select that has to
 * follow it is a second statement with a gap in front of it: `claim` (registration)
 * and `revoke` both delete invitations, and either landing in that gap leaves `add`
 * with nothing to return for an invitation it neither created nor found. Updating a
 * column to its own value is a no-op that makes `returning` produce the existing row
 * from the one statement that already holds the lock on it.
 *
 * ORDERING IS EXPLICIT EVERYWHERE. `InviteStore.forCase` sorts by address and the
 * other two return list order; a database returns whatever order the plan produced,
 * which is stable right up until the day the table is big enough for a different
 * plan. `collate "C"` because JavaScript's `<` compares code units and Supabase's
 * default collation does not.
 */

/** The seam, for the same reason as `AuthStoreApi`: two implementations, one shape,
 *  checked by holding both in a variable of this type in the test. */
export interface InviteStoreApi {
  add(invite: { email: string; caseId: string; invitedBy: string; at: string }): Promise<PendingInvite>;
  forCase(caseId: string): Promise<PendingInvite[]>;
  forEmail(email: string): Promise<PendingInvite[]>;
  claim(email: string): Promise<string[]>;
  revoke(email: string, caseId: string): Promise<boolean>;
}

interface InviteRow {
  email: string;
  case_id: string;
  invited_by: string;
  at: string;
}

const RETURNED = "email, case_id, invited_by, at";

function inviteFrom(row: InviteRow): PendingInvite {
  return { email: row.email, caseId: row.case_id, invitedBy: row.invited_by, at: row.at };
}

export class PostgresInviteStore implements InviteStoreApi {
  private constructor(private readonly db: pg.Pool) {}

  static async open(db: pg.Pool = pool()): Promise<PostgresInviteStore> {
    return new PostgresInviteStore(db);
  }

  /**
   * Idempotent: inviting the same address to the same case twice is one invitation,
   * so claiming it cannot add somebody to a case more than once.
   *
   * `at` is returned as the ISO string it was stored as - `db.ts`'s timestamptz parser
   * re-emits `.toISOString()`, so the value a caller reads back is byte-identical to
   * the one `server.ts` wrote. It matters here because this string is rendered
   * straight into the pending-invitations list.
   */
  async add(invite: { email: string; caseId: string; invitedBy: string; at: string }): Promise<PendingInvite> {
    const email = normaliseEmail(invite.email);
    const row = await this.db.query<InviteRow>(
      `insert into invites (email, case_id, invited_by, at) values ($1, $2, $3, $4)
       on conflict (email, case_id) do update set email = invites.email
       returning ${RETURNED}`,
      [email, invite.caseId, invite.invitedBy, invite.at],
    );
    // `returning` on an upsert always produces exactly one row: either the inserted one
    // or the conflicting one it updated in place.
    return inviteFrom(row.rows[0]!);
  }

  async forCase(caseId: string): Promise<PendingInvite[]> {
    const found = await this.db.query<InviteRow>(
      `select ${RETURNED} from invites where case_id = $1 order by email collate "C"`, [caseId],
    );
    return found.rows.map(inviteFrom);
  }

  /** Ordered by case id, where `InviteStore` returns insertion order. Nothing reads
   *  these as a sequence - registration treats them as the set of cases to join - and
   *  an unordered query is a result that changes under you for no visible reason. */
  async forEmail(email: string): Promise<PendingInvite[]> {
    const found = await this.db.query<InviteRow>(
      `select ${RETURNED} from invites where email = $1 order by case_id collate "C"`,
      [normaliseEmail(email)],
    );
    return found.rows.map(inviteFrom);
  }

  /** Consumed on registration, and dropped whether or not the caller succeeds in
   *  joining each case - a retry loop over a case that has since closed would never
   *  drain. The delete is wrapped so the ids come back ordered; `delete … returning`
   *  makes no promise about the order it hands rows back in. */
  async claim(email: string): Promise<string[]> {
    const found = await this.db.query<{ case_id: string }>(
      `with claimed as (delete from invites where email = $1 returning case_id)
       select case_id from claimed order by case_id collate "C"`,
      [normaliseEmail(email)],
    );
    return found.rows.map((r) => r.case_id);
  }

  async revoke(email: string, caseId: string): Promise<boolean> {
    const done = await this.db.query(
      "delete from invites where email = $1 and case_id = $2", [normaliseEmail(email), caseId],
    );
    return (done.rowCount ?? 0) > 0;
  }
}
