import type { Assertion } from "@arbiter/engine";

const COLOUR: Record<Assertion, string> = {
  toxic: "var(--toxic)", safe: "var(--clean)", ambiguous: "var(--ambiguous)",
};

/** Solid when the claim is live, outlined when defeated: form as well as colour. */
export function Dot({ assertion, defeated }: { assertion: Assertion; defeated: boolean }) {
  return (
    <span
      data-testid="evidence-dot"
      title={`${assertion}${defeated ? " (defeated)" : ""}`}
      style={{
        display: "inline-block", width: 10, height: 10, borderRadius: "50%",
        border: `2px solid ${COLOUR[assertion]}`,
        background: defeated ? "transparent" : COLOUR[assertion],
      }}
    />
  );
}
