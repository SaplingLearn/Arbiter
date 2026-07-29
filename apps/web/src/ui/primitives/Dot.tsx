import type { Assertion } from "@arbiter/engine";

const TONE: Record<Assertion, string> = {
  toxic: "dot-toxic", safe: "dot-safe", ambiguous: "dot-ambiguous",
};

/** Solid when the claim is live, outlined when defeated: form as well as colour. */
export function Dot({ assertion, defeated }: { assertion: Assertion; defeated: boolean }) {
  return (
    <span
      data-testid="evidence-dot"
      title={`${assertion}${defeated ? " (defeated)" : ""}`}
      className={`dot ${TONE[assertion]}${defeated ? " dot-defeated" : ""}`}
    />
  );
}
