import { existsSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normaliseEmail } from "./auth.js";

/**
 * Pending invitations: somebody was added to a case before they had an account.
 *
 * WHY THIS EXISTS. Requiring every participant to register first makes the product
 * unusable for the thing it is for - you convene a case because you want a specific
 * colleague's read, and telling the convener "ask them to sign up, then come back"
 * loses the case. Worse, it quietly encourages leaving that person off, and the
 * person most likely to be left off is the one who disagrees.
 *
 * WHAT IT IS NOT. There is no email delivery here, so an invitation does not notify
 * anybody. It is a standing instruction: when this address registers, put them on
 * these cases. The convener still has to tell their colleague out of band, and the
 * UI says so rather than implying a mail was sent.
 *
 * THE ADDRESS IS NOT A CREDENTIAL. Claiming an invitation happens at registration,
 * which means whoever proves they can register with that address gets the case. That
 * is the same trust model as any "invite by email" product and it is worth stating:
 * without email verification, an invitation trusts that the convener typed the right
 * address.
 */

export interface PendingInvite {
  email: string;
  caseId: string;
  invitedBy: string;
  at: string;
}

export class InviteStore {
  private invites: PendingInvite[] = [];

  /** Constructed empty, loaded by `open` - the same split, and for the same reason, as
   *  `FileStore` and `AuthStore`. An invitation list that arrives one tick after the
   *  store does is a store that reports no pending invitations, and "nobody was
   *  invited" is a plausible answer here rather than an obviously broken one. */
  private constructor(private readonly path: string | null = null) {}

  static async open(path: string | null = null): Promise<InviteStore> {
    const store = new InviteStore(path);
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    if (this.path === null) return;
    if (existsSync(this.path)) {
      this.invites = JSON.parse(await readFile(this.path, "utf8")) as PendingInvite[];
    } else {
      await mkdir(dirname(this.path), { recursive: true });
    }
  }

  /** Synchronous, inside async callers, for the reason set out on `FileStore.putCase`:
   *  it rewrites the whole list, so two writes racing across an await would leave the
   *  older list on disk - and the loser could be the one holding a claim that has
   *  already been consumed. */
  private persist(): void {
    if (this.path === null) return;
    writeFileSync(this.path, JSON.stringify(this.invites, null, 2), "utf8");
  }

  /** Idempotent: inviting the same address to the same case twice is one invitation,
   *  not two, so claiming it cannot add somebody to a case more than once. */
  async add(invite: { email: string; caseId: string; invitedBy: string; at: string }): Promise<PendingInvite> {
    const email = normaliseEmail(invite.email);
    const existing = this.invites.find((i) => i.email === email && i.caseId === invite.caseId);
    if (existing !== undefined) return existing;
    const row: PendingInvite = { ...invite, email };
    this.invites.push(row);
    this.persist();
    return row;
  }

  async forCase(caseId: string): Promise<PendingInvite[]> {
    return this.invites.filter((i) => i.caseId === caseId).sort((a, b) => (a.email < b.email ? -1 : 1));
  }

  async forEmail(email: string): Promise<PendingInvite[]> {
    const e = normaliseEmail(email);
    return this.invites.filter((i) => i.email === e);
  }

  /** Consumed on registration. Returns the case ids so the caller can add the new
   *  account to each; the invitations are dropped whether or not that succeeds,
   *  because a retry loop over a case that has since closed would never drain. */
  async claim(email: string): Promise<string[]> {
    const e = normaliseEmail(email);
    const mine = this.invites.filter((i) => i.email === e);
    if (mine.length === 0) return [];
    this.invites = this.invites.filter((i) => i.email !== e);
    this.persist();
    return mine.map((i) => i.caseId);
  }

  async revoke(email: string, caseId: string): Promise<boolean> {
    const e = normaliseEmail(email);
    const before = this.invites.length;
    this.invites = this.invites.filter((i) => !(i.email === e && i.caseId === caseId));
    if (this.invites.length === before) return false;
    this.persist();
    return true;
  }
}
