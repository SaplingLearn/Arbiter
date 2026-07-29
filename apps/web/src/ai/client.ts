/**
 * The ONLY module in apps/web permitted to issue a request (spec section 4).
 *
 * This is the first and only relaxation of the Phase 2 "no runtime fetch in
 * apps/web" invariant, and it is relaxed only here and only when `liveEnabled`.
 */

/** Spec sections 5.1 and 7.1: rung 1 gets 2.5 seconds and not a millisecond more. */
export const LIVE_TIMEOUT_MS = 2500;

/**
 * Two independent gates, computed once (spec section 2).
 *
 * The build flag means the submitted ZIP is compiled with live off entirely. The
 * protocol check means a ZIP built from the wrong config still cannot fire a
 * request. The redundancy is deliberate: apps/web/e2e/static-file.spec.ts collects
 * page.on("request") as well as requestfailed and asserts both are empty, so over
 * file:// the app must not ATTEMPT the call - a build that tries and fails still
 * fails the test.
 *
 * A module-level const, not a function: Vite replaces import.meta.env statically
 * at build time, so on the static build this whole expression folds to `false` and
 * the fetch below is unreachable code rather than a branch nobody took.
 */
export const liveEnabled =
  import.meta.env.VITE_ARBITER_LIVE === "1" && location.protocol !== "file:";

/**
 * Post JSON and return the parsed value, or null.
 *
 * NEVER throws. Spec section 3's invariant is that rung 1 either succeeds or is
 * skipped: network-off, HTTP 500, malformed JSON, timeout and the 503
 * {"error":"no_key"} a keyless service returns are all one event to the caller, a
 * rung-1 miss. That is what collapses spec section 11's matrix into five transport
 * tests instead of fifteen bespoke ones.
 *
 * `parse` is the caller's SCHEMA CHECK, not a cast. A 200 carrying well-formed
 * JSON of the wrong shape is the case that would otherwise reach the confirm
 * panel, so a parse that returns null - or throws, as zod's .parse does - is a
 * miss like the rest.
 */
export async function postJson<T>(
  path: string,
  body: unknown,
  parse: (u: unknown) => T | null,
): Promise<T | null> {
  // Before the AbortController, before anything: on the static build nothing here
  // may run at all.
  if (!liveEnabled) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return parse((await res.json()) as unknown);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
