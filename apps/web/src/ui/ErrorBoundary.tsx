import React from "react";

/**
 * A render failure must name itself rather than blanking the screen. Under
 * presentation conditions an empty page is indistinguishable from a crashed
 * laptop, and there is no console open to check.
 *
 * Lives in its own module so a test can mount the SAME boundary the app mounts.
 * Declared inside main.tsx it was unreachable: importing main.tsx runs
 * `createRoot(...).render(...)` at module scope, so a test could never get hold of
 * the boundary without booting the whole application.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "var(--sans)" }}>
          <h1 style={{ fontFamily: "var(--serif)" }}>ARBITER could not render</h1>
          <pre style={{ color: "var(--toxic)", whiteSpace: "pre-wrap" }}>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
