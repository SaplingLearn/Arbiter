import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { existsSync } from "node:fs";

/**
 * THE SAME INTERPRETER THE DEV SERVER USES, for the same reason.
 *
 * services/api shells out to data/prep/measure_pdf.py for every document, so the tests
 * that upload one need a Python with PyMuPDF in it. `documents.ts` resolves that from
 * PYTHON and otherwise takes whatever `python` is on PATH - which on a machine whose
 * system Python has no pip is an interpreter that will never have PyMuPDF.
 *
 * The result was two tests in services/api failing on any machine without a global
 * install, with a message about the DOCUMENT ("unreadable - PyMuPDF is not installed")
 * rather than about the environment - so a green suite depended on knowing to set an
 * environment variable nothing told you about. tools/dev-all.mjs makes the same choice
 * for the running product; this is the test half of it.
 *
 * An explicit PYTHON still wins, and with no virtualenv this does nothing - CI installs
 * the requirements globally and is unaffected.
 */
if (process.env["PYTHON"] === undefined && existsSync(".venv/bin/python")) {
  process.env["PYTHON"] = ".venv/bin/python";
}

// vitest.config.ts does not set `globals: true`, so @testing-library/react's
// own auto-cleanup (which relies on a global afterEach) never registers.
// Without this, DOM from one test in a file leaks into the next, and
// getByTestId queries that are unique per-render start matching more than
// one element.
afterEach(cleanup);

// jsdom implements neither of these, and both are still reached by the surviving
// apps: apps/landing reads matchMedia for prefers-reduced-motion
// (`motion/reducedMotion.ts`, `sections/OpeningScene.tsx`) and apps/deliberation
// calls scrollIntoView to pin the ask transcript to its foot
// (`pages.tsx:633`). Defaults that do nothing, so a test which cares about
// either one overrides it explicitly rather than inheriting an opinion.
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
