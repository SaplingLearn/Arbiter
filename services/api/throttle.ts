/**
 * Login throttling.
 *
 * WHAT IT DEFENDS. Passwords here are scrypt-hashed at a deliberately expensive cost,
 * which slows an attacker who has stolen the file. This defends the other direction:
 * somebody with no file at all, guessing against the live endpoint. Without it the
 * only limit on guesses is how fast the server can hash - and the hash cost that
 * protects a stolen file makes each guess cheap for the attacker and expensive for us.
 *
 * DELAY, NOT LOCKOUT. A lockout after N failures hands anybody a denial-of-service
 * against a colleague: guess wrong five times at their address and they cannot work.
 * Escalating delay costs an attacker the same time and costs the real account holder
 * one slow retry, so the failure lands on the right person.
 *
 * TWO RULES, AND THEY COUNT DIFFERENT THINGS - this is the part that was wrong first
 * time and is worth stating plainly.
 *
 *   Per address: consecutive failures. Targets somebody grinding one account.
 *
 *   Per source: how many DISTINCT addresses this host has failed against. Targets
 *   spraying - one host trying a thousand accounts once each, which the per-address
 *   rule never sees.
 *
 * Counting raw failures per source was measured to be wrong here: behind a proxy -
 * including the dev server's own `/api` proxy, and any reverse proxy in front of a
 * real deployment - every user shares one source address, so one person mistyping
 * their password four times throttled everybody in the building. Counting distinct
 * addresses instead means a shared egress is only throttled by behaviour no ordinary
 * user produces.
 *
 * PURE OVER AN INJECTED CLOCK, so escalation is tested exactly rather than with sleeps.
 */

/** Failures are forgotten after this long without one, so an account that mistypes a
 *  password on Monday is not still penalised on Friday. */
export const DECAY_MS = 15 * 60 * 1000;

/** Distinct addresses one source may fail against before it looks like spraying.
 *  Well above a shared office proxy on a bad morning, well below a password list. */
export const SPRAY_THRESHOLD = 12;

/**
 * Nothing for the first few - real people mistype - then doubling from one second to
 * a ceiling of five minutes. The ceiling exists because unbounded backoff becomes a
 * permanent lockout by another name.
 */
export function delayFor(failures: number): number {
  if (failures <= 3) return 0;
  return Math.min(1000 * 2 ** (failures - 4), 5 * 60 * 1000);
}

interface AddressState { failures: number; blockedUntil: number; lastFailureAt: number }
interface SourceState { addresses: Set<string>; blockedUntil: number; lastFailureAt: number }

export class LoginThrottle {
  private byAddress = new Map<string, AddressState>();
  private bySource = new Map<string, SourceState>();

  private address(email: string, now: number): AddressState {
    const s = this.byAddress.get(email);
    if (s === undefined || now - s.lastFailureAt > DECAY_MS) {
      return { failures: 0, blockedUntil: 0, lastFailureAt: 0 };
    }
    return s;
  }

  private source(src: string, now: number): SourceState {
    const s = this.bySource.get(src);
    if (s === undefined || now - s.lastFailureAt > DECAY_MS) {
      return { addresses: new Set(), blockedUntil: 0, lastFailureAt: 0 };
    }
    return s;
  }

  /** Milliseconds the caller must wait, or 0 if they may try now. */
  retryAfter(email: string, src: string, now: number): number {
    const a = this.address(email, now);
    const s = this.source(src, now);
    return Math.max(0, a.blockedUntil - now, s.blockedUntil - now);
  }

  recordFailure(email: string, src: string, now: number): void {
    const a = this.address(email, now);
    const failures = a.failures + 1;
    this.byAddress.set(email, { failures, lastFailureAt: now, blockedUntil: now + delayFor(failures) });

    const s = this.source(src, now);
    const addresses = new Set(s.addresses).add(email);
    // Counted in EXCESS of the threshold, so a source only starts escalating once it
    // has failed against more distinct accounts than any honest shared egress would.
    const over = Math.max(0, addresses.size - SPRAY_THRESHOLD);
    this.bySource.set(src, {
      addresses, lastFailureAt: now,
      blockedUntil: over === 0 ? 0 : now + delayFor(over + 3),
    });
  }

  /**
   * A success clears the address, and never the source.
   *
   * Clearing the source too would hand an attacker the escape hatch: spray a hundred
   * addresses, sign in once to an account they already own, and the counter resets.
   */
  recordSuccess(email: string): void {
    this.byAddress.delete(email);
  }

  /** Test and diagnostic surface only. */
  failuresFor(email: string, now: number): number {
    return this.address(email, now).failures;
  }

  addressesTriedBy(src: string, now: number): number {
    return this.source(src, now).addresses.size;
  }
}
