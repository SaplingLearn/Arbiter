/**
 * The generic fallback ladder, shared by both AI surfaces (spec section 3).
 *
 * Each surface declares its rungs as DATA and this walker runs them in order,
 * stopping at the first one that returns a value. `null` is the pass signal.
 *
 * The rung that answered is returned as a value rather than left as a comment.
 * That is what makes spec section 11's fifteen-cell failure matrix cheap: above the
 * transport boundary every failure is the same event, so the tests assert on
 * `rung` rather than on "an answer appeared" (spec section 12, trap 1), and the
 * pre-flight panel reports which surfaces are live and which are on cache (spec
 * section 10) from the same field.
 *
 * No I/O, no imports. The only module permitted to issue a request is client.ts.
 */
export type Source = "live" | "cache" | "local" | "none";

export interface Resolution<T> {
  value: T | null;
  /** 1-based; the rung that answered, or the last rung tried. */
  rung: number;
  source: Source;
}

export interface Rung<I, T> {
  source: Source;
  run: (input: I) => Promise<T | null>;
}

export async function resolve<I, T>(rungs: Rung<I, T>[], input: I): Promise<Resolution<T>> {
  for (let i = 0; i < rungs.length; i++) {
    const rung = rungs[i]!;
    // Deliberately NOT wrapped in try/catch. Rung 1 is guaranteed not to throw
    // because client.postJson returns null for every transport failure (spec
    // section 3's invariant), so a throw here is a bug in a pure local rung.
    // Swallowing it would degrade the surface past a broken rung while still
    // reporting a plausible `rung`, which is the one failure the assert-on-rung
    // discipline exists to catch.
    const value = await rung.run(input);
    if (value !== null) return { value, rung: i + 1, source: rung.source };
  }
  // Exhausted. `source` is "none" rather than the last rung's declared source:
  // nothing answered, so nothing may be reported as having answered.
  return { value: null, rung: rungs.length, source: "none" };
}
