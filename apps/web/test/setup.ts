import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest.config.ts does not set `globals: true`, so @testing-library/react's
// own auto-cleanup (which relies on a global afterEach) never registers.
// Without this, DOM from one test in a file leaks into the next, and
// getByTestId queries that are unique per-render start matching more than
// one element.
afterEach(cleanup);
