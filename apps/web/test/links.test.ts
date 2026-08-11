import { afterEach, describe, expect, it, vi } from "vitest";
import { landingHref } from "../src/links.js";

/**
 * jsdom's `location` is read-only, so the protocol is swapped by redefining the
 * property and put back afterwards. Redefining rather than assigning because
 * assigning to window.location in jsdom attempts a navigation.
 */
function withProtocol(protocol: string, fn: () => void): void {
  const original = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...original, protocol },
  });
  try {
    fn();
  } finally {
    Object.defineProperty(window, "location", { configurable: true, writable: true, value: original });
  }
}

describe("the way back to the landing page", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("offers nothing when the app is opened from the filesystem", () => {
    // THE ARTIFACT CASE, and the reason this is a runtime check rather than a build
    // flag. The submitted ZIP is opened from disk with no server and no sibling
    // landing page, so a "← Landing" link there would be a dead end - and one build
    // has to be correct in both lives, because the ZIP and the deployment come out
    // of the same `npm run web:build`.
    vi.stubEnv("VITE_LANDING_URL", "");
    withProtocol("file:", () => expect(landingHref()).toBeNull());
  });

  it("points at the origin root when served", () => {
    vi.stubEnv("VITE_LANDING_URL", "");
    withProtocol("http:", () => expect(landingHref()).toBe("/"));
    withProtocol("https:", () => expect(landingHref()).toBe("/"));
  });

  it("lets a deployment that splits the two origins override it", () => {
    vi.stubEnv("VITE_LANDING_URL", "https://arbiter.example/");
    withProtocol("https:", () => expect(landingHref()).toBe("https://arbiter.example/"));
    // The override wins even over the filesystem check: if someone has deliberately
    // named an absolute URL, they mean it.
    withProtocol("file:", () => expect(landingHref()).toBe("https://arbiter.example/"));
  });
});
