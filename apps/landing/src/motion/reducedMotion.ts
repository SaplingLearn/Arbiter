/**
 * Does this reader want motion?
 *
 * Guarded rather than called directly because `window.matchMedia` does not exist in
 * jsdom unless a test stubs it. An unguarded call throws during render, which turns
 * "this component does not animate under test" into "this component cannot be
 * rendered under test" - a much worse failure, and one that would only show up once
 * somebody wrote the first test.
 *
 * Absent the API the answer is `false`: animate. A reader who has expressed no
 * preference has not expressed the reduced one.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
