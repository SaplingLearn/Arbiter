import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest.config.ts does not set `globals: true`, so @testing-library/react's
// own auto-cleanup (which relies on a global afterEach) never registers.
// Without this, DOM from one test in a file leaks into the next, and
// getByTestId queries that are unique per-render start matching more than
// one element.
afterEach(cleanup);

// jsdom implements neither of these. useAnchorScroll reads matchMedia for
// prefers-reduced-motion and calls scrollIntoView, and every test that renders
// <App /> now mounts that hook. Defaults that do nothing, so a test which cares
// about either one overrides it explicitly rather than inheriting an opinion.
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function () {};
  }
}
