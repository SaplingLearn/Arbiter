import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { autoCredentials } from "../src/App.js";

/**
 * WHO THE PRODUCT LETS IN WHEN NOBODY CONFIGURED AN IDENTITY.
 *
 * `App.tsx` is `index.html`, `index.html` is the app shell, and the shell is served at
 * `/deliberation/` on any deployment with `ARBITER_STATIC_DIR` set. While the demo lead's
 * address and its published password were unconditional `??` defaults in that file, every
 * such deployment with the seeded team signed in whoever arrived at that path - as the
 * convener, with read access to every case the deployment held. Not a bug in a branch:
 * a default that was never overridden.
 *
 * These tests pin the replacement, which is the ordinary fail-closed shape this repo uses
 * for `ARBITER_SHARE_SECRET`: an absent credential disables the thing rather than
 * degrading it.
 *
 * WHAT A TEST CANNOT PROVE HERE, said so it is not mistaken for covered. `DEV` is replaced
 * by Vite at build time, so no assertion in this file can show what a PRODUCTION bundle
 * contains. The proof of that is a grep over the built chunks, and it lives in the README's
 * verification list beside the one that proves the public bundle carries no auth code:
 *
 *   npm run deliberate:build
 *   grep -c "arbiter-demo-2026" apps/deliberation/dist/assets/*.js   # every count 0
 *
 * What is testable here is the DECISION - given an environment, is there an identity - and
 * that the shell asks rather than assumes when the answer is no.
 */

describe("deciding whether there is an identity to sign in as", () => {
  it("carries the demo lead in development, so a dev run is unchanged", () => {
    expect(autoCredentials({ DEV: true })).toEqual({
      email: "r.okafor@arbiter.demo",
      password: "arbiter-demo-2026",
    });
  });

  /** The one that matters. A built artifact nobody configured signs nobody in. */
  it("has nobody in a build that was not given anybody", () => {
    expect(autoCredentials({ DEV: false })).toBeNull();
  });

  it("treats a missing DEV the same as a production build, rather than as development", () => {
    // Fail closed on the ABSENCE of the flag too: an environment object that never
    // carried it is not evidence that this is a dev server.
    expect(autoCredentials({})).toBeNull();
  });

  it("uses what a build explicitly asked for, which is how a demo deployment opts in", () => {
    expect(autoCredentials({
      DEV: false,
      VITE_AUTO_EMAIL: "demo@example.test",
      VITE_AUTO_PASSWORD: "not-a-real-password",
    })).toEqual({ email: "demo@example.test", password: "not-a-real-password" });
  });

  /**
   * An empty string is somebody CLEARING a value, and the whole hazard here is a
   * configuration that fails open on the input that meant "no". Same reading
   * `ARBITER_SHARE_SECRET=""` gets on the server.
   */
  it("reads a blank value as absent rather than as a credential", () => {
    expect(autoCredentials({ DEV: true, VITE_AUTO_EMAIL: "", VITE_AUTO_PASSWORD: "" })).toBeNull();
    expect(autoCredentials({ DEV: false, VITE_AUTO_EMAIL: "", VITE_AUTO_PASSWORD: "x" })).toBeNull();
  });

  /**
   * HALF A CREDENTIAL IS NOT ONE. Letting an address through without a password would send
   * `api.login` an empty string - a real request that really fails, surfacing as an error
   * panel that reads like the service is down rather than like a build that was never
   * given an identity. The dev fallback fills the OTHER half here, which is exactly the
   * case that has to not sneak past.
   */
  it("refuses a half-configured identity in either direction", () => {
    expect(autoCredentials({ DEV: false, VITE_AUTO_EMAIL: "someone@example.test" })).toBeNull();
    expect(autoCredentials({ DEV: false, VITE_AUTO_PASSWORD: "orphan" })).toBeNull();
  });
});

/**
 * The shell rendered with no identity available.
 *
 * `import.meta.env` is read once when `App.tsx` loads, so this stubs the two variables to
 * blank BEFORE importing it - which `autoCredentials` reads as absent, above. That is the
 * same state a production build with neither variable set arrives in, reached by a route a
 * test can actually take.
 */
describe("the shell with no identity to sign in as", () => {
  it("asks who you are, and makes no login request on the way", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_AUTO_EMAIL", "");
    vi.stubEnv("VITE_AUTO_PASSWORD", "");

    const login = vi.fn();
    vi.doMock("../src/api.js", async () => {
      const actual = await vi.importActual<typeof import("../src/api.js")>("../src/api.js");
      return { ...actual, api: { ...actual.api, login } };
    });
    // Draws nothing under jsdom and imports `three` dynamically; not what this measures.
    vi.doMock("../src/shell/Backdrop.js", () => ({ Backdrop: () => null }));

    const { App } = await import("../src/App.js");
    render(<App />);

    // A form, not the "Opening the record" panel - which is what the auto-sign-in path
    // shows while its request is in flight, and would mean a request was in flight.
    expect(await screen.findByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.queryByText(/Opening the record/i)).not.toBeInTheDocument();

    // Held across a tick, because "has not happened yet" and "does not happen" are
    // different claims and only the second one is the security property.
    await waitFor(() => expect(login).not.toHaveBeenCalled());
    expect(login).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
    vi.doUnmock("../src/api.js");
    vi.doUnmock("../src/shell/Backdrop.js");
  });
});
