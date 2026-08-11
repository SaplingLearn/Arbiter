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
 *
 * THIS IS THE ONE COMPONENT THAT KEEPS ITS INLINE STYLES, deliberately. Every
 * other component moved to `app.css` during the redesign. This one is the screen
 * shown when rendering has already failed, so it should depend on as little as
 * possible: a class here would render as unstyled text in exactly the scenario
 * where a stylesheet is what broke. The `var()` calls degrade to browser defaults
 * rather than to nothing. Do not "finish the job" by converting it.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "var(--sans)" }}>
          <h1 style={{ fontFamily: "var(--display)" }}>ARBITER could not render</h1>
          <pre style={{ color: "var(--toxic)", whiteSpace: "pre-wrap" }}>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
