/**
 * A budget on the endpoints that call a model.
 *
 * WHY THIS IS NOT `LoginThrottle`. That one escalates a delay on FAILURES, to make
 * guessing a password expensive. This counts SUCCESSES, because the thing being
 * protected is not an account - it is a bill. Four endpoints in this service spend real
 * money per request (`ask` on a case, `ask` and `summary` on the library, and
 * `adjudicate`), and every one of them is cheap to call and slow to answer. Bound to
 * loopback that does not matter. The moment the service listens on anything else, an
 * unbounded paid endpoint is an open proxy to somebody's Vertex quota, and the first
 * person to find it decides how much the deployment costs.
 *
 * A FIXED WINDOW, NOT A TOKEN BUCKET. A bucket that refills continuously is the better
 * shape for smoothing traffic and the worse shape for a spend cap, because the thing a
 * budget has to promise is an upper bound over a period somebody can reason about -
 * "thirty calls in ten minutes" is checkable against a price list and "a bucket of ten
 * refilling at one every twenty seconds" is not. The cost of the simple version is a
 * caller who can spend two windows' worth across a boundary, which doubles the worst
 * case and leaves it bounded.
 *
 * TWO SCOPES, for the same reason `throttle.ts` has two. Per account catches one person
 * looping a script. Per source catches one host driving many accounts - which the
 * per-account rule never sees, and which is what an abusive deployment actually looks
 * like. The source cap is deliberately a multiple rather than a second small number, so
 * a shared egress (an office, a proxy, the dev server's own `/api` proxy) does not
 * throttle a room full of honest users.
 *
 * PURE OVER AN INJECTED CLOCK, so the window is tested exactly rather than with sleeps.
 */

/** How long a window lasts. Ten minutes is short enough to recover from and long enough
 *  that a per-window number means something against a price per thousand calls. */
export const WINDOW_MS = 10 * 60 * 1000;

/**
 * Calls one account may make per window, when nothing overrides it.
 *
 * Thirty is well above a person reading a review and asking questions about it, and far
 * below a script. It is the number a deployment is most likely to want to change, which
 * is why it is the one this reads from the environment.
 */
export const DEFAULT_BUDGET = 30;

/** A source may spend this many accounts' worth before it looks like one machine rather
 *  than one office. */
export const SOURCE_MULTIPLE = 6;

export function budgetFrom(env: NodeJS.ProcessEnv): number {
  const raw = env["ARBITER_MODEL_BUDGET"];
  if (raw === undefined || raw === "") return DEFAULT_BUDGET;
  const n = Number(raw);
  // A malformed value falls back to the default rather than to Infinity or NaN. `NaN >
  // budget` is false, which would silently disable the cap - the exact failure a spend
  // limit must not have.
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_BUDGET;
}

interface Window { start: number; calls: number }

export class ModelBudget {
  private byAccount = new Map<string, Window>();
  private bySource = new Map<string, Window>();

  constructor(private readonly perAccount: number = DEFAULT_BUDGET) {}

  private read(map: Map<string, Window>, key: string, now: number): Window {
    const w = map.get(key);
    if (w === undefined || now - w.start >= WINDOW_MS) return { start: now, calls: 0 };
    return w;
  }

  /** Milliseconds until this caller may spend again, or 0 if they may spend now. */
  retryAfter(account: string, src: string, now: number): number {
    const a = this.read(this.byAccount, account, now);
    const s = this.read(this.bySource, src, now);
    const waits: number[] = [];
    if (a.calls >= this.perAccount) waits.push(a.start + WINDOW_MS - now);
    if (s.calls >= this.perAccount * SOURCE_MULTIPLE) waits.push(s.start + WINDOW_MS - now);
    return waits.length === 0 ? 0 : Math.max(0, Math.max(...waits));
  }

  /**
   * Count one call.
   *
   * Recorded when the call is ADMITTED, not when it returns. A model call that fails
   * upstream has still been paid for in latency and usually in tokens, and counting only
   * successes would let a caller who reliably triggers a 502 spend without limit.
   */
  record(account: string, src: string, now: number): void {
    const a = this.read(this.byAccount, account, now);
    this.byAccount.set(account, { start: a.start, calls: a.calls + 1 });
    const s = this.read(this.bySource, src, now);
    this.bySource.set(src, { start: s.start, calls: s.calls + 1 });
  }

  /** Test and diagnostic surface only. */
  spentBy(account: string, now: number): number {
    return this.read(this.byAccount, account, now).calls;
  }
}
